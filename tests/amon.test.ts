import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeById, whollyInArea } from '../src/shared/narrative.ts';
import { amonWinner, captured, knockedOut, koMarker, legionsArrive, legionsDue, wakeDue, wakeUp } from '../src/shared/amon.ts';
import { BOATS, SEAT } from '../src/shared/amonMap.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { laden } from '../src/shared/fortress.ts';
import { canEscape, canPickUp, markerActions } from '../src/shared/objects.ts';
import { standingAt } from '../src/shared/sight.ts';
import { crossingAhead } from '../src/shared/terrainTests.ts';
import { cloaked } from '../src/shared/wargear.ts';
import { gameWinner } from '../src/shared/status.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';
import { markModel } from '../src/shared/marking.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const who = (s: GameState, key: string) => castModel(s, key)!;
const all = (s: GameState, key: string) => Object.values(s.models).filter(m => m.cast === key);
const r = (m: Model) => Math.max(m.base.w, m.base.h) / 50.8;
const put = (s: GameState, m: Model, x: number, y: number): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], x, y } } });

/** Amon Hen set up as the server would, with the Fellowship on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'amon-hen', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** The battle started, turn `turn`'s Move phase begun with the Fellowship (p1) to move first. */
function hen(turn = 1): GameState {
  let s = run(setup(), { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

/** A Hobbit brought down: his last Wound, as a fight or a shot would take it. */
const fell = (s: GameState, key: string) => run(s, { type: 'affect', id: who(s, key).id, patch: { dead: true, wounds: 0 } });

describe('Amon Hen: setting up', () => {
  it('sets out the book’s table and cast, every one of the Fellowship in an Elven cloak', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const good = Object.values(s.models).filter(m => m.owner === 'p1');
    expect(good.map(m => m.cast).sort()).toEqual(['aragorn', 'boromir', 'frodo', 'gimli', 'legolas', 'merry', 'pippin', 'sam']);
    for (const m of good) expect(cloaked(catalog, m)).toBe(true);
    expect(who(s, 'frodo').options).toEqual(expect.arrayContaining(['Sting', 'Mithril Coat']));
    expect(who(s, 'aragorn').options).toContain('Bow');
    expect(who(s, 'lurtz').name).toBe('Lurtz');
    expect(all(s, 'scout-captain')).toHaveLength(1);
    expect(all(s, 'scout').map(m => m.options?.[0] ?? '-').sort()).toEqual([...Array(8).fill('-'), ...Array(8).fill('Shield'), ...Array(8).fill('Uruk-hai bow')]);
    // The river down the west edge, the boats at its bank, the Seeing Seat in the east.
    const t = Object.values(s.terrain);
    expect(t.find(p => p.kind === 'water')?.x).toBeLessThan(5);
    expect(t.find(p => p.object === 'boat')).toMatchObject({ x: BOATS.x, y: BOATS.y });
    expect(t.find(p => p.id === 'n-seeing-seat')?.x).toBeGreaterThan(24);
  });

  it('starts everyone where the book says, and keeps them there while being set up', () => {
    const s = setup();
    const models = Object.values(s.models);
    for (const m of models) {
      expect(holdNarrative(s, { id: m.id, x: m.x, y: m.y })).toMatchObject({ x: m.x, y: m.y });
      for (const o of models) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThan(r(o) + r(m) - 0.02);
    }
    // Frodo and Aragorn touching the Seeing Seat.
    for (const k of ['frodo', 'aragorn']) expect(who(s, k).x + r(who(s, k))).toBeCloseTo(SEAT.x0, 1);
    // Legolas and Gimli in the north-east corner; Merry, Pippin and Boromir together off the middle of the river bank.
    for (const k of ['legolas', 'gimli']) expect(whollyInArea({ circle: [48, 0, 6] }, who(s, k), r(who(s, k)))).toBe(true);
    const trio = ['merry', 'pippin', 'boromir'].map(k => who(s, k));
    for (const m of trio) {
      expect(whollyInArea({ ring: [0, 24, 6, 12] }, m, r(m))).toBe(true);
      for (const o of trio) if (o.id !== m.id) expect(distanceBetween(m, o)).toBeLessThanOrEqual(1);
    }
    // The Captain and twelve Scouts round the Seeing Seat; Lurtz and twelve between 6" and 12" of Boromir; none of
    // them within 1" of the Fellowship.
    const boromir = who(s, 'boromir');
    const good = models.filter(m => m.owner === 'p1');
    const near = models.filter(m => m.owner === 'p2' && m.x > 24);
    const far = models.filter(m => m.owner === 'p2' && m.x < 24);
    expect(near).toHaveLength(13);
    expect(far).toHaveLength(13);
    expect(far.map(m => m.cast)).toContain('lurtz');
    for (const m of near) expect(whollyInArea({ piece: 'seeing-seat', within: 6 }, m, r(m), s)).toBe(true);
    for (const m of far) {
      expect(distanceBetween(m, boromir)).toBeGreaterThanOrEqual(6);
      expect(distanceBetween(m, boromir) + 2 * r(m)).toBeLessThanOrEqual(12.01);
    }
    for (const e of [...near, ...far]) for (const g of good) expect(distanceBetween(e, g)).toBeGreaterThanOrEqual(1);
    // Sam on his own, 12" from the rest.
    for (const g of good) if (g.cast !== 'sam') expect(distanceBetween(who(s, 'sam'), g)).toBeGreaterThanOrEqual(12);
  });

  it('refuses the moves the set-up rules out', () => {
    const s = setup();
    const sam = who(s, 'sam');
    const merry = who(s, 'merry');
    const frodo = who(s, 'frodo');
    // Sam can't be put near the others, nor Merry away from Pippin and Boromir.
    expect(holdNarrative(s, { id: sam.id, x: frodo.x - 6, y: frodo.y })).toMatchObject({ x: sam.x, y: sam.y });
    expect(holdNarrative(s, { id: sam.id, x: 20, y: 10 })).toMatchObject({ x: 20, y: 10 });
    expect(holdNarrative(s, { id: merry.id, x: 13, y: 20 })).toMatchObject({ x: merry.x, y: merry.y });
    // Frodo goes round the Seeing Seat's edge, still touching it.
    const slid = holdNarrative(s, { id: frodo.id, x: 37.2, y: 20 });
    expect(slid.y + r(frodo)).toBeCloseTo(SEAT.y0, 1);
    // Lurtz's Scouts stay between 6" and 12" of Boromir.
    const lurtz = who(s, 'lurtz');
    expect(holdNarrative(s, { id: lurtz.id, x: 30, y: 24 })).toMatchObject({ x: lurtz.x, y: lurtz.y });
  });
});

describe('Amon Hen: the Seeing Seat', () => {
  it('stands models up on its platform and dais, with steps between them', () => {
    const s = hen(2);
    const a = who(s, 'aragorn');
    const on = (x: number, y: number) => {
      const m = { ...a, x, y };
      return standingAt({ ...s, models: { ...s.models, [a.id]: m } }, m);
    };
    expect(on(37.3, 23.5)).toBeCloseTo(0.5, 2);
    expect(on(41.4, 23.4)).toBeCloseTo(1, 2);
    // A man steps up onto the platform and on up to the dais without a test, and down again.
    expect(crossingAhead(s, a, { x: 35, y: 23.5 }, { x: 37.4, y: 23.5 })).toBeNull();
    expect(crossingAhead(s, a, { x: 41.4, y: 21.4 }, { x: 41.4, y: 23.4 })).toBeNull();
    expect(crossingAhead(s, a, { x: 41.4, y: 23.4 }, { x: 41.4, y: 21.4 })).toBeNull();
  });
});

describe('Amon Hen: "Find the Halflings!"', () => {
  it('knocks a Hobbit out instead of slaying him: he lies as a marker, on 1 Wound', () => {
    const s0 = hen(2);
    const pippin = who(s0, 'pippin');
    const s = fell(s0, 'pippin');
    const p = s.models[pippin.id];
    expect(p.dead).toBe(false);
    expect(p.waiting).toBe(true);
    expect(p.wounds).toBe(1);
    expect(knockedOut(s, p)).toBe(true);
    expect(koMarker(s, p)).toMatchObject({ x: pippin.x, y: pippin.y, object: 'hobbit' });
    // Boromir is no Hobbit: he is slain.
    expect(fell(s0, 'boromir').models[who(s0, 'boromir').id].dead).toBe(true);
  });

  it('lets the Uruk-hai carry him off as a Heavy Object, by the north, south or east edge but not into the river', () => {
    let s = fell(hen(2), 'pippin');
    const t = koMarker(s, who(s, 'pippin'))!;
    const scout = all(s, 'scout')[0];
    const boromir = who(s, 'boromir');
    s = put(put(s, scout, t.x + 0.9, t.y), boromir, t.x - 0.9, t.y);
    expect(canPickUp(s, s.models[boromir.id], t)).toBe(false);
    expect(canPickUp(s, s.models[scout.id], t)).toBe(true);
    s = run(s, { type: 'pickUp', model: scout.id, marker: t.id });
    expect(laden(s, s.models[scout.id])).toBe(true);
    // Not into the Anduin.
    s = put(s, scout, 0.5, 14);
    expect(canEscape(s, s.models[scout.id])).toBe(false);
    // Off the north edge, Pippin is taken.
    s = put(s, scout, 20, 0.5);
    expect(markerActions(s, s.models[scout.id]).find(a => a.kind === 'escape')?.label).toBe('Carry him off the table');
    s = run(s, { type: 'escape', model: scout.id });
    expect(captured(s, who(s, 'pippin'))).toBe(true);
    // A Scout carrying nothing can't leave.
    const other = all(s, 'scout')[1];
    expect(canEscape(put(s, other, 20, 0.5), { ...other, x: 20, y: 0.5 })).toBe(false);
  });

  it('brings him round, Prone, when a friend ends the Fellowship’s move touching him', () => {
    let s = fell(hen(2), 'merry');
    const t = koMarker(s, who(s, 'merry'))!;
    s = run(s, { type: 'endActivation', seat: 'p1' });
    // (Boromir and Pippin were already beside him.)
    const merry = who(s, 'merry');
    expect(merry.waiting).toBeUndefined();
    expect(merry.prone).toBe(true);
    expect(knockedOut(s, merry)).toBe(false);
    expect(Math.hypot(merry.x - t.x, merry.y - t.y)).toBeLessThan(0.01);
  });

  it('otherwise he comes round on a 6 in the End phase', () => {
    let s = fell(hen(2), 'sam');
    s = { ...s, phase: 'end' };
    expect(wakeDue(s)).toBe(true);
    const out = run(s, ...wakeUp(s, () => 5, uid, 1));
    expect(knockedOut(out, who(out, 'sam'))).toBe(true);
    expect(wakeDue(out)).toBe(false);
    const up = run(s, ...wakeUp(s, () => 6, uid, 1));
    expect(who(up, 'sam').waiting).toBeUndefined();
    expect(who(up, 'sam').prone).toBe(true);
  });
});

describe('Amon Hen: the Legions of Isengard', () => {
  it('rolls for each slain Scout as the Uruk-hai end their move: a 4+ brings it back on from the nearest edge but the river', () => {
    let s = hen(2);
    const models = { ...s.models };
    all(s, 'scout').slice(0, 4).forEach(m => (models[m.id] = { ...m, dead: true, wounds: 0 }));
    models[who(s, 'lurtz').id] = { ...who(s, 'lurtz'), dead: true, wounds: 0 };
    s = run({ ...s, models }, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' });
    expect(s.flow.done).not.toContain('p2');
    expect(legionsDue(s)).toBe(true);
    const dice = [4, 3, 6, 1];
    let k = 0;
    const out = legionsArrive(s, () => dice[k++], uid, 1);
    const roll = out.find(a => a.type === 'rolled');
    expect(roll && roll.type === 'rolled' && roll.roll.dice).toEqual(dice);
    const entering = out.find(a => a.type === 'entering');
    expect(entering && entering.type === 'entering' && entering.ids).toHaveLength(2);
    // Frodo is at the Seeing Seat, nearest the east edge.
    expect(entering && entering.type === 'entering' && entering.from).toEqual([48, who(s, 'frodo').y]);
    s = run(s, ...out);
    const back = all(s, 'scout').filter(m => !m.dead && !m.waiting && s.flow.entering?.ids.includes(m.id));
    expect(back).toHaveLength(1);
    expect(back[0].x + r(back[0])).toBeCloseTo(48, 1);
    // Lurtz is no Warrior: he stays dead.
    expect(who(s, 'lurtz').dead).toBe(true);
    expect(legionsDue(s)).toBe(false);
  });
});

describe('Amon Hen: who wins', () => {
  it('the Fellowship when Frodo gets away in the boats', () => {
    let s = hen(3);
    const frodo = who(s, 'frodo');
    s = put(s, frodo, BOATS.x + BOATS.w / 2 + 0.6, BOATS.y);
    expect(markerActions(s, s.models[frodo.id]).find(a => a.kind === 'escape')?.label).toBe('Get into a boat and away');
    s = run(s, { type: 'escape', model: frodo.id });
    expect(amonWinner(s)).toBe('p1');
    expect(gameWinner(s)).toBe('p1');
  });

  it('a draw if he gets away but two of the other Hobbits have been carried off', () => {
    let s = hen(3);
    for (const k of ['sam', 'merry']) {
      s = fell(s, k);
      const t = koMarker(s, who(s, k))!;
      s = { ...s, terrain: { ...s.terrain, [t.id]: { ...t, gone: 'off', by: 'p2' } } };
    }
    expect(amonWinner(s)).toBeNull();
    const frodo = who(s, 'frodo');
    s = run(put(s, frodo, BOATS.x + BOATS.w / 2 + 0.6, BOATS.y), { type: 'escape', model: frodo.id });
    expect(amonWinner(s)).toBe('draw');
  });

  it('the Uruk-hai if they carry Frodo off', () => {
    let s = fell(hen(3), 'frodo');
    expect(amonWinner(s)).toBeNull();
    const t = koMarker(s, who(s, 'frodo'))!;
    s = { ...s, terrain: { ...s.terrain, [t.id]: { ...t, gone: 'off', by: 'p2' } } };
    expect(amonWinner(s)).toBe('p2');
  });
});

describe('Amon Hen: the computer', () => {
  it('plays both sides with nothing refused: the Uruk-hai knock Hobbits out and carry them off', () => {
    const s = run(setup(), { type: 'startGame', at: 1 });
    const refused: string[] = [];
    // (A whole game can run to thirty turns and more; eight show both sides at work.)
    const { state } = play(s, seeded(2), 20000, st => st.turn > 8, (_, seat, a, ok) => void (ok || refused.push(`${seat}:${a.type}`)));
    expect(refused).toEqual([]);
    expect(Object.values(state.terrain).filter(t => t.object === 'hobbit').length).toBeGreaterThan(0);
    expect(narrativeById('amon-hen')).toBeDefined();
  }, 600000);
});
