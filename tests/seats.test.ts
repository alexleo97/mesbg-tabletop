import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/shared/types.ts';
import { joinRoom, startServer } from './harness.ts';

const dirs: string[] = [];
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** A server whose seats open up again after half a second away, keeping games in a folder of its own. */
function server(dir = mkdtempSync(join(tmpdir(), 'mesbg-seats-'))) {
  dirs.push(dir);
  return startServer({ DATA_DIR: dir, DIST_DIR: dir, SEAT_HELD_MS: '500' });
}

type Browser = Awaited<ReturnType<typeof joinRoom>>;
const keyOf = async (b: Browser) => ((await b.next(m => m.type === 'seatKey')) as Extract<ServerMessage, { type: 'seatKey' }>).key;
const refused = (b: Browser) => b.next(m => m.type === 'seatRefused');
const seated = (b: Browser, seat: string) => b.next(m => m.type === 'presence' && m.players.includes(seat as never));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Two players sit down and start the battle; each gets the key to their seat. */
async function battle(port: number, room: string) {
  const p1 = await joinRoom(port, room);
  const p2 = await joinRoom(port, room);
  p1.send({ type: 'hello', role: 'p1' });
  p2.send({ type: 'hello', role: 'p2' });
  await seated(p1, 'p2');
  // No keys before the battle: seats are free to swap while setting up.
  expect(p1.got.some(m => m.type === 'seatKey')).toBe(false);
  p1.send({ type: 'action', action: { type: 'startGame' } });
  return { p1, p2, k1: await keyOf(p1), k2: await keyOf(p2) };
}

describe('seats in a battle under way', () => {
  it('lets anyone sit before the battle starts', async () => {
    const s = await server();
    const a = await joinRoom(s.port, 'seats-lobby');
    const b = await joinRoom(s.port, 'seats-lobby');
    a.send({ type: 'hello', role: 'p1' });
    await seated(a, 'p1');
    a.send({ type: 'hello', role: 'spectator' });
    b.send({ type: 'hello', role: 'p1' });
    await seated(b, 'p1');
    expect(b.got.some(m => m.type === 'seatRefused')).toBe(false);
    a.ws.close();
    b.ws.close();
    await s.stop();
  }, 30_000);

  it("keeps a dropped player's seat for them, and lets them back in with their key", async () => {
    const s = await server();
    const { p1, k1 } = await battle(s.port, 'seats-back');
    // Someone else can't take a seat that's in use.
    const stranger = await joinRoom(s.port, 'seats-back');
    stranger.send({ type: 'hello', role: 'p1' });
    await refused(stranger);
    // Nor while its player is briefly away.
    p1.ws.close();
    await pause(100);
    stranger.got.length = 0;
    stranger.send({ type: 'hello', role: 'p1' });
    await refused(stranger);
    // The player comes back with their key and sits straight down.
    const back = await joinRoom(s.port, 'seats-back');
    back.send({ type: 'hello', role: 'p1', seatKey: k1 });
    expect(await keyOf(back)).toBe(k1);
    expect(back.got.some(m => m.type === 'seatRefused')).toBe(false);
    for (const b of [back, stranger]) b.ws.close();
    await s.stop();
  }, 30_000);

  it('opens a seat up again once its player has been gone a while', async () => {
    const s = await server();
    const { p1, p2, k1 } = await battle(s.port, 'seats-gone');
    p1.ws.close();
    await pause(1600);
    const newcomer = await joinRoom(s.port, 'seats-gone');
    newcomer.send({ type: 'hello', role: 'p1' });
    const k = await keyOf(newcomer);
    expect(k).not.toBe(k1);
    // The old key no longer works while the newcomer is sitting there.
    const old = await joinRoom(s.port, 'seats-gone');
    old.send({ type: 'hello', role: 'p1', seatKey: k1 });
    await refused(old);
    for (const b of [p2, newcomer, old]) b.ws.close();
    await s.stop();
  }, 30_000);

  it('keeps seat keys through a restart without showing them to anyone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mesbg-seats-'));
    const s = await server(dir);
    const { p1, p2, k2 } = await battle(s.port, 'seats-restart');
    await pause(2500); // the game is written to disk every 2 seconds
    p1.ws.close();
    p2.ws.close();
    await s.stop();
    const again = await server(dir);
    const stranger = await joinRoom(again.port, 'seats-restart');
    const snap = await stranger.next(m => m.type === 'snapshot');
    expect(JSON.stringify(snap)).not.toContain(k2);
    stranger.send({ type: 'hello', role: 'p2' });
    await refused(stranger);
    const back = await joinRoom(again.port, 'seats-restart');
    back.send({ type: 'hello', role: 'p2', seatKey: k2 });
    expect(await keyOf(back)).toBe(k2);
    stranger.ws.close();
    back.ws.close();
    await again.stop();
  }, 30_000);
});
