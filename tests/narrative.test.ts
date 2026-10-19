import { describe, expect, it } from 'vitest';
import catalogJson from '../src/data/mesbg-data.json';
import { modelStats, type Catalog } from '../src/shared/catalog.ts';
import { courageOf, willOfEvilToll } from '../src/shared/courage.ts';
import { burnDue, burns } from '../src/shared/fire.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { arrivalDue, castModel, mayCry, rollArrival } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { sauronDue, sauronRoll } from '../src/shared/ring.ts';
import { planShot } from '../src/shared/shooting.ts';
import { gameWinner } from '../src/shared/status.ts';
import { mightyBonus, mightyDue } from '../src/shared/mighty.ts';
import { madeFearful, powerTakesEffect } from '../src/shared/powers.ts';
import { longshanksDue, longshanksMove } from '../src/shared/sam.ts';
import { canDeclare } from '../src/shared/heroics.ts';
import { combats } from '../src/shared/flow.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { play, seeded } from './botsim.ts';

const catalog = catalogJson as unknown as Catalog;
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const dice = (list: number[]) => {
  const seq = [...list];
  return () => seq.shift() ?? 1;
};
const ask = (s: GameState, seat: Seat, a: Action, rolls: number[] = []) => {
  const out = resolveRequest(s, seat, a, dice(rolls), uid, 1, catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : s;
};
const who = (s: GameState, key: string) => castModel(s, key)!;
const wraiths = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'ringwraith');
const place = (s: GameState, moves: Record<string, [number, number]>): GameState => ({ ...s, models: { ...s.models, ...Object.fromEntries(Object.entries(moves).map(([id, [x, y]]) => [id, { ...s.models[id], x, y }])) } });
const only = (s: GameState, keep: Model[]): GameState => ({ ...s, models: Object.fromEntries(Object.values(s.models).map(m => [m.id, keep.some(k => k.id === m.id) ? m : { ...m, x: 1 + (m.owner === 'p1' ? 0 : 22), y: 1 + Object.keys(s.models).indexOf(m.id) * 2, ...(m.waiting ? {} : {}) }])) });

/** Weathertop with the player as Good in seat p1, the battle started and turn `turn`'s Move phase begun with p1 to go first. */
function weathertop(turn = 1, good: Seat = 'p1'): GameState {
  let s = ask(initialState(), good, { type: 'setNarrative', id: 'weathertop', good });
  s = run(s, { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

describe('narrative scenarios: setting up Weathertop', () => {
  it('puts down the exact cast on a 2\' table, with the scenario\'s own wargear and characteristics', () => {
    const s = ask(initialState(), 'p2', { type: 'setNarrative', id: 'weathertop', good: 'p2' });
    expect(s.board).toMatchObject({ w: 24, h: 24 });
    expect(s.narrative).toEqual({ id: 'weathertop', good: 'p2' });
    const ms = Object.values(s.models);
    expect(ms).toHaveLength(10);
    expect(ms.filter(m => m.owner === 'p2').map(m => m.cast).sort()).toEqual(['aragorn', 'frodo', 'merry', 'pippin', 'sam']);
    expect(wraiths(s)).toHaveLength(4);
    const wk = who(s, 'witch-king');
    expect(wk).toMatchObject({ owner: 'p1', might: 1, will: 10, fate: 1 });
    expect(modelStats(catalog, wk)?.A).toBe(1);
    expect(wk.options).toContain('Morgul Blade');
    for (const w of wraiths(s)) expect([w.might, w.will, w.fate, modelStats(catalog, w)?.A]).toEqual([0, 7, 0, 1]);
    expect(who(s, 'aragorn')).toMatchObject({ waiting: true, brand: true, options: ['Bow'] });
    expect(['sam', 'merry', 'pippin'].every(k => who(s, k).brand)).toBe(true);
    expect(who(s, 'frodo').brand).toBeUndefined();
    // Frodo in the middle of the ruin, the Hobbits touching him, the Nazgûl touching the ruin's edge.
    expect(who(s, 'frodo')).toMatchObject({ x: 12, y: 12 });
    for (const k of ['sam', 'merry', 'pippin']) expect(distanceBetween(who(s, k), who(s, 'frodo'))).toBeLessThan(0.1);
    for (const w of [wk, ...wraiths(s)]) expect(Math.abs(Math.hypot(w.x - 12, w.y - 12) - 6 - 0.5)).toBeLessThan(0.1);
  });

  it('keeps the cast where the story puts it while it is moved before the battle', () => {
    let s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'weathertop', good: 'p1' });
    const w = wraiths(s)[0];
    s = run(s, { type: 'moveModels', moves: [{ id: w.id, x: 12, y: 9 }, { id: who(s, 'frodo').id, x: 5, y: 5 }, { id: who(s, 'sam').id, x: 12, y: 20 }] });
    expect(Math.hypot(s.models[w.id].x - 12, s.models[w.id].y - 12)).toBeCloseTo(6.51, 1);
    expect(s.models[w.id].y).toBeLessThan(12);
    expect(who(s, 'frodo')).toMatchObject({ x: 12, y: 12 });
    expect(distanceBetween(who(s, 'sam'), who(s, 'frodo'))).toBeLessThan(0.1);
    expect(who(s, 'sam').y).toBeGreaterThan(12);
  });
});

describe('Weathertop rules', () => {
  it('brings Aragorn on from turn 2 on a 4+, as the Good side finishes its move, where the Good player places him', () => {
    let s = run(weathertop(1), { type: 'endActivation', seat: 'p1' });
    expect(arrivalDue(s)).toBe(false);
    s = run(weathertop(2), { type: 'endActivation', seat: 'p1' });
    expect(arrivalDue(s)).toBe(true);
    const missed = run(s, ...rollArrival(s, dice([3]), uid));
    expect(who(missed, 'aragorn').waiting).toBe(true);
    expect(arrivalDue(missed)).toBe(false);
    s = run(s, ...rollArrival(s, dice([4]), uid));
    const a = who(s, 'aragorn');
    expect(a.waiting).toBeUndefined();
    expect(Math.hypot(a.x - 12, a.y - 12)).toBeCloseTo(6.5, 0);
    // The Good player then places him anywhere touching the ruin's edge, and play waits until they have.
    expect(s.flow.placing?.[0]).toMatchObject({ model: a.id, seat: 'p1', kind: 'arrive' });
    expect(run(s, { type: 'nextPhase' }).phase).toBe('move');
    expect(run(s, { type: 'endActivation', seat: 'p2' }).flow.done).not.toContain('p2');
    const frodo = who(s, 'frodo');
    s = run(s, { type: 'moveModels', moves: [{ id: a.id, x: 17.88, y: 3.91 }, { id: frodo.id, x: 13, y: 13 }] });
    expect(Math.hypot(s.models[a.id].x - 12, s.models[a.id].y - 12)).toBeCloseTo(6.5, 0);
    expect((Math.atan2(s.models[a.id].x - 12, 12 - s.models[a.id].y) * 180) / Math.PI).toBeCloseTo(36, 0);
    expect(s.models[frodo.id]).toMatchObject({ x: frodo.x, y: frodo.y });
    // Not inside the ruin, nor on top of a Ringwraith.
    const wk = who(s, 'witch-king');
    const held = run(s, { type: 'moveModels', moves: [{ id: a.id, x: 12, y: 13 }] }, { type: 'moveModels', moves: [{ id: a.id, x: wk.x, y: wk.y - 3 }] });
    expect(Math.hypot(held.models[a.id].x - 12, held.models[a.id].y - 12)).toBeCloseTo(6.5, 0);
    expect(distanceBetween(held.models[a.id], wk)).toBeGreaterThan(-0.05);
    expect(run(s, { type: 'placed', seat: 'p2' }).flow.placing).toHaveLength(1);
    s = run(s, { type: 'placed', seat: 'p1' });
    expect(s.flow.placing).toEqual([]);
    expect(run(s, { type: 'moveModels', moves: [{ id: a.id, x: 18, y: 6 }] }).models[a.id]).toMatchObject({ x: s.models[a.id].x, y: s.models[a.id].y });
  });

  it('lets the Evil side give the Cry once, making Good Courage 3 worse and calling Aragorn at once', () => {
    let s = weathertop(1);
    expect(mayCry(s, 'p1')).toBe(false);
    expect(mayCry(s, 'p2')).toBe(true);
    const sam = who(s, 'sam');
    const before = courageOf(s, catalog, sam);
    s = ask(s, 'p2', { type: 'cry', seat: 'p2' });
    expect(s.narrative?.cry).toBe(1);
    expect(courageOf(s, catalog, who(s, 'sam'))).toBe(Math.min(13, before + 3));
    expect(courageOf(s, catalog, who(s, 'witch-king'))).toBeLessThan(13);
    expect(mayCry(s, 'p2')).toBe(false);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(arrivalDue(s)).toBe(true);
    s = run(s, ...rollArrival(s, dice([]), uid));
    expect(who(s, 'aragorn').waiting).toBeUndefined();
  });

  it('drives a Ringwraith beaten by a flaming brand D6" further back, which way its player chooses', () => {
    let s = weathertop(1);
    const sam = who(s, 'sam');
    const w = wraiths(s)[0];
    s = place(s, { [sam.id]: [5, 18], [w.id]: [5, 17] });
    s = { ...s, phase: 'fight', flow: { ...s.flow, pairs: undefined } };
    const fight = { sides: [[{ id: sam.id, name: 'Sam', f: 3, a: 1, s: 2, d: 3 }], [{ id: w.id, name: 'W', f: 5, a: 1, s: 4, d: 8 }]], targets: [w.id, sam.id], trapped: false } as never;
    s = ask(s, 'p1', { type: 'fight', fight }, [6, 1]);
    const group = s.log.at(-1)!.group!;
    const before = { ...s.models[w.id] };
    s = ask(s, 'p1', { type: 'strikes', fight, group }, [4, 4, 5]);
    expect(s.log.some(r => r.label.startsWith('Flaming brand'))).toBe(true);
    expect(Math.hypot(s.models[w.id].x - before.x, s.models[w.id].y - before.y)).toBeGreaterThan(4.5);
    // Its player picks the way it goes: the full D6", but never back towards the brand.
    const p = s.flow.placing![0];
    expect(p).toMatchObject({ model: w.id, seat: 'p2', kind: 'retreat', away: [sam.id] });
    const from = { x: p.from[0], y: p.from[1] };
    expect(ask(s, 'p1', { type: 'fight', fight }, [6, 1]).log).toHaveLength(s.log.length);
    s = run(s, { type: 'moveModels', moves: [{ id: w.id, x: from.x + 0.5, y: from.y + 3 }] });
    const to = s.models[w.id];
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(p.dist!, 1);
    expect(distanceBetween(to, s.models[sam.id])).toBeGreaterThanOrEqual(distanceBetween({ ...to, ...from }, s.models[sam.id]) - 0.01);
    expect(to.x).toBeGreaterThan(from.x + p.dist! - 0.2);
    s = run(s, { type: 'moveModels', moves: [{ id: w.id, x: from.x + 1, y: from.y - 4 }] });
    expect(Math.hypot(s.models[w.id].x - from.x, s.models[w.id].y - from.y)).toBeCloseTo(p.dist!, 1);
    expect(run(s, { type: 'placed', seat: 'p1' }).flow.placing).toHaveLength(1);
    expect(run(s, { type: 'placed', seat: 'p2' }).flow.placing).toEqual([]);
  });

  it('lets Aragorn throw his brand once: no roll To Wound, the target is Set Ablaze and burns in the End phase', () => {
    let s = weathertop(2);
    const a = who(s, 'aragorn');
    const w = wraiths(s)[0];
    s = place(s, { [a.id]: [4, 20], [w.id]: [4, 15] });
    s = { ...s, models: { ...s.models, [a.id]: { ...s.models[a.id], waiting: undefined } }, phase: 'shoot', flow: { ...s.flow, done: [] } };
    delete s.models[a.id].waiting;
    expect(planShot(s, catalog, s.models[a.id], s.models[w.id], { brand: true }).why).toBeUndefined();
    const shot = { shooter: { id: a.id, name: 'Aragorn', weapon: 'Flaming Brand', shoot: 3, s: 3, shots: 1 }, target: { id: w.id, name: 'W', d: 8 }, obstacles: 0, brand: true };
    s = ask(s, 'p1', { type: 'shoot', shot }, [6]);
    expect(s.models[w.id].ablaze).toBe(true);
    expect(s.models[a.id].brand).toBeUndefined();
    expect(s.log.some(r => r.label.startsWith('To wound'))).toBe(false);
    expect(planShot(s, catalog, s.models[a.id], s.models[w.id], { brand: true }).why).toMatch(/no flaming brand/);
    s = { ...s, phase: 'end' };
    expect(burnDue(s)).toBe(true);
    s = run(s, ...burns(s, catalog, dice([6, 6]), uid));
    expect(s.models[w.id].dead).toBe(true);
    expect(burnDue(s)).toBe(false);
  });

  it('puts out the flames of a model that crawls 1"', () => {
    let s = weathertop(2);
    const w = wraiths(s)[0];
    s = { ...s, models: { ...s.models, [w.id]: { ...w, x: 3, y: 3, ablaze: true, prone: true } }, flow: { ...s.flow, done: ['p1'] } };
    s = run(s, { type: 'crawl', id: w.id }, { type: 'moveModels', moves: [{ id: w.id, x: 4, y: 3 }] });
    expect(s.models[w.id].ablaze).toBeUndefined();
  });

  it('slays outright with the Morgul Blade, once a game', () => {
    let s = weathertop(1);
    const wk = who(s, 'witch-king');
    const frodo = who(s, 'frodo');
    s = only(s, [wk, frodo]);
    s = place(s, { [frodo.id]: [12, 12], [wk.id]: [12, 13] });
    s = { ...s, phase: 'fight', flow: { ...s.flow, pairs: undefined }, models: { ...s.models, [frodo.id]: { ...s.models[frodo.id], fate: 0 } } };
    s = run(s, { type: 'fightChoice', id: wk.id, morgul: frodo.id });
    const fight = { sides: [[{ id: frodo.id, name: 'Frodo', f: 3, a: 1, s: 2, d: 3 }], [{ id: wk.id, name: 'WK', f: 6, a: 1, s: 4, d: 8 }]], targets: [wk.id, frodo.id], trapped: false } as never;
    s = ask(s, 'p1', { type: 'fight', fight }, [1, 6]);
    s = ask(s, 'p1', { type: 'strikes', fight, group: s.log.at(-1)!.group! }, [6, 6]);
    expect(s.models[frodo.id].dead).toBe(true);
    expect(s.models[wk.id].used).toContain('Morgul Blade');
    expect(gameWinner(s)).toBe('p2');
  });

  it('lets the Good side win only by slaying every one of the Nazgûl', () => {
    let s = weathertop(1);
    expect(gameWinner(s)).toBeNull();
    for (const m of Object.values(s.models)) if (m.owner === 'p2' && m.cast !== 'witch-king') s = run(s, { type: 'affect', id: m.id, patch: { dead: true, wounds: 0 } });
    expect(gameWinner(s)).toBeNull();
    s = run(s, { type: 'affect', id: who(s, 'witch-king').id, patch: { dead: true, wounds: 0 } });
    expect(gameWinner(s)).toBe('p1');
  });
});

describe('the One Ring', () => {
  it('is put on in the Ringbearer\'s activation, and Sauron\'s Will hands it to the enemy on a 1-2', () => {
    let s = weathertop(1);
    const frodo = who(s, 'frodo');
    s = ask(s, 'p1', { type: 'ring', id: frodo.id, on: true });
    expect(s.models[frodo.id].ringOn).toBe(true);
    // Put on mid-activation: no roll until it next begins one.
    expect(sauronDue(s)).toBeUndefined();
    s = run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'setPhase', phase: 'move', turn: 2 }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    expect(sauronDue(s)?.id).toBe(frodo.id);
    s = run(s, ...sauronRoll(s, s.models[frodo.id], dice([2]), uid));
    expect(s.flow.compel).toMatchObject({ model: frodo.id, ring: true, max: 4 });
    expect(s.models[s.flow.compel!.caster].owner).toBe('p2');
    // The Good side can't end its move until the Nazgûl have moved Frodo.
    expect(run(s, { type: 'endActivation', seat: 'p1' }).flow.done).toEqual([]);
    // Might can win him back.
    const roll = s.log.at(-1)!;
    s = run(s, { type: 'useMight', roll: roll.id, die: 0 });
    expect(s.flow.compel).toBeUndefined();
  });

  it('needs a Courage test to come off, and the Nazgûl spend no Will fighting its wearer', () => {
    let s = weathertop(1);
    const frodo = who(s, 'frodo');
    s = { ...s, models: { ...s.models, [frodo.id]: { ...s.models[frodo.id], ringOn: true } } };
    const failed = ask(s, 'p1', { type: 'ring', id: frodo.id, on: false }, [1, 1]);
    expect(failed.models[frodo.id].ringOn).toBe(true);
    expect(ask(failed, 'p1', { type: 'ring', id: frodo.id, on: false }, [6, 6]).models[frodo.id].ringOn).toBe(true);
    expect(ask(s, 'p1', { type: 'ring', id: frodo.id, on: false }, [6, 6]).models[frodo.id].ringOn).toBeUndefined();
    const wk = who(s, 'witch-king');
    const fought = { ...s, phase: 'end' as const, flow: { ...s.flow, resolved: [`${frodo.id},|,${wk.id}`] } };
    expect(willOfEvilToll(fought, catalog, uid, 1).some(a => a.type === 'affect')).toBe(false);
  });
});

describe('the computer plays Weathertop', () => {
  it('plays either side to a result', () => {
    for (const seed of [1, 2, 3]) {
      const rand = seeded(seed);
      let s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'weathertop', good: seed % 2 ? 'p1' : 'p2' });
      s = run(s, { type: 'startGame', at: 1 });
      const out = play(s, rand, 30000);
      expect(out.state.result?.winner, `seed ${seed}`).toMatch(/p1|p2/);
    }
  }, 60_000);
});

describe("the Weathertop cast's own rules", () => {
  const onTable = (s: GameState, m: Model): GameState => {
    const out = { ...s, models: { ...s.models, [m.id]: { ...s.models[m.id] } } };
    delete out.models[m.id].waiting;
    return out;
  };
  const fightOf = (a: Model, b: Model) => ({ sides: [[{ id: a.id, name: a.name, f: 3, a: 1, s: 3, d: 4 }], [{ id: b.id, name: b.name, f: 3, a: 1, s: 3, d: 4 }]], targets: [b.id, a.id], trapped: false }) as never;

  it('Andúril: Aragorn never needs worse than 4+ to wound, and 3+ two-handed', () => {
    const base = weathertop(2);
    const a = who(base, 'aragorn');
    const w = wraiths(base)[0];
    let s = place(onTable(only(base, [a, w]), a), { [a.id]: [5, 5], [w.id]: [5, 6] });
    s = { ...s, phase: 'fight', flow: { ...s.flow, pairs: undefined } };
    let t = s;
    s = ask(s, 'p1', { type: 'fight', fight: fightOf(a, w) }, [6, 6, 6, 1]);
    s = ask(s, 'p1', { type: 'strikes', fight: fightOf(a, w), group: s.log.at(-1)!.group! }, [1, 1, 1]);
    expect(s.log.find(r => r.label.startsWith('Aragorn, Strider strikes'))?.label).toMatch(/\(4\+\)/);
    t = run(t, { type: 'fightChoice', id: a.id, twoHanded: true });
    t = ask(t, 'p1', { type: 'fight', fight: fightOf(a, w) }, [6, 6, 6, 1]);
    t = ask(t, 'p1', { type: 'strikes', fight: fightOf(a, w), group: t.log.at(-1)!.group! }, [1, 1, 1]);
    expect(t.log.find(r => r.label.startsWith('Aragorn, Strider strikes'))?.label).toMatch(/\(3\+\)/);
  });

  it('Mighty Hero: a bonus Might point each turn, lost if unspent', () => {
    const base = weathertop(2);
    let s = onTable(base, who(base, 'aragorn'));
    const a = who(s, 'aragorn');
    const might = a.might;
    expect(mightyDue(s, catalog)).toBe(true);
    s = run(s, ...mightyBonus(s, catalog, uid));
    expect(s.models[a.id].might).toBe(might + 1);
    expect(mightyDue(s, catalog)).toBe(false);
    // Unspent: next turn it's still only one over.
    s = run({ ...s, turn: 3 }, ...mightyBonus({ ...s, turn: 3 }, catalog, uid));
    expect(s.models[a.id].might).toBe(might + 1);
    // Spent: the bonus point goes first.
    s = run(s, { type: 'affect', id: a.id, patch: { might: might } });
    s = run({ ...s, turn: 4 }, ...mightyBonus({ ...s, turn: 4 }, catalog, uid));
    expect(s.models[a.id].might).toBe(might + 1);
  });

  it('Ring of Barahir: a power that gets through still fails on Aragorn on a 6', () => {
    const base = weathertop(2);
    const s0 = onTable(base, who(base, 'aragorn'));
    const a = who(s0, 'aragorn');
    const wk = who(s0, 'witch-king');
    const spell = { caster: wk.id, target: a.id, power: 'Transfix' };
    const saved = run(s0, ...powerTakesEffect(s0, catalog, spell, dice([6]), uid, 1));
    expect(saved.log.some(r => r.label.startsWith('Ring of Barahir') && r.dice[0] === 6)).toBe(true);
    expect(saved.models[a.id].effects ?? []).toHaveLength(0);
    const hit = run(s0, ...powerTakesEffect(s0, catalog, spell, dice([3]), uid, 1));
    expect(hit.models[a.id].effects?.some(e => e.power === 'Transfix')).toBe(true);
    // An aura cast near him: a 6 leaves him alone wherever he goes.
    const fear = run(s0, ...powerTakesEffect(s0, catalog, { caster: wk.id, target: wk.id, power: 'Instill Fear' }, dice([6]), uid, 1));
    const near = place(fear, { [a.id]: [wk.x, wk.y + 2] });
    expect(madeFearful(near, near.models[a.id])).toBe(false);
    expect(madeFearful(near, near.models[who(near, 'sam').id])).toBe(distanceBetween(near.models[who(near, 'sam').id], wk) <= 6);
  });

  it("Frying Pan: Sam stuns an enemy instead of striking, so it can't move next turn", () => {
    let s = weathertop(1);
    const sam = who(s, 'sam');
    const w = wraiths(s)[0];
    s = only(s, [sam, w]);
    s = place(s, { [sam.id]: [5, 5], [w.id]: [5, 6] });
    s = { ...s, phase: 'fight', flow: { ...s.flow, pairs: undefined } };
    s = run(s, { type: 'fightChoice', id: sam.id, pan: w.id });
    s = ask(s, 'p1', { type: 'fight', fight: fightOf(sam, w) }, [6, 6, 1]);
    // (The first die is how far the brand drives it off.)
    s = ask(s, 'p1', { type: 'strikes', fight: fightOf(sam, w), group: s.log.at(-1)!.group! }, [5, 5]);
    s = run(s, { type: 'placed', seat: 'p2' });
    expect(s.log.some(r => r.label.startsWith('Frying Pan') && r.dice[0] === 5)).toBe(true);
    expect(s.log.some(r => r.label.startsWith('Samwise Gamgee strikes'))).toBe(false);
    expect(s.models[w.id].panned).toBe(2);
    s = { ...s, turn: 2, phase: 'move', flow: { ...s.flow, done: ['p1'] } };
    const at = { x: s.models[w.id].x, y: s.models[w.id].y };
    s = run(s, { type: 'moveModels', moves: [{ id: w.id, x: at.x + 3, y: at.y }] });
    expect(s.models[w.id]).toMatchObject(at);
  });

  it('"Let him go or I\'ll have you, Longshanks!": a free Heroic Combat that takes Sam into Frodo\'s fight', () => {
    let s = weathertop(1);
    const [sam, frodo] = [who(s, 'sam'), who(s, 'frodo')];
    const [w1, w2] = wraiths(s);
    s = only(s, [sam, frodo, w1, w2]);
    s = place(s, { [frodo.id]: [10, 10], [w1.id]: [10, 9], [sam.id]: [14, 10], [w2.id]: [15, 10] });
    s = { ...s, phase: 'fight', priority: 'p1', models: { ...s.models, [sam.id]: { ...s.models[sam.id], might: 0 }, [w2.id]: { ...s.models[w2.id], stats: { D: 3 } } }, flow: { ...s.flow, heroics: [], passed: [], pairs: undefined } };
    expect(canDeclare(s, 'p1').map(m => m.id)).toContain(sam.id);
    s = run(s, { type: 'declareHeroic', model: sam.id, action: 'Heroic Combat' });
    expect(s.flow.heroics.at(-1)).toMatchObject({ model: sam.id, free: true });
    expect(s.models[sam.id].might).toBe(0);
    const key = combats(s).find(c => c.p1.includes(sam.id))!.key;
    const fight = { ...(fightOf(sam, w2) as object), combat: key } as never;
    s = ask(s, 'p1', { type: 'fight', fight }, [6, 6, 1]);
    s = ask(s, 'p1', { type: 'strikes', fight, group: s.log.at(-1)!.group! }, [6, 6, 6, 6]);
    expect(s.models[w2.id].dead).toBe(true);
    const due = longshanksDue(s)!;
    expect(due.id).toBe(sam.id);
    s = run(s, ...longshanksMove(s, due));
    expect(distanceBetween(s.models[sam.id], s.models[w1.id])).toBeLessThan(0.1);
    expect(s.flow.placing?.[0]).toMatchObject({ model: sam.id, kind: 'join' });
    // Anywhere else in Frodo's fight is fine; out of it is not.
    const here = { x: s.models[sam.id].x, y: s.models[sam.id].y };
    expect(run(s, { type: 'moveModels', moves: [{ id: sam.id, x: 14, y: 14 }] }).models[sam.id]).toMatchObject(here);
    s = run(s, { type: 'placed', seat: 'p1' });
    expect(longshanksDue(s)).toBeUndefined();
    expect(run(s, { type: 'moveModels', moves: [{ id: sam.id, x: here.x + 1, y: here.y }] }).models[sam.id]).toMatchObject(here);
  });
});
