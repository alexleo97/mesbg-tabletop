import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const R = 25 / 25.4 / 2;
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const dice = (...seq: number[]) => () => seq.shift() ?? 1;
let n = 0;
const uid = () => `u${n++}`;
const fighter = (id: string) => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });

function fight(models: Model[], d: number[]) {
  let s = run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'fight' });
  const roll = dice(...d);
  const req = { sides: [[fighter('a')], [fighter('b')]] as [ReturnType<typeof fighter>[], ReturnType<typeof fighter>[]], targets: ['b', 'a'] as [string, string], trapped: false };
  const duel = resolveRequest(s, 'p1', { type: 'fight', fight: req }, roll, uid)!;
  s = run(s, ...duel.apply);
  const group = (duel.apply[0] as { roll: { group: string } }).roll.group;
  return run(s, ...resolveRequest(s, 'p1', { type: 'strikes', fight: req, group }, roll, uid)!.apply);
}

describe('wounds taken automatically', () => {
  it('slays the loser of a fight as soon as the strikes land, and it stays where it fell', () => {
    // a wins the duel 6-1, then wounds on a 6 (S3 vs D4 needs 5+).
    const s = fight([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R)], [6, 1, 6]);
    expect(s.models.b.dead).toBe(true);
    expect(s.models.b.y).toBeCloseTo(20 - 2 * R, 3);
  });

  it("waits while a hero who missed could still spend Might", () => {
    const s = fight([mk('a', 'p1', 10, 20, { hero: true, might: 1 }), mk('b', 'p2', 10, 20 - 2 * R)], [6, 1, 4]);
    expect(s.models.b.dead).toBe(false);
    expect(s.flow.applied ?? []).toHaveLength(0);
  });

  it('holds wounds on a hero with Fate until its player decides', () => {
    const s = fight([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R, { hero: true, fate: 1 })], [6, 1, 6]);
    expect(s.models.b).toMatchObject({ dead: false, pending: 1 });
  });

  it('counts what is in the way of a shot from the table, whatever the request says', () => {
    let s = run(initialState(), { type: 'addModels', models: [mk('a', 'p1', 10, 30), mk('x', 'p1', 10, 20), mk('b', 'p2', 10, 10)] }, { type: 'startGame' }, { type: 'setPhase', phase: 'shoot' });
    const out = resolveRequest(s, 'p1', { type: 'shoot', shot: { shooter: { id: 'a', name: 'a', weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: 'b', name: 'b', d: 4 }, obstacles: 0 } }, dice(6, 6, 6, 6), uid)!;
    s = run(s, ...out.apply);
    expect(out.apply.some(a => a.type === 'rolled' && a.roll.label.startsWith('In the Way'))).toBe(true);
    expect(s.models.b.dead).toBe(true);
  });
});
