import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { GameState, Model } from '../src/shared/types.ts';

const orc: Model = { id: 'o', owner: 'p1', name: 'Orc', x: 10, y: 40, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false };
const inMove = (): GameState => {
  let s = reduce(initialState(), { type: 'addModels', models: [orc] });
  s = reduce(s, { type: 'startGame' });
  return reduce(s, { type: 'setPhase', phase: 'move' });
};
const move = (s: GameState, x: number, y: number) => reduce(s, { type: 'moveModels', moves: [{ id: 'o', x, y }] });

describe('move limits', () => {
  it("stops a model at its Move in the Move phase", () => {
    const s = move(inMove(), 10, 30);
    expect(s.models.o.y).toBeCloseTo(34, 2);
  });

  it('counts several drags together along the way the model went', () => {
    let s = move(inMove(), 10, 36);
    s = move(s, 10, 30);
    expect(s.models.o.y).toBeCloseTo(34, 2);
    // Walking back costs Move too...
    s = move(s, 10, 39);
    expect(s.models.o.y).toBeCloseTo(34, 2);
    // ...but putting it back where it started is always allowed, and gives the whole Move back.
    s = move(s, 10, 40);
    expect(s.models.o.y).toBe(40);
    expect(move(s, 10, 30).models.o.y).toBeCloseTo(34, 2);
  });

  it('goes round a corner, as long as the whole way is within its Move', () => {
    // A short, tall wall 1" wide straight ahead: going straight at it stops there.
    const wall = { id: 'w', kind: 'wall' as const, shape: 'rect' as const, x: 10, y: 37, w: 1, h: 0.5, rot: 0, locked: false, height: 3, sheer: true };
    const s0 = reduce(inMove(), { type: 'addTerrain', terrain: wall });
    expect(move(s0, 10, 35).models.o.y).toBeGreaterThan(37.7);
    // Round its end instead: 1.1" across and 4.2" up.
    let s = move(s0, 11.1, 40);
    s = move(s, 11.1, 35.8);
    expect(s.models.o).toMatchObject({ x: 11.1, y: 35.8 });
    expect(s.flow.walked?.o).toBeCloseTo(5.3, 2);
    // Only 0.7" of its Move is left.
    expect(move(s, 11.1, 30).models.o.y).toBeCloseTo(35.1, 2);
  });

  it('gives a fresh Move next phase and leaves setup free', () => {
    let s = move(inMove(), 10, 34);
    s = reduce(s, { type: 'setPhase', phase: 'move', turn: 2 });
    expect(move(s, 10, 28).models.o.y).toBeCloseTo(28, 2);
    const setup = reduce(reduce(initialState(), { type: 'addModels', models: [orc] }), { type: 'moveModels', moves: [{ id: 'o', x: 10, y: 5 }] });
    expect(setup.models.o.y).toBe(5);
  });

  it("only lets a model turn outside the Move and Fight phases", () => {
    for (const phase of ['priority', 'shoot', 'end'] as const) {
      const s = move(reduce(inMove(), { type: 'setPhase', phase }), 10, 30);
      expect(s.models.o.y).toBe(40);
    }
    const turned = reduce(reduce(inMove(), { type: 'setPhase', phase: 'shoot' }), { type: 'moveModels', moves: [{ id: 'o', x: 10, y: 40, rot: 90 }] });
    expect(turned.models.o.rot).toBe(90);
  });

  it('allows 1" in the Fight phase, to back away', () => {
    const s = move(reduce(inMove(), { type: 'setPhase', phase: 'fight' }), 10, 30);
    expect(s.models.o.y).toBeCloseTo(39, 2);
  });

  it("can't be dodged by editing a model's position directly", () => {
    const s = reduce(inMove(), { type: 'updateModel', id: 'o', patch: { x: 30, y: 5, wounds: 0 } });
    expect(s.models.o).toMatchObject({ x: 10, y: 40, wounds: 0 });
  });
});

describe('charging', () => {
  it('finishes a move dropped inside an enemy control zone in base contact', async () => {
    const { settleMove } = await import('../src/shared/movement.ts');
    const { distanceBetween } = await import('../src/shared/geometry.ts');
    let s = inMove();
    s = reduce(s, { type: 'addModels', models: [{ ...orc, id: 'e', owner: 'p2', x: 10, y: 35 }] });
    const at = settleMove(s, s.models.o, { x: 10, y: 36.4 });
    expect(distanceBetween({ ...s.models.o, ...at }, s.models.e)).toBeLessThan(0.02);
    // Out of reach: left where it was dropped.
    const far = settleMove({ ...s, models: { ...s.models, o: { ...s.models.o, move: 1 } } }, { ...s.models.o, move: 1 }, { x: 10, y: 39.5 });
    expect(far).toEqual({ x: 10, y: 39.5 });
  });
});
