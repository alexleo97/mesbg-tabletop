import { describe, expect, it } from 'vitest';
import { markerActions } from '../src/shared/objects.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { scenarioById, scenarioMarkers } from '../src/shared/scenarios.ts';
import { scoreLines } from '../src/shared/scoring.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

let n = 0;
const mk = (owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id: `m${n++}`, owner, name: 'Warrior', x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});

/** A started game of the scenario with its markers laid out (ids t0, t1, ...). */
function game(scenario: string, models: Model[], rand = () => 0): GameState {
  let s = reduce(initialState(), { type: 'setScenario', id: scenario });
  s = reduce(s, { type: 'addModels', models });
  let i = 0;
  for (const t of scenarioMarkers(scenarioById(scenario)!, 48, 48, () => `t${i++}`, rand)) s = reduce(s, { type: 'addTerrain', terrain: t });
  return reduce(s, { type: 'startGame' });
}
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const line = (s: GameState, i: number) => scoreLines(s)[i].vp;
/** Puts a model in base contact with a marker. */
const at = (s: GameState, id: string, t: string) => run(s, { type: 'moveModels', moves: [{ id, x: s.terrain[t].x, y: s.terrain[t].y + 0.8 + 0.49 }] });

describe('scenario markers', () => {
  it('carries a Relic, which follows its carrier and leaves with it', () => {
    const a = mk('p1', 30, 20);
    let s = game('retrieval', [a, mk('p2', 40, 4)]);
    expect(s.terrain.t1).toMatchObject({ object: 'relic', side: 'p2' });
    expect(line(s, 0)).toEqual({ p1: 0, p2: 0 });
    s = at(s, a.id, 't1');
    // You can't pick up your own Relic before the enemy has.
    expect(markerActions(s, s.models[a.id]).map(x => x.kind)).toEqual(['pickUp']);
    s = run(s, { type: 'pickUp', model: a.id, marker: 't1' });
    expect(line(s, 0).p1).toBe(6);
    s = run(s, { type: 'moveModels', moves: [{ id: a.id, x: 5, y: 40 }] });
    expect(s.terrain.t1.x).toBeCloseTo(5 + 0.49 * 0.7, 1);
    expect(line(s, 0).p1).toBe(9);
    s = run(s, { type: 'moveModels', moves: [{ id: a.id, x: 0.5, y: 40 }] }, { type: 'escape', model: a.id });
    expect(s.terrain.t1).toMatchObject({ gone: 'off', by: 'p1' });
    expect(line(s, 0).p1).toBe(12);
  });

  it('drops a carried marker where its carrier falls', () => {
    const a = mk('p1', 30, 20);
    let s = at(game('retrieval', [a, mk('p2', 40, 4)]), a.id, 't1');
    s = run(s, { type: 'pickUp', model: a.id, marker: 't1' }, { type: 'wound', id: a.id, count: 1 });
    expect(s.terrain.t1.carrier).toBeUndefined();
    // Moved from its start still scores.
    expect(line(s, 0).p1).toBe(3);
  });

  it('digs up an Artefact with an Intelligence test, once per side each turn', () => {
    const a = mk('p1', 24, 30);
    let s = at(game('treasure-hoard', [a, mk('p2', 40, 4)]), a.id, 't1');
    const ask: Action = { type: 'uncover', model: a.id, marker: 't1', intelligence: 7 };
    const fail = resolveRequest(s, 'p1', ask, () => 2, () => 'x')!;
    s = run(s, ...fail.apply);
    expect(s.terrain.t1.hidden).toBe(true);
    expect(resolveRequest(s, 'p1', ask, () => 6, () => 'y')).toBeNull();
    s = run(s, { type: 'setPhase', phase: 'priority', turn: 2 });
    s = run(s, ...resolveRequest(s, 'p1', ask, () => 4, () => 'z')!.apply);
    expect(s.terrain.t1).toMatchObject({ carrier: a.id });
    expect(line(s, 0).p1).toBe(2);
  });

  it('finds the Heirloom among decoys', () => {
    const a = mk('p1', 24, 40);
    let s = game('heirloom-of-ages-past', [a, mk('p2', 40, 4)]);
    // rand 0 makes the first marker the real one.
    s = at(s, a.id, 't3');
    s = run(s, { type: 'flip', model: a.id, marker: 't3' });
    expect(s.terrain.t3).toMatchObject({ gone: 'revealed', by: 'p1' });
    expect(line(s, 1).p1).toBe(1);
    s = at(s, a.id, 't0');
    s = run(s, { type: 'flip', model: a.id, marker: 't0' });
    expect(s.terrain.t0.carrier).toBe(a.id);
    expect(line(s, 0).p1).toBe(8);
    // Heirlooms can't be dropped.
    expect(run(s, { type: 'drop', marker: 't0' }).terrain.t0.carrier).toBe(a.id);
  });

  it('destroys Supplies touched by an enemy in the End phase', () => {
    const b = mk('p2', 12, 36 - 1.29);
    let s = game('destroy-the-supplies', [mk('p1', 40, 44), b]);
    s = run(s, { type: 'setPhase', phase: 'end' });
    expect(s.terrain.t0).toMatchObject({ gone: 'destroyed', by: 'p2' });
    expect(line(s, 0).p2).toBe(3);
    expect(line(s, 2).p2).toBe(1);
  });

  it('rescues a Wounded Ally carried into a Sanctuary', () => {
    const a = mk('p1', 12, 37.3);
    let s = game('escort-the-wounded', [a, mk('p2', 40, 4)]);
    s = run(s, { type: 'pickUp', model: a.id, marker: 't0' }, { type: 'moveModels', moves: [{ id: a.id, x: 20, y: 20 }] });
    expect(line(s, 0).p1).toBe(2);
    s = run(s, { type: 'moveModels', moves: [{ id: a.id, x: 3, y: 3 }] }, { type: 'setPhase', phase: 'end' });
    expect(s.terrain.t0).toMatchObject({ gone: 'rescued' });
    expect(line(s, 0).p1).toBe(4);
  });

  it('counts models that leave by the enemy edge in Reconnoitre', () => {
    const hero = mk('p1', 10, 0.6, { hero: true });
    let s = game('reconnoitre', [hero, mk('p1', 20, 0.6), mk('p2', 40, 4)]);
    s = run(s, { type: 'escape', model: hero.id });
    expect(s.models[hero.id].escaped).toBe(true);
    expect(line(s, 0).p1).toBe(4);
    expect(line(s, 1).p1).toBe(1);
  });
});

describe('secret picks and kills', () => {
  it('scores the Assassination target by who wounded and slew it', () => {
    const assassin = mk('p1', 10, 40, { hero: true });
    const target = mk('p2', 10, 8, { hero: true, maxWounds: 2, wounds: 2 });
    let s = game('assassination', [assassin, mk('p1', 12, 40, { hero: true, general: true }), target, mk('p2', 14, 8, { hero: true, general: true })]);
    s = run(s, { type: 'setPick', seat: 'p1', key: 'target', value: target.id }, { type: 'setPick', seat: 'p1', key: 'assassin', value: assassin.id });
    expect(line(s, 3).p1).toBe(1);
    s = run(s, { type: 'wound', id: target.id, count: 1, by: ['nobody'], how: 'shoot' });
    expect(line(s, 0).p1).toBe(3);
    s = run(s, { type: 'wound', id: target.id, count: 1, by: [assassin.id], how: 'fight' });
    expect(s.models[target.id].killedBy).toEqual({ ids: [assassin.id], how: 'fight' });
    expect(line(s, 0).p1).toBe(12);
  });

  it('counts Champion kills in combat only', () => {
    const c1 = mk('p1', 10, 40, { hero: true, general: true });
    const c2 = mk('p2', 10, 8, { hero: true, general: true });
    const foes = [0, 1, 2].map(i => mk('p2', 20 + i, 8));
    let s = game('contest-of-champions', [c1, c2, ...foes]);
    s = run(s, ...foes.slice(0, 2).map(f => ({ type: 'wound' as const, id: f.id, count: 1, by: [c1.id], how: 'fight' as const })));
    s = run(s, { type: 'wound', id: foes[2].id, count: 1, by: [c1.id], how: 'shoot' });
    expect(line(s, 0).p1).toBe(8);
    s = run(s, { type: 'wound', id: c2.id, count: 1, by: [c1.id], how: 'fight' });
    expect(line(s, 0).p1).toBe(12);
    expect(line(s, 1).p1).toBe(2);
  });

  it('keeps picks made before the game starts', () => {
    const h = mk('p1', 10, 40, { hero: true });
    let s = run(initialState(), { type: 'setScenario', id: 'fog-of-war' }, { type: 'addModels', models: [h] }, { type: 'setPick', seat: 'p1', key: 'protect', value: h.id });
    s = run(s, { type: 'startGame' });
    expect(s.flow.picks?.p1.protect).toBe(h.id);
    expect(line(s, 0).p1).toBe(5);
  });
});
