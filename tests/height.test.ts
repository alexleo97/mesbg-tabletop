import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { eyeOf, inTheWay, moveCost, sightTo } from '../src/shared/sight.ts';
import type { GameState, Model, Terrain } from '../src/shared/types.ts';

let n = 0;
const mk = (owner: 'p1' | 'p2', x: number, y: number): Model => ({
  id: `m${n++}`, owner, name: 'Warrior', x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const piece = (kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Terrain => ({ id: `t${n++}`, kind, shape: 'circle', x, y, w, h, rot: 0, locked: false, ...extra });
const board = (...terrain: Terrain[]): GameState => terrain.reduce((s, t) => reduce(s, { type: 'addTerrain', terrain: t }), initialState());

describe('height', () => {
  it('hides models behind a hill from the ground, but not from its top', () => {
    const s = board(piece('hill', 24, 24, 8, 8));
    expect(sightTo(s, mk('p1', 24, 34), mk('p2', 24, 14))).toBe('hidden');
    const onTop = mk('p1', 24, 24);
    expect(eyeOf(s, onTop)).toBeCloseTo(3.1, 5);
    expect(sightTo(s, onTop, mk('p2', 24, 14))).toBe('clear');
  });

  it('lets a model on a hill see over a low rock that hides it on the ground', () => {
    const rock = piece('rock', 24, 20, 3, 3);
    const s = board(piece('hill', 24, 30, 8, 8, { height: 4 }), rock);
    expect(sightTo(s, mk('p1', 24, 30), mk('p2', 24, 14))).toBe('clear');
    expect(sightTo(board(rock), mk('p1', 24, 30), mk('p2', 24, 14))).toBe('hidden');
  });

  it('shoots over low cover from high ground, but not past cover by the target', () => {
    const wall = piece('wall', 24, 24, 6, 0.5, { shape: 'rect' });
    expect(inTheWay(board(wall), mk('p1', 24, 34), mk('p2', 24, 14))).toEqual(['wall']);
    const high = board(wall, piece('hill', 24, 36, 8, 8, { height: 5 }));
    expect(inTheWay(high, mk('p1', 24, 36), mk('p2', 24, 14))).toEqual([]);
    expect(inTheWay(high, mk('p1', 24, 36), mk('p2', 24, 23))).toEqual(['wall']);
  });

  it('counts climbing up and down a rock as part of the move, doubled as difficult ground', () => {
    const s = board(piece('rock', 24, 24, 4, 4, { height: 2 }));
    expect(moveCost(s, { x: 24, y: 30 }, { x: 24, y: 18 }).cost).toBeCloseTo(20, 0);
    // Hills are slopes, not climbs.
    expect(moveCost(board(piece('hill', 24, 24, 4, 4)), { x: 24, y: 30 }, { x: 24, y: 18 }).cost).toBeCloseTo(12, 5);
  });
});
