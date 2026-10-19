import { describe, expect, it } from 'vitest';
import { endRollDue, phaseFinished } from '../src/shared/autoPhase.ts';
import { heroicsSettled } from '../src/shared/heroics.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: 'Warrior', x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const game = (models: Model[], scenario?: string) =>
  run(initialState(), ...(scenario ? [{ type: 'setScenario', id: scenario } as Action] : []), { type: 'addModels', models }, { type: 'startGame' });

describe('moving on from finished phases', () => {
  it('moves on from a Fight phase with no fights', () => {
    const s = run(game([mk('a', 'p1', 10, 40), mk('b', 'p2', 10, 8)]), { type: 'setPhase', phase: 'fight' });
    expect(phaseFinished(s)).toBe(true);
  });

  it('waits while a fight is still to be rolled, and moves on once it is', () => {
    let s = run(game([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 0.99)]), { type: 'setPhase', phase: 'fight' });
    expect(phaseFinished(s)).toBe(false);
    s = run(s, { type: 'resolveCombat', key: 'a,|,b' });
    expect(phaseFinished(s)).toBe(true);
  });

  it('asks no one for heroic actions when there are no fights', () => {
    const s = run(game([mk('a', 'p1', 10, 40, { hero: true, might: 1 }), mk('b', 'p2', 10, 8)]), { type: 'setPhase', phase: 'fight' });
    expect(heroicsSettled(s)).toBe(true);
    expect(phaseFinished(s)).toBe(true);
  });

  it('waits for a click to leave the Move phase when the players chose to', () => {
    const base = run(game([mk('a', 'p1', 10, 40), mk('b', 'p2', 10, 8)]), { type: 'setPhase', phase: 'move' });
    const done = (s: GameState) => run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    expect(done(base).phase).toBe('shoot');
    const click = done(run(base, { type: 'setAdvance', click: true }));
    expect(click.phase).toBe('move');
    expect(run(click, { type: 'nextPhase' }).phase).toBe('shoot');
    expect(phaseFinished(run(click, { type: 'setPhase', phase: 'end' }))).toBe(true);
  });

  it('waits for heroic actions from heroes in a fight', () => {
    const R = 25 / 25.4 / 2;
    const s = run(game([mk('a', 'p1', 10, 40, { hero: true, might: 1 }), mk('b', 'p2', 10, 40 - 2 * R)]), { type: 'setPhase', phase: 'fight' });
    expect(heroicsSettled(s)).toBe(false);
    expect(heroicsSettled(run(s, { type: 'passHeroic', seat: 'p1' }))).toBe(true);
  });

  it('starts the next turn from the End phase unless the game end roll is due or the game is over', () => {
    expect(phaseFinished(run(game([mk('a', 'p1', 10, 40), mk('b', 'p2', 10, 8)]), { type: 'setPhase', phase: 'end' }))).toBe(true);
    // Hold Ground: an army that's Broken (half its models slain) rolls to see if the game ends.
    const army = [0, 1, 2, 3].map(i => mk(`a${i}`, 'p1', 10 + i * 2, 40));
    let s = game([...army, mk('b', 'p2', 10, 8)], 'hold-ground');
    s = run(s, { type: 'wound', id: 'a0', count: 1 }, { type: 'wound', id: 'a1', count: 1 }, { type: 'wound', id: 'a2', count: 1 }, { type: 'setPhase', phase: 'end' });
    expect(endRollDue(s)).toBe(true);
    expect(phaseFinished(s)).toBe(false);
    const roll = (d: number) => run(s, { type: 'rolled', roll: { id: 'r1', by: 'p1', label: `Game end roll, turn ${s.turn} (1-2 ends)`, dice: [d], at: 1 } });
    expect(phaseFinished(roll(5))).toBe(true);
    expect(phaseFinished(roll(1))).toBe(false);
  });
});
