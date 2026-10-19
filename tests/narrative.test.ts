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
  it('brings Aragorn on from turn 2 on a 4+, as the Good side finishes its move', () => {
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

  it('drives a Ringwraith beaten by a flaming brand D6" further back', () => {
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
