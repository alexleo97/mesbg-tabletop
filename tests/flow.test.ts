import { describe, expect, it } from 'vitest';
import { cleanShot, resolveShot } from '../src/shared/fight.ts';
import { activeSeat, combats, priorityChooser, fightToOpen, shownFight } from '../src/shared/flow.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model } from '../src/shared/types.ts';

const m = (id: string, owner: 'p1' | 'p2', x: number, y: number): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const run = (s: GameState, ...as: Action[]) => as.reduce(reduce, s);
const dice = (...seq: number[]) => () => seq.shift() ?? 1;

describe('turn flow', () => {
  it('rolls off for priority, re-rolling first-turn ties and passing later ties to the other player', () => {
    expect(priorityChooser([5, 2], 1, null)).toBe('p1');
    expect(priorityChooser([3, 3], 1, null)).toBeNull();
    expect(priorityChooser([3, 3], 2, 'p1')).toBe('p2');
  });

  it('runs a turn: priority, both players move and shoot, then fight', () => {
    let s = run(initialState(), { type: 'startGame' }, { type: 'priorityRolled', roll: [6, 2], chooser: 'p1' }, { type: 'choosePriority', seat: 'p2' });
    expect(s).toMatchObject({ phase: 'move', priority: 'p2', flow: { chooser: 'p1', started: true } });
    expect(activeSeat(s)).toBe('p2');
    s = reduce(s, { type: 'endActivation', seat: 'p2' });
    expect(activeSeat(s)).toBe('p1');
    s = reduce(s, { type: 'endActivation', seat: 'p1' });
    expect(s.phase).toBe('shoot');
    s = run(s, { type: 'endActivation', seat: 'p2' }, { type: 'endActivation', seat: 'p1' });
    expect(s.phase).toBe('fight');
    s = run(s, { type: 'resolveCombat', key: 'a|b' }, { type: 'nextPhase' }, { type: 'nextPhase' });
    expect(s).toMatchObject({ turn: 2, phase: 'priority', priority: null, flow: { resolved: [], chooser: 'p1' } });
    expect(loadState(JSON.parse(JSON.stringify(s))).flow).toEqual(s.flow);
  });

  it('finds fights between models in base contact, joining models that share an enemy', () => {
    // 25mm bases are 0.984" across, so centres 1" apart are touching.
    const s = reduce(initialState(), { type: 'addModels', models: [m('a', 'p1', 10, 10), m('b', 'p2', 11, 10), m('c', 'p1', 12, 10), m('d', 'p1', 30, 30), m('e', 'p2', 40, 40)] });
    expect(combats(s)).toEqual([{ key: 'a,c,|,b', p1: ['a', 'c'], p2: ['b'] }]);
  });
});

describe('shooting', () => {
  it('rolls to hit, In the Way, then to wound', () => {
    const shot = cleanShot({ shooter: { id: 'x', name: 'Archer', weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: 'y', name: 'Orc', d: 4 }, obstacles: 1 })!;
    // Hits on 5, gets past on 4, S2 vs D4 needs 6: rolls 6.
    const { rolls, wounds } = resolveShot(shot, dice(5, 4, 6), 'p1', 'g');
    expect(rolls.map(r => r.dice)).toEqual([[5], [4], [6]]);
    expect(wounds).toBe(1);
    expect(resolveShot(shot, dice(2), 'p1', 'g').rolls.at(-1)!.note).toBe('Archer misses Orc');
  });

  it('shows an opened fight only in the Fight phase once the battle is under way', () => {
    const models = [m('a', 'p1', 10, 10), m('b', 'p2', 11, 10)];
    let s = run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'priorityRolled', roll: [6, 2], chooser: 'p1' }, { type: 'choosePriority', seat: 'p1' });
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    expect(s.phase).toBe('fight');
    const key = combats(s)[0].key;
    // It's the fight that opens as the phase comes round, until it has been fought.
    expect(fightToOpen(s, combats(s))?.key).toBe(key);
    expect(fightToOpen(run(s, { type: 'resolveCombat', key }), combats(s))).toBeUndefined();
    expect(shownFight(s, key, combats(s))?.key).toBe(key);
    // After the losers back away it is still shown, rebuilt from its key, so the wounds can be applied.
    const apart = run(s, { type: 'resolveCombat', key }, { type: 'updateModel', id: 'b', patch: { x: 14 } });
    expect(shownFight(apart, key, combats(apart))).toMatchObject({ key, p1: ['a'], p2: ['b'] });
    // Through the End phase and into the next turn's Move phase, the same models touching again: nothing shown.
    let next = run(apart, { type: 'nextPhase' });
    expect(next.phase).toBe('end');
    expect(shownFight(next, key, combats(next))).toBeUndefined();
    next = run(next, { type: 'nextPhase' }, { type: 'priorityRolled', roll: [6, 2], chooser: 'p1' }, { type: 'choosePriority', seat: 'p1' }, { type: 'updateModel', id: 'b', patch: { x: 11 } });
    expect(next).toMatchObject({ turn: 2, phase: 'move' });
    expect(shownFight(next, key, combats(next))).toBeUndefined();
    expect(shownFight(s, null, combats(s))).toBeUndefined();
  });

  it('shows a fight any time before the battle starts, when models are just being tried out', () => {
    const s = reduce(initialState(), { type: 'addModels', models: [m('a', 'p1', 10, 10), m('b', 'p2', 11, 10)] });
    expect(shownFight(s, 'a,|,b', combats(s))?.key).toBe('a,|,b');
  });
});
