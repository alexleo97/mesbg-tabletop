import { describe, expect, it } from 'vitest';
import { STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';

describe('starter boards', () => {
  it('load every piece and keep models on the table', () => {
    let n = 0;
    for (const b of STARTER_BOARDS) {
      let s = reduce(initialState(), { type: 'addModels', models: [{ id: 'm', owner: 'p1', name: 'x', x: 1, y: 1, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false }] });
      s = reduce(s, { type: 'setScenery', w: b.w, h: b.h, mat: b.mat, terrain: starterTerrain(b, p => `${p}${n++}`) });
      expect(Object.keys(s.terrain)).toHaveLength(b.pieces.length);
      expect(s.board.mat).toBe(b.mat);
      expect(s.models.m).toBeDefined();
      for (const t of Object.values(s.terrain)) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThanOrEqual(b.w);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeLessThanOrEqual(b.h);
      }
    }
  });
});
