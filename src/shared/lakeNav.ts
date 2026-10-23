import type { Point } from './geometry.ts';
import { inDeepWater } from './sight.ts';
import type { GameState, Terrain } from './types.ts';

// Lake-town Escape, for the computer player: finding the way along the walkways. The table is cut into half-inch
// cells; a cell is dry if nothing but deep water lies there. The way to a place is down a map of how far every dry cell
// is from it, walking on dry cells and leaping the narrow gaps between them.

const STEP = 0.5;
/** The widest gap of water an Orc (25mm, so a little over an inch tall) can leap, and what the risk of a fall costs. */
const LEAP = 2;
const LEAP_COST = 3;
const LEAP_CELLS = Math.floor(LEAP / STEP);

interface Grid {
  w: number;
  h: number;
  dry: Uint8Array;
  fields: Map<number, Float64Array>;
}

const grids = new WeakMap<Record<string, Terrain>, Grid>();

function gridOf(state: GameState): Grid {
  let g = grids.get(state.terrain);
  if (!g) {
    const w = Math.ceil(state.board.w / STEP);
    const h = Math.ceil(state.board.h / STEP);
    const dry = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dry[j * w + i] = inDeepWater(state, { x: (i + 0.5) * STEP, y: (j + 0.5) * STEP }) ? 0 : 1;
    g = { w, h, dry, fields: new Map() };
    grids.set(state.terrain, g);
  }
  return g;
}

const cellOf = (g: Grid, p: Point) => {
  const i = Math.max(0, Math.min(g.w - 1, Math.floor(p.x / STEP)));
  const j = Math.max(0, Math.min(g.h - 1, Math.floor(p.y / STEP)));
  return j * g.w + i;
};
const middleOf = (g: Grid, c: number): Point => ({ x: ((c % g.w) + 0.5) * STEP, y: (Math.floor(c / g.w) + 0.5) * STEP });

/** The dry cell nearest a point (the point's own, if it's dry). */
function nearestDry(g: Grid, p: Point): number {
  const c = cellOf(g, p);
  if (g.dry[c]) return c;
  let best = -1;
  let bd = Infinity;
  const [ci, cj] = [c % g.w, Math.floor(c / g.w)];
  for (let r = 1; r < 12 && best < 0; r++)
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= g.w || j >= g.h || !g.dry[j * g.w + i]) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bd) [best, bd] = [j * g.w + i, d];
      }
  return best < 0 ? c : best;
}

/** How far (in inches, along the dry cells) every cell is from `to`. */
function fieldTo(g: Grid, to: Point): Float64Array {
  const start = nearestDry(g, to);
  const cached = g.fields.get(start);
  if (cached) return cached;
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  dist[start] = 0;
  // (Dijkstra over the cells, with a small binary heap of [distance, cell].)
  const heap: [number, number][] = [[0, start]];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const [l, r] = [2 * k + 1, 2 * k + 2];
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const steps: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [dc, c] = pop();
    if (dc > dist[c]) continue;
    const [i, j] = [c % g.w, Math.floor(c / g.w)];
    for (const [di, dj, k] of steps) {
      const [ni, nj] = [i + di, j + dj];
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      const n = nj * g.w + ni;
      // A narrow gap of water straight ahead is leapt.
      if (!g.dry[n]) {
        for (let q = 2; q <= LEAP_CELLS + 1; q++) {
          const [li, lj] = [i + di * q, j + dj * q];
          if (li < 0 || lj < 0 || li >= g.w || lj >= g.h) break;
          const l = lj * g.w + li;
          if (!g.dry[l]) continue;
          const cost = dc + k * q + LEAP_COST / STEP;
          if (cost < dist[l]) {
            dist[l] = cost;
            push([cost, l]);
          }
          break;
        }
        continue;
      }
      // (Diagonally only where both cells beside the step are dry too, so it doesn't cut a corner over the water.)
      if (di && dj && (!g.dry[j * g.w + ni] || !g.dry[nj * g.w + i])) continue;
      if (dc + k < dist[n]) {
        dist[n] = dc + k;
        push([dc + k, n]);
      }
    }
  }
  for (let c = 0; c < dist.length; c++) dist[c] *= STEP;
  if (g.fields.size > 60) g.fields.clear();
  g.fields.set(start, dist);
  return dist;
}

/** How far it is to walk from `from` to `to` along the walkways (Infinity if there's no dry way). */
export function walkDistance(state: GameState, from: Point, to: Point): number {
  const g = gridOf(state);
  return fieldTo(g, to)[nearestDry(g, from)];
}

/**
 * Where to head for, to walk towards `to` along the walkways: the furthest point down the way there, at most `reach`
 * inches along it, that can be walked to in a straight line without getting wet. Null if there is no dry way.
 */
export function waypoint(state: GameState, from: Point, to: Point, reach: number): Point | null {
  const g = gridOf(state);
  const field = fieldTo(g, to);
  let c = nearestDry(g, from);
  const startDist = field[c];
  if (!Number.isFinite(startDist)) return null;
  const path: number[] = [];
  for (let k = 0; k < 400 && field[c] > 0; k++) {
    const [i, j] = [c % g.w, Math.floor(c / g.w)];
    let best = c;
    // (The next cell down the way: a neighbour, or the far side of a gap to leap.)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++)
        for (let q = 1; q <= LEAP_CELLS + 1; q++) {
          const [ni, nj] = [i + di * q, j + dj * q];
          if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) break;
          const n = nj * g.w + ni;
          if (field[n] < field[best]) best = n;
          if (g.dry[n]) break;
        }
    if (best === c) break;
    path.push(best);
    c = best;
    if (startDist - field[c] > reach) break;
  }
  // (A straight line there that stays dry, but for gaps narrow enough to leap.)
  const dryLine = (a: Point, b: Point) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (STEP / 4));
    let wet = 0;
    for (let k = 1; k <= n; k++) {
      wet = g.dry[cellOf(g, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })] ? 0 : wet + STEP / 4;
      if (wet > LEAP - STEP) return false;
    }
    return wet === 0;
  };
  for (let k = path.length - 1; k >= 0; k--) {
    const p = middleOf(g, path[k]);
    if (dryLine(from, p)) return k === path.length - 1 && field[path[k]] === 0 ? { x: to.x, y: to.y } : p;
  }
  return path.length ? middleOf(g, path[0]) : { x: to.x, y: to.y };
}
