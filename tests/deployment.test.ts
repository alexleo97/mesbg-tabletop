import { describe, expect, it } from 'vitest';
import { zoneOf } from '../src/shared/deployment.ts';
import { deployList } from '../src/shared/importList.ts';
import { whollyIn, zonesOf } from '../src/shared/objects.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { scenarioById } from '../src/shared/scenarios.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const R = 25 / 25.4 / 2;
const mk = (id: string, owner: Seat, x: number, y: number, warband?: string): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...(warband ? { warband } : {}),
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const setup = (scenario: string, models: Model[]) => run({ ...initialState(), scenario }, { type: 'addModels', models });

describe('deployment zones in setup', () => {
  it('stops a model at the edge of its zone', () => {
    // Domination: player 1 deploys in the bottom half.
    const s = run(setup('domination', [mk('a', 'p1', 20, 40)]), { type: 'moveModels', moves: [{ id: 'a', x: 20, y: 10 }] });
    expect(s.models.a.y).toBeGreaterThanOrEqual(24 + R - 0.01);
    expect(s.models.a.y).toBeLessThan(24 + R + 0.05);
    expect(whollyIn(zonesOf(s, 'p1'), s.models.a)).toBe(true);
  });

  it('keeps a model in a corner zone on the table', () => {
    const s = run(setup('divide-and-conquer', [mk('a', 'p1', 3, 3)]), { type: 'moveModels', moves: [{ id: 'a', x: -2, y: 3 }] });
    expect(s.models.a.x).toBeGreaterThanOrEqual(R - 0.01);
  });

  it('leaves models free once the battle starts, and before a scenario is picked', () => {
    const started = run(setup('domination', [mk('a', 'p1', 20, 40)]), { type: 'startGame' }, { type: 'moveModels', moves: [{ id: 'a', x: 20, y: 36 }] });
    expect(started.models.a.y).toBe(40);
    const free = run({ ...setup('domination', [mk('a', 'p1', 20, 40)]), scenario: null }, { type: 'moveModels', moves: [{ id: 'a', x: 20, y: 10 }] });
    expect(free.models.a.y).toBe(10);
  });

  it('brings the whole warband along when one of its models goes to the other zone', () => {
    // Divide and Conquer: player 1 has the top-left and bottom-right corners.
    const s0 = setup('divide-and-conquer', [mk('h', 'p1', 2, 2, 'w1'), mk('a', 'p1', 4, 2, 'w1'), mk('b', 'p1', 2, 4, 'w1'), mk('x', 'p1', 6, 2)]);
    const zones = zonesOf(s0, 'p1');
    expect(['h', 'a', 'b', 'x'].map(id => zoneOf(s0, zones, s0.models[id]))).toEqual([0, 0, 0, 0]);
    const s = run(s0, { type: 'moveModels', moves: [{ id: 'h', x: 45, y: 45 }] });
    expect(['h', 'a', 'b'].map(id => zoneOf(s, zones, s.models[id]))).toEqual([1, 1, 1]);
    // A model with no warband stays put.
    expect(zoneOf(s, zones, s.models.x)).toBe(0);
    for (const p of ['h', 'a', 'b']) for (const q of ['h', 'a', 'b']) if (p < q) expect(Math.hypot(s.models[p].x - s.models[q].x, s.models[p].y - s.models[q].y)).toBeGreaterThanOrEqual(2 * R);
  });

  it('fits a big army inside a 12" strip', () => {
    const s = { ...initialState(), scenario: 'stake-a-claim' };
    const ms = deployList([{ name: 'Captain', count: 1, hero: true, group: 'a' }, { name: 'Warrior', count: 200, hero: false, group: 'a' }, { name: 'Knight on horse', count: 40, hero: false, group: 'b' }], 'p1', s, scenarioById('stake-a-claim'));
    expect(ms).toHaveLength(241);
    const zones = zonesOf(s, 'p1');
    expect(ms.filter(m => !whollyIn(zones, m)).length).toBe(0);
  });
});
