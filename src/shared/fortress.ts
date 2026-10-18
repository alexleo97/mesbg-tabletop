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

export const HEAVY = new Set(['ally', 'ladder', 'ram']);

export const isGate = (t: Terrain) => t.kind === 'gate';
/** A gate or door still standing: one that's been broken down is open to everyone. */
export const gateStanding = (t: Terrain) => isGate(t) && !t.gone;
/** A standing gate keeps out everyone but the side holding it, who open it and shut it behind them as they go. */
export const shutTo = (t: Terrain, seat: Seat) => gateStanding(t) && t.side !== seat;

/** What can be struck at, shot at or battered: a gate or door, or a ladder or ram not being carried. */
export function breakable(t: Terrain | undefined): { name: string; d: number; w: number; left: number; trapped: boolean } | undefined {
  if (!t || t.gone) return undefined;
  if (isGate(t)) {
    const kind = DOORS[t.door ?? 'castle'];
    return { name: kind.name, d: kind.d, w: kind.w, left: t.wounds ?? kind.w, trapped: true };
  }
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
export const ladderAt = (state: GameState, pieceId: string, p: Point, r = 0) => laddersOn(state, pieceId).some(l => Math.hypot(l.x - p.x, l.y - p.y) <= 1 + r + l.w / 2);

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
export const ramGate = (state: GameState, ram: Terrain, seat: Seat) => Object.values(state.terrain).find(t => gateStanding(t) && enemyOf(t, seat) && markerToPiece(ram, t) <= 0.3);

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
  if (t.object === 'ram') return ['A Heavy Object carried by two or more. Touching an enemy gate in the Fight phase, it strikes once with the Strength of its strongest carrier +1 for each other one (up to 10), rolling To Wound twice. Defence 8, 3 Wounds.'];
  return [];
}
