import type { StarterBoard } from './boards.ts';
import { outline } from './sight.ts';
import type { Point } from './geometry.ts';
import type { Terrain } from './types.ts';

// Checks that keep the starter boards believable and fair: nothing sitting in a river or on a road,
// pieces not piled into each other, and each player's half getting a similar amount of cover.

const asTerrain = (b: StarterBoard) => b.pieces.map((p, i) => ({ rot: 0, ...p, id: `p${i}`, locked: true }) as Terrain);

function segDist(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function inside(poly: Point[], p: Point) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/** The gap between two outlines, or 0 if they overlap. */
export function gap(a: Point[], b: Point[]): number {
  if (a.some(p => inside(b, p)) || b.some(p => inside(a, p))) return 0;
  let d = Infinity;
  for (const p of a) for (let i = 0, j = b.length - 1; i < b.length; j = i++) d = Math.min(d, segDist(p, b[j], b[i]));
  for (const p of b) for (let i = 0, j = a.length - 1; i < a.length; j = i++) d = Math.min(d, segDist(p, a[j], a[i]));
  return d;
}

/** Room to leave beside water and roads (banks, verges) and between pieces. */
const BANK = 1;
const APART = 0.1;

/** Everything that looks wrong on a board, in plain words. */
export function layoutProblems(b: StarterBoard): string[] {
  const all = asTerrain(b);
  const out: string[] = [];
  const name = (t: Terrain) => `${t.kind} at ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
  const solid = all.filter(t => t.kind !== 'water' || !t.path).filter(t => t.kind !== 'road' && t.kind !== 'bridge');
  for (const line of all.filter(t => t.path)) {
    const edge = outline(line, 24);
    for (const t of solid) {
      if (t === line) continue;
      if (gap(edge, outline(t, 24)) < BANK) out.push(`${name(t)} touches the ${line.kind === 'road' ? 'road' : 'river'}`);
    }
  }
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const [a, c] = [solid[i], solid[j]];
      if (gap(outline(a, 24), outline(c, 24)) < APART) out.push(`${name(a)} overlaps ${name(c)}`);
    }
  return out;
}

const COVER = new Set(['wood', 'ruin', 'building', 'rock', 'cliff', 'wall', 'field']);

/** Cover in each player's half (square inches), counting each piece by where its centre is. */
export function halfCover(b: StarterBoard): { p1: number; p2: number } {
  const half = { p1: 0, p2: 0 };
  for (const t of asTerrain(b)) {
    if (!COVER.has(t.kind)) continue;
    const area = t.shape === 'circle' ? (Math.PI * t.w * t.h) / 4 : t.w * t.h;
    half[t.y >= b.h / 2 ? 'p1' : 'p2'] += area;
  }
  return half;
}
