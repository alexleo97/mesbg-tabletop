import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { duelLeader, resolveStrikes, type Fighter, type FightRequest } from '../src/shared/fight.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { planShot } from '../src/shared/shooting.ts';
import { moveCost } from '../src/shared/sight.ts';
import { courageBonus, fighterOf, guards, isKind, terrainRules } from '../src/shared/wargear.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, army: string, wargear: string[], rules: string[] = [], stats = ['6"', '4', '4+', '3', '5', '1', '1', '7', '7+'], origin = army) => ({ name, army, origin, type: 'Warrior', points: 5, stats, options: [], rules, wargear });
const catalog = {
  source: '',
  armies: { Gondor: { side: 'Good', units: [], rules: [] }, Mordor: { side: 'Evil', units: [], rules: [] }, Erebor: { side: 'Good', units: [], rules: [] } },
  units: {
    '[gondor] axeman': unit('Axeman', 'Gondor', ['Armour', 'two-handed weapon']),
    '[gondor] burly': unit('Burly Axeman', 'Gondor', ['two-handed weapon'], ['Burly']),
    '[gondor] knight': unit('Knight', 'Gondor', ['Armour', 'hand-and-a-half weapon', 'shield']),
    '[gondor] guard': unit('Guard', 'Gondor', ['Armour', 'hand weapon', 'shield'], ['Shieldwall']),
    '[gondor] banner': unit('Banner Bearer', 'Gondor', ['Armour', 'hand weapon', 'banner']),
    '[gondor] ranger': unit('Ranger', 'Gondor', ['Bow', 'light armour', 'Elven cloak', 'hand weapon']),
    '[gondor] hornblower': unit('Hornblower', 'Gondor', ['hand weapon', 'war horn']),
    '[mordor] orc': unit('Mordor Orc Warrior', 'Mordor', ['hand weapon', 'shield']),
    '[mordor] archer': unit('Orc Archer', 'Mordor', ['Orc bow', 'hand weapon'], ['Poisoned Attacks (Orc bow)']),
    '[mordor] drummer': unit('Orc Drummer', 'Mordor', ['hand weapon', 'war drum (Mordor)']),
    '[mordor] troll': unit('Troll', 'Mordor', ['hand weapons'], ['Throw Stones (range 12", Strength 8)', 'Harbinger of Evil (12")']),
    '[erebor] dwarf': unit('Dwarf Warrior', 'Erebor', ['hand weapon', 'shield'], ['Hatred (Orc)'], undefined, 'Dwarven Holds'),
    '[mordor] wood': unit('Woodsman', 'Mordor', ['hand weapon'], ['Woodland Creature']),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, profileId?: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...(profileId ? { profileId } : {}), ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const at = (models: Model[], terrain: Terrain[] = []) => run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })));
const toFight = (s: GameState) => run(s, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
let n = 0;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, () => `u${n++}`, Date.now(), catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};
const f = (id: string, extra: Partial<Fighter> = {}): Fighter => ({ id, name: id, f: 3, a: 1, s: 3, d: 4, ...extra });
const duelRoll = (side: 0 | 1, dice: number[], extra: Partial<DiceRoll> = {}): DiceRoll => ({ id: `d${side}`, by: 'p1', label: 'Duel', dice, f: 3, side, model: side ? 'b' : 'a', group: 'f-1', at: 1, ...extra });

describe('weapons', () => {
  it('gives a two-handed weapon -1 in the duel (not on a 6) and +1 to wound, and Burly no penalty', () => {
    const s = at([mk('a', 'p1', 10, 10, '[gondor] axeman'), mk('b', 'p1', 20, 10, '[gondor] burly')]);
    expect(fighterOf(s, catalog, s.models.a)).toMatchObject({ duelMod: -1, sixSafe: true, woundMod: 1, twoHanded: true });
    expect(fighterOf(s, catalog, s.models.b).duelMod).toBeUndefined();
    expect(fighterOf(s, catalog, s.models.b).woundMod).toBe(1);
    // A 5 at -1 ties a 4; a natural 6 stays a 6.
    expect(duelLeader([duelRoll(0, [5], { mod: -1, sixSafe: true }), duelRoll(1, [4])])).toBeNull();
    expect(duelLeader([duelRoll(0, [6], { mod: -1, sixSafe: true }), duelRoll(1, [5])])?.winner).toBe(0);
  });

  it('lets a hand-and-a-half weapon be used two-handed, giving up the shield', () => {
    const s = at([mk('a', 'p1', 10, 10, '[gondor] knight')]);
    expect(fighterOf(s, catalog, s.models.a).twoHanded).toBeUndefined();
    const two = fighterOf(s, catalog, s.models.a, { twoHanded: true });
    expect(two).toMatchObject({ twoHanded: true, woundMod: 1, d: 4 });
  });

  it('works fights out from the profile on the server, whatever numbers were sent', () => {
    let s = toFight(at([mk('a', 'p1', 10, 10, '[gondor] axeman'), mk('b', 'p2', 10.99, 10, '[mordor] orc')]));
    const fight = { sides: [[f('a', { f: 10, a: 5, s: 10 })], [f('b', { f: 1 })]], targets: ['b', 'a'], trapped: false } as FightRequest;
    s = ask(s, 'p1', { type: 'fight', fight }, [3, 3])!;
    const duel = s.log.filter(r => r.side !== undefined);
    expect(duel.map(r => [r.f, r.dice.length, r.mod])).toEqual([[4, 1, -1], [4, 1, undefined]]);
  });

  it('doubles Attacks and stops strikes for a side that is Shielding', () => {
    let s = toFight(at([mk('a', 'p1', 10, 10, '[gondor] axeman'), mk('b', 'p2', 10.99, 10, '[mordor] orc')]));
    s = run(s, { type: 'fightChoice', id: 'b', shielding: true });
    const fight = { sides: [[f('a')], [f('b')]], targets: ['b', 'a'], trapped: false } as FightRequest;
    s = ask(s, 'p1', { type: 'fight', fight }, [1, 6, 6])!;
    expect(s.log.find(r => r.model === 'b' && r.side === 1)?.dice).toHaveLength(2);
    s = ask(s, 'p1', { type: 'strikes', fight, group: s.log.at(-1)!.group! }, [6, 6, 6])!;
    expect(s.log.some(r => r.against === 'a')).toBe(false);
    expect(s.log.at(-1)?.note).toMatch(/No strikes from b \(Shielding\)/);
  });

  it('gives Hatred +1 to wound its foes, and re-rolls poisoned 1s', () => {
    const s = at([mk('dw', 'p1', 10, 10, '[erebor] dwarf'), mk('orc', 'p2', 11, 10, '[mordor] orc')]);
    expect(isKind(catalog, s.models.orc, 'Orc')).toBe(true);
    expect(isKind(catalog, s.models.dw, 'Dwarf')).toBe(true);
    const req = { sides: [[{ ...fighterOf(s, catalog, s.models.dw), vs: { orc: { d: 5, wound: 1, ones: true } } }], [f('orc', { d: 5 })]], targets: ['orc', 'dw'], trapped: false } as FightRequest;
    const seq = [1, 5];
    const out = resolveStrikes(req, [duelRoll(0, [6], { model: 'dw' }), duelRoll(1, [1], { model: 'orc' })], () => seq.shift() ?? 1, 'p1', 'f-1');
    const strike = out.rolls.find(r => r.against === 'orc')!;
    // S3 against D5 needs a 5, so +1 makes it a 4; the 1 is re-rolled into a 5 and wounds.
    expect(strike).toMatchObject({ target: 4, dice: [5] });
    expect(out.outcome.wounds).toBe(1);
  });

  it('lets a banner re-roll one duel die of a side that is losing', () => {
    let s = toFight(at([mk('a', 'p1', 10, 10, '[gondor] axeman'), mk('flag', 'p1', 10, 12, '[gondor] banner'), mk('b', 'p2', 10.99, 10, '[mordor] orc')]));
    const fight = { sides: [[f('a')], [f('b')]], targets: ['b', 'a'], trapped: false } as FightRequest;
    s = ask(s, 'p1', { type: 'fight', fight }, [2, 5])!;
    const mine = s.log.find(r => r.model === 'a' && r.side === 0)!;
    // The other side is winning, so it can't use one (and has no banner anyway).
    expect(ask(s, 'p2', { type: 'banner', roll: s.log.find(r => r.model === 'b')!.id, die: 0 }, [6])).toBeNull();
    s = ask(s, 'p1', { type: 'banner', roll: mine.id, die: 0 }, [6])!;
    expect(s.log.find(r => r.id === mine.id)).toMatchObject({ dice: [6], banner: true });
    // Once per side per duel.
    expect(ask(s, 'p1', { type: 'banner', roll: mine.id, die: 0 }, [6])).toBeNull();
  });
});

describe('armour and equipment', () => {
  it('makes a cloaked, lightly armoured model harder to shoot and wound', () => {
    let s = at([mk('orc', 'p2', 10, 30, '[mordor] archer'), mk('r', 'p1', 10, 26, '[gondor] ranger')]);
    s = run(s, { type: 'startGame' }, { type: 'setPhase', phase: 'shoot' });
    const plan = planShot(s, catalog, s.models.orc, s.models.r);
    expect(plan).toMatchObject({ need: 5, d: 6, ones: true });
  });

  it('gives +1 Defence in a Shieldwall of three', () => {
    const s = at([mk('g1', 'p1', 10, 10, '[gondor] guard'), mk('g2', 'p1', 10.99, 10, '[gondor] guard'), mk('g3', 'p1', 11.98, 10, '[gondor] guard')]);
    expect(fighterOf(s, catalog, s.models.g2).d).toBe(6);
    expect(fighterOf(s, catalog, s.models.g1).d).toBe(5);
  });

  it('gives +1 Courage near a war horn and -1 near a Harbinger of Evil', () => {
    const s = at([mk('w', 'p1', 10, 10, '[gondor] axeman'), mk('horn', 'p1', 30, 10, '[gondor] hornblower'), mk('t', 'p2', 10, 20, '[mordor] troll')]);
    expect(courageBonus(s, catalog, s.models.w)).toBe(0);
    expect(courageBonus(run(s, { type: 'removeModels', ids: ['t'] }), catalog, s.models.w)).toBe(1);
    expect(courageBonus(run(s, { type: 'removeModels', ids: ['horn'] }), catalog, s.models.w)).toBe(-1);
  });

  it('lets a Bodyguard pass Courage tests while its general lives', () => {
    const cat = { ...catalog, units: { ...catalog.units, '[gondor] guard': { ...catalog.units['[gondor] guard'], rules: ['Bodyguard'] } } } as Catalog;
    const s = at([mk('g', 'p1', 10, 10, '[gondor] guard'), mk('cap', 'p1', 20, 10, undefined, { hero: true, general: true })]);
    expect(guards(s, cat, s.models.g)).toBe('Bodyguard');
    expect(guards(run(s, { type: 'updateModel', id: 'cap', patch: { dead: true } }), cat, s.models.g)).toBeNull();
  });

  it('throws stones when it has nothing else and stood still', () => {
    const s = run(at([mk('t', 'p2', 10, 30, '[mordor] troll'), mk('w', 'p1', 10, 20, '[gondor] axeman')]), { type: 'startGame' }, { type: 'setPhase', phase: 'shoot' });
    expect(planShot(s, catalog, s.models.t, s.models.w)).toMatchObject({ weapon: { name: 'Thrown stones', range: 12, s: 8 } });
  });

  it('calls a free Heroic March with a war drum, for its own army within 12"', () => {
    let s = run(
      initialState(),
      { type: 'addModels', models: [mk('dr', 'p2', 10, 10, '[mordor] drummer', { drum: true }), mk('o', 'p2', 20, 10, '[mordor] orc'), mk('man', 'p2', 12, 10, '[gondor] axeman'), mk('e', 'p1', 40, 40)] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
      { type: 'choosePriority', seat: 'p2' },
      { type: 'passHeroic', seat: 'p1' },
      { type: 'declareHeroic', model: 'dr', action: 'Heroic March' },
      { type: 'passHeroic', seat: 'p2' },
      { type: 'passHeroic', seat: 'p1' },
    );
    expect(s.flow.heroics.map(h => h.action)).toEqual(['Heroic March']);
    expect(moveAllowance(s, s.models.o)).toBe(9);
    expect(moveAllowance(s, s.models.man)).toBe(6);
    s = run(s, { type: 'moveModels', moves: [{ id: 'o', x: 29, y: 10 }] });
    expect(s.models.o.x).toBeLessThanOrEqual(23.1);
  });
});

describe('moving through terrain', () => {
  it('lets a Woodland Creature walk through woods at full pace', () => {
    const wood = { id: 'w', kind: 'wood', shape: 'rect', x: 15, y: 10, w: 10, h: 10, rot: 0, locked: false } as Terrain;
    const s = at([mk('m', 'p1', 5, 10, '[mordor] wood')], [wood]);
    const ground = terrainRules(catalog, s.models.m);
    expect(ground).toEqual(['wood']);
    expect(moveCost(s, { x: 12, y: 10 }, { x: 16, y: 10 }).cost).toBeCloseTo(8);
    expect(moveCost(s, { x: 12, y: 10 }, { x: 16, y: 10 }, 'p1', 0, 1.1, ground).cost).toBeCloseTo(4);
  });
});
