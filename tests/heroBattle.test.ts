import { describe, expect, it } from 'vitest';
import { EVIL, GOOD } from '../src/client/heroBattle.ts';
import { mmToIn } from '../src/shared/geometry.ts';

describe('home banner battle', () => {
  it('has no bases on top of each other', () => {
    const all = [...GOOD, ...EVIL];
    const clashes: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i], all[j]];
        if (Math.hypot(a.x - b.x, a.y - b.y) < (mmToIn(a.mm) + mmToIn(b.mm)) / 2 - 0.02) clashes.push(`${a.name} / ${b.name}`);
      }
    expect(clashes).toEqual([]);
  });
});
