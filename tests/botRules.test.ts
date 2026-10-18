import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { botStep, newMemo, type BotMemo } from '../src/shared/bot.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, army: string, rules: string[] = [], stats = ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+'], type = 'Warrior', wargear = ['hand weapon']) => ({ name, army, origin: army, type, points: 5, stats, options: [], rules, wargear });
const catalog = {
  source: '',
  armies: { Mordor: { side: 'Evil', units: [], rules: [] }, Gondor: { side: 'Good', units: [], rules: [] } },
  units: {
    '[mordor] catapult': unit('Mordor War Catapult', 'Mordor', ['Arcing Shot', 'Area Effect'], ['-', '-', '-', '10', '10', '-', '4', '-', '-'], 'Siege Engine'),
    '[mordor] orc': unit('Orc Warrior', 'Mordor', [], ['6"', '3', '5+', '3', '4', '1', '1', '7', '7+']),
    '[mordor] troll': unit('Mordor Troll', 'Mordor', ['Monstrous Charge'], ['6"', '7', '5+', '7', '7', '3', '3', '4+', '6+']),
    '[mordor] mumak': unit('Mûmak', 'Mordor', ['Trample'], ['8"', '4', '-', '9', '7', '0', '10', '7', '-']),
    '[gondor] knight': unit('Iron Guard', 'Gondor', [], ['6"', '3', '4+', '3', '8', '1', '1', '7', '7+']),
    '[gondor] warrior': unit('Warrior of Minas Tirith', 'Gondor'),
    '[gondor] rider': unit('Knight of Minas Tirith', 'Gondor', [], ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+'], 'Warrior', ['hand weapon', 'horse']),
    '[gondor] archer': unit('Archer', 'Gondor', [], undefined, 'Warrior', ['Bow', 'hand weapon']),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: owner === 'p2' ? 180 : 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
/** The game started, in the Move phase, with the given side to move first. */
const begin = (models: Model[], first: Seat = 'p2', terrain: Terrain[] = []) =>
  run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: first }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, d6 = () => 6) => {
  const out = resolveRequest(s, seat, a, d6, uid, Date.now(), catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : s;
};
/** The computer's first action of the given kind as `seat`, thinking up to a few steps ahead. */
const first = (s: GameState, kind: Action['type'], seat: Seat = 'p2', memo: BotMemo = newMemo(), person = false) => {
  for (let i = 0; i < 12; i++) {
    const step = botStep(s, seat, catalog, memo, Date.now(), person);
    if (step?.action?.type === kind) return step.action;
    if (!step?.action || step.action.type === 'endActivation') return undefined;
  }
  return undefined;
};

describe('the computer and the newer rules', () => {
  it('turns a siege engine to face a target outside its Arc of Sight', () => {
    const cat = mk('cat', 'p2', 20, 4.5, '[mordor] catapult', { name: 'Mordor War Catapult', siege: 'large', move: 0, wounds: 4, maxWounds: 4, base: { shape: 'rect', w: 60, h: 60 }, rot: 180 });
    const crew = [mk('c1', 'p2', 18.3, 4.5, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' }), mk('c2', 'p2', 21.7, 4.5, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' }), mk('c3', 'p2', 20, 2.8, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' })];
    // The only enemy is off to its side, 25" away.
    const s = begin([cat, ...crew, mk('w', 'p1', 45, 7, '[gondor] warrior')]);
    const turn = first(s, 'moveModels') as Extract<Action, { type: 'moveModels' }>;
    expect(turn.moves[0]).toMatchObject({ id: 'cat', x: s.models.cat.x, y: s.models.cat.y });
    expect(turn.moves[0].rot).toBeCloseTo(94, -1);
    expect(run(s, turn).models.cat.rot).toBeCloseTo(turn.moves[0].rot!);
  });

  it('breaks a standoff: after turns with no one hurt, the stronger side goes in', () => {
    const orcs = [0, 1, 2, 3, 4, 5].map(i => mk(`o${i}`, 'p2', 14 + i * 2, 10, '[mordor] orc'));
    const men = [0, 1].map(i => mk(`m${i}`, 'p1', 18 + i * 2, 23, '[gondor] warrior'));
    const s = begin([...orcs, ...men]);
    const advance = (quiet: number) => {
      const memo = { ...newMemo(), turn: 1, quiet, health: 1e9 };
      const move = first(s, 'moveModels', 'p2', memo) as Extract<Action, { type: 'moveModels' }> | undefined;
      return move ? move.moves[0].y - s.models[move.moves[0].id].y : 0;
    };
    expect(advance(3)).toBeGreaterThan(advance(0) - 1e-6);
    expect(advance(3)).toBeGreaterThan(2);
  });

  it('Rends an armoured enemy with its monster, rather than striking at its Defence', () => {
    let s = begin([mk('t', 'p2', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 }), mk('k', 'p1', 20, 21.3, '[gondor] knight')]);
    s = run(s, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
    const fight = first(s, 'fight');
    expect(fight).toBeDefined();
    s = ask(s, 'p2', fight!);
    const strikes = first(s, 'strikes') as Extract<Action, { type: 'strikes' }>;
    expect(strikes.fight.brutal).toMatchObject({ by: 't', kind: 'rend', target: 'k' });
  });

  it('drives the other side’s Stampeding war beast off the table when it can', () => {
    const beast = mk('mk', 'p1', 20, 44, '[mordor] mumak', { name: 'Mûmak', beast: 'war', move: 8, wounds: 10, maxWounds: 10, base: { shape: 'rect', w: 105, h: 165 }, stampede: true });
    const s = begin([beast, mk('o', 'p2', 20, 5, '[mordor] orc')], 'p1');
    const drive = first(s, 'trample') as Extract<Action, { type: 'trample' }>;
    expect(drive).toMatchObject({ id: 'mk' });
    expect(drive.y).toBeGreaterThan(48);
  });

  it('gives a person the chance to drive its own Stampede first', () => {
    const beast = mk('mk', 'p2', 20, 10, '[mordor] mumak', { name: 'Mûmak', beast: 'war', move: 8, wounds: 10, maxWounds: 10, base: { shape: 'rect', w: 105, h: 165 }, stampede: true });
    const s = begin([beast, mk('w', 'p1', 20, 40, '[gondor] warrior')]);
    const memo = newMemo();
    expect(botStep(s, 'p2', catalog, memo, Date.now(), true)?.action).toBeUndefined();
    expect(first(s, 'trample', 'p2', newMemo(), false)).toBeDefined();
  });

  it('climbs a building with its archers, as high as still lets them shoot', () => {
    const tower: Terrain = { id: 'tw', kind: 'building', x: 20, y: 20, w: 6, h: 6, rot: 0, height: 4, floors: 2 } as Terrain;
    const s = begin([mk('a', 'p2', 20, 20, '[gondor] archer'), mk('w', 'p1', 20, 40, '[gondor] warrior')], 'p2', [tower]);
    const climb = first(s, 'climb') as Extract<Action, { type: 'climb' }>;
    expect(climb).toMatchObject({ id: 'a', floor: 1 });
  });

  it('gets a rider down to search for a hidden marker when nobody is on foot', () => {
    const marker: Terrain = { id: 'art', kind: 'objective', x: 20, y: 30, w: 1, h: 1, rot: 0, object: 'artefact', hidden: true } as Terrain;
    const rider = mk('r', 'p1', 20, 34, '[gondor] rider', { mount: 'Horse', mountWounds: 1, move: 10, base: { shape: 'rect', w: 25, h: 50 } });
    const s = begin([rider, mk('o', 'p2', 5, 5, '[mordor] orc')], 'p1', [marker]);
    expect(first(s, 'dismount', 'p1')).toMatchObject({ type: 'dismount', id: 'r' });
  });
});
