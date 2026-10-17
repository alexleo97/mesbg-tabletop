import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number): Model => ({
  id, owner, name: owner === 'p1' ? 'Archer' : 'Orc', x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const shoot = (s: GameState, shooter: string, target: string, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, 'p1', { type: 'shoot', shot: { shooter: { id: shooter, name: 'Archer', weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: target, name: 'Orc', d: 4 }, obstacles: 0 } }, () => seq.shift() ?? 1, uid);
  return out && run(s, ...out.apply);
};
// Two orcs with the same name; the archer aims at the farther one.
const game = () => run(initialState(), { type: 'addModels', models: [mk('a', 'p1', 10, 30), mk('near', 'p2', 10, 24), mk('far', 'p2', 14, 20)] }, { type: 'startGame' }, { type: 'setPhase', phase: 'shoot' });

describe('shooting', () => {
  it('records which model a shot was aimed at, even when it misses', () => {
    const s = shoot(game(), 'a', 'far', [1])!;
    const first = s.log.find(r => r.group?.startsWith('s-'));
    expect(first?.aim).toBe('far');
    expect(s.models.far.dead).toBe(false);
  });

  it('lets each model shoot once a turn', () => {
    const s = shoot(game(), 'a', 'far', [1])!;
    expect(s.flow.shot).toEqual(['a']);
    expect(shoot(s, 'a', 'near', [6, 6])).toBeNull();
    const next = run(s, { type: 'setPhase', phase: 'move', turn: 2 }, { type: 'setPhase', phase: 'shoot' });
    expect(next.flow.shot).toEqual([]);
    expect(shoot(next, 'a', 'near', [6, 6])?.models.near.dead).toBe(true);
  });
});
