import { describe, expect, it } from 'vitest';
import { combats } from '../src/shared/flow.ts';
import { deployList } from '../src/shared/importList.ts';
import { arrivalsDue, rollArrivals } from '../src/shared/maelstrom.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { scenarioById } from '../src/shared/scenarios.ts';
import type { Action, GameState } from '../src/shared/types.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const dice = (...seq: number[]) => () => seq.shift() ?? 1;
let n = 0;
const uid = () => `u${n++}`;

/** A Hold Ground game with two warbands a side, all waiting off the table, at the start of turn 1's Move phase. */
function game() {
  let s: GameState = { ...initialState(), scenario: 'hold-ground' };
  const list = (who: string) => [
    { name: `${who} Captain`, count: 1, hero: true, group: 'a' },
    { name: 'Warrior', count: 6, hero: false, group: 'a' },
    { name: `${who} Lieutenant`, count: 1, hero: true, group: 'b' },
    { name: 'Archer', count: 4, hero: false, group: 'b' },
  ];
  s = run(s, { type: 'addModels', models: deployList(list('Gondor'), 'p1', s, scenarioById('hold-ground')) });
  s = run(s, { type: 'addModels', models: deployList(list('Mordor'), 'p2', s, scenarioById('hold-ground')) });
  return run(s, { type: 'startGame' }, { type: 'setPhase', phase: 'move' });
}

describe('Maelstrom of Battle reinforcements', () => {
  it('keeps every army off the table at the start', () => {
    const s = game();
    expect(Object.values(s.models).every(m => m.waiting)).toBe(true);
    expect(combats(s)).toEqual([]);
    expect(arrivalsDue(s)).toBe('p1');
  });

  it('brings on a warband that rolls 2+ at the rolled edge and leaves one that rolls a 1', () => {
    const s0 = game();
    const out = rollArrivals(s0, 'p1', dice(2, 1), uid, () => 0.5);
    const s = run(s0, ...out);
    const a = Object.values(s.models).filter(m => m.owner === 'p1' && m.warband === 'a');
    const b = Object.values(s.models).filter(m => m.owner === 'p1' && m.warband === 'b');
    expect(a.every(m => !m.waiting && m.y > 36 && m.y <= 48)).toBe(true);
    expect(a.every(m => m.x > 6 && m.x < 42)).toBe(true);
    expect(b.every(m => m.waiting)).toBe(true);
    for (const p of a) for (const q of a) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(0.9);
    expect(s.log.map(r => r.label)).toEqual(["Maelstrom: Gondor Captain's warband arrives on the south edge", "Maelstrom: Gondor Lieutenant's warband doesn't arrive this turn"]);
    // Rolled once a turn; the late warband rolls again next turn.
    expect(arrivalsDue(s)).toBeNull();
    const next = run(s, { type: 'setPhase', phase: 'move', turn: 2 });
    expect(arrivalsDue(next)).toBe('p1');
  });

  it('keeps arrivals out of enemy control zones', () => {
    let s = game();
    // Both sides' first warbands come on at the same point of the east edge.
    s = run(s, ...rollArrivals(s, 'p1', dice(3, 6, 1), uid, () => 0.5));
    s = run(s, ...rollArrivals(s, 'p2', dice(3, 6, 1), uid, () => 0.5));
    const on = Object.values(s.models).filter(m => !m.waiting);
    expect(on.filter(m => m.owner === 'p2').length).toBe(7);
    expect(combats(s)).toEqual([]);
    const R = 25 / 25.4 / 2;
    for (const a of on.filter(m => m.owner === 'p1')) for (const b of on.filter(m => m.owner === 'p2')) expect(Math.hypot(a.x - b.x, a.y - b.y) - 2 * R).toBeGreaterThanOrEqual(1);
  });

  it('sends a 3 or 5 to a short edge, picked by a second roll', () => {
    const s0 = game();
    const s = run(s0, ...rollArrivals(s0, 'p1', dice(3, 6, 5, 1), uid, () => 0.5));
    const a = Object.values(s.models).filter(m => m.owner === 'p1' && m.warband === 'a');
    const b = Object.values(s.models).filter(m => m.owner === 'p1' && m.warband === 'b');
    expect(a.every(m => m.x > 36)).toBe(true);
    expect(b.every(m => m.x < 12)).toBe(true);
  });
});

describe('Reconnoitre', () => {
  it('waits off the table and comes on by its own edge, needing 4+ on turn 1 and less each turn after', async () => {
    const { reconnoitreNeed } = await import('../src/shared/maelstrom.ts');
    expect([1, 2, 3, 4, 5].map(reconnoitreNeed)).toEqual([4, 3, 2, 1, 1]);
    let s: GameState = { ...initialState(), scenario: 'reconnoitre' };
    const list = [{ name: 'Captain', count: 1, hero: true, group: 'a' }, { name: 'Warrior', count: 4, hero: false, group: 'a' }, { name: 'Lieutenant', count: 1, hero: true, group: 'b' }];
    s = run(s, { type: 'addModels', models: deployList(list, 'p1', s, scenarioById('reconnoitre')) });
    s = run(s, { type: 'addModels', models: deployList(list, 'p2', s, scenarioById('reconnoitre')) }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' });
    expect(Object.values(s.models).every(m => m.waiting)).toBe(true);
    expect(arrivalsDue(s)).toBe('p1');
    // A 3 isn't enough on turn 1; a 5 is, and it comes on by player 1's own (south) edge.
    const out = rollArrivals(s, 'p1', dice(3, 5), uid, () => 0.5);
    const after = run(s, ...out);
    const labels = out.filter(a => a.type === 'rolled').map(a => (a as Extract<Action, { type: 'rolled' }>).roll.label);
    expect(labels.some(l => /doesn't arrive/.test(l))).toBe(true);
    expect(labels.some(l => /arrives on the south edge/.test(l))).toBe(true);
    const on = Object.values(after.models).filter(m => m.owner === 'p1' && !m.waiting);
    expect(on.length).toBeGreaterThan(0);
    expect(on.every(m => m.y > 36)).toBe(true);
  });
});
