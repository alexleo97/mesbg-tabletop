import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { brokenTests, terrorAhead } from '../src/shared/courage.ts';
import { pendingSpell, settleSpell } from '../src/shared/magic.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { cannotAct, effectNotes, recoveryDue, recoveryRolls, under } from '../src/shared/powers.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { moveCost } from '../src/shared/sight.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const unit = (name: string, stats: string[], rules: string[] = [], wargear: string[] = []) => ({ name, army: 'Test', origin: 'Test', type: 'Warrior', points: 5, stats, options: [], rules, wargear });
const catalog = {
  armies: {},
  source: '',
  units: {
    orc: unit('Mordor Orc Warrior', ['6"', '3', '5+', '3', '4', '1', '1', '7+', '7+']),
    man: unit('Warrior of Minas Tirith', ['6"', '3', '4+', '3', '5', '1', '1', '6+', '7+']),
    knight: unit('Knight of Minas Tirith', ['6"', '4', '4+', '3', '6', '1', '1', '7+', '7+'], [], ['Horse']),
    wraith: unit('Barrow-wight', ['6"', '3', '4+', '4', '7', '1', '1', '7+', '7+']),
    warg: unit('Wild Warg', ['10"', '3', '-', '4', '4', '1', '1', '3+', '7+']),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId: 'man', ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
/** Resolves a request with these dice (then 1s), applying what comes back. */
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};
const game = (models: Model[]) =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const caster = (extra: Partial<Model> = {}) => mk('shaman', 'p1', 10, 30, { hero: true, will: 3, might: 1, ...extra });
const cast = (target: string, power: string, will = 1): Action => ({ type: 'cast', model: 'shaman', target, power, cv: 4, will });

describe('power effects', () => {
  it('Transfix holds its target until the End phase: no moving, shooting, heroics or strikes', () => {
    let s = game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc', hero: true, might: 1 })]);
    s = ask(s, 'p1', cast('orc', 'Transfix'), [6])!;
    expect(under(s, s.models.orc, 'Transfix')).toBe(true);
    expect(cannotAct(s, s.models.orc)).toBe(true);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(moveAllowance(s, s.models.orc)).toBe(0);
    expect(run(s, { type: 'declareHeroic', model: 'orc', action: 'Heroic Move' }).models.orc.might).toBe(1);
    // It fights back but makes no strikes when it wins.
    s = run(s, { type: 'endActivation', seat: 'p2' }, { type: 'setPhase', phase: 'fight' }, { type: 'moveModels', moves: [] });
    const fight = { sides: [[{ id: 'shaman', name: 'shaman', f: 3, a: 1, s: 3, d: 5 }], [{ id: 'orc', name: 'orc', f: 5, a: 1, s: 3, d: 4 }]], targets: ['orc', 'shaman'], trapped: false };
    s = ask(s, 'p1', { type: 'fight', fight } as Action, [1, 6])!;
    const group = s.log.at(-1)!.group!;
    s = ask(s, 'p1', { type: 'strikes', fight, group } as Action, [6, 6])!;
    expect(s.log.at(-1)?.note).toMatch(/No strikes from orc \(Transfixed\)/);
    expect(s.models.shaman.dead).toBe(false);
    // Gone by the End phase.
    s = run(s, { type: 'setPhase', phase: 'end' });
    expect(under(s, s.models.orc, 'Transfix')).toBe(false);
  });

  it('Black Dart hits at Strength 6 and takes the wound', () => {
    const s = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Black Dart'), [6, 4])!;
    expect(s.log.some(r => /S6 hit on orc \(3\+\)/.test(r.label))).toBe(true);
    expect(s.models.orc.dead).toBe(true);
  });

  it('leaves a war beast where it is and on its feet: no Call Winds, Transfix or knocking it down', () => {
    const beast = { profileId: 'orc', beast: 'war' as const, base: { shape: 'rect' as const, w: 100, h: 150 }, wounds: 10, maxWounds: 10 };
    let s = ask(game([caster(), mk('mumak', 'p2', 10, 20, beast)]), 'p1', cast('mumak', 'Call Winds'), [6, 3])!;
    expect(s.models.mumak).toMatchObject({ x: 10, y: 20 });
    expect(s.models.mumak.prone).toBeFalsy();
    expect(s.log.at(-1)?.note).toMatch(/unaffected/);
    s = ask(game([caster(), mk('mumak', 'p2', 10, 20, beast)]), 'p1', cast('mumak', 'Transfix'), [6])!;
    expect(under(s, s.models.mumak, 'Transfix')).toBe(false);
    s = ask(game([caster(), mk('mumak', 'p2', 10, 20, beast)]), 'p1', cast('mumak', 'Sorcerous Blast'), [6, 1])!;
    expect(s.models.mumak.prone).toBeFalsy();
  });

  it('Sorcerous Blast knocks a survivor Prone; standing up costs half its Move and a Prone loser is trapped', () => {
    let s = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Sorcerous Blast'), [6, 1])!;
    expect(s.models.orc.prone).toBe(true);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(moveAllowance(s, s.models.orc)).toBe(3);
    s = run(s, { type: 'moveModels', moves: [{ id: 'orc', x: 10, y: 14 }] });
    expect(s.models.orc.prone).toBeUndefined();
    expect(s.models.orc.y).toBeCloseTo(21);
    expect(moveAllowance(s, s.models.orc)).toBe(3);
  });

  it('a rider knocked down is thrown: on foot, Prone, a Strength 3 hit, and nothing more this turn', () => {
    const s = ask(game([caster(), mk('knight', 'p2', 10, 24, { profileId: 'knight', base: { shape: 'oval', w: 50, h: 100 }, move: 10 })]), 'p1', cast('knight', 'Panic Steed'), [6, 1])!;
    const k = s.models.knight;
    expect(k).toMatchObject({ dismounted: true, prone: true, move: 6, base: { w: 25, h: 25 }, stunned: 1 });
    expect(s.log.some(r => /Knocked flying: S3 hit/.test(r.label))).toBe(true);
    expect(cannotAct(s, k)).toBe(true);
  });

  it('Paralyse lasts until the model rolls a 6 in the End phase, with friends touching it helping', () => {
    let s = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' }), mk('pal', 'p2', 10 + 25 / 25.4, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Paralyse'), [6])!;
    expect(s.models.orc.prone).toBe(true);
    s = run(s, { type: 'setPhase', phase: 'end' });
    expect(recoveryDue(s)).toBe(true);
    const seq = [2, 6];
    s = run(s, ...recoveryRolls(s, () => seq.shift()!, uid));
    expect(under(s, s.models.orc, 'Paralyse')).toBe(false);
    expect(s.log.at(-1)?.label).toMatch(/pal helps orc/);
    expect(recoveryDue(s)).toBe(false);
  });

  it('Exhaustion powers end when the caster runs out of Will', () => {
    let s = ask(game([caster({ will: 2 }), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('shaman', 'Aura of Command'), [6])!;
    expect(under(s, s.models.shaman, 'Aura of Command')).toBe(true);
    s = run(s, { type: 'spendWill', id: 'shaman', count: 1 });
    expect(under(s, s.models.shaman, 'Aura of Command')).toBe(false);
  });

  it('Aura of Command passes Courage tests nearby; Drain Courage makes them harder', () => {
    let s = game([caster({ will: 3 }), mk('man', 'p1', 12, 30), mk('far', 'p1', 40, 40), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]);
    s = ask(s, 'p1', cast('shaman', 'Aura of Command'), [6])!;
    const out = brokenTests(s, 'p1', catalog, () => 1, uid);
    const results = (out.find(a => a.type === 'courageTaken') as Extract<Action, { type: 'courageTaken' }>).results;
    expect(results).toMatchObject({ shaman: true, man: true, far: false });
    const drained = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Drain Courage'), [6])!;
    expect(drained.models.orc.drained).toBe(1);
    const tests = brokenTests(drained, 'p2', catalog, () => 4, uid);
    expect(tests.find(a => a.type === 'rolled' && a.roll.model === 'orc')).toMatchObject({ roll: { sum: 8 } });
  });

  it('Instil Fear makes nearby enemies test to charge anyone', () => {
    let s = ask(game([caster(), mk('man', 'p1', 20, 30), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('shaman', 'Instil Fear'), [6])!;
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(terrorAhead(s, s.models.orc, { x: 10, y: 30 - 25 / 25.4 }, catalog)?.id).toBe('shaman');
  });

  it('Compel lets the caster move the target half its Move, then it stays put', () => {
    let s = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Compel'), [6])!;
    expect(s.flow.compel).toMatchObject({ model: 'orc', max: 3 });
    s = run(s, { type: 'moveModels', moves: [{ id: 'orc', x: 10, y: 34 }] });
    expect(s.models.orc.y).toBeCloseTo(27);
    s = run(s, { type: 'compel', compel: null }, { type: 'endActivation', seat: 'p1' });
    expect(moveAllowance(s, s.models.orc)).toBe(0);
  });

  it('Bladewrath and Enchant Blades change the strikes of a friend', () => {
    let s = game([caster(), mk('man', 'p1', 10, 26), mk('orc', 'p2', 10, 25, { profileId: 'orc' })]);
    s = ask(s, 'p1', cast('man', 'Bladewrath'), [6])!;
    s = run(s, { type: 'setPhase', phase: 'fight' });
    const fight = { sides: [[{ id: 'man', name: 'man', f: 3, a: 1, s: 3, d: 5 }], [{ id: 'orc', name: 'orc', f: 3, a: 1, s: 3, d: 4 }]], targets: ['orc', 'man'], trapped: false };
    s = ask(s, 'p1', { type: 'fight', fight } as Action, [6, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight, group: s.log.at(-1)!.group! } as Action, [3])!;
    expect(s.log.some(r => /\(3\+\)/.test(r.label) && r.against === 'orc')).toBe(true);
  });

  it('Protection of the Valar keeps enemy powers off and makes shots harder; Blinding Light makes them need 6s', () => {
    let s = game([caster(), mk('man', 'p1', 14, 30), mk('archer', 'p2', 10, 14, { profileId: 'orc' })]);
    s = ask(s, 'p1', cast('man', 'Protection of the Valar'), [6])!;
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    const shot = (target: string) => ({ type: 'shoot', shot: { shooter: { id: 'archer', name: 'archer', weapon: 'Orc bow', shoot: 5, s: 2, shots: 1 }, target: { id: target, name: target, d: 5 }, obstacles: 0 } }) as Action;
    expect(ask(s, 'p2', shot('man'), [1])!.log.at(-1)?.label).toMatch(/\(Orc bow, 6\+\)|6\+/);
    let b = ask(game([caster(), mk('man', 'p1', 14, 30), mk('archer', 'p2', 10, 14, { profileId: 'orc' })]), 'p1', cast('shaman', 'Blinding Light'), [6])!;
    b = run(b, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    expect(ask(b, 'p2', { ...shot('man'), shot: { ...(shot('man') as { shot: object }).shot, shooter: { id: 'archer', name: 'archer', weapon: 'Orc bow', shoot: 4, s: 2, shots: 1 } } } as Action, [5])!.log.some(r => /orc bow, 6\+/i.test(r.label))).toBe(true);
  });

  it("Nature's Wrath knocks every enemy in range down, and the toughest-willed one resists for all", () => {
    let s = game([caster(), mk('a', 'p2', 10, 24, { profileId: 'orc' }), mk('b', 'p2', 14, 24, { profileId: 'orc', hero: true, will: 2 }), mk('c', 'p2', 40, 5, { profileId: 'orc' })]);
    s = ask(s, 'p1', { type: 'cast', model: 'shaman', target: 'shaman', power: "Nature's Wrath", cv: 4, will: 1 }, [6])!;
    expect(pendingSpell(s)?.target.id).toBe('b');
    s = ask(s, 'p2', { type: 'resist', will: 0 }, [])!;
    expect([s.models.a.prone, s.models.b.prone, s.models.c.prone]).toEqual([true, true, undefined]);
  });

  it('Writhing Vines make the ground near them difficult for the enemy only', () => {
    let s = ask(game([caster(), mk('orc', 'p2', 10, 20, { profileId: 'orc' })]), 'p1', cast('shaman', 'Writhing Vines'), [6])!;
    const vines = Object.values(s.terrain).find(t => t.vines)!;
    expect(vines.side).toBe('p1');
    const a = { x: vines.x - 1, y: vines.y };
    const b = { x: vines.x + 1, y: vines.y };
    expect(moveCost(s, a, b, 'p2').cost).toBeCloseTo(4);
    expect(moveCost(s, a, b, 'p1').cost).toBeCloseTo(2);
    s = run(s, { type: 'setPhase', phase: 'end' });
    expect(Object.values(s.terrain).some(t => t.vines)).toBe(false);
  });

  it('Banishment only works on Spirits; Wither can slay; Renew heals; Curse takes Fate', () => {
    const s = game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' }), mk('wight', 'p2', 14, 24, { profileId: 'wraith', wounds: 2, maxWounds: 2 })]);
    expect(ask(s, 'p1', cast('orc', 'Banishment'), [6])).toBeNull();
    expect(ask(s, 'p1', cast('wight', 'Banishment'), [6])!.models.wight.wounds).toBe(1);
    const weak = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc', withered: 2 })]), 'p1', cast('orc', 'Wither'), [6])!;
    expect(weak.models.orc.dead).toBe(true);
    const hurt = ask(game([caster(), mk('man', 'p1', 10, 26, { wounds: 1, maxWounds: 2 }), mk('orc', 'p2', 30, 4)]), 'p1', cast('man', 'Renew'), [6])!;
    expect(hurt.models.man.wounds).toBe(2);
    const fated = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc', hero: true, fate: 2 })]), 'p1', cast('orc', 'Curse'), [6])!;
    expect(fated.models.orc.fate).toBe(1);
  });

  it('Fortify Spirit gives a free resist die even with no Will', () => {
    let s = game([mk('shaman', 'p2', 10, 30, { hero: true, will: 3 }), caster({ owner: 'p1', id: 'sage', name: 'sage', x: 30 } as Partial<Model>), mk('man', 'p1', 10, 26)]);
    s = run(s, { type: 'affect', id: 'man', patch: { effects: [{ power: 'Fortify Spirit', by: 'sage', turn: 1, duration: 'Exhaustion' }] } }, { type: 'endActivation', seat: 'p1' });
    s = ask(s, 'p2', { type: 'cast', model: 'shaman', target: 'man', power: 'Transfix', cv: 4, will: 1 }, [4])!;
    expect(pendingSpell(s)?.target.id).toBe('man');
    s = ask(s, 'p1', { type: 'resist', will: 0 }, [5])!;
    expect(s.log.at(-1)?.note).toMatch(/^Resisted/);
    expect(effectNotes(s, catalog, s.models.man)[0]).toMatch(/Fortify Spirit \(sage\)/);
  });

  it('a cast lifted by Might that nobody can resist waits for the game, then works', () => {
    let s = ask(game([caster(), mk('orc', 'p2', 10, 24, { profileId: 'orc' })]), 'p1', cast('orc', 'Transfix'), [3])!;
    s = run(s, { type: 'useMight', roll: s.log.at(-1)!.id, die: 0 });
    expect(s.flow.spell?.ready).toBe(true);
    s = run(s, ...settleSpell(s, catalog, () => 1, uid));
    expect(s.flow.spell).toBeUndefined();
    expect(under(s, s.models.orc, 'Transfix')).toBe(true);
  });
});
