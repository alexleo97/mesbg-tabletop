import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { entriesFor, modelStats } from '../src/shared/catalog.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { planShot } from '../src/shared/shooting.ts';
import { firingCrew, inArc, pushers, sabotageActions, scatter } from '../src/shared/siege.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const unit = (name: string, army: string, rules: string[] = [], stats = ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+'], type = 'Warrior', options: { id: string; name: string; points: number }[] = []) => ({ name, army, origin: army, type, points: 5, stats, options, rules, wargear: ['hand weapon'] });
const ENGINE = ['-', '-', '-', '10', '10', '-', '4', '-', '-'];
const catalog = {
  source: '',
  armies: { Mordor: { side: 'Evil', units: [], rules: [] }, Gondor: { side: 'Good', units: [], rules: [] } },
  units: {
    '[mordor] catapult': unit('Mordor War Catapult', 'Mordor', ['Arcing Shot', 'Severed Heads', 'Flaming Ammunition', 'Troll Loader', 'Area Effect', 'Wall-breaker'], ENGINE, 'Siege Engine', [{ id: 'O1', name: 'Severed Heads', points: 20 }]),
    '[mordor] bow': unit('Mordor Siege Bow', 'Mordor', ['Direct Shot', 'Accurate', 'Piercing Shot'], ['-', '-', '-', '8', '9', '-', '3', '-', '-'], 'Siege Engine'),
    '[gondor] trebuchet': unit('Battlecry Trebuchet', 'Gondor', ['Arcing Shot', 'Static'], ENGINE, 'Siege Engine'),
    '[gondor] avenger': unit('Avenger Bolt Thrower', 'Gondor', ['Direct Shot'], ['-', '-', '-', '7', '10', '-', '3', '-', '-'], 'Siege Engine'),
    '[mordor] orc': unit('Orc Warrior', 'Mordor', [], ['6"', '3', '5+', '3', '4', '1', '1', '7', '7+']),
    '[gondor] warrior': unit('Warrior of Minas Tirith', 'Gondor'),
    '[mordor] archer': { ...unit('Orc Archer', 'Mordor'), wargear: ['Orc bow', 'hand weapon'] },
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
/** A Mordor War Catapult at (x, y), facing up the table, with two of its crew at its sides. */
const catapult = (x: number, y: number, extra: Partial<Model> = {}) => [
  mk('cat', 'p2', x, y, '[mordor] catapult', { name: 'Mordor War Catapult', siege: 'large', move: 0, wounds: 4, maxWounds: 4, base: { shape: 'rect', w: 60, h: 60 }, ...extra }),
  mk('c1', 'p2', x - 1.7, y, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' }),
  mk('c2', 'p2', x + 1.7, y, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' }),
];
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
/** The game started, in the given phase, with Evil (p2) to move. */
const begin = (models: Model[], phase: 'move' | 'shoot' = 'shoot') =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, ...(phase === 'shoot' ? [{ type: 'setPhase', phase: 'shoot' } as Action] : []));
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 6, uid, Date.now(), catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};
const shoot = (s: GameState, shooter: string, target: string, dice: number[], extra: object = {}) =>
  ask(s, 'p2', { type: 'shoot', shot: { shooter: { id: shooter, name: shooter, weapon: '', shoot: 4, s: 10, shots: 1 }, target: { id: target, name: target, d: 5 }, obstacles: 0, ...extra } } as Action, dice);

describe('siege engines', () => {
  it('comes with its crew, who have their own profile', () => {
    const entries = entriesFor('[mordor] catapult', catalog.units['[mordor] catapult'], [], 1);
    expect(entries.map(e => [e.name, e.count])).toEqual([['Mordor War Catapult', 1], ['Mordor Orc Siege Crew (Siege Veteran)', 1], ['Mordor Orc Siege Crew', 2], [expect.stringMatching(/Siege Troll/), 1]]);
    expect(entries[0].siege).toBe('large');
    expect(modelStats(catalog, { profileId: '[mordor] catapult', name: 'Mordor Orc Siege Crew' })).toMatchObject({ Fv: 3, Sv: 4, D: 4 });
  });

  it('needs two crew beside a large engine to shoot, on their Shoot value', () => {
    const [cat, c1, c2] = catapult(20, 40);
    const foe = mk('w', 'p1', 20, 10, '[gondor] warrior');
    expect(firingCrew(begin([cat, c1, foe]), catalog, cat)).toBeUndefined();
    expect(planShot(begin([cat, c1, foe]), catalog, cat, foe).why).toMatch(/two crew/);
    const s = begin([cat, c1, c2, foe]);
    const plan = planShot(s, catalog, s.models.cat, s.models.w);
    expect(plan.why).toBeUndefined();
    expect(plan.need).toBe(4);
  });

  it('only shoots within its 45° Arc of Sight, and not inside its least range', () => {
    const [cat, c1, c2] = catapult(20, 40);
    expect(inArc(cat, { x: 20, y: 10 })).toBe(true);
    expect(inArc(cat, { x: 40, y: 30 })).toBe(false);
    const s = begin([cat, c1, c2, mk('side', 'p1', 45, 38, '[gondor] warrior'), mk('near', 'p1', 20, 34, '[gondor] warrior')]);
    expect(planShot(s, catalog, s.models.cat, s.models.side).why).toBeDefined();
    expect(planShot(s, catalog, s.models.cat, s.models.near).why).toBeDefined();
  });

  it('slays a warrior it wounds outright, and its blast hits and knocks flat everyone within 2"', () => {
    const s = begin([...catapult(20, 40), mk('w', 'p1', 20, 10, '[gondor] warrior'), mk('b', 'p1', 21.5, 10, '[gondor] warrior')]);
    // Hit 5, scatter 6 (dead on), wound 6; blast: hit 6 then wound 6.
    const after = shoot(s, 'cat', 'w', [5, 6, 6, 6, 6, 6])!;
    expect(after.models.w.dead).toBe(true);
    expect(after.models.b.dead).toBe(true);
    expect(after.flow.shot).toContain('cat');
  });

  it('veers off and is lost on a miss', () => {
    const s = begin([...catapult(20, 40), mk('w', 'p1', 20, 10, '[gondor] warrior')]);
    const after = shoot(s, 'cat', 'w', [2])!;
    expect(after.models.w.dead).toBe(false);
    expect(after.flow.shot).toContain('cat');
  });

  it('scatters on anything but a 6: the opponent picks where, and a 1 can miss completely', () => {
    const s = begin([...catapult(20, 40), mk('w', 'p1', 20, 10, '[gondor] warrior'), mk('o', 'p1', 24, 10, '[gondor] warrior')]);
    expect(scatter(s, catalog, s.models.cat, s.models.w, 6)?.id).toBe('w');
    expect(scatter(s, catalog, s.models.cat, s.models.w, 1)?.id).not.toBe('w');
  });

  it('throws severed heads instead: no wound, but a Courage test for everyone near', () => {
    const [cat, c1, c2] = catapult(20, 40, { options: ['Severed Heads'] });
    const s = begin([cat, c1, c2, mk('w', 'p1', 20, 10, '[gondor] warrior'), mk('b', 'p1', 21.5, 10, '[gondor] warrior')]);
    // Hit, dead on, then Courage 1+1 for one (flees) and 6+6 for the other.
    const after = shoot(s, 'cat', 'w', [5, 6, 1, 1, 6, 6], { heads: true })!;
    expect([after.models.w.dead, after.models.b.dead]).toEqual([true, false]);
  });

  it('flings a model its Piercing Shot hits but does not slay back', () => {
    const bow = mk('bow', 'p2', 20, 40, '[mordor] bow', { name: 'Mordor Siege Bow', siege: 'small', move: 0, wounds: 3, maxWounds: 3, base: { shape: 'rect', w: 40, h: 40 } });
    const crew = mk('c1', 'p2', 21.28, 40, '[mordor] bow', { name: 'Mordor Orc Siege Crew', crewOf: 'bow' });
    const s = begin([bow, crew, mk('w', 'p1', 20, 20, '[gondor] warrior')]);
    // Hit 5, dead on, wound fails (1), flung 4".
    const after = shoot(s, 'bow', 'w', [5, 6, 1, 4])!;
    expect(after.models.w.dead).toBe(false);
    expect(after.models.w.y).toBeCloseTo(16, 0);
    expect(after.models.w.prone).toBe(true);
  });

  it('looses a D6 bolts from an Avenger Bolt Thrower', () => {
    const av = mk('av', 'p2', 20, 40, '[gondor] avenger', { name: 'Avenger Bolt Thrower', siege: 'small', move: 0, wounds: 3, maxWounds: 3, base: { shape: 'rect', w: 40, h: 40 } });
    const crew = mk('c1', 'p2', 21.28, 40, '[gondor] avenger', { name: 'Minas Tirith Siege Crew', crewOf: 'av' });
    const s = begin([av, crew, mk('w', 'p1', 20, 20, '[mordor] orc')]);
    const after = shoot(s, 'av', 'w', [3, 1, 1, 1])!;
    expect(after.log.some(r => /bolts/i.test(r.label) || r.dice.length === 3)).toBe(true);
  });

  it('is pushed by friends beside it, who go with it, no further than the slowest', () => {
    const bow = mk('bow', 'p2', 20, 44, '[mordor] bow', { name: 'Mordor Siege Bow', siege: 'small', move: 0, wounds: 3, maxWounds: 3, base: { shape: 'rect', w: 40, h: 40 } });
    const a = mk('a', 'p2', 18.72, 44, '[mordor] orc', { move: 5 });
    const b = mk('b', 'p2', 21.28, 44, '[mordor] orc');
    let s = begin([bow, a], 'move');
    expect(pushers(s, s.models.bow)).toBeUndefined();
    s = begin([bow, a, b], 'move');
    expect(pushers(s, s.models.bow)?.move).toBe(5);
    s = run(s, { type: 'moveModels', moves: [{ id: 'bow', x: 20, y: 34 }] });
    expect(s.models.bow.y).toBeCloseTo(39);
    expect(s.models.a.y).toBeCloseTo(39);
    expect(s.models.b.y).toBeCloseTo(39);
  });

  it('turns to face a target, and then shoots 1 worse', () => {
    const [cat, c1, c2, , ] = catapult(20, 44);
    const c3 = mk('c3', 'p2', 20, 45.7, '[mordor] catapult', { name: 'Mordor Orc Siege Crew', crewOf: 'cat' });
    let s = begin([cat, c1, c2, c3, mk('w', 'p1', 46, 44, '[gondor] warrior')], 'move');
    s = run(s, { type: 'moveModels', moves: [{ id: 'cat', x: 20, y: 44, rot: 90 }] });
    expect(s.models.cat.rot).toBe(90);
    expect(s.flow.turned).toContain('cat');
    s = run(s, { type: 'setPhase', phase: 'shoot' });
    expect(planShot(s, catalog, s.models.cat, s.models.w).need).toBe(5);
  });

  it("can't move a Static engine", () => {
    const tre = mk('t', 'p2', 20, 44, '[gondor] trebuchet', { name: 'Battlecry Trebuchet', siege: 'large', move: 0, wounds: 4, maxWounds: 4, base: { shape: 'rect', w: 60, h: 60 } });
    const s = begin([tre, mk('a', 'p2', 18.33, 44, '[mordor] orc'), mk('b', 'p2', 21.67, 44, '[mordor] orc'), mk('c', 'p2', 20, 45.67, '[mordor] orc')], 'move');
    expect(run(s, { type: 'moveModels', moves: [{ id: 't', x: 20, y: 39 }] }).models.t.y).toBe(44);
  });

  it('is sabotaged as the turn ends by an enemy left beside it who did nothing else', () => {
    const [cat] = catapult(20, 44);
    let s = begin([cat, mk('w', 'p1', 20, 42.2, '[gondor] warrior')], 'move');
    s = run(s, { type: 'setPhase', phase: 'end' });
    const acts = sabotageActions(s, uid);
    expect(run(s, ...acts).models.cat.dead).toBe(true);
  });

  it("stops bows shooting across an Iron Hills Ballista's line", () => {
    let s = begin([mk('a', 'p2', 20, 40, '[mordor] archer'), mk('w', 'p1', 20, 25, '[gondor] warrior')]);
    expect(planShot(s, catalog, s.models.a, s.models.w).why).toBeUndefined();
    s = run(s, { type: 'cable', from: [10, 32], to: [30, 32] });
    expect(planShot(s, catalog, s.models.a, s.models.w).why).toMatch(/line/);
  });
  it('lets its Siege Veteran spend Might on a roll 1 short, unless told to keep it', () => {
    const [cat, c1, c2] = catapult(20, 44);
    const vet = { ...c1, id: 'vet', name: 'Mordor Orc Siege Crew (Siege Veteran)', hero: true, might: 1, will: 1, fate: 1 };
    const s = begin([cat, vet, c2, mk('w', 'p1', 20, 10, '[gondor] warrior')]);
    // To Hit 3 (needs 4), raised by the Veteran's Might; dead on; wounded.
    const after = shoot(s, 'cat', 'w', [3, 6, 6])!;
    expect(after.models.w.dead).toBe(true);
    expect(after.models.vet.might).toBe(0);
    const kept = shoot(s, 'cat', 'w', [3, 6, 6], { keepMight: true })!;
    expect(kept.models.w.dead).toBe(false);
    expect(kept.models.vet.might).toBe(1);
  });
});

describe('deploying an engine', () => {
  it('puts its crew beside it, ready to shoot', () => {
    const entries = entriesFor('[mordor] catapult', catalog.units['[mordor] catapult'], [], 1);
    const models = entries.flatMap((e, i) => Array.from({ length: e.count }, (_, k) => mk(`m${i}${k}`, 'p2', 10 + i * 3 + k, 5, '[mordor] catapult', { name: e.name, siege: e.siege, base: e.base ?? { shape: 'round', w: 25, h: 25 }, rot: 180 })));
    const s = run(initialState(), { type: 'addModels', models });
    const cat = Object.values(s.models).find(m => m.siege)!;
    const crew = Object.values(s.models).filter(m => m.crewOf === cat.id);
    expect(crew).toHaveLength(4);
    expect(crew.every(m => distanceBetween(m, cat) < 0.2)).toBe(true);
    expect(firingCrew(s, catalog, cat)).toBeDefined();
  });

  it('stands wholly within 6" of a table edge', () => {
    const s = run(initialState(), { type: 'addModels', models: [mk('bow', 'p2', 20, 20, '[mordor] bow', { name: 'Mordor Siege Bow', siege: 'small', base: { shape: 'rect', w: 40, h: 40 } })] });
    const b = s.models.bow;
    expect(Math.min(b.x, b.y, 48 - b.x, 48 - b.y) + 0.79).toBeLessThanOrEqual(6.01);
  });
});
