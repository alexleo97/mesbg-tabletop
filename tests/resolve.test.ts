import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState } from '../src/shared/types.ts';

const dice = (...seq: number[]) => () => seq.shift() ?? 1;
let n = 0;
const uid = () => String(n++);
const applyAll = (s: GameState, as: Action[]) => as.reduce(reduce, s);

describe('dice requests', () => {
  it('rolls a duel, then its strikes only once', () => {
    const fight = { sides: [[{ id: 'a', name: 'a', f: 4, a: 1, s: 4, d: 4 }], [{ id: 'b', name: 'b', f: 3, a: 1, s: 3, d: 4 }]], targets: ['b', 'a'], trapped: false } as const;
    let s = initialState();
    const duel = resolveRequest(s, 'p1', { type: 'fight', fight: fight as never }, dice(6, 2), uid)!;
    s = applyAll(s, duel.apply);
    const group = s.log[0].group!;
    const strikes = resolveRequest(s, 'p2', { type: 'strikes', fight: { ...fight, combat: 'a|b' } as never, group }, dice(5), uid)!;
    expect(strikes.record).toEqual({ type: 'resolveCombat', key: 'a|b' });
    s = applyAll(s, strikes.apply);
    expect(s.log.at(-1)).toMatchObject({ dice: [5], against: 'b', note: 'a wins the duel (higher roll)' });
    expect(resolveRequest(s, 'p2', { type: 'strikes', fight: fight as never, group }, dice(6), uid)).toBeNull();
  });

  it('only tags a roll with a model the player owns', () => {
    const s = reduce(initialState(), { type: 'addModels', models: [{ id: 'm', owner: 'p1' } as never] });
    const mine = resolveRequest(s, 'p1', { type: 'roll', count: 2, label: 'Courage', model: 'm' }, dice(3, 4), uid)!;
    const theirs = resolveRequest(s, 'p2', { type: 'roll', count: 2, label: 'Courage', model: 'm' }, dice(3, 4), uid)!;
    expect(mine.apply[0]).toMatchObject({ roll: { dice: [3, 4], model: 'm' } });
    expect((theirs.apply[0] as { roll: { model?: string } }).roll.model).toBeUndefined();
  });
});
