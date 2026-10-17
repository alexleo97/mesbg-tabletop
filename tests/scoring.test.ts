import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { SCENARIOS } from '../src/shared/scenarios.ts';
import { scoreLines, vpTotals } from '../src/shared/scoring.ts';
import { gameWinner } from '../src/shared/status.ts';
import type { GameState, Model, Seat } from '../src/shared/types.ts';

let n = 0;
const mk = (owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id: `m${n++}`, owner, name: 'Warrior', x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const marker = (id: string, x: number, y: number) => ({ type: 'addTerrain' as const, terrain: { id, kind: 'objective' as const, shape: 'circle' as const, x, y, w: 1.6, h: 1.6, rot: 0, locked: false } });

function game(scenario: string, models: Model[], markers: [number, number][] = []): GameState {
  let s = reduce(initialState(), { type: 'setScenario', id: scenario });
  s = reduce(s, { type: 'addModels', models });
  markers.forEach(([x, y], i) => (s = reduce(s, marker(`o${i}`, x, y))));
  return reduce(s, { type: 'startGame' });
}

describe('scenario scoring', () => {
  it('scores Domination objectives, Generals and Broken armies from the table', () => {
    const gen1 = mk('p1', 40, 44, { hero: true, general: true, maxWounds: 3, wounds: 3 });
    const gen2 = mk('p2', 40, 4, { hero: true, general: true, maxWounds: 3, wounds: 1 });
    const p2 = [gen2, ...Array.from({ length: 5 }, (_, i) => mk('p2', 5 + i, 2, { dead: i < 3 }))];
    const s = game('domination', [gen1, mk('p1', 24, 22.5), mk('p1', 25.5, 22.5), mk('p2', 24, 25.6), ...p2], [[24, 24]]);
    const lines = scoreLines(s);
    expect(lines.every(l => l.auto)).toBe(true);
    // Centre objective: two of player 1's models against one of player 2's is double.
    expect(lines[0].vp).toEqual({ p1: 2, p2: 0 });
    // Player 2's General is wounded.
    expect(lines[1].vp).toEqual({ p1: 1, p2: 0 });
    // Player 2 lost 3 of 7, not yet Broken.
    expect(lines[2].vp).toEqual({ p1: 0, p2: 0 });
    expect(vpTotals(s)).toEqual({ p1: 3, p2: 0 });
  });

  it('works out every line of every scenario', () => {
    for (const sc of SCENARIOS) expect(scoreLines(game(sc.id, [mk('p1', 10, 40), mk('p2', 10, 8)])).filter(l => !l.auto).map(l => `${sc.id}: ${l.label}`)).toEqual([]);
  });

  it('holds objectives in Capture and Control until the other side touches them', () => {
    const a = mk('p1', 24, 24 + 0.8 + 0.49);
    let s = game('capture-and-control', [a, mk('p2', 10, 4)], [[24, 24]]);
    s = reduce(s, { type: 'setPhase', phase: 'end' });
    expect(s.flow.control?.o0).toBe('p1');
    // Walking away keeps it.
    s = reduce(s, { type: 'setPhase', phase: 'move', turn: 2 });
    s = reduce(s, { type: 'moveModels', moves: [{ id: a.id, x: 24, y: 28 }] });
    s = reduce(s, { type: 'setPhase', phase: 'end', turn: 2 });
    expect(s.flow.control?.o0).toBe('p1');
    expect(scoreLines(s)[0].vp.p1).toBe(3);
  });

  it('decides the winner on the scored points once the game is over', () => {
    const p2 = Array.from({ length: 8 }, (_, i) => mk('p2', 5 + i * 2, 4, { dead: i < 7 }));
    let s = game('to-the-death', [mk('p1', 10, 44, { hero: true, general: true }), mk('p1', 12, 44), ...p2]);
    s = reduce(s, { type: 'setPhase', phase: 'end' });
    expect(gameWinner(s)).toBe('p1');
  });
});
