import { describe, expect, it } from 'vitest';
import { combats } from '../src/shared/flow.ts';
import { moveAllowance, movedTooFar } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { eyeOf, groundAt, sightTo, standingAt } from '../src/shared/sight.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const tower: Partial<Terrain> = { id: 'tower', kind: 'building', shape: 'rect', x: 20, y: 20, w: 6, h: 6, height: 6, floors: 2 };
const game = (...models: Model[]) =>
  run(
    initialState(),
    { type: 'addTerrain', terrain: tower as Terrain },
    { type: 'addModels', models },
    { type: 'startGame' },
    { type: 'setPhase', phase: 'move' },
    { type: 'choosePriority', seat: 'p1' },
  );

describe('floors inside buildings', () => {
  it('lets a model walk in at ground level and climb floor by floor, spending Move', () => {
    let s = game(mk('a', 'p1', 20, 20));
    expect(s.terrain.tower.floors).toBe(2);
    expect(groundAt(s, s.models.a)).toBe(0);
    s = run(s, { type: 'climb', id: 'a', floor: 1 });
    expect(s.models.a.floor).toBe(1);
    expect(standingAt(s, s.models.a)).toBe(3);
    expect(moveAllowance(s, s.models.a)).toBe(3);
    // Another 3" to the roof spends the rest; nothing left to go further.
    s = run(s, { type: 'climb', id: 'a', floor: 2 });
    expect(standingAt(s, s.models.a)).toBe(6);
    expect(moveAllowance(s, s.models.a)).toBe(0);
    expect(movedTooFar(s)).toContain('a');
    expect(run(s, { type: 'climb', id: 'a', floor: 0 }).models.a.floor).toBe(2);
  });

  it("refuses a climb the model's Move can't pay for", () => {
    let s = game(mk('a', 'p1', 17, 20, { move: 5 }));
    s = run(s, { type: 'moveModels', moves: [{ id: 'a', x: 20, y: 20 }] });
    // 3" walked, 2" left: not enough for the 3" climb.
    expect(run(s, { type: 'climb', id: 'a', floor: 1 }).models.a.floor).toBeUndefined();
  });

  it('keeps models on different floors out of each other\'s fights', () => {
    let s = game(mk('a', 'p1', 20, 20), mk('b', 'p2', 21, 20));
    expect(combats(s)).toHaveLength(1);
    s = run(s, { type: 'climb', id: 'a', floor: 1 });
    expect(combats(s)).toHaveLength(0);
  });

  it('lets a model up a floor see over the walls of other buildings', () => {
    const s = run(game(mk('a', 'p1', 20, 20), mk('b', 'p2', 20, 40)), { type: 'addTerrain', terrain: { id: 'hut', kind: 'building', shape: 'rect', x: 20, y: 30, w: 6, h: 4, height: 3 } as Terrain });
    expect(sightTo(s, s.models.a, s.models.b)).toBe('hidden');
    const up = run(s, { type: 'climb', id: 'a', floor: 2 });
    expect(eyeOf(up, up.models.a)).toBe(7);
    expect(sightTo(up, up.models.a, up.models.b)).not.toBe('hidden');
  });

  it('takes a model back to the ground when it walks out', () => {
    let s = run(initialState(), { type: 'addTerrain', terrain: tower as Terrain }, { type: 'addModels', models: [mk('a', 'p1', 20, 20, { floor: 1 })] });
    expect(standingAt(s, s.models.a)).toBe(3);
    s = run(s, { type: 'moveModels', moves: [{ id: 'a', x: 30, y: 20 }] });
    expect(s.models.a.floor).toBeUndefined();
  });
});
