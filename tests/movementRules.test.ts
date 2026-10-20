import { describe, expect, it } from 'vitest';
import { distanceBetween } from '../src/shared/geometry.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const game = (models: Model[], terrain: Partial<Terrain>[] = []) =>
  run(
    initialState(),
    ...terrain.map(t => ({ type: 'addTerrain', terrain: t as Terrain }) as Action),
    { type: 'addModels', models },
    { type: 'startGame' },
    { type: 'setPhase', phase: 'move' },
    { type: 'choosePriority', seat: 'p1' },
    { type: 'passHeroic', seat: 'p1' },
    { type: 'passHeroic', seat: 'p2' },
  );
const move = (s: GameState, id: string, x: number, y: number) => run(s, { type: 'moveModels', moves: [{ id, x, y }] });

describe('movement rules', () => {
  it("keeps a model out of an enemy's control zone unless it charges", () => {
    const s = move(game([mk('a', 'p1', 10, 30), mk('e', 'p2', 11.4, 25)]), 'a', 10, 24);
    // It stops where its path would come within 1" of the enemy.
    expect(distanceBetween(s.models.a, s.models.e)).toBeGreaterThan(0.98);
    expect(s.models.a.y).toBeGreaterThan(25);
  });

  it('lets a charge end in base contact, and finishes a charge dropped just short', () => {
    const s = move(game([mk('a', 'p1', 10, 30), mk('e', 'p2', 10, 25)]), 'a', 10, 25.6);
    expect(distanceBetween(s.models.a, s.models.e)).toBeLessThan(0.05);
  });

  it("can't charge an enemy it couldn't see when it set off", () => {
    const wall = { id: 'house', kind: 'building', shape: 'rect', x: 10, y: 27.5, w: 4, h: 1, height: 4 } as Partial<Terrain>;
    const s = move(game([mk('a', 'p1', 13, 30), mk('e', 'p2', 10, 25)], [wall]), 'a', 10.5, 25.9);
    expect(distanceBetween(s.models.a, s.models.e)).toBeGreaterThan(0.98);
  });

  it('lets a model that starts inside a zone back off, or charge', () => {
    let s = game([mk('a', 'p1', 10, 26), mk('e', 'p2', 10, 25)]);
    // Already touching: engaged, so it can't move at all.
    expect(moveAllowance(s, s.models.a)).toBe(0);
    s = game([mk('a', 'p1', 10, 26.5), mk('e', 'p2', 10, 25)]);
    expect(move(s, 'a', 10, 29).models.a.y).toBeCloseTo(29);
    const charged = move(s, 'a', 10.1, 26.2);
    expect(distanceBetween(charged.models.a, charged.models.e)).toBeLessThan(0.05);
  });

  it("doesn't let a model walk through another model or stop on an objective", () => {
    const s = move(game([mk('a', 'p1', 10, 30), mk('f', 'p1', 10, 27)]), 'a', 10, 24);
    expect(s.models.a.y).toBeGreaterThan(27.9);
    const marker = { id: 'obj', kind: 'objective', shape: 'circle', x: 20, y: 25, w: 1.6, h: 1.6 } as Partial<Terrain>;
    const t = move(game([mk('a', 'p1', 20, 30)], [marker]), 'a', 20, 25);
    expect(Math.hypot(t.models.a.x - 20, t.models.a.y - 25)).toBeGreaterThan(1.2);
  });

  it('gives a Heroic March 3" more for the hero and friends nearby, and no charging', () => {
    let s = run(
      initialState(),
      { type: 'addModels', models: [mk('cap', 'p1', 10, 30, { hero: true, might: 1 }), mk('w', 'p1', 14, 30), mk('far', 'p1', 30, 30), mk('e', 'p2', 10, 21)] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
      { type: 'choosePriority', seat: 'p1' },
      { type: 'declareHeroic', model: 'cap', action: 'Heroic March' },
      { type: 'passHeroic', seat: 'p1' },
      { type: 'passHeroic', seat: 'p2' },
    );
    expect(moveAllowance(s, s.models.cap)).toBe(9);
    expect(moveAllowance(s, s.models.w)).toBe(9);
    expect(moveAllowance(s, s.models.far)).toBe(6);
    s = move(s, 'cap', 10, 22);
    expect(distanceBetween(s.models.cap, s.models.e)).toBeGreaterThan(0.98);
  });

  it("keeps a friend marching with a hero within 6\" of it from where the friend is now, and lets it go back", () => {
    let s = run(
      initialState(),
      { type: 'addModels', models: [mk('cap', 'p1', 10, 30, { hero: true, might: 1 }), mk('w', 'p1', 14, 30), mk('e', 'p2', 60, 60)] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
      { type: 'choosePriority', seat: 'p1' },
      { type: 'declareHeroic', model: 'cap', action: 'Heroic March' },
      { type: 'passHeroic', seat: 'p1' },
      { type: 'passHeroic', seat: 'p2' },
    );
    s = move(s, 'cap', 10, 22);
    // Up, then round to the right: it stops where it would get more than 6" from the hero, on its own way there,
    // not on a straight line from where it began.
    s = move(s, 'w', 14, 26);
    s = move(s, 'w', 18, 26);
    expect(s.models.w.y).toBeCloseTo(26, 3);
    expect(s.models.w.x).toBeGreaterThan(15);
    expect(distanceBetween(s.models.w, s.models.cap)).toBeLessThanOrEqual(6 + 1e-3);
    // Put back where it began, though the hero has gone on more than 6" from there.
    s = move(s, 'w', 14, 30);
    expect(s.models.w).toMatchObject({ x: 14, y: 30 });
    // From there it may still close in on the hero.
    s = move(s, 'w', 13, 28);
    expect(s.models.w).toMatchObject({ x: 13, y: 28 });
  });
});
