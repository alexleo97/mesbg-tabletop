import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameState, ServerMessage } from '../src/shared/types.ts';
import { joinRoom, startServer, type TestServer } from './harness.ts';

let server: TestServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesbg-rules-'));
  server = await startServer({ DATA_DIR: dir, DIST_DIR: dir, MAX_SOCKETS_PER_ADDRESS: '6', MAX_NEW_ROOMS_PER_ADDRESS: '40' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

type Browser = Awaited<ReturnType<typeof joinRoom>>;
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** The game as a browser sees it: its snapshot with every action since applied in order. */
async function stateOf(b: Browser): Promise<GameState> {
  b.got.length = 0;
  b.send({ type: 'sync' });
  return ((await b.next(m => m.type === 'snapshot')) as Extract<ServerMessage, { type: 'snapshot' }>).state;
}

/** Two players with a model each, the battle started and Priority chosen, in the Move phase. */
async function battle(room: string) {
  const p1 = await joinRoom(server.port, room);
  const p2 = await joinRoom(server.port, room);
  p1.send({ type: 'hello', role: 'p1' });
  p2.send({ type: 'hello', role: 'p2' });
  await p1.next(m => m.type === 'presence' && m.players.includes('p1') && m.players.includes('p2'));
  p1.send({ type: 'action', action: { type: 'addModels', models: [{ id: 'a1', owner: 'p1', name: 'Aragorn', x: 5, y: 5, wounds: 3, maxWounds: 3 }] } });
  p2.send({ type: 'action', action: { type: 'addModels', models: [{ id: 'b1', owner: 'p2', name: 'Orc', x: 40, y: 40, wounds: 1, maxWounds: 1 }] } });
  p1.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Alex' } });
  p1.send({ type: 'action', action: { type: 'startGame' } });
  p1.send({ type: 'action', action: { type: 'rollPriority' } });
  const chooser = (await stateOf(p1)).flow.chooser!;
  p1.got.length = 0;
  (chooser === 'p1' ? p1 : p2).send({ type: 'action', action: { type: 'choosePriority', seat: 'p1' } });
  await p1.next(m => m.type === 'action' && m.action.type === 'choosePriority');
  const state = await stateOf(p1);
  expect(state.phase).toBe('move');
  return { p1, p2, chooser };
}

describe('what each player may change once the battle starts', () => {
  it("refuses changes to the other player's models, name and turn", async () => {
    const { p1, p2 } = await battle('rules-refuse');
    p2.send({ type: 'action', action: { type: 'updateModel', id: 'a1', patch: { wounds: 1 } } });
    p2.send({ type: 'action', action: { type: 'removeModels', ids: ['a1'] } });
    p2.send({ type: 'action', action: { type: 'addModels', models: [{ id: 'x', owner: 'p1', name: 'Spy' }] } });
    p2.send({ type: 'action', action: { type: 'wound', id: 'a1', count: 3, by: ['a1'] } });
    p2.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Loser' } });
    p2.send({ type: 'action', action: { type: 'endActivation', seat: 'p1' } });
    await pause(300);
    const s = await stateOf(p1);
    expect(s.models.a1).toMatchObject({ wounds: 3 });
    expect(s.models.x).toBeUndefined();
    expect(s.names.p1).toBe('Alex');
    expect(s.flow.done).not.toContain('p1');
    p1.ws.close();
    p2.ws.close();
  }, 30_000);

  it('still lets players change their own models, and wound an enemy their model struck', async () => {
    const { p1, p2 } = await battle('rules-allow');
    p1.send({ type: 'action', action: { type: 'updateModel', id: 'a1', patch: { name: 'Elessar' } } });
    p1.send({ type: 'action', action: { type: 'wound', id: 'b1', count: 1, by: ['a1'], how: 'other' } });
    await pause(300);
    const s = await stateOf(p2);
    expect(s.models.a1.name).toBe('Elessar');
    expect(s.models.b1.dead || s.models.b1.wounds === 0).toBe(true);
    p1.ws.close();
    p2.ws.close();
  }, 30_000);

  it('only lets the player who won the roll choose Priority', async () => {
    const p1 = await joinRoom(server.port, 'rules-priority');
    const p2 = await joinRoom(server.port, 'rules-priority');
    p1.send({ type: 'hello', role: 'p1' });
    p2.send({ type: 'hello', role: 'p2' });
    p1.send({ type: 'action', action: { type: 'startGame' } });
    p1.send({ type: 'action', action: { type: 'rollPriority' } });
    const chooser = (await stateOf(p1)).flow.chooser!;
    const loser = chooser === 'p1' ? p2 : p1;
    loser.send({ type: 'action', action: { type: 'choosePriority', seat: chooser === 'p1' ? 'p2' : 'p1' } });
    await pause(300);
    expect((await stateOf(p1)).phase).toBe('priority');
    p1.ws.close();
    p2.ws.close();
  }, 30_000);
});

describe('two players acting at the same moment', () => {
  it('applies both, one after the other, the same for everyone', async () => {
    const { p1, p2 } = await battle('rules-same-time');
    p1.got.length = 0;
    p2.got.length = 0;
    // Both press "Done moving" in the same instant.
    p1.send({ type: 'action', action: { type: 'endActivation', seat: 'p1' } });
    p2.send({ type: 'action', action: { type: 'endActivation', seat: 'p2' } });
    for (const b of [p1, p2]) for (const seat of ['p1', 'p2']) await b.next(m => m.type === 'action' && m.action.type === 'endActivation' && m.action.seat === seat);
    const order = (b: Browser) => b.got.flatMap(m => (m.type === 'action' ? [`${m.seq}:${m.action.type}`] : []));
    expect(order(p1)).toEqual(order(p2));
    const s = await stateOf(p1);
    // Both done, so play moved on to Shooting exactly once.
    expect(s.phase).toBe('shoot');
    expect(s.flow.done).toEqual([]);
    p1.ws.close();
    p2.ws.close();
  }, 30_000);
});

describe('one address hogging the server', () => {
  it('turns away connections past the limit, and lets them in again once some close', async () => {
    const open = await Promise.all(Array.from({ length: 6 }, (_, i) => joinRoom(server.port, `rules-hog-${i % 2}`)));
    const extra = await joinRoom(server.port, 'rules-hog-0');
    await extra.next(m => m.type === 'error');
    await new Promise(done => extra.ws.once('close', done));
    open[0].ws.close();
    await pause(200);
    const again = await joinRoom(server.port, 'rules-hog-0');
    await again.next(m => m.type === 'snapshot');
    for (const b of [...open, again]) b.ws.close();
  }, 30_000);
});
