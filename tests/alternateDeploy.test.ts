import { describe, expect, it } from 'vitest';
import { botStep, newMemo } from '../src/shared/bot.ts';
import { bandKey, bandsOf, captainOf, deployProblems, deployReady, deployZones, PROCEDURES, rollDue } from '../src/shared/deploy.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { whollyIn, zonesOf } from '../src/shared/objects.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { DICE_REQUESTS, resolveRequest } from '../src/shared/resolve.ts';
import { objectivesMissing, scenarioById, scenarioMarkers, SCENARIOS } from '../src/shared/scenarios.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const mk = (id: string, owner: Seat, warband: string, hero = false, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x: 24, y: owner === 'p1' ? 44 : 4, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero, dead: false, warband, ...(hero ? { tier: 3 } : {}), ...extra,
});
/** Two warbands a side: a hero with five warriors, and a hero with three. */
const army = (seat: Seat) => [
  mk(`${seat}-a`, seat, 'a', true), ...[1, 2, 3, 4, 5].map(i => mk(`${seat}-a${i}`, seat, 'a')),
  mk(`${seat}-b`, seat, 'b', true), ...[1, 2, 3].map(i => mk(`${seat}-b${i}`, seat, 'b')),
];

/** Dice that come up as listed, then 4s. */
const dice = (...xs: number[]) => () => xs.shift() ?? 4;
let n = 0;
const uid = () => `u${n++}`;

/** Applies an action as the server would: a request is rolled for, then its results applied. */
function act(state: GameState, seat: Seat, action: Action, d6 = dice()): GameState {
  if (!DICE_REQUESTS.has(action.type)) return reduce(state, action);
  const out = resolveRequest(state, seat, action, d6, uid, 1, catalog);
  return out ? [...out.apply, ...(out.record ? [out.record] : [])].reduce(reduce, state) : state;
}

function table(scenario: string, models: Model[] = [...army('p1'), ...army('p2')]): GameState {
  let s = reduce(initialState(), { type: 'setScenario', id: scenario });
  for (const t of scenarioMarkers(scenarioById(scenario)!, 48, 48, p => `${p}${n++}`, Math.random, !PROCEDURES[scenario]?.markers)) s = reduce(s, { type: 'addTerrain', terrain: t });
  return reduce(s, { type: 'addModels', models });
}

/** Plays out the whole set-up with the computer on both sides. */
function botsSetUp(state: GameState, d6 = () => 1 + Math.floor(Math.random() * 6)): GameState {
  let s = act(state, 'p1', { type: 'rollDeploy' }, d6);
  const memo = { p1: newMemo(), p2: newMemo() };
  for (let i = 0; i < 400 && !deployReady(s); i++) {
    if (rollDue(s)) s = act(s, 'p1', { type: 'rollDeploy' }, d6);
    const seat = s.flow.deploy?.turn ?? s.flow.deploy?.winner ?? 'p1';
    const step = botStep(s, seat, catalog, memo[seat], 0, false);
    if (!step?.action) throw new Error(`stuck at ${JSON.stringify(s.flow.deploy)}`);
    s = act(s, seat, step.action, d6);
  }
  return s;
}

describe('setting up in turn', () => {
  it('rolls off, lets the winner pick a side, then alternates warbands, winner first', () => {
    let s = table('breakthrough');
    expect(deployReady(s)).toBe(false);
    // Player 2 wins the roll-off (after a tie, rolled again).
    s = act(s, 'p1', { type: 'rollDeploy' }, dice(3, 3, 2, 5));
    expect(s.log.filter(r => r.label === 'Roll-off for deployment').map(r => r.dice)).toEqual([[3, 3], [2, 5]]);
    expect(s.flow.deploy).toMatchObject({ step: 'side', winner: 'p2' });
    // Every model waits off the table for its warband's turn.
    expect(Object.values(s.models).every(m => m.waiting)).toBe(true);
    // Only the winner chooses.
    expect(reduce(s, { type: 'pickSide', seat: 'p1', far: false }).flow.deploy?.step).toBe('side');
    s = reduce(s, { type: 'pickSide', seat: 'p2', far: false });
    expect(s.flow.deploy).toMatchObject({ step: 'warbands', turn: 'p2' });
    // Not player 1's turn.
    expect(act(s, 'p1', { type: 'deployWarband', seat: 'p1', warband: 'a' })).toBe(s);
    s = act(s, 'p2', { type: 'deployWarband', seat: 'p2', warband: 'a' });
    const band = Object.values(s.models).filter(m => bandKey(m) === 'p2:a');
    expect(band.every(m => !m.waiting && whollyIn(zonesOf(s, 'p2'), m))).toBe(true);
    const cap = captainOf(s, band)!;
    expect(cap.id).toBe('p2-a');
    expect(band.every(m => distanceBetween(m, cap) <= 6)).toBe(true);
    // Only the warband being placed moves; the other side's models can't be touched.
    const spot = { x: cap.x, y: cap.y - 5 };
    const moved = reduce(s, { type: 'moveModels', moves: [{ id: 'p2-a1', ...spot }, { id: 'p2-b1', x: 30, y: 8 }] });
    expect(moved.models['p2-a1']).toMatchObject(spot);
    expect(moved.models['p2-b1']).toEqual(s.models['p2-b1']);
    s = reduce(s, { type: 'warbandDone', seat: 'p2' });
    expect(s.flow.deploy).toMatchObject({ turn: 'p1', placed: ['p2:a'] });
    // Once down, a warband stays put.
    expect(reduce(s, { type: 'moveModels', moves: [{ id: 'p2-a1', x: 20, y: 6 }] }).models['p2-a1'].x).toBe(s.models['p2-a1'].x);
    for (const [seat, wb] of [['p1', 'a'], ['p2', 'b'], ['p1', 'b']] as const) {
      expect(deployReady(s)).toBe(false);
      s = act(s, seat, { type: 'deployWarband', seat, warband: wb });
      s = reduce(s, { type: 'warbandDone', seat });
    }
    expect(s.flow.deploy).toMatchObject({ step: 'done', placed: ['p2:a', 'p1:a', 'p2:b', 'p1:b'] });
    expect(deployReady(s)).toBe(true);
    expect(Object.values(s.models).every(m => !m.waiting)).toBe(true);
  });

  it('keeps every model within 6" of its Captain, pulling the warband along when the Captain is dragged off', () => {
    let s = act(table('stake-a-claim'), 'p1', { type: 'rollDeploy' }, dice(6, 1));
    s = reduce(s, { type: 'pickSide', seat: 'p1', far: false });
    s = act(s, 'p1', { type: 'deployWarband', seat: 'p1', warband: 'a' });
    // A warrior dragged far from its Captain stops within 6" of it.
    s = reduce(s, { type: 'moveModels', moves: [{ id: 'p1-a1', x: 2, y: 46 }] });
    expect(distanceBetween(s.models['p1-a1'], s.models['p1-a'])).toBeLessThanOrEqual(6.01);
    // The Captain dragged across the zone brings the others with it.
    s = reduce(s, { type: 'moveModels', moves: [{ id: 'p1-a', x: 44, y: 42 }] });
    expect(s.models['p1-a'].x).toBeCloseTo(44, 0);
    for (const id of ['p1-a1', 'p1-a2', 'p1-a3', 'p1-a4', 'p1-a5']) expect(distanceBetween(s.models[id], s.models['p1-a'])).toBeLessThanOrEqual(6.01);
    expect(deployProblems(s)).toEqual([]);
  });

  it('rolls a D6 per warband in Capture and Control: on a 1-3 it stays within 12" of the centre line, never within 1" of the enemy', () => {
    let s = act(table('capture-and-control'), 'p1', { type: 'rollDeploy' }, dice(6, 1));
    s = reduce(s, { type: 'pickSide', seat: 'p1', far: false });
    s = act(s, 'p1', { type: 'deployWarband', seat: 'p1', warband: 'a' }, dice(2));
    expect(s.log.at(-1)).toMatchObject({ dice: [2], note: expect.stringContaining('centre line') });
    expect(s.flow.deploy?.roll).toBe(2);
    for (const m of Object.values(s.models).filter(m => bandKey(m) === 'p1:a')) expect(m.y + 0.5).toBeLessThanOrEqual(36.01);
    // Dragged back towards its own edge, it stops at the line.
    s = reduce(s, { type: 'moveModels', moves: [{ id: 'p1-a', x: 24, y: 45 }] });
    expect(s.models['p1-a'].y).toBeLessThan(36);
    s = reduce(s, { type: 'warbandDone', seat: 'p1' });
    s = act(s, 'p2', { type: 'deployWarband', seat: 'p2', warband: 'a' }, dice(5));
    // A 4-6: anywhere in its half. Dragged right up to the centre line, opposite the enemy, it keeps 1" off them.
    const foe = s.models['p1-a'];
    s = reduce(s, { type: 'moveModels', moves: [{ id: 'p2-a', x: foe.x, y: foe.y - 1 }] });
    for (const m of Object.values(s.models).filter(m => m.owner === 'p2' && !m.waiting)) for (const e of Object.values(s.models).filter(m => m.owner === 'p1' && !m.waiting)) expect(distanceBetween(m, e)).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('turns the table round when the winner takes the far side, so the terrain is theirs', () => {
    let s = table('destroy-the-supplies');
    s = reduce(s, { type: 'addTerrain', terrain: { id: 'wood', kind: 'wood', shape: 'rect', x: 10, y: 40, w: 6, h: 4, rot: 30, locked: true } });
    s = act(s, 'p1', { type: 'rollDeploy' }, dice(1, 6));
    const supply = Object.values(s.terrain).find(t => t.object === 'supply' && t.side === 'p1')!;
    s = reduce(s, { type: 'pickSide', seat: 'p2', far: true });
    expect(s.terrain.wood).toMatchObject({ x: 38, y: 8, rot: 210 });
    // Each side's supplies stay on its own side of the table.
    expect(s.terrain[supply.id]).toMatchObject({ x: 48 - supply.x, y: 48 - supply.y, side: 'p2' });
    expect(s.flow.deploy).toMatchObject({ step: 'warbands', turn: 'p2' });
  });

  it('mirrors the table for a pair of corners, and gives the narrative sides their turns in the book order', () => {
    let s = table('divide-and-conquer');
    s = reduce(s, { type: 'addTerrain', terrain: { id: 'rock', kind: 'rock', shape: 'rect', x: 6, y: 30, w: 2, h: 2, rot: 30, locked: true } });
    s = act(s, 'p1', { type: 'rollDeploy' }, dice(6, 1));
    s = reduce(s, { type: 'pickSide', seat: 'p1', far: true });
    expect(s.terrain.rock).toMatchObject({ x: 42, y: 30, rot: 330 });
  });

  it('alternates the objective markers in Domination: the winner places the second, each 12" apart and 6" from the edges', () => {
    let s = table('domination');
    expect(objectivesMissing(s)).toBe(4);
    s = act(s, 'p1', { type: 'rollDeploy' }, dice(2, 5));
    expect(s.log.at(-1)?.label).toBe('Roll-off to place the objectives');
    expect(s.flow.deploy).toMatchObject({ step: 'markers', turn: 'p2' });
    expect(reduce(s, { type: 'placeMarker', seat: 'p1' })).toBe(s);
    // Asked for a spot too near the centre marker, it goes to the nearest one that's legal.
    s = reduce(s, { type: 'placeMarker', seat: 'p2', x: 24, y: 20 });
    const first = s.terrain[s.flow.deploy!.marker!];
    expect(Math.hypot(first.x - 24, first.y - 24) - 1.6).toBeGreaterThanOrEqual(12 - 1e-6);
    // Dragged to the edge, it keeps 6" off it.
    s = reduce(s, { type: 'updateTerrain', id: first.id, patch: { x: 2, y: 8 } });
    expect(s.terrain[first.id].x - 0.8).toBeGreaterThanOrEqual(6 - 1e-6);
    // The centre marker can't be moved meanwhile.
    const centre = Object.values(s.terrain).find(t => t.kind === 'objective' && t.id !== first.id)!;
    expect(reduce(s, { type: 'updateTerrain', id: centre.id, patch: { x: 20 } }).terrain[centre.id].x).toBe(centre.x);
    s = reduce(s, { type: 'markerDone', seat: 'p2' });
    expect(s.flow.deploy?.turn).toBe('p1');
    for (const seat of ['p1', 'p2', 'p1'] as const) {
      s = reduce(s, { type: 'placeMarker', seat });
      s = reduce(s, { type: 'markerDone', seat });
    }
    expect(objectivesMissing(s)).toBe(0);
    const marks = Object.values(s.terrain).filter(t => t.kind === 'objective');
    for (const a of marks) for (const b of marks) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y) - 1.6).toBeGreaterThanOrEqual(12 - 1e-6);
    // Then the roll-off for deployment.
    expect(s.flow.deploy?.step).toBe('roll');
    expect(rollDue(s)).toBe('side');
  });
});

describe('the computer sets up', () => {
  for (const sc of SCENARIOS.filter(x => PROCEDURES[x.id]?.armies !== 'none' || PROCEDURES[x.id]?.pick)) {
    it(`puts everything down sensibly in ${sc.name}`, () => {
      let s = table(sc.id);
      if (sc.id === 'contest-of-champions') {
        s = reduce(s, { type: 'setPick', seat: 'p1', key: 'champion', value: 'p1-b' });
        s = reduce(s, { type: 'setPick', seat: 'p2', key: 'champion', value: 'p2-a' });
      }
      s = botsSetUp(s);
      expect(deployReady(s)).toBe(true);
      expect(objectivesMissing(s)).toBe(0);
      if (PROCEDURES[sc.id].armies === 'none') return;
      for (const seat of ['p1', 'p2'] as const) {
        for (const band of bandsOf(s, seat)) {
          const cap = captainOf(s, band)!;
          for (const m of band) {
            expect(m.waiting, m.id).toBeFalsy();
            expect(whollyIn(zonesOf(s, seat), m), `${m.id} in ${sc.id}`).toBe(true);
            expect(distanceBetween(m, cap)).toBeLessThanOrEqual(6.01);
          }
        }
      }
      if (sc.id === 'contest-of-champions') {
        // The Champions went first, each within 3" of the centre.
        expect(s.flow.deploy!.placed.slice(0, 2).sort()).toEqual(['p1:b', 'p2:a']);
        for (const id of ['p1-b', 'p2-a']) expect(Math.hypot(s.models[id].x - 24, s.models[id].y - 24) - 0.5).toBeLessThanOrEqual(3.01);
      }
      if (sc.id === 'divide-and-conquer') {
        // Each side's first warband in its corner A, the second in corner B.
        for (const seat of ['p1', 'p2'] as const) {
          const order = s.flow.deploy!.placed.filter(k => k.startsWith(seat));
          const zones = zonesOf(s, seat);
          order.forEach((k, i) => expect(Object.values(s.models).filter(m => bandKey(m) === k).every(m => whollyIn([zones[i % 2]], m))).toBe(true));
        }
      }
      void deployZones;
    });
  }
});

describe('narrative scenarios', () => {
  it('sets each side up in the order the book gives, and only that side moves', () => {
    // Roast Mutton: the Trolls set up first, then the Company.
    let s = act(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' });
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p2' });
    expect(deployReady(s)).toBe(false);
    const bilbo = Object.values(s.models).find(m => m.cast === 'bilbo')!;
    const troll = Object.values(s.models).find(m => m.owner === 'p2' && !m.waiting)!;
    // Not the Company's turn yet.
    expect(reduce(s, { type: 'moveModels', moves: [{ id: bilbo.id, x: bilbo.x + 1, y: bilbo.y }] }).models[bilbo.id]).toEqual(bilbo);
    expect(reduce(s, { type: 'warbandDone', seat: 'p1' })).toBe(s);
    const nudged = reduce(s, { type: 'moveModels', moves: [{ id: troll.id, x: troll.x + 0.5, y: troll.y }] });
    expect(nudged.models[troll.id].x).not.toBe(troll.x);
    s = reduce(s, { type: 'warbandDone', seat: 'p2' });
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p1' });
    s = reduce(s, { type: 'warbandDone', seat: 'p1' });
    expect(deployReady(s)).toBe(true);
  });

  it('has the Good side set up first at Weathertop', () => {
    const s = act(initialState(), 'p2', { type: 'setNarrative', id: 'weathertop', good: 'p2' });
    expect(s.flow.deploy).toMatchObject({ step: 'sides', turn: 'p2' });
  });
});

describe('changing things mid set-up', () => {
  it('keeps a model added during deployment off the table for its turn', () => {
    let s = act(table('to-the-death'), 'p1', { type: 'rollDeploy' }, dice(6, 1));
    s = reduce(s, { type: 'pickSide', seat: 'p1', far: false });
    s = reduce(s, { type: 'addModels', models: [mk('late', 'p2', 'c', true)] });
    expect(s.models.late.waiting).toBe(true);
    expect(bandsOf(s, 'p2', true)).toHaveLength(3);
  });

  it('starts setting up afresh when the scenario changes', () => {
    let s = act(table('to-the-death'), 'p1', { type: 'rollDeploy' }, dice(6, 1));
    s = reduce(s, { type: 'setScenario', id: 'lords-of-battle' });
    expect(s.flow.deploy).toBeUndefined();
    expect(Object.values(s.models).some(m => m.waiting)).toBe(false);
  });

  it('needs both armies before the roll-off for deployment', () => {
    const s = table('to-the-death', army('p1'));
    expect(rollDue(s)).toBeNull();
    expect(act(s, 'p1', { type: 'rollDeploy' })).toBe(s);
  });
});
