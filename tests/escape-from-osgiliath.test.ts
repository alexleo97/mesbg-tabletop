import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { exitEdges } from '../src/shared/objects.ts';
import { dreadDue } from '../src/shared/flow.ts';
import {
  ageOfMen,
  dreaded,
  escapedWorth,
  hordeArrives,
  hordePoint,
  isOrc,
  mayOrcTime,
  orcTimeFor,
  osgiliathWinner,
  slainOrcs,
  wellAimed,
} from '../src/shared/osgiliath.ts';
import { BOARD, DOOR_WIDTH, EAST_ZONE, GOOD_REACH, MIDDLE, RUIN_HEIGHT, WALL_HEIGHT, WEST_ZONE, WHOLE_HEIGHT } from '../src/shared/osgiliathMap.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const good = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p1');
const evil = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p2');
const orcs = (s: GameState) => Object.values(s.models).filter(isOrc);
const inBox = (m: Model, [x0, y0, x1, y1]: number[]) => m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1;

/** Escape from Osgiliath set up as the server would, with the Good side on `side`. */
function setup(side: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'escape-from-osgiliath', good: side } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Both sides set up, the battle started. */
const begun = (): GameState => run(setup(), { type: 'warbandDone', seat: 'p1' }, { type: 'warbandDone', seat: 'p2' }, { type: 'startGame', at: 1 });

/** The Move phase of `turn`, `seat` having Priority. */
const moveFor = (s: GameState, turn = 1, seat: Seat = 'p1'): GameState => {
  const out = run({ ...s, turn: 1, phase: 'priority', flow: { ...s.flow, done: [] } }, { type: 'choosePriority', seat }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  return { ...out, turn };
};

describe('Escape from Osgiliath: the table and the cast', () => {
  it("a 4' by 4' ruined city: broken walls, two whole walls, tower stumps, three roofless ruins and rubble", () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: BOARD, h: BOARD });
    const t = Object.values(s.terrain);
    expect(t.filter(x => x.look === 'osgwall').length).toBeGreaterThan(50);
    expect(t.filter(x => x.look === 'osgwall' && x.height === WHOLE_HEIGHT).length).toBe(5);
    // The ruins: thick walls a storey and more high, with a doorway in each.
    const ruins = t.filter(x => x.id.includes('ruin-'));
    expect(ruins.every(x => x.height === RUIN_HEIGHT)).toBe(true);
    for (const i of [1, 2, 3]) {
      const [a, b] = ruins.filter(x => /a$|b$/.test(x.id) && x.id.includes(`ruin-${i}-`));
      const ends = (x: typeof a) => [-1, 1].map(k => ({ x: x.x + (k * (x.w / 2) * Math.cos((x.rot * Math.PI) / 180)), y: x.y + (k * (x.w / 2) * Math.sin((x.rot * Math.PI) / 180)) }));
      const gap = Math.min(...ends(a).flatMap(p => ends(b).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
      expect(gap).toBeCloseTo(DOOR_WIDTH, 1);
    }
    // The broken walls are low enough to jump; nothing but the ruins and the two whole walls needs climbing.
    expect(t.filter(x => x.look === 'osgwall' && x.height! > WALL_HEIGHT).every(x => x.height === RUIN_HEIGHT || x.height === WHOLE_HEIGHT)).toBe(true);
    expect(WALL_HEIGHT).toBeLessThanOrEqual(1.1);
    expect(t.filter(x => x.look === 'rubble').every(x => x.difficult)).toBe(true);
  });

  it('the cast: Faramir, Madril, Damrod, 12 Warriors of Minas Tirith, 12 Rangers; Gothmog, his Enforcer, Guritz, 24 Orcs and a Troll', () => {
    const s = setup();
    expect(good(s).length).toBe(27);
    expect(evil(s).length).toBe(28);
    expect(orcs(s).length).toBe(24);
    for (const k of ['faramir', 'madril', 'damrod', 'gothmog', 'enforcer', 'guritz', 'troll']) expect(castModel(s, k)).toBeDefined();
    expect(good(s).filter(m => m.cast === 'warrior').length).toBe(12);
    expect(good(s).filter(m => m.cast === 'ranger').length).toBe(12);
  });

  it('the Good side starts wholly within 6" of the middle; Gothmog and half the Orcs in the east, the rest in the west', () => {
    const s = setup();
    for (const m of good(s)) expect(Math.hypot(m.x - MIDDLE.x, m.y - MIDDLE.y) + 0.49).toBeLessThanOrEqual(GOOD_REACH + 0.01);
    expect(inBox(castModel(s, 'gothmog')!, EAST_ZONE)).toBe(true);
    expect(inBox(castModel(s, 'enforcer')!, EAST_ZONE)).toBe(true);
    expect(inBox(castModel(s, 'guritz')!, WEST_ZONE)).toBe(true);
    expect(inBox(castModel(s, 'troll')!, WEST_ZONE)).toBe(true);
    expect(orcs(s).filter(m => inBox(m, EAST_ZONE)).length).toBe(12);
    expect(orcs(s).filter(m => inBox(m, WEST_ZONE)).length).toBe(12);
    // Nobody shares a spot.
    const ms = Object.values(s.models);
    for (const a of ms) for (const b of ms) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.95);
  });
});

describe('Escape from Osgiliath: getting away and who wins', () => {
  it('only Good models leave the table, and only by the west edge', () => {
    const s = begun();
    expect(exitEdges(s, castModel(s, 'faramir')!)).toEqual(['left']);
    expect(exitEdges(s, castModel(s, 'gothmog')!)).toEqual([]);
  });

  it('nine off the west edge wins; Faramir off holds the Evil side to a draw, Faramir slain holds the Good side to one', () => {
    const s = begun();
    const men = good(s).filter(m => m.cast === 'warrior' || m.cast === 'ranger');
    const faramir = castModel(s, 'faramir')!;
    const gone = (st: GameState, k: number, patch: Partial<Model>) => men.slice(0, k).reduce((x, m) => put(x, m, patch), st);
    expect(osgiliathWinner(s)).toBeNull();
    // Nobody left on the table: nine away is a Good win, eight an Evil one.
    const allDead = good(s).reduce((x, m) => put(x, m, { dead: true }), s);
    expect(osgiliathWinner(allDead)).toBe('p2');
    expect(osgiliathWinner(gone(allDead, 9, { dead: false, escaped: true }))).toBe('draw'); // (Faramir slain)
    const faramirOff = put(allDead, faramir, { dead: false, escaped: true });
    expect(osgiliathWinner(faramirOff)).toBe('draw');
    expect(osgiliathWinner(gone(faramirOff, 8, { dead: false, escaped: true }))).toBe('p1');
    expect(narrativeWinner(gone(faramirOff, 8, { dead: false, escaped: true }))).toBe('p1');
    // Settled early once nothing can change it.
    expect(osgiliathWinner(gone(put(s, faramir, { escaped: true }), 8, { escaped: true }))).toBe('p1');
    // Under Wizard's Pupil Faramir counts twice.
    expect(escapedWorth(put(faramirOff, faramir, { dominant: 2 }))).toBe(2);
  });
});

describe('Escape from Osgiliath: Hordes Without End', () => {
  it('a D6 for each slain Orc (never the Troll); each 4+ comes back from a Reinforcement Point', () => {
    let s = moveFor(begun(), 2, 'p2');
    const [a, b, c] = orcs(s);
    s = [a, b, c].reduce((x, m) => put(x, m, { dead: true }), put(s, castModel(s, 'troll')!, { dead: true }));
    expect(slainOrcs(s).length).toBe(3);
    const dice = [4, 1, 6];
    const out = hordeArrives(s, () => dice.shift()!, uid, 1);
    const entering = out.find(x => x.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(entering.ids).toEqual([a.id, c.id]);
    expect([0, BOARD]).toContain(entering.from![1]);
    expect(out.filter(x => x.type === 'affect').length).toBe(2);
    // The Evil player may name the point.
    expect(hordePoint({ ...s, flow: { ...s.flow, picks: { p1: {}, p2: { edge: 'south' } } } })).toBe('south');
  });
});

describe('Escape from Osgiliath: "Nazgûl!"', () => {
  it('as each Move phase begins the Evil player picks a Good Warrior: on a 3+ it is frozen, still fighting but at Fight 1', () => {
    let s = moveFor(begun(), 1);
    expect(dreadDue(s)).toBe(true);
    const w = good(s).find(m => m.cast === 'warrior')!;
    expect(resolveRequest(s, 'p1', { type: 'nazgul', target: w.id }, () => 6, uid, 1, catalog)).toBeNull();
    expect(resolveRequest(s, 'p2', { type: 'nazgul', target: castModel(s, 'faramir')!.id }, () => 6, uid, 1, catalog)).toBeNull();
    const out = resolveRequest(s, 'p2', { type: 'nazgul', target: w.id }, () => 3, uid, 1, catalog)!;
    s = run(s, ...out.apply);
    expect(dreaded(s, s.models[w.id])).toBe(true);
    expect(dreadDue(s)).toBe(false);
    // Once a turn.
    expect(resolveRequest(s, 'p2', { type: 'nazgul' }, () => 3, uid, 1, catalog)).toBeNull();
    // A 1 or 2 and the Warrior holds firm; or the Evil player picks nobody.
    const t = moveFor(begun(), 1);
    const v = good(t).find(m => m.cast === 'warrior')!;
    const held = run(t, ...resolveRequest(t, 'p2', { type: 'nazgul', target: v.id }, () => 2, uid, 1, catalog)!.apply);
    expect(dreaded(held, held.models[v.id])).toBe(false);
    expect(dreadDue(run(t, ...resolveRequest(t, 'p2', { type: 'nazgul' }, () => 2, uid, 1, catalog)!.apply))).toBe(false);
  });
});

describe('Escape from Osgiliath: the heroes\' own rules', () => {
  it('The Age of Men is Over: Orcs within 3" of Gothmog hate Men; the time of the Orc lets those within 12" re-roll To Wound', () => {
    let s = begun();
    const gothmog = castModel(s, 'gothmog')!;
    const [near, far] = orcs(s);
    s = put(s, gothmog, { x: 30, y: 10 });
    s = put(s, near, { x: 32, y: 10 });
    s = put(s, far, { x: 30, y: 30 });
    expect(ageOfMen(s, catalog, s.models[near.id])).toBe(true);
    expect(ageOfMen(s, catalog, s.models[far.id])).toBe(false);
    expect(ageOfMen(s, catalog, s.models[gothmog.id])).toBe(false);
    s = { ...s, phase: 'fight', flow: { ...s.flow, resolved: [], duels: [] } };
    expect(mayOrcTime(s, catalog, s.models[gothmog.id])).toBe(true);
    s = run(s, ...resolveRequest(s, 'p2', { type: 'orcTime', id: gothmog.id }, () => 3, uid, 1, catalog)!.apply);
    expect(orcTimeFor(s, catalog, s.models[near.id])).toBe(true);
    expect(orcTimeFor(s, catalog, s.models[far.id])).toBe(false);
    expect(mayOrcTime(s, catalog, s.models[gothmog.id])).toBe(false);
  });

  it("Damrod's Well-aimed Shot: In the Way is an Intelligence test", () => {
    const s = setup();
    expect(wellAimed(catalog, castModel(s, 'damrod')!)).toBeGreaterThan(0);
    expect(wellAimed(catalog, castModel(s, 'madril')!)).toBeUndefined();
  });

  it('a saved game keeps the Orcs coming back and the Nazgûl', () => {
    const s = begun();
    const saved = { ...s, narrative: { ...s.narrative!, horde: 3, dread: 3 } };
    expect(loadState(JSON.parse(JSON.stringify(saved))).narrative).toMatchObject({ horde: 3, dread: 3 });
  });
});

describe('Escape from Osgiliath: the computer', () => {
  it('plays both sides through to a result with nothing refused', () => {
    const refused: string[] = [];
    const watch = (st: GameState, seat: Seat, a: Action, ok: boolean) => void (ok || refused.push(`${st.turn}:${st.phase}:${seat}:${a.type}`));
    const pre = play(setup(), seeded(3), 2000, st => st.flow.deploy?.step === 'done', watch).state;
    const { state } = play(run(pre, { type: 'startGame', at: 1 }), seeded(3), 60000, st => !!st.result || st.turn > 30, watch);
    expect(refused).toEqual([]);
    expect(state.result?.winner).toBeDefined();
    // (Compared as saved: a save is JSON, where a turn of -0 is just 0.)
    const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    const back = loadState(json(state));
    expect(json(back.narrative)).toEqual(json(state.narrative));
    expect(json(back.models)).toEqual(json(state.models));
    expect(json(back.flow)).toEqual(json(state.flow));
  }, 600000);
});
