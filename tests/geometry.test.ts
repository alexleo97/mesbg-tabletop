import { describe, expect, it } from 'vitest';
import { distanceBetween, distanceToBase, mmToIn } from '../src/shared/geometry.ts';
import type { Model } from '../src/shared/types.ts';

const at = (x: number, y: number, base: Model['base'] = { shape: 'round', w: 25, h: 25 }, rot = 0): Model => ({
  id: `${x},${y}`, owner: 'p1', name: 'm', x, y, rot, base, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});

describe('measuring', () => {
  it('measures base edge to base edge for round bases', () => {
    const r = mmToIn(25) / 2;
    expect(distanceBetween(at(0, 0), at(6 + 2 * r, 0))).toBeCloseTo(6, 5);
  });

  it('reports 0 for touching bases', () => {
    expect(distanceBetween(at(0, 0), at(mmToIn(25), 0))).toBeCloseTo(0, 5);
  });

  it('accounts for rotated cavalry bases', () => {
    const cav = { shape: 'rect' as const, w: 25, h: 50 };
    // Facing up, the long side runs along y: 1" from the long edge is half-width + 1.
    expect(distanceToBase(at(0, 0, cav), { x: mmToIn(12.5) + 1, y: 0 })).toBeCloseTo(1, 5);
    // Turned 90 degrees, the same point is now off the short end and further away.
    expect(distanceToBase(at(0, 0, cav, 90), { x: mmToIn(25) + 1, y: 0 })).toBeCloseTo(1, 5);
  });

  it('measures round to rect bases close to exact', () => {
    const cav = { shape: 'rect' as const, w: 25, h: 50 };
    const d = distanceBetween(at(0, 0, cav), at(mmToIn(12.5) + 3 + mmToIn(12.5), 0));
    expect(d).toBeGreaterThan(2.95);
    expect(d).toBeLessThan(3.05);
  });
});
