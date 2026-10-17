import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { fightDone } from '../src/shared/movement.ts';
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

describe('fights', () => {
  const duel = (s: GameState, seat: Seat) => {
    const out = resolveRequest(s, seat, { type: 'fight', fight: { sides: [[{ id: 'a', name: 'Archer', f: 3, a: 1, s: 3, d: 4 }], [{ id: 'near', name: 'Orc', f: 3, a: 1, s: 3, d: 4 }]], targets: ['near', 'a'], trapped: false, combat: 'a|near' } }, () => 4, uid);
    return out && run(s, ...out.apply);
  };
  const fightPhase = () => run(game(), { type: 'setPhase', phase: 'fight' });

  it('rolls a duel once, even when both players ask for it at the same time', () => {
    const s = duel(fightPhase(), 'p1')!;
    expect(s.log.filter(r => r.label.startsWith('Duel')).length).toBe(2);
    expect(duel(s, 'p2')).toBeNull();
  });

  it("doesn't let a duel left unstruck last turn block the next one", () => {
    const s = duel(fightPhase(), 'p1')!;
    const next = run(s, { type: 'setPhase', phase: 'move', turn: 2 }, { type: 'setPhase', phase: 'fight' });
    expect(duel(next, 'p2')).not.toBeNull();
  });

  it('counts a fight as fought once a model slain in it splits it into a new one', () => {
    const s = run(fightPhase(), { type: 'resolveCombat', key: 'a,|,far,near' });
    // "near" fell: "a" and "far" still touch, but both have fought this turn.
    expect(fightDone(s, { key: 'a,|,far', p1: ['a'], p2: ['far'] })).toBe(true);
    expect(fightDone(s, { key: 'b,|,c', p1: ['b'], p2: ['c'] })).toBe(false);
  });
});

describe('one fight a turn', () => {
  it('leaves a model that already fought out of a second fight', () => {
    let s = run(initialState(), { type: 'addModels', models: [mk('a', 'p1', 10, 20), mk('b', 'p1', 12, 20), mk('x', 'p2', 30, 30), mk('y', 'p2', 12, 19)] }, { type: 'startGame' }, { type: 'setPhase', phase: 'fight' });
    // "a" fought "x" and backed away into the fight between "b" and "y".
    s = run(s, { type: 'resolveCombat', key: 'a,|,x' });
    const req = { sides: [[{ id: 'a', name: 'A', f: 3, a: 1, s: 3, d: 4 }, { id: 'b', name: 'B', f: 3, a: 1, s: 3, d: 4 }], [{ id: 'y', name: 'Y', f: 3, a: 1, s: 3, d: 4 }]], targets: ['y', 'a'], trapped: false };
    const out = resolveRequest(s, 'p1', { type: 'fight', fight: req } as Action, () => 4, uid)!;
    const rolled = run(s, ...out.apply).log.filter(r => r.label.startsWith('Duel')).map(r => r.model);
    expect(rolled).toEqual(['b', 'y']);
    // With only models that have fought on one side, there's no fight.
    expect(resolveRequest(s, 'p1', { type: 'fight', fight: { ...req, sides: [[req.sides[0][0]], req.sides[1]] } } as Action, () => 4, uid)).toBeNull();
  });
});
