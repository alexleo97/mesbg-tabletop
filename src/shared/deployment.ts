import { halfExtents, type Point } from './geometry.ts';
import { inZone, whollyIn, zonesOf } from './objects.ts';
import type { Zone } from './scenarios.ts';
import { insidePolygon, outline } from './sight.ts';
import type { GameState, Model } from './types.ts';

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

/**
 * Places models as near as they fit to a point: wholly inside the zone and on the table, clear of other models (by
 * `gap`, a hair by default) and off buildings and cliffs. Used for a warband following one of its models into another zone, and for reinforcements.
 */
export function placeNear(state: GameState, mates: Model[], zone: Zone, near: Point, taken: Model[], gap: (o: Model) => number = () => 0.1): Move[] {
  const { w, h } = state.board;
  const solid = Object.values(state.terrain).filter(t => t.kind === 'building' || t.kind === 'cliff').map(t => outline(t));
  const step = 0.25;
  const spots: (Point & { d: number })[] = [];
  for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) if (inZone(zone, { x, y })) spots.push({ x, y, d: Math.hypot(x - near.x, y - near.y) });
  spots.sort((a, b) => a.d - b.d);
  const radius = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
  const others = [...taken];
  const out: Move[] = [];
  for (const m of mates) {
    const r = radius(m);
    const at = spots.find(
      p =>
        within(state, zone, { ...m, x: p.x, y: p.y }) &&
        !solid.some(poly => insidePolygon(poly, p)) &&
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
  return [...out.values()];
}
