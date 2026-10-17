import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import type { Account, Action, ClientMessage, GameState, Revert, Role, RoomSummary, Seat, ServerMessage } from '../src/shared/types.ts';
import { DICE_REQUESTS, resolveRequest } from '../src/shared/resolve.ts';
import { phaseAllows } from '../src/shared/heroics.ts';
import { brokenSideToTest, brokenTests, terrorAhead, terrorTest } from '../src/shared/courage.ts';
import { arrivalsDue, rollArrivals } from '../src/shared/maelstrom.ts';
import { cleanMark } from '../src/shared/marks.ts';
import { scenarioById } from '../src/shared/scenarios.ts';
import { announceGame, closeVoiceRoom, discordEnabled, discordMember, openVoiceRoom, sweepVoiceRooms, voiceEnabled } from './discord.ts';
import { saveResult, verifyToken } from './accounts.ts';
import { endRollDue, phaseFinished } from '../src/shared/autoPhase.ts';
import { endRollLabel, gameWinner } from '../src/shared/status.ts';
import { diffForUndo, mergeReverts, UNDOABLE } from '../src/shared/undo.ts';
import { botStep, newMemo, type BotMemo } from '../src/shared/bot.ts';
import type { Catalog } from '../src/shared/catalog.ts';
import catalogJson from '../src/data/mesbg-data.json';

const CATALOG = catalogJson as unknown as Catalog;

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.env.DIST_DIR ?? 'dist');
const DATA = resolve(process.env.DATA_DIR ?? 'data/rooms');
const ROOM_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CANONICAL = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
/** Games held in memory at once, so nobody can exhaust the server by opening endless rooms. */
const MAX_ROOMS = 2000;
const ROOM_ID = /^[a-z0-9-]{3,40}$/;
const INVITE = /^[A-Za-z0-9_-]{8,40}$/;

interface Client {
  ws: WebSocket;
  role: Role;
  tokens: number;
  /** The signed-in account behind this browser, once checked. */
  account?: Account;
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
  /** A result is being written to the leaderboard right now. */
  saving?: boolean;
  saveTries?: number;
  /** Nothing has happened here since the server started and there was no save, so a player's browser may restore its copy. */
  blank: boolean;
  /** A private game's invite code. Kept on the server and handed only to seated players. */
  invite?: string;
  /** The computer player's memory and its next step, in a game against it. */
  bot?: { memo: BotMemo; timer?: NodeJS.Timeout; busy?: boolean };
  /** The Fight or End phase is over and play moves on shortly, if nothing changes first. */
  advance?: NodeJS.Timeout;
  /** The Discord voice channel opened for this game, and when it is due to come down. */
  voice?: { id?: string; opening?: boolean; closeAt?: number };
  /** When a player was last connected, so an abandoned game's voice channel can be taken down. */
  seen: number;
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
    let invite: string | undefined;
    let voice: string | undefined;
    const blank = !existsSync(file);
    if (!blank) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        state = loadState(saved);
        if (typeof saved?._invite === 'string') invite = saved._invite;
        if (typeof saved?._voice === 'string') voice = saved._voice;
      } catch (err) {
        console.warn(`Could not read saved room ${id}:`, err);
      }
    }
    // A private game whose code was lost can't be joined by anyone, so it opens up again.
    if (state.private && !invite) state = reduce(state, { type: 'setPrivate', private: false });
    room = { id, state, clients: new Set(), touched: Date.now(), undo: { p1: [], p2: [] }, blank, invite, seen: Date.now(), voice: voice ? { id: voice } : undefined };
    rooms.set(id, room);
  }
  return room;
}

function scheduleSave(room: Room) {
  room.touched = Date.now();
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = undefined;
    const extra = { ...(room.invite ? { _invite: room.invite } : {}), ...(room.voice?.id ? { _voice: room.voice.id } : {}) };
    writeFileSync(join(DATA, `${room.id}.json`), JSON.stringify({ ...room.state, ...extra }));
  }, 2000);
}

const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const players = (room: Room) => [...room.clients].map(c => c.role);
const broadcast = (room: Room, msg: ServerMessage) => {
  const data = JSON.stringify(msg);
  for (const c of room.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
};

/** Marks a seat as belonging to the signed-in player sitting in it. */
function seatAccount(room: Room, client: Client) {
  if (client.role === 'spectator' || !client.account || room.state.result?.saved) return;
  const current = room.state.accounts?.[client.role];
  if (current?.id === client.account.id && current.name === client.account.name) return;
  apply(room, { type: 'seatAccount', seat: client.role, account: client.account });
}

/** Turns a client's request into the action everyone applies, or null if it isn't allowed. */
function authorise(client: Client, action: Action, state: GameState): Action | null {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return null;
  if (client.role === 'spectator') return null;
  const mine = (id: unknown) => typeof id === 'string' && state.models[id]?.owner === client.role;
  switch (action.type) {
    case 'rolled':
    case 'backAway':
    case 'courageTaken':
    case 'arrive':
    case 'spendWill':
    case 'spellPending':
    case 'revert':
    case 'undo':
    case 'priorityRolled':
    case 'fateRolled':
    case 'uncovered':
    case 'seatAccount':
    case 'setPrivate':
    case 'resultSaved':
      return null; // only the server produces dice results, undo changes and account details
    case 'gameOver':
      return null;
    case 'startGame':
      return { type: 'startGame', at: Date.now() };
    case 'proposeResult':
    case 'concede':
    case 'answerResult': {
      // Only the player in that seat, and the signed-in one if the seat has an account.
      const seat = action.seat;
      if (seat !== client.role) return null;
      const owner = state.accounts?.[seat];
      return !owner || owner.id === client.account?.id ? action : null;
    }
    case 'declareHeroic':
      return mine(action.model) ? action : null;
    case 'takeWound':
      return mine(action.id) ? action : null;
    case 'pickUp':
    case 'flip':
    case 'escape':
      return mine(action.model) ? action : null;
    case 'drop': {
      const carrier = state.terrain[action.marker]?.carrier;
      return mine(carrier) ? action : null;
    }
    case 'setPick':
      return action.seat === client.role ? action : null;
    case 'setBotSpeed':
      return action;
    case 'letSpellFail':
      return state.flow.spell && state.models[state.flow.spell.caster]?.owner === client.role ? action : null;
    case 'setBot':
      // A player can hand the other seat to the computer (if nobody's sitting in it), or take it back.
      if (action.seat === null) return action;
      if (action.seat !== 'p1' && action.seat !== 'p2') return null;
      return action.seat !== client.role ? action : null;
    case 'useMight': {
      // Only on your own hero's roll (in a fight, either player may have rolled it).
      const r = state.log.find(x => x.id === action.roll);
      return r && mine(r.model) ? action : null;
    }
    case 'passHeroic':
      return action.seat === client.role ? action : null;
    case 'moveModels':
      // Once the battle is under way, each player moves only their own models (and the Palantír's, in a solo game,
      // so they can back its models away after a fight).
      if (!state.flow.started || !Array.isArray(action.moves)) return action;
      return { ...action, moves: action.moves.filter(mv => mine(mv?.id) || (!!state.bot && state.models[mv?.id]?.owner === state.bot)) };
    case 'loadState':
      // A loaded save keeps its board, but not its dice history or a result, so neither can be forged.
      return { type: 'loadState', state: { ...loadState(action.state), log: [], accounts: state.accounts, result: undefined, private: state.private, listed: state.private ? false : loadState(action.state).listed } };
    default:
      return action;
  }
}

/** Listed games with at least one player connected, most recently active first. */
function openRooms(): RoomSummary[] {
  return [...rooms.values()]
    .filter(r => r.state.listed && !r.state.private && [...r.clients].some(c => c.role !== 'spectator'))
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
  // The game declares its own winner as soon as it's over (and corrects it if the score changes before both confirm).
  if (action.type !== 'gameOver') {
    const winner = gameWinner(room.state);
    if (winner) {
      const before = room.state;
      room.state = reduce(room.state, { type: 'gameOver', winner });
      if (room.state !== before) broadcast(room, { type: 'action', action: { type: 'gameOver', winner } });
    }
  }
  rollBrokenTests(room);
  rollReinforcements(room);
  rollGameEnd(room);
  scheduleAdvance(room);
  scheduleBot(room);
  updateVoice(room);
  const r = room.state.result;
  const a = room.state.accounts;
  if (r?.agreed && !r.saved && a?.p1 && a.p2 && !room.saving && (room.saveTries ?? 0) < 3) {
    room.saving = true;
    room.saveTries = (room.saveTries ?? 0) + 1;
    void saveResult(room.id, room.state).then(ok => {
      room.saving = false;
      if (ok) apply(room, { type: 'resultSaved' });
    });
  }
}

/** How long a voice channel stays up after the game ends, or after both players have left. */
const VOICE_LINGER_MS = 1000 * 60 * 5;
const VOICE_ABANDONED_MS = 1000 * 60 * 15;

/** Opens a Discord voice channel once two people start playing each other, and books its removal when the game ends. */
function updateVoice(room: Room) {
  if (!voiceEnabled()) return;
  const s = room.state;
  if (s.result) {
    if (room.voice?.id && !room.voice.closeAt) room.voice.closeAt = Date.now() + VOICE_LINGER_MS;
    return;
  }
  if (room.voice || !s.flow.started || s.bot) return;
  const seated = new Set([...room.clients].map(c => c.role));
  if (!seated.has('p1') || !seated.has('p2')) return;
  room.voice = { opening: true };
  const voice = room.voice;
  void openVoiceRoom(room.id, [s.names.p1 ?? '', s.names.p2 ?? ''], scenarioById(s.scenario)?.name).then(id => {
    voice.opening = false;
    if (!id) return;
    voice.id = id;
    scheduleSave(room);
  });
}

/** Takes the channel down. After a finished game an empty marker stays so it isn't reopened until the next game starts. */
function closeVoice(room: Room) {
  const id = room.voice?.id;
  if (!id) return;
  room.voice = room.state.result ? {} : undefined;
  scheduleSave(room);
  void closeVoiceRoom(id);
}

const serverDice = () => randomInt(1, 7);
const serverId = () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`;

/** As a Broken side starts to move, rolls the Courage tests for its whole army. */
let rollingCourage = false;
function rollBrokenTests(room: Room) {
  const seat = !rollingCourage && brokenSideToTest(room.state);
  if (!seat) return;
  rollingCourage = true;
  try {
    for (const a of brokenTests(room.state, seat, CATALOG, serverDice, serverId)) apply(room, a);
  } finally {
    rollingCourage = false;
  }
}

/** As a Maelstrom side starts to move, rolls for its warbands still off the table and brings on those that arrive. */
let rollingArrivals = false;
function rollReinforcements(room: Room) {
  const seat = !rollingArrivals && arrivalsDue(room.state);
  if (!seat) return;
  rollingArrivals = true;
  try {
    for (const a of rollArrivals(room.state, seat, serverDice, serverId, () => randomInt(0, 1e6) / 1e6)) apply(room, a);
  } finally {
    rollingArrivals = false;
  }
}

/** In a scenario where a Broken army can end the game, rolls the D6 for it as the End phase begins. */
function rollGameEnd(room: Room) {
  if (!endRollDue(room.state)) return;
  const out = resolveRequest(room.state, room.state.priority ?? 'p1', { type: 'roll', count: 1, label: endRollLabel(room.state.turn) }, serverDice, serverId);
  for (const a of out?.apply ?? []) apply(room, a);
}

/** How long a finished Fight or End phase stays up before play moves on, so the last result can be seen. */
const ADVANCE_PAUSE = 1500;

/** Moves on from a Fight or End phase with nothing left to do in it, after a short pause. */
function scheduleAdvance(room: Room) {
  if (room.advance || !phaseFinished(room.state)) return;
  const at = `${room.state.turn}:${room.state.phase}`;
  room.advance = setTimeout(() => {
    room.advance = undefined;
    // Only if it's still the same phase and still over (someone may have moved on, or backed a model into a fight).
    if (`${room.state.turn}:${room.state.phase}` === at && phaseFinished(room.state)) apply(room, { type: 'nextPhase' });
    else scheduleAdvance(room);
  }, ADVANCE_PAUSE);
}

/**
 * Rolls Courage for any model this move would bring into contact with a terrifying enemy, if it hasn't tested this
 * turn. Models that fail stay where they are; the rest of the move goes ahead.
 */
function testTerror(room: Room, action: Action): Action | null {
  if (action.type !== 'moveModels' || !Array.isArray(action.moves)) return action;
  const moves = action.moves.filter(mv => {
    const m = room.state.models[mv?.id];
    // Judged on where the model would really end up, after its Move limit.
    const to = m && reduce(room.state, { type: 'moveModels', moves: [mv] }).models[m.id];
    const enemy = m && to && terrorAhead(room.state, m, to, CATALOG);
    if (!m || !enemy) return true;
    const test = terrorTest(m, enemy, CATALOG, serverDice, serverId);
    for (const a of test.actions) apply(room, a);
    return test.pass;
  });
  return moves.length ? { ...action, moves } : null;
}

const BOT_PAUSE = 500;
/** The Palantír speed setting shortens every pause between the computer's steps. */
const BOT_PACE = { normal: 1, fast: 0.35, instant: 0.05 };

/** Lines up the computer's next step, if it plays in this game and someone is here to see it. */
function scheduleBot(room: Room, delay = BOT_PAUSE) {
  if (!room.state.bot) {
    if (room.bot?.timer) clearTimeout(room.bot.timer);
    room.bot = undefined;
    return;
  }
  room.bot ??= { memo: newMemo() };
  const bot = room.bot;
  if (bot.timer || bot.busy || ![...room.clients].some(c => c.role !== 'spectator')) return;
  bot.timer = setTimeout(() => {
    bot.timer = undefined;
    runBot(room);
  }, Math.max(30, delay * BOT_PACE[room.state.botSpeed ?? 'normal']));
}

/** Plays the computer's next step: one move, roll or choice, then a pause before the next. */
function runBot(room: Room) {
  const seat = room.state.bot;
  const bot = room.bot;
  if (!seat || !bot) return;
  let step;
  try {
    step = botStep(room.state, seat, CATALOG, bot.memo);
  } catch (err) {
    console.warn('The computer player failed a step:', err);
    return;
  }
  if (!step) return;
  bot.busy = true;
  try {
    const action = step.action;
    if (action && DICE_REQUESTS.has(action.type)) {
      const out = resolveRequest(room.state, seat, action, () => randomInt(1, 7), () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`);
      for (const a of [...(out?.apply ?? []), ...(out?.record ? [out.record] : [])]) apply(room, a);
    } else if (action) {
      const moved = testTerror(room, action);
      if (moved) apply(room, moved);
    }
  } finally {
    bot.busy = false;
  }
  scheduleBot(room, step.delay);
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

/** Browser protections on every response: HTTPS only, no framing by other sites, and only our own scripts. */
function secure(res: import('node:http').ServerResponse) {
  const supabase = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ws: wss: ${supabase}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );
}

const server = createServer((req, res) => {
  secure(res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  // One address for everyone: sign-ins and saved games live per address in the browser, so the old
  // onrender.com one sends visitors on to PUBLIC_URL. Health checks still answer at either.
  const host = req.headers.host ?? '';
  if (CANONICAL && host.endsWith('.onrender.com') && !CANONICAL.includes(host)) {
    res.writeHead(301, { location: CANONICAL + url.pathname + url.search }).end();
    return;
  }
  if (url.pathname === '/api/config') {
    // Both values are public by design: the browser needs them to offer Discord sign-in.
    const config = { supabaseUrl: process.env.SUPABASE_URL ?? null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(config));
    return;
  }
  if (url.pathname === '/api/discord-member' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      let token = '';
      try {
        token = String(JSON.parse(body).token ?? '');
      } catch {
        // Not JSON: answered as unknown below.
      }
      void discordMember(token).then(out => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out)));
    });
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(openRooms()));
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    // A malformed address used to throw here and take the whole server down.
    res.writeHead(400).end('Bad request');
    return;
  }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
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
  if (!rooms.has(roomId) && rooms.size >= MAX_ROOMS) {
    send(ws, { type: 'error', message: 'The server is full right now. Try again in a few minutes.' });
    ws.close();
    return;
  }
  const room = getRoom(roomId);
  const client: Client = { ws, role: 'spectator', tokens: 120 };
  room.clients.add(client);
  send(ws, { type: 'snapshot', state: room.state, players: players(room), blank: room.blank });

  ws.on('message', data => {
    try {
      onMessage(data);
    } catch (err) {
      // One bad message must never take the server (and everyone's games) down.
      console.warn('Ignored a message that failed:', err);
    }
  });

  const onMessage = (data: import('ws').RawData) => {
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
      if (client.role !== 'spectator' && client.role === room.state.bot) {
        client.role = 'spectator';
        send(ws, { type: 'seatRefused', message: 'The computer is playing that side. Take the other seat to play against it.' });
      }
      if (client.role !== 'spectator' && room.state.private && msg.invite !== room.invite) {
        // Invite-only: without the code you can still watch.
        client.role = 'spectator';
        send(ws, { type: 'seatRefused', message: 'This game is private. Ask a player for the invite link to take a seat; until then you can watch.' });
      }
      if (client.role !== 'spectator' && room.invite) send(ws, { type: 'invite', code: room.invite });
      if (client.role !== 'spectator') scheduleAnnouncement(room);
      broadcast(room, { type: 'presence', players: players(room) });
      if (client.role !== 'spectator') sendUndoDepth(room, client.role);
      seatAccount(room, client);
      scheduleBot(room);
      return;
    }
    if (msg.type === 'restore') {
      // After a restart wipes the server, the first player back brings the game with them.
      if (!room.blank || client.role === 'spectator') return;
      room.undo = { p1: [], p2: [] };
      const restored = loadState(msg.state);
      const invite = restored.private && typeof msg.invite === 'string' && INVITE.test(msg.invite) ? msg.invite : undefined;
      room.invite = invite;
      apply(room, { type: 'loadState', state: { ...restored, log: [], accounts: undefined, result: undefined, private: invite ? true : undefined } });
      return;
    }
    if (msg.type === 'privacy') {
      if (client.role === 'spectator') return;
      room.invite = msg.private ? (room.invite ?? randomBytes(9).toString('base64url')) : undefined;
      apply(room, { type: 'setPrivate', private: !!msg.private });
      for (const c of room.clients) if (c.role !== 'spectator') send(c.ws, { type: 'invite', code: room.invite ?? null });
      return;
    }
    if (msg.type === 'mark') {
      // Pings and arrows go straight out to everyone in the room; they're not part of the saved game.
      const mark = cleanMark(msg.mark, client.role, `k-${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`);
      if (mark) broadcast(room, { type: 'mark', mark });
      return;
    }
    if (msg.type === 'clearMarks') {
      broadcast(room, { type: 'clearMarks', by: client.role });
      return;
    }
    if (msg.type === 'identify') {
      if (!msg.token) {
        client.account = undefined;
        return;
      }
      void verifyToken(msg.token).then(account => {
        client.account = account ?? undefined;
        seatAccount(room, client);
      });
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
      if (client.role === 'spectator' || !phaseAllows(room.state, client.role, msg.action)) return;
      const out = resolveRequest(room.state, client.role, msg.action, () => randomInt(1, 7), () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`);
      if (!out) return;
      for (const a of out.apply) apply(room, a);
      if (out.record) record(room, client.role, out.record);
      return;
    }
    const allowed = authorise(client, msg.action, room.state);
    if (!allowed || (client.role !== 'spectator' && !phaseAllows(room.state, client.role, allowed))) return;
    const action = testTerror(room, allowed);
    if (!action) return;
    // The computer can't take a seat someone is sitting in.
    if (action.type === 'setBot' && action.seat && [...room.clients].some(c => c.role === action.seat)) return;
    record(room, client.role, action);
    if (action.type === 'loadState') room.undo = { p1: [], p2: [] };
    if (action.type === 'startGame') {
      room.saveTries = 0;
      // A new game in the same room gets a voice channel of its own.
      if (room.voice && !room.voice.id && !room.voice.opening) {
        room.voice = undefined;
        updateVoice(room);
      }
    }
  };

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
    if ([...room.clients].some(c => c.role !== 'spectator')) room.seen = Date.now();
    if (room.voice?.id && (Date.now() > (room.voice.closeAt ?? Infinity) || Date.now() - room.seen > VOICE_ABANDONED_MS)) closeVoice(room);
    if (room.clients.size === 0 && Date.now() - room.touched > 1000 * 60 * 30) {
      closeVoice(room);
      rooms.delete(room.id);
    }
  }
}, 1000).unref();

// Take down game voice channels no room in memory still uses (left over from a restart, say).
setInterval(() => {
  const inUse = new Set([...rooms.values()].map(r => r.voice?.id).filter((id): id is string => !!id));
  void sweepVoiceRooms(inUse, VOICE_ABANDONED_MS * 2);
}, 1000 * 60 * 10).unref();

// Forget rooms nobody has touched for two weeks.
setInterval(() => {
  for (const room of rooms.values()) if (Date.now() - room.touched > ROOM_TTL_MS) rooms.delete(room.id);
}, 1000 * 60 * 60).unref();

server.listen(PORT, () => console.log(`MESBG tabletop listening on http://localhost:${PORT}`));
