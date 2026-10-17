import { describe, expect, it } from 'vitest';
import { initialState, loadState, MAX_MODELS, reduce } from '../src/shared/reducer.ts';
import type { Model } from '../src/shared/types.ts';

const model = (id: string, extra: Partial<Model> = {}): Model => ({
  id, owner: 'p1', name: 'Warrior', x: 10, y: 10, rot: 0, base: { shape: 'round', w: 25, h: 25 },
  move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});

describe('reduce', () => {
  it('adds, moves and removes models', () => {
    let s = reduce(initialState(), { type: 'addModels', models: [model('a'), model('b')] });
    s = reduce(s, { type: 'moveModels', moves: [{ id: 'a', x: 20, y: 30, rot: 90 }] });
    expect(s.models.a).toMatchObject({ x: 20, y: 30, rot: 90 });
    s = reduce(s, { type: 'removeModels', ids: ['b'] });
    expect(Object.keys(s.models)).toEqual(['a']);
  });

  it('clamps hostile values', () => {
    const s = reduce(initialState(), { type: 'addModels', models: [model('a', { x: 1e9, wounds: 50, maxWounds: 3, name: 'x'.repeat(500) })] });
    expect(s.models.a.x).toBe(200);
    expect(s.models.a.wounds).toBe(3);
    expect(s.models.a.name).toHaveLength(80);
  });

  it('caps the number of models', () => {
    const many = Array.from({ length: MAX_MODELS + 50 }, (_, i) => model(`m${i}`));
    expect(Object.keys(reduce(initialState(), { type: 'addModels', models: many }).models)).toHaveLength(MAX_MODELS);
  });

  it('keeps wounds within max when updating', () => {
    let s = reduce(initialState(), { type: 'addModels', models: [model('a', { maxWounds: 3, wounds: 3 })] });
    s = reduce(s, { type: 'updateModel', id: 'a', patch: { maxWounds: 2 } });
    expect(s.models.a).toMatchObject({ maxWounds: 2, wounds: 2 });
  });

  it('cycles phases and advances the turn after End', () => {
    let s = initialState();
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'nextPhase' });
    expect(s).toMatchObject({ phase: 'priority', turn: 2 });
  });

  it('ignores roll requests; only server results are logged', () => {
    const s = reduce(initialState(), { type: 'roll', count: 3, label: 'x' });
    expect(s.log).toHaveLength(0);
    const r = reduce(s, { type: 'rolled', roll: { id: 'r', by: 'p1', label: 'x', dice: [1, 9, 3], at: 0 } });
    expect(r.log[0].dice).toEqual([1, 6, 3]);
  });

  it('round-trips a saved game through loadState', () => {
    let s = reduce(initialState(), { type: 'addModels', models: [model('a')] });
    s = reduce(s, { type: 'addTerrain', terrain: { id: 't', kind: 'wood', shape: 'circle', x: 5, y: 5, w: 6, h: 4, rot: 0, locked: true } });
    s = reduce(s, { type: 'setName', seat: 'p2', name: 'Sauron' });
    expect(loadState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
