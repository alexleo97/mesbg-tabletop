import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/shared/types.ts';
import { freePort, joinRoom, startServer, type TestServer } from './harness.ts';

/** Just enough of Supabase's REST API for the `rooms` table, keeping rows in memory and counting writes. */
const rows = new Map<string, { state: unknown; invite: string | null; voice: string | null; updated_at: string }>();
let writes = 0;
let broken = false;
let supabase: Server;
let supabaseUrl: string;

beforeAll(async () => {
  const port = await freePort();
  supabase = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (broken || url.pathname !== '/rest/v1/rooms') return res.writeHead(404).end('{"message":"relation \\"rooms\\" does not exist"}');
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '') ?? '';
        const row = rows.get(id);
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(row ? [row] : []));
      }
      if (req.method === 'POST') {
        const row = JSON.parse(body);
        writes++;
        rows.set(row.id, row);
        return res.writeHead(201).end();
      }
      if (req.method === 'DELETE') return res.writeHead(204).end();
      res.writeHead(405).end();
    });
  }).listen(port);
  supabaseUrl = `http://localhost:${port}`;
});

afterAll(() => supabase?.close());

const dirs: string[] = [];
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** A game server with its own empty disk, so anything it remembers came from the store. */
function server(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'mesbg-store-'));
  dirs.push(dir);
  return startServer({ DATA_DIR: dir, DIST_DIR: dir, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'test-key', ...env });
}

const named = (name: string) => (m: ServerMessage) => m.type === 'action' && m.action.type === 'setName' && m.action.name === name;

describe('saving games in Supabase', () => {
  it('brings a game back on a new server after a deploy, including the private invite', async () => {
    // A long save interval: the last change is only saved because the server saves everything as it stops.
    const old = await server({ CLOUD_SAVE_MS: '60000' });
    const a = await joinRoom(old.port, 'store-deploy');
    a.send({ type: 'hello', role: 'p1' });
    a.send({ type: 'privacy', private: true });
    const invite = (await a.next(m => m.type === 'invite' && !!m.code)) as { code: string };
    a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Alex' } });
    a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Aragorn' } });
    await a.next(named('Aragorn'));
    const told = new Promise<number>(done => a.ws.once('close', code => done(code)));
    await old.stop();
    // The browser is told the server is restarting, so it reconnects straight away.
    expect(await told).toBe(1012);

    const fresh = await server();
    const b = await joinRoom(fresh.port, 'store-deploy');
    const snap = await b.next(m => m.type === 'snapshot');
    expect(snap).toMatchObject({ blank: false, state: { names: { p1: 'Aragorn' }, private: true } });
    // The invite code survived too, so the invited player can still sit down.
    b.send({ type: 'hello', role: 'p1', invite: invite.code });
    await b.next(m => m.type === 'invite' && m.code === invite.code);
    b.ws.close();
    await fresh.stop();
  }, 30_000);

  it('saves a busy game every few seconds rather than on every change', async () => {
    const s = await server({ CLOUD_SAVE_MS: '400' });
    const a = await joinRoom(s.port, 'store-busy');
    a.send({ type: 'hello', role: 'p1' });
    await a.next(m => m.type === 'presence');
    const before = writes;
    for (let i = 0; i < 40; i++) a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: `Drag ${i}` } });
    await a.next(named('Drag 39'));
    await new Promise(done => setTimeout(done, 1000));
    // The first change saves at once (a new game), then at most one save per interval.
    expect(writes - before).toBeGreaterThanOrEqual(1);
    expect(writes - before).toBeLessThanOrEqual(4);
    expect((rows.get('store-busy')?.state as { names: { p1: string } }).names.p1).toBe('Drag 39');
    a.ws.close();
    await s.stop();
  }, 30_000);

  it('picks up a save made by the old server after this one had already loaded the game', async () => {
    const s = await server();
    const watcher = await joinRoom(s.port, 'store-overlap');
    await watcher.next(m => m.type === 'snapshot');
    // The server being replaced saves the game as it stops.
    rows.set('store-overlap', { state: { names: { p1: 'Gimli' } }, invite: null, voice: null, updated_at: new Date().toISOString() });
    const player = await joinRoom(s.port, 'store-overlap');
    const snap = await player.next(m => m.type === 'snapshot');
    expect(snap).toMatchObject({ blank: false, state: { names: { p1: 'Gimli' } } });
    // Someone already watching is caught up too.
    await watcher.next(m => m.type === 'snapshot' && m.state.names.p1 === 'Gimli');
    watcher.ws.close();
    player.ws.close();
    await s.stop();
  }, 30_000);

  it('keeps playing when the store is missing or down', async () => {
    broken = true;
    try {
      const s = await server({ CLOUD_SAVE_MS: '100' });
      const a = await joinRoom(s.port, 'store-down');
      a.send({ type: 'hello', role: 'p1' });
      a.send({ type: 'action', action: { type: 'setName', seat: 'p1', name: 'Legolas' } });
      await a.next(named('Legolas'));
      a.ws.close();
      await s.stop();
    } finally {
      broken = false;
    }
  }, 30_000);
});
