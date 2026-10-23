import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, narrativeById, whollyInArea } from '../src/shared/narrative.ts';
import { ambushWinner, bondsDue, fightsUpright, rollBonds } from '../src/shared/ambush.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { noStrikes } from '../src/shared/powers.ts';
import { canEscape } from '../src/shared/objects.ts';
import { gameWinner } from '../src/shared/status.ts';
import type { Action, GameState, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';
import { markModel } from '../src/shared/marking.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const dice = (list: number[]) => {
  const seq = [...list];
  return () => seq.shift() ?? 1;
};
const who = (s: GameState, key: string) => castModel(s, key)!;
/** Ambush at Night set up as the server would (riders on their horses), with the Riders on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'ambush-at-night', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}
const all = (s: GameState, key: string) => Object.values(s.models).filter(m => m.cast === key);

/** Ambush at Night with the Riders in seat p1, the battle started and turn `turn`'s Move phase begun with `first` to move. */
function ambush(turn = 1, first: Seat = 'p1'): GameState {
  let s = setup();
  s = run(s, { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: first }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

describe('Ambush at Night: setting up', () => {
  it('sets out the book’s table and cast', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const fire = Object.values(s.terrain).find(t => t.object === 'campfire')!;
    expect([fire.x, fire.y]).toEqual([24, 24]);
    // 16 on the Good side, 28 on the Evil.
    expect(Object.values(s.models).filter(m => m.owner === 'p1')).toHaveLength(16);
    expect(Object.values(s.models).filter(m => m.owner === 'p2')).toHaveLength(28);
    expect(all(s, 'rider')).toHaveLength(12);
    expect(all(s, 'rider').filter(m => m.options?.includes('Throwing spears'))).toHaveLength(4);
    expect(all(s, 'scout').map(m => m.options?.[0] ?? '').sort()).toEqual(['', '', '', '', 'Shield', 'Shield', 'Shield', 'Shield', 'Uruk-hai bow', 'Uruk-hai bow', 'Uruk-hai bow', 'Uruk-hai bow']);
    expect(all(s, 'orc').map(m => m.options?.[0]).sort()).toEqual(['Orc bow', 'Orc bow', 'Shield', 'Shield', 'Shield', 'Shield', 'Spear', 'Spear', 'Spear', 'Spear', 'Two-handed weapon', 'Two-handed weapon']);
    expect(who(s, 'eomer').options).toEqual(['Firefoot']);
    expect(who(s, 'captain-rohan').options?.sort()).toEqual(['Horse', 'Shield']);
  });

  it('lies Merry and Pippin bound by the fire, Grishnákh 3" south of them, the camp within 6" of the middle and the riders at the flanks', () => {
    const s = setup();
    const [merry, pippin, grish] = [who(s, 'merry'), who(s, 'pippin'), who(s, 'grishnakh')];
    for (const h of [merry, pippin]) expect(h).toMatchObject({ prone: true, bound: true, crawls: 1, slips: true });
    expect(grish).toMatchObject({ prone: true, crawls: 3, slips: true, might: 1, will: 1, fate: 1, stats: { A: 1 } });
    expect(grish.bound).toBeUndefined();
    expect(distanceBetween(merry, grish)).toBeGreaterThan(2.9);
    expect(Math.min(distanceBetween(merry, grish), distanceBetween(pippin, grish))).toBeCloseTo(3, 0);
    expect(grish.y).toBeGreaterThan(merry.y);
    const r = (m: { base: { w: number } }) => m.base.w / 50.8;
    for (const m of Object.values(s.models).filter(m => m.owner === 'p2' && m.cast !== 'grishnakh')) {
      expect(whollyInArea({ circle: [24, 24, 6] }, m, r(m))).toBe(true);
      // Nobody set up touching the Hobbits.
      expect(Math.min(distanceBetween(m, merry), distanceBetween(m, pippin))).toBeGreaterThan(0.2);
    }
    const west = [who(s, 'eomer'), ...all(s, 'rider').filter(m => m.x < 24)];
    const east = [who(s, 'captain-rohan'), ...all(s, 'rider').filter(m => m.x > 24)];
    expect(west).toHaveLength(7);
    expect(east).toHaveLength(7);
    for (const m of west) expect(m.x + Math.max(m.base.w, m.base.h) / 50.8).toBeLessThanOrEqual(6.01);
    for (const m of east) expect(m.x - Math.max(m.base.w, m.base.h) / 50.8).toBeGreaterThanOrEqual(41.99);
  });

  it('keeps the camp within 6" of the middle and off the Hobbits while it is set up', () => {
    let s = setup();
    const orc = all(s, 'orc')[0];
    const out = run(s, { type: 'moveModels', moves: [{ id: orc.id, x: 10, y: 10 }] });
    expect([out.models[orc.id].x, out.models[orc.id].y]).toEqual([orc.x, orc.y]);
    const merry = who(s, 'merry');
    s = run(s, { type: 'moveModels', moves: [{ id: orc.id, x: merry.x - 1, y: merry.y + 0.2 }] });
    expect([s.models[orc.id].x, s.models[orc.id].y]).toEqual([orc.x, orc.y]);
    // The riders keep to their own edge.
    const rider = all(s, 'rider').find(m => m.x < 24)!;
    expect(run(s, { type: 'moveModels', moves: [{ id: rider.id, x: 20, y: 20 }] }).models[rider.id].x).toBe(rider.x);
  });
});

describe('Ambush at Night: the rules', () => {
  it('Surprise Attack: the Evil side can’t move in turn 1, but can in turn 2', () => {
    const s = ambush(1, 'p2');
    const ugluk = who(s, 'ugluk');
    expect(moveAllowance(s, ugluk)).toBe(0);
    const t2 = ambush(2, 'p2');
    expect(moveAllowance(t2, who(t2, 'ugluk'))).toBe(6);
  });

  it('a bound Hobbit only crawls 1", and Grishnákh 3", neither standing up', () => {
    let s = ambush(2, 'p1');
    const merry = who(s, 'merry');
    expect(moveAllowance(s, merry)).toBe(1);
    s = run(s, { type: 'moveModels', moves: [{ id: merry.id, x: merry.x - 3, y: merry.y }] });
    expect(merry.x - s.models[merry.id].x).toBeLessThanOrEqual(1.01);
    expect(s.models[merry.id].prone).toBe(true);
    let e = ambush(2, 'p2');
    const g = who(e, 'grishnakh');
    expect(moveAllowance(e, g)).toBe(3);
    e = run(e, { type: 'moveModels', moves: [{ id: g.id, x: g.x + 5, y: g.y }] });
    expect(e.models[g.id].x - g.x).toBeLessThanOrEqual(3.01);
    expect(e.models[g.id].prone).toBe(true);
  });

  it('nobody but Grishnákh may charge the Hobbits, though they walk over them', () => {
    let s = ambush(2, 'p2');
    const merry = who(s, 'merry');
    // Clear the camp from round the Hobbits, then march an Uruk straight at Merry and past him.
    const uruk = all(s, 'scout')[0];
    const models = { ...s.models, [uruk.id]: { ...uruk, x: merry.x - 3.4, y: merry.y } };
    for (const m of Object.values(s.models)) if (m.owner === 'p2' && m.id !== uruk.id) models[m.id] = { ...m, y: m.y + 20 };
    s = { ...s, models };
    const into = run(s, { type: 'moveModels', moves: [{ id: uruk.id, x: merry.x - 0.98, y: merry.y }] });
    expect(distanceBetween(into.models[uruk.id], merry)).toBeGreaterThan(0.2);
    // (Past Pippin too, who lies beside him.)
    const beyond = who(s, 'pippin').x + 1.3;
    const past = run(s, { type: 'moveModels', moves: [{ id: uruk.id, x: beyond, y: merry.y }] });
    expect(past.models[uruk.id].x).toBeCloseTo(beyond, 1);
    // Grishnákh crawls into contact with him.
    const g = who(s, 'grishnakh');
    s = { ...s, models: { ...s.models, [g.id]: { ...g, x: merry.x, y: merry.y + 3 } } };
    const charged = run(s, { type: 'moveModels', moves: [{ id: g.id, x: merry.x, y: merry.y + 0.98 }] });
    expect(distanceBetween(charged.models[g.id], merry)).toBeLessThanOrEqual(0.2);
  });

  it('a bound Hobbit can’t charge, and Grishnákh charges nobody but the Hobbits', () => {
    let s = ambush(2, 'p1');
    const merry = who(s, 'merry');
    const orc = all(s, 'orc')[0];
    s = { ...s, models: { ...s.models, [orc.id]: { ...orc, x: merry.x - 1.6, y: merry.y } } };
    const tried = run(s, { type: 'moveModels', moves: [{ id: merry.id, x: merry.x - 0.6, y: merry.y }] });
    expect(distanceBetween(tried.models[merry.id], s.models[orc.id])).toBeGreaterThan(0.2);
    let e = ambush(2, 'p2');
    const g = who(e, 'grishnakh');
    const rider = all(e, 'rider')[0];
    e = { ...e, models: { ...e.models, [rider.id]: { ...rider, x: g.x + 3, y: g.y, rot: 270 } } };
    const at = run(e, { type: 'moveModels', moves: [{ id: g.id, x: g.x + 1.9, y: g.y }] });
    expect(distanceBetween(at.models[g.id], e.models[rider.id])).toBeGreaterThan(0.2);
  });

  it('a Hobbit and Grishnákh fight as if neither were Prone', () => {
    let s = ambush(2, 'p2');
    const merry = who(s, 'merry');
    const g = who(s, 'grishnakh');
    s = { ...s, models: { ...s.models, [g.id]: { ...g, x: merry.x, y: merry.y + 0.98 } } };
    expect(fightsUpright(s, s.models[g.id])).toBe(true);
    expect(fightsUpright(s, merry)).toBe(true);
    expect(noStrikes(s, merry)).toBeNull();
    expect(noStrikes(s, s.models[g.id])).toBeNull();
    // Against a rider, Grishnákh is just a Prone Orc.
    const rider = all(s, 'rider')[0];
    const far = { ...s, models: { ...s.models, [g.id]: { ...g, x: 30, y: 40 }, [rider.id]: { ...rider, x: 30, y: 41.5, rot: 0 } } };
    expect(noStrikes(far, far.models[g.id])).toBe('Prone');
  });

  it('"Their bonds were cut": each bound Hobbit rolls as the Good side ends its move, a 6 (or a 5 beside a freed friend) freeing him', () => {
    let s = ambush(2, 'p1');
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).not.toContain('p1');
    expect(bondsDue(s)).toBe(true);
    // Merry rolls a 6 and is free; Pippin, touching him, frees himself on a 5.
    s = run(s, ...rollBonds(s, dice([6, 5]), uid));
    expect(who(s, 'merry')).toMatchObject({ x: who(s, 'merry').x });
    expect(who(s, 'merry').bound).toBeUndefined();
    expect(who(s, 'merry').prone).toBeUndefined();
    expect(who(s, 'merry').crawls).toBeUndefined();
    expect(who(s, 'pippin').bound).toBeUndefined();
    expect(s.flow.done).toContain('p1');
    expect(bondsDue(s)).toBe(false);
    // A 5 alone doesn't do it.
    let t = ambush(3, 'p1');
    t = run(t, { type: 'endActivation', seat: 'p1' });
    t = run(t, ...rollBonds(t, dice([5, 4]), uid));
    expect(who(t, 'merry').bound).toBe(true);
    expect(who(t, 'pippin').bound).toBe(true);
    expect(t.flow.done).toContain('p1');
  });

  it('the Hobbits may leave by any edge', () => {
    const s = ambush(2, 'p1');
    const merry = who(s, 'merry');
    for (const [x, y] of [[0.5, 20], [47.5, 20], [20, 0.5], [20, 47.5]]) expect(canEscape({ ...s, models: { ...s.models, [merry.id]: { ...merry, x, y } } }, { ...merry, x, y })).toBe(true);
    expect(canEscape(s, merry)).toBe(false);
  });
});

describe('Ambush at Night: who wins', () => {
  const kill = (s: GameState, pred: (m: GameState['models'][string]) => boolean, k = 99) => {
    const models = { ...s.models };
    let left = k;
    for (const m of Object.values(models)) if (left > 0 && pred(m)) {
      models[m.id] = { ...m, dead: true };
      left--;
    }
    return { ...s, models };
  };
  const away = (s: GameState) => {
    const models = { ...s.models };
    for (const k of ['merry', 'pippin']) models[who(s, k).id] = { ...who(s, k), escaped: true };
    return { ...s, models };
  };

  it('goes on while either Hobbit is on the table, and ends at the end of the turn once the Evil side is down to a quarter', () => {
    let s = ambush(4, 'p1');
    // 21 of the 28 slain leaves 7: a quarter.
    s = kill(s, m => m.owner === 'p2', 21);
    expect(ambushWinner({ ...s, phase: 'end' })).toBeNull();
    s = away(s);
    expect(ambushWinner(s)).toBeNull();
    expect(ambushWinner({ ...s, phase: 'end' })).toBe('p1');
    expect(gameWinner({ ...s, phase: 'end' })).toBe('p1');
    // Only 20 slain: not yet.
    expect(ambushWinner({ ...away(kill(ambush(4), m => m.owner === 'p2', 20)), phase: 'end' })).toBeNull();
  });

  it('a slain Hobbit holds the Good side to a draw, and both sides down at once is a draw', () => {
    let s = ambush(4, 'p1');
    s = kill(s, m => m.owner === 'p2', 21);
    s = kill(s, m => m.cast === 'merry');
    s = away(s);
    expect(ambushWinner({ ...s, phase: 'end' })).toBe('draw');
    let b = away(ambush(4, 'p1'));
    b = kill(b, m => m.owner === 'p2', 21);
    b = kill(b, m => m.owner === 'p1' && m.cast !== 'merry' && m.cast !== 'pippin', 12);
    expect(ambushWinner({ ...b, phase: 'end' })).toBe('draw');
    let e = away(ambush(4, 'p1'));
    e = kill(e, m => m.owner === 'p1' && m.cast !== 'merry' && m.cast !== 'pippin', 12);
    expect(ambushWinner({ ...e, phase: 'end' })).toBe('p2');
  });

  it('ends at once if the whole Evil side is slain', () => {
    const s = kill(ambush(3, 'p1'), m => m.owner === 'p2');
    expect(ambushWinner(s)).toBe('p1');
  });
});

describe('Ambush at Night: the computer', () => {
  it('plays both sides to a result', () => {
    const s = run(setup(), { type: 'startGame', at: 1 });
    const { state } = play(s, seeded(7), 30000);
    expect(state.result).toBeDefined();
    expect(narrativeById('ambush-at-night')).toBeDefined();
  }, 240000);
});
