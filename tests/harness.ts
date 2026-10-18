// Runs a real game server for tests, and browsers that join its rooms.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../src/shared/types.ts';

export const freePort = () =>
  new Promise<number>(done => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
  });

export interface TestServer {
  port: number;
  proc: ChildProcess;
  /** Asks the server to stop, as Render does on a deploy, and waits for it to exit. */
  stop(): Promise<void>;
}

/** Every server started, so none is left running (and holding the test run open) if a test fails. */
const running = new Set<ChildProcess>();
afterAll(() => {
  for (const proc of running) proc.kill('SIGKILL');
});

/** Starts the game server on a spare port with the given settings, once it is listening. */
export async function startServer(env: Record<string, string>): Promise<TestServer> {
  const port = await freePort();
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', DISCORD_WEBHOOK_URL: '', DISCORD_BOT_TOKEN: '', ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.add(proc);
  proc.once('exit', () => running.delete(proc));
  await new Promise<void>((done, fail) => {
    proc.stdout!.on('data', d => String(d).includes('listening') && done());
    proc.once('exit', code => fail(new Error(`server exited with ${code}`)));
  });
  const stop = () =>
    new Promise<void>(done => {
      if (proc.exitCode !== null) return done();
      proc.once('exit', () => done());
      proc.kill('SIGTERM');
    });
  return { port, proc, stop };
}

/** A browser in a room, keeping every message it is sent. */
export async function joinRoom(port: number, room: string, opts: { autoPong?: boolean } = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/ws?room=${room}`, opts);
  const got: ServerMessage[] = [];
  const waiters: [(m: ServerMessage) => boolean, (m: ServerMessage) => void][] = [];
  ws.on('message', d => {
    const m = JSON.parse(String(d)) as ServerMessage;
    got.push(m);
    for (const w of [...waiters])
      if (w[0](m)) {
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
