import { describe, expect, it } from 'vitest';
import { defence, inDoorway, touching } from '../src/shared/barriers.ts';
import { retreatSpots } from '../src/shared/backAway.ts';
import { combats } from '../src/shared/flow.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { engaged } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { crossBlocked } from '../src/shared/terrainTests.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const R = 25 / 25.4 / 2;
const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Terrain => ({ id, kind, shape: 'rect', x, y, w, h, rot: 0, locked: false, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const setup = (models: Model[], terrain: Terrain[], phase: GameState['phase']) =>
  run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase });
const moving = (models: Model[], terrain: Terrain[], first: Seat = 'p2') =>
  run(setup(models, terrain, 'move'), { type: 'choosePriority', seat: first }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const move = (s: GameState, id: string, x: number, y: number) => run(s, { type: 'moveModels', moves: [{ id, x, y }] });
const fighter = (id: string) => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });
/** Rolls a duel and its strikes with fixed dice, applying the results as the server would. */
function fight(s: GameState, p1: string[], p2: string[], d: number[]) {
  const seq = [...d];
  const d6 = () => seq.shift() ?? 1;
  const req = { sides: [p1.map(fighter), p2.map(fighter)] as [ReturnType<typeof fighter>[], ReturnType<typeof fighter>[]], targets: [p2[0], p1[0]] as [string, string], trapped: false };
  const seat = s.priority ?? 'p1';
  const duel = resolveRequest(s, seat, { type: 'fight', fight: req }, d6, uid)!;
  s = run(s, ...duel.apply);
  const group = (duel.apply[0] as { roll: { group: string } }).roll.group;
  const out = resolveRequest(s, seat, { type: 'strikes', fight: req, group }, d6, uid)!;
  return { s: run(s, ...out.apply), out };
}

// A wall 1" high and 0.5" thick along y = 20; Haleth (p1) stands touching its south side.
const wall = piece('w', 'wall', 10, 20, 12, 0.5);
const south = 20.25 + R + 0.02;
const north = 19.75 - R - 0.02;

describe('defending a wall', () => {
  it('lets an enemy charge a defender across the wall, and only one', () => {
    let s = moving([mk('d', 'p1', 10, south), mk('o', 'p2', 10, 16), mk('o2', 'p2', 12, 16)], [wall]);
    s = move(s, 'o', 10, 22);
    // It stops at the wall, opposite the defender, and they are fighting.
    expect(s.models.o.y).toBeLessThan(19.8);
    expect(touching(s, s.models.o, s.models.d)).toBe(true);
    expect(engaged(s, s.models.d)).toBe(true);
    expect(s.flow.charges?.o).toBe('d');
    expect(combats(s).map(c => [c.p1, c.p2])).toEqual([[['d'], ['o']]]);
    // A second orc can't join it over the wall.
    s = move(s, 'o2', 10.6, 22);
    expect(touching(s, s.models.o2, s.models.d)).toBe(false);
    expect(defence(s, [['d'], ['o']])).toMatchObject({ defender: 'd', attacker: 'o', how: 'wall' });
  });

  it('won’t let an enemy jump the wall beside a defender: it ends up fighting it', () => {
    let s = moving([mk('d', 'p1', 10, south), mk('o', 'p2', 11.2, 16)], [wall]);
    s = move(s, 'o', 11.2, 22);
    expect(touching(s, s.models.o, s.models.d)).toBe(true);
    const b = s.flow.blocked?.o;
    if (b) expect(crossBlocked(s, s.models.o, { terrain: b.terrain, test: b.test, stop: { x: b.stop[0], y: b.stop[1] }, landing: { x: b.landing[0], y: b.landing[1] }, drop: b.drop })).toBeTruthy();
  });

  it('makes the attacker’s strikes get past the wall, and the defender never backs away', () => {
    // The orc charges Haleth over the wall, so Haleth is the defender.
    const s0 = run(move(moving([mk('d', 'p1', 10, south), mk('o', 'p2', 10, 16)], [wall]), 'o', 10, 22), { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    const north = s0.models.o.y;
    // The orc wins (p2 rolls 6): two of its... one strike, needing a 4+ to get past the wall; a 2 stops it.
    const stopped = fight(s0, ['d'], ['o'], [1, 6, 2]);
    expect(stopped.out.apply.some(a => a.type === 'rolled' && a.roll.label.startsWith('In the Way: o strikes over the wall'))).toBe(true);
    expect(stopped.s.models.d.dead).toBe(false);
    expect(stopped.s.models.d.y).toBeCloseTo(south, 3);
    // The orc backs away instead.
    expect(stopped.s.models.o.y).toBeLessThan(north - 0.9);
    // Past the wall and wounding: the defender is slain, and the orc takes its place.
    const won = fight(s0, ['d'], ['o'], [1, 6, 5, 6]);
    expect(won.s.models.d.dead).toBe(true);
    expect(won.s.models.o.y).toBeCloseTo(south, 3);
    // The defender wins: it strikes as normal, and the orc backs away.
    const held = fight(s0, ['d'], ['o'], [6, 1, 1]);
    expect(held.out.apply.some(a => a.type === 'rolled' && a.roll.label.startsWith('In the Way'))).toBe(false);
    expect(held.s.models.o.y).toBeLessThan(north - 0.9);
    expect(held.s.models.d.y).toBeCloseTo(south, 3);
  });

  it('loses the protection when attacked from its own side too', () => {
    const s = setup([mk('d', 'p1', 10, south), mk('o', 'p2', 10, north), mk('o2', 'p2', 10 + 2 * R, south)], [wall], 'fight');
    expect(defence(s, [['d'], ['o']])).toBeNull();
  });
});

describe('high ground and doorways', () => {
  it('defends a ledge at least half the attacker’s height, and can’t be charged from below one taller than it', () => {
    const ledge = piece('r', 'rock', 10, 10, 6, 6, { height: 1 });
    const s = setup([mk('d', 'p1', 10, 13 - R - 0.01), mk('o', 'p2', 10, 13 + R)], [ledge], 'fight');
    expect(defence(s, [['d'], ['o']])).toMatchObject({ defender: 'd', how: 'height' });
    const cliff = piece('c', 'cliff', 10, 10, 6, 6, { height: 3 });
    const t = setup([mk('d', 'p1', 10, 13 - R - 0.01), mk('o', 'p2', 10, 13 + R)], [cliff], 'fight');
    expect(touching(t, t.models.d, t.models.o)).toBe(false);
  });

  it('defends a gap only one model wide', () => {
    // Two houses with a 1.1" gap between them; the defender stands in it.
    const left = piece('h1', 'building', 6.45, 10, 6, 6);
    const right = piece('h2', 'building', 13.55, 10, 6, 6);
    const s = setup([mk('d', 'p1', 10, 12.5), mk('o', 'p2', 10, 12.5 + 2 * R)], [left, right], 'fight');
    expect(inDoorway(s, s.models.d, s.models.o)).toBe(true);
    expect(defence(s, [['d'], ['o']])).toMatchObject({ defender: 'd', how: 'doorway' });
    // A wide street is no doorway.
    const wide = setup([mk('d', 'p1', 10, 10), mk('o', 'p2', 10, 10 + 2 * R)], [piece('h1', 'building', 3, 10, 6, 6), right], 'fight');
    expect(inDoorway(wide, wide.models.d, wide.models.o)).toBe(false);
  });
});

describe('backing away', () => {
  it('has a friend make way rather than leave the loser trapped', () => {
    // b is hemmed in by enemies on three sides, with a friend right behind it.
    const s0 = setup([mk('a', 'p1', 10, 14), mk('e1', 'p1', 10 - 2 * R - 0.02, 14 - 2 * R), mk('e2', 'p1', 10 + 2 * R + 0.02, 14 - 2 * R), mk('b', 'p2', 10, 14 - 2 * R), mk('c', 'p2', 10, 14 - 4 * R - 0.05)], [], 'fight');
    const { s, out } = fight(s0, ['a'], ['b'], [6, 1, 1]);
    const strike = out.apply.find(a => a.type === 'rolled' && a.roll.against === 'b');
    expect(strike?.type === 'rolled' && strike.roll.dice.length).toBe(1);
    expect(strike?.type === 'rolled' && strike.roll.note).toMatch(/c makes way for b/);
    const stepped = Math.hypot(s.models.c.x - 10, s.models.c.y - (14 - 4 * R - 0.05));
    expect(stepped).toBeGreaterThan(0.2);
    expect(stepped).toBeLessThanOrEqual(1.01);
    expect(distanceBetween(s.models.a, s.models.b)).toBeGreaterThan(0.9);
  });

  it('separates the winners from a trapped loser that lives', () => {
    const s0 = setup([mk('a', 'p1', 10, 3 * R), mk('b', 'p2', 10, R)], [], 'fight');
    const { s } = fight(s0, ['a'], ['b'], [6, 1, 1, 1]);
    expect(s.models.b.dead).toBe(false);
    expect(distanceBetween(s.models.a, s.models.b)).toBeGreaterThan(0.2);
  });

  it('won’t back away onto an objective marker', () => {
    const marker = piece('m', 'objective', 10, 20 - 2 * R - 1, 1, 1, { shape: 'circle' });
    const s0 = setup([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R)], [marker], 'fight');
    const { s } = fight(s0, ['a'], ['b'], [6, 1, 1]);
    expect(Math.hypot(s.models.b.x - 10, s.models.b.y - (20 - 2 * R - 1))).toBeGreaterThan(0.5 + R - 0.06);
  });

  it('pushes a loser with nowhere else to go over a drop, and it falls after the strikes', () => {
    // b is on a cliff's edge, its back to a 4" drop, hemmed in by two enemies.
    const cliff = piece('c', 'cliff', 10, 6, 20, 12, { height: 4 });
    const s0 = setup([mk('a', 'p1', 10, 12 - 3 * R), mk('a2', 'p1', 10 - 2 * R, 12 - R - 0.02), mk('a3', 'p1', 10 + 2 * R, 12 - R - 0.02), mk('b', 'p2', 10, 12 - R - 0.02)], [cliff], 'fight');
    const { s, out } = fight(s0, ['a', 'a2', 'a3'], ['b'], [6, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6]);
    expect(s.models.b.y).toBeGreaterThan(12);
    expect(out.apply.some(a => a.type === 'rolled' && a.roll.label.startsWith('Falling'))).toBe(true);
    expect(s.models.b.prone || s.models.b.dead).toBe(true);
  });

  it('lets the loser’s player pick another way to back away', () => {
    const s0 = setup([mk('a', 'p1', 10, 20), mk('b', 'p2', 10, 20 - 2 * R)], [], 'fight');
    const { s } = fight(s0, ['a'], ['b'], [6, 1, 1]);
    const spots = retreatSpots(s, 'b');
    const left = spots.find(p => p.dir === 180)!;
    expect(left.ok).toBe(true);
    const t = run(s, { type: 'backAwayTo', id: 'b', x: left.x, y: left.y });
    expect(t.models.b.x).toBeCloseTo(9, 2);
    // Back towards the winner it can't go.
    const towards = spots.find(p => p.dir === 90)!;
    expect(towards.ok).toBe(false);
    expect(run(s, { type: 'backAwayTo', id: 'b', x: towards.x, y: towards.y }).models.b).toEqual(s.models.b);
  });
});
