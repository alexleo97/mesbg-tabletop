import { describe, expect, it } from 'vitest';
import { duelLeader, resolveStrikes, type Fighter, type FightRequest } from '../src/shared/fight.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { adjustFight, resolveRequest } from '../src/shared/resolve.ts';
import { planShot } from '../src/shared/shooting.ts';
import { canSupport } from '../src/shared/support.ts';
import { brokenTests, standFastRange, terrorTest } from '../src/shared/courage.ts';
import { finalBlows, shrugOff, standardRefunds, towersFight } from '../src/shared/towers.ts';
import { bannerFor, fighterOf, twoHandedChoice } from '../src/shared/wargear.ts';
import { hasElvenWeapon } from '../src/shared/gear.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const H = "[defenders-of-helm's-deep]";
const E = '[riders-of-eomer]';
const U = "[assault-upon-helm's-deep]";
const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const hero = (id: string, x: number, y: number, profileId: string, extra: Partial<Model> = {}) => mk(id, 'p1', x, y, profileId, { hero: true, might: 3, will: 3, fate: 3, wounds: 3, maxWounds: 3, ...extra });
const rider = (id: string, owner: Seat, x: number, y: number, profileId: string, mount: string, extra: Partial<Model> = {}) => mk(id, owner, x, y, profileId, { base: { shape: 'oval', w: 50, h: 100 }, mount, mountWounds: 1, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const at = (models: Model[]) => run(initialState(), { type: 'addModels', models });
const STEP = 0.99;
let n = 0;
const uid = () => `u${n++}`;
const dice = (list: number[]) => {
  const seq = [...list];
  return () => seq.shift() ?? 1;
};
const ask = (s: GameState, seat: Seat, a: Action, rolls: number[] = []) => {
  const out = resolveRequest(s, seat, a, dice(rolls), uid, 1, catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};
/** A battle in the given phase, Priority to Good, heroics passed. */
const battle = (models: Model[], phase: 'move' | 'shoot' | 'fight' = 'fight') =>
  run(at(models), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, ...(phase === 'move' ? [] : ([{ type: 'setPhase', phase }] as Action[])), { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
/** How a model fights here, with its rules from towers.ts. */
const fights = (s: GameState, id: string, choice: { twoHanded?: boolean; shielding?: boolean } = {}, extra: Partial<Fighter> = {}) => {
  const out = { ...fighterOf(s, catalog, s.models[id], choice), ...extra };
  towersFight(s, catalog, s.models[id], out);
  return out;
};
const slain = (id: string, by: string): Model => mk(id, 'p2', 40, 40, `${U} uruk-hai-warrior`, { dead: true, wounds: 0, killedBy: { ids: [by], how: 'fight' } });

describe("Helm's Deep heroes in a fight", () => {
  it("Gimli: two axes for 3 Attacks, or the master-forged axe with no duel penalty", () => {
    const s = battle([hero('gimli', 10, 10, `${H} gimli`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    expect(fights(s, 'gimli')).toMatchObject({ a: 3 });
    const two = fights(s, 'gimli', { twoHanded: true });
    expect(two.a).toBe(2);
    expect(two.duelMod).toBeUndefined();
    expect(two.woundMod).toBe(1);
  });

  it('Gimli and Legolas: whoever is behind in the count gets +1 to wound', () => {
    const models = [hero('gimli', 10, 10, `${H} gimli`, { name: 'Gimli' }), hero('legolas', 20, 10, `${H} legolas`, { name: 'Legolas' }), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`), mk('o', 'p2', 30, 10, `${U} uruk-hai-warrior`)];
    const level = battle(models);
    expect(fights(level, 'gimli').woundMod).toBeUndefined();
    const behind = battle([...models, slain('k1', 'legolas')]);
    expect(fights(behind, 'gimli').woundMod).toBe(1);
    // Legolas, behind, wounds more easily with his shots.
    const ahead = run(battle([...models, slain('k1', 'gimli')], 'shoot'));
    expect(planShot(ahead, catalog, ahead.models.legolas, ahead.models.o).woundBonus).toBe(1);
    expect(planShot(behind, catalog, behind.models.legolas, behind.models.o).woundBonus).toBeUndefined();
  });

  it("Haleth: 2 Attacks near Aragorn, and Fight to the Last lifts the Rohirrim near him while he fights", () => {
    const models = [
      hero('haleth', 10, 10, `${H} haleth-son-of-hama`),
      hero('aragorn', 14, 10, `${H} aragorn-strider`, { name: 'Aragorn' }),
      mk('w', 'p1', 10, 14, `${H} warrior-of-rohan`, { options: ['Shield'] }),
      mk('far', 'p1', 10, 30, `${H} warrior-of-rohan`, { options: ['Shield'] }),
      mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`),
    ];
    const s = battle(models);
    expect(fights(s, 'haleth').a).toBe(2);
    expect(s.flow.pairs?.some(k => k.includes('haleth'))).toBe(true);
    const base = fighterOf(s, catalog, s.models.w).f;
    expect(fights(s, 'w').f).toBe(base + 1);
    expect(fights(s, 'aragorn').f).toBe(fighterOf(s, catalog, s.models.aragorn).f + 1);
    expect(fights(s, 'far').f).toBe(base);
    // Not when he wasn't in a fight as the phase began.
    const calm = battle(models.filter(m => m.id !== 'u'));
    expect(fights(calm, 'w').f).toBe(base);
    // Nor with Aragorn away: 1 Attack.
    const alone = battle([models[0], models[4]]);
    expect(fights(alone, 'haleth').a).toBe(1);
  });

  it('Arise, Riders of Rohan!: +1 Fight on the charge near Théoden', () => {
    const models = [hero('theoden', 10, 30, `${H} theoden`), rider('r', 'p1', 10, 20, `${E} rider-of-rohan`, 'Horse'), mk('u', 'p2', 10 + 1.4, 20, `${U} uruk-hai-warrior`)];
    const s = battle(models);
    const f = fighterOf(s, catalog, s.models.r).f;
    expect(fights(s, 'r', {}, { charged: 'cavalry' }).f).toBe(f + 1);
    expect(fights(s, 'r').f).toBe(f);
    const far = battle([{ ...models[0], y: 45 }, models[1], models[2]]);
    expect(fights(far, 'r', {}, { charged: 'cavalry' }).f).toBe(f);
  });

  it("Herugrim: a fight drawn on the dice at Théoden's Fight value goes to him", () => {
    const roll = (side: 0 | 1, f: number, d: number, edge = false): DiceRoll => ({ id: `r${side}`, by: 'p1', label: '', dice: [d], at: 0, group: 'f-x', side, f, ...(edge ? { edge: true } : {}) });
    expect(duelLeader([roll(0, 5, 4, true), roll(1, 5, 4)])).toEqual({ winner: 0, how: 'fight' });
    expect(duelLeader([roll(0, 5, 4), roll(1, 5, 4)])).toBeNull();
    const s = battle([hero('theoden', 10, 10, `${H} theoden`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    expect(fights(s, 'theoden').edge).toBe(true);
  });

  it("Gúthwinë: each 6 to wound rolls one more, and the Price of Grief once Théoden falls", () => {
    const s = battle([hero('eomer', 10, 10, `${E} eomer`), hero('theoden', 30, 10, `${H} theoden`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    const eomer = fights(s, 'eomer');
    expect(eomer.sixesAgain).toBe(true);
    expect(eomer.reroll).toBeUndefined();
    const req: FightRequest = { sides: [[{ ...eomer, a: 2 }], [{ id: 'u', name: 'u', f: 4, a: 1, s: 4, d: 10 }]], targets: ['u', 'eomer'], trapped: false };
    const duel: DiceRoll[] = [{ id: 'f-x-0', by: 'p1', label: 'Duel', dice: [6], at: 0, group: 'f-x', side: 0, f: 5, model: 'eomer' }, { id: 'f-x-1', by: 'p2', label: 'Duel', dice: [1], at: 0, group: 'f-x', side: 1, f: 4, model: 'u' }];
    // S4 v D10 needs 6/5+: a 6 (then a 5) and a 2; the 6 earns another roll, a 6 then a 6.
    const { rolls } = resolveStrikes(req, duel, dice([6, 2, 5, 6, 6]), 'p1', 'f-x');
    expect(rolls.map(r => r.label)).toEqual([expect.stringMatching(/strikes u/), expect.stringMatching(/^Gúthwinë/)]);
    expect(rolls[1].dice).toEqual([6]);
    const grief = battle([hero('eomer', 10, 10, `${E} eomer`), hero('theoden', 30, 10, `${H} theoden`, { dead: true, wounds: 0 }), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    expect(fights(grief, 'eomer').reroll).toBe(true);
  });

  it('Glamdring gives Gandalf +1 Strength', () => {
    const s = battle([hero('g', 10, 10, `${E} gandalf-the-white`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    expect(fights(s, 'g').s).toBe(fighterOf(s, catalog, s.models.g).s + 1);
    // An Elven hand-and-a-half weapon: the Elven blade in a drawn fight, and two-handed if he chooses.
    expect(hasElvenWeapon(catalog, s.models.g)).toBe(true);
    expect(twoHandedChoice(catalog, s.models.g)).toBe('may');
  });

  it('Berserker Blade: two-handed against more foes than Attacks, one strike at each', () => {
    const s = battle([mk('b', 'p2', 10, 10, `${U} uruk-hai-berserker`), mk('x', 'p1', 10 + STEP, 10, `${H} warrior-of-rohan`), mk('y', 'p1', 10 - STEP, 10, `${H} warrior-of-rohan`), mk('z', 'p1', 10, 10 + STEP, `${H} warrior-of-rohan`)]);
    const b = fights(s, 'b', { twoHanded: true });
    expect(b.sweep).toBe(true);
    expect(b.a).toBe(2);
    const foes = ['x', 'y', 'z'].map(id => ({ id, name: id, f: 3, a: 1, s: 3, d: 5 }));
    const req: FightRequest = { sides: [foes, [b]], targets: ['b', 'x'], trapped: false };
    const duel: DiceRoll[] = [{ id: 'f-y-0', by: 'p2', label: 'Duel', dice: [6], at: 0, group: 'f-y', side: 1, f: 5, model: 'b' }, ...foes.map((f, i): DiceRoll => ({ id: `f-y-${i + 1}`, by: 'p1', label: 'Duel', dice: [1], at: 0, group: 'f-y', side: 0, f: 3, model: f.id }))];
    const { rolls } = resolveStrikes(req, duel, dice([6, 6, 6]), 'p2', 'f-y');
    expect(rolls.filter(r => r.label.startsWith('Berserker Blade')).map(r => r.against)).toEqual(['x', 'y', 'z']);
    // Not one-handed.
    expect(fights(s, 'b').sweep).toBeUndefined();
  });

  it('Spear Mastery: throwing spears support in the Fight phase, unless thrown', () => {
    const s = battle([mk('w', 'p1', 10, 10, `${H} warrior-of-rohan`, { options: ['Shield and throwing spears'] }), mk('v', 'p1', 20, 10, `${H} warrior-of-rohan`, { options: ['Shield'] })]);
    expect(canSupport(s, catalog, s.models.w)).toBe(true);
    expect(canSupport(s, catalog, s.models.v)).toBe(false);
    expect(canSupport({ ...s, flow: { ...s.flow, shot: ['w'] } }, catalog, s.models.w)).toBe(false);
  });

  it("The Royal Standard of Rohan: no duel penalty, a 6\" reach, and Might back on a 6", () => {
    const models = [hero('gamling', 10, 10, `${H} gamling`, { options: ['Royal Standard of Rohan'] }), hero('theoden', 15, 10, `${H} theoden`), mk('u', 'p2', 15 + STEP, 10, `${U} uruk-hai-warrior`)];
    const s = battle(models);
    expect(fighterOf(s, catalog, s.models.gamling).duelMod).toBeUndefined();
    const r: DiceRoll = { id: 'f-z-0', by: 'p1', label: 'Duel', dice: [1], at: 0, group: 'f-z', side: 0, f: 5, model: 'theoden' };
    const t = { ...s, log: [r, { ...r, id: 'f-z-1', side: 1 as const, dice: [6], model: 'u', by: 'p2' as const }] };
    expect(bannerFor(t, catalog, r, 'p1')?.id).toBe('gamling');
    const spent = run(s, { type: 'affect', id: 'theoden', patch: { might: 2 } });
    const back = standardRefunds(s, spent, catalog, dice([6]), uid, 1);
    expect(back.at(-1)).toMatchObject({ type: 'affect', id: 'theoden', patch: { might: 3 } });
    expect(standardRefunds(s, spent, catalog, dice([5]), uid, 1).filter(a => a.type === 'affect')).toEqual([]);
    // Too far from it: no roll.
    const far = battle([{ ...models[0], x: 30 }, models[1], models[2]]);
    expect(standardRefunds(far, run(far, { type: 'affect', id: 'theoden', patch: { might: 2 } }), catalog, dice([6]), uid, 1)).toEqual([]);
  });

  it("Haldir's One Final Blow: a Strength 4 hit on each foe in his fight when he falls", () => {
    const s = battle([hero('haldir', 10, 10, `${H} haldir-galadhrim-captain`, { fate: 0, might: 0, wounds: 1 }), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`), mk('v', 'p2', 10 - STEP, 10, `${U} uruk-hai-warrior`)]);
    const after = run(s, { type: 'wound', id: 'haldir', count: 1, by: ['u'], how: 'fight' });
    expect(after.models.haldir.dead).toBe(true);
    const out = finalBlows(s, after, catalog, dice([6, 1]), uid, 1);
    expect(out.filter(a => a.type === 'rolled')).toHaveLength(2);
    expect(out.filter(a => a.type === 'wound').map(a => (a as { id: string }).id)).toEqual(['u']);
  });
});

describe("Helm's Deep heroes shooting", () => {
  const foes = [mk('o1', 'p2', 30, 10, `${U} uruk-hai-warrior`), mk('o2', 'p2', 30, 14, `${U} uruk-hai-warrior`)];
  const shoot = (shooter: string, target: string, extra: object = {}): Action => ({ type: 'shoot', shot: { shooter: { id: shooter, name: shooter, weapon: 'Elf bow', shoot: 3, s: 3, shots: 1 }, target: { id: target, name: target, d: 4 }, obstacles: 0, ...extra } }) as Action;

  it('Legolas makes three Shooting Attacks, Haldir two', () => {
    let s = battle([hero('legolas', 10, 10, `${H} legolas`, { might: 0 }), hero('haldir', 10, 14, `${H} haldir-galadhrim-captain`, { might: 0, options: ['Heavy armour', 'Elf bow'] }), ...foes], 'shoot');
    for (let i = 0; i < 3; i++) {
      expect(planShot(s, catalog, s.models.legolas, s.models.o1).why).toBeUndefined();
      s = ask(s, 'p1', shoot('legolas', 'o2'), [1])!;
    }
    expect(planShot(s, catalog, s.models.legolas, s.models.o1).why).toBe('has shot this turn');
    for (let i = 0; i < 2; i++) s = ask(s, 'p1', shoot('haldir', 'o1'), [1])!;
    expect(planShot(s, catalog, s.models.haldir, s.models.o1).why).toBe('has shot this turn');
  });

  it('Deadly Shot: Legolas shoots from a fight, at the foe he fights with nothing in the way', () => {
    const s = battle([hero('legolas', 10, 10, `${H} legolas`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`), ...foes], 'shoot');
    const plan = planShot(s, catalog, s.models.legolas, s.models.u);
    expect(plan.why).toBeUndefined();
    expect(plan.inWay).toEqual([]);
    expect(plan.fight).toBeUndefined();
    // A plain archer can't.
    const t = battle([mk('a', 'p1', 10, 10, `${H} warrior-of-rohan`, { options: ['Bow'] }), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`), ...foes], 'shoot');
    expect(planShot(t, catalog, t.models.a, t.models.o1).why).toBe('is in a fight');
  });

  it('Pinpoint Shot: one shot at a foe fighting a friend, and nothing else that phase', () => {
    let s = battle([hero('legolas', 10, 10, `${H} legolas`, { might: 0 }), mk('w', 'p1', 30 - STEP, 10, `${H} warrior-of-rohan`), ...foes], 'shoot');
    expect(planShot(s, catalog, s.models.legolas, s.models.o1).why).toMatch(/Good/);
    const plan = planShot(s, catalog, s.models.legolas, s.models.o1, { pinpoint: true });
    expect(plan).toMatchObject({ pinpoint: true, shots: 1, inWay: [] });
    expect(planShot(s, catalog, s.models.legolas, s.models.o2, { pinpoint: true }).why).toMatch(/in a fight with a friend/);
    s = ask(s, 'p1', shoot('legolas', 'o1', { pinpoint: true }), [6, 1])!;
    expect(s.log.find(r => r.model === 'legolas')?.pinpoint).toBe(true);
    expect(planShot(s, catalog, s.models.legolas, s.models.o2).why).toBe('has shot this turn');
  });

  it("Aldor shoots first and must re-roll his misses", () => {
    let s = battle([hero('aldor', 10, 10, `${H} aldor`, { might: 0 }), mk('a', 'p1', 10, 14, `${H} warrior-of-rohan`, { options: ['Bow'] }), ...foes], 'shoot');
    expect(planShot(s, catalog, s.models.a, s.models.o1).why).toMatch(/waits for aldor/);
    const plan = planShot(s, catalog, s.models.aldor, s.models.o1);
    expect(plan).toMatchObject({ lucky: true, bane: true });
    s = ask(s, 'p1', shoot('aldor', 'o1'), [1, 6, 1, 1])!;
    expect(s.log.some(r => r.label.includes('Lucky Shot'))).toBe(true);
    expect(planShot(s, catalog, s.models.a, s.models.o1).why).toBeUndefined();
  });
});

describe("Helm's Deep heroes: wounds, Fate and Courage", () => {
  it("Oblivious to Pain: a Berserker ignores a Wound on a 6", () => {
    const s = battle([mk('b', 'p2', 10, 10, `${U} uruk-hai-berserker`, { wounds: 2, maxWounds: 2 })]);
    const wound = { type: 'wound', id: 'b', count: 2, group: 'f-a' } as const;
    const out = shrugOff(s, catalog, wound, dice([6, 3]), uid, 1)!;
    expect(out.at(-1)).toMatchObject({ type: 'wound', count: 1, checked: true });
    const all = shrugOff(s, catalog, wound, dice([6, 6]), uid, 1)!;
    const after = run(s, ...all);
    expect(after.models.b.wounds).toBe(2);
    // Ticked off, so it isn't rolled for again.
    expect(shrugOff(after, catalog, wound, dice([1, 1]), uid, 1)).toBeNull();
    expect(shrugOff(after, catalog, { ...wound, checked: true }, dice([1]), uid, 1)).toBeNull();
  });

  it("Horse Lord: the mount shrugs off a Wound on a 6, then the rider's Fate saves it", () => {
    const s = battle([rider('c', 'p1', 10, 10, `${E} captain-of-rohan`, 'Horse', { hero: true, fate: 1, might: 1, will: 1, wounds: 2, maxWounds: 2 })]);
    const out = shrugOff(s, catalog, { type: 'wound', id: 'c', count: 1, mount: true }, dice([2, 5]), uid, 1)!;
    expect(out.find(a => a.type === 'affect')).toMatchObject({ patch: { fate: 0 } });
    expect(out.at(-1)).toMatchObject({ count: 0 });
    // A plain rider has no such luck.
    const r = battle([rider('r', 'p1', 10, 10, `${E} rider-of-rohan`, 'Horse')]);
    expect(shrugOff(r, catalog, { type: 'wound', id: 'r', count: 1, mount: true }, dice([6]), uid, 1)).toBeNull();
  });

  it("Shadowfax spends his own Fate, once, to save himself", () => {
    const s = battle([rider('g', 'p1', 10, 10, `${E} gandalf-the-white`, 'Shadowfax', { hero: true, fate: 3, might: 3, will: 6, wounds: 3, maxWounds: 3 })]);
    const out = shrugOff(s, catalog, { type: 'wound', id: 'g', count: 1, mount: true }, dice([1, 4]), uid, 1)!;
    // A 1, re-rolled with Narya to a 4: saved, and Gandalf's own Fate isn't touched.
    expect(out.at(-1)).toMatchObject({ count: 0 });
    expect(out.find(a => a.type === 'affect')).toMatchObject({ patch: { used: ['Shadowfax: Fate'] } });
    const after = run(s, ...out);
    expect(after.models.g.fate).toBe(3);
    expect(shrugOff(after, catalog, { type: 'wound', id: 'g', count: 1, mount: true, group: 'x' }, dice([6]), uid, 1)).toBeNull();
  });

  it('Narya: Gandalf rolls a failed Fate roll again', () => {
    let s = battle([hero('g', 10, 10, `${E} gandalf-the-white`)]);
    s = run(s, { type: 'wound', id: 'g', count: 1 });
    s = ask(s, 'p1', { type: 'rollFate', id: 'g' }, [2, 5])!;
    expect(s.models.g.pending ?? 0).toBe(0);
    expect(s.log.at(-1)?.label).toMatch(/Narya/);
  });

  it('Théoden calls Stand Fast! to 12"', () => {
    const s = battle([hero('theoden', 10, 10, `${H} theoden`), mk('w', 'p1', 20, 10, `${H} warrior-of-rohan`)]);
    expect(standFastRange(catalog, s.models.theoden)).toBe(12);
    // A Broken army's test: Théoden passes, and the warrior 10" away stands with him.
    const out = brokenTests(s, 'p1', catalog, dice([6, 6]), uid, 1);
    const results = (out.find(a => a.type === 'courageTaken') as { results: Record<string, boolean> }).results;
    expect(results).toEqual({ theoden: true, w: true });
    expect(out.filter(a => a.type === 'rolled' && (a as { roll: DiceRoll }).roll.model === 'w')).toEqual([]);
  });

  it("Snowmane: Théoden tests again to charge a terrifying foe", () => {
    const s = battle([rider('t', 'p1', 10, 10, `${H} theoden`, 'Snowmane', { hero: true, might: 0, will: 0 }), mk('troll', 'p2', 12, 10, `${U} isengard-troll`)], 'move');
    const { pass, actions } = terrorTest(s.models.t, s.models.troll, catalog, dice([1, 1, 6, 6]), uid, 1, s);
    expect(pass).toBe(true);
    expect(actions.filter(a => a.type === 'rolled')).toHaveLength(2);
  });
});

describe("Helm's Deep heroes: the fight request on the server", () => {
  it('adjusts the fighters it builds', () => {
    const s = battle([hero('gimli', 10, 10, `${H} gimli`), mk('u', 'p2', 10 + STEP, 10, `${U} uruk-hai-warrior`)]);
    const req: FightRequest = { sides: [[fighterOf(s, catalog, s.models.gimli)], [fighterOf(s, catalog, s.models.u)]], targets: ['u', 'gimli'], trapped: false };
    expect(adjustFight(s, req, catalog).sides[0][0].a).toBe(3);
  });
});
