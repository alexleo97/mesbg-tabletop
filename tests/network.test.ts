import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { actionFits, staleBuild } from '../src/client/net.ts';
import { joinRoom, startServer, type TestServer } from './harness.ts';

describe('keeping a browser in step with the server', () => {
  it('applies actions in order, skips repeats, and spots a missed one', () => {
    expect(actionFits(4, 5)).toBe('apply');
    expect(actionFits(4, 4)).toBe('skip');
    expect(actionFits(4, 2)).toBe('skip');
    expect(actionFits(4, 7)).toBe('gap');
    // An older server that doesn't number its actions.
    expect(actionFits(4, undefined)).toBe('apply');
  });

  it('reloads only when the server hands out a different build, never in development', () => {
    expect(staleBuild('abc', 'def')).toBe(true);
    expect(staleBuild('abc', 'abc')).toBe(false);
    expect(staleBuild('abc', undefined)).toBe(false);
    expect(staleBuild('dev', 'def')).toBe(false);
    expect(staleBuild('abc', 'dev')).toBe(false);
  });
});

/** A real game server with its own empty save folder and a fast heartbeat. */
let server: TestServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesbg-net-'));
  writeFileSync(join(dir, 'build-id.txt'), 'build-42');
  server = await startServer({ DATA_DIR: join(dir, 'rooms'), DIST_DIR: dir, HEARTBEAT_MS: '150' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const join_ = (room: string, opts: { autoPong?: boolean } = {}) => joinRoom(server.port, room, opts);

describe('the game server link', () => {
  it('sends the whole game with its action count and build on joining', async () => {
    const a = await join_('net-snapshot');
    const snap = await a.next(m => m.type === 'snapshot');
    expect(snap).toMatchObject({ type: 'snapshot', seq: 0, build: 'build-42' });
    a.ws.close();
  });

  it('numbers each action the same for everyone, and catches a browser up on request', async () => {
    const a = await join_('net-seq');
    const b = await join_('net-seq');
    a.send({ type: 'hello', role: 'p1' });
    a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Alex' } });
    a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Aragorn' } });
    const seqs = async (c: typeof a) => {
      await c.next(m => m.type === 'action' && m.action.type === 'setName' && m.action.name === 'Aragorn');
      return c.got.flatMap(m => (m.type === 'action' ? [m.seq] : []));
    };
    const [sa, sb] = [await seqs(a), await seqs(b)];
    expect(sa).toEqual(sb);
    expect(sa.length).toBeGreaterThanOrEqual(2);
    sa.forEach((s, i) => expect(s).toBe(i + 1));

    b.send({ type: 'sync' });
    const snap = await b.next(m => m.type === 'snapshot' && m.seq === sa.length);
    expect(snap.type === 'snapshot' && snap.state.names.p1).toBe('Aragorn');
    a.ws.close();
    b.ws.close();
  });

  it('answers a browser checking its link', async () => {
    const a = await join_('net-ping');
    a.send({ type: 'ping' });
    await a.next(m => m.type === 'pong');
    a.ws.close();
  });

  it('drops a player whose link has gone silent, so the other player sees them leave', async () => {
    const a = await join_('net-dead');
    const ghost = await join_('net-dead', { autoPong: false });
    ghost.send({ type: 'hello', role: 'p2' });
    a.send({ type: 'hello', role: 'p1' });
    await a.next(m => m.type === 'presence' && m.players.includes('p1') && m.players.includes('p2'));
    a.got.length = 0;
    const closed = new Promise(done => ghost.ws.once('close', done));
    await a.next(m => m.type === 'presence' && m.players.includes('p1') && !m.players.includes('p2'));
    await closed;
    a.ws.close();
  });

  it('keeps a player who answers the checks', async () => {
    const a = await join_('net-alive');
    a.send({ type: 'hello', role: 'p1' });
    await new Promise(done => setTimeout(done, 700));
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    a.ws.close();
  });
});
