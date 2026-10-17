import { randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import type { Action, ClientMessage, GameState, Revert, Role, RoomSummary, Seat, ServerMessage } from '../src/shared/types.ts';
import { DICE_REQUESTS, resolveRequest } from '../src/shared/resolve.ts';
import { scenarioById } from '../src/shared/scenarios.ts';
import { announceGame, discordEnabled } from './discord.ts';
import { diffForUndo, mergeReverts, UNDOABLE } from '../src/shared/undo.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.env.DIST_DIR ?? 'dist');
const DATA = resolve(process.env.DATA_DIR ?? 'data/rooms');
const ROOM_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const ROOM_ID = /^[a-z0-9-]{3,40}$/;

interface Client {
  ws: WebSocket;
  role: Role;
  tokens: number;
}

interface Room {
  id: string;
  state: GameState;
  clients: Set<Client>;
  touched: number;
  saveTimer?: NodeJS.Timeout;
  /** Each player's recent changes, newest last, so they can take back their own misclicks. */
  undo: Record<Seat, UndoEntry[]>;
  /** Already posted to Discord as an open game (or decided not to). */
  announced?: boolean;
  /** Nothing has happened here since the server started and there was no save, so a player's browser may restore its copy. */
  blank: boolean;
}

interface UndoEntry {
  revert: Revert;
  /** Moves of the same models in quick succession (one drag) share an entry. */
  key: string;
  at: number;
}

const MAX_UNDO = 50;
const DRAG_GAP_MS = 2000;

const rooms = new Map<string, Room>();
mkdirSync(DATA, { recursive: true });

function getRoom(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    const file = join(DATA, `${id}.json`);
    let state = initialState();
    const blank = !existsSync(file);
    if (!blank) {
      try {
        state = loadState(JSON.parse(readFileSync(file, 'utf8')));
      } catch (err) {
        console.warn(`Could not read saved room ${id}:`, err);
      }
    }
    room = { id, state, clients: new Set(), touched: Date.now(), undo: { p1: [], p2: [] }, blank };
    rooms.set(id, room);
  }
  return room;
}

function scheduleSave(room: Room) {
  room.touched = Date.now();
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = undefined;
    writeFileSync(join(DATA, `${room.id}.json`), JSON.stringify(room.state));
  }, 2000);
}

const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const players = (room: Room) => [...room.clients].map(c => c.role);
const broadcast = (room: Room, msg: ServerMessage) => {
  const data = JSON.stringify(msg);
  for (const c of room.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
};

/** Turns a client's request into the action everyone applies, or null if it isn't allowed. */
function authorise(client: Client, action: Action, state: GameState): Action | null {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return null;
  if (client.role === 'spectator') return null;
  const mine = (id: unknown) => typeof id === 'string' && state.models[id]?.owner === client.role;
  switch (action.type) {
    case 'rolled':
    case 'revert':
    case 'undo':
    case 'priorityRolled':
    case 'fateRolled':
      return null; // only the server produces dice results and undo changes
    case 'declareHeroic':
      return mine(action.model) ? action : null;
    case 'takeWound':
      return mine(action.id) ? action : null;
    case 'useMight': {
      // Only on your own hero's roll (in a fight, either player may have rolled it).
      const r = state.log.find(x => x.id === action.roll);
      return r && mine(r.model) ? action : null;
    }
    case 'passHeroic':
      return action.seat === client.role ? action : null;
    case 'loadState':
      // A loaded save keeps its board, but not its dice history, so rolls can't be forged.
      return { type: 'loadState', state: { ...loadState(action.state), log: [] } };
    default:
      return action;
  }
}

/** Listed games with at least one player connected, most recently active first. */
function openRooms(): RoomSummary[] {
  return [...rooms.values()]
    .filter(r => r.state.listed && [...r.clients].some(c => c.role !== 'spectator'))
    .sort((a, b) => b.touched - a.touched)
    .slice(0, 50)
    .map(r => {
      const roles = [...r.clients].map(c => c.role);
      return {
        id: r.id,
        names: r.state.names,
        seated: (['p1', 'p2'] as const).filter(s => roles.includes(s)),
        spectators: roles.filter(x => x === 'spectator').length,
        scenario: r.state.scenario,
        turn: r.state.turn,
        models: Object.keys(r.state.models).length,
      };
    });
}

/**
 * Posts a newly opened public game to Discord once, after a short wait so the host can type a name
 * and so games where both players join straight away aren't posted.
 */
function scheduleAnnouncement(room: Room) {
  if (room.announced || !discordEnabled()) return;
  room.announced = true;
  setTimeout(() => {
    const seated = new Set([...room.clients].map(c => c.role).filter(r => r !== 'spectator'));
    if (!room.state.listed || seated.size !== 1 || room.state.flow.started) return;
    const host = [...seated][0] as Seat;
    void announceGame(room.id, room.state.names[host] ?? '', scenarioById(room.state.scenario)?.name);
  }, 20_000).unref();
}

function apply(room: Room, action: Action) {
  room.blank = false;
  room.state = reduce(room.state, action);
  broadcast(room, { type: 'action', action });
  scheduleSave(room);
}

/** Applies a player's action and remembers how to take it back. */
function record(room: Room, role: Role, action: Action) {
  const before = room.state;
  apply(room, action);
  if (role === 'spectator' || !UNDOABLE.has(action.type)) return;
  const revert = diffForUndo(before, room.state);
  if (!revert) return;
  remember(room, role, action, revert);
  sendUndoDepth(room, role);
}

function remember(room: Room, seat: Seat, action: Action, revert: Revert) {
  const stack = room.undo[seat];
  const now = Date.now();
  const key = action.type === 'moveModels' ? `move:${action.moves.map(m => m.id).sort().join(',')}` : `${action.type}:${now}`;
  const top = stack[stack.length - 1];
  if (top && top.key === key && now - top.at < DRAG_GAP_MS) {
    top.revert = mergeReverts(top.revert, revert);
    top.at = now;
    return;
  }
  stack.push({ revert, key, at: now });
  if (stack.length > MAX_UNDO) stack.shift();
}

/** Tells a player's own browsers how many changes they can take back. */
function sendUndoDepth(room: Room, seat: Seat) {
  for (const c of room.clients) if (c.role === seat) send(c.ws, { type: 'undo', count: room.undo[seat].length });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/api/config') {
    // Both values are public by design: the browser needs them to offer Discord sign-in.
    const config = { supabaseUrl: process.env.SUPABASE_URL ?? null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(config));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(openRooms()));
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Not built yet. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const roomId = (url.searchParams.get('room') ?? '').toLowerCase();
  if (!ROOM_ID.test(roomId)) {
    send(ws, { type: 'error', message: 'Invalid room name' });
    ws.close();
    return;
  }
  const room = getRoom(roomId);
  const client: Client = { ws, role: 'spectator', tokens: 120 };
  room.clients.add(client);
  send(ws, { type: 'snapshot', state: room.state, players: players(room), blank: room.blank });

  ws.on('message', data => {
    // Simple rate limit: refills 60 messages per second, bursts up to 120.
    if (client.tokens <= 0) return;
    client.tokens--;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      client.role = msg.role === 'p1' || msg.role === 'p2' ? msg.role : 'spectator';
      if (client.role !== 'spectator') scheduleAnnouncement(room);
      broadcast(room, { type: 'presence', players: players(room) });
      if (client.role !== 'spectator') sendUndoDepth(room, client.role);
      return;
    }
    if (msg.type === 'restore') {
      // After a restart wipes the server, the first player back brings the game with them.
      if (!room.blank || client.role === 'spectator') return;
      room.undo = { p1: [], p2: [] };
      apply(room, { type: 'loadState', state: { ...loadState(msg.state), log: [] } });
      return;
    }
    if (msg.type !== 'action') return;
    if (msg.action?.type === 'undo') {
      if (client.role === 'spectator') return;
      const entry = room.undo[client.role].pop();
      if (entry) apply(room, { type: 'revert', revert: entry.revert });
      sendUndoDepth(room, client.role);
      return;
    }
    if (DICE_REQUESTS.has(msg.action?.type)) {
      if (client.role === 'spectator') return;
      const out = resolveRequest(room.state, client.role, msg.action, () => randomInt(1, 7), () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`);
      if (!out) return;
      for (const a of out.apply) apply(room, a);
      if (out.record) record(room, client.role, out.record);
      return;
    }
    const action = authorise(client, msg.action, room.state);
    if (!action) return;
    record(room, client.role, action);
    if (action.type === 'loadState') room.undo = { p1: [], p2: [] };
  });

  ws.on('close', () => {
    room.clients.delete(client);
    broadcast(room, { type: 'presence', players: players(room) });
  });
});

// Keep connections alive through proxies that drop idle sockets.
setInterval(() => {
  for (const c of wss.clients) c.ping();
}, 25_000).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.clients) c.tokens = Math.min(120, c.tokens + 60);
    if (room.clients.size === 0 && Date.now() - room.touched > 1000 * 60 * 30) rooms.delete(room.id);
  }
}, 1000).unref();

// Forget rooms nobody has touched for two weeks.
setInterval(() => {
  for (const room of rooms.values()) if (Date.now() - room.touched > ROOM_TTL_MS) rooms.delete(room.id);
}, 1000 * 60 * 60).unref();

server.listen(PORT, () => console.log(`MESBG tabletop listening on http://localhost:${PORT}`));
