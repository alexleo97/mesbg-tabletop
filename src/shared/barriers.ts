// Defended positions. A model behind a wall, on a ledge or in a narrow doorway can hold it against one attacker at a
// time: they fight across the wall (or up the ledge) as if in base contact, the attacker's strikes each need an In the
// Way roll, and the defender never backs away. If the defender falls, the attacker takes its place.
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { CONTACT_SLACK } from './flow.ts';
import { ladderAt } from './fortress.ts';
import { climbedLevel, distanceToTerrain, heightOf, heightOfModel, insidePolygon, outline, standingAt } from './sight.ts';
import type { GameState, Model, Terrain } from './types.ts';

const radius = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
/** Two models touching opposite sides of a wall are at most this far apart, even placed a little off to one side. */
const REACH = 1.3;
const near = (a: Point, b: Point, d: number) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;
const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;
/** How high a model stands on something it climbed: a rock, cliff or building (or its floor); hills are gentle slopes. */
const levelOf = (state: GameState, m: Model) => (m.floor ? standingAt(state, m) : climbedLevel(state, m));

/** Whether the straight line between two points passes through a polygon. */
function crosses(poly: Point[], a: Point, b: Point): boolean {
  for (let i = 1; i < 20; i++) if (insidePolygon(poly, { x: a.x + ((b.x - a.x) * i) / 20, y: a.y + ((b.y - a.y) * i) / 20 })) return true;
  return false;
}

/** The wall two models are fighting across: both touch it, from opposite sides. */
export function wallBetween(state: GameState, a: Model, b: Model): Terrain | undefined {
  if (!near(a, b, REACH + 4)) return undefined;
  const d = distanceBetween(a, b);
  if (d <= CONTACT_SLACK || d > REACH) return undefined;
  for (const t of Object.values(state.terrain)) {
    if (t.kind !== 'wall' || t.gone || !near(t, a, Math.max(t.w, t.h) / 2 + 3)) continue;
    if (distanceToTerrain(a, t) > CONTACT_SLACK || distanceToTerrain(b, t) > CONTACT_SLACK) continue;
    // Nobody reaches the top of a sheer wall from its foot without a Siege Ladder or a siege tower's ramp.
    if (t.sheer && !ladderAt(state, t.id, a) && !ladderAt(state, t.id, b)) continue;
    if (crosses(outline(t), a, b)) return t;
  }
  return undefined;
}

/**
 * Whether two enemies are in base contact for fighting: bases touching (on the same floor, and neither stood higher
 * above the other than its own height), or both touching a wall from opposite sides.
 */
export function touching(state: GameState, a: Model, b: Model): boolean {
  // Those riding a war beast are never in a fight: the beast fights.
  if (a.aboard || b.aboard || !near(a, b, 5)) return false;
  if (distanceBetween(a, b) <= CONTACT_SLACK) {
    if (!a.floor && !b.floor && !hasHeight(state)) return true;
    const lift = levelOf(state, a) - levelOf(state, b);
    if ((a.floor || b.floor) && Math.abs(lift) >= 0.5) return false;
    // A model can't reach one standing higher above it than its own height.
    return Math.abs(lift) <= heightOfModel(lift > 0 ? b : a) + 1e-6;
  }
  return !!wallBetween(state, a, b);
}

/** Whether any terrain on the table raises a model off the ground (so heights need checking at all). */
const hasHeight = (state: GameState) => Object.values(state.terrain).some(t => t.kind === 'rock' || t.kind === 'cliff' || t.kind === 'building');

/** The living enemies a model is fighting: in base contact, or across a wall. */
/** Enemies in base contact with a model, that it is fighting (a siege engine fights no one). */
export const touchingEnemies = (state: GameState, m: Model) => (m.siege ? [] : Object.values(state.models).filter(e => e.owner !== m.owner && !e.siege && alive(e) && near(e, m, 5) && touching(state, m, e)));

export type DefenceKind = 'wall' | 'height' | 'doorway';
export interface Defence {
  defender: string;
  attacker: string;
  how: DefenceKind;
  /** What it defends, for the fight card: "the wall", "the high ground" or "the doorway". */
  name: string;
}

/** Terrain that closes off the sides of a doorway for a model of this height. */
const shuts = (t: Terrain, tall: number) => !t.gone && (t.kind === 'building' || t.kind === 'cliff' || ((t.kind === 'wall' || t.kind === 'rock' || t.kind === 'ruin') && heightOf(t) >= tall / 2));

/** How far along a ray from `p` the nearest edge of such terrain is (up to `max`). */
function rayTo(state: GameState, p: Point, dir: Point, tall: number, max: number): number {
  let best = max;
  for (const t of Object.values(state.terrain)) {
    if (!shuts(t, tall) || !near(t, p, Math.max(t.w, t.h) / 2 + max)) continue;
    const poly = outline(t);
    if (insidePolygon(poly, p)) continue;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = dir.x * ey - dir.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const s = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
      const u = ((a.x - p.x) * dir.y - (a.y - p.y) * dir.x) / den;
      if (s > 0 && u >= 0 && u <= 1 && s < best) best = s;
    }
  }
  return best;
}

/**
 * Whether `d` holds a doorway against `x`: terrain closes in on both its sides, so near that `x` can't get past
 * without touching it, and too narrow for a second model to stand beside it.
 */
export function inDoorway(state: GameState, d: Model, x: Model): boolean {
  const len = Math.hypot(d.x - x.x, d.y - x.y);
  if (len < 1e-6) return false;
  const side = { x: -(d.y - x.y) / len, y: (d.x - x.x) / len };
  const rd = radius(d);
  const rx = radius(x);
  const tall = heightOfModel(x);
  const left = rayTo(state, d, side, tall, 4 * rd + 1);
  const right = rayTo(state, d, { x: -side.x, y: -side.y }, tall, 4 * rd + 1);
  return left - rd < 2 * rx && right - rd < 2 * rx && left + right < 4 * rd;
}

/** What `d` defends against `x`, if anything: a wall at least half `x`'s height that `d` can see over, a ledge, or a doorway. */
function defends(state: GameState, d: Model, x: Model): { how: DefenceKind; name: string } | null {
  if (d.prone) return null;
  const tall = heightOfModel(x);
  const w = wallBetween(state, d, x);
  if (w) {
    const h = heightOf(w);
    return h >= tall / 2 - 1e-6 && h < heightOfModel(d) ? { how: 'wall', name: 'the wall' } : null;
  }
  if (distanceBetween(d, x) > CONTACT_SLACK || !touching(state, d, x)) return null;
  const lift = levelOf(state, d) - levelOf(state, x);
  if (lift >= tall / 2 - 1e-6) return { how: 'height', name: 'the high ground' };
  if (lift > -tall / 2 && inDoorway(state, d, x)) return { how: 'doorway', name: 'the doorway' };
  return null;
}

/**
 * The defended position in a fight, if there is one: a lone model against a lone attacker it is holding a wall, a
 * ledge or a doorway against. A defender attacked from its own side as well, or an attacker fought from its own
 * side too, fights as normal. The model that was charged defends; otherwise the side without Priority does.
 */
export function defence(state: GameState, sides: [string[], string[]]): Defence | null {
  if (sides[0].length !== 1 || sides[1].length !== 1) return null;
  const a = state.models[sides[0][0]];
  const b = state.models[sides[1][0]];
  if (!a || !b || !alive(a) || !alive(b)) return null;
  const order = state.flow.charges?.[a.id] === b.id ? [b, a] : state.flow.charges?.[b.id] === a.id ? [a, b] : state.priority === b.owner ? [a, b] : [b, a];
  for (const [d, x] of [order, [order[1], order[0]]]) {
    const held = defends(state, d, x);
    if (!held) continue;
    // Attacked from both sides: any other enemy touching either of them takes the protection away.
    if (touchingEnemies(state, d).some(e => e.id !== x.id) || touchingEnemies(state, x).some(e => e.id !== d.id)) return null;
    return { defender: d.id, attacker: x.id, ...held };
  }
  return null;
}

/**
 * Whether a model standing at `p` would be a second attacker on a model defending a wall or a ledge against it,
 * which isn't allowed: only one model may charge a defender over a barrier.
 */
export function secondAttacker(state: GameState, m: Model, p: Point): Model | undefined {
  const here = { ...m, ...p };
  for (const e of touchingEnemies(state, here)) {
    const held = defends(state, e, here);
    if (!held || held.how === 'doorway') continue;
    if (touchingEnemies(state, e).some(o => o.id !== m.id && o.owner === m.owner && defends(state, e, o)?.how === held.how)) return e;
  }
  return undefined;
}

/** Whether a base at `p` sits clear of a polygon (not over it at all). */
function clearOf(poly: Point[], p: Point, r: number): boolean {
  if (insidePolygon(poly, p)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < r - 0.01) return false;
  }
  return true;
}

/**
 * Where a model charging `e` across a wall stands: touching the wall on its own side, as close to `e` as it can get
 * (and, of the closest spots, the one nearest `from`). Null if there's no wall between them or no room.
 */
export function overWallSpot(state: GameState, m: Model, e: Model, from: Point): Point | null {
  const wall = Object.values(state.terrain).find(t => t.kind === 'wall' && !t.gone && near(t, e, Math.max(t.w, t.h) / 2 + 3) && distanceToTerrain(e, t) <= CONTACT_SLACK && crosses(outline(t), from, e));
  if (!wall) return null;
  const poly = outline(wall);
  const r = radius(m);
  const others = Object.values(state.models).filter(o => o.id !== m.id && o.id !== e.id && alive(o) && near(o, e, 4));
  let best: { p: Point; d: number; far: number } | null = null;
  for (let deg = 0; deg < 360; deg += 5) {
    const ux = Math.cos((deg * Math.PI) / 180);
    const uy = Math.sin((deg * Math.PI) / 180);
    for (let k = radius(e) + r; k < radius(e) + r + REACH; k += 0.02) {
      const p = { x: e.x + ux * k, y: e.y + uy * k };
      if (!clearOf(poly, p, r)) continue;
      // The first clear spot along this line: on the far side of the wall from `e`, touching it.
      const at = { ...m, ...p };
      if (crosses(poly, p, e) && !others.some(o => distanceBetween(at, o) < 0.01) && !wallSideCrossed(poly, from, p) && wallBetween(state, at, e)) {
        const d = distanceBetween(at, e);
        const far = Math.hypot(p.x - from.x, p.y - from.y);
        if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && far < best.far)) best = { p, d, far };
      }
      break;
    }
  }
  return best && { x: Math.round(best.p.x * 1000) / 1000, y: Math.round(best.p.y * 1000) / 1000 };
}

/** Whether getting from `a` to `b` means going over the wall. */
const wallSideCrossed = (poly: Point[], a: Point, b: Point) => crosses(poly, a, b);
