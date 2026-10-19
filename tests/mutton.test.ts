import { describe, expect, it } from 'vitest';
import { adjustFight, resolveRequest } from '../src/shared/resolve.ts';
import { castModel } from '../src/shared/narrative.ts';
import { dawnDue, offTable, reinforceDue, rollDawn, rollReinforcements, sacked } from '../src/shared/mutton.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { gameWinner } from '../src/shared/status.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import type { FightRequest } from '../src/shared/fight.ts';
import type { Action, GameState, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

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

/** Roast Mutton with the Company in seat p1, the battle started and turn `turn`'s Move phase begun with p1 first. */
function mutton(turn = 1): GameState {
  let s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' });
  s = run(s, { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

describe('Roast Mutton: setting up', () => {
  it('puts the Trolls by the fire, Bilbo by Bill and Kíli at the west edge, with the rest kept back', () => {
    const s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' });
    expect(s.board).toMatchObject({ w: 24, h: 24 });
    const fire = Object.values(s.terrain).find(t => t.object === 'campfire')!;
    for (const k of ['bill', 'bert', 'tom']) {
      const t = who(s, k);
      expect(t.owner).toBe('p2');
      expect(Math.hypot(t.x - fire.x, t.y - fire.y) - fire.w / 2 - Math.max(t.base.w, t.base.h) / 50.8).toBeLessThanOrEqual(3);
    }
    expect(distanceBetween(who(s, 'bilbo'), who(s, 'bill'))).toBeLessThanOrEqual(3);
    const kili = who(s, 'kili');
    expect(kili.y).toBe(12);
    expect(kili.x).toBeCloseTo(kili.base.w / 50.8, 2);
    expect(offTable(s).map(m => m.cast).sort()).toEqual(['balin', 'bifur', 'bofur', 'bombur', 'dori', 'dwalin', 'fili', 'gloin', 'nori', 'oin', 'ori', 'thorin']);
    // Thorin has the Oakenshield but not Orcrist; Bilbo neither Sting nor the Ring.
    expect(who(s, 'thorin').options).toEqual(['The Oakenshield']);
    expect(who(s, 'bilbo').options ?? []).toEqual([]);
  });

  it('keeps Bilbo within 3" of Bill and the Trolls within 3" of the fire while they are set up', () => {
    let s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' });
    const bilbo = who(s, 'bilbo');
    s = run(s, { type: 'moveModels', moves: [{ id: bilbo.id, x: 2, y: 2 }] });
    expect(distanceBetween(s.models[bilbo.id], who(s, 'bill'))).toBeLessThanOrEqual(3.01);
    const tom = who(s, 'tom');
    s = run(s, { type: 'moveModels', moves: [{ id: tom.id, x: 2, y: 22 }] });
    const fire = Object.values(s.terrain).find(t => t.object === 'campfire')!;
    expect(Math.hypot(s.models[tom.id].x - fire.x, s.models[tom.id].y - fire.y)).toBeLessThan(fire.w / 2 + 3 + tom.base.w / 25.4);
  });
});

describe('Roast Mutton: the Company arrives', () => {
  it('rolls a 3+ for each Dwarf as the Good side finishes its first move, and they step on one at a time', () => {
    let s = run(mutton(1), { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).not.toContain('p1');
    expect(reinforceDue(s)).toBe(true);
    // Thorin, Fíli and Balin roll 3+; the other nine fail.
    s = run(s, ...rollReinforcements(s, dice([6, 3, 5, 1, 2, 1, 2, 1, 2, 1, 2, 1]), uid));
    expect(reinforceDue(s)).toBe(false);
    const thorin = who(s, 'thorin');
    expect(thorin.waiting).toBeUndefined();
    expect(thorin.x).toBeCloseTo(thorin.base.w / 50.8, 2);
    expect(who(s, 'fili').waiting).toBe(true);
    // Only the newcomers move, and the side isn't done until they're all on.
    const kili = who(s, 'kili');
    expect(run(s, { type: 'moveModels', moves: [{ id: kili.id, x: kili.x + 2, y: kili.y }] }).models[kili.id].x).toBe(kili.x);
    expect(run(s, { type: 'endActivation', seat: 'p1' }).flow.done).not.toContain('p1');
    // A full Move measured from the edge: Thorin's 5" takes the front of his base 5" in.
    // (Kíli stands at the middle of the edge, so Thorin steps on beside him.)
    expect(Math.abs(thorin.y - 12)).toBeGreaterThan(0.5);
    s = run(s, { type: 'moveModels', moves: [{ id: thorin.id, x: 10, y: thorin.y }] });
    expect(s.models[thorin.id].x + thorin.base.w / 50.8).toBeCloseTo(5, 1);
    expect(who(s, 'fili').waiting).toBeUndefined();
    s = run(s, { type: 'moveModels', moves: [{ id: who(s, 'fili').id, x: 4, y: 10 }] });
    s = run(s, { type: 'moveModels', moves: [{ id: who(s, 'balin').id, x: 3, y: 14 }] });
    expect(offTable(s)).toHaveLength(9);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).toContain('p1');
  });

  it("doesn't let a newcomer charge", () => {
    let s = run(mutton(1), { type: 'endActivation', seat: 'p1' });
    const bill = who(s, 'bill');
    s = { ...s, models: { ...s.models, [bill.id]: { ...bill, x: 4, y: 12 } } };
    s = run(s, ...rollReinforcements(s, dice([6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), uid));
    const thorin = who(s, 'thorin');
    s = run(s, { type: 'moveModels', moves: [{ id: thorin.id, x: 3, y: 12 }] });
    expect(distanceBetween(s.models[thorin.id], s.models[bill.id])).toBeGreaterThanOrEqual(1 - 1e-3);
  });

  it('brings the rest on without a roll as the Good side finishes its second move', () => {
    let s = run(mutton(1), { type: 'endActivation', seat: 'p1' });
    s = run(s, ...rollReinforcements(s, dice(Array(12).fill(1)), uid));
    expect(s.flow.done).toContain('p1');
    s = run({ ...s, turn: 2, flow: { ...s.flow, done: [] } }, { type: 'endActivation', seat: 'p1' });
    expect(reinforceDue(s)).toBe(true);
    const out = rollReinforcements(s, dice([]), uid);
    s = run(s, ...out);
    expect(out.find(a => a.type === 'entering')).toMatchObject({ ids: expect.arrayContaining([who(s, 'ori').id]) });
    expect(offTable(s)).toHaveLength(11);
  });

  it('lets a newcomer stay at the edge if its player ends its move, and the next one comes on', () => {
    let s = run(mutton(1), { type: 'endActivation', seat: 'p1' });
    s = run(s, ...rollReinforcements(s, dice([6, 6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), uid));
    expect(offTable(s)).toHaveLength(11);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(offTable(s)).toHaveLength(10);
    expect(s.flow.done).not.toContain('p1');
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).toContain('p1');
  });
});

describe('Roast Mutton: Bilbo, the dawn and the result', () => {
  const fightReq = (_: GameState, troll: string, bilbo: string): FightRequest => ({
    sides: [[{ id: bilbo, name: 'Bilbo', f: 3, a: 1, s: 2, d: 3 }], [{ id: troll, name: 'Troll', f: 6, a: 3, s: 6, d: 6 }]],
    targets: [troll, bilbo],
    trapped: false,
  });

  it('spares Bilbo from the Trolls until turn 3, or until he charges one', () => {
    const s = mutton(2);
    const bill = who(s, 'bill');
    const bilbo = who(s, 'bilbo');
    expect(adjustFight(s, fightReq(s, bill.id, bilbo.id), catalog).sides[1][0].spare).toEqual([bilbo.id]);
    expect(adjustFight({ ...s, turn: 3 }, fightReq(s, bill.id, bilbo.id), catalog).sides[1][0].spare).toBeUndefined();
    // Bilbo charges Bill.
    const near = { ...s, models: { ...s.models, [bilbo.id]: { ...bilbo, x: bill.x - 3, y: bill.y } } };
    const charged = run(near, { type: 'moveModels', moves: [{ id: bilbo.id, x: bill.x - 1.4, y: bill.y }] });
    expect(charged.narrative?.bilbo).toBe(true);
    expect(adjustFight(charged, fightReq(charged, bill.id, bilbo.id), catalog).sides[1][0].spare).toBeUndefined();
  });

  it('rolls for the sun from turn 7: a 4+ ends it in a draw', () => {
    let s = run(ask(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' }), { type: 'startGame', at: 1 });
    expect(dawnDue({ ...s, turn: 6 })).toBe(false);
    s = { ...s, turn: 7 };
    expect(dawnDue(s)).toBe(true);
    const dark = run(s, ...rollDawn(s, dice([3]), uid));
    expect(dawnDue(dark)).toBe(false);
    expect(gameWinner(dark)).toBeNull();
    const day = run(s, ...rollDawn(s, dice([4]), uid));
    expect(gameWinner(day)).toBe('draw');
  });

  it('gives the Company the win for three dead Trolls (a draw if Bilbo fell), and the Trolls the win when all are slain or sacked', () => {
    const s = mutton(3);
    const kill = (st: GameState, keys: string[]) => ({ ...st, models: Object.fromEntries(Object.values(st.models).map(m => [m.id, keys.includes(m.cast!) ? { ...m, dead: true, wounds: 0 } : m])) });
    expect(gameWinner(kill(s, ['bill', 'bert']))).toBeNull();
    expect(gameWinner(kill(s, ['bill', 'bert', 'tom']))).toBe('p1');
    expect(gameWinner(kill(s, ['bill', 'bert', 'tom', 'bilbo']))).toBe('draw');
    const company = Object.values(s.models).filter(m => m.owner === 'p1').map(m => m.cast!);
    const bag = (st: GameState, key: string): GameState => {
      const m = who(st, key);
      return { ...st, models: { ...st.models, [m.id]: { ...m, waiting: undefined, effects: [{ power: 'Paralyse', by: who(st, 'bill').id, turn: 3, duration: 'Exhaustion', sack: true }] } } };
    };
    const most = kill(s, company.filter(k => k !== 'bilbo'));
    expect(gameWinner(most)).toBeNull();
    const bagged = bag(most, 'bilbo');
    expect(sacked(who(bagged, 'bilbo'))).toBe(true);
    expect(gameWinner(bagged)).toBe('p2');
  });
});
