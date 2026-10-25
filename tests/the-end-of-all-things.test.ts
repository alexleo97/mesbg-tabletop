import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { cantWear } from '../src/shared/ring.ts';
import { inChasm } from '../src/shared/sight.ts';
import { fitsTarget } from '../src/shared/powers.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { atPrecipice, carryingFrodo, doomWinner, exhausted, fromMiddle, gollumHides, hideGollum, hordeArrives, ringPowerDue, setDownDue, slainOrcs, willsDue } from '../src/shared/doom.ts';
import { BOARD_H, BOARD_W, DOOM, EVIL_GAP, GATE, GATEWAY, GOOD_REACH, MIDDLE, STAND_REACH, WALKWAY } from '../src/shared/doomMap.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const good = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p1');
const evil = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p2');
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const d = [...dice];
  return resolveRequest(s, seat, a, () => d.shift() ?? 3, uid, 1, catalog);
};
const apply = (s: GameState, seat: Seat, a: Action, dice: number[]) => run(s, ...ask(s, seat, a, dice)!.apply);

/** The End of All Things set up as the server would, with the Good side on `side`. */
function setup(side: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'the-end-of-all-things', good: side } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Both sides set up, the battle started. */
const begun = (): GameState => run(setup(), { type: 'warbandDone', seat: 'p1' }, { type: 'warbandDone', seat: 'p2' }, { type: 'startGame', at: 1 });

/** The Move phase of `turn`, `seat` having Priority (the Power of the Ring passed up). */
const moveFor = (s: GameState, turn = 1, seat: Seat = 'p1'): GameState => {
  const out = run({ ...s, turn: 1, phase: 'priority', flow: { ...s.flow, done: [] }, narrative: { ...s.narrative!, power: 1 } }, { type: 'choosePriority', seat }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  return { ...out, turn, narrative: { ...out.narrative!, power: turn } };
};

describe('The End of All Things: the tables and the cast', () => {
  it("two tables side by side: a 2' by 2' Crack of Doom and a 4' by 4' Black Gate, with a gap nothing crosses", () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: BOARD_W, h: BOARD_H });
    expect(GATE.x - (DOOM.x + DOOM.size)).toBeGreaterThanOrEqual(13);
    // Nothing stands in the gap, nor round the Crack of Doom's table, nor in the fire.
    expect(inChasm(s, { x: 30, y: 24 })).toBe(true);
    expect(inChasm(s, { x: 12, y: 5 })).toBe(true);
    expect(inChasm(s, { x: 12, y: 42 })).toBe(true);
    expect(inChasm(s, { x: DOOM.x + 20, y: DOOM.y + 4 })).toBe(true);
    // But the slope, the walkway and the plain all hold.
    expect(inChasm(s, { x: DOOM.x + 4, y: DOOM.y + 20 })).toBe(false);
    expect(inChasm(s, { x: (WALKWAY.from[0] + WALKWAY.to[0]) / 2, y: (WALKWAY.from[1] + WALKWAY.to[1]) / 2 })).toBe(false);
    expect(inChasm(s, { x: WALKWAY.to[0] * 0.97 + WALKWAY.from[0] * 0.03, y: WALKWAY.to[1] * 0.97 + WALKWAY.from[1] * 0.03 })).toBe(false);
    expect(inChasm(s, MIDDLE)).toBe(false);
    const t = Object.values(s.terrain);
    expect(t.filter(x => x.look === 'blackgate').length).toBe(4);
    expect(t.filter(x => x.look === 'blackgate').every(x => x.sheer)).toBe(true);
  });

  it("there is a way for a 25mm base from Frodo's corner up the slope and out along the walkway to the precipice", () => {
    const s = setup();
    const r = 0.49;
    const step = 0.25;
    const ok = (x: number, y: number) => x - r >= DOOM.x && x + r <= DOOM.x + DOOM.size && y - r >= DOOM.y && y + r <= DOOM.y + DOOM.size && [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => !inChasm(s, { x: x + dx, y: y + dy }));
    const key = (i: number, j: number) => `${i},${j}`;
    const start = castModel(s, 'frodo')!;
    const toIdx = (v: number) => Math.round(v / step);
    const seen = new Set([key(toIdx(start.x), toIdx(start.y))]);
    const queue: [number, number][] = [[toIdx(start.x), toIdx(start.y)]];
    while (queue.length) {
      const [i, j] = queue.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(i + di, j + dj);
        if (seen.has(k) || !ok((i + di) * step, (j + dj) * step)) continue;
        seen.add(k);
        queue.push([i + di, j + dj]);
      }
    }
    const len = Math.hypot(WALKWAY.to[0] - WALKWAY.from[0], WALKWAY.to[1] - WALKWAY.from[1]);
    const tip = { x: WALKWAY.to[0] - ((WALKWAY.to[0] - WALKWAY.from[0]) / len) * 0.6, y: WALKWAY.to[1] - ((WALKWAY.to[1] - WALKWAY.from[1]) / len) * 0.6 };
    const reached = [...seen].map(k => k.split(',').map(Number)).some(([i, j]) => atPrecipice(s, { ...start, x: i * step, y: j * step }) && Math.hypot(i * step - tip.x, j * step - tip.y) < 1.5);
    expect(reached).toBe(true);
  });

  it('the cast: Frodo, Sam with Sting, seven heroes and 50 Warriors; the Troll Chieftain, the Mouth, Gollum, 3 Captains and 50 Orcs', () => {
    const s = setup();
    expect(good(s).length).toBe(59);
    expect(evil(s).length).toBe(56);
    for (const k of ['frodo', 'sam', 'aragorn', 'gandalf', 'legolas', 'gimli', 'eomer', 'merry', 'pippin', 'mouth', 'troll', 'gollum']) expect(castModel(s, k)).toBeDefined();
    expect(good(s).filter(m => m.cast === 'gondor').length).toBe(25);
    expect(good(s).filter(m => m.cast === 'rohan').length).toBe(25);
    expect(evil(s).filter(m => m.cast === 'orc').length).toBe(50);
    expect(evil(s).filter(m => m.cast === 'captain').length).toBe(3);
    expect(castModel(s, 'sam')!.options).toContain('Sting');
    expect(castModel(s, 'frodo')!.options ?? []).not.toContain('Sting');
    // Greatest of the Trolls: Fearless, and a point more of Might, Will and Fate than the Chieftain's 2, 1 and 1.
    const troll = castModel(s, 'troll')!;
    expect([troll.might, troll.will, troll.fate]).toEqual([3, 2, 2]);
    expect(catalog.units[troll.profileId!].rules).toContain('Fearless');
    expect(troll.name).toBe('Mordor Troll Chieftain');
    // Gandalf's Staff: no Staff of Power.
    expect(castModel(s, 'gandalf')!.lostGear).toContain('Staff of Power');
    expect(castModel(s, 'gollum')!.waiting).toBe(true);
    expect(castModel(s, 'mouth')!.options).toContain('Armoured horse');
  });

  it('Frodo and Sam in the south-west corner of the Crack of Doom; the rest wholly within 6" of the middle; the Evil side 6" clear', () => {
    const s = setup();
    const frodo = castModel(s, 'frodo')!;
    const sam = castModel(s, 'sam')!;
    expect(frodo.x).toBeCloseTo(DOOM.x + 0.49, 1);
    expect(frodo.y).toBeCloseTo(DOOM.y + DOOM.size - 0.49, 1);
    expect(distanceBetween(frodo, sam)).toBeLessThan(0.1);
    const half = (m: Model) => Math.max(m.base.w, m.base.h) / 25.4 / 2;
    for (const m of good(s).filter(m => m.cast !== 'frodo' && m.cast !== 'sam')) expect(Math.hypot(m.x - MIDDLE.x, m.y - MIDDLE.y) + half(m)).toBeLessThanOrEqual(GOOD_REACH + 0.01);
    const onTable = evil(s).filter(m => !m.waiting);
    for (const e of onTable) {
      expect(e.x - half(e)).toBeGreaterThanOrEqual(GATE.x);
      for (const g of good(s)) expect(distanceBetween(e, g)).toBeGreaterThanOrEqual(EVIL_GAP - 0.01);
    }
    // Nobody's base overlaps another's, or a rock, wall or tower.
    const ms = Object.values(s.models).filter(m => !m.waiting);
    for (const a of ms) for (const b of ms) if (a.id < b.id) expect(distanceBetween(a, b)).toBeGreaterThan(0.02);
    // Spread out: the Good side as far apart as its circle allows, the host 2" apart.
    const gaps = (list: Model[]) => list.map(a => Math.min(...list.filter(b => b !== a).map(b => distanceBetween(a, b))));
    expect(Math.min(...gaps(good(s).filter(m => m.cast !== 'frodo' && m.cast !== 'sam')))).toBeGreaterThan(0.2);
    expect(Math.min(...gaps(onTable.filter(m => m.cast === 'orc')))).toBeGreaterThan(0.9);
  });
});

describe('The End of All Things: who wins', () => {
  it('the Ring destroyed is a Good win (a draw once every hero at the Gate is slain); Frodo slain or taken over is an Evil win', () => {
    const s = begun();
    expect(doomWinner(s)).toBeNull();
    expect(narrativeWinner({ ...s, narrative: { ...s.narrative!, ring: 'destroyed' } })).toBe('p1');
    expect(doomWinner({ ...s, narrative: { ...s.narrative!, ring: 'corrupted' } })).toBe('p2');
    expect(doomWinner({ ...s, narrative: { ...s.narrative!, resist: 0 } })).toBe('p2');
    expect(doomWinner(put(s, castModel(s, 'frodo')!, { dead: true }))).toBe('p2');
    const heroes = good(s).filter(m => m.hero && m.cast !== 'frodo' && m.cast !== 'sam');
    const fallen = heroes.reduce((x, m) => put(x, m, { dead: true }), s);
    expect(doomWinner({ ...fallen, narrative: { ...fallen.narrative!, ring: 'destroyed' } })).toBe('draw');
  });
});

describe('The End of All Things: the Ring', () => {
  it('"Not here, not so close to the Eye!": Frodo may not put the Ring on', () => {
    const s = moveFor(begun());
    expect(cantWear(s, catalog, castModel(s, 'frodo')!)).toMatch(/Eye/);
  });

  it('the Power of the Ring is tried before Priority is rolled, once a turn, by the Evil player', () => {
    let s = begun();
    expect(s.phase).toBe('priority');
    expect(ringPowerDue(s)).toBe(true);
    expect(ask(s, 'p1', { type: 'rollPriority' }, [3, 4])).toBeNull();
    expect(ask(s, 'p1', { type: 'ringPower', power: 'corruption' }, [6])).toBeNull();
    // Corruption: a 4+, then a D6 equal to or over his 6 Resistant Points.
    s = apply(s, 'p2', { type: 'ringPower', power: 'corruption' }, [4, 6]);
    expect(s.narrative?.resist).toBe(5);
    expect(ringPowerDue(s)).toBe(false);
    expect(ask(s, 'p2', { type: 'ringPower', power: 'corruption' }, [6, 6])).toBeNull();
    expect(ask(s, 'p1', { type: 'rollPriority' }, [3, 4])).not.toBeNull();
    // A failed roll does nothing; a low second die doesn't take a point.
    const t = begun();
    expect(apply(t, 'p2', { type: 'ringPower', power: 'corruption' }, [3, 6]).narrative?.resist).toBeUndefined();
    expect(apply(t, 'p2', { type: 'ringPower', power: 'corruption' }, [4, 5]).narrative?.resist).toBeUndefined();
    // At none, the Ring has him.
    const last = { ...t, narrative: { ...t.narrative!, resist: 1 } };
    expect(narrativeWinner(apply(last, 'p2', { type: 'ringPower', power: 'corruption' }, [5, 1]))).toBe('p2');
  });

  it('Exhaustion: a Courage test for every inch, Prone at the first failure; Sam may carry him at half speed', () => {
    let s = apply(begun(), 'p2', { type: 'ringPower', power: 'exhaustion' }, [3]);
    expect(s.narrative?.exhaust).toBe(1);
    s = { ...moveFor(s), narrative: { ...s.narrative!, exhaust: 1, strides: 0, power: 1 } };
    const frodo = castModel(s, 'frodo')!;
    expect(exhausted(s)).toBe(true);
    expect(moveAllowance(s, s.models[frodo.id])).toBe(0);
    s = apply(s, 'p1', { type: 'stride' }, [6, 6]);
    s = apply(s, 'p1', { type: 'stride' }, [5, 6]);
    expect(moveAllowance(s, s.models[frodo.id])).toBe(2);
    s = apply(s, 'p1', { type: 'stride' }, [1, 1]);
    expect(s.models[frodo.id].prone).toBe(true);
    expect(ask(s, 'p1', { type: 'stride' }, [6, 6])).toBeNull();
    // Sam picks him up: Frodo goes where Sam goes, and Sam's Move is halved.
    const sam = castModel(s, 'sam')!;
    s = run(s, { type: 'carryFrodo', carry: true });
    expect(carryingFrodo(s, s.models[sam.id])).toBe(true);
    expect(moveAllowance(s, s.models[sam.id])).toBe(2);
    s = run(s, { type: 'moveModels', moves: [{ id: sam.id, x: sam.x + 1, y: sam.y - 1 }] });
    expect(s.models[sam.id].x).toBeGreaterThan(sam.x + 0.5);
    expect(s.models[frodo.id].x).toBeCloseTo(s.models[sam.id].x, 3);
    // He is put down as the End phase begins.
    expect(setDownDue({ ...s, phase: 'end' })).toBe(true);
    const down = run({ ...s, phase: 'end' }, { type: 'carryFrodo', carry: false });
    expect(down.models[frodo.id].aboard).toBeUndefined();
    expect(distanceBetween(down.models[frodo.id], down.models[sam.id])).toBeLessThan(0.1);
  });

  it('Lure of the Ring: Gollum leaps out touching Frodo, and slinks off as the End phase begins', () => {
    let s = apply(begun(), 'p2', { type: 'ringPower', power: 'lure' }, [5]);
    const g = castModel(s, 'gollum')!;
    expect(g.waiting).toBeFalsy();
    expect(distanceBetween(g, castModel(s, 'frodo')!)).toBeLessThan(0.1);
    expect(gollumHides({ ...s, phase: 'end' })).toBe(true);
    s = run({ ...s, phase: 'end' }, ...hideGollum({ ...s, phase: 'end' }, uid, 1));
    expect(castModel(s, 'gollum')!.waiting).toBe(true);
    // Once he is slain, the Ring can't lure him again.
    const fresh = begun();
    const t = put(fresh, castModel(fresh, 'gollum')!, { dead: true });
    expect(ask(t, 'p2', { type: 'ringPower', power: 'lure' }, [6])).toBeNull();
  });

  it('the battle of wills at the precipice: three in a row either way, Might turning a lost roll', () => {
    let s = moveFor(begun());
    const frodo = castModel(s, 'frodo')!;
    const tip = { x: WALKWAY.to[0] - 0.55 * Math.cos(Math.atan2(WALKWAY.to[1] - WALKWAY.from[1], WALKWAY.to[0] - WALKWAY.from[0])), y: WALKWAY.to[1] - 0.55 * Math.sin(Math.atan2(WALKWAY.to[1] - WALKWAY.from[1], WALKWAY.to[0] - WALKWAY.from[0])) };
    s = put(s, frodo, tip);
    expect(atPrecipice(s, s.models[frodo.id])).toBe(true);
    expect(atPrecipice(s, { ...s.models[frodo.id], x: (WALKWAY.from[0] + WALKWAY.to[0]) / 2, y: (WALKWAY.from[1] + WALKWAY.to[1]) / 2 })).toBe(false);
    expect(willsDue(s)).toBe(true);
    // Nobody moves until it is over.
    const orc = evil(s).find(m => m.cast === 'orc')!;
    expect(run(s, { type: 'moveModels', moves: [{ id: orc.id, x: orc.x - 1, y: orc.y }] }).models[orc.id].x).toBe(orc.x);
    expect(ask(s, 'p2', { type: 'wills' }, [6, 1])).toBeNull();
    s = apply(s, 'p1', { type: 'wills' }, [6, 1]);
    s = apply(s, 'p1', { type: 'wills' }, [4, 4, 5, 2]);
    expect(s.narrative?.wills).toEqual({ g: 2, e: 0 });
    // Lost by one: he may spend 2 Might to win it.
    s = apply(s, 'p1', { type: 'wills' }, [3, 4]);
    expect(s.narrative?.wills?.open).toEqual([3, 4]);
    expect(ask(s, 'p1', { type: 'wills', might: 1 }, [])).toBeNull();
    s = apply(s, 'p1', { type: 'wills', might: 2 }, []);
    expect(s.models[frodo.id].might).toBe(0);
    expect(s.narrative?.ring).toBe('destroyed');
    expect(narrativeWinner(s)).toBe('p1');
    // Three to the Ring, and it has him.
    const fresh = moveFor(begun());
    let t = put(fresh, castModel(fresh, 'frodo')!, { ...tip, might: 0 });
    for (let i = 0; i < 3; i++) t = apply(t, 'p1', { type: 'wills' }, [1, 6]);
    expect(t.narrative?.ring).toBe('corrupted');
    expect(narrativeWinner(t)).toBe('p2');
  });
});

describe('The End of All Things: the Black Gate', () => {
  it('Teeming Hordes: every slain Orc comes back through the Gate as the Evil move ends', () => {
    let s = moveFor(begun(), 2, 'p2');
    const [a, b] = evil(s).filter(m => m.cast === 'orc');
    const cap = evil(s).find(m => m.cast === 'captain')!;
    s = [a, b, cap].reduce((x, m) => put(x, m, { dead: true }), put(s, castModel(s, 'troll')!, { dead: true }));
    expect(slainOrcs(s, catalog).map(m => m.id).sort()).toEqual([a.id, b.id, cap.id].sort());
    const out = hordeArrives(s, catalog, uid, 1);
    const entering = out.find(x => x.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(entering.ids.sort()).toEqual([a.id, b.id, cap.id].sort());
    expect(entering.from![0]).toBe(BOARD_W);
    expect(entering.span![0]).toBeGreaterThanOrEqual(GATEWAY[0]);
    expect(entering.span![1]).toBeLessThanOrEqual(GATEWAY[1]);
  });

  it('"Stand Your Ground!": the Good side at the Gate goes no more than 12" from the middle of its table', () => {
    const b = begun();
    const w = good(b).find(m => m.cast === 'gondor')!;
    let s = moveFor(put(b, w, { x: MIDDLE.x - 10, y: MIDDLE.y }));
    s = run(s, { type: 'moveModels', moves: [{ id: w.id, x: MIDDLE.x - 15, y: MIDDLE.y }] });
    expect(fromMiddle(s.models[w.id])).toBeLessThanOrEqual(STAND_REACH + 0.01);
    expect(s.models[w.id].x).toBeLessThan(MIDDLE.x - 10);
  });

  it("Gandalf's Staff: he has no Staff of Power, so there is none to break", () => {
    const s = begun();
    const mouth = castModel(s, 'mouth')!;
    expect(fitsTarget(s, catalog, mouth, 'Your Staff is Broken', castModel(s, 'gandalf')!)).toBe(false);
    expect(fitsTarget(s, catalog, mouth, 'Your Staff is Broken', { ...castModel(s, 'gandalf')!, lostGear: [] })).toBe(true);
  });

  it('a saved game keeps the Ring, the battle of wills and Frodo', () => {
    const s = begun();
    const saved = { ...s, narrative: { ...s.narrative!, power: 2, exhaust: 2, collapsed: 2, strides: 3, resist: 4, lured: 1, wills: { g: 1, e: 0, open: [2, 5] as [number, number] }, horde: 2 } };
    expect(loadState(JSON.parse(JSON.stringify(saved))).narrative).toMatchObject({ power: 2, exhaust: 2, collapsed: 2, strides: 3, resist: 4, lured: 1, wills: { g: 1, e: 0, open: [2, 5] }, horde: 2 });
  });
});

describe('The End of All Things: the computer', () => {
  it('plays both sides through to a result with nothing refused', () => {
    const refused: string[] = [];
    const watch = (st: GameState, seat: Seat, a: Action, ok: boolean) => void (ok || refused.push(`${st.turn}:${st.phase}:${seat}:${a.type}`));
    const pre = play(setup(), seeded(3), 2000, st => st.flow.deploy?.step === 'done', watch).state;
    const { state } = play(run(pre, { type: 'startGame', at: 1 }), seeded(3), 80000, st => !!st.result || st.turn > 30, watch);
    expect(refused).toEqual([]);
    expect(state.result?.winner).toBeDefined();
    const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    const back = loadState(json(state));
    expect(json(back.narrative)).toEqual(json(state.narrative));
    // (An empty list of effects isn't saved.)
    const bare = (ms: GameState['models']) => json(Object.fromEntries(Object.entries(ms).map(([id, m]) => [id, m.effects?.length ? m : { ...m, effects: undefined }])));
    expect(json(back.models)).toEqual(bare(state.models));
  }, 900000);
});
