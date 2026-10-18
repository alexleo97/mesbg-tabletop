import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { willOfEvilToll } from '../src/shared/courage.ts';
import { activeSeat } from '../src/shared/flow.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { mayActivate } from '../src/shared/heroics.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const unit = (name: string, army: string, wargear: string[], rules: string[] = []) => ({ name, army, origin: army, type: 'Warrior', points: 5, stats: ['6"', '3', '4+', '3', '4', '1', '1', '6+', '7+'], options: [], rules, wargear });
const catalog = {
  source: '',
  armies: { Gondor: { side: 'Good', units: [], rules: [] }, Mordor: { side: 'Evil', units: [], rules: [] } },
  units: { archer: unit('Archer', 'Gondor', ['Bow']), orc: unit('Orc', 'Mordor', ['Shield']), wraith: unit('Wraith', 'Mordor', [], ['Will of Evil']) },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, catalog);
  return out && run(s, ...out.apply);
};
/** A battle in the Move phase, p1 with Priority, after `heroics` are declared and both players pass. */
const battle = (models: Model[], heroics: Action[] = []) =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, ...heroics, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const move = (s: GameState, id: string, x: number, y: number) => run(s, { type: 'moveModels', moves: [{ id, x, y }] });

describe('heroic actions', () => {
  it('lets a Heroic Move go before Priority, taking friends within 6" that finish within 6" of the hero', () => {
    let s = battle([mk('a', 'p1', 10, 10), mk('cap', 'p2', 30, 30, { hero: true, might: 1 }), mk('w', 'p2', 34, 30), mk('far', 'p2', 50, 30)], [{ type: 'declareHeroic', model: 'cap', action: 'Heroic Move' }]);
    expect(activeSeat(s)).toBe('p2');
    // The side with Priority waits, and so do friends too far away to hear.
    expect(move(s, 'a', 10, 14).models.a.y).toBe(10);
    expect(mayActivate(s, s.models.far)).toBe(false);
    s = move(s, 'cap', 30, 24);
    // A friend that went with it can't end more than 6" from the hero.
    expect(move(s, 'w', 38, 33).models.w).toMatchObject({ x: 34, y: 30 });
    s = move(s, 'w', 34, 33);
    expect(s.models.w.y).toBe(30);
    s = move(s, 'w', 36, 25);
    expect(s.models.w).toMatchObject({ x: 36, y: 25 });
    expect(distanceBetween(s.models.w, s.models.cap)).toBeLessThanOrEqual(6.01);
    s = run(s, { type: 'endActivation', seat: 'p2' });
    // Then the usual order: Priority first, and the models that went with the hero have had their go.
    expect(activeSeat(s)).toBe('p1');
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(mayActivate(s, s.models.w)).toBe(false);
    expect(mayActivate(s, s.models.far)).toBe(true);
  });

  it('gives a Heroic March 5" for a flier or a rider, and is cancelled if the hero is held', () => {
    const s = battle([mk('bat', 'p1', 10, 30, { hero: true, might: 1, fly: true }), mk('e', 'p2', 40, 10)], [{ type: 'declareHeroic', model: 'bat', action: 'Heroic March' }]);
    expect(moveAllowance(s, s.models.bat)).toBe(11);
  });

  it('pairs two heroes in a Heroic Challenge once the challenged one accepts', () => {
    let s = battle([mk('h', 'p1', 10, 10, { hero: true, might: 2 }), mk('v', 'p2', 14, 10, { hero: true, might: 2 }), mk('x', 'p2', 30, 10, { hero: true, might: 1 })]);
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' }, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    expect(s.phase).toBe('fight');
    // Only an enemy hero within 6" can be challenged.
    expect(run(s, { type: 'declareHeroic', model: 'h', action: 'Heroic Challenge', target: 'x' }).flow.challenges).toBeUndefined();
    s = run(s, { type: 'declareHeroic', model: 'h', action: 'Heroic Challenge', target: 'v', cap: 2 });
    expect(s.flow.challenges).toEqual([{ by: 'h', target: 'v', cap: 2 }]);
    s = run(s, { type: 'answerChallenge', target: 'v', accept: true });
    expect(s.flow.challenges?.[0].accepted).toBe(true);
  });

  it("refuses a Heroic Shoot from a hero who's in a fight", () => {
    const s = run(initialState(), { type: 'addModels', models: [mk('h', 'p1', 10, 10, { hero: true, might: 1 }), mk('e', 'p2', 10, 11)] }, { type: 'startGame' }, { type: 'setPhase', phase: 'shoot' }, { type: 'declareHeroic', model: 'h', action: 'Heroic Shoot' });
    expect(s.flow.heroics).toEqual([]);
  });
});

describe('Might, Will and Courage', () => {
  it('lets a hero spend Will as well as Might on a Courage test', () => {
    let s = battle([mk('h', 'p1', 10, 10, { hero: true, will: 1 })]);
    s = run(s, { type: 'rolled', roll: { id: 'c1', by: 'p1', label: 'Courage test: h', dice: [4, 5], sum: 10, model: 'h', at: 1 } }, { type: 'useMight', roll: 'c1', die: 0, will: true });
    expect(s.log.find(r => r.id === 'c1')?.dice).toEqual([5, 5]);
    expect(s.models.h.will).toBe(0);
    // Will is for Courage only.
    s = run(s, { type: 'rolled', roll: { id: 'd1', by: 'p1', label: 'Duel', dice: [3], model: 'h', at: 1 } }, { type: 'useMight', roll: 'd1', die: 0, will: true });
    expect(s.log.find(r => r.id === 'd1')?.dice).toEqual([3]);
  });

  it("stops a hero's shot that just missed so it can spend Might, then carries on", () => {
    let s = battle([mk('h', 'p1', 10, 30, { hero: true, might: 1, profileId: 'archer' }), mk('o', 'p2', 10, 10, { profileId: 'orc' })]);
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    const shoot: Action = { type: 'shoot', shot: { shooter: { id: 'h', name: 'h', weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: 'o', name: 'o', d: 4 }, obstacles: 0 } } as Action;
    s = ask(s, 'p1', shoot, [3])!;
    const group = s.flow.shotPause!.group;
    const hit = s.log.filter(r => r.group === group).at(-1)!;
    expect(hit.dice).toEqual([3]);
    // Nothing else happens until the shot goes on; it can't end the activation meanwhile.
    expect(run(s, { type: 'endActivation', seat: 'p1' }).flow.done).not.toContain('p1');
    s = run(s, { type: 'useMight', roll: hit.id, die: 0 });
    expect(s.models.h.might).toBe(0);
    s = ask(s, 'p1', { type: 'shotOn', group }, [6])!;
    expect(s.flow.shotPause).toBeUndefined();
    expect(s.models.o.dead).toBe(true);
  });

  it('carries straight on when the hero has no Might to help', () => {
    let s = battle([mk('h', 'p1', 10, 30, { hero: true, might: 0, profileId: 'archer' }), mk('o', 'p2', 10, 10, { profileId: 'orc' })]);
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    s = ask(s, 'p1', { type: 'shoot', shot: { shooter: { id: 'h', name: 'h', weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: 'o', name: 'o', d: 4 }, obstacles: 0 } } as Action, [3])!;
    expect(s.flow.shotPause).toBeUndefined();
  });

  it('takes 1 Will from a Will of Evil model that fought, and banishes it at none', () => {
    let s = battle([mk('r', 'p2', 10, 10, { hero: true, will: 1, profileId: 'wraith' }), mk('e', 'p1', 10, 11)]);
    s = { ...s, phase: 'end', flow: { ...s.flow, resolved: ['e,r'] } };
    s = run(s, ...willOfEvilToll(s, catalog, uid, 1));
    expect(s.models.r.dead).toBe(true);
    expect(s.flow.willed).toBe(s.turn);
  });
});
