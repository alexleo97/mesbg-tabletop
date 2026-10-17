import { describe, expect, it } from 'vitest';
import { SCENARIOS, scenarioFromDice, scenarioMarkers } from '../src/shared/scenarios.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';

describe('matched play scenarios', () => {
  it('has four scenarios in each of six pools', () => {
    expect(SCENARIOS).toHaveLength(24);
    for (let p = 1; p <= 6; p++) expect(SCENARIOS.filter(s => s.pool === p)).toHaveLength(4);
    for (const s of SCENARIOS) {
      expect(s.scoring.length).toBeGreaterThan(0);
      for (const [x, y] of s.objectives.fixedPositions ?? []) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(48);
      }
    }
  });

  it('picks from dice, skipping 5s and 6s for the scenario', () => {
    expect(scenarioFromDice([1, 1, 3, 3])?.id).toBe('domination');
    expect(scenarioFromDice([4, 6, 5, 1])?.pool).toBe(4);
    expect(scenarioFromDice([4, 6, 5, 1])).toBe(SCENARIOS.filter(s => s.pool === 4)[0]);
    expect(scenarioFromDice([6, 6, 6, 6])).toBeDefined();
  });

  it('scales markers to the board', () => {
    const s = SCENARIOS.find(x => x.id === 'domination')!;
    const [m] = scenarioMarkers(s, 72, 48, p => p);
    expect(m.x).toBe(36);
    expect(m.y).toBe(24);
  });

  it('tracks victory points and resets them on a new scenario', () => {
    let st = reduce(initialState(), { type: 'setScenario', id: 'domination' });
    st = reduce(st, { type: 'setVP', seat: 'p1', key: '0', value: 3 });
    st = reduce(st, { type: 'setVP', seat: 'p2', key: '1', value: 200 });
    expect(st.vp).toEqual({ p1: { '0': 3 }, p2: { '1': 99 } });
    expect(loadState(JSON.parse(JSON.stringify(st))).vp).toEqual(st.vp);
    st = reduce(st, { type: 'setScenario', id: 'breakthrough' });
    expect(st.vp).toEqual({ p1: {}, p2: {} });
  });
});
