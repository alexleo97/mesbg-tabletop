import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Action, GameState, Seat, ServerMessage } from '../src/shared/types.ts';
import { joinRoom, startServer, type TestServer } from './harness.ts';

let server: TestServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesbg-deploy-'));
  server = await startServer({ DATA_DIR: dir, DIST_DIR: dir, MAX_SOCKETS_PER_ADDRESS: '6', MAX_NEW_ROOMS_PER_ADDRESS: '40' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

type Browser = Awaited<ReturnType<typeof joinRoom>>;
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function stateOf(b: Browser): Promise<GameState> {
  b.got.length = 0;
  b.send({ type: 'sync' });
  return ((await b.next(m => m.type === 'snapshot')) as Extract<ServerMessage, { type: 'snapshot' }>).state;
}

const model = (id: string, owner: Seat, warband: string, hero: boolean, x: number, y: number) => ({ id, owner, name: id, x, y, wounds: 1, maxWounds: 1, hero, warband, base: { shape: 'round', w: 25, h: 25 } });

describe('setting up in turn through the server', () => {
  it("won't start the battle until both sides have set up in turn, and each only on their own turn", async () => {
    const p1 = await joinRoom(server.port, 'deploy-turns');
    const p2 = await joinRoom(server.port, 'deploy-turns');
    p1.send({ type: 'hello', role: 'p1' });
    p2.send({ type: 'hello', role: 'p2' });
    await p1.next(m => m.type === 'presence' && m.players.includes('p1') && m.players.includes('p2'));
    const act = (b: Browser, action: Action) => b.send({ type: 'action', action });
    act(p1, { type: 'setScenario', id: 'to-the-death' });
    act(p1, { type: 'addModels', models: [model('a', 'p1', 'x', true, 20, 44), model('a1', 'p1', 'x', false, 22, 44)] as never });
    act(p2, { type: 'addModels', models: [model('b', 'p2', 'y', true, 20, 4), model('b1', 'p2', 'y', false, 22, 4)] as never });
    await p1.next(m => m.type === 'action' && m.action.type === 'addModels' && m.action.models[0]?.id === 'b');
    // Too soon.
    act(p1, { type: 'startGame' });
    act(p1, { type: 'rollDeploy' });
    await p1.next(m => m.type === 'action' && m.action.type === 'deployRolled');
    let s = await stateOf(p1);
    expect(s.flow.started).toBe(false);
    expect(s.log.some(r => r.label === 'Roll-off for deployment')).toBe(true);
    const winner = s.flow.deploy!.winner!;
    const [w, l] = winner === 'p1' ? [p1, p2] : [p2, p1];
    const loser: Seat = winner === 'p1' ? 'p2' : 'p1';
    // The loser can't choose, nor claim the winner's choice.
    act(l, { type: 'pickSide', seat: winner, far: true });
    act(w, { type: 'pickSide', seat: winner, far: false });
    await w.next(m => m.type === 'action' && m.action.type === 'pickSide');
    act(l, { type: 'deployWarband', seat: loser, warband: loser === 'p1' ? 'x' : 'y' });
    act(w, { type: 'deployWarband', seat: winner, warband: winner === 'p1' ? 'x' : 'y' });
    await w.next(m => m.type === 'action' && m.action.type === 'warbandDown');
    s = await stateOf(p1);
    expect(s.flow.deploy).toMatchObject({ step: 'warbands', turn: winner, current: `${winner}:${winner === 'p1' ? 'x' : 'y'}` });
    // The other player can't move the warband being placed.
    const theirs = winner === 'p1' ? 'a' : 'b';
    act(l, { type: 'moveModels', moves: [{ id: theirs, x: 24, y: winner === 'p1' ? 40 : 8 }] });
    act(w, { type: 'warbandDone', seat: winner });
    await w.next(m => m.type === 'action' && m.action.type === 'warbandDone');
    expect((await stateOf(p1)).models[theirs]).toMatchObject({ x: s.models[theirs].x, y: s.models[theirs].y });
    act(l, { type: 'deployWarband', seat: loser, warband: loser === 'p1' ? 'x' : 'y' });
    await l.next(m => m.type === 'action' && m.action.type === 'warbandDown');
    act(l, { type: 'warbandDone', seat: loser });
    await l.next(m => m.type === 'action' && m.action.type === 'warbandDone');
    s = await stateOf(p1);
    expect(s.flow.deploy?.step).toBe('done');
    expect(Object.values(s.models).every(m => !m.waiting)).toBe(true);
    act(p1, { type: 'startGame' });
    await p1.next(m => m.type === 'action' && m.action.type === 'startGame');
    expect((await stateOf(p2)).flow.started).toBe(true);
    p1.ws.close();
    p2.ws.close();
  }, 30_000);

  it('lets the Palantír take its own turns at setting up', async () => {
    const p1 = await joinRoom(server.port, 'deploy-bot');
    p1.send({ type: 'hello', role: 'p1' });
    await p1.next(m => m.type === 'presence' && m.players.includes('p1'));
    const act = (action: Action) => p1.send({ type: 'action', action });
    act({ type: 'setBot', seat: 'p2' });
    act({ type: 'setBotSpeed', speed: 'instant' });
    act({ type: 'setScenario', id: 'domination' });
    act({ type: 'addTerrain', terrain: { id: 'centre', kind: 'objective', shape: 'circle', x: 24, y: 24, w: 1.6, h: 1.6, rot: 0, locked: false } });
    act({ type: 'addModels', models: [model('a', 'p1', 'x', true, 20, 44), model('a1', 'p1', 'x', false, 22, 44), model('b', 'p2', 'y', true, 20, 4), model('b1', 'p2', 'y', false, 22, 4)] as never });
    await p1.next(m => m.type === 'action' && m.action.type === 'addModels');
    // Whoever wins, every marker and warband ends up down, the Palantír's by itself.
    const deadline = Date.now() + 20_000;
    let s = await stateOf(p1);
    while (s.flow.deploy?.step !== 'done' && Date.now() < deadline) {
      const d = s.flow.deploy;
      if (!d || d.step === 'roll') act({ type: 'rollDeploy' });
      else if (d.step === 'markers' && d.turn === 'p1') act(d.marker ? { type: 'markerDone', seat: 'p1' } : { type: 'placeMarker', seat: 'p1' });
      else if (d.step === 'side' && d.winner === 'p1') act({ type: 'pickSide', seat: 'p1', far: false });
      else if (d.step === 'warbands' && d.turn === 'p1') act(d.current ? { type: 'warbandDone', seat: 'p1' } : { type: 'deployWarband', seat: 'p1', warband: 'x' });
      await pause(250);
      s = await stateOf(p1);
    }
    expect(s.flow.deploy?.step).toBe('done');
    expect(Object.values(s.terrain).filter(t => t.kind === 'objective')).toHaveLength(5);
    expect(s.flow.deploy?.placed.sort()).toEqual(['p1:x', 'p2:y']);
    p1.ws.close();
  }, 30_000);
});
