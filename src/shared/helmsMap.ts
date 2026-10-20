import type { Point } from './geometry.ts';
import type { NarrativeTerrain } from './narrative.ts';
import type { Base, Terrain } from './types.ts';

// Helm's Deep: the table, drawn in our own way from the scenario's map, and the places each part of the cast may stand.
// Inches from the north-west corner of a 4' by 4' table. The Hornburg fills that corner, its outer wall an arc round
// it, and the Deeping Wall runs from that wall down to the middle of the south edge, the Deep behind it.

/**
 * The Hornburg's outer wall: an arc round the north-west corner, its middle this far out, and how thick it is. Its
 * walls, like the Deeping Wall, are ramparts the defenders stand on, two ranks deep, reached by flights of steps.
 */
export const OUTER = { r: 23.6, t: 2.2 };
/** Its inner wall, closer in. */
export const INNER = { r: 15, t: 1.8 };
/** The Deeping Wall: a diagonal run from the Hornburg, then straight down to the south edge, with the culvert in it. */
export const DEEPING = { from: { x: 16.3, y: 17.2 }, corner: { x: 23.6, y: 24.3 }, t: 2.2, culvert: 36.2, reach: 6 };
/** Where the Hornburg's great gate stands on the outer wall (degrees round from the north edge towards the west). */
export const GATE_ANGLE = 19;
/** The door between the Hornburg and the Deep, and the door through the inner wall. */
const DEEP_DOOR_ANGLE = 68;
const INNER_DOOR_ANGLE = 25;
/** Evil sets up wholly within this far of the east edge. */
export const EVIL_ZONE = 12;
export const BOARD = 48;
/** How high the fortress walls stand. */
const WALL_HEIGHT = 3;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** The point `r` from the corner at `deg` round the arc (0 along the north edge, 90 down the west edge). */
export const onArc = (r: number, deg: number): Point => ({ x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)) });

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** A wall straight from a to b, a little longer than the gap so neighbouring runs meet. */
function run(id: string, a: Point, b: Point, t: number, extra: Partial<Terrain> = {}): Terrain {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return piece({ id, kind: 'wall', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: len + 0.3, h: t, rot: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, height: WALL_HEIGHT, sheer: true, walk: true, ...extra });
}

/** An arc of wall in short straight runs from `from` to `to` degrees, leaving gaps for the doors in it. */
function arc(id: string, r: number, t: number, from: number, to: number, gaps: { at: number; half: number }[]): Terrain[] {
  const cuts: [number, number][] = [];
  let start = from;
  for (const g of [...gaps].sort((a, b) => a.at - b.at)) {
    cuts.push([start, g.at - g.half]);
    start = g.at + g.half;
  }
  cuts.push([start, to]);
  const out: Terrain[] = [];
  for (const [a, b] of cuts) {
    const n = Math.max(1, Math.ceil((b - a) / 8));
    for (let i = 0; i < n; i++) out.push(run(`${id}-${out.length + 1}`, onArc(r, a + ((b - a) * i) / n), onArc(r, a + ((b - a) * (i + 1)) / n), t));
  }
  return out;
}

/** A door across a gap in an arc of wall. */
function door(id: string, r: number, deg: number, width: number, depth: number, kind: Terrain['door']): NarrativeTerrain {
  const p = onArc(r, deg);
  return { ...piece({ id, kind: 'gate', door: kind, x: p.x, y: p.y, w: width, h: depth, rot: deg + 90, height: WALL_HEIGHT }), held: 'good' };
}

const halfAngle = (width: number, r: number) => ((width / 2 / r) * 180) / Math.PI;
const GATE_W = 3.2;
const DOOR_W = 2;

/** The section of the Deeping Wall within 6" of the culvert, which a Demolition Charge can bring down. */
export const CULVERT_ID = 'deeping-culvert';
const D = DEEPING;
const culvertTop = D.culvert - D.reach;
const culvertBottom = D.culvert + D.reach;

export function helmsTerrain(): NarrativeTerrain[] {
  return [
    // The Hornburg's paved courtyards, drawn under everything else; they change nothing in play.
    piece({ id: 'courtyard', kind: 'road', shape: 'circle', x: 0, y: 0, w: 2 * OUTER.r, h: 2 * OUTER.r, look: 'stone' }),
    // The Hornburg: its outer wall with the great gate, the door down into the Deep, the inner wall and the keep.
    ...arc('outer', OUTER.r, OUTER.t, 0, 90, [
      { at: GATE_ANGLE, half: halfAngle(GATE_W, OUTER.r) },
      { at: DEEP_DOOR_ANGLE, half: halfAngle(DOOR_W, OUTER.r) },
    ]),
    door('gate', OUTER.r, GATE_ANGLE, GATE_W, OUTER.t + 0.2, 'castle'),
    door('deep-door', OUTER.r, DEEP_DOOR_ANGLE, DOOR_W, OUTER.t, 'heavy'),
    ...arc('inner', INNER.r, INNER.t, 0, 90, [{ at: INNER_DOOR_ANGLE, half: halfAngle(DOOR_W, INNER.r) }]),
    door('inner-door', INNER.r, INNER_DOOR_ANGLE, DOOR_W, INNER.t, 'internal'),
    piece({ id: 'keep', kind: 'building', x: 3, y: 3, w: 6, h: 6, height: 6, look: 'stone' }),
    // The tower at the west end of the outer wall, on its outcrop of rock.
    piece({ id: 'west-tower', kind: 'building', shape: 'circle', x: 1.6, y: 23.6, w: 3.2, h: 3.2, height: 4, look: 'stone' }),
    piece({ id: 'outcrop', kind: 'rock', shape: 'circle', x: 3.6, y: 25.8, w: 6.5, h: 2.2, rot: 12, height: 2, look: 'stone' }),
    // The causeway up to the gate.
    piece({ id: 'causeway', kind: 'road', ...along(OUTER.r + OUTER.t / 2 + 2.75), w: 5.5, h: 3.6, rot: GATE_ANGLE, look: 'stone' }),
    // The Deeping Wall: the diagonal run, then the straight run south with the culvert section in the middle of it.
    run('deeping-1', D.from, D.corner, D.t),
    run('deeping-2', D.corner, { x: D.corner.x, y: culvertTop }, D.t),
    run(CULVERT_ID, { x: D.corner.x, y: culvertTop }, { x: D.corner.x, y: culvertBottom }, D.t, { w: culvertBottom - culvertTop, look: 'culvert' }),
    run('deeping-3', { x: D.corner.x, y: culvertBottom }, { x: D.corner.x, y: BOARD + 0.15 }, D.t),
    // Flights of steps up onto the walls: the outer wall's from the Hornburg's courtyard, the inner wall's from both
    // sides, and the Deeping Wall's from the Deep.
    ...[7, 33, 55].map((deg, i) => steps(`steps-outer-${i + 1}`, OUTER.r - OUTER.t / 2 - STEP.d / 2, deg)),
    steps('steps-inner-1', INNER.r - INNER.t / 2 - STEP.d / 2, 55),
    steps('steps-inner-2', INNER.r + INNER.t / 2 + STEP.d / 2, 75, true),
    ...deepingSteps(),
    // The Deeping Stream, out through the culvert.
    piece({ id: 'stream', kind: 'water', x: 13, y: 36, w: 26, h: 1.4, path: [[-13, -0.3, 0.55], [-6, 0.1, 0.6], [2, -0.2, 0.6], [10.6, 0.2, 0.6], [13, 0.2, 0.55]] }),
    // The Host of Isengard's ten Siege Ladders, and the five Demolition Teams' charges.
    ...LADDERS.map((y, i): NarrativeTerrain => ({ ...piece({ id: `ladder-${i + 1}`, kind: 'objective', object: 'ladder', shape: 'circle', x: 39.85, y, w: 1, h: 1 }), locked: false, held: 'evil' })),
    ...HELMS_TEAMS.map((y, i): NarrativeTerrain => ({ ...piece({ id: `charge-${i + 1}`, kind: 'objective', object: 'charge', shape: 'circle', x: 41.6, y, w: CHARGE_SIZE, h: CHARGE_SIZE }), locked: false, held: 'evil' })),
  ];
}

/** Down the table, where each Demolition Team starts with its charge, and where the ladders lie between them. */
export const HELMS_TEAMS = [6, 15, 24, 33, 42];
const LADDERS = [2, 3.9, 10.5, 12.4, 19.5, 28.5, 30.4, 37.5, 39.4, 46];
/** A Demolition Charge stands on a 25mm base. */
export const CHARGE_SIZE = 25 / 25.4;

/** A flight of steps: this wide along the wall, and reaching this far out from it. */
const STEP = { w: 1.6, d: 2 };

/** Steps against an arc of wall, `r` from the corner at `deg`, running out from it (the wall at the steps' local top). */
function steps(id: string, r: number, deg: number, outside = false): Terrain {
  const p = onArc(r, deg);
  return piece({ id, kind: 'road', x: p.x, y: p.y, w: STEP.w, h: STEP.d, rot: deg + (outside ? -90 : 90), stairs: true, look: 'stone' });
}

/** Steps up the Deeping Wall from the Deep: one halfway along the diagonal run, and one either side of the culvert. */
function deepingSteps(): Terrain[] {
  const a = D.from;
  const b = D.corner;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const off = D.t / 2 + STEP.d / 2;
  const mid = { x: (a.x + b.x) / 2 - u.y * off, y: (a.y + b.y) / 2 + u.x * off };
  const rot = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  return [
    piece({ id: 'steps-deeping-1', kind: 'road', ...mid, w: STEP.w, h: STEP.d, rot, stairs: true, look: 'stone' }),
    ...[28, 45].map((y, i) => piece({ id: `steps-deeping-${i + 2}`, kind: 'road', x: b.x - off, y, w: STEP.w, h: STEP.d, rot: 90, stairs: true, look: 'stone' })),
  ];
}

function along(r: number): Point {
  return onArc(r, GATE_ANGLE);
}

// ——— Where the cast stands ———

export type HelmsZone = 'hornburg' | 'deeping' | 'evil';

/** Whether a base of radius r at p is wholly within the Hornburg: inside its outer wall, or up on it. */
export const inHornburg = (p: Point, r: number) => Math.hypot(p.x, p.y) + r <= OUTER.r + OUTER.t / 2 + 0.05;

/** How far a point is from the Deeping Wall's middle line, and whether it is on the Deep's side of it. */
export function fromDeepingWall(p: Point): { d: number; inside: boolean } {
  const a = D.from;
  const b = D.corner;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const diag = Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
  const straight = p.y >= b.y ? Math.abs(p.x - b.x) : Math.hypot(p.x - b.x, p.y - b.y);
  // The Deep lies west of the straight run and south-west of the diagonal one.
  const inside = p.y >= b.y ? p.x < b.x : dx * (p.y - a.y) - dy * (p.x - a.x) > 0;
  return { d: Math.min(diag, straight), inside };
}

/** "On the Deeping Wall": up on its walkway, outside the Hornburg. */
export function onDeepingWall(p: Point, r: number): boolean {
  return fromDeepingWall(p).d <= D.t / 2 - 0.05 && Math.hypot(p.x, p.y) - r >= OUTER.r + OUTER.t / 2 - 0.05 && p.y + r <= BOARD;
}

export const inEvilZone = (p: Point, r: number) => p.x - r >= BOARD - EVIL_ZONE - 0.01 && p.x + r <= BOARD + 0.01 && p.y - r >= -0.01 && p.y + r <= BOARD + 0.01;

export function inHelmsZone(zone: HelmsZone, p: Point, r: number): boolean {
  if (zone === 'hornburg') return inHornburg(p, r) && p.x - r >= 0 && p.y - r >= 0;
  if (zone === 'deeping') return onDeepingWall(p, r);
  return inEvilZone(p, r);
}

/** Slots for 25mm bases along the inner faces of the walls, front rank first, none overlapping. */
const R25 = 25 / 25.4 / 2;
const GAP = 2 * R25 + 0.04;

function spread(candidates: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of candidates) if (out.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= GAP - 0.02)) out.push(p);
  return out;
}

/** Where the defenders of the Deeping Wall stand: two ranks along its walkway, the one nearer the enemy first. */
export function deepingSlots(): Point[] {
  const ranks = [0, 1].map(k => {
    const off = (k ? 1 : -1) * (GAP / 2);
    const a = D.from;
    const b = D.corner;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const diag: Point[] = [];
    for (let t = 1.6 + k * 0.6; t <= len - 1; t += GAP) diag.push({ x: a.x + u.x * t + n.x * off, y: a.y + u.y * t + n.y * off });
    const straight: Point[] = [];
    for (let y = b.y + 1; y <= BOARD - R25; y += GAP) straight.push({ x: b.x - off, y });
    return [...diag, ...straight].filter(p => onDeepingWall(p, R25));
  });
  return spread([...ranks[0], ...ranks[1]]);
}

/** Where the defenders of the Hornburg stand: two ranks along the outer wall's walkway either side of the gate. */
export function hornburgSlots(): Point[] {
  const gate = halfAngle(GATE_W, OUTER.r) + 2.6;
  const ranks = [0, 1].map(k => {
    const r = OUTER.r + (k ? -1 : 1) * (GAP / 2);
    const step = (GAP / r) * (180 / Math.PI);
    const out: Point[] = [];
    for (let deg = 1.6; deg <= 50; deg += step) if (Math.abs(deg - GATE_ANGLE) > gate) out.push(onArc(r, deg));
    return out;
  });
  return spread(ranks.flat());
}

/** Evil's ranks: columns from the west edge of its zone, top to bottom, leaving room for the ballista and the teams. */
export function evilSlots(skip: (p: Point) => boolean): Point[] {
  const out: Point[] = [];
  for (let x = BOARD - EVIL_ZONE + R25 + 0.05; x <= BOARD - R25; x += GAP)
    for (let y = R25 + 0.1; y <= BOARD - R25; y += GAP) {
      const p = { x, y };
      if (!skip(p)) out.push(p);
    }
  return out;
}

/** The Assault Ballista's base: a 105mm oval. */
export const BALLISTA_BASE: Base = { shape: 'oval', w: 105, h: 70 };
