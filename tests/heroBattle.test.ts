import { describe, expect, it } from 'vitest';
import { STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { mmToIn } from '../src/shared/geometry.ts';
import { insidePolygon, outline } from '../src/shared/sight.ts';
import { EVIL, GOOD } from '../src/client/heroBattle.ts';

const all = [...GOOD, ...EVIL];

describe('home banner battle', () => {
  it('has no bases on top of each other', () => {
    const clashes: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i], all[j]];
        if (Math.hypot(a.x - b.x, a.y - b.y) < (mmToIn(a.mm) + mmToIn(b.mm)) / 2 - 0.02) clashes.push(`${a.name} / ${b.name}`);
      }
    expect(clashes).toEqual([]);
  });

  it('has nobody standing in the river', () => {
    let n = 0;
    const terrain = starterTerrain(STARTER_BOARDS.find(b => b.id === 'river-crossing')!, () => `t${n++}`);
    const water = terrain.filter(t => t.kind === 'water').map(t => outline(t));
    const bridges = terrain.filter(t => t.kind === 'bridge').map(t => outline(t));
    const wet = all.filter(t => {
      const r = mmToIn(t.mm) / 2;
      // The middle and the whole rim of the base must be on dry land, or on the bridge.
      const rim = [{ x: t.x, y: t.y }, ...Array.from({ length: 24 }, (_, i) => ({ x: t.x + r * Math.cos((i / 24) * Math.PI * 2), y: t.y + r * Math.sin((i / 24) * Math.PI * 2) }))];
      return rim.some(p => water.some(w => insidePolygon(w, p)) && !bridges.some(b => insidePolygon(b, p)));
    });
    expect(wet.map(t => `${t.name} at ${t.x.toFixed(1)},${t.y.toFixed(1)}`)).toEqual([]);
  });
});
