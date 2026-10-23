import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeById, whollyInArea } from '../src/shared/narrative.ts';
import { bringDownTarget, entsWinner, flamingArrows } from '../src/shared/ents.ts';
import { DAM, DECK, EVIL_AREA, GOOD_AREA, ORTHANC, onDeck } from '../src/shared/entsMap.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { breachBlocked, breachOptions, resolveBreach } from '../src/shared/breach.ts';
import { resolveFight, resolveShot, type Fighter } from '../src/shared/fight.ts';
import { standingAt } from '../src/shared/sight.ts';
import { crossBlocked, crossingAhead } from '../src/shared/terrainTests.ts';
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
/** Dice that come up as listed, in order. */
const dice = (...list: number[]) => {
  let i = 0;
  return () => list[i++ % list.length];
};

/** Last March of the Ents set up as the server would, with the Ents on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'last-march-of-the-ents', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** The battle started, turn `turn`'s Move phase begun with the Ents (p1) to move first. */
function march(turn = 1): GameState {
  let s = run(setup(), { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

describe('Last March of the Ents: setting up', () => {
  it('sets out the book’s table and cast', () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const good = Object.values(s.models).filter(m => m.owner === 'p1');
    expect(good.map(m => m.cast).sort()).toEqual(['beechbone', 'birchseed', 'ent', 'ent', 'ent', 'treebeard']);
    expect(who(s, 'treebeard').options).toContain('Merry & Pippin');
    expect(all(s, 'captain')).toHaveLength(4);
    expect(all(s, 'orc').map(m => m.options?.[0]).sort()).toEqual([...Array(8).fill('Orc bow'), ...Array(16).fill('Shield'), ...Array(16).fill('Spear'), ...Array(8).fill('Two-handed weapon')]);
    // Orthanc in the middle, sheer and tall; the dam in the middle of the west edge, held by the Orcs.
    const orthanc = s.terrain['n-orthanc'];
    expect(orthanc).toMatchObject({ x: 24, y: 24, sheer: true, height: ORTHANC.height });
    const dam = s.terrain['n-dam'];
    expect(dam).toMatchObject({ kind: 'gate', door: 'dam', side: 'p2' });
    expect(dam.x - dam.w / 2).toBe(0);
    expect(dam.y).toBeCloseTo(23.25, 1);
    // Scaffolds two decks high in places, ladders up them, and pits.
    const t = Object.values(s.terrain);
    expect(t.filter(p => p.look === 'scaffold').map(p => p.height).sort()).toEqual([DECK.low, DECK.low, DECK.low, DECK.high, DECK.high]);
    expect(t.filter(p => p.look === 'ladder' && p.stairs).length).toBeGreaterThanOrEqual(6);
    expect(t.filter(p => p.look === 'pit').length).toBeGreaterThan(10);
  });

  it('starts everyone where the book says, and keeps them there while being set up', () => {
    const s = setup();
    const models = Object.values(s.models);
    for (const m of models) {
      expect(holdNarrative(s, { id: m.id, x: m.x, y: m.y })).toMatchObject({ x: m.x, y: m.y });
      for (const o of models) if (o.id !== m.id) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThan(r(o) + r(m) - 0.02);
      expect(whollyInArea(m.owner === 'p1' ? GOOD_AREA : EVIL_AREA, m, r(m), s)).toBe(true);
    }
    // The Ents wholly within 6" of the east edge.
    for (const m of models.filter(m => m.owner === 'p1')) expect(m.x - r(m)).toBeGreaterThanOrEqual(42 - 0.01);
    // Archers up on all three scaffolds, one of them in the eastern half.
    const decks = models.filter(m => m.owner === 'p2' && standingAt(s, m) >= DECK.low - 0.01);
    expect(decks).toHaveLength(8);
    expect(decks.some(m => m.x > 24)).toBe(true);
  });

  it('refuses the moves the set-up rules out', () => {
    const s = setup();
    const ent = who(s, 'ent');
    const orc = all(s, 'orc').find(m => m.options?.includes('Shield'))!;
    // The Ents stay by the east edge; the Orcs in the western half, unless they go up on a scaffold.
    expect(holdNarrative(s, { id: ent.id, x: 40, y: ent.y })).toMatchObject({ x: ent.x, y: ent.y });
    expect(holdNarrative(s, { id: orc.id, x: 30, y: 30 })).toMatchObject({ x: orc.x, y: orc.y });
    const deck = onDeck('scaffold-ne', 0.8);
    expect(holdNarrative(s, { id: orc.id, x: deck.x, y: deck.y })).toMatchObject(deck);
    // (But not hanging off the edge of one.)
    const edge = onDeck('scaffold-ne', 0, 1.1);
    expect(holdNarrative(s, { id: orc.id, x: edge.x, y: edge.y })).toMatchObject({ x: orc.x, y: orc.y });
  });
});

describe('Last March of the Ents: the table', () => {
  it('stands models up on the scaffolds, with ladders to climb them by', () => {
    const s = march(2);
    const orc = all(s, 'orc')[0];
    const ent = who(s, 'ent');
    const at = (m: Model, p: { x: number; y: number }) => standingAt(put(s, m, p.x, p.y), { ...m, ...p });
    expect(at(orc, onDeck('scaffold-ne', 0))).toBeCloseTo(DECK.low, 2);
    expect(at(orc, onDeck('scaffold-nw-high', 0))).toBeCloseTo(DECK.high, 2);
    // From the ground up the side of a deck, an Orc must climb and an Ent jump; at a ladder nobody needs a test.
    const side = onDeck('scaffold-ne', 0, 3);
    const mid = onDeck('scaffold-ne', 0);
    expect(crossingAhead(s, orc, side, mid)?.test).toBe('Climb');
    expect(crossingAhead(s, ent, onDeck('scaffold-ne', 0, 4), mid)?.test).toBe('Jump');
    expect(crossingAhead(s, orc, onDeck('scaffold-ne', 5.4), onDeck('scaffold-ne', 2.4))).toBeNull();
    // And from the lower deck up to the upper one by the ladder between them.
    expect(crossingAhead(s, orc, onDeck('scaffold-nw-low', -1.35), onDeck('scaffold-nw-high', 1))).toBeNull();
    // (There's no ladder up to it from the ground: that's a climb of 4.5".)
    expect(crossingAhead(s, orc, onDeck('scaffold-nw-high', -4.2), onDeck('scaffold-nw-high', -1))).toMatchObject({ test: 'Climb', terrain: 'n-scaffold-nw-high' });
  });

  it('makes the pits a leap for an Orc, and a stride for an Ent', () => {
    const s = march(2);
    const orc = all(s, 'orc')[0];
    const ent = who(s, 'ent');
    expect(crossingAhead(s, orc, { x: 31, y: 11.8 }, { x: 31, y: 15.6 })?.test).toBe('Leap');
    expect(crossingAhead(s, ent, { x: 31, y: 11 }, { x: 31, y: 16.5 })).toBeNull();
  });

  it('lets nobody climb Orthanc', () => {
    const s = march(2);
    const orc = all(s, 'orc')[0];
    const c = crossingAhead(s, orc, { x: 24, y: 15 }, { x: 24, y: 23 });
    expect(c?.test).toBe('Climb');
    expect(crossBlocked(put(s, orc, 24, 15), { ...orc, x: 24, y: 15 }, c!)).toMatch(/sheer/i);
  });
});

describe('Last March of the Ents: "Release the River!"', () => {
  it('lets the dam be struck at only in combat, and the Ents win as it breaks', () => {
    let s = march(2);
    const ent = who(s, 'ent');
    const dam = s.terrain['n-dam'];
    s = put(s, ent, DAM.x1 + r(ent) + 0.05, 23);
    const at = s.models[ent.id];
    // No shooting it, even with Throw Stones.
    expect(breachBlocked({ ...s, phase: 'shoot' }, catalog, 'shoot', at, dam)).toMatch(/only be harmed in combat/);
    // In the Fight phase, out of any fight, an Ent touching it strikes at it.
    const fight = { ...s, phase: 'fight' as const };
    expect(breachOptions(fight, catalog, at).map(o => o.how)).toContain('strike');
    // Defence 10 and 5 Wounds: S8 against it, twice To Wound for each Attack.
    const out = resolveBreach(fight, catalog, 'p1', 'strike', ent.id, dam.id, () => 6, uid, 1)!;
    const patch = out.find(a => a.type === 'updateTerrain');
    expect(patch).toMatchObject({ patch: { wounds: 0, gone: 'destroyed' } });
    s = run(fight, ...out);
    expect(entsWinner(s)).toBe('p1');
    expect(gameWinner(s)).toBe('p1');
  });

  it('gives the Orcs the game once every Ent is slain', () => {
    let s = march(3);
    expect(entsWinner(s)).toBeNull();
    for (const m of Object.values(s.models).filter(m => m.owner === 'p1')) s = run(s, { type: 'affect', id: m.id, patch: { dead: true, wounds: 0 } });
    expect(entsWinner(s)).toBe('p2');
  });

  it('gives the Ents the game if every Orc is gone, with nobody left to stop them', () => {
    let s = march(3);
    for (const m of Object.values(s.models).filter(m => m.owner === 'p2')) s = run(s, { type: 'affect', id: m.id, patch: { dead: true, wounds: 0 } });
    expect(entsWinner(s)).toBe('p1');
  });
});

describe('Last March of the Ents: Flaming Arrows', () => {
  it('does 2 Wounds and Sets an Ent Ablaze when a natural 6 To Hit goes on to wound', () => {
    const s = march(2);
    const bow = all(s, 'orc').find(m => m.options?.includes('Orc bow'))!;
    const ent = who(s, 'ent');
    expect(flamingArrows(s, bow, ent)).toBe(true);
    expect(flamingArrows(s, ent, bow)).toBe(false);
    const req = { shooter: { id: bow.id, name: 'Orc', weapon: 'Orc bow', shoot: 5, s: 2, shots: 1 }, target: { id: ent.id, name: 'Ent', d: 8 }, obstacles: 0, flaming: true };
    const lit = resolveShot(req, () => 6, 'p2', 's-1', 1);
    expect(lit.wounds).toBe(2);
    expect(lit.ablaze).toEqual([ent.id]);
    // A 5 hits but isn't a flaming arrow: 1 Wound, and no fire.
    const plain = resolveShot(req, dice(5, 6, 6), 'p2', 's-2', 1);
    expect(plain.wounds).toBe(1);
    expect(plain.ablaze).toBeUndefined();
  });
});

describe('Last March of the Ents: "Bring them down!"', () => {
  it('lets three or more Orcs touching an Ent pull it down instead of striking', () => {
    const s = march(2);
    const ent = who(s, 'ent');
    const orcs = all(s, 'orc').slice(0, 3);
    const f = (m: Model, x: Partial<Fighter> = {}): Fighter => ({ id: m.id, name: m.name, f: 3, a: 1, s: 3, d: 5, ...x });
    const req = { sides: [[f(ent, { f: 7, a: 3, s: 8, d: 8 })], orcs.map(o => f(o))] as [Fighter[], Fighter[]], targets: [orcs[0].id, ent.id] as [string, string], trapped: false };
    expect(bringDownTarget(s, req, 1)).toBe(ent.id);
    // Not with two, and not for the Ent's side.
    expect(bringDownTarget(s, { ...req, sides: [req.sides[0], req.sides[1].slice(0, 2)] }, 1)).toBeUndefined();
    expect(bringDownTarget(s, req, 0)).toBeUndefined();
    // The Orcs win the duel, then a D6 each: a 6 brings it down, and nobody strikes.
    const down = resolveFight({ ...req, brutal: { by: orcs[0].id, kind: 'topple', target: ent.id } }, dice(1, 1, 1, 6, 2, 2, 6, 1, 1), 'p2', 'f-1', 1);
    expect(down.outcome).toMatchObject({ winner: 1, ended: 'topple', knocked: [ent.id], wounds: 0 });
    const up = resolveFight({ ...req, brutal: { by: orcs[0].id, kind: 'topple', target: ent.id } }, dice(1, 1, 1, 6, 2, 2, 5, 1, 1), 'p2', 'f-2', 1);
    expect(up.outcome.knocked).toBeUndefined();
    expect(up.outcome.hits).toEqual([]);
  });
});

describe('Last March of the Ents: the computer', () => {
  it('plays both sides with nothing refused', () => {
    const s = run(setup(), { type: 'startGame', at: 1 });
    const refused: string[] = [];
    const { state } = play(s, seeded(3), 20000, st => st.turn > 8 || !!st.result, (_, seat, a, ok) => void (ok || refused.push(`${seat}:${a.type}`)));
    expect(refused).toEqual([]);
    // The Ents have got among the Orcs.
    expect(Object.values(state.models).filter(m => m.owner === 'p2' && m.dead).length).toBeGreaterThan(0);
    expect(narrativeById('last-march-of-the-ents')).toBeDefined();
  }, 600000);
});
