import type { Base, Model } from './types.ts';

export const MM_PER_INCH = 25.4;
export const mmToIn = (mm: number) => mm / MM_PER_INCH;
/** Objective markers are always 25mm across (Rules Manual). */
export const OBJECTIVE_SIZE = mmToIn(25);

export interface Point {
  x: number;
  y: number;
}

/** Base half-extents in inches: rx across the shoulders, ry front to back. */
export function halfExtents(base: Base) {
  return { rx: mmToIn(base.w) / 2, ry: mmToIn(base.h) / 2 };
}

function toLocal(m: Model, p: Point): Point {
  const a = (-m.rot * Math.PI) / 180;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

function toWorld(m: Model, p: Point): Point {
  const a = (m.rot * Math.PI) / 180;
  return { x: m.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: m.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** Points around the edge of a model's base, in board inches. */
export function basePerimeter(m: Model, samples = 48): Point[] {
  const { rx, ry } = halfExtents(m.base);
  const pts: Point[] = [];
  if (m.base.shape === 'rect') {
    const per = Math.max(2, Math.round(samples / 4));
    for (let i = 0; i < per; i++) {
      const t = i / per;
      pts.push({ x: -rx + 2 * rx * t, y: -ry }, { x: rx, y: -ry + 2 * ry * t }, { x: rx - 2 * rx * t, y: ry }, { x: -rx, y: ry - 2 * ry * t });
    }
  } else {
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      pts.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    }
  }
  return pts.map(p => toWorld(m, p));
}

/** Shortest distance from a point to the edge of a model's base; 0 if the point is on the base. */
export function distanceToBase(m: Model, p: Point): number {
  const { rx, ry } = halfExtents(m.base);
  const l = toLocal(m, p);
  if (m.base.shape === 'rect') {
    const dx = Math.max(Math.abs(l.x) - rx, 0);
    const dy = Math.max(Math.abs(l.y) - ry, 0);
    return Math.hypot(dx, dy);
  }
  if (m.base.shape === 'round' || rx === ry) return Math.max(0, Math.hypot(l.x, l.y) - rx);
  if ((l.x / rx) ** 2 + (l.y / ry) ** 2 <= 1) return 0;
  // Oval: closest point found by sampling the ellipse; accurate to well under 0.05".
  let best = Infinity;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    best = Math.min(best, Math.hypot(l.x - rx * Math.cos(a), l.y - ry * Math.sin(a)));
  }
  return best;
}

/** Base-to-base distance, which is how MESBG measures. 0 when the bases touch or overlap. */
export function distanceBetween(a: Model, b: Model): number {
  if (a.base.shape === 'round' && b.base.shape === 'round') {
    return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - mmToIn(a.base.w) / 2 - mmToIn(b.base.w) / 2);
  }
  let best = Infinity;
  for (const p of basePerimeter(a)) best = Math.min(best, distanceToBase(b, p));
  for (const p of basePerimeter(b)) best = Math.min(best, distanceToBase(a, p));
  return best;
}

/** True when two models are in base contact (within a small tolerance). */
export const inBaseContact = (a: Model, b: Model) => distanceBetween(a, b) <= 0.05;

export const formatInches = (d: number) => `${d.toFixed(1)}"`;
