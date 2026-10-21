import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botPause, botStep, newMemo } from '../src/shared/bot.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, ServerMessage } from '../src/shared/types.ts';
import { catalog, play, seeded, setup } from './botsim.ts';
import { joinRoom, startServer, type TestServer } from './harness.ts';

describe('Instant moves against the Palantír', () => {
  it('is off unless turned on, and only true turns it on', () => {
    const s = reduce(initialState(), { type: 'setBotInstantMoves', on: true });
    expect(initialState().botInstantMoves).toBeUndefined();
    expect(s.botInstantMoves).toBe(true);
    expect(reduce(s, { type: 'setBotInstantMoves', on: false }).botInstantMoves).toBeUndefined();
    expect(reduce(initialState(), { type: 'setBotInstantMoves', on: 'yes' as never }).botInstantMoves).toBeUndefined();
    expect(reduce(initialState(), { type: 'loadState', state: s } as Action).botInstantMoves).toBe(true);
  });

  it('drops the pause after a move only, keeping every other pause at the chosen speed', () => {
    const on = reduce(initialState(), { type: 'setBotInstantMoves', on: true });
    const move = { action: { type: 'moveModels', moves: [{ id: 'a', x: 1, y: 1 }] } as Action, delay: 450 };
    const roll = { action: { type: 'roll', count: 1 } as Action, delay: 1100 };
    expect(botPause(initialState(), move)).toBe(450);
    expect(botPause(on, move)).toBe(0);
    expect(botPause(on, { ...move, action: { type: 'pushTower', id: 't', seat: 'p2', x: 1, y: 1 } as Action })).toBe(0);
    expect(botPause(on, roll)).toBe(1100);
    expect(botPause(on, { delay: 700 })).toBe(700);
    expect(botPause(reduce(on, { type: 'setBotSpeed', speed: 'fast' }), roll)).toBeCloseTo(385);
  });

  it('leaves where every model ends up exactly as at normal speed', () => {
    for (const seed of [4]) {
      const game = (instant: boolean) => {
        const rand = seeded(seed);
        let s: GameState = setup(['Minas Tirith', 'Legions of Mordor'], 300, null, rand);
        if (instant) s = reduce(s, { type: 'setBotInstantMoves', on: true });
        return play(s, rand, 4000).state;
      };
      const normal = game(false);
      const instant = game(true);
      const where = (s: GameState) => Object.values(s.models).map(m => [m.id, m.x, m.y, m.rot, m.dead ?? false, m.wounds]);
      expect(where(instant)).toEqual(where(normal));
      expect(instant.log.map(r => r.dice)).toEqual(normal.log.map(r => r.dice));
      expect(normal.turn).toBeGreaterThan(1);
    }
  }, 60_000);

  it("doesn't change what the computer decides to do", () => {
    const rand = seeded(9);
    const s = setup(['Minas Tirith', 'Legions of Mordor'], 300, null, rand);
    const on = reduce(s, { type: 'setBotInstantMoves', on: true });
    expect(botStep(on, 'p2', catalog, newMemo(), 5000)).toEqual(botStep(s, 'p2', catalog, newMemo(), 5000));
  });
});

let server: TestServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesbg-instant-'));
  server = await startServer({ DATA_DIR: dir, DIST_DIR: dir, MAX_SOCKETS_PER_ADDRESS: '6', MAX_NEW_ROOMS_PER_ADDRESS: '40' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

describe('Instant moves on the server', () => {
  it('only a player in a seat can turn it on', async () => {
    const p1 = await joinRoom(server.port, 'instant-seat');
    const watcher = await joinRoom(server.port, 'instant-seat');
    p1.send({ type: 'hello', role: 'p1' });
    watcher.send({ type: 'hello', role: 'spectator' });
    await p1.next(m => m.type === 'presence' && m.players.includes('p1'));
    watcher.send({ type: 'action', action: { type: 'setBotInstantMoves', on: true } });
    await pause(200);
    expect(p1.got.some(m => m.type === 'action' && m.action.type === 'setBotInstantMoves')).toBe(false);
    p1.send({ type: 'action', action: { type: 'setBotInstantMoves', on: true } });
    await p1.next(m => m.type === 'action' && m.action.type === 'setBotInstantMoves');
    p1.ws.close();
    watcher.ws.close();
  });

  it("sends the Palantír's moves out together, so the table updates once rather than once per model", async () => {
    const p1 = await joinRoom(server.port, 'instant-bot');
    const snapshot = async () => {
      p1.got.length = 0;
      p1.send({ type: 'sync' });
      return (await p1.next(m => m.type === 'snapshot')) as Extract<ServerMessage, { type: 'snapshot' }>;
    };
    p1.send({ type: 'hello', role: 'p1' });
    await p1.next(m => m.type === 'presence' && m.players.includes('p1'));
    p1.send({ type: 'action', action: { type: 'setBot', seat: 'p2' } });
    await p1.next(m => m.type === 'action' && m.action.type === 'setBot');
    const base = { shape: 'round', w: 25, h: 25 };
    const orcs = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, owner: 'p2', name: 'Mordor Orc Warrior', x: 4 + i * 3.5, y: 30, rot: 0, base, move: 6, wounds: 1, maxWounds: 1, points: 8, profileId: '[army-of-gothmog] mordor-orc-warrior' }));
    p1.send({ type: 'action', action: { type: 'addModels', models: [{ id: 'a1', owner: 'p1', name: 'Warrior of Minas Tirith', x: 24, y: 16, rot: 180, base, move: 6, wounds: 1, maxWounds: 1, points: 8, profileId: '[minas-tirith] warrior-of-minas-tirith' }, ...orcs] } });
    p1.send({ type: 'action', action: { type: 'setBotInstantMoves', on: true } });
    await p1.next(m => m.type === 'action' && m.action.type === 'setBotInstantMoves');
    // What a browser holds: the game as it was, with every change since applied as it arrives.
    const start = await snapshot();
    let mirror = start.state;
    let seq = start.seq ?? 0;
    const moveMessages: number[] = [];
    const moved = new Set<string>();
    let ended = false;
    p1.ws.on('message', d => {
      const m = JSON.parse(String(d)) as ServerMessage;
      if (m.type !== 'action' && m.type !== 'actions') return;
      const actions = m.type === 'actions' ? m.actions : [m.action];
      if (m.seq !== undefined && m.seq <= seq) return;
      expect(m.seq).toBe(seq + 1);
      seq += actions.length;
      for (const a of actions) mirror = reduce(mirror, a);
      const ours = actions.flatMap(a => (a.type === 'moveModels' ? a.moves.filter(mv => mv.id.startsWith('o')) : []));
      if (ours.length) moveMessages.push(ours.length);
      for (const mv of ours) moved.add(mv.id);
      for (const a of actions) {
        if (a.type === 'choosePriority' && a.seat === 'p1') p1.send({ type: 'action', action: { type: 'endActivation', seat: 'p1' } });
        if (a.type === 'endActivation' && a.seat === 'p2') ended = true;
      }
    });
    p1.send({ type: 'action', action: { type: 'startGame' } });
    p1.send({ type: 'action', action: { type: 'rollPriority' } });
    // The Palantír chooses (or you choose for it): either way, let it move.
    for (let i = 0; i < 100 && !ended; i++) {
      const st = (await snapshot()).state;
      if (st.flow.chooser === 'p1' && !st.priority) p1.send({ type: 'action', action: { type: 'choosePriority', seat: 'p2' } });
      if (st.phase !== 'move' && st.turn > 1) break;
      await pause(100);
    }
    expect(moved.size).toBeGreaterThanOrEqual(8);
    // At normal pace that is a message, and a redraw, for every model; here it is a handful at most.
    expect(moveMessages.length).toBeLessThanOrEqual(3);
    // And the table a browser builds from those messages is the server's, model for model.
    const end = (await snapshot()).state;
    for (const id of Object.keys(end.models)) expect([mirror.models[id].x, mirror.models[id].y]).toEqual([end.models[id].x, end.models[id].y]);
    p1.ws.close();
  }, 20_000);
});
