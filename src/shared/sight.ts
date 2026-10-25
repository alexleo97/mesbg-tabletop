import { basePerimeter, halfExtents, type Point } from './geometry.ts';
import type { GameState, Model, Seat, Terrain, TerrainKind } from './types.ts';

// A top-down board can only approximate true line of sight, so these are guides, not rulings.

/** Terrain tall and solid enough to hide a model behind it. */
const BLOCKS: ReadonlySet<TerrainKind> = new Set(['building', 'rock', 'cliff']);
/** Terrain a shot has to get past: an In the Way roll each. */
const IN_THE_WAY: ReadonlySet<TerrainKind> = new Set(['wood', 'ruin', 'wall', 'field']);
/** Terrain that halves movement unless set otherwise on the piece. */
const DIFFICULT: ReadonlySet<TerrainKind> = new Set(['wood', 'water', 'ruin']);

/** (A gate or door hides what's behind it until it's broken down.) */
export const blocksSight = (t: Terrain) => BLOCKS.has(t.kind) || t.kind === 'hill' || ((t.kind === 'gate' || t.kind === 'tower') && !t.gone);

/** How tall each kind of terrain usually is, in inches, unless set on the piece. Woods count their trees. */
export const DEFAULT_HEIGHT: Partial<Record<TerrainKind, number>> = { hill: 2, rock: 2, building: 4, cliff: 6, wall: 1, ruin: 1.5, wood: 4, field: 1, gate: 3, tower: 5 };
export const heightOf = (t: Terrain) => t.height ?? DEFAULT_HEIGHT[t.kind] ?? 0;
/** Terrain a model can stand on top of: hills, rocks, buildings and cliffs it has climbed, and siege towers it rides. */
const STANDABLE: ReadonlySet<TerrainKind> = new Set(['hill', 'rock', 'building', 'cliff', 'tower']);
/** Rocks, buildings and cliffs are climbed, so going up or down them costs the height; hills are gentle slopes. */
const CLIMBED: ReadonlySet<TerrainKind> = new Set(['rock', 'building', 'cliff']);

/** A rampart with a walkway along its top (Terrain.walk): models stand on it at its height. */
export const walkway = (t: Terrain) => !!t.walk && t.kind === 'wall' && !t.gone;
/** Whether a piece is climbed onto and stood on: a rock, cliff or building without floors, or a rampart's walkway. */
const raised = (t: Terrain) => (CLIMBED.has(t.kind) && !hasFloors(t)) || walkway(t);

/** Buildings and ruins can have floors inside (see Terrain.floors); a piece with floors is walked into, not climbed. */
export const FLOORED: ReadonlySet<TerrainKind> = new Set(['building', 'ruin']);
export const hasFloors = (t: Terrain) => FLOORED.has(t.kind) && (t.floors ?? 0) > 0;
/** How high a floor of a piece is: level 0 the ground floor, level `floors` its roof. */
export const floorHeight = (t: Terrain, level: number) => (heightOf(t) * Math.max(0, Math.min(level, t.floors ?? 0))) / (t.floors || 1);

/** How high the ground is at a point: the top of the tallest solid piece it stands on (inside a piece with floors, its ground floor). */
export function groundAt(state: GameState, p: Point, kinds: ReadonlySet<TerrainKind> = STANDABLE): number {
  let h = 0;
  for (const t of Object.values(state.terrain)) if ((kinds.has(t.kind) || walkway(t)) && !t.gone && !hasFloors(t) && heightOf(t) > h && insidePolygon(outline(t), p)) h = heightOf(t);
  return h;
}
/** The piece with floors a point is inside, if any. */
export const flooredAt = (state: GameState, p: Point) => Object.values(state.terrain).find(t => hasFloors(t) && insidePolygon(outline(t), p));
/** How high a model stands: the ground under it, or the floor it has climbed to inside a building. */
export function standingAt(state: GameState, m: Model): number {
  const t = m.floor ? flooredAt(state, m) : undefined;
  return Math.max(groundAt(state, m), t ? floorHeight(t, m.floor!) : 0);
}
/**
 * How tall a model is, in inches, judged from its base: a Hobbit or Dwarf on a small base is shorter than a Man, a
 * rider is taller, and a monster on a big base taller still.
 */
export function heightOfModel(m: Pick<Model, 'base'>): number {
  if (m.base.h > m.base.w) return 1.6;
  const size = Math.max(m.base.w, m.base.h);
  return size >= 60 ? 3 : size >= 40 ? 2 : size >= 25 ? 1.1 : 0.8;
}
/** A model's eye level: where it stands plus its own height (half that while it lies Prone). */
export const eyeOf = (state: GameState, m: Model) => standingAt(state, m) + heightOfModel(m) / (m.prone ? 2 : 1);
/** The name of a floor, for the model card. */
export const floorName = (t: Terrain, level: number) => (level >= (t.floors ?? 0) ? 'Roof' : level === 0 ? 'Ground floor' : `Floor ${level}`);

/**
 * Whether a sight line from `a` (at height ha) to `b` (at height hb) clears a piece of terrain: it is blocked if the
 * terrain is taller than the line anywhere the line passes over it.
 */
function clears(poly: Point[], top: number, a: Point, ha: number, b: Point, hb: number, margin = 0): boolean {
  if (!lineCrosses(poly, a, b)) return true;
  const steps = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    if (top + margin > ha + (hb - ha) * f && insidePolygon(poly, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })) return false;
  }
  return true;
}
export const isDifficult = (t: Terrain) => t.difficult ?? DIFFICULT.has(t.kind);
export const slowsShots = (t: Terrain) => IN_THE_WAY.has(t.kind);

/** Both banks of a river from its centreline, as one outline in the piece's own inches. */
export function bandOutline(path: [number, number, number][]): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  path.forEach(([x, y, hw], i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    left.push({ x: x + nx * hw, y: y + ny * hw });
    right.push({ x: x - nx * hw, y: y - ny * hw });
  });
  return [...left, ...right.reverse()];
}

/** A terrain piece's outline in board inches. */
// (Pieces only change by being replaced, so each one's outline is worked out once.)
const outlines = new WeakMap<Terrain, Map<number, Point[]>>();

export function outline(t: Terrain, sides = 20): Point[] {
  let known = outlines.get(t);
  const hit = known?.get(sides);
  if (hit) return hit;
  const out = outlineOf(t, sides);
  if (!known) outlines.set(t, (known = new Map()));
  known.set(sides, out);
  return out;
}

/** The box round an outline, to rule it out of a search quickly. */
const boxes = new WeakMap<Point[], [number, number, number, number]>();
function boxOf(poly: Point[]): [number, number, number, number] {
  let b = boxes.get(poly);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of poly) b = [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)];
    boxes.set(poly, b);
  }
  return b;
}
/** Whether an outline's box comes within `pad` of the box round the line from a to b. */
const nearLine = (poly: Point[], a: Point, b: Point, pad = 0) => {
  const [x0, y0, x1, y1] = boxOf(poly);
  return x1 >= Math.min(a.x, b.x) - pad && x0 <= Math.max(a.x, b.x) + pad && y1 >= Math.min(a.y, b.y) - pad && y0 <= Math.max(a.y, b.y) + pad;
};

function outlineOf(t: Terrain, sides: number): Point[] {
  const a = (t.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const local = t.poly && t.poly.length > 2
    ? t.poly.map(([x, y]) => ({ x, y }))
    : t.path && t.path.length > 1
    ? bandOutline(t.path)
    : t.shape === 'rect'
      ? [
          { x: -t.w / 2, y: -t.h / 2 },
          { x: t.w / 2, y: -t.h / 2 },
          { x: t.w / 2, y: t.h / 2 },
          { x: -t.w / 2, y: t.h / 2 },
        ]
      : Array.from({ length: sides }, (_, i) => {
          const r = (i / sides) * Math.PI * 2;
          return { x: (t.w / 2) * Math.cos(r), y: (t.h / 2) * Math.sin(r) };
        });
  return local.map(p => ({ x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c }));
}

export function insidePolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether the straight line from a to b passes over or through a polygon. */
export function lineCrosses(poly: Point[], a: Point, b: Point): boolean {
  if (insidePolygon(poly, a) || insidePolygon(poly, b)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentsCross(a, b, poly[j], poly[i])) return true;
  // A line running exactly through corners of the outline crosses no edge cleanly, so check corners on the line too.
  return poly.some(p => distanceToSegment(p, a, b) < 1e-9);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type Sight = 'clear' | 'partial' | 'hidden';

/** Whether `from` can see `to` past sight-blocking terrain, judged from the centre of its base to points around the target's base. */
export function sightTo(state: GameState, from: Model, to: Model): Sight {
  const reach = Math.max(halfExtents(to.base).rx, halfExtents(to.base).ry) + 0.1;
  const blockers = Object.values(state.terrain)
    .filter(blocksSight)
    .map(t => ({ poly: outline(t), top: heightOf(t) }))
    .filter(({ poly }) => nearLine(poly, from, to, reach))
    // A model standing on or in a piece isn't hidden by it, nor is its target.
    .filter(({ poly }) => !insidePolygon(poly, from) && !insidePolygon(poly, to));
  // Height matters: a model up high sees over lower terrain, and a hill hides what's behind it from below.
  const [ha, hb] = [eyeOf(state, from), eyeOf(state, to)];
  const points = [{ x: to.x, y: to.y }, ...basePerimeter(to, 8)];
  const seen = points.filter(p => blockers.every(({ poly, top }) => clears(poly, top, from, ha, p, hb))).length;
  return seen === points.length ? 'clear' : seen === 0 ? 'hidden' : 'partial';
}

/** Something a shot has to get past: a piece of terrain or a model, and how far along the line it is (0 at the shooter). */
export interface Obstruction {
  name: string;
  terrain?: string;
  model?: string;
  at: number;
}

/** Terrain and models between a shooter and its target, each needing an In the Way roll, nearest the shooter first. */
export function obstructions(state: GameState, from: Model, to: Model): Obstruction[] {
  const out: Obstruction[] = [];
  const [ha, hb] = [eyeOf(state, from), eyeOf(state, to)];
  for (const t of Object.values(state.terrain)) {
    if (!IN_THE_WAY.has(t.kind) || t.gone) continue;
    const poly = outline(t);
    if (!nearLine(poly, from, to)) continue;
    // Cover the shooter stands in doesn't get in its own way, and a shot from well above low cover passes over it.
    if (insidePolygon(poly, from)) continue;
    if (lineCrosses(poly, from, to) && !(insidePolygon(poly, to) ? false : clears(poly, heightOf(t), from, ha, to, hb, 0.5))) out.push({ name: t.kind === 'field' ? 'crops' : t.kind, terrain: t.id, at: entersAt(poly, from, to) });
  }
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  for (const m of Object.values(state.models)) {
    if (m.dead || m.escaped || m.waiting || m.id === from.id || m.id === to.id) continue;
    const r = Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
    if (distanceToSegment(m, from, to) >= r) continue;
    // A shot passing well over a model's head isn't blocked by it.
    const f = Math.max(0, Math.min(1, ((m.x - from.x) * (to.x - from.x) + (m.y - from.y) * (to.y - from.y)) / (len * len)));
    if (ha + (hb - ha) * f > eyeOf(state, m) + 0.5) continue;
    out.push({ name: m.name, model: m.id, at: f });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** How far along the line from a to b it first enters a polygon (0 to 1). */
function entersAt(poly: Point[], a: Point, b: Point): number {
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (insidePolygon(poly, p) || poly.some((q, j) => distanceToSegment(p, poly[(j || poly.length) - 1], q) < 0.05)) return t;
  }
  return 0.5;
}

/** The names of what's between a shooter and its target, each needing an In the Way roll. */
export const inTheWay = (state: GameState, from: Model, to: Model): string[] => obstructions(state, from, to).map(o => o.name);

/** How far a point is from the nearest edge of an outline. */
export const distanceToOutline = (poly: Point[], p: Point) => Math.min(...poly.map((q, j) => distanceToSegment(p, poly[(j || poly.length) - 1], q)));

/** Terrain a model only gets onto by climbing it: a building with no floors to walk into, or a cliff. */
export const isSolid = (t: Terrain) => !t.gone && ((t.kind === 'building' && !hasFloors(t)) || t.kind === 'cliff');

/** Whether a base reaching `r` inches from `p` runs onto any of these outlines (by more than a hair). */
export const onOutlines = (polys: Point[][], p: Point, r: number) => polys.some(poly => insidePolygon(poly, p) || distanceToOutline(poly, p) < r - 0.01);

/** How far a model's base is from a piece of terrain's outline (0 if it stands on it). */
export function distanceToTerrain(m: Model, t: Terrain): number {
  const poly = outline(t);
  if (insidePolygon(poly, m)) return 0;
  const r = Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
  return Math.max(0, Math.min(...poly.map((q, j) => distanceToSegment(m, poly[(j || poly.length) - 1], q))) - r);
}

/** A pit (Isengard): a narrow crevice, water-like in that it is crossed by leaping, but dry. */
export const isPit = (t: Terrain) => t.kind === 'water' && t.look === 'pit';

/** Water too deep to wade (Terrain.deep): Lake-town's Long Lake. */
export const isDeep = (t: Terrain) => t.kind === 'water' && !!t.deep && !t.gone;
/** What stands on deep water and keeps a model on it dry: walkways, boats, houses, floes. */
const DRY: ReadonlySet<TerrainKind> = new Set(['road', 'bridge', 'building', 'rock', 'hill', 'cliff', 'ruin', 'wall', 'tower', 'gate']);
const inBox = (t: Terrain, p: Point) => {
  const [x0, y0, x1, y1] = boxOf(outline(t));
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
};
/** Whether a point is out in deep water, with nothing standing there to keep it dry. */
export function inDeepWater(state: Pick<GameState, 'terrain'>, p: Point): boolean {
  const all = Object.values(state.terrain);
  if (!all.some(t => isDeep(t) && inBox(t, p) && insidePolygon(outline(t), p))) return false;
  return !all.some(t => DRY.has(t.kind) && !t.gone && inBox(t, p) && insidePolygon(outline(t), p));
}
/** Nowhere to stand: Goblin-town's bottomless chasm, the fire of the Crack of Doom, or the gap between two tables. */
export const isAbyss = (t: Pick<Terrain, 'look'> | undefined) => t?.look === 'chasm' || t?.look === 'lava' || t?.look === 'void';
/** Whether a point is over a chasm (or the fire, or between tables), with nothing there to stand on. */
export const inChasm = (state: Pick<GameState, 'terrain'>, p: Point) => Object.values(state.terrain).some(t => isAbyss(t) && !t.gone) && inDeepWater(state, p);
/** Whether a model stands (its middle) in deep water. */
export const swimming = (state: Pick<GameState, 'terrain'>, m: Pick<Model, 'x' | 'y' | 'dead' | 'escaped' | 'waiting'>) => !m.dead && !m.escaped && !m.waiting && inDeepWater(state, m);
/** Whether a model this tall steps over a pit without breaking stride: it is no wider than half the model's height. */
export const stepsOver = (t: Terrain, tall: number) => isPit(t) && tall > 0 && Math.min(t.w, t.h) <= tall / 2 + 1e-6;

/** The ground Writhing Vines make difficult for the other side: 3" around the marker. */
export const VINES_REACH = 3;
const vinesArea = (t: Terrain) => outline({ ...t, shape: 'circle', w: t.w + VINES_REACH * 2, h: t.h + VINES_REACH * 2 });

/** Difficult ground for a model of `seat` (any side's, when no side is given): difficult terrain and enemy Writhing Vines. */
function slowGround(state: GameState, seat?: Seat, ground: string[] = [], tall = 0): Point[][] {
  if (ground.includes('spectral')) return [];
  // Woodland Creatures walk through woods, Mountain Dwellers over rocky ground, and Swift Movement anything but water.
  // A model more than twice as tall as a pit is wide steps straight over it.
  const free = (t: Terrain) => (ground.includes('swift') && t.kind !== 'water') || (ground.includes('wood') && t.kind === 'wood') || (ground.includes('rock') && (t.kind === 'ruin' || t.kind === 'rock' || t.kind === 'cliff')) || stepsOver(t, tall);
  const all = Object.values(state.terrain);
  return [...all.filter(t => !t.vines && isDifficult(t) && !free(t)).map(t => outline(t)), ...all.filter(t => t.vines && seat && t.side !== seat).map(vinesArea)];
}

/**
 * How far a move from a to b really costs for a model of `seat`: the part through difficult terrain counts double (`times` over: four for cavalry)
 * (while any of the base is in it, given the base's radius `r`), and climbing up rocks, cliffs and buildings counts
 * double the height, as does climbing down more than the model's own height (`tall`).
 */
export function moveCost(state: GameState, a: Point, b: Point, seat?: Seat, r = 0, tall = 1.1, ground?: string[], times = 2): { cost: number; difficult: boolean } {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const climb = climbCost(state, a, b, tall);
  const slow = slowGround(state, seat, ground, tall).filter(poly => nearLine(poly, a, b, r));
  if (!slow.length || d === 0) return { cost: d + climb, difficult: false };
  // Bridges carry models over rivers at full speed.
  const bridges = Object.values(state.terrain).filter(t => t.kind === 'bridge').map(t => outline(t));
  const steps = Math.max(8, Math.ceil(d * 8));
  let inside = 0;
  const touches = (poly: Point[], p: Point) => insidePolygon(poly, p) || (r > 0 && poly.some((q, j) => distanceToSegment(p, poly[(j || poly.length) - 1], q) < r));
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (slow.some(poly => touches(poly, p)) && !bridges.some(poly => insidePolygon(poly, p))) inside++;
  }
  return { cost: d + ((times - 1) * d * inside) / steps + climb, difficult: inside > 0 };
}

/** The height of the rocks, cliffs, buildings (without floors) and rampart walkways at a point: what a model there has climbed. */
export function climbedLevel(state: GameState, p: Point): number {
  let h = 0;
  for (const t of Object.values(state.terrain)) if (raised(t) && heightOf(t) > h && insidePolygon(outline(t), p)) h = heightOf(t);
  return h;
}

function climbCost(state: GameState, a: Point, b: Point, tall: number): number {
  // A piece with floors is walked into at ground level; climbing inside it is done floor by floor.
  const pieces = Object.values(state.terrain).filter(t => raised(t) && heightOf(t) > 0);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!pieces.length || d === 0) return 0;
  // Steps and ladders up to a walkway are climbed at the height itself; anything else counts as difficult terrain.
  const polys = pieces.map(t => ({ poly: outline(t), top: heightOf(t), rate: walkway(t) ? 1 : 2 })).filter(({ poly }) => nearLine(poly, a, b));
  if (polys.every(({ poly }) => !lineCrosses(poly, a, b))) return 0;
  const level = (p: Point) => polys.reduce((h, c) => (c.top > h.top && insidePolygon(c.poly, p) ? c : h), { top: 0, rate: 2 });
  const steps = Math.max(8, Math.ceil(d * 4));
  let total = 0;
  let prev = level(a);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const h = level({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    // A drop no more than the model's own height is free.
    if (h.top > prev.top) total += (h.top - prev.top) * h.rate;
    else if (prev.top - h.top > tall + 1e-6) total += (prev.top - h.top) * prev.rate;
    prev = h;
  }
  return total;
}
/** Whether a point is in difficult ground for a model of `seat`, given the special rules for crossing terrain it has (`ground`). */
export const inDifficult = (state: GameState, p: Point, seat?: Seat, ground?: string[]) => {
  const all = Object.values(state.terrain);
  return slowGround(state, seat, ground).some(poly => insidePolygon(poly, p)) && !all.some(t => t.kind === 'bridge' && insidePolygon(outline(t), p));
};

/**
 * The areas hidden from a viewpoint by sight-blocking terrain, as an SVG path.
 * Each edge of a blocker casts a quad away from the viewer; all quads wind the same way so they fill as one shape.
 */
export function shadowPath(state: GameState, from: Point, far = 200): string {
  let d = '';
  // From up high you look over anything well below your eyes.
  const eye = ((from as Partial<Model>).floor ? standingAt(state, from as Model) : groundAt(state, from)) + 1;
  for (const t of Object.values(state.terrain)) {
    if (!blocksSight(t) || heightOf(t) < eye - 0.5) continue;
    const poly = outline(t, 24);
    if (insidePolygon(poly, from)) continue;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[j];
      const q = poly[i];
      const away = (v: Point) => {
        const dx = v.x - from.x;
        const dy = v.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: v.x + (dx / len) * far, y: v.y + (dy / len) * far };
      };
      let quad = [p, q, away(q), away(p)];
      const area = quad.reduce((n, v, k) => n + v.x * quad[(k + 1) % 4].y - quad[(k + 1) % 4].x * v.y, 0);
      if (area < 0) quad = quad.reverse();
      d += `M${quad.map(v => `${v.x.toFixed(3)} ${v.y.toFixed(3)}`).join('L')}Z`;
    }
  }
  return d;
}
