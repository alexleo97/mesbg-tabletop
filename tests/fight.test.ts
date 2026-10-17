import { describe, expect, it } from 'vitest';
import { cleanFight, resolveFight, type Fighter } from '../src/shared/fight.ts';

const f = (id: string, s: Partial<Fighter> = {}): Fighter => ({ id, name: id, f: 3, a: 1, s: 3, d: 4, ...s });
const dice = (...seq: number[]) => () => seq.shift() ?? 1;

describe('fight helper', () => {
  it('gives the duel to the highest die, then rolls the winner’s strikes', () => {
    // Duel: hero rolls 2,5 and orc rolls 4. Strikes S4 vs D4 need 4+: rolls 6,3.
    const { rolls, outcome } = resolveFight(cleanFight({ sides: [[f('hero', { a: 2, s: 4 })], [f('orc')]], targets: ['orc', 'hero'], trapped: false })!, dice(2, 5, 4, 6, 3), 'p1', 'g');
    expect(outcome).toMatchObject({ winner: 0, how: 'dice', wounds: 1 });
    expect(rolls.map(r => r.dice)).toEqual([[2, 5], [4], [6, 3]]);
    expect(rolls.at(-1)!.note).toContain('hero wins the duel');
    expect(rolls.every(r => r.group === 'g')).toBe(true);
  });

  it('breaks a tied roll with higher Fight, then with a roll-off', () => {
    expect(resolveFight(cleanFight({ sides: [[f('a', { f: 4 })], [f('b', { f: 5 })]], targets: ['', ''] })!, dice(6, 6, 1), 'p1', 'g').outcome).toMatchObject({ winner: 1, how: 'fight' });
    // Equal Fight: roll-off 3,3 is re-rolled, then 2,5.
    expect(resolveFight(cleanFight({ sides: [[f('a')], [f('b')]], targets: ['', ''] })!, dice(6, 6, 3, 3, 2, 5, 1), 'p1', 'g').outcome).toMatchObject({ winner: 1, how: 'roll-off' });
  });

  it('doubles strikes on a trapped loser and handles 6/4 wounds', () => {
    // S2 vs D7 needs 6 then 4+. Two strikes become four.
    const { rolls, outcome } = resolveFight(cleanFight({ sides: [[f('a', { s: 2, a: 2 })], [f('b', { d: 7 })]], targets: ['b', 'a'], trapped: true })!, dice(6, 1, 5, 6, 6, 1, 1, 4, 3), 'p1', 'g');
    expect(rolls.at(-1)).toMatchObject({ dice: [6, 6, 1, 1], then: 4, follow: [4, 3] });
    expect(outcome.wounds).toBe(1);
  });

  it('rejects a fight without two sides', () => {
    expect(cleanFight({ sides: [[f('a')], []] })).toBeNull();
    expect(cleanFight(null)).toBeNull();
  });
});
