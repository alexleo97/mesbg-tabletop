import { describe, expect, it } from 'vitest';
import { STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { solidOutlines, zoneOf } from '../src/shared/deployment.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { deployList } from '../src/shared/importList.ts';
import { basesOverlap } from '../src/shared/movement.ts';
import { zonesOf } from '../src/shared/objects.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { scenarioById, SCENARIOS } from '../src/shared/scenarios.ts';
import { climbedLevel, onOutlines } from '../src/shared/sight.ts';
import { crossBlocked } from '../src/shared/terrainTests.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

// Models getting stuck in terrain or on each other, landing on rooftops when they're set up, and bases clipping
// into one another as they're moved up together.

const R = 25 / 25.4 / 2;
const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Terrain => ({ id, kind, shape: 'rect', x, y, w, h, rot: 0, locked: false, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const setup = (models: Model[], terrain: Terrain[] = [], scenario?: string) =>
  run({ ...initialState(), ...(scenario ? { scenario } : {}) }, { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })));
const begin = (s: GameState) => run(s, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const move = (s: GameState, id: string, x: number, y: number) => run(s, { type: 'moveModels', moves: [{ id, x, y }] });
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const out = resolveRequest(s, seat, a, () => dice.shift() ?? 1, () => 'u', 1, null);
  return out && run(s, ...out.apply);
};
const gap = (s: GameState, a: string, b: string) => Math.hypot(s.models[a].x - s.models[b].x, s.models[a].y - s.models[b].y) - 2 * R;

describe('terrain tests over several drags', () => {
  const wall = piece('w', 'wall', 10, 20, 10, 0.5);

  it('offers the Jump test when the model reaches a wall in a later drag of its move', () => {
    // Dragging streams the move in hops, so the model rarely reaches the wall in the hop it set off with.
    let s = begin(setup([mk('a', 'p1', 10, 24)], [wall]));
    s = move(s, 'a', 10.5, 22.5);
    s = move(s, 'a', 10, 17);
    expect(s.models.a.y).toBeGreaterThan(20.7);
    expect(s.flow.blocked?.a?.test).toBe('Jump');
    // ...and passing it takes the model over.
    s = ask(s, 'p1', { type: 'cross', id: 'a' }, [6])!;
    expect(s.models.a.y).toBeLessThan(19.8);
  });

  it('offers it again from where the model stopped, however many times it is dragged at the wall', () => {
    let s = begin(setup([mk('a', 'p1', 10, 24)], [wall]));
    s = move(s, 'a', 10, 17);
    const at = { ...s.models.a };
    for (const [x, y] of [[10.2, 17], [9.8, 16], [10, 15]]) s = move(s, 'a', x, y);
    expect(s.models.a).toMatchObject({ x: at.x, y: at.y });
    expect(s.flow.blocked?.a?.test).toBe('Jump');
  });

  it('needs room to land: no jumping a wall onto a model standing just beyond it', () => {
    let s = begin(setup([mk('a', 'p1', 10, 24), mk('b', 'p1', 10, 19.1)], [wall]));
    s = move(s, 'a', 10, 17);
    const b = s.flow.blocked!.a;
    const c = { terrain: b.terrain, test: b.test, stop: { x: b.stop[0], y: b.stop[1] }, landing: { x: b.landing[0], y: b.landing[1] }, drop: b.drop };
    expect(crossBlocked(s, s.models.a, c)).toBe('No room on the far side');
    expect(ask(s, 'p1', { type: 'cross', id: 'a' }, [6])).toBeNull();
  });
});

describe('models moving next to each other', () => {
  it('stop in base contact with a model they walk into, not inside it', () => {
    for (const [x, y] of [[20, 20], [21, 19.5], [19.2, 20.9]]) {
      const s = move(begin(setup([mk('a', 'p1', x, y), mk('b', 'p1', 23, 20)])), 'b', x, y);
      expect(gap(s, 'a', 'b')).toBeGreaterThanOrEqual(-1e-6);
      expect(gap(s, 'a', 'b')).toBeLessThan(0.005);
    }
  });

  it('stop in contact with a large or oval base too', () => {
    const troll = mk('t', 'p2', 20, 15, { base: { shape: 'round', w: 50, h: 50 } });
    const horse = mk('h', 'p1', 20, 22, { base: { shape: 'oval', w: 35, h: 60 }, move: 10 });
    let s = begin(setup([troll, horse, mk('f', 'p1', 14, 20)]));
    // A friend of the horse's walking into it from the side.
    s = move(s, 'f', 22, 22);
    expect(basesOverlap(s.models.f, s.models.h, 0)).toBe(false);
    expect(distanceBetween(s.models.f, s.models.h)).toBeLessThan(0.02);
  });

  it('end clear of each other when moved together and the front one is held up', () => {
    // A tall wall stops the front model; the one behind it must stop behind it, whatever order the moves come in.
    const wall = piece('w', 'wall', 10, 20, 2, 0.5, { height: 3, sheer: true });
    const s0 = begin(setup([mk('a', 'p1', 10, 22), mk('b', 'p1', 10, 23.2)], [wall]));
    for (const moves of [[{ id: 'a', x: 10, y: 18 }, { id: 'b', x: 10, y: 19.2 }], [{ id: 'b', x: 10, y: 19.2 }, { id: 'a', x: 10, y: 18 }]]) {
      const s = run(s0, { type: 'moveModels', moves });
      expect(s.models.a.y).toBeGreaterThan(20.7);
      expect(gap(s, 'a', 'b')).toBeGreaterThanOrEqual(-1e-6);
      expect(s.models.b.y).toBeLessThan(23.2);
    }
  });

  it('move as a block when nothing is in their way', () => {
    const s0 = begin(setup([mk('a', 'p1', 10, 22), mk('b', 'p1', 10, 23), mk('c', 'p1', 11, 22)]));
    const s = run(s0, { type: 'moveModels', moves: ['a', 'b', 'c'].map(id => ({ id, x: s0.models[id].x + 1, y: s0.models[id].y - 3 })) });
    for (const id of ['a', 'b', 'c']) expect(s.models[id]).toMatchObject({ x: s0.models[id].x + 1, y: s0.models[id].y - 3 });
  });

  it('can move a model off one it was left overlapping, but not further onto it', () => {
    let s = begin(setup([mk('a', 'p1', 20, 20), mk('b', 'p1', 20.4, 20)]));
    expect(move(s, 'b', 20.1, 20).models.b.x).toBe(20.4);
    s = move(s, 'b', 24, 20);
    expect(s.models.b.x).toBeCloseTo(24, 5);
  });

  it("won't put a model back where it started once another has moved onto that spot", () => {
    let s = begin(setup([mk('a', 'p1', 20, 20), mk('b', 'p1', 24, 20)]));
    s = move(s, 'a', 20, 23);
    s = move(s, 'b', 20, 20);
    expect(s.models.b.x).toBeCloseTo(20, 5);
    // Back to where it began: 'b' now stands there.
    s = move(s, 'a', 20, 20);
    expect(s.models.a.y).toBe(23);
  });

  it('lets models on different floors of a building pass over each other', () => {
    const house = piece('h', 'building', 20, 20, 8, 8, { floors: 1 });
    let s = setup([mk('a', 'p1', 18, 20), mk('b', 'p1', 21, 20)], [house]);
    s = run(s, { type: 'climb', id: 'a', floor: 1 });
    s = move(begin(s), 'a', 22, 20);
    expect(s.models.a.x).toBeCloseTo(22, 5);
  });
});

describe('setting up', () => {
  const house = piece('h', 'building', 10, 10, 4, 4);

  it('keeps a model off a building with no floors: it goes beside it rather than onto the roof', () => {
    const s = move(setup([mk('a', 'p1', 20, 20)], [house]), 'a', 10, 10);
    expect(onOutlines(solidOutlines(s), s.models.a, R)).toBe(false);
    expect(climbedLevel(s, s.models.a)).toBe(0);
    expect(Math.hypot(s.models.a.x - 10, s.models.a.y - 10)).toBeLessThan(2 + R + 0.2);
    // In the battle it walks away freely.
    expect(move(begin(s), 'a', s.models.a.x + 3, s.models.a.y).models.a.x).toBeCloseTo(s.models.a.x + 3, 5);
  });

  it('lets a model walk into a building with floors, and stand on rocks and hills', () => {
    const home = piece('h', 'building', 10, 10, 4, 4, { floors: 1 });
    const rock = piece('r', 'rock', 30, 10, 4, 4);
    let s = move(setup([mk('a', 'p1', 20, 20), mk('b', 'p1', 20, 22)], [home, rock]), 'a', 10, 10);
    s = move(s, 'b', 30, 10);
    expect(s.models.a).toMatchObject({ x: 10, y: 10 });
    expect(s.models.b).toMatchObject({ x: 30, y: 10 });
  });

  it('keeps a model off a cliff, and inside its deployment zone', () => {
    // Domination: player 1 sets up in the bottom half, below y = 24.
    const cliff = piece('c', 'cliff', 20, 30, 10, 6);
    const s = move(setup([mk('a', 'p1', 20, 40)], [cliff], 'domination'), 'a', 20, 26);
    expect(onOutlines(solidOutlines(s), s.models.a, R)).toBe(false);
    expect(zoneOf(s, zonesOf(s, 'p1'), s.models.a)).toBe(0);
  });

  it('keeps models off each other, putting one dropped on another just beside it', () => {
    let s = setup([mk('a', 'p1', 20, 20), mk('b', 'p1', 30, 20)]);
    s = move(s, 'b', 20.3, 20);
    expect(gap(s, 'a', 'b')).toBeGreaterThanOrEqual(-0.01);
    expect(gap(s, 'a', 'b')).toBeLessThan(0.15);
    // A whole group dragged together keeps clear too.
    s = setup([mk('a', 'p1', 20, 20), mk('b', 'p1', 21, 20), mk('c', 'p1', 30, 20)]);
    s = run(s, { type: 'moveModels', moves: [{ id: 'a', x: 29.5, y: 20 }, { id: 'b', x: 30.5, y: 20 }] });
    for (const [p, q] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) expect(gap(s, p, q)).toBeGreaterThanOrEqual(-0.01);
  });

  it('lays out armies on every starter table off buildings, cliffs, rocks, water and walls, and clear of each other', () => {
    const list = [{ name: 'Captain', count: 1, hero: true, group: 'a' }, { name: 'Warrior', count: 30, hero: false, group: 'a' }, { name: 'Knight on horse', count: 10, hero: false, group: 'b' }, { name: 'Cave Troll', count: 2, hero: false, group: 'b' }];
    let n = 0;
    for (const b of STARTER_BOARDS)
      for (const sc of [undefined, ...SCENARIOS.filter(x => x.deployment.type !== 'maelstrom').slice(0, 6).map(x => x.id)]) {
        let s = run({ ...initialState(), ...(sc ? { scenario: sc } : {}) }, { type: 'setScenery', w: b.w, h: b.h, mat: b.mat, terrain: starterTerrain(b, p => `${p}${n++}`) });
        for (const seat of ['p1', 'p2'] as const) s = run(s, { type: 'addModels', models: deployList(list, seat, s, sc ? scenarioById(sc) : undefined).map(m => ({ ...m, id: `${seat}-${n++}` })) });
        const avoid = solidOutlines(s, true);
        const ms = Object.values(s.models);
        for (const m of ms) expect([b.id, sc, m.name, onOutlines(avoid, m, Math.max(m.base.w, m.base.h) / 50.8)]).toEqual([b.id, sc, m.name, false]);
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) expect([b.id, sc, basesOverlap(ms[i], ms[j])]).toEqual([b.id, sc, false]);
      }
  });
});
