import { describe, expect, it } from 'vitest';
import { NARRATIVES } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { COMMUNITY_BOARDS, MIDDLE_EARTH_MAPS, tableByKey } from '../src/shared/tables.ts';

describe('tables to play on', () => {
  it('offer every narrative scenario map as a Middle-earth map', () => {
    expect(MIDDLE_EARTH_MAPS.map(t => t.key)).toEqual(NARRATIVES.map(n => `me:${n.id}`));
    expect(tableByKey('me:weathertop')?.name).toBe('Weathertop');
  });

  it('leave out the scenario markers and give gates to no one', () => {
    let n = 0;
    for (const t of MIDDLE_EARTH_MAPS) {
      const terrain = t.terrain(p => `${p}${n++}`);
      expect(terrain.length).toBeGreaterThan(0);
      expect(terrain.filter(x => x.kind === 'objective')).toEqual([]);
      expect(terrain.filter(x => x.side || 'held' in x)).toEqual([]);
      const s = reduce(initialState(), {
        type: 'setScenery',
        w: t.w,
        h: t.h,
        mat: t.mat,
        terrain,
      });
      expect(Object.keys(s.terrain)).toHaveLength(terrain.length);
    }
  });

  it('list the original boards as community maps, by Alex', () => {
    expect(COMMUNITY_BOARDS.length).toBeGreaterThan(0);
    for (const b of COMMUNITY_BOARDS) expect(b.author).toBe('Alex');
  });
});
