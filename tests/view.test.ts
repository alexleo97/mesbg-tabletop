import { describe, expect, it } from 'vitest';
import { initialState } from '../src/shared/reducer.ts';
import type { GameState, Model, Seat } from '../src/shared/types.ts';
import { fitView, homeTurn, snapTurn, toScreen, toTable, viewAt } from '../src/client/view.ts';

const mk = (id: string, owner: Seat, x: number, y: number): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false,
});
const withModels = (models: Model[], s: GameState = initialState()): GameState => ({ ...s, models: Object.fromEntries(models.map(m => [m.id, m])) });

describe('turning the table view', () => {
  it('maps a point to the screen and back however the table is turned', () => {
    for (const r of [0, 90, 180, -90, 37]) {
      const v = { x: 120, y: -40, s: 13, r };
      const p = { x: 7.5, y: 31 };
      const back = toTable(v, toScreen(v, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('turns clockwise: a quarter turn puts the top edge on the right', () => {
    const v = viewAt({ x: 24, y: 24 }, { x: 0, y: 0 }, 1, 90);
    const top = toScreen(v, { x: 24, y: 0 });
    expect(top.x).toBeCloseTo(24);
    expect(top.y).toBeCloseTo(0);
  });

  it('fits the whole table on screen at any quarter turn', () => {
    const board = { w: 72, h: 48 };
    for (const r of [0, 90, 180, 270]) {
      const v = fitView(board, 800, 600, r);
      const corners = [[0, 0], [72, 0], [0, 48], [72, 48]].map(([x, y]) => toScreen(v, { x, y }));
      for (const c of corners) {
        expect(c.x).toBeGreaterThanOrEqual(15.9);
        expect(c.x).toBeLessThanOrEqual(784.1);
        expect(c.y).toBeGreaterThanOrEqual(15.9);
        expect(c.y).toBeLessThanOrEqual(584.1);
      }
    }
  });

  it('settles a twist that ends nearly square', () => {
    expect(snapTurn(84)).toBe(90);
    expect(snapTurn(-176)).toBe(-180);
    expect(snapTurn(45)).toBe(45);
  });
});

describe('each side sees its own army at the bottom', () => {
  it('goes by the scenario zones: the first player at the bottom, the second turned round', () => {
    const s = { ...initialState(), scenario: 'domination' };
    expect(homeTurn(s, 'p1')).toBe(0);
    expect(Math.abs(homeTurn(s, 'p2'))).toBe(180);
  });

  it('goes by where the army stands when the scenario has no zones', () => {
    const s = initialState();
    const v = (seat: Seat, st: GameState) => {
      const r = homeTurn(st, seat);
      const p = toScreen({ x: 0, y: 0, s: 1, r }, { x: 0, y: 0 });
      return { r, p };
    };
    // An army along the left edge is turned to the bottom by a quarter turn anticlockwise.
    const left = withModels([mk('a', 'p1', 2, 20), mk('b', 'p1', 2, 28)], s);
    const r = v('p1', left).r;
    expect(r).toBe(-90);
    const at = toScreen({ x: 0, y: 0, s: 1, r }, { x: 2 - 24, y: 24 - 24 });
    expect(at.y).toBeGreaterThan(0);
    expect(Math.abs(at.x)).toBeLessThan(1e-6);
  });

  it('falls back to the first player at the bottom and the second across the table', () => {
    const s = initialState();
    expect(homeTurn(s, 'p1')).toBe(0);
    expect(Math.abs(homeTurn(s, 'p2'))).toBe(180);
  });
});
