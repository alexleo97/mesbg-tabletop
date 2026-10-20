import type { Point } from '../shared/geometry.ts';
import { zonesOf } from '../shared/objects.ts';
import type { GameState, Seat } from '../shared/types.ts';

// How the table is shown on screen: where it sits, how far in it is zoomed and which way round it is turned. The turn
// is each player's own: it never changes the game, or what the other player sees.

export interface View {
  x: number;
  y: number;
  s: number; // pixels per inch
  r: number; // degrees the table is turned clockwise on screen
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Where a point on the table is on screen, in pixels from the board's top left. */
export function toScreen(v: View, p: Point): Point {
  const c = Math.cos(rad(v.r));
  const s = Math.sin(rad(v.r));
  return { x: v.x + v.s * (p.x * c - p.y * s), y: v.y + v.s * (p.x * s + p.y * c) };
}

/** Which point on the table is under a spot on screen (pixels from the board's top left). */
export function toTable(v: View, q: Point): Point {
  const c = Math.cos(rad(v.r));
  const s = Math.sin(rad(v.r));
  const dx = (q.x - v.x) / v.s;
  const dy = (q.y - v.y) / v.s;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** The view, zoomed to `s` and turned to `r`, that puts table point `p` under screen point `q`. */
export function viewAt(p: Point, q: Point, s: number, r: number): View {
  const c = Math.cos(rad(r));
  const n = Math.sin(rad(r));
  return { s, r, x: q.x - s * (p.x * c - p.y * n), y: q.y - s * (p.x * n + p.y * c) };
}

/** The view that shows the whole table, turned to `r`, in a screen `width` by `height` pixels with `pad` round it. */
export function fitView(board: { w: number; h: number }, width: number, height: number, r: number, pad = 16): View {
  const c = Math.abs(Math.cos(rad(r)));
  const n = Math.abs(Math.sin(rad(r)));
  const w = board.w * c + board.h * n;
  const h = board.w * n + board.h * c;
  const s = Math.max(0.01, Math.min((width - pad * 2) / w, (height - pad * 2) / h));
  return viewAt({ x: board.w / 2, y: board.h / 2 }, { x: width / 2, y: height / 2 }, s, r);
}

/** A turn brought to between -180 and 180 degrees. */
export const wrapTurn = (r: number) => ((((r + 180) % 360) + 360) % 360) - 180;

/** A turn that is nearly square snapped to the square, so a twist on a phone settles cleanly. */
export function snapTurn(r: number, within = 8) {
  const sq = Math.round(r / 90) * 90;
  return Math.abs(r - sq) <= within ? sq : r;
}

/** Roughly the middle of where a side sets up: its deployment zones, or else its models on the table. */
export function homeOf(state: GameState, seat: Seat): Point | null {
  const centres = zonesOf(state, seat).flatMap((z): Point[] => {
    if (z.shape === 'rect') return [{ x: z.x + z.w / 2, y: z.y + z.h / 2 }];
    if (z.shape === 'polygon') return z.points.length ? [{ x: z.points.reduce((n, p) => n + p[0], 0) / z.points.length, y: z.points.reduce((n, p) => n + p[1], 0) / z.points.length }] : [];
    if (z.shape === 'edge') return [];
    return [{ x: z.cx, y: z.cy }];
  });
  const pts = centres.length ? centres : Object.values(state.models).filter(m => m.owner === seat && !m.dead && !m.escaped && !m.waiting);
  if (!pts.length) return null;
  return { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length };
}

/**
 * The turn (a whole number of quarter turns) that puts a side's own army at the bottom of the screen, as if standing at
 * its edge of a real table. Spectators see it from the first player's side.
 */
export function homeTurn(state: GameState, seat: Seat): number {
  const home = homeOf(state, seat);
  const dx = home ? home.x - state.board.w / 2 : 0;
  const dy = home ? home.y - state.board.h / 2 : 0;
  // Nowhere to go by: the first player sits at the bottom edge and the second across from them.
  if (Math.hypot(dx, dy) < 1) return seat === 'p2' ? 180 : 0;
  // Turn the way from the middle to the army round to point straight down the screen.
  const r = 90 - (Math.atan2(dy, dx) * 180) / Math.PI;
  return wrapTurn(Math.round(r / 90) * 90) || 0;
}
