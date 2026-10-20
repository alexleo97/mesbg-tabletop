import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model, Terrain } from '../src/shared/types.ts';

const mk = (id: string, x: number, y: number): Model => ({
  id, owner: 'p1', name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const marker: Terrain = { id: 'o', kind: 'objective', shape: 'circle', x: 12, y: 10, w: 1.6, h: 1.6, rot: 0, locked: false };
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const battle = (models: Model[]) =>
  run(initialState(), { type: 'addModels', models }, { type: 'addTerrain', terrain: marker }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const move = (s: GameState, x: number) => run(s, { type: 'moveModels', moves: [{ id: 'm', x, y: 10 }] }).models.m;
// A 25mm base can't end within 1.29" of the marker's centre.
const clear = 0.8 + 25 / 25.4 / 2 - 0.05;

describe('moving over objective markers', () => {
  it('lets a model walk right over a marker', () => {
    expect(move(battle([mk('m', 10, 10)]), 15).x).toBeCloseTo(15, 3);
  });

  it('puts a model dropped just past a marker on the far side, not back behind it', () => {
    const at = move(battle([mk('m', 10, 10)]), 13);
    expect(at.x).toBeGreaterThanOrEqual(12 + clear - 0.01);
    expect(at.x).toBeLessThan(13.6);
  });

  it('keeps a model dropped short of the middle of a marker on the near side', () => {
    const at = move(battle([mk('m', 9, 10)]), 11.6);
    expect(at.x).toBeLessThanOrEqual(12 - clear + 0.01);
  });

  it('keeps it on the near side when its Move would not take it clear', () => {
    const at = move(battle([mk('m', 7, 10)]), 12.8);
    expect(at.x).toBeLessThanOrEqual(12 - clear + 0.01);
  });

  it('keeps it on the near side when another model stands just past the marker', () => {
    const at = move(battle([mk('m', 10, 10), mk('f', 14, 10)]), 13);
    expect(at.x).toBeLessThanOrEqual(12 - clear + 0.01);
  });
});
