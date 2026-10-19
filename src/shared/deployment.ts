import { halfExtents, type Point } from './geometry.ts';
import { inZone, whollyIn, zonesOf } from './objects.ts';
import type { Zone } from './scenarios.ts';
import { holdNarrative } from './narrative.ts';
import { crowded, frontFirst } from './movement.ts';
import { isSolid, onOutlines, outline } from './sight.ts';
import type { GameState, Model, TerrainKind } from './types.ts';

// Before the battle starts, each side's models stay inside its deployment zone. Where a side has two zones (Divide
// and Conquer, Convergence) a warband may stand in either, but all of it in the same one: drag any of its models into
// the other zone and the rest of the warband follows.

export type Move = { id: string; x: number; y: number; rot?: number };

/** Whether the whole base is on the table. */
const onBoard = (state: GameState, m: Model) => {
  const { rx, ry } = halfExtents(m.base);
  return m.x - rx >= -1e-6 && m.y - ry >= -1e-6 && m.x + rx <= state.board.w + 1e-6 && m.y + ry <= state.board.h + 1e-6;
};
const within = (state: GameState, zone: Zone, m: Model) => onBoard(state, m) && whollyIn([zone], m);

/** Which of the zones a model stands wholly inside (and on the table), or -1. */
export const zoneOf = (state: GameState, zones: Zone[], m: Model) => zones.findIndex(z => within(state, z, m));

/** The furthest a model gets along a straight line from where it stands towards `to` without leaving the zone. */
function edgeOfZone(state: GameState, zone: Zone, m: Model, to: Point): Point {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    if (within(state, zone, { ...m, x: m.x + (to.x - m.x) * t, y: m.y + (to.y - m.y) * t })) lo = t;
    else hi = t;
  }
  return { x: m.x + (to.x - m.x) * lo, y: m.y + (to.y - m.y) * lo };
}

/** How far a model's base reaches from its centre at most. */
const reachOf = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

/** What the game keeps the models it sets out itself off, besides solid terrain: houses, rocks, water, walls and markers. */
const AVOIDED: ReadonlySet<TerrainKind> = new Set(['building', 'rock', 'water', 'wall', 'gate', 'tower', 'objective']);

/**
 * The outlines models are never set up on: solid buildings and cliffs. With `auto` (models the game sets out itself)
 * also anything else it would be odd to put them on, from buildings with floors to rocks, streams and objective markers.
 */
export const solidOutlines = (state: Pick<GameState, 'terrain'>, auto = false) =>
  Object.values(state.terrain ?? {})
    .filter(t => isSolid(t) || (auto && !t.gone && !t.carrier && AVOIDED.has(t.kind)))
    .map(t => outline(t));

/** The nearest point to `p` (within `reach` inches) that `fits`, looking outwards in rings; null if there's none. */
export function nearestSpot(p: Point, fits: (q: Point) => boolean, reach = 6, step = 0.1): Point | null {
  if (fits(p)) return p;
  for (let r = step; r <= reach + 1e-9; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let i = 0; i < n; i++) {
      // (Starting on the side nearest the board's origin would bias every search the same way, so alternate sides.)
      const a = ((i % 2 ? -1 : 1) * Math.ceil(i / 2) * 2 * Math.PI) / n;
      const q = { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) };
      if (fits(q)) return q;
    }
  }
  return null;
}

/**
 * Places models as near as they fit to a point: wholly inside the zone and on the table, clear of other models (by
 * `gap`, a hair by default) and off buildings and cliffs. Used for a warband following one of its models into another zone, and for reinforcements.
 */
export function placeNear(state: GameState, mates: Model[], zone: Zone, near: Point, taken: Model[], gap: (o: Model) => number = () => 0.1): Move[] {
  const { w, h } = state.board;
  const solid = solidOutlines(state, true);
  const step = 0.25;
  const spots: (Point & { d: number })[] = [];
  for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) if (inZone(zone, { x, y })) spots.push({ x, y, d: Math.hypot(x - near.x, y - near.y) });
  spots.sort((a, b) => a.d - b.d);
  const radius = reachOf;
  const others = [...taken];
  const out: Move[] = [];
  for (const m of mates) {
    const r = radius(m);
    const at = spots.find(
      p =>
        within(state, zone, { ...m, x: p.x, y: p.y }) &&
        !onOutlines(solid, p, r) &&
        others.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= r + radius(o) + gap(o)),
    );
    // No room left: it stays where it is.
    if (!at) continue;
    out.push({ id: m.id, x: at.x, y: at.y });
    others.push({ ...m, x: at.x, y: at.y });
  }
  return out;
}

/** The moves of a drag before the battle, held inside each side's deployment zones, plus any warband that follows. */
export function holdInZones(state: GameState, moves: Move[]): Move[] {
  if (state.flow.started) return moves;
  // A narrative scenario's cast stays where its story puts it.
  if (state.narrative) return keepClear(state, moves.map(mv => holdNarrative(state, mv)), false);
  const out = new Map<string, Move>();
  for (const mv of moves) {
    const m = state.models[mv.id];
    const zones = m ? zonesOf(state, m.owner) : [];
    if (!m || !zones.length) {
      out.set(mv.id, mv);
      continue;
    }
    const dest = { ...m, x: mv.x, y: mv.y };
    const from = zoneOf(state, zones, m);
    // Into a zone, or a model not yet in one (placed by hand), goes where it's put; otherwise it stops at the edge.
    const to = zoneOf(state, zones, dest) >= 0 || from < 0 ? { x: mv.x, y: mv.y } : edgeOfZone(state, zones[from], m, mv);
    out.set(mv.id, { ...mv, ...to });
  }
  // A warband switching zones takes the rest of itself along.
  const moving = new Set(out.keys());
  const done = new Set<string>();
  for (const mv of out.values()) {
    const m = state.models[mv.id];
    if (!m?.warband || done.has(`${m.owner}:${m.warband}`)) continue;
    const zones = zonesOf(state, m.owner);
    if (zones.length < 2) continue;
    const there = zoneOf(state, zones, { ...m, x: mv.x, y: mv.y });
    const mates = Object.values(state.models).filter(o => o.owner === m.owner && o.warband === m.warband && !o.dead && !moving.has(o.id));
    const behind = mates.filter(o => zoneOf(state, zones, o) !== there);
    if (there < 0 || !behind.length) continue;
    done.add(`${m.owner}:${m.warband}`);
    const placed = Object.values(state.models).filter(o => !o.dead && !behind.includes(o) && !moving.has(o.id));
    const movedHere = [...out.values()].map(o => ({ ...state.models[o.id], x: o.x, y: o.y }));
    for (const g of placeNear(state, behind, zones[there], mv, [...placed, ...movedHere])) out.set(g.id, g);
  }
  // A siege engine deploys wholly within 6" of a table edge.
  for (const mv of out.values()) {
    const m = state.models[mv.id];
    if (m?.siege) Object.assign(mv, nearEdge(state, m, mv));
  }
  return keepClear(state, [...out.values()], true);
}

/**
 * Keeps models being set up off solid buildings and cliffs, and off each other: one put down where it doesn't fit
 * goes to the nearest spot that does (still in the same deployment zone), or, when `search` is off or there's
 * nowhere near, stays where it was.
 */
function keepClear(state: GameState, moves: Move[], search: boolean): Move[] {
  const models = { ...state.models };
  const solid = solidOutlines(state);
  return frontFirst(state, moves).map(mv => {
    const m = models[mv.id];
    if (!m || m.dead || m.waiting || m.escaped || m.aboard) return mv;
    const zones = zonesOf(state, m.owner);
    const zone = zoneOf(state, zones, { ...m, x: mv.x, y: mv.y });
    const now = { ...state, models };
    const r = reachOf(m);
    const fits = (p: Point) => {
      const there = { ...m, x: p.x, y: p.y };
      if (zone >= 0 && !within(state, zones[zone], there)) return false;
      if (m.siege && (Math.abs(nearEdge(state, m, p).x - p.x) > 1e-6 || Math.abs(nearEdge(state, m, p).y - p.y) > 1e-6)) return false;
      return !onOutlines(solid, p, r) && !crowded(now, m, p);
    };
    const asked = { x: mv.x, y: mv.y };
    const spot = (search ? nearestSpot(asked, fits) : fits(asked) ? asked : null) ?? { x: m.x, y: m.y };
    models[m.id] = { ...m, ...spot };
    return { ...mv, ...spot };
  });
}

/** Where `p` comes to for a siege engine to stand wholly within 6" of the nearest table edge. */
export function nearEdge(state: Pick<GameState, 'board'>, m: Model, p: Point): Point {
  const r = Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
  const { w, h } = state.board;
  const gaps = [p.x, w - p.x, p.y, h - p.y];
  const k = gaps.indexOf(Math.min(...gaps));
  if (gaps[k] + r <= 6) return { x: p.x, y: p.y };
  const at = Math.max(r, 6 - r);
  return k === 0 ? { x: at, y: p.y } : k === 1 ? { x: w - at, y: p.y } : k === 2 ? { x: p.x, y: at } : { x: p.x, y: h - at };
}
