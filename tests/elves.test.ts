import { describe, expect, it } from 'vitest';
import { adjustFight, resolveRequest } from '../src/shared/resolve.ts';
import type { FightRequest } from '../src/shared/fight.ts';
import { castModel, holdNarrative, narrativeById, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { cannotAct } from '../src/shared/powers.ts';
import { basePerimeter, distanceBetween } from '../src/shared/geometry.ts';
import { insidePolygon, outline } from '../src/shared/sight.ts';
import { company, elvesArrive, elvesDue, elvesEdge, elvesWinner, hazeDue, hazeRolls, nestDue, nestFits, nestReturn } from '../src/shared/elves.ts';
import { DWARVES, MIDDLE, NEST_GAP } from '../src/shared/elvesMap.ts';
import { placingNow } from '../src/shared/placing.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';
import { markModel } from '../src/shared/marking.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const spiders = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'spider');
const elves = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'legolas' || m.cast === 'tauriel' || m.cast === 'ranger');
/** Whether a model stands on (or its base reaches onto) a tree: a great trunk, its mound of roots, or a lesser stand. */
const onTree = (s: GameState, m: Model) =>
  Object.values(s.terrain).some(t => (t.kind === 'wood' || t.sheer || t.id.startsWith('roots-')) && [m, ...basePerimeter(m, 8)].some(p => insidePolygon(outline(t), p)));
const r = (m: Model) => Math.max(m.base.w, m.base.h) / 50.8;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const dice = (...list: number[]) => {
  let i = 0;
  return () => list[i++ % list.length];
};

/** The Elves of Mirkwood set up as the server would, with the Good side on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'the-elves-of-mirkwood', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Set up done, the battle started, turn 1's Priority phase. */
const begun = () => run(setup(), { type: 'warbandDone', seat: 'p1' }, { type: 'warbandDone', seat: 'p2' }, { type: 'startGame', at: 1 });

describe('The Elves of Mirkwood: setting up', () => {
  it('sets out the cast: the company in the middle, ten Spiders 10" off, the Elves kept aside', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const co = company(s);
    expect(co.map(m => m.cast).sort()).toEqual([...DWARVES, 'bilbo'].sort());
    expect(castModel(s, 'thorin')!.options).toContain('Orcrist');
    expect(castModel(s, 'bilbo')!.options).toEqual(expect.arrayContaining(['Sting', 'The One Ring']));
    expect(castModel(s, 'bilbo')!.ringOn).toBeFalsy();
    for (const m of co) expect(Math.hypot(m.x - MIDDLE.x, m.y - MIDDLE.y) + r(m)).toBeLessThanOrEqual(MIDDLE.r + 0.01);
    expect(spiders(s)).toHaveLength(10);
    for (const sp of spiders(s)) for (const m of co) expect(distanceBetween(sp, m)).toBeGreaterThanOrEqual(NEST_GAP - 0.01);
    expect(elves(s)).toHaveLength(12);
    expect(elves(s).every(m => m.waiting)).toBe(true);
    expect(castModel(s, 'legolas')!.options).toContain('Elven cloak');
    expect(castModel(s, 'tauriel')!.options).toContain('Elf bow');
    // The company sets up first.
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p1' });
  });

  it('puts nobody on a tree or another model', () => {
    const s = setup();
    const on = Object.values(s.models).filter(m => !m.waiting);
    for (const m of on) expect(onTree(s, m), m.name).toBe(false);
    const trunks = Object.values(s.terrain).filter(t => t.look === 'trunk');
    expect(trunks.length).toBeGreaterThan(10);
    for (const m of on) {
      for (const t of trunks) expect(Math.hypot(t.x - m.x, t.y - m.y)).toBeGreaterThan(t.w / 2 + r(m) - 0.01);
      for (const o of on) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThan(r(o) + r(m) - 0.02);
      expect(holdNarrative(s, { id: m.id, x: m.x, y: m.y })).toMatchObject({ x: m.x, y: m.y });
    }
  });

  it('keeps the Spiders 10" from the company while setting up', () => {
    const s = run(setup(), { type: 'warbandDone', seat: 'p1' });
    const sp = spiders(s)[0];
    const thorin = castModel(s, 'thorin')!;
    expect(holdNarrative(s, { id: sp.id, x: thorin.x + 6, y: thorin.y })).toMatchObject({ x: sp.x, y: sp.y });
    expect(holdNarrative(s, { id: sp.id, x: 4, y: 40 })).toMatchObject({ x: 4, y: 40 });
  });
});

describe('The Elves of Mirkwood: the Haze of Mirkwood', () => {
  it('rolls for every Dwarf as the Move phase begins: on a 1-3 it is dazed for the turn', () => {
    let s = run(begun(), { type: 'choosePriority', seat: 'p1' });
    expect(s.phase).toBe('move');
    expect(hazeDue(s)).toBe(true);
    const dwarves = Object.values(s.models).filter(m => (DWARVES as readonly string[]).includes(m.cast ?? ''));
    // Thorin fails, the rest pass.
    const out = hazeRolls(s, dice(3, ...Array(12).fill(4)), uid);
    s = out.reduce(reduce, s);
    expect(hazeDue(s)).toBe(false);
    const thorin = castModel(s, 'thorin')!;
    expect(thorin.hazed).toBe(s.turn);
    expect(cannotAct(s, thorin)).toBe(true);
    expect(moveAllowance(s, thorin)).toBe(0);
    expect(dwarves.filter(m => s.models[m.id].hazed).length).toBe(1);
    // Bilbo is no Dwarf: the haze doesn't touch him.
    expect(castModel(s, 'bilbo')!.hazed).toBeUndefined();
    expect(cannotAct(s, castModel(s, 'kili')!)).toBe(false);
    // Next turn it has worn off.
    expect(cannotAct({ ...s, turn: s.turn + 1 }, thorin)).toBe(false);
  });

  it('a dazed Dwarf fights with one die and makes no strikes', () => {
    let s = run(begun(), { type: 'choosePriority', seat: 'p1' });
    s = hazeRolls(s, dice(1), uid).reduce(reduce, s);
    const thorin = castModel(s, 'thorin')!;
    const sp = spiders(s)[0];
    s = put(s, sp, { x: thorin.x + r(thorin) + r(sp), y: thorin.y });
    s = { ...s, phase: 'fight' };
    const req = { sides: [[{ id: thorin.id, name: thorin.name, f: 6, s: 4, a: 3, d: 7 }], [{ id: sp.id, name: sp.name, f: 3, s: 4, a: 2, d: 5 }]], targets: [sp.id, thorin.id] } as unknown as FightRequest;
    const fixed = adjustFight(s, req, catalog);
    expect(fixed.sides[0][0]).toMatchObject({ a: 1, noStrike: 'Dazed by the Haze of Mirkwood' });
  });
});

describe('The Elves of Mirkwood: the Rangers arrive', () => {
  it('as the Good side ends its fourth move, from the edge it chose', () => {
    let s = begun();
    s = run(s, { type: 'setPick', seat: 'p1', key: 'edge', value: 'west' });
    expect(elvesEdge(s)).toBe('west');
    // The Spiders' player can't choose it.
    expect(reduce(s, { type: 'setPick', seat: 'p2', key: 'edge', value: 'east' })).toBe(s);
    s = { ...s, turn: 4 };
    s = run(s, { type: 'choosePriority', seat: 'p1' });
    s = hazeRolls(s, dice(6), uid).reduce(reduce, s);
    s = run(s, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    // Ending the move waits for them.
    s = reduce(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.reinforce).toBe('p1');
    expect(elvesDue(s)).toBe(true);
    s = elvesArrive(s, uid).reduce(reduce, s);
    expect(s.flow.entering).toMatchObject({ seat: 'p1', from: [0, 24] });
    expect(s.flow.entering!.ids).toHaveLength(12);
    // The first of them stands at the west edge, to move on.
    const on = elves(s).filter(m => !m.waiting);
    expect(on.length).toBe(1);
    expect(on[0].x).toBeCloseTo(r(on[0]), 1);
    expect(elvesDue(s)).toBe(false);
  });

  it("doesn't come before the fourth turn", () => {
    let s = run(begun(), { type: 'choosePriority', seat: 'p1' });
    s = hazeRolls(s, dice(6), uid).reduce(reduce, s);
    s = run(s, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' }, { type: 'endActivation', seat: 'p1' });
    expect(elvesDue(s)).toBe(false);
    expect(s.flow.reinforce).toBeUndefined();
  });
});

describe("The Elves of Mirkwood: the Spider's Nest", () => {
  it('brings slain Spiders back as Priority begins, 10" from every Good model, for the Evil player to place', () => {
    let s = begun();
    const [a, b] = spiders(s);
    s = put(put(s, a, { dead: true, wounds: 0 }), b, { dead: true, wounds: 0 });
    // Not in the first turn.
    expect(nestDue(s)).toBe(false);
    s = { ...s, turn: 2 };
    expect(nestDue(s)).toBe(true);
    s = nestReturn(s, uid).reduce(reduce, s);
    expect(nestDue(s)).toBe(false);
    for (const m of [s.models[a.id], s.models[b.id]]) {
      expect(m.dead).toBeFalsy();
      expect(m.wounds).toBe(m.maxWounds);
      for (const o of company(s)) expect(distanceBetween(m, o)).toBeGreaterThanOrEqual(NEST_GAP - 0.01);
      expect(onTree(s, m)).toBe(false);
    }
    // The Evil player places them, one at a time, before Priority is rolled.
    const p = placingNow(s)!;
    expect(p).toMatchObject({ kind: 'nest', seat: 'p2' });
    expect(resolveRequest(s, 'p1', { type: 'rollPriority' } as Action, dice(3), uid, 1, catalog)).toBeNull();
    const thorin = castModel(s, 'thorin')!;
    const m = s.models[p.model];
    expect(reduce(s, { type: 'moveModels', moves: [{ id: m.id, x: thorin.x + 5, y: thorin.y }] }).models[m.id]).toMatchObject({ x: m.x, y: m.y });
    // Not out onto a tree.
    const tree = Object.values(s.terrain).find(t => t.kind === 'wood' && t.x > 38 && t.y > 26 && t.y < 28)!;
    expect(nestFits(s, m, { x: tree.x, y: tree.y })).toBe(false);
    const far = { x: 46, y: 46 };
    expect(nestFits(s, m, far)).toBe(true);
    s = reduce(s, { type: 'moveModels', moves: [{ id: m.id, ...far }] });
    expect(s.models[m.id]).toMatchObject(far);
    s = run(s, { type: 'placed', seat: 'p2' }, { type: 'placed', seat: 'p2' });
    expect(placingNow(s)).toBeUndefined();
  });
});

describe('The Elves of Mirkwood: winning', () => {
  const slay = (s: GameState, k: number) => company(s).slice(0, k).reduce((x, m) => put(x, m, { dead: true, wounds: 0 }), s);
  it('the Spiders win as soon as six of the company are slain', () => {
    const s = begun();
    expect(elvesWinner(slay(s, 5))).toBeNull();
    expect(elvesWinner(slay(s, 6))).toBe('p2');
    expect(narrativeWinner(slay(s, 6))).toBe('p2');
  });

  it('after 12 turns, ten or more alive wins for Good; fewer is a draw', () => {
    const s: GameState = { ...begun(), turn: 12, phase: 'end' };
    expect(elvesWinner({ ...s, turn: 11 })).toBeNull();
    expect(elvesWinner(slay(s, 4))).toBe('p1');
    expect(elvesWinner(slay(s, 5))).toBe('draw');
  });
});

describe('The Elves of Mirkwood: the computer', () => {
  it('plays both sides with nothing refused', () => {
    const s = begun();
    const refused: string[] = [];
    const { state } = play(s, seeded(4), 30000, st => st.turn > 6 || !!st.result, (_, seat, a, ok) => void (ok || refused.push(`${seat}:${a.type}`)));
    expect(refused).toEqual([]);
    // The Elves have arrived.
    expect(elves(state).filter(m => !m.waiting).length).toBeGreaterThan(0);
    expect(narrativeById('the-elves-of-mirkwood')).toBeDefined();
  }, 600000);
});
