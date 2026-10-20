import { describe, expect, it } from 'vitest';
import { costOf, limitMove, moveAllowance } from '../src/shared/movement.ts';
import { dropTarget } from '../src/shared/terrainTests.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { eyeOf } from '../src/shared/sight.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Terrain => ({ id, kind, shape: 'rect', x, y, w, h, rot: 0, locked: false, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, null);
  return out && run(s, ...out.apply);
};
const battle = (models: Model[], terrain: Terrain[]) =>
  run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const move = (s: GameState, id: string, x: number, y: number) => run(s, { type: 'moveModels', moves: [{ id, x, y }] });
const wall = piece('w', 'wall', 10, 20, 10, 0.5);

describe('terrain tests', () => {
  it('offers the Jump when a model is dragged into a wall on the board, not only when sent past it', () => {
    const s = battle([mk('a', 'p1', 10, 24)], [wall]);
    const m = s.models.a;
    // The board holds the dragged model at the stop in front of the wall; sending only that hides the wall.
    const held = limitMove(s, m, { x: 10, y: 17 }, 6, 'p1', m);
    expect(move(s, 'a', held.x, held.y).flow.blocked?.a).toBeUndefined();
    // So the spot it was dragged to goes, and the table holds it at the wall with the test offered.
    const sent = dropTarget(s, m, held, { x: 10, y: 17 });
    const after = move(s, 'a', sent.x, sent.y);
    expect(after.models.a.y).toBeCloseTo(held.y, 2);
    expect(after.flow.blocked?.a?.test).toBe('Jump');
    // A drop short of any terrain is sent as it is.
    expect(dropTarget(s, m, { x: 10, y: 23 }, { x: 10, y: 23 })).toEqual({ x: 10, y: 23 });
  });

  it('stops a model at a wall more than half its height, and a Jump test gets it over', () => {
    let s = move(battle([mk('a', 'p1', 10, 24)], [wall]), 'a', 10, 17);
    expect(s.models.a.y).toBeGreaterThan(20.7);
    expect(s.flow.blocked?.a?.test).toBe('Jump');
    // A 1: it stays put and its move ends.
    const fail = ask(s, 'p1', { type: 'cross', id: 'a' }, [1])!;
    expect(fail.models.a.y).toBeCloseTo(s.models.a.y, 5);
    expect(fail.flow.stopped).toContain('a');
    expect(move(fail, 'a', 10, 22).models.a.y).toBeCloseTo(s.models.a.y, 5);
    // A 3: over the wall, and its move ends there.
    const over = ask(s, 'p1', { type: 'cross', id: 'a' }, [3])!;
    expect(over.models.a.y).toBeLessThan(19.8);
    expect(over.flow.stopped).toContain('a');
    // A 6: over, and it can carry on.
    s = ask(s, 'p1', { type: 'cross', id: 'a' }, [6])!;
    expect(s.flow.stopped ?? []).not.toContain('a');
    expect(move(s, 'a', 10, 18.5).models.a.y).toBeCloseTo(18.5, 5);
  });

  it('lets a model step over a low wall freely', () => {
    const low = piece('w', 'wall', 10, 20, 10, 0.5, { height: 0.5 });
    expect(move(battle([mk('a', 'p1', 10, 24)], [low]), 'a', 10, 18).models.a.y).toBeCloseTo(18, 5);
  });

  it('makes one Jump test for two models carrying a Heavy Object together', () => {
    const ally = piece('ally', 'objective', 10.34, 23.66, 1, 1, { shape: 'circle', object: 'ally', side: 'p1', carrier: 'a' });
    let s = battle([mk('a', 'p1', 10, 24), mk('b', 'p1', 11, 24)], [wall, ally]);
    s = move(move(s, 'a', 10, 17), 'b', 11, 17);
    expect([s.flow.blocked?.a?.test, s.flow.blocked?.b?.test]).toEqual(['Jump', 'Jump']);
    const over = ask(s, 'p1', { type: 'cross', id: 'a' }, [3, 1])!;
    expect([over.models.a.y, over.models.b.y].every(y => y < 19.8)).toBe(true);
    expect(over.log.at(-1)?.label).toContain('the same roll as a');
    const fail = ask(s, 'p1', { type: 'cross', id: 'a' }, [1, 6])!;
    expect([fail.models.a.y, fail.models.b.y].every(y => y > 20.5)).toBe(true);
  });

  it('needs a Climb test for a rock taller than the model, which cavalry can’t take, and counts climbing double', () => {
    const rock = piece('r', 'rock', 10, 16, 6, 6, { height: 2 });
    let s = move(battle([mk('a', 'p1', 10, 20)], [rock]), 'a', 10, 16);
    expect(s.flow.blocked?.a?.test).toBe('Climb');
    s = ask(s, 'p1', { type: 'cross', id: 'a' }, [4])!;
    expect(s.models.a.y).toBeLessThan(19);
    // Climbing 2" counts as 4" of Move.
    expect(costOf(s, s.models.a, { x: 10, y: 20 }, s.models.a)).toBeGreaterThan(5);
    const horse = mk('h', 'p1', 10, 22, { base: { shape: 'oval', w: 35, h: 60 }, move: 10 });
    const c = move(battle([horse], [rock]), 'h', 10, 16);
    expect(c.flow.blocked?.h?.test).toBe('Climb');
    expect(ask(c, 'p1', { type: 'cross', id: 'h' }, [6])).toBeNull();
  });

  it('makes a failed climb down a fall, with Strength 3 hits for each inch beyond the model’s height', () => {
    const cliff = piece('c', 'cliff', 10, 10, 10, 10, { height: 4 });
    let s = battle([mk('a', 'p1', 10, 12)], [cliff]);
    s = move(s, 'a', 10, 18);
    expect(s.flow.blocked?.a?.test).toBe('Climb down');
    const fell = ask(s, 'p1', { type: 'cross', id: 'a' }, [1, 6, 6, 6, 6])!;
    expect(fell.models.a.y).toBeGreaterThan(15);
    const falling = fell.log.find(r => r.label.startsWith('Falling'));
    // 4" fall, model 1.1" tall: one hit plus two for the full inches beyond its height.
    expect(falling?.dice).toHaveLength(3);
    expect(fell.models.a.dead).toBe(true);
  });

  it('can leap a narrow stream or wade in instead', () => {
    const stream = piece('s', 'water', 10, 20, 10, 1.5);
    let s = move(battle([mk('a', 'p1', 10, 23)], [stream]), 'a', 10, 17.5);
    expect(s.flow.blocked?.a?.test).toBe('Leap');
    const waded = move(run(s, { type: 'crossed', id: 'a', terrain: 's' }), 'a', 10, 19);
    expect(waded.models.a.y).toBeLessThan(21);
    s = ask(s, 'p1', { type: 'cross', id: 'a' }, [5])!;
    expect(s.models.a.y).toBeLessThan(19.3);
  });

  it('lets a Prone model crawl 1", and a standing one lie down; Prone models are half as tall for sight', () => {
    let s = battle([mk('a', 'p1', 10, 24, { prone: true }), mk('b', 'p1', 20, 24)], []);
    s = run(s, { type: 'crawl', id: 'a' });
    expect(moveAllowance(s, s.models.a)).toBe(1);
    s = move(s, 'a', 10, 21);
    expect(s.models.a.prone).toBe(true);
    expect(s.models.a.y).toBeCloseTo(23, 5);
    const eye = eyeOf(s, s.models.b);
    s = run(s, { type: 'lieDown', id: 'b' });
    expect(s.models.b.prone).toBe(true);
    expect(eyeOf(s, s.models.b)).toBeCloseTo(eye / 2, 5);
    expect(s.flow.stopped).toContain('b');
  });

  it('counts difficult ground under any part of the base', () => {
    const wood = piece('wd', 'wood', 10, 10, 4, 20);
    const s = battle([mk('a', 'p1', 12.3, 30)], [wood]);
    // The centre line runs just outside the wood, but the base brushes it.
    expect(costOf(s, s.models.a, { x: 12.3, y: 24 }, { x: 12.3, y: 18 })).toBeGreaterThan(6.5);
  });
});
