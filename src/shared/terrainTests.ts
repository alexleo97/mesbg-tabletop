// Getting over terrain: the Jump, Climb and Leap tests a model needs to cross walls, rocks, cliffs and streams, and
// the falls when they go wrong.
import { modelStats, type Catalog } from './catalog.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { canActivate } from './heroics.ts';
import { engaged, moveLeft, settleMove } from './movement.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { climbedLevel, distanceToTerrain, heightOf, heightOfModel, insidePolygon, outline } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

export type CrossTest = 'Jump' | 'Climb' | 'Climb down' | 'Leap';

export interface Crossing {
  terrain: string;
  test: CrossTest;
  /** Where the model stops to take the test, and where it lands if it passes. */
  stop: Point;
  landing: Point;
  /** How far it would fall: the height it is above the ground it lands on (for a Climb down) or the gap's depth. */
  drop: number;
}

const radius = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
const isCavalryBase = (m: Model) => m.base.h > m.base.w;

/** Distance from a point to the nearest edge of a polygon. */
function edgeDistance(poly: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** The test needed to get over a rise or a wall of this height: none if it's no more than half the model's height. */
const testFor = (rise: number, tall: number): 'Jump' | 'Climb' | null => (rise <= tall / 2 + 1e-6 ? null : rise <= tall + 1e-6 ? 'Jump' : 'Climb');

/**
 * The first piece of terrain on a model's way from `from` to `to` that it needs a test to get over, and hasn't passed
 * one for this turn: a wall more than half its height, a rock, cliff or building to climb up or down more than its
 * own height, or a narrow stream it could leap. Null if the way is clear.
 */
export function crossingAhead(state: GameState, m: Model, from: Point, to: Point): Crossing | null {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 1e-6) return null;
  const passed = new Set(state.flow.crossed?.[m.id] ?? []);
  const r = radius(m);
  const tall = heightOfModel(m);
  const ux = (to.x - from.x) / d;
  const uy = (to.y - from.y) / d;
  const along = (t: number): Point => ({ x: from.x + ux * t, y: from.y + uy * t });
  // Only pieces near the path matter: a box round it, widened by the largest piece.
  const near = (t: Terrain) => {
    const reach = Math.max(t.w, t.h) / 2 + r + 0.5;
    return t.x > Math.min(from.x, to.x) - reach && t.x < Math.max(from.x, to.x) + reach && t.y > Math.min(from.y, to.y) - reach && t.y < Math.max(from.y, to.y) + reach;
  };
  const pieces = Object.values(state.terrain).filter(t => !passed.has(t.id) && !t.gone && near(t));
  if (!pieces.length) return null;
  const walls = pieces.filter(t => t.kind === 'wall' && testFor(heightOf(t), tall)).map(t => ({ t, poly: outline(t) }));
  const water = pieces.filter(t => t.kind === 'water').map(t => ({ t, poly: outline(t) }));
  const climbed = pieces.filter(t => (t.kind === 'rock' || t.kind === 'cliff' || (t.kind === 'building' && !t.floors)) && heightOf(t) > 0).map(t => ({ t, poly: outline(t), top: heightOf(t) }));
  if (!walls.length && !water.length && !climbed.length) return null;
  const overlaps = (poly: Point[], p: Point) => insidePolygon(poly, p) || edgeDistance(poly, p) < r - 0.01;
  const startOn = new Set(walls.filter(w => overlaps(w.poly, from)).map(w => w.t.id));
  const levelOf = (p: Point) => {
    let h = 0;
    for (const c of climbed) if (c.top > h && insidePolygon(c.poly, p)) h = c.top;
    return h;
  };
  const steps = Math.ceil(d / 0.05);
  let prevLevel = levelOf(from);
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * d;
    const p = along(t);
    // A wall: stop with the base touching it, land just clear of it on the far side.
    for (const w of walls) {
      if (startOn.has(w.t.id) || !overlaps(w.poly, p)) continue;
      let k = t;
      while (k < d + r * 2 + 4 && overlaps(w.poly, along(k))) k += 0.05;
      return { terrain: w.t.id, test: testFor(heightOf(w.t), tall)!, stop: along(Math.max(0, t - 0.06)), landing: along(k + 0.02), drop: 0 };
    }
    // A stream narrow enough to leap (no wider than twice the model's height), when the move goes right across it.
    for (const w of water) {
      if (insidePolygon(w.poly, along(t - 0.05)) || !insidePolygon(w.poly, p)) continue;
      let k = t;
      while (k < d && insidePolygon(w.poly, along(k))) k += 0.05;
      if (k >= d || k - t > tall * 2) continue;
      return { terrain: w.t.id, test: 'Leap', stop: along(Math.max(0, t - r - 0.02)), landing: along(k + r + 0.02), drop: 0 };
    }
    // Up or down a rock, cliff or building.
    const level = levelOf(p);
    if (Math.abs(level - prevLevel) > 1e-6) {
      const piece = climbed.filter(c => insidePolygon(c.poly, level > prevLevel ? p : along(t - 0.05))).sort((a, b) => b.top - a.top)[0]?.t;
      if (level > prevLevel) {
        const test = testFor(level - prevLevel, tall);
        if (test && piece) return { terrain: piece.id, test, stop: along(Math.max(0, t - r - 0.01)), landing: along(t + r + 0.02), drop: prevLevel };
      } else if (prevLevel - level > tall + 1e-6 && piece) {
        return { terrain: piece.id, test: 'Climb down', stop: along(Math.max(0, t - 0.06)), landing: along(t + r + 0.02), drop: prevLevel - level };
      }
      prevLevel = level;
    }
  }
  return null;
}

/**
 * Why a model can't take the test in front of it now; unset if it can. A jump or leap needs the Move to reach the
 * far side; a climb takes whatever Move is left (the climb itself is counted double, as difficult ground).
 */
export function crossBlocked(state: GameState, m: Model, c: Crossing): string | undefined {
  if ((c.test === 'Climb' || c.test === 'Climb down') && isCavalryBase(m)) return 'Cavalry can’t climb';
  if (m.prone) return 'A Prone model can’t jump, leap or climb';
  if (engaged(state, m)) return 'It is in a fight';
  // An enemy defending a wall stops anyone crossing it within its reach (1"), unless it's already in a fight.
  const t = state.terrain[c.terrain];
  if (t?.kind === 'wall') {
    const guard = Object.values(state.models).find(e => e.owner !== m.owner && !e.dead && !e.waiting && !e.escaped && !e.prone && Math.abs(e.x - c.stop.x) < 4 && Math.abs(e.y - c.stop.y) < 4 && distanceToTerrain(e, t) <= 0.2 && (distanceBetween({ ...m, ...c.stop }, e) < 1 || distanceBetween({ ...m, ...c.landing }, e) < 1) && !engaged(state, e));
    if (guard) return `${guard.name} is defending the wall here: charge it instead`;
  }
  const left = moveLeft(state, m) ?? Infinity;
  if (c.test === 'Jump' || c.test === 'Leap') {
    if (Math.hypot(c.landing.x - c.stop.x, c.landing.y - c.stop.y) > left + 1e-6) return c.test === 'Leap' ? 'Not enough Move left to reach the far side' : 'Not enough Move left to get over';
  } else if (left < 0.25) return 'No Move left to climb';
  return undefined;
}

const NAMES: Record<string, string> = { wall: 'wall', rock: 'rocks', cliff: 'cliff', building: 'building', water: 'stream' };
export const terrainName = (t: Terrain | undefined) => (t ? (NAMES[t.kind] ?? t.kind) : 'obstacle');

/** S3 hits for a fall further than the model's own height: one, and another for each full inch beyond it. */
export const fallingHits = (m: Model, drop: number) => (drop > heightOfModel(m) + 1e-6 ? 1 + Math.floor(drop - heightOfModel(m) + 1e-6) : 0);

/**
 * Rolls the Strength 3 hits for a fall (see fallingHits) with `push`, and returns the wounds they cause.
 */
export function fallDamage(catalog: Catalog | null, m: Model, fall: number, d6: () => number, push: (label: string, dice: number[], extra?: Partial<DiceRoll>) => void, group: string): Action[] {
  const hits = fallingHits(m, fall);
  const need = woundNeed(3, modelStats(catalog, m)?.D ?? 4);
  if (!hits || !need) return [];
  const dice = Array.from({ length: hits }, d6);
  const follow = need.then ? dice.filter(x => x >= need.target).map(d6) : undefined;
  push(`Falling: ${hits} S3 hit${hits === 1 ? '' : 's'} on ${m.name} (${formatNeed(need)})`, dice, { target: need.target, against: m.id, ...(need.then ? { then: need.then, follow } : {}) });
  const wounds = (need.then && follow ? follow.filter(x => x >= need.then!) : dice.filter(x => x >= need.target)).length;
  return wounds ? [{ type: 'wound', id: m.id, count: wounds, how: 'other', group }] : [];
}

/**
 * Rolls the test for the crossing a model is stopped at. 1 fails (a climber falls and is Prone, a leaper falls into the
 * gap), 2-5 gets over and ends the model's move (unless it lands close enough to charge), 6 gets over and it may
 * carry on.
 */
export function resolveCross(state: GameState, seat: Seat, id: string, d6: () => number, uid: () => string, now: number, catalog: Catalog | null): Action[] | null {
  const m = state.models[id];
  const b = m && state.flow.blocked?.[id];
  if (!m || !b || m.owner !== seat || state.phase !== 'move' || !state.flow.started || !canActivate(state, seat) || state.flow.stopped?.includes(id)) return null;
  if (Math.hypot(m.x - b.stop[0], m.y - b.stop[1]) > 0.1) return null;
  const c: Crossing = { terrain: b.terrain, test: b.test, stop: { x: b.stop[0], y: b.stop[1] }, landing: { x: b.landing[0], y: b.landing[1] }, drop: b.drop };
  if (crossBlocked(state, m, c)) return null;
  const t = state.terrain[c.terrain];
  const group = `x-${uid()}`;
  const roll = d6();
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) => rolls.push({ id: `${group}-${rolls.length}`, by: seat, label: label.slice(0, 80), dice, at: now, group, ...extra });
  push(`${m.name}: ${c.test} test, ${terrainName(t)} (1 fails, 6 carries on)`, [roll], { model: m.id });
  const out: Action[] = [];
  // The model is put where the test takes it (the Move it costs is counted from where it began the phase).
  const place = (p: Point): Action => ({ type: 'affect', id: m.id, patch: { x: p.x, y: p.y } });
  if (roll === 1) {
    let fall = 0;
    if (c.test === 'Climb down') {
      // Falls from the top to the ground below.
      out.push(place(c.landing));
      fall = c.drop;
    } else if (c.test === 'Leap') {
      // Falls into the gap, halfway across.
      out.push(place({ x: (c.stop.x + c.landing.x) / 2, y: (c.stop.y + c.landing.y) / 2 }));
      fall = Math.max(0, climbedLevel(state, c.stop) - climbedLevel(state, c.landing));
    }
    rolls[0].note = c.test === 'Jump' ? `${m.name} stumbles at the ${terrainName(t)}` : `${m.name} falls and is Prone`;
    out.push({ type: 'crossed', id: m.id, stop: true });
    if (c.test !== 'Jump') out.push({ type: 'affect', id: m.id, patch: { prone: true } });
    out.push(...fallDamage(catalog, m, fall, d6, push, group));
    return [...rolls.map((r): Action => ({ type: 'rolled', roll: r })), ...out];
  }
  const way = c.test === 'Leap' ? 'across' : c.test === 'Climb' ? 'up' : c.test === 'Climb down' ? 'down' : 'over';
  rolls[0].note = roll === 6 ? `${m.name} gets ${way} and may carry on` : `${m.name} gets ${way}; its move ends`;
  out.push({ type: 'crossed', id: m.id, terrain: c.terrain }, place(c.landing));
  // Landing within 1" of an enemy it can reach, it goes on to charge the nearest; otherwise a 2-5 ends its move.
  const after: GameState = { ...state, models: { ...state.models, [m.id]: { ...m, ...c.landing } }, flow: { ...state.flow, crossed: { ...state.flow.crossed, [m.id]: [...(state.flow.crossed?.[m.id] ?? []), c.terrain] } } };
  const settled = settleMove(after, after.models[m.id], c.landing);
  if (settled.x !== c.landing.x || settled.y !== c.landing.y) out.push({ type: 'moveModels', moves: [{ id: m.id, x: settled.x, y: settled.y }] });
  if (roll < 6) out.push({ type: 'crossed', id: m.id, stop: true });
  return [...rolls.map((r): Action => ({ type: 'rolled', roll: r })), ...out];
}

/** Whether a model is standing where it was stopped for a test, so the card can offer it. */
export const atCrossing = (state: GameState, m: Model) => {
  const b = state.flow.blocked?.[m.id];
  return b && Math.hypot(m.x - b.stop[0], m.y - b.stop[1]) <= 0.1 && !state.flow.stopped?.includes(m.id) ? b : undefined;
};
