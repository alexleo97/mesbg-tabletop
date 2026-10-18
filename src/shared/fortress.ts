import { mounted } from './cavalry.ts';
import { halfExtents, type Point } from './geometry.ts';
import { carriedBy, onTable, touching as touchingMarker } from './objects.ts';
import { distanceToTerrain, heightOf, insidePolygon, outline } from './sight.ts';
import type { DoorType, GameState, Model, Seat, Terrain } from './types.ts';

// Fortresses: gates and doors that keep attackers out until they are battered down, Siege Ladders raised against the
// walls, and battering rams. Ladders, rams and wounded allies are Heavy Objects, which slow whoever carries them.

/** Each kind of gate or door, how hard it is to break and how much it takes. */
export const DOORS: Record<DoorType, { name: string; d: number; w: number }> = {
  castle: { name: 'Fortress gate', d: 10, w: 3 },
  dwarven: { name: 'Dwarven door', d: 9, w: 3 },
  heavyArmoured: { name: 'Heavy armoured door', d: 9, w: 2 },
  armoured: { name: 'Armoured door', d: 8, w: 2 },
  heavy: { name: 'Heavy door', d: 7, w: 2 },
  external: { name: 'Outer door', d: 6, w: 2 },
  internal: { name: 'Inner door', d: 5, w: 1 },
};

/** A Siege Ladder or battering ram lying on the ground can be broken too. */
const GEAR: Partial<Record<string, { d: number; w: number }>> = { ladder: { d: 8, w: 2 }, ram: { d: 8, w: 3 } };

export const HEAVY = new Set(['ally', 'ladder', 'ram', 'oil']);

/** A siege tower: Defence 10 and 4 Wounds, pushed 6" by six models on foot (and one more for each model aboard). */
export const TOWER = { d: 10, w: 4, move: 6, crew: 6 };

export const isGate = (t: Terrain) => t.kind === 'gate';
/** A gate or door still standing: one that's been broken down is open to everyone. */
export const gateStanding = (t: Terrain) => isGate(t) && !t.gone;
/** A standing gate keeps out everyone but the side holding it, who open it and shut it behind them as they go. */
export const shutTo = (t: Terrain, seat: Seat) => gateStanding(t) && t.side !== seat;

/** What can be struck at, shot at or battered: a gate or door, a siege tower, a barricade, or a ladder or ram not being carried. */
export function breakable(t: Terrain | undefined): { name: string; d: number; w: number; left: number; trapped: boolean } | undefined {
  if (!t || t.gone) return undefined;
  if (isGate(t)) {
    const kind = DOORS[t.door ?? 'castle'];
    return { name: kind.name, d: kind.d, w: kind.w, left: t.wounds ?? kind.w, trapped: true };
  }
  if (t.kind === 'tower') return { name: 'Siege tower', d: TOWER.d, w: TOWER.w, left: t.wounds ?? TOWER.w, trapped: false };
  if (t.kind === 'wall' && t.barricade) return { name: t.barricade === 'spiked' ? 'Spiked barricade' : 'Barricade', d: 7, w: 2, left: t.wounds ?? 2, trapped: false };
  const gear = t.kind === 'objective' && t.object ? GEAR[t.object] : undefined;
  if (!gear || t.carrier) return undefined;
  return { name: t.object === 'ram' ? 'Battering ram' : 'Siege Ladder', ...gear, left: t.wounds ?? gear.w, trapped: false };
}

/** Whether something belongs to the enemy of `seat` (a gate held by no one can be attacked by either side). */
export const enemyOf = (t: Terrain, seat: Seat) => t.side !== seat;

const radius = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

/** How far a point is from the nearest edge of a polygon. */
function edgeDistance(poly: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy)));
  }
  return best;
}

/** The point on a piece's outline nearest to `p`. */
export function nearestEdge(t: Terrain, p: Point): Point {
  const poly = outline(t);
  let best = { d: Infinity, x: p.x, y: p.y };
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const q = { x: a.x + k * dx, y: a.y + k * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, ...q };
  }
  return { x: best.x, y: best.y };
}

/** Whether a model's base, put at `p`, would overlap a piece (rather than just touch it). */
export function overlapsPiece(m: Model, t: Terrain, p: Point): boolean {
  const poly = outline(t);
  return insidePolygon(poly, p) || edgeDistance(poly, p) < radius(m) - 0.05;
}

/** The gates near a move that are shut to the model making it. */
export const shutGates = (state: GameState, m: Model, from: Point, to: Point) =>
  Object.values(state.terrain).filter(t => {
    if (!shutTo(t, m.owner)) return false;
    const reach = Math.max(t.w, t.h) / 2 + radius(m) + 0.5;
    return t.x > Math.min(from.x, to.x) - reach && t.x < Math.max(from.x, to.x) + reach && t.y > Math.min(from.y, to.y) - reach && t.y < Math.max(from.y, to.y) + reach;
  });

/** Base contact with a gate, with a little slack for dragging by hand. */
export const atGate = (m: Model, t: Terrain) => distanceToTerrain(m, t) <= 0.25;

/** How far a marker (a ram) is from a piece's outline. */
export const markerToPiece = (marker: Terrain, t: Terrain) => {
  const poly = outline(t);
  return insidePolygon(poly, marker) ? 0 : Math.max(0, edgeDistance(poly, marker) - Math.max(marker.w, marker.h) / 2);
};

/** Terrain a Siege Ladder can be raised against: walls and anything else with height to climb. */
export const ladderable = (t: Terrain) => !t.gone && (t.kind === 'wall' || t.kind === 'building' || t.kind === 'rock' || t.kind === 'cliff' || t.kind === 'ruin') && heightOf(t) > 0;

/** The raised Siege Ladders against a piece of terrain. */
export const laddersOn = (state: GameState, pieceId: string) => onTable(state).filter(t => t.object === 'ladder' && t.raised === pieceId);

/** Whether a raised Siege Ladder against this piece is within 1" of a point, so a model there can climb it freely. */
export const ladderAt = (state: GameState, pieceId: string, p: Point, r = 0) =>
  laddersOn(state, pieceId).some(l => Math.hypot(l.x - p.x, l.y - p.y) <= 1 + r + l.w / 2) || towersOn(state, pieceId).some(t => fromPiece(t, p) <= 1 + r);

/** Siege towers whose ramp is down on a piece of terrain: those aboard cross onto it freely. */
export const towersOn = (state: GameState, pieceId: string) => Object.values(state.terrain).filter(t => t.kind === 'tower' && !t.gone && t.raised === pieceId);

/** How far a point is from a piece (0 inside it). */
export const fromPiece = (t: Terrain, p: Point) => {
  const poly = outline(t);
  return insidePolygon(poly, p) ? 0 : edgeDistance(poly, p);
};

/** The models in or on a siege tower: standing within its walls. */
export const aboard = (state: GameState, tower: Terrain) => Object.values(state.models).filter(m => !m.dead && !m.waiting && !m.escaped && insidePolygon(outline(tower), m));

/**
 * The models able to push a siege tower: friends on foot touching it from outside, out of any fight and with their
 * move not yet ended, and how many it needs (six, a monster counting as six, and one more for each model aboard).
 */
export function towerPushers(state: GameState, tower: Terrain, seat: Seat, inFight: (m: Model) => boolean): { by: Model[]; need: number; have: number } {
  const riders = new Set(aboard(state, tower).map(m => m.id));
  const by = Object.values(state.models).filter(m => m.owner === seat && !riders.has(m.id) && !m.dead && !m.waiting && !m.escaped && !m.siege && !m.prone && !mounted(m) && !state.flow.stopped?.includes(m.id) && distanceToTerrain(m, tower) <= 0.25 && !inFight(m));
  // (A monster is marked as carrying heavy loads at full speed, and stands on a big base.)
  const have = by.reduce((n, m) => n + (m.ground?.includes('burly') && m.base.w >= 40 ? TOWER.crew : 1), 0);
  return { by, need: TOWER.crew + riders.size, have };
}

/**
 * Where a siege tower pushed towards `to` ends up: at most 6", stopping short of the models and terrain in its way, and
 * its ramp coming down on a wall it reaches. Null if it can't be pushed at all.
 */
export function towerMove(state: GameState, tower: Terrain, seat: Seat, to: Point, inFight: (m: Model) => boolean): { at: Point; onto?: string; carry: string[] } | null {
  if (tower.gone || tower.raised || (tower.side && tower.side !== seat) || !state.flow.started || state.phase !== 'move' || state.flow.breached?.includes(tower.id)) return null;
  const crew = towerPushers(state, tower, seat, inFight);
  if (crew.have < crew.need) return null;
  const riders = aboard(state, tower);
  const skip = new Set([...riders, ...crew.by].map(m => m.id));
  let d = Math.hypot(to.x - tower.x, to.y - tower.y);
  if (d < 0.05) return null;
  const ux = (to.x - tower.x) / d;
  const uy = (to.y - tower.y) / d;
  d = Math.min(d, TOWER.move);
  const others = Object.values(state.models).filter(m => !skip.has(m.id) && !m.dead && !m.waiting && !m.escaped);
  const solid = Object.values(state.terrain).filter(t => t.id !== tower.id && !t.gone && (ladderable(t) || t.kind === 'gate' || t.kind === 'tower' || t.kind === 'water'));
  const blocked = (p: Point) => {
    const moved = { ...tower, ...p };
    const poly = outline(moved);
    if (others.some(m => insidePolygon(poly, m) || edgeDistance(poly, m) < radius(m) - 0.05)) return true;
    return solid.some(t => {
      const q = outline(t);
      return poly.some(c => insidePolygon(q, c)) || q.some(c => insidePolygon(poly, c)) || edgeSamples(poly).some(c => insidePolygon(q, c));
    });
  };
  let at = { x: tower.x, y: tower.y };
  for (let k = 0.05; k <= d + 1e-6; k += 0.05) {
    const p = { x: tower.x + ux * k, y: tower.y + uy * k };
    if (blocked(p)) break;
    at = p;
  }
  if (Math.hypot(at.x - tower.x, at.y - tower.y) < 0.05) return null;
  const moved = { ...tower, ...at };
  const edge = edgeSamples(outline(moved));
  const wall = Object.values(state.terrain).find(t => ladderable(t) && edge.some(c => fromPiece(t, c) <= 0.3));
  return { at, onto: wall?.id, carry: [...riders, ...crew.by].map(m => m.id) };
}

/** Points along a polygon's edges, for overlap checks between pieces. */
function edgeSamples(poly: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) for (let k = 1; k < 4; k++) out.push({ x: poly[j].x + ((poly[i].x - poly[j].x) * k) / 4, y: poly[j].y + ((poly[i].y - poly[j].y) * k) / 4 });
  return out;
}

/**
 * Raises any Siege Ladder whose carrier has reached a wall: it's propped against the wall where the carrier touches
 * it, and anyone may climb it.
 */
export function raiseLadders(state: GameState): GameState {
  let terrain = state.terrain;
  for (const l of onTable(state)) {
    if (l.object !== 'ladder' || !l.carrier) continue;
    const m = state.models[l.carrier];
    if (!m || m.dead || m.escaped) continue;
    const wall = Object.values(state.terrain).filter(t => ladderable(t) && distanceToTerrain(m, t) <= 0.25).sort((a, b) => heightOf(b) - heightOf(a))[0];
    if (!wall) continue;
    const at = nearestEdge(wall, m);
    const { carrier: _c, ...rest } = l;
    terrain = { ...terrain, [l.id]: { ...rest, x: at.x, y: at.y, raised: wall.id, side: m.owner } };
  }
  return terrain === state.terrain ? state : { ...state, terrain };
}

/**
 * Where a model climbing a ladder at `p` is headed: over a wall to `by` inches beyond its far face, or up onto the
 * top of anything else.
 */
export function overThe(t: Terrain, p: Point, by = 1): Point {
  if (t.kind !== 'wall' && t.kind !== 'ruin') return { x: t.x, y: t.y };
  const a = (t.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  let lx = dx * c + dy * s;
  let ly = -dx * s + dy * c;
  // Across the wall's thin side.
  if (t.h <= t.w) ly = -Math.sign(ly || 1) * (t.h / 2 + by);
  else lx = -Math.sign(lx || 1) * (t.w / 2 + by);
  return { x: t.x + lx * c - ly * s, y: t.y + lx * s + ly * c };
}

/** Friends of the carrier also touching the Heavy Object it carries, who share the load. */
export const helpers = (state: GameState, carrier: Model, t: Terrain) =>
  Object.values(state.models).filter(f => f.id !== carrier.id && f.owner === carrier.owner && !f.dead && !f.waiting && !f.escaped && !f.siege && !mounted(f) && touchingMarker(f, t));

/**
 * Whether a model's Move is halved for the Heavy Object it carries: unless it's Burly or a monster, or a friend also
 * touching the object helps carry it.
 */
export function laden(state: GameState, m: Model): boolean {
  if (m.ground?.includes('burly')) return false;
  return carriedBy(state, m).some(t => HEAVY.has(t.object!) && !helpers(state, m, t).length);
}

/** Who swings a battering ram: the friends touching it (at least two, on foot and not in a fight). */
export function ramCrew(state: GameState, ram: Terrain, seat: Seat, inFight: (m: Model) => boolean): Model[] {
  return Object.values(state.models).filter(f => f.owner === seat && !f.dead && !f.waiting && !f.escaped && !f.siege && !f.prone && !mounted(f) && touchingMarker(f, ram) && !inFight(f));
}

/** The standing enemy gate a ram is up against, if any. */
// (The marker stands for a long log, so it reaches a little further than its size.)
export const ramGate = (state: GameState, ram: Terrain, seat: Seat) => Object.values(state.terrain).find(t => gateStanding(t) && enemyOf(t, seat) && markerToPiece(ram, t) <= 0.6);

/** How a gate, ladder or ram works, in a line or two for its tooltip. */
export function fortressNotes(t: Terrain): string[] {
  if (isGate(t)) {
    const b = breakable(t);
    if (!b) return ['Broken down: models from either side can go through.'];
    return [
      `Defence ${b.d}, ${b.left} of ${b.w} Wounds left. ${t.side ? 'Its own side goes through freely; it keeps the enemy out' : 'It keeps everyone out'} until it is broken down.`,
      'Models touching it in the Fight phase that have not fought may strike at it: no Duel roll, and two To Wound rolls a strike. Shots need Strength 5 or more to hurt it.',
    ];
  }
  if (t.object === 'ladder')
    return t.raised
      ? ['Raised against the wall: models within 1" of it climb up or down without a test. A defender touching it on the walls may try to push it down (4+).']
      : ['A Heavy Object. Carry it into base contact with a wall to raise it there. Lying on the ground it has Defence 8 and 2 Wounds.'];
  if (t.kind === 'tower') {
    const b = breakable(t);
    if (!b) return ['Wrecked.'];
    return [
      `Defence ${b.d}, ${b.left} of ${b.w} Wounds left. In its side's Move phase, models touching it can push it ${TOWER.move}" (they need 6 between them, plus one more for each model riding in it; a big creature counts as 6). Those pushing can't do anything else that turn.`,
      t.raised ? 'Its ramp is down on the wall: models within 1" of it step onto the battlements without a climb test.' : 'Push it into contact with a wall to drop its ramp. If it is wrecked, everyone inside falls.',
    ];
  }
  if (t.barricade) {
    const b = breakable(t);
    if (!b) return ['Broken down: models can walk through.'];
    return [`Defence ${b.d}, ${b.left} of ${b.w} Wounds left. Models can strike at it in the Fight phase.`, ...(t.barricade === 'spiked' ? ['Spiked: an attacker whose strike hits the barricade instead takes a Strength 3 hit, and so does anyone jumping it who does not roll a 6.'] : [])];
  }
  if (t.object === 'ram') return ['A Heavy Object carried by two or more. Touching an enemy gate in the Fight phase, it strikes once with the Strength of its strongest carrier +1 for each other one (up to 10), rolling To Wound twice. Defence 8, 3 Wounds.'];
  return [];
}
