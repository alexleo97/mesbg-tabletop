import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, narrativeById, whollyInArea } from '../src/shared/narrative.ts';
import { balinWinner, crushedUnder, goblinTide, keptAside, tideDue, trample, trampleDue, trollDue, trollEnters } from '../src/shared/balin.ts';
import { DOORWAY } from '../src/shared/balinMap.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { standingAt } from '../src/shared/sight.ts';
import { crossingAhead } from '../src/shared/terrainTests.ts';
import { fighterOf } from '../src/shared/wargear.ts';
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

/** Balin's Tomb set up as the server would, with the Fellowship on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'balins-tomb', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** The battle started, turn `turn`'s Move phase begun with the Fellowship (p1) to move first. */
function tomb(turn = 1): GameState {
  let s = run(setup(), { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

/** Slays `count` of the models `pick` chooses. */
function kill(s: GameState, pick: (m: Model) => boolean, count = Infinity): GameState {
  const models = { ...s.models };
  let k = 0;
  for (const m of Object.values(models)) if (pick(m) && !m.dead && k++ < count) models[m.id] = { ...m, dead: true, wounds: 0 };
  return { ...s, models };
}

describe("Balin's Tomb: setting up", () => {
  it('sets out the book’s table and cast', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 24, h: 24 });
    expect(Object.values(s.models).filter(m => m.owner === 'p1').map(m => m.cast).sort()).toEqual(['aragorn', 'boromir', 'frodo', 'gandalf', 'gimli', 'legolas', 'merry', 'pippin', 'sam']);
    expect(who(s, 'frodo').options?.sort()).toEqual(['Mithril Coat', 'Sting']);
    expect(who(s, 'aragorn').options).toEqual(['Bow']);
    expect(who(s, 'boromir').options).toEqual(['Shield']);
    expect(all(s, 'goblin-captain')).toHaveLength(2);
    expect(all(s, 'goblin').map(m => m.options?.[0]).sort()).toEqual([...Array(8).fill('Orc bow'), ...Array(8).fill('Shield'), ...Array(8).fill('Spear')]);
    const troll = who(s, 'cave-troll');
    expect(troll.waiting).toBe(true);
    expect(troll.options).toEqual(['Hand-and-a-half weapon']);
    // The ledge round the walls, a pillars' row down each side, the tomb, the well and two trapdoors.
    const t = Object.values(s.terrain);
    expect(t.filter(p => p.walk)).toHaveLength(5);
    expect(t.filter(p => p.look === 'pillar')).toHaveLength(8);
    expect(t.filter(p => p.look === 'trapdoor').map(p => [p.x, p.y])).toEqual([
      [1.3, 12],
      [22.7, 12],
    ]);
    const well = t.find(p => p.look === 'well')!;
    expect([well.x, well.y]).toEqual([12, 6]);
  });

  it('sets the Fellowship within 6" of the middle, Gimli up on the tomb, and the Goblins within 6" of the doorway, clear of the Fellowship', () => {
    const s = setup();
    const models = Object.values(s.models).filter(m => !m.waiting);
    for (const m of models) {
      const c = m.owner === 'p1' ? { circle: [12, 12, 6] as [number, number, number] } : { circle: [DOORWAY.x, DOORWAY.y, 6] as [number, number, number] };
      expect(whollyInArea(c, m, r(m))).toBe(true);
      for (const o of models) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThan(r(o) + r(m) - 0.02);
    }
    expect(standingAt(s, who(s, 'gimli'))).toBe(1);
    for (const g of models.filter(m => m.owner === 'p2')) for (const f of models.filter(m => m.owner === 'p1')) expect(distanceBetween(g, f)).toBeGreaterThanOrEqual(1);
    // Dragged into the Fellowship's control zone, a Goblin stays put.
    const g = all(s, 'goblin')[0];
    const frodo = who(s, 'gandalf');
    const moved = resolveRequest(s, 'p2', { type: 'moveModels', moves: [{ id: g.id, x: frodo.x, y: frodo.y + 1.2 }] }, () => 3, uid, 1, catalog);
    const after = moved ? run(s, ...moved.apply) : s;
    expect([after.models[g.id].x, after.models[g.id].y]).toEqual([g.x, g.y]);
  });
});

describe("Balin's Tomb: the ledge", () => {
  it('stands a model up on the ledge 1" above the floor, and takes a Jump to get up there', () => {
    const s = tomb(2);
    const g = all(s, 'goblin')[0];
    const up = { ...g, x: 1.5, y: 8 };
    expect(standingAt({ ...s, models: { ...s.models, [g.id]: up } }, up)).toBe(1);
    const c = crossingAhead(s, g, { x: 5, y: 7.5 }, { x: 1.5, y: 7.5 })!;
    expect(c.test).toBe('Jump');
  });
});

describe("Balin's Tomb: the Goblin Tide", () => {
  /** Turn 2 with the Fellowship's move done and five Goblin Warriors and a Captain slain. */
  function slain(s = tomb(2)) {
    s = kill(s, m => m.cast === 'goblin', 5);
    s = kill(s, m => m.cast === 'goblin-captain', 1);
    return run(s, { type: 'endActivation', seat: 'p1' });
  }

  it('waits as the Goblins end their move, and brings every slain Goblin Warrior back: a trapdoor each, two by the well, the rest at the doorway', () => {
    let s = slain();
    s = run(s, { type: 'endActivation', seat: 'p2' });
    expect(s.flow.done).not.toContain('p2');
    expect(tideDue(s)).toBe(true);
    expect(keptAside(s)).toHaveLength(5);
    s = run(s, ...goblinTide(s, uid, 1));
    const back = all(s, 'goblin').filter(m => !m.dead && !m.waiting);
    // One is still at the doorway's edge to move on; the captain stays dead.
    expect(back.length).toBe(24 - 5 + 5);
    expect(all(s, 'goblin-captain').filter(m => m.dead)).toHaveLength(1);
    const near = (x: number, y: number, d: number) => back.filter(m => Math.hypot(m.x - x, m.y - y) <= d);
    expect(near(1.3, 12, 1.7)).toHaveLength(1);
    expect(near(22.7, 12, 1.7)).toHaveLength(1);
    expect(near(12, 6, 1.4)).toHaveLength(2);
    expect(back.filter(m => m.y > 23 && s.flow.entering?.ids.includes(m.id))).toHaveLength(1);
    // They may move (and charge) now, and the side's move ends after.
    const up = near(1.3, 12, 1.7)[0];
    s = run(s, { type: 'moveModels', moves: [{ id: up.id, x: up.x, y: up.y + 2 }] });
    expect(s.models[up.id].y).toBeCloseTo(up.y + 2, 1);
    s = run(s, { type: 'endActivation', seat: 'p2' });
    expect(tideDue(s)).toBe(false);
  });

  it('keeps a trapdoor shut while a member of the Fellowship stands on it', () => {
    let s = slain();
    const legolas = who(s, 'legolas');
    s = { ...s, models: { ...s.models, [legolas.id]: { ...legolas, x: 1.4, y: 12.2 } } };
    s = run(s, { type: 'endActivation', seat: 'p2' });
    s = run(s, ...goblinTide(s, uid, 1));
    const back = all(s, 'goblin').filter(m => !m.dead && !m.waiting);
    expect(back.filter(m => m.x < 3 && Math.abs(m.y - 12) < 2)).toHaveLength(0);
    expect(back.filter(m => m.x > 21 && Math.abs(m.y - 12) < 2)).toHaveLength(1);
  });
});

describe("Balin's Tomb: the Cave Troll", () => {
  it('bursts in at the doorway as the Goblins start their move in turn 4, not before', () => {
    let s = run(tomb(3), { type: 'endActivation', seat: 'p1' });
    expect(trollDue(s)).toBe(false);
    s = run(tomb(4), { type: 'endActivation', seat: 'p1' });
    expect(trollDue(s)).toBe(true);
    s = run(s, ...trollEnters(s, uid, 1));
    const troll = who(s, 'cave-troll');
    expect(troll.waiting).toBeUndefined();
    expect(troll.y + r(troll)).toBeCloseTo(24, 2);
    expect(troll.x).toBeGreaterThanOrEqual(9 + r(troll) - 0.01);
    expect(troll.x).toBeLessThanOrEqual(15 - r(troll) + 0.01);
    expect(s.narrative?.troll).toBe(4);
    expect(trollDue(s)).toBe(false);
  });

  it('tramples through its own side the turn it comes in: a Strength 3 hit on each, and any it stops on slain', () => {
    let s = run(tomb(4), { type: 'endActivation', seat: 'p1' });
    s = run(s, ...trollEnters(s, uid, 1));
    const troll = who(s, 'cave-troll');
    // Two Goblins in a line in front of it, the second where it stops.
    const [a, b] = all(s, 'goblin');
    const models = { ...s.models };
    for (const m of Object.values(models)) if (m.owner === 'p2' && m.id !== troll.id) models[m.id] = { ...m, x: 22, y: 4 + (Object.keys(models).indexOf(m.id) % 10) };
    models[a.id] = { ...a, x: troll.x, y: troll.y - 2 };
    models[b.id] = { ...b, x: troll.x, y: troll.y - 3.8 };
    s = { ...s, models };
    // (Its move counts from just outside the doorway: 6" less the depth of its base.)
    s = run(s, { type: 'moveModels', moves: [{ id: troll.id, x: troll.x, y: troll.y - 6 }] });
    expect(s.models[troll.id].y).toBeCloseTo(troll.y - (6 - 2 * r(troll)), 1);
    expect(trampleDue(s)).toBe(true);
    const hits = trample(s, catalog, () => 6, uid, 1);
    expect(hits.filter(h => h.type === 'rolled')).toHaveLength(1);
    s = run(s, ...hits);
    expect(trampleDue(s)).toBe(false);
    expect(crushedUnder(s).map(m => m.id)).toEqual([b.id]);
    s = run(s, { type: 'endActivation', seat: 'p2' });
    const tide = goblinTide(s, uid, 1);
    expect(tide.some(t => t.type === 'affect' && t.id === b.id && t.patch.dead === true)).toBe(true);
    // Next turn it is just a Troll: its own side stops it.
    let t: GameState = { ...s, turn: 5, narrative: { ...s.narrative!, troll: 4 } };
    const tr = t.models[troll.id];
    const c = all(t, 'goblin').find(m => m.id !== b.id)!;
    t = { ...t, models: { ...t.models, [c.id]: { ...c, dead: false, waiting: undefined, x: tr.x, y: tr.y - 2.5 } } };
    t = run(t, { type: 'moveModels', moves: [{ id: tr.id, x: tr.x, y: tr.y - 5 }] });
    expect(t.models[tr.id].y).toBeGreaterThan(tr.y - 2.5);
  });

  it('Troll Rampage: +1 Fight in a turn it charged', () => {
    const s = tomb(5);
    const troll = { ...who(s, 'cave-troll'), waiting: undefined };
    const base = fighterOf(s, catalog, troll).f;
    const charged = { ...s, flow: { ...s.flow, charges: { [troll.id]: who(s, 'boromir').id } } };
    expect(fighterOf(charged, catalog, troll).f).toBe(base + 1);
  });
});

describe("Balin's Tomb: who wins", () => {
  it('Evil the moment Frodo falls, or a fifth of the Fellowship', () => {
    expect(balinWinner(kill(tomb(3), m => m.cast === 'frodo'))).toBe('p2');
    expect(balinWinner(kill(tomb(3), m => m.owner === 'p1' && m.cast !== 'frodo', 4))).toBeNull();
    expect(balinWinner(kill(tomb(3), m => m.owner === 'p1' && m.cast !== 'frodo', 5))).toBe('p2');
  });

  it('the Fellowship once the tenth turn ends with Frodo and five alive', () => {
    const s = kill(tomb(10), m => m.owner === 'p1' && m.cast !== 'frodo', 4);
    expect(balinWinner(s)).toBeNull();
    expect(balinWinner({ ...s, phase: 'end' })).toBe('p1');
    expect(gameWinner({ ...s, phase: 'end' })).toBe('p1');
  });
});

describe("Balin's Tomb: the computer", () => {
  it('plays both sides to a result', () => {
    const s = run(setup(), { type: 'startGame', at: 1 });
    const { state } = play(s, seeded(7), 30000);
    expect(state.result).toBeDefined();
    expect(narrativeById('balins-tomb')).toBeDefined();
  }, 300000);
});
