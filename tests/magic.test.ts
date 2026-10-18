import { describe, expect, it } from 'vitest';
import { pendingSpell } from '../src/shared/magic.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid);
  return out && run(s, ...out.apply);
};
const game = (shamanWill = 3, captainWill = 2) =>
  run(
    initialState(),
    { type: 'addModels', models: [mk('shaman', 'p1', 10, 30, { hero: true, will: shamanWill, might: 1 }), mk('captain', 'p2', 10, 22, { hero: true, will: captainWill }), mk('orc', 'p2', 14, 22)] },
    { type: 'startGame' },
    { type: 'setPhase', phase: 'move' },
    { type: 'choosePriority', seat: 'p1' },
  );
const cast = (target: string, will: number): Action => ({ type: 'cast', model: 'shaman', target, power: 'Transfix', cv: 5, will });

describe('magic', () => {
  it('spends the Will and lets the target resist a power that works', () => {
    let s = ask(game(), 'p1', cast('captain', 2), [5, 2])!;
    expect(s.models.shaman.will).toBe(1);
    expect(pendingSpell(s)).toMatchObject({ cast: true, best: 5, target: { id: 'captain' } });
    // Only the target's player answers, and the caster can't cast again this turn.
    expect(ask(s, 'p1', { type: 'resist', will: 1 }, [6])).toBeNull();
    expect(ask(s, 'p1', cast('orc', 1), [6])).toBeNull();
    s = ask(s, 'p2', { type: 'resist', will: 2 }, [3, 5])!;
    expect(s.log.at(-1)?.note).toMatch(/^Resisted/);
    expect(s.models.captain.will).toBe(0);
    expect(s.flow.spell).toBeUndefined();
  });

  it('gives a hero back the Will for a 6 rolled to resist', () => {
    const s = ask(ask(game(), 'p1', cast('captain', 1), [5])!, 'p2', { type: 'resist', will: 2 }, [6, 1])!;
    expect(s.models.captain.will).toBe(1);
  });

  it("takes effect straight away on a target with no Will, and fails below the casting value", () => {
    const s = ask(game(), 'p1', cast('orc', 1), [6])!;
    expect(s.flow.spell).toBeUndefined();
    expect(s.log.find(r => r.label.startsWith('Cast'))?.note).toMatch(/no Will to resist/);
    expect(s.log.at(-1)?.note).toMatch(/can't move, shoot/);
    const miss = ask(game(3, 2), 'p1', cast('captain', 1), [2])!;
    expect(miss.flow.spell).toBeUndefined();
    expect(miss.log.at(-1)?.note).toBe('The power fails.');
  });

  it('waits for the caster to spend Might on a cast that just fell short', () => {
    let s = ask(game(), 'p1', cast('captain', 1), [4])!;
    expect(pendingSpell(s)).toMatchObject({ cast: false });
    s = run(s, { type: 'useMight', roll: s.log.at(-1)!.id, die: 0 });
    expect(pendingSpell(s)).toMatchObject({ cast: true, best: 5 });
    expect(s.log.at(-1)?.note).toMatch(/may resist/);
    // Or the caster lets it fail.
    const fail = run(ask(game(), 'p1', cast('captain', 1), [4])!, { type: 'letSpellFail' });
    expect(fail.flow.spell).toBeUndefined();
  });

  it('forgets a cast still waiting when the turn ends', () => {
    const s = ask(game(), 'p1', cast('captain', 1), [6])!;
    expect(run(s, { type: 'setPhase', phase: 'priority', turn: 2 }).flow.spell).toBeUndefined();
  });
});
