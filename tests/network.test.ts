import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { actionFits, staleBuild } from '../src/client/net.ts';
import type { ServerMessage } from '../src/shared/types.ts';

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

/** A real game server on a spare port, with its own empty save folder and a fast heartbeat. */
let server: ChildProcess;
let port: number;
let dir: string;

const freePort = () =>
  new Promise<number>(done => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mesbg-net-'));
  writeFileSync(join(dir, 'build-id.txt'), 'build-42');
  port = await freePort();
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: join(dir, 'rooms'), DIST_DIR: dir, HEARTBEAT_MS: '150', SUPABASE_URL: '', DISCORD_WEBHOOK_URL: '', DISCORD_BOT_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((done, fail) => {
    server.stdout!.on('data', d => String(d).includes('listening') && done());
    server.on('exit', code => fail(new Error(`server exited with ${code}`)));
  });
}, 30_000);

afterAll(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** A browser in a room, keeping every message it is sent. */
async function join_(room: string, opts: { autoPong?: boolean } = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/ws?room=${room}`, opts);
  const got: ServerMessage[] = [];
  const waiters: [(m: ServerMessage) => boolean, (m: ServerMessage) => void][] = [];
  ws.on('message', d => {
    const m = JSON.parse(String(d)) as ServerMessage;
    got.push(m);
    for (const w of [...waiters]) if (w[0](m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w[1](m);
    }
  });
  const next = (test: (m: ServerMessage) => boolean) =>
    new Promise<ServerMessage>((done, fail) => {
      const seen = got.find(test);
      if (seen) return done(seen);
      waiters.push([test, done]);
      setTimeout(() => fail(new Error('nothing arrived')), 3000);
    });
  const send = (m: object) => ws.send(JSON.stringify(m));
  await new Promise(done => ws.once('open', done));
  return { ws, got, next, send };
}

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
