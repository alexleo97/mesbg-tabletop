import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model } from '../src/shared/types.ts';
import { diffForUndo, mergeReverts } from '../src/shared/undo.ts';

const model = (id: string, x: number, owner: 'p1' | 'p2' = 'p1'): Model => ({
  id, owner, name: id, x, y: 5, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});

function step(s: GameState, a: Action) {
  const next = reduce(s, a);
  return { next, revert: diffForUndo(s, next)! };
}

describe('undo', () => {
  const start = reduce(initialState(), { type: 'addModels', models: [model('a', 1), model('b', 2, 'p2')] });

  it('puts a moved model back without touching the other player’s later move', () => {
    const { next, revert } = step(start, { type: 'moveModels', moves: [{ id: 'a', x: 10, y: 10 }] });
    const theirs = reduce(next, { type: 'moveModels', moves: [{ id: 'b', x: 20, y: 20 }] });
    const undone = reduce(theirs, { type: 'revert', revert });
    expect(undone.models.a.x).toBe(1);
    expect(undone.models.b.x).toBe(20);
  });

  it('removes added models and restores removed ones', () => {
    const add = step(start, { type: 'addModels', models: [model('c', 3)] });
    expect(reduce(add.next, { type: 'revert', revert: add.revert }).models.c).toBeUndefined();
    const rem = step(start, { type: 'removeModels', ids: ['a'] });
    expect(reduce(rem.next, { type: 'revert', revert: rem.revert }).models.a).toEqual(start.models.a);
  });

  it('takes back a phase change and a scenario change with its VP', () => {
    const vp = reduce(reduce(start, { type: 'setScenario', id: 'domination' }), { type: 'setVP', seat: 'p1', key: 'x', value: 3 });
    const { next, revert } = step(vp, { type: 'setScenario', id: 'hold-ground' });
    const undone = reduce(next, { type: 'revert', revert });
    expect(undone.scenario).toBe('domination');
    expect(undone.vp.p1.x).toBe(3);
    const ph = step(start, { type: 'nextPhase' });
    expect(reduce(ph.next, { type: 'revert', revert: ph.revert }).phase).toBe('priority');
  });

  it('merges a drag into one step that returns to where it began', () => {
    const a = step(start, { type: 'moveModels', moves: [{ id: 'a', x: 4, y: 5 }] });
    const b = step(a.next, { type: 'moveModels', moves: [{ id: 'a', x: 8, y: 5 }] });
    const undone = reduce(b.next, { type: 'revert', revert: mergeReverts(a.revert, b.revert) });
    expect(undone.models.a.x).toBe(1);
  });

  it('records nothing for a change that changes nothing', () => {
    expect(diffForUndo(start, reduce(start, { type: 'roll', count: 1, label: '' }))).toBeNull();
  });
});
