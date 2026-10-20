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
    // Walking off somewhere new costs Move from where it is...
    expect(move(s, 13, 34).models.o.x).toBe(10);
    // ...but stepping back along the way it came takes it back there and gives back what it spent beyond that point,
    s = move(s, 10, 37);
    expect(s.models.o.y).toBeCloseTo(37, 2);
    expect(s.flow.walked?.o).toBeCloseTo(3, 2);
    expect(move(s, 10, 30).models.o.y).toBeCloseTo(34, 2);
    // ...and putting it back where it started gives the whole Move back.
    s = move(s, 10, 40);
    expect(s.models.o.y).toBe(40);
    expect(move(s, 10, 30).models.o.y).toBeCloseTo(34, 2);
  });

  it('steps back along a bent path, keeping the legs before it', () => {
    let s = move(inMove(), 10, 37);
    s = move(s, 12, 37);
    // Back onto the first leg, near its end: the second leg is undone.
    s = move(s, 10.2, 37.6);
    expect(s.models.o.x).toBeCloseTo(10, 2);
    expect(s.models.o.y).toBeCloseTo(37.6, 2);
    expect(s.flow.walked?.o).toBeCloseTo(2.4, 2);
    expect(s.flow.paths?.o?.length).toBe(2);
  });

  it('a small nudge from where it stands is a move, not a step back', () => {
    let s = move(inMove(), 10, 37);
    s = move(s, 10.3, 37);
    expect(s.models.o.x).toBeCloseTo(10.3, 2);
    expect(s.flow.walked?.o).toBeCloseTo(3.3, 2);
  });

  it('follows a curving drag sent as many small moves, without snapping back onto the way it came', () => {
    // A quarter circle of radius 3.5", sent about 0.15" at a time as a slow drag does.
    let s = inMove();
    const n = 36;
    for (let i = 1; i <= n; i++) {
      const a = Math.PI - (i / n) * (Math.PI / 2);
      const p = { x: 13.5 + 3.5 * Math.cos(a), y: 40 - 3.5 * Math.sin(a) };
      s = move(s, p.x, p.y);
      if (i > 1) expect(Math.hypot(s.models.o.x - p.x, s.models.o.y - p.y)).toBeLessThan(0.01);
    }
    expect(s.flow.walked?.o).toBeCloseTo(1.75 * Math.PI, 1);
  });

  it('keeps where a long, winding move began on its trail', () => {
    let s = reduce(inMove(), { type: 'updateModel', id: 'o', patch: { move: 60 } });
    // A zig-zag of many turns.
    for (let i = 1; i <= 120; i++) s = move(s, 10 + (i % 2) * 0.6, 40 - i * 0.3);
    const trail = s.flow.paths?.o ?? [];
    expect(trail[0]).toEqual([10, 40]);
    // Stepping back onto its very first leg gives back nearly all it walked.
    s = move(s, 10.25, 39.6);
    expect(s.flow.paths?.o).toHaveLength(2);
    expect(s.flow.walked?.o).toBeLessThan(0.7);
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
