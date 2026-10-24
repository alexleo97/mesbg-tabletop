import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { insidePolygon, outline } from '../src/shared/sight.ts';
import { flying, inWoods, landsAt, limitMove, moveAllowance } from '../src/shared/movement.ts';
import { fighterOf, strikeAgainst } from '../src/shared/wargear.ts';
import { strikeWounds } from '../src/shared/fight.ts';
import { brutalOptions } from '../src/shared/monsters.ts';
import { standFastRange, terrifies } from '../src/shared/courage.ts';
import { exitEdges } from '../src/shared/objects.ts';
import {
  bilboTargets,
  dwarfMarkers,
  eaglesArrive,
  eaglesComing,
  eaglesDue,
  eaglesEdge,
  fireWinner,
  landingBeside,
  markerSpot,
  nominationTurn,
  pines,
  stillToCarry,
  wrathDue,
  wrathMove,
} from '../src/shared/eagles.ts';
import { BOARD, EVIL_ZONE, HIDING_TREES, THORINS_TREE } from '../src/shared/eaglesMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const r = (m: Model) => Math.max(m.base.w, m.base.h) / 50.8;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const eagles = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'eagle');
const hunters = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p2');
const tree = (s: GameState, id: string) => s.terrain[`n-${id}`];

/** And Into the Fire set up as the server would, with the Good side on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'and-into-the-fire', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Both sides set up (the Evil side first). */
const placed = () => run(setup(), { type: 'warbandDone', seat: 'p2' }, { type: 'warbandDone', seat: 'p1' });

/** Five trees nominated, the battle started, turn 1's Priority phase. */
function begun(trees = ['pine-3', 'pine-42', 'pine-2', 'pine-25', 'pine-40']): GameState {
  let s = placed();
  trees.forEach((t, i) => (s = run(s, { type: 'nominate', seat: i % 2 ? 'p2' : 'p1', tree: `n-${t}` })));
  return run(s, { type: 'startGame', at: 1 });
}

/** The Good side's Move phase in `turn`, the Good side having Priority. */
const goodMove = (s: GameState, turn = 1, wrath = true): GameState => {
  const out = run({ ...s, phase: 'priority', flow: { ...s.flow, done: [] } }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  return { ...out, turn, narrative: { ...out.narrative!, ...(wrath ? { wrath: turn } : {}) } };
};

/** An Eagle on the table at `at`. */
const eagleAt = (s: GameState, at: { x: number; y: number }, k = 0): [GameState, Model] => {
  const e = eagles(s)[k];
  const out = put(s, e, { ...at, waiting: undefined });
  return [out, out.models[e.id]];
};

describe('And Into the Fire: the table and the cast', () => {
  it('a 4\' by 4\' table: the pines down the east, the cliff edge beyond them, outcrops and brush to the west', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: BOARD, h: BOARD });
    expect(pines(s).length).toBe(44);
    expect(Object.values(s.terrain).filter(t => t.look === 'pinewood').length).toBe(24);
    expect(tree(s, 'cliff-edge')).toMatchObject({ kind: 'cliff', difficult: true });
    expect(Object.values(s.terrain).filter(t => t.kind === 'rock').length).toBe(5);
    expect(tree(s, 'brush')).toMatchObject({ kind: 'wood', look: 'brush' });
    // Every pine stands on a woodland base (or in the brush), and no two trunks touch.
    const woods = Object.values(s.terrain).filter(t => t.kind === 'wood');
    for (const p of pines(s)) {
      expect(woods.some(w => insidePolygon(outline(w), p)), p.id).toBe(true);
      for (const q of pines(s)) if (q.id !== p.id) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan((p.w + q.w) / 2);
    }
  });

  it('the exact cast: Azog, Fimbul, 12 Warg Riders and 12 Fell Wargs against Thorin, Bilbo, Gwaihir and 4 Great Eagles', () => {
    const s = setup();
    const by = (k: string) => Object.values(s.models).filter(m => m.cast === k);
    expect(by('rider')).toHaveLength(12);
    expect(by('warg')).toHaveLength(12);
    expect(by('eagle')).toHaveLength(4);
    for (const k of ['azog', 'fimbul', 'thorin', 'bilbo', 'gwaihir']) expect(by(k), k).toHaveLength(1);
    expect(castModel(s, 'thorin')!.options).toEqual(expect.arrayContaining(['Orcrist', 'The Oakenshield']));
    expect(castModel(s, 'bilbo')!.options).toEqual(expect.arrayContaining(['Sting', 'The One Ring']));
    expect(castModel(s, 'azog')!.options).toContain('The White Warg');
    // Only Thorin starts on the table for the Good side.
    expect(Object.values(s.models).filter(m => m.owner === 'p1' && !m.waiting).map(m => m.cast)).toEqual(['thorin']);
    // The Evil side sets up first, wholly within 6" of the west edge.
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p2' });
    for (const m of hunters(s)) expect(m.x + r(m)).toBeLessThanOrEqual(EVIL_ZONE[2] + 0.01);
  });

  it('Thorin touches the tree nearest the middle of the west side of the stand', () => {
    const s = setup();
    const thorin = castModel(s, 'thorin')!;
    const t = tree(s, THORINS_TREE);
    expect(Math.hypot(t.x - thorin.x, t.y - thorin.y) - t.w / 2 - r(thorin)).toBeLessThan(0.1);
    // No pine is nearer the middle of the west edge... among the stand's west-facing trees.
    expect(Math.abs(t.y - BOARD / 2)).toBeLessThan(2);
  });

  it('puts nobody on a tree, a rock or another model, and holds the Hunters to their zone', () => {
    const s = setup();
    const on = Object.values(s.models).filter(m => !m.waiting);
    const solid = Object.values(s.terrain).filter(t => t.look === 'pine' || t.kind === 'rock');
    for (const m of on) {
      for (const t of solid) expect(insidePolygon(outline(t), m), `${m.name} on ${t.id}`).toBe(false);
      for (const o of on) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThan(r(o) + r(m) - 0.02);
    }
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    expect(holdNarrative(s, { id: rider.id, x: 20, y: 20 })).toMatchObject({ x: rider.x, y: rider.y });
  });
});

describe('And Into the Fire: hiding in the trees', () => {
  it('once both sides are set up, they take turns nominating five trees, the Good player first', () => {
    let s = placed();
    expect(nominationTurn(s)).toBe('p1');
    // Not out of turn, not something that isn't a tree, and not the same tree twice.
    expect(run(s, { type: 'nominate', seat: 'p2', tree: 'n-pine-1' })).toBe(s);
    expect(run(s, { type: 'nominate', seat: 'p1', tree: 'n-brush' })).toBe(s);
    s = run(s, { type: 'nominate', seat: 'p1', tree: 'n-pine-1' });
    expect(nominationTurn(s)).toBe('p2');
    expect(run(s, { type: 'nominate', seat: 'p2', tree: 'n-pine-1' })).toBe(s);
    for (const [seat, t] of [['p2', 'pine-42'], ['p1', 'pine-5'], ['p2', 'pine-30'], ['p1', 'pine-44']] as const) s = run(s, { type: 'nominate', seat, tree: `n-${t}` });
    expect(s.narrative!.hiding).toHaveLength(HIDING_TREES);
    expect(nominationTurn(s)).toBeNull();
    expect(s.flow.deploy?.step).toBe('done');
  });

  it('puts a Dwarf Marker beside each tree, just off its woodland base, where an Eagle can land touching it', () => {
    const s = begun();
    const markers = dwarfMarkers(s);
    expect(markers).toHaveLength(HIDING_TREES);
    s.narrative!.hiding!.forEach((id, i) => {
      const t = s.terrain[id];
      const mk = markers[i];
      expect(Math.hypot(mk.x - t.x, mk.y - t.y)).toBeLessThan(t.w / 2 + 3);
      expect(inWoods(s, mk), id).toBe(false);
      const [s2, e] = eagleAt(s, { x: 24, y: 24 });
      expect(landingBeside(s2, e, mk), id).toBeDefined();
    });
    // Dwarf Markers can't be picked up by anyone but the Eagles (see pickUps).
    expect(markerSpot(s, tree(s, 'pine-1'))).toBeDefined();
  });
});

describe('And Into the Fire: Fly', () => {
  it('an Eagle flies over the pines and lands anywhere clear, but never in a wood or on a tree', () => {
    let s = goodMove(begun());
    let e: Model;
    [s, e] = eagleAt(s, { x: 30, y: 2.5 });
    expect(flying(s, e)).toBe(true);
    expect(moveAllowance(s, e)).toBe(12);
    // Straight over the stand to the open ground beyond the cliff side... but not into a wood.
    const over = limitMove(s, e, { x: 30, y: 13 }, 12, 'p1', e);
    expect(over).toMatchObject({ x: 30, y: 13 });
    const w = tree(s, 'stand-h');
    expect(landsAt(s, e, w)).toBe(false);
    const t = tree(s, 'pine-18');
    expect(landsAt(s, e, t)).toBe(false);
    const short = limitMove(s, e, { x: w.x, y: w.y }, 30, 'p1', e);
    expect(inWoods(s, short)).toBe(false);
  });

  it('it may not land in an enemy\'s control zone without charging it', () => {
    let s = goodMove(begun());
    let e: Model;
    [s, e] = eagleAt(s, { x: 20, y: 10 });
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    s = put(s, rider, { x: 20, y: 20 });
    const to = limitMove(s, e, { x: 20, y: 20 - r(rider) - r(e) - 0.5 }, 12, 'p1', e, undefined, false);
    expect(distanceBetween({ ...e, ...to }, s.models[rider.id])).toBeGreaterThanOrEqual(1 - 0.02);
    const charge = limitMove(s, e, { x: 20, y: 20 - r(rider) - r(e) }, 12, 'p1', e);
    expect(distanceBetween({ ...e, ...charge }, s.models[rider.id])).toBeLessThan(0.05);
  });

  it('one that starts in a wood, or chooses to walk, moves 4" on foot', () => {
    let s = goodMove(begun());
    let e: Model;
    const w = tree(s, 'stand-h');
    [s, e] = eagleAt(s, { x: w.x + 1.5, y: w.y + 0.4 });
    expect(inWoods(s, e)).toBe(true);
    expect(flying(s, e)).toBe(false);
    expect(moveAllowance(s, e)).toBe(4);
    [s, e] = eagleAt(s, { x: 20, y: 6 }, 1);
    s = run(s, { type: 'walkInstead', id: e.id });
    expect(flying(s, s.models[e.id])).toBe(false);
    expect(moveAllowance(s, s.models[e.id])).toBe(4);
  });
});

describe('And Into the Fire: rescuing the Dwarves', () => {
  it('an Eagle touching a Dwarf Marker picks it up as the Good move ends, and rescues it off any edge', () => {
    let s = goodMove(begun());
    const mk = dwarfMarkers(s)[0];
    let e: Model;
    [s, e] = eagleAt(s, { x: 24, y: 10 });
    const spot = landingBeside(s, e, mk)!;
    s = put(s, e, spot);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.terrain[mk.id].carrier).toBe(e.id);
    expect(stillToCarry(s).some(l => l.id === mk.id)).toBe(false);
    // Carrying, it can't make Brutal Power Attacks, and may leave by any edge.
    const now = s.models[e.id];
    expect(brutalOptions(s, catalog, now)).toEqual([]);
    expect(exitEdges(s, now).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    s = put(s, now, { y: r(now) });
    s = run(s, { type: 'escape', model: e.id });
    expect(s.terrain[mk.id].gone).toBe('rescued');
    expect(s.narrative!.flown?.[e.id]).toBe(s.turn);
  });

  it('Thorin is picked up before a marker, and an Eagle in a fight picks up nothing', () => {
    let s = goodMove(begun());
    const thorin = castModel(s, 'thorin')!;
    let e: Model;
    [s, e] = eagleAt(s, { x: 24, y: 10 });
    s = put(s, e, landingBeside(s, e, thorin)!);
    // (With a marker touching it too.)
    const mk = dwarfMarkers(s)[0];
    s = { ...s, terrain: { ...s.terrain, [mk.id]: { ...mk, x: s.models[e.id].x + r(e) + mk.w / 2, y: s.models[e.id].y } } };
    const after = run(s, { type: 'endActivation', seat: 'p1' });
    expect(after.models[thorin.id].aboard).toBe(e.id);
    expect(after.terrain[mk.id].carrier).toBeUndefined();
    // Engaged: nothing.
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    const ee = s.models[e.id];
    const fight = put(s, rider, { x: ee.x - r(ee) - r(rider), y: ee.y });
    const none = run(fight, { type: 'endActivation', seat: 'p1' });
    expect(none.models[thorin.id].aboard).toBeUndefined();
  });

  it('an Eagle slain carrying loses its load: the Evil side wins there and then', () => {
    let s = goodMove(begun());
    let e: Model;
    [s, e] = eagleAt(s, { x: 24, y: 10 });
    const mk = dwarfMarkers(s)[0];
    s = { ...s, terrain: { ...s.terrain, [mk.id]: { ...mk, carrier: e.id } } };
    s = run(s, { type: 'updateModel', id: e.id, patch: { dead: true, wounds: 0 } });
    expect(s.terrain[mk.id].gone).toBe('destroyed');
    expect(fireWinner(s)).toBe('p2');
    expect(narrativeWinner(s)).toBe('p2');
  });

  it('the Good side wins once all five markers and Thorin are carried off (Bilbo with them, if he never came on)', () => {
    const s = begun();
    const thorin = castModel(s, 'thorin')!;
    const done: GameState = { ...s, terrain: Object.fromEntries(Object.entries(s.terrain).map(([k, t]) => [k, t.object === 'dwarf' ? { ...t, gone: 'rescued' as const } : t])) };
    expect(fireWinner(done)).toBeNull();
    const out = put(done, thorin, { escaped: true });
    expect(fireWinner(out)).toBe('p1');
    // Bilbo on the table must be carried off too.
    const bilbo = castModel(out, 'bilbo')!;
    expect(fireWinner(put(out, bilbo, { waiting: undefined, x: 20, y: 20 }))).toBeNull();
    expect(fireWinner(put(out, thorin, { escaped: undefined, dead: true }))).toBe('p2');
  });
});

describe('And Into the Fire: the Eagles arrive', () => {
  it('as the Good side ends its second move, from the edge the Good player picks', () => {
    let s = goodMove(begun(), 1);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).toContain('p1');
    s = goodMove(s, 2);
    s = run(s, { type: 'setPick', seat: 'p1', key: 'edge', value: 'south' });
    expect(eaglesEdge(s)).toBe('south');
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.reinforce).toBe('p1');
    expect(eaglesDue(s)).toBe(true);
    const acts = eaglesArrive(s, uid, 5);
    const enter = acts.find(a => a.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(enter.ids).toHaveLength(5);
    expect(enter.from).toEqual([BOARD / 2, BOARD]);
  });

  it('a Great Eagle that carried a load off, or fell, comes back the next turn; Gwaihir does not', () => {
    let s = goodMove(begun(), 3);
    const [a, b] = eagles(s);
    const gwaihir = castModel(s, 'gwaihir')!;
    s = put(s, a, { waiting: undefined, escaped: true });
    s = put(s, b, { waiting: undefined, dead: true, wounds: 0 });
    s = put(s, gwaihir, { waiting: undefined, dead: true, wounds: 0 });
    for (const e of eagles(s).slice(2)) s = put(s, e, { waiting: undefined, x: 10 + e.x, y: 10 });
    s = { ...s, narrative: { ...s.narrative!, flown: { [a.id]: 3, [b.id]: 3 } } };
    expect(eaglesComing(s)).toHaveLength(0);
    s = goodMove(s, 4);
    expect(eaglesComing(s).map(m => m.id).sort()).toEqual([a.id, b.id].sort());
    const acts = eaglesArrive(s, uid, 5);
    s = run(s, ...acts.filter(x => x.type !== 'entering'));
    expect(s.models[a.id].escaped).toBeFalsy();
    expect(s.models[a.id].waiting).toBe(true);
    expect(s.models[b.id].dead).toBeFalsy();
    expect(s.models[b.id]).toMatchObject({ waiting: true, wounds: s.models[b.id].maxWounds });
    expect(s.models[gwaihir.id].dead).toBe(true);
  });
});

describe("And Into the Fire: Thorin's Wrath and Bilbo", () => {
  it('Thorin charges Azog when he can reach him, before the rest of the Good side is done', () => {
    let s = goodMove(begun(), 1, false);
    expect(wrathDue(s)).toBe(true);
    expect(run(s, { type: 'endActivation', seat: 'p1' })).toBe(s);
    // (Out on the open ground, where nothing slows him.)
    s = put(s, castModel(s, 'thorin')!, { x: 24, y: 20 });
    const thorin = castModel(s, 'thorin')!;
    const azog = castModel(s, 'azog')!;
    s = put(s, azog, { x: thorin.x - 5, y: thorin.y });
    // A rider nearer still: Azog comes first.
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    s = put(s, rider, { x: thorin.x - 1.5 - r(rider) - r(thorin), y: thorin.y + 3 });
    s = run(s, ...wrathMove(s, uid, 5));
    expect(distanceBetween(s.models[thorin.id], s.models[azog.id])).toBeLessThan(0.06);
    expect(wrathDue(s)).toBe(false);
  });

  it('with nobody in reach, he goes as close to Azog as he can', () => {
    let s = goodMove(begun(), 1, false);
    const thorin = castModel(s, 'thorin')!;
    const azog = castModel(s, 'azog')!;
    const before = distanceBetween(thorin, azog);
    s = run(s, ...wrathMove(s, uid, 5));
    // (Out of the trees first: the wood is difficult ground.)
    expect(distanceBetween(s.models[thorin.id], azog)).toBeLessThan(before - 2);
    expect(s.models[thorin.id].x).toBeLessThan(thorin.x);
  });

  it('as a Fight phase begins, Bilbo may be put beside an enemy fighting Thorin', () => {
    let s = begun();
    const thorin = castModel(s, 'thorin')!;
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    s = put(s, rider, { x: thorin.x - r(rider) - r(thorin), y: thorin.y });
    s = { ...s, phase: 'fight', flow: { ...s.flow, resolved: [], duels: [] } };
    expect(bilboTargets(s).map(m => m.id)).toEqual([rider.id]);
    expect(run(s, { type: 'bilboJoins', seat: 'p2', target: rider.id })).toBe(s);
    s = run(s, { type: 'bilboJoins', seat: 'p1', target: rider.id });
    const bilbo = castModel(s, 'bilbo')!;
    expect(bilbo.waiting).toBeFalsy();
    expect(distanceBetween(bilbo, s.models[rider.id])).toBeLessThan(0.05);
    expect(stillToCarry(s).some(l => l.id === bilbo.id)).toBe(true);
  });
});

describe('And Into the Fire: wargear', () => {
  it('Orcrist: Thorin\'s strikes on an Orc do D3 Wounds each; not on a Warg', () => {
    const s = begun();
    const thorin = castModel(s, 'thorin')!;
    const f = fighterOf(s, catalog, thorin);
    const orc = fighterOf(s, catalog, castModel(s, 'fimbul')!);
    const warg = fighterOf(s, catalog, Object.values(s.models).find(m => m.cast === 'warg')!);
    expect(strikeAgainst(catalog, s, f, orc).bane).toBe(true);
    expect(strikeAgainst(catalog, s, f, warg).bane).toBeUndefined();
    const roll = { id: 'x', by: 'p1', label: 'strikes', dice: [6, 2, 5], target: 5, against: 'm', d3: [3, 1, 2], at: 1 } as DiceRoll;
    expect(strikeWounds([roll])).toBe(5);
  });

  it("Azog's I am the Master: against a hero, any 3+ to wound", () => {
    const s = begun();
    const azog = fighterOf(s, catalog, castModel(s, 'azog')!);
    const thorin = fighterOf(s, catalog, castModel(s, 'thorin')!);
    const rider = fighterOf(s, catalog, Object.values(s.models).find(m => m.cast === 'rider')!);
    expect(strikeAgainst(catalog, s, azog, thorin).cap).toBe(3);
    expect(strikeAgainst(catalog, s, azog, rider).cap).toBeUndefined();
  });
});

describe("And Into the Fire: the Hunters' rules", () => {
  it("Azog's Stone flail, two-handed: Fight 6, 2 wounds a strike, and those it strikes are knocked down", () => {
    const s = begun();
    const azog = castModel(s, 'azog')!;
    expect(fighterOf(s, catalog, azog).flail).toBeFalsy();
    const two = fighterOf(s, catalog, azog, { twoHanded: true });
    expect(two).toMatchObject({ f: 6, mighty: true, flail: true });
  });

  it('Savage Hunters: +1 Attack in a turn they charged', () => {
    const s = begun();
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    const a = fighterOf(s, catalog, rider).a;
    const charged = { ...s, flow: { ...s.flow, charges: { [rider.id]: true } } } as unknown as GameState;
    expect(fighterOf(charged, catalog, rider).a).toBe(a + 1);
  });

  it("Orcrist gives Thorin Terror over the Orcs, not the Wargs; Azog's Stand Fast! reaches 12\"", () => {
    const s = begun();
    const thorin = castModel(s, 'thorin')!;
    const rider = hunters(s).find(m => m.cast === 'rider')!;
    expect(terrifies(catalog, thorin, rider, s)).toBe(true);
    expect(terrifies(catalog, thorin, Object.values(s.models).find(m => m.cast === 'warg')!, s)).toBe(false);
    expect(standFastRange(catalog, castModel(s, 'azog')!)).toBe(12);
    expect(standFastRange(catalog, castModel(s, 'fimbul')!)).toBe(6);
  });
});

describe('And Into the Fire: the computer', () => {
  it('nominates trees, then plays both sides through to a result with nothing refused', () => {
    const refused: string[] = [];
    const watch = (st: GameState, seat: Seat, a: Action, ok: boolean) => void (ok || refused.push(`${st.turn}:${seat}:${a.type}`));
    const pre = play(placed(), seeded(2), 2000, st => st.flow.deploy?.step === 'done', watch).state;
    expect(pre.narrative!.hiding).toHaveLength(HIDING_TREES);
    const { state } = play(run(pre, { type: 'startGame', at: 1 }), seeded(2), 40000, st => !!st.result || st.turn > 25, watch);
    expect(refused).toEqual([]);
    expect(state.result?.winner).toBeDefined();
    // A saved game comes back as it was: the hiding trees, who has flown, who rides an Eagle, the markers carried.
    const back = loadState(JSON.parse(JSON.stringify(state)));
    expect(back.narrative).toEqual(state.narrative);
    expect(back.models).toEqual(state.models);
    expect(back.terrain).toEqual(state.terrain);
    expect(back.flow).toEqual(state.flow);
    // The Eagles came on and carried some of them off.
    expect(dwarfMarkers(state).some(t => t.gone === 'rescued')).toBe(true);
  }, 600000);
});
