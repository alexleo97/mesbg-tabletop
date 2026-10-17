import { describe, expect, it } from 'vitest';
import { coverage, objectiveMarkers, OBJECTIVE_SPOTS, STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { moveCost } from '../src/shared/sight.ts';

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

  it('cover a fair share of the table', () => {
    for (const b of STARTER_BOARDS) {
      expect(coverage(b)).toBeGreaterThan(0.2);
      expect(coverage(b)).toBeLessThan(0.4);
    }
  });

  it('places objectives at least 12 inches apart', () => {
    const marks = objectiveMarkers(48, 48, p => p + Math.random());
    expect(marks).toHaveLength(OBJECTIVE_SPOTS.length);
    for (const a of marks) for (const b of marks) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(12);
  });
});

describe('rivers and bridges', () => {
  const crossing = STARTER_BOARDS.find(b => b.id === 'river-crossing')!;
  const load = () => reduce(initialState(), { type: 'setScenery', w: 48, h: 48, mat: 'grass', terrain: starterTerrain(crossing, p => p + Math.random().toString(36).slice(2)) });

  it('keep their winding course through the game state', () => {
    const water = Object.values(load().terrain).find(t => t.kind === 'water')!;
    expect(water.path!.length).toBeGreaterThan(20);
  });

  it('slow models wading the river but not crossing on the bridge', () => {
    const s = load();
    // Straight down across the river beside the bridge, then over the bridge itself.
    expect(moveCost(s, { x: 12, y: 16 }, { x: 12, y: 28 }).difficult).toBe(true);
    expect(moveCost(s, { x: 24, y: 21.5 }, { x: 24, y: 26.5 }).difficult).toBe(false);
  });
});
