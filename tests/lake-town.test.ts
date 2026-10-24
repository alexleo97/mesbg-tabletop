import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { activeSeat } from '../src/shared/flow.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { exitEdges } from '../src/shared/objects.ts';
import { inDeepWater, insidePolygon, outline } from '../src/shared/sight.ts';
import { shooterBlocked, weaponFor } from '../src/shared/shooting.ts';
import { crossingAhead } from '../src/shared/terrainTests.ts';
import { alarmDue, alarmRaised, bolgMustCharge, bolgOwesCharge, isSentry, keepInSection, lakeWinner, sectionOf, sentriesDue, sentryDue } from '../src/shared/lake.ts';
import { BARDS_REACH, SECTION_GAP, SECTION_WIDTH, SECTIONS } from '../src/shared/lakeMap.ts';
import { walkDistance, waypoint } from '../src/shared/lakeNav.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';
import { markModel } from '../src/shared/marking.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const r = (m: Model) => Math.max(m.base.w, m.base.h) / 50.8;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const orcs = (s: GameState) => Object.values(s.models).filter(m => m.cast?.startsWith('orc-'));
const dice = (...list: number[]) => {
  let i = 0;
  return () => list[i++ % list.length];
};
/** Takes a request's dice the way the server would. */
const ask = (s: GameState, seat: Seat, a: Action, d6: () => number) => {
  const out = resolveRequest(s, seat, a, d6, uid, 1, catalog);
  expect(out, a.type).toBeTruthy();
  return [...out!.apply, ...(out!.record ? [out!.record] : [])].reduce(reduce, s);
};

/** Lake-town Escape set up as the server would, with Legolas on p1. */
function setup(): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'lake-town-escape', good: 'p1' } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}
const begun = () => run(setup(), { type: 'warbandDone', seat: 'p2' }, { type: 'warbandDone', seat: 'p1' }, { type: 'startGame', at: 1 });
/** Turn 1's Move phase, the Orcs to move first. */
const evilMove = () => run(begun(), { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
/** Rolls every Sentry still due a 1, so it stays put. */
const settle = (s: GameState) => {
  for (const m of sentriesDue(s, 'p2')) s = ask(s, 'p2', { type: 'sentry', id: m.id }, dice(1));
  return s;
};

describe('Lake-town Escape: setting up', () => {
  it('sets out Legolas at Bard’s House and a group of six Orcs in each section, Bolg with A and Fimbul with C', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const legolas = castModel(s, 'legolas')!;
    expect(legolas.owner).toBe('p1');
    expect(legolas.options).toContain('Orcrist');
    expect(legolas.stats).toMatchObject({ Fv: 7, A: 3 });
    const house = s.terrain['n-bards-house'];
    expect(insidePolygon(outline({ ...house, w: house.w + 2 * r(legolas) + 0.1, h: house.h + 2 * r(legolas) + 0.1 }), legolas)).toBe(true);
    expect(castModel(s, 'bolg')!.fate).toBe(3);
    expect(sectionOf(castModel(s, 'bolg')!)).toBe('A');
    expect(castModel(s, 'fimbul')!.x).toBeGreaterThanOrEqual(SECTION_WIDTH * 2 + SECTION_GAP);
    expect(orcs(s)).toHaveLength(24);
    for (const sec of SECTIONS) {
      const group = orcs(s).filter(m => sectionOf(m) === sec);
      expect(group).toHaveLength(6);
      expect(group.filter(m => m.options?.includes('Orc bow'))).toHaveLength(2);
      expect(group.filter(m => m.options?.includes('Two-handed weapon'))).toHaveLength(2);
      const i = SECTIONS.indexOf(sec);
      for (const m of group) {
        expect(m.x - r(m)).toBeGreaterThanOrEqual(i * SECTION_WIDTH + (i ? SECTION_GAP : 0) - 0.01);
        expect(m.x + r(m)).toBeLessThanOrEqual((i + 1) * SECTION_WIDTH - (i < 3 ? SECTION_GAP : 0) + 0.01);
        if (sec === 'D') expect(Math.max(Math.abs(m.x - house.x) - house.w / 2, Math.abs(m.y - house.y) - house.h / 2) - r(m)).toBeLessThanOrEqual(BARDS_REACH + 0.01);
      }
    }
    // The Orcs set up first.
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p2' });
  });

  it('puts everybody on dry boards, clear of each other, where setting up allows', () => {
    const s = setup();
    const all = Object.values(s.models);
    for (const m of all) {
      expect(inDeepWater(s, m), m.name).toBe(false);
      expect(holdNarrative(s, { id: m.id, x: m.x, y: m.y })).toMatchObject({ x: m.x, y: m.y });
      for (const o of all) if (o.id !== m.id) expect(distanceBetween(o, m)).toBeGreaterThan(-0.02);
    }
  });

  it('has a way along the walkways (leaping the narrow gaps) from every Orc to Legolas', () => {
    const s = setup();
    const legolas = castModel(s, 'legolas')!;
    for (const m of [...orcs(s), castModel(s, 'bolg')!, castModel(s, 'fimbul')!]) expect(walkDistance(s, m, legolas), m.name).toBeLessThan(80);
    // And from Bard's House to the west edge, for Bolg on his way out.
    expect(walkDistance(s, legolas, { x: 0.5, y: 16 })).toBeLessThan(80);
    // A waypoint is somewhere dry, in a straight line.
    const wp = waypoint(s, castModel(s, 'bolg')!, legolas, 6)!;
    expect(inDeepWater(s, wp)).toBe(false);
  });
});

describe('Lake-town Escape: Deep Water', () => {
  it('stops a model going into the lake for a Swim test; a 1 sinks it, a 2-5 halves the Move it has left', () => {
    let s = run(begun(), { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    expect(activeSeat(s)).toBe('p1');
    const legolas = castModel(s, 'legolas')!;
    const c = crossingAhead(s, legolas, legolas, { x: legolas.x, y: legolas.y - 4 });
    expect(c).toMatchObject({ terrain: 'n-lake', test: 'Swim' });
    // It stops at the water's edge, for the test.
    s = run(s, { type: 'moveModels', moves: [{ id: legolas.id, x: legolas.x, y: legolas.y - 4, rot: 0 }] });
    expect(inDeepWater(s, s.models[legolas.id])).toBe(false);
    expect(s.flow.blocked?.[legolas.id]?.test).toBe('Swim');
    // A 1: lost in the lake.
    const sunk = ask(s, 'p1', { type: 'cross', id: legolas.id }, dice(1));
    expect(sunk.models[legolas.id].dead).toBe(true);
    expect(narrativeWinner(sunk)).toBe('p2');
    // A 3: in the water, with half the Move it had left.
    const wet = ask(s, 'p1', { type: 'cross', id: legolas.id }, dice(3));
    const l = wet.models[legolas.id];
    expect(l.dead).toBeFalsy();
    expect(inDeepWater(wet, l)).toBe(true);
    const walked = Math.hypot(l.x - legolas.x, l.y - legolas.y);
    expect(moveAllowance(wet, l)!).toBeLessThan(6 - walked);
    // Nobody shoots from the water.
    expect(shooterBlocked(wet, l, weaponFor(catalog, l)!, false, catalog)).toBe('is in deep water');
    // Starting its next move in it, it tests before it goes anywhere.
    const later = { ...wet, flow: { ...wet.flow, crossed: {} } };
    expect(crossingAhead(later, l, l, { x: l.x, y: l.y - 2 })).toMatchObject({ test: 'Swim', stop: { x: l.x, y: l.y } });
  });

  it('leaps a gap no wider than twice its height', () => {
    let s = setup();
    // (The group south of Bard's House moved out of the way.)
    for (const m of orcs(s).filter(o => sectionOf(o) === 'D')) s = put(s, m, { x: 2 + Math.random(), y: 40 });
    const legolas = castModel(s, 'legolas')!;
    s = put(s, legolas, { x: 41.7, y: 24 });
    expect(crossingAhead(s, s.models[legolas.id], { x: 41.7, y: 24 }, { x: 41.7, y: 20.8 })).toMatchObject({ test: 'Leap' });
  });
});

describe('Lake-town Escape: Silent Assassins', () => {
  it('only the Orcs in section D know Legolas is there', () => {
    const s = begun();
    for (const m of [...orcs(s), castModel(s, 'bolg')!, castModel(s, 'fimbul')!]) expect(isSentry(s, m), m.cast).toBe(sectionOf(m) !== 'D');
    expect(isSentry(s, castModel(s, 'legolas')!)).toBe(false);
  });

  it('each Sentry rolls on the Sentry Chart as it activates, before the rest of its side moves', () => {
    let s = evilMove();
    expect(activeSeat(s)).toBe('p2');
    expect(sentriesDue(s, 'p2')).toHaveLength(20);
    // The section D Orcs wait.
    const d = orcs(s).find(m => sectionOf(m) === 'D' && m.y > 22)!;
    expect(run(s, { type: 'moveModels', moves: [{ id: d.id, x: d.x, y: d.y + 1, rot: 0 }] }).models[d.id].y).toBe(d.y);
    expect(reduce(s, { type: 'endActivation', seat: 'p2' })).toBe(s);
    const [a, b, c, e] = orcs(s).filter(m => sectionOf(m) === 'A');
    // 1: searches about, and doesn't move.
    s = ask(s, 'p2', { type: 'sentry', id: a.id }, dice(1));
    expect(sentryDue(s, s.models[a.id])).toBe(false);
    expect(moveAllowance(s, s.models[a.id])).toBe(0);
    // 2: the Good player moves it, up to half its Move, and may stop when they like.
    s = ask(s, 'p2', { type: 'sentry', id: b.id }, dice(2));
    expect(s.flow.skitter).toMatchObject({ model: b.id, by: 'p1', dist: 3, upTo: true });
    // (Nobody else moves meanwhile.)
    expect(run(s, { type: 'moveModels', moves: [{ id: c.id, x: c.x + 1, y: c.y, rot: 0 }] }).models[c.id].x).toBe(c.x);
    s = run(s, { type: 'moveModels', moves: [{ id: b.id, x: b.x + 1, y: b.y, rot: 0 }] }, { type: 'skitterDone', seat: 'p1' });
    expect(s.models[b.id].x).toBeCloseTo(b.x + 1, 2);
    expect(s.flow.skitter).toBeUndefined();
    // 4: the Evil player moves it, no more than half its Move.
    s = ask(s, 'p2', { type: 'sentry', id: c.id }, dice(4));
    expect(s.flow.skitter).toMatchObject({ model: c.id, by: 'p2', dist: 3 });
    s = run(s, { type: 'moveModels', moves: [{ id: c.id, x: c.x + 5, y: c.y, rot: 0 }] }, { type: 'skitterDone', seat: 'p2' });
    expect(s.models[c.id].x - c.x).toBeLessThanOrEqual(3.01);
    // 6: moves as normal, but still can't shoot.
    s = ask(s, 'p2', { type: 'sentry', id: e.id }, dice(6));
    expect(s.flow.skitter).toBeUndefined();
    expect(sentryDue(s, s.models[e.id])).toBe(false);
    expect(moveAllowance(s, s.models[e.id])).toBe(6);
    const bow = orcs(s).find(m => sectionOf(m) === 'A' && m.options?.includes('Orc bow'))!;
    expect(shooterBlocked(s, bow, weaponFor(catalog, bow)!, false, catalog)).toMatch(/Sentry/);
  });

  it('keeps a Sentry in its own section, and out of base contact with Legolas', () => {
    let s = evilMove();
    const b = orcs(s).find(m => sectionOf(m) === 'B' && Math.abs(m.y - 24) < 0.1)!;
    expect(keepInSection(s, b, b, { x: 30, y: 24 }).x).toBeLessThanOrEqual(SECTION_WIDTH * 2 - r(b) + 0.02);
    // Legolas right in front of a Sentry that rolled a 6: it won't charge him.
    const legolas = castModel(s, 'legolas')!;
    s = put(s, legolas, { x: b.x + 2, y: b.y });
    s = ask(s, 'p2', { type: 'sentry', id: b.id }, dice(6));
    s = run(s, { type: 'moveModels', moves: [{ id: b.id, x: b.x + 2 - r(b) - r(legolas), y: b.y, rot: 90 }] });
    expect(distanceBetween(s.models[b.id], s.models[legolas.id])).toBeGreaterThan(0.05);
  });

  it('raises the alarm at once when an Orc that knows walks up to a Sentry', () => {
    let s = settle(evilMove());
    const sentry = orcs(s).find(m => sectionOf(m) === 'C' && m.y > 40)!;
    const d = orcs(s).find(m => sectionOf(m) === 'D' && m.y > 22)!;
    // (Brought close by, to walk the last inch.)
    s = put(s, d, { x: sentry.x + 2, y: sentry.y });
    s = run(s, { type: 'moveModels', moves: [{ id: d.id, x: sentry.x + r(sentry) + r(d), y: sentry.y, rot: 270 }] });
    expect(s.narrative?.alarm).toEqual(['C']);
    expect(isSentry(s, s.models[sentry.id])).toBe(false);
    expect(isSentry(s, castModel(s, 'fimbul')!)).toBe(false);
    expect(isSentry(s, orcs(s).find(m => sectionOf(m) === 'B')!)).toBe(true);
  });

  it('raises it in the End phase if Legolas charged a Sentry and it lived', () => {
    let s = run(begun(), { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    const legolas = castModel(s, 'legolas')!;
    const sentry = orcs(s).find(m => sectionOf(m) === 'B' && Math.abs(m.y - 24) < 0.1)!;
    s = put(s, legolas, { x: sentry.x - 4, y: sentry.y });
    s = run(s, { type: 'moveModels', moves: [{ id: legolas.id, x: sentry.x - r(sentry) - r(legolas), y: sentry.y, rot: 90 }] });
    expect(s.narrative?.disturbed).toEqual([{ id: sentry.id, turn: 1 }]);
    const end = { ...s, phase: 'end' as const };
    expect(alarmDue(end)).toBe(true);
    const raised = alarmRaised(end, uid).reduce(reduce, end);
    expect(raised.narrative?.alarm).toEqual(['B']);
    expect(alarmDue(raised)).toBe(false);
    // Slain, it tells nobody.
    const slain = put(end, sentry, { dead: true, wounds: 0 });
    expect(alarmRaised(slain, uid).reduce(reduce, slain).narrative?.alarm ?? []).toEqual([]);
  });
});

describe('Lake-town Escape: the Spawn of Azog', () => {
  it('Bolg leaves only by the west edge, and only once he is hurt', () => {
    const s = begun();
    const bolg = castModel(s, 'bolg')!;
    expect(exitEdges(s, bolg)).toEqual([]);
    expect(exitEdges(s, { ...bolg, wounds: bolg.maxWounds - 1 })).toEqual(['left']);
    expect(exitEdges(s, orcs(s)[0])).toEqual([]);
  });

  it('must charge Legolas when he knows he is there and can reach him', () => {
    let s = evilMove();
    s = { ...s, narrative: { ...s.narrative!, alarm: ['A'] } };
    s = settle(s);
    const bolg = castModel(s, 'bolg')!;
    const legolas = castModel(s, 'legolas')!;
    s = put(s, legolas, { x: bolg.x + 4, y: bolg.y });
    expect(bolgMustCharge(s)).toBe(true);
    expect(bolgOwesCharge(s)).toBe(true);
    expect(reduce(s, { type: 'endActivation', seat: 'p2' })).toBe(s);
    // Hurt, he needn't.
    expect(bolgMustCharge(put(s, bolg, { wounds: bolg.maxWounds - 1 }))).toBe(false);
    s = run(s, { type: 'moveModels', moves: [{ id: bolg.id, x: bolg.x + 4 - r(bolg) - r(legolas), y: bolg.y, rot: 90 }] });
    expect(bolgOwesCharge(s)).toBe(false);
  });
});

describe('Lake-town Escape: who wins', () => {
  const end = (s: GameState): GameState => ({ ...s, phase: 'end', narrative: { ...s.narrative!, alarmed: s.turn } });
  it('Legolas once every Orc is slain; the Orcs once Legolas is, or Bolg gets away unhurt', () => {
    const s = begun();
    const evil = Object.values(s.models).filter(m => m.owner === 'p2');
    const allSlain = evil.reduce((x, m) => put(x, m, { dead: true, wounds: 0 }), s);
    expect(lakeWinner(allSlain)).toBe('p1');
    expect(lakeWinner(put(s, castModel(s, 'legolas')!, { dead: true, wounds: 0 }))).toBe('p2');
    const bolg = castModel(s, 'bolg')!;
    const fled = put(s, bolg, { escaped: true, wounds: 2 });
    // At the end of the turn.
    expect(lakeWinner(fled)).toBeNull();
    expect(lakeWinner(end(fled))).toBe('p2');
    expect(lakeWinner(end(put(s, bolg, { escaped: true, wounds: 1 })))).toBe('draw');
    expect(lakeWinner(end(s))).toBeNull();
  });
});

describe('Lake-town Escape: the computer', () => {
  it('plays both sides to the end with nothing refused', () => {
    const refused: string[] = [];
    const { state } = play(begun(), seeded(2), 40000, st => st.turn > 30, (_, seat, a, ok) => void (ok || refused.push(`${seat}:${a.type}`)));
    expect(refused).toEqual([]);
    expect(state.result).toBeTruthy();
    // The alarm went up somewhere along the way.
    expect(state.narrative?.alarm?.length).toBeGreaterThan(0);
  }, 600000);
});
