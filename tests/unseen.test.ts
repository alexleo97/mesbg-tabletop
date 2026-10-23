import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeById, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { planShot } from '../src/shared/shooting.ts';
import { fighterOf } from '../src/shared/wargear.ts';
import { sauronDue } from '../src/shared/ring.ts';
import { effectActive } from '../src/shared/powers.ts';
import { cutWebs, decoyOf, freed, skitterDone, spidersDue, unseenWinner, webDue } from '../src/shared/unseen.ts';
import { APART } from '../src/shared/unseenMap.ts';
import { botStep, newMemo } from '../src/shared/bot.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';
import { markModel } from '../src/shared/marking.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const bilbo = (s: GameState) => castModel(s, 'bilbo')!;
const spiders = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'spider');
const r = (m: Model) => Math.max(m.base.w, m.base.h) / 50.8;
const put = (s: GameState, m: Model, x: number, y: number, patch: Partial<Model> = {}): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], x, y, ...patch } } });
const bundles = (s: GameState) => Object.values(s.terrain).filter(t => t.object === 'cocoon').sort((a, b) => (a.id < b.id ? -1 : 1));
/** Dice that come up as listed, in order. */
const dice = (...list: number[]) => {
  let i = 0;
  return () => list[i++ % list.length];
};
/** A request as the server takes it: rolled, then applied. */
const ask = (s: GameState, seat: Seat, a: Action, d6: () => number) => {
  const out = resolveRequest(s, seat, a, d6, uid, 1, catalog);
  return out ? out.apply.reduce(reduce, s) : null;
};

/** The Unseen Hero set up as the server would, with Bilbo on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'the-unseen-hero', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Set up done (the decoy the third bundle) and the battle started, turn 1's Move phase begun with `first` to move. */
function begun(first: Seat = 'p2'): GameState {
  let s = setup();
  s = run(s, { type: 'setPick', seat: 'p2', key: 'decoy', value: 'n-bundle-3' }, { type: 'warbandDone', seat: 'p2' }, { type: 'warbandDone', seat: 'p1' }, { type: 'startGame', at: 1 });
  return run(s, { type: 'choosePriority', seat: first }, { type: 'passHeroic', seat: first }, { type: 'passHeroic', seat: first === 'p1' ? 'p2' : 'p1' });
}

/** Straight to the End phase of the turn. */
const toEnd = (s: GameState): GameState => ({ ...s, phase: 'end' });

describe('The Unseen Hero: setting up', () => {
  it('sets out the table and cast: Bilbo wearing the Ring against six Spiders, three webbed bundles', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    expect(spiders(s)).toHaveLength(6);
    expect(spiders(s).every(m => m.owner === 'p2')).toBe(true);
    expect(bilbo(s)).toMatchObject({ owner: 'p1', ringOn: true });
    expect(bilbo(s).options).toEqual(expect.arrayContaining(['Sting', 'The One Ring']));
    const b = bundles(s);
    expect(b).toHaveLength(3);
    for (const t of b) {
      expect(t.hidden).toBe(true);
      for (const o of b) if (o.id !== t.id) expect(Math.hypot(o.x - t.x, o.y - t.y) - t.w).toBeGreaterThanOrEqual(APART - 0.01);
    }
    // The Spiders 6" apart, the great trees standing tall on their roots.
    for (const m of spiders(s)) for (const o of spiders(s)) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y) - r(o) - r(m)).toBeGreaterThanOrEqual(APART - 0.02);
    expect(Object.values(s.terrain).filter(t => t.look === 'trunk')).toHaveLength(6);
    // The Spiders' player sets up first.
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p2' });
  });

  it('makes the Spiders’ player pick a decoy before finishing, in secret from Bilbo’s', () => {
    let s = setup();
    expect(reduce(s, { type: 'warbandDone', seat: 'p2' })).toBe(s);
    // Bilbo's player can't pick it, nor can anything but a bundle be picked.
    expect(reduce(s, { type: 'setPick', seat: 'p1', key: 'decoy', value: 'n-bundle-1' })).toBe(s);
    expect(reduce(s, { type: 'setPick', seat: 'p2', key: 'decoy', value: 'n-trunk-n' })).toBe(s);
    s = reduce(s, { type: 'setPick', seat: 'p2', key: 'decoy', value: 'n-bundle-2' });
    expect(decoyOf(s)).toBe('n-bundle-2');
    s = reduce(s, { type: 'warbandDone', seat: 'p2' });
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p1' });
  });

  it('lets the Spiders’ player move the bundles, 6" apart and off the great trunks', () => {
    const s = setup();
    const [a, b] = bundles(s);
    // Too near another bundle.
    expect(reduce(s, { type: 'updateTerrain', id: a.id, patch: { x: b.x - 3, y: b.y } }).terrain[a.id]).toMatchObject({ x: a.x, y: a.y });
    // Into the open middle of the table, well clear.
    const moved = reduce(s, { type: 'updateTerrain', id: a.id, patch: { x: 24, y: 14 } });
    expect(moved.terrain[a.id]).toMatchObject({ x: 24, y: 14 });
    // Not on Bilbo's turn to set up.
    const later = run(s, { type: 'setPick', seat: 'p2', key: 'decoy', value: a.id }, { type: 'warbandDone', seat: 'p2' });
    expect(reduce(later, { type: 'updateTerrain', id: a.id, patch: { x: 24, y: 14 } }).terrain[a.id]).toMatchObject({ x: a.x, y: a.y });
  });

  it('puts Bilbo anywhere touching a table edge', () => {
    const s = setup();
    const p = holdNarrative(s, { id: bilbo(s).id, x: 24, y: 40 });
    expect(p).toBeTruthy();
    const m = bilbo(s);
    const at = { ...m, ...p! };
    const gap = Math.min(at.x, at.y, 48 - at.x, 48 - at.y);
    expect(gap).toBeCloseTo(r(m), 1);
  });
});

describe('The Unseen Hero: the Power of the Ring', () => {
  it('holds the Spiders still until each tests, then gives it to whichever player the test says, for D6"', () => {
    let s = begun();
    const [sp] = spiders(s);
    expect(spidersDue(s, 'p2').length).toBe(6);
    expect(moveAllowance(s, sp)).toBe(0);
    // The Spiders' move can't end with Spiders still to test.
    expect(reduce(s, { type: 'endActivation', seat: 'p2' })).toBe(s);
    // Passed (2D6 of 8 or more): the Spiders' player moves it.
    const passed = ask(s, 'p2', { type: 'skitter', id: sp.id }, dice(5, 4, 3))!;
    expect(passed.flow.skitter).toMatchObject({ model: sp.id, by: 'p2', dist: 3 });
    expect(moveAllowance(passed, passed.models[sp.id])).toBe(3);
    // Failed: Bilbo's player does.
    const failed = ask(s, 'p2', { type: 'skitter', id: sp.id }, dice(1, 2, 4))!;
    expect(failed.flow.skitter).toMatchObject({ model: sp.id, by: 'p1', dist: 4 });
    s = failed;
    // It must go the whole way before it's done, and only the player moving it may say so.
    expect(skitterDone(s)).toBe(false);
    expect(reduce(s, { type: 'skitterDone', seat: 'p1' })).toBe(s);
    expect(reduce(s, { type: 'endActivation', seat: 'p2' })).toBe(s);
    const m = s.models[sp.id];
    s = reduce(s, { type: 'moveModels', moves: [{ id: m.id, x: m.x, y: m.y + 2 }] });
    expect(skitterDone(s)).toBe(false);
    s = reduce(s, { type: 'moveModels', moves: [{ id: m.id, x: m.x + 2, y: m.y + 2 }] });
    expect(skitterDone(s)).toBe(true);
    expect(reduce(s, { type: 'skitterDone', seat: 'p2' })).toBe(s);
    s = reduce(s, { type: 'skitterDone', seat: 'p1' });
    expect(s.flow.skitter).toBeUndefined();
    expect(s.flow.stopped).toContain(sp.id);
    expect(spidersDue(s, 'p2').length).toBe(5);
  });

  it('stops a Spider on touching Bilbo, a charge, and then the rest pass without rolling', () => {
    let s = begun();
    const [sp] = spiders(s);
    s = put(s, bilbo(s), sp.x + 3, sp.y);
    s = ask(s, 'p2', { type: 'skitter', id: sp.id }, dice(6, 6, 6))!;
    s = reduce(s, { type: 'moveModels', moves: [{ id: sp.id, x: sp.x + 6, y: sp.y }] });
    const m = s.models[sp.id];
    expect(m.x).toBeLessThan(bilbo(s).x);
    expect(Math.hypot(m.x - bilbo(s).x, m.y - bilbo(s).y)).toBeCloseTo(r(m) + r(bilbo(s)), 1);
    expect(skitterDone(s)).toBe(true);
    expect(s.flow.charges?.[sp.id]).toBe(bilbo(s).id);
    s = reduce(s, { type: 'skitterDone', seat: 'p2' });
    const next = spidersDue(s, 'p2')[0];
    const after = resolveRequest(s, 'p2', { type: 'skitter', id: next.id }, dice(1, 1, 2), uid, 1, catalog)!;
    const test = after.apply.find(a => a.type === 'rolled')!;
    expect(test.type === 'rolled' && test.roll.dice).toEqual([]);
    expect(after.apply.at(-1)).toMatchObject({ type: 'skittering', skitter: { by: 'p2' } });
  });

  it('keeps a Spider on the table', () => {
    let s = begun();
    const [sp] = spiders(s);
    s = put(s, sp, 2, 24);
    s = ask(s, 'p2', { type: 'skitter', id: sp.id }, dice(6, 6, 6))!;
    s = reduce(s, { type: 'moveModels', moves: [{ id: sp.id, x: -4, y: 24 }] });
    expect(s.models[sp.id].x).toBeGreaterThanOrEqual(r(sp) - 0.01);
  });

  it('lets the Spiders move as they like once Bilbo takes the Ring off', () => {
    let s = begun();
    s = put(s, bilbo(s), bilbo(s).x, bilbo(s).y, { ringOn: false });
    expect(spidersDue(s, 'p2')).toEqual([]);
    expect(moveAllowance(s, spiders(s)[0])).toBeGreaterThan(0);
  });

  it('leaves Bilbo out of Sauron’s Will: the Ring has not yet awoken', () => {
    const s = begun('p1');
    expect(sauronDue(s, catalog)).toBeUndefined();
  });
});

describe('The Unseen Hero: Caught in a Web', () => {
  const touch = (s: GameState, id: string) => {
    const t = s.terrain[id];
    return put(s, bilbo(s), t.x + t.w / 2 + r(bilbo(s)) + 0.05, t.y);
  };

  it('rolls for each bundle Bilbo touches in the End phase: on a 3+ he cuts it open', () => {
    let s = toEnd(touch(begun(), 'n-bundle-1'));
    expect(webDue(s)).toBe(true);
    // The battle can't end while the roll is due.
    expect(unseenWinner(s)).toBeNull();
    const held = cutWebs(s, dice(2), uid).reduce(reduce, s);
    expect(held.terrain['n-bundle-1'].gone).toBeFalsy();
    expect(webDue(held)).toBe(false);
    s = cutWebs(s, dice(3), uid).reduce(reduce, s);
    expect(s.terrain['n-bundle-1']).toMatchObject({ gone: 'rescued' });
    expect(s.terrain['n-bundle-1'].hidden).toBeFalsy();
    expect(freed(s)).toBe(1);
  });

  it('shows up the decoy for what it is', () => {
    let s = toEnd(touch(begun(), 'n-bundle-3'));
    s = cutWebs(s, dice(6), uid).reduce(reduce, s);
    expect(s.terrain['n-bundle-3']).toMatchObject({ gone: 'revealed' });
    expect(s.terrain['n-bundle-3'].hidden).toBeFalsy();
    expect(freed(s)).toBe(0);
  });

  it('rolls once a turn', () => {
    let s = toEnd(touch(begun(), 'n-bundle-1'));
    s = cutWebs(s, dice(1), uid).reduce(reduce, s);
    expect(webDue(s)).toBe(false);
    expect(webDue({ ...s, turn: s.turn + 1 })).toBe(true);
  });
});

describe('The Unseen Hero: winning', () => {
  it('Bilbo wins with both lots of Dwarves freed, as the turn ends', () => {
    let s = begun();
    const patch = { gone: 'rescued' as const, hidden: false };
    s = run(s, { type: 'updateTerrain', id: 'n-bundle-1', patch }, { type: 'updateTerrain', id: 'n-bundle-2', patch });
    expect(unseenWinner(s)).toBeNull();
    expect(unseenWinner(toEnd(s))).toBe('p1');
    expect(narrativeWinner(toEnd(s))).toBe('p1');
  });

  it('Bilbo wins with every Spider slain, the Spiders with Bilbo slain, and both at once is a draw', () => {
    const s = toEnd(begun());
    const dead = (st: GameState, ms: Model[]) => ms.reduce((x, m) => put(x, m, m.x, m.y, { dead: true, wounds: 0 }), st);
    expect(unseenWinner(s)).toBeNull();
    expect(unseenWinner(dead(s, spiders(s)))).toBe('p1');
    expect(unseenWinner(dead(s, [bilbo(s)]))).toBe('p2');
    expect(unseenWinner(dead(s, [...spiders(s), bilbo(s)]))).toBe('draw');
  });
});

describe('The Unseen Hero: Bilbo and the Spiders', () => {
  it('Brave Master Baggins: +1 Fight and +1 Attack in a turn he charges', () => {
    const s = begun('p1');
    const b = bilbo(s);
    const calm = fighterOf(s, catalog, b);
    const brave = fighterOf({ ...s, flow: { ...s.flow, charges: { [b.id]: spiders(s)[0].id } } }, catalog, b);
    expect(brave.f).toBe(calm.f + 1);
    expect(brave.a).toBe(calm.a + 1);
  });

  it('Bilbo’s stones are a Strength 1 throwing weapon', () => {
    let s: GameState = { ...begun('p1'), phase: 'shoot' };
    const [sp] = spiders(s);
    s = put(s, bilbo(s), sp.x + 5, sp.y, { ringOn: false });
    const plan = planShot(s, catalog, bilbo(s), s.models[sp.id]);
    expect(plan.weapon).toMatchObject({ name: 'Throwing stones', s: 1, range: 8 });
  });

  it('Spider webs Paralyse instead of wounding; a hero shakes them off with a point of Fate', () => {
    let s: GameState = { ...begun('p2'), phase: 'shoot' };
    const [sp] = spiders(s);
    s = put(s, bilbo(s), sp.x + 5, sp.y, { ringOn: false });
    const plan = planShot(s, catalog, s.models[sp.id], bilbo(s));
    expect(plan.weapon?.name).toBe('Throwing webs');
    const shot = (st: GameState) => ask(st, 'p2', { type: 'shoot', shot: { shooter: { id: sp.id, name: sp.name, weapon: 'Throwing webs', shoot: 4, s: 1, shots: 1 }, target: { id: bilbo(st).id, name: 'Bilbo', d: 3 }, obstacles: 0 } } as Action, dice(6))!;
    const fate = bilbo(s).fate;
    expect(fate).toBeGreaterThan(0);
    const shrugged = shot(s);
    expect(bilbo(shrugged)).toMatchObject({ fate: fate - 1, wounds: bilbo(s).wounds });
    const caught = shot(put(s, bilbo(s), bilbo(s).x, bilbo(s).y, { fate: 0 }));
    const b = bilbo(caught);
    expect(b.wounds).toBe(bilbo(s).wounds);
    expect(b.prone).toBe(true);
    expect((b.effects ?? []).some(e => e.web && effectActive(caught, e))).toBe(true);
    // The webs hold even with the Spider slain.
    const slain = put(caught, caught.models[sp.id], sp.x, sp.y, { dead: true, wounds: 0 });
    expect((bilbo(slain).effects ?? []).some(e => e.web && effectActive(slain, e))).toBe(true);
  });
});

describe('The Unseen Hero: the computer', () => {
  it('picks a decoy and finishes setting up', () => {
    let s = setup();
    const memo = newMemo();
    for (let i = 0; i < 4 && s.flow.deploy?.turn === 'p2'; i++) {
      const step = botStep(s, 'p2', catalog, memo, 1000 + i);
      if (step?.action) s = reduce(s, step.action);
    }
    expect(s.flow.picks?.p2?.decoy).toMatch(/^n-bundle-/);
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p1' });
  });

  it('plays both sides with nothing refused', () => {
    let s = setup();
    s = run(s, { type: 'setPick', seat: 'p2', key: 'decoy', value: 'n-bundle-2' }, { type: 'warbandDone', seat: 'p2' }, { type: 'warbandDone', seat: 'p1' }, { type: 'startGame', at: 1 });
    const refused: string[] = [];
    let skitters = 0;
    const { state } = play(s, seeded(5), 20000, st => st.turn > 6 || !!st.result, (_, seat, a, ok) => {
      if (!ok) refused.push(`${seat}:${a.type}`);
      if (a.type === 'skitterDone' && ok) skitters++;
    });
    expect(refused).toEqual([]);
    // The Spiders have blundered about under the Ring, and Bilbo has gone after the bundles.
    expect(skitters).toBeGreaterThan(6);
    const b = bilbo(state);
    const nearest = Math.min(...bundles(state).map(t => Math.hypot(t.x - b.x, t.y - b.y)));
    expect(nearest < 12 || !!state.result || freed(state) > 0).toBe(true);
    expect(narrativeById('the-unseen-hero')).toBeDefined();
    console.log(`turn ${state.turn}, result ${JSON.stringify(state.result ?? null)}, freed ${freed(state)}, skitters ${skitters}, spiders dead ${spiders(state).filter(m => m.dead).length}, bilbo dead ${!!bilbo(state).dead}`);
  }, 600000);
});
