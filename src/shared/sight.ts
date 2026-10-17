import { basePerimeter, halfExtents, type Point } from './geometry.ts';
import type { GameState, Model, Terrain, TerrainKind } from './types.ts';

// A top-down board can only approximate true line of sight, so these are guides, not rulings.

/** Terrain tall and solid enough to hide a model behind it. */
const BLOCKS: ReadonlySet<TerrainKind> = new Set(['building', 'rock', 'cliff']);
/** Terrain a shot has to get past: an In the Way roll each. */
const IN_THE_WAY: ReadonlySet<TerrainKind> = new Set(['wood', 'ruin', 'wall', 'field']);
/** Terrain that halves movement unless set otherwise on the piece. */
const DIFFICULT: ReadonlySet<TerrainKind> = new Set(['wood', 'water', 'ruin']);

export const blocksSight = (t: Terrain) => BLOCKS.has(t.kind);
export const isDifficult = (t: Terrain) => t.difficult ?? DIFFICULT.has(t.kind);

/** A terrain piece's outline in board inches. */
export function outline(t: Terrain, sides = 20): Point[] {
  const a = (t.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const local =
    t.shape === 'rect'
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
  return false;
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
  const blockers = Object.values(state.terrain)
    .filter(blocksSight)
    .map(t => outline(t))
    // A model standing on or in a piece isn't hidden by it, nor is its target.
    .filter(poly => !insidePolygon(poly, from) && !insidePolygon(poly, to));
  const points = [{ x: to.x, y: to.y }, ...basePerimeter(to, 8)];
  const seen = points.filter(p => !blockers.some(poly => lineCrosses(poly, from, p))).length;
  return seen === points.length ? 'clear' : seen === 0 ? 'hidden' : 'partial';
}

/** Terrain and models between a shooter and its target, each needing an In the Way roll. */
export function inTheWay(state: GameState, from: Model, to: Model): string[] {
  const out: string[] = [];
  for (const t of Object.values(state.terrain)) {
    if (!IN_THE_WAY.has(t.kind)) continue;
    const poly = outline(t);
    // Cover the shooter stands in doesn't get in its own way.
    if (insidePolygon(poly, from)) continue;
    if (lineCrosses(poly, from, to)) out.push(t.kind === 'field' ? 'crops' : t.kind);
  }
  for (const m of Object.values(state.models)) {
    if (m.dead || m.id === from.id || m.id === to.id) continue;
    const r = Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
    if (distanceToSegment(m, from, to) < r) out.push(m.name);
  }
  return out;
}

/** How far a move from a to b really costs, counting the part through difficult terrain double. */
export function moveCost(state: GameState, a: Point, b: Point): { cost: number; difficult: boolean } {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const slow = Object.values(state.terrain).filter(isDifficult).map(t => outline(t));
  if (!slow.length || d === 0) return { cost: d, difficult: false };
  const steps = Math.max(8, Math.ceil(d * 8));
  let inside = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (slow.some(poly => insidePolygon(poly, p))) inside++;
  }
  return { cost: d + (d * inside) / steps, difficult: inside > 0 };
}

/** Whether a point is in difficult terrain. */
export const inDifficult = (state: GameState, p: Point) => Object.values(state.terrain).some(t => isDifficult(t) && insidePolygon(outline(t), p));

/**
 * The areas hidden from a viewpoint by sight-blocking terrain, as an SVG path.
 * Each edge of a blocker casts a quad away from the viewer; all quads wind the same way so they fill as one shape.
 */
export function shadowPath(state: GameState, from: Point, far = 200): string {
  let d = '';
  for (const t of Object.values(state.terrain)) {
    if (!blocksSight(t)) continue;
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
