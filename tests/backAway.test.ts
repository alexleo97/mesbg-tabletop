import { describe, expect, it } from 'vitest';
import { distanceBetween } from '../src/shared/geometry.ts';
import { phaseAllows } from '../src/shared/heroics.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const R = 25 / 25.4 / 2;
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const game = (models: Model[], phase: GameState['phase']) => run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase });
const fighter = (id: string) => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });

/** Rolls a duel and its strikes with fixed dice, applying the results as the server would. */
function fight(s: GameState, p1: string[], p2: string[], d: number[]) {
  const seq = [...d];
  const d6 = () => seq.shift() ?? 1;
  let n = 0;
  const req = { sides: [p1.map(fighter), p2.map(fighter)] as [ReturnType<typeof fighter>[], ReturnType<typeof fighter>[]], targets: [p2[0], p1[0]] as [string, string], trapped: false };
  const duel = resolveRequest(s, 'p1', { type: 'fight', fight: req }, d6, () => `g${n++}`)!;
  s = run(s, ...duel.apply);
  const group = (duel.apply[0] as { roll: { group: string } }).roll.group;
  const out = resolveRequest(s, 'p1', { type: 'strikes', fight: req, group }, d6, () => `g${n++}`)!;
  return { s: run(s, ...out.apply), out };
}

describe('backing away after a fight', () => {
  it('moves the loser 1" straight away from the winner', () => {
    const s0 = game([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R)], 'fight');
    // p1 rolls a 6, p2 a 1: p1 wins, then strikes.
    const { s } = fight(s0, ['a'], ['b'], [6, 1, 4]);
    expect(s.models.b.x).toBeCloseTo(10, 3);
    expect(s.models.b.y).toBeCloseTo(20 - 2 * R - 1, 3);
    expect(distanceBetween(s.models.a, s.models.b)).toBeCloseTo(1, 2);
    expect(s.models.a.y).toBe(20);
  });

  it('traps a loser with nowhere to go and doubles the strikes against it', () => {
    // b is pinned against the table edge, with a in front of it.
    const s0 = game([mk('a', 'p1', 10, 2 * R + R), mk('b', 'p2', 10, R)], 'fight');
    const { s, out } = fight(s0, ['a'], ['b'], [6, 1, 4, 4]);
    expect(s.models.b.y).toBeCloseTo(R, 3);
    const strikes = out.apply.filter(a => a.type === 'rolled' && a.roll.against === 'b');
    expect(strikes[0].type === 'rolled' && strikes[0].roll.dice.length).toBe(2);
    expect(strikes[0].type === 'rolled' && strikes[0].roll.label).toContain('trapped');
  });

  it('steps round a friend behind it', () => {
    const s0 = game([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R), mk('c', 'p2', 10, 20 - 4 * R - 0.5)], 'fight');
    const { s } = fight(s0, ['a'], ['b'], [6, 1, 4]);
    expect(s.models.b.x).not.toBeCloseTo(10, 1);
    expect(Math.hypot(s.models.b.x - s.models.c.x, s.models.b.y - s.models.c.y)).toBeGreaterThanOrEqual(2 * R - 0.02);
  });
});

describe('what each phase allows', () => {
  const s = (phase: GameState['phase']) => game([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 10)], phase);
  const shot = { type: 'shoot', shot: { shooter: { id: 'a' } } };

  it('shoots only in the Shoot phase, on your own turn', () => {
    expect(phaseAllows(s('shoot'), 'p1', shot)).toBe(true);
    expect(phaseAllows(s('move'), 'p1', shot)).toBe(false);
    expect(phaseAllows(s('fight'), 'p1', shot)).toBe(false);
    // Player 1 activates first without priority set, so player 2 has to wait.
    expect(phaseAllows(s('shoot'), 'p2', { type: 'shoot', shot: { shooter: { id: 'b' } } })).toBe(false);
  });

  it('fights only in the Fight phase and handles objectives only in the Move phase', () => {
    expect(phaseAllows(s('fight'), 'p2', { type: 'fight' })).toBe(true);
    expect(phaseAllows(s('shoot'), 'p1', { type: 'fight' })).toBe(false);
    expect(phaseAllows(s('move'), 'p1', { type: 'pickUp' })).toBe(true);
    expect(phaseAllows(s('end'), 'p1', { type: 'pickUp' })).toBe(false);
    expect(phaseAllows(s('end'), 'p1', { type: 'drop' })).toBe(true);
  });

  it("holds a side's models still in the Move phase until it's their turn", () => {
    let g = run(s('move'), { type: 'moveModels', moves: [{ id: 'b', x: 10, y: 14 }] });
    expect(g.models.b.y).toBe(10);
    g = run(g, { type: 'endActivation', seat: 'p1' }, { type: 'moveModels', moves: [{ id: 'b', x: 10, y: 14 }] });
    expect(g.models.b.y).toBe(14);
  });
});
