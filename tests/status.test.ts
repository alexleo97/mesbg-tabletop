import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { SCENARIOS } from '../src/shared/scenarios.ts';
import { armyStatus, endCheck, endRule } from '../src/shared/status.ts';
import type { GameState, Model } from '../src/shared/types.ts';

const m = (id: string, owner: 'p1' | 'p2', dead = false): Model => ({
  id, owner, name: id, x: 1, y: 1, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead,
});
const army = (p1Dead: number, p2Dead: number, scenario: string | null): GameState => {
  const models = [
    ...Array.from({ length: 8 }, (_, i) => m(`a${i}`, 'p1', i < p1Dead)),
    ...Array.from({ length: 8 }, (_, i) => m(`b${i}`, 'p2', i < p2Dead)),
  ];
  return reduce(reduce(initialState(), { type: 'addModels', models }), { type: 'setScenario', id: scenario });
};
const names = { p1: 'Alex', p2: 'Sam' };

describe('broken and game end', () => {
  it('breaks an army past half its models and quarters it at 25%', () => {
    expect(armyStatus(army(4, 0, null), 'p1')).toMatchObject({ broken: false, quartered: false });
    expect(armyStatus(army(5, 0, null), 'p1')).toMatchObject({ broken: true, quartered: false });
    expect(armyStatus(army(6, 0, null), 'p1')).toMatchObject({ broken: true, quartered: true, left: 2 });
  });

  it('knows every scenario’s end rule', () => {
    for (const s of SCENARIOS) expect(endRule(s.id), s.id).not.toBeNull();
  });

  it('ends a 25% scenario and asks for the D6 in a Broken one', () => {
    const quarter = SCENARIOS.find(s => endRule(s.id) === 'quartered')!.id;
    const roll = SCENARIOS.find(s => endRule(s.id) === 'broken-roll')!.id;
    expect(endCheck(army(5, 0, quarter), names)).toBeNull();
    expect(endCheck(army(6, 0, quarter), names)).toMatchObject({ over: true });
    expect(endCheck(army(4, 0, roll), names)).toBeNull();
    expect(endCheck(army(0, 5, roll), names)).toMatchObject({ rollNeeded: true, reason: expect.stringContaining('Sam is Broken') });
  });
});
