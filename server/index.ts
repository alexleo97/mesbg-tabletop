import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import type { Account, Action, ClientMessage, GameState, Model, Revert, Role, RoomSummary, Seat, ServerMessage } from '../src/shared/types.ts';
import { DICE_REQUESTS, resolveRequest } from '../src/shared/resolve.ts';
import { mayDeclare, phaseAllows } from '../src/shared/heroics.ts';
import { challengeRivals, heroicBlocked } from '../src/shared/mightUse.ts';
import { brokenSideToTest, brokenTests, terrorAhead, terrorTest, willOfEvilDue, willOfEvilToll } from '../src/shared/courage.ts';
import { riderTests, riderTestsDue } from '../src/shared/cavalry.ts';
import { beastTests, beastTestsDue } from '../src/shared/warBeasts.ts';
import { chargeAim, chargesDue, straightOn, trample } from '../src/shared/trample.ts';
import { sabotageActions } from '../src/shared/siege.ts';
import { settleSpell, spellReady } from '../src/shared/magic.ts';
import { recoveryDue, recoveryRolls } from '../src/shared/powers.ts';
import { arrivalsDue, rollArrivals } from '../src/shared/maelstrom.ts';
import { cleanMark } from '../src/shared/marks.ts';
import { objectivesMissing, scenarioById } from '../src/shared/scenarios.ts';
import { deployReady } from '../src/shared/deploy.ts';
import { announceGame, closeVoiceRoom, discordEnabled, discordMember, openVoiceRoom, sweepVoiceRooms, voiceEnabled } from './discord.ts';
import { saveResult, verifyToken } from './accounts.ts';
import { loadRoom, pruneRooms, saveRoom, storeEnabled, type StoredRoom } from './store.ts';
import { endRollDue, phaseFinished } from '../src/shared/autoPhase.ts';
import { endRollLabel, gameWinner } from '../src/shared/status.ts';
import { diffForUndo, mergeReverts, UNDOABLE } from '../src/shared/undo.ts';
import { BOT_PACE, botPause, botStep, newMemo, type BotMemo, type BotStep } from '../src/shared/bot.ts';
import { rulesFor, startingPoints, type Catalog } from '../src/shared/catalog.ts';
import catalogJson from '../src/data/mesbg-data.json';
import { arrivalAuto, rollArrival } from '../src/shared/narrative.ts';
import { chargeSabotage, reliefArrives, reliefDue } from '../src/shared/helms.ts';
import { shrugOff, towersAfter } from '../src/shared/towers.ts';
import { markModel } from '../src/shared/marking.ts';
import { legionsArrive, legionsDue, wakeDue, wakeUp } from '../src/shared/amon.ts';
import { goblinTide, tideDue, trample as trollTramples, trampleDue, trollDue, trollEnters } from '../src/shared/balin.ts';
import { dawnDue, reinforceDue, rollDawn, rollReinforcements as companyArrives } from '../src/shared/mutton.ts';
import { bondsDue, rollBonds } from '../src/shared/ambush.ts';
import { isMonster } from '../src/shared/monsters.ts';
import { chronicled, listenDue, listenFor, longbeardFor, trumpetDue } from '../src/shared/company.ts';
import { sauronDue, sauronRoll } from '../src/shared/ring.ts';
import { cutWebs, webDue } from '../src/shared/unseen.ts';
import { elvesArrive, elvesDue, hazeDue, hazeRolls, nestDue, nestReturn } from '../src/shared/elves.ts';
import { alarmDue, alarmRaised } from '../src/shared/lake.ts';
import { mightyBonus, mightyDue } from '../src/shared/mighty.ts';
import { longshanksDue, longshanksMove } from '../src/shared/sam.ts';
import { burnDue, burns } from '../src/shared/fire.ts';

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
const SEAT_KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** How long a player's seat is kept for them after they leave a battle, before anyone else may take it. */
const SEAT_HELD_MS = Number(process.env.SEAT_HELD_MS ?? 1000 * 60 * 10);
/** How often the server checks each connection is still there; one that misses two checks in a row is dropped. */
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 15_000);
/** The build of the browser code this server hands out, so browsers left open from an older build know to reload. */
const BUILD = (() => {
  try {
    return readFileSync(join(DIST, 'build-id.txt'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
})();

interface Client {
  ws: WebSocket;
  role: Role;
  tokens: number;
  /** Answered since the last heartbeat check. */
  alive: boolean;
  /** The signed-in account behind this browser, once checked. */
  account?: Account;
  /** A sign-in being checked right now. */
  verifying?: Promise<void>;
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
  /** How many actions have been sent out, so a browser can tell if it missed one. */
  seq: number;
  /** Actions held back to go out together in one message (the Palantír's instant moves). */
  batch?: Action[];
  /** Each seat's private key once the battle has started, so only the player sitting there can come back to it. */
  seats: Partial<Record<Seat, string>>;
  /** When someone last sat in each seat, so a seat left empty long enough opens up again. */
  seatSeen: Record<Seat, number>;
  /** When a player was last at the table (not loaded from a save), so a game whose host stepped away stays in the list. */
  lastSeated?: number;
  /** Nothing has changed since the game was loaded, so it can be fetched again in case another server saved it since. */
  fresh: boolean;
  /** Saving to the shared store: changes not yet saved, the turn and phase last saved, the next save, and the save in flight. */
  cloud: { dirty: boolean; mark?: string; timer?: NodeJS.Timeout; chain: Promise<void> };
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

/** This server's own copy of a game, used when the shared store isn't set up or can't be reached. */
function readDisk(id: string): StoredRoom | null {
  const file = join(DATA, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return { state: saved, invite: saved?._invite, voice: saved?._voice };
  } catch (err) {
    console.warn(`Could not read saved room ${id}:`, err);
    return null;
  }
}

/** Puts a saved game (or a new one) into a room. */
function unpack(saved: StoredRoom | null) {
  let state = initialState();
  let invite: string | undefined;
  let voice: string | undefined;
  const seats: Partial<Record<Seat, string>> = {};
  if (saved) {
    try {
      const kept = (saved.state as { _seats?: Record<string, unknown> } | null)?._seats;
      for (const seat of ['p1', 'p2'] as const) if (typeof kept?.[seat] === 'string' && SEAT_KEY.test(kept[seat])) seats[seat] = kept[seat];
      state = loadState(saved.state);
      if (typeof saved.invite === 'string' && INVITE.test(saved.invite)) invite = saved.invite;
      if (typeof saved.voice === 'string') voice = saved.voice;
    } catch (err) {
      console.warn('Could not read a saved game:', err);
    }
  }
  // A private game whose code was lost can't be joined by anyone, so it opens up again.
  if (state.private && !invite) state = reduce(state, { type: 'setPrivate', private: false });
  return { state, invite, voice: voice ? { id: voice } : undefined, blank: !saved, seats, seatSeen: { p1: Date.now(), p2: Date.now() } };
}

/** Rooms being fetched from the store right now, so people arriving together share one fetch. */
const opening = new Map<string, Promise<Room>>();

/**
 * The room for a game: from memory, else from the shared store, else from this server's disk, else a new one. A room
 * nothing has changed in yet is fetched again, because during a deploy the server going away saves its games as it
 * stops, after this one may already have loaded them.
 */
function openRoom(id: string): Promise<Room> {
  const room = rooms.get(id);
  if (room && !(room.fresh && storeEnabled())) return Promise.resolve(room);
  let pending = opening.get(id);
  if (!pending) {
    pending = (async () => {
      const stored = await loadRoom(id);
      const current = rooms.get(id);
      if (current) {
        if (stored && current.fresh) {
          Object.assign(current, unpack(stored));
          for (const c of current.clients) sendSnapshot(c.ws, current);
        }
        return current;
      }
      const made: Room = { id, clients: new Set(), touched: Date.now(), undo: { p1: [], p2: [] }, seen: Date.now(), seq: 0, fresh: true, cloud: { dirty: false, chain: Promise.resolve() }, ...unpack(stored ?? readDisk(id)) };
      rooms.set(id, made);
      return made;
    })().finally(() => opening.delete(id));
    opening.set(id, pending);
  }
  return pending;
}

/** The game and its private details, as saved. Seat keys go inside the saved game, which only this server reads. */
const packed = (room: Room): StoredRoom => ({ state: Object.keys(room.seats).length ? { ...room.state, _seats: room.seats } : room.state, ...(room.invite ? { invite: room.invite } : {}), ...(room.voice?.id ? { voice: room.voice.id } : {}) });

function scheduleSave(room: Room) {
  room.touched = Date.now();
  room.fresh = false;
  scheduleCloudSave(room);
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = undefined;
    const { state, invite, voice } = packed(room);
    writeFileSync(join(DATA, `${room.id}.json`), JSON.stringify({ ...(state as object), ...(invite ? { _invite: invite } : {}), ...(voice ? { _voice: voice } : {}) }));
  }, 2000);
}

/** At most this often while a game is changing, the shared store gets a fresh copy. */
const CLOUD_SAVE_MS = Number(process.env.CLOUD_SAVE_MS ?? 5000);
/** The turn and phase, so moving on to a new phase saves straight away. */
const phaseMark = (s: GameState) => `${s.turn}:${s.phase}:${s.flow.started ? 1 : 0}:${s.result ? 1 : 0}`;

function scheduleCloudSave(room: Room) {
  if (!storeEnabled()) return;
  room.cloud.dirty = true;
  if (phaseMark(room.state) !== room.cloud.mark) {
    void cloudSave(room);
    return;
  }
  room.cloud.timer ??= setTimeout(() => void cloudSave(room), CLOUD_SAVE_MS);
}

/** Saves the room to the shared store if it has changed, after any save already on its way. */
function cloudSave(room: Room): Promise<void> {
  clearTimeout(room.cloud.timer);
  room.cloud.timer = undefined;
  room.cloud.chain = room.cloud.chain.then(async () => {
    if (!room.cloud.dirty) return;
    room.cloud.dirty = false;
    const mark = phaseMark(room.state);
    if (await saveRoom(room.id, packed(room))) room.cloud.mark = mark;
    else {
      // Try again shortly; the game carries on meanwhile.
      room.cloud.dirty = true;
      room.cloud.timer ??= setTimeout(() => void cloudSave(room), CLOUD_SAVE_MS * 2);
    }
  });
  return room.cloud.chain;
}

const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const players = (room: Room) => [...room.clients].map(c => c.role);
const broadcast = (room: Room, msg: ServerMessage) => {
  const data = JSON.stringify(msg);
  for (const c of room.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
};
/** Sends out an action already applied to the room, numbered so every browser applies each one exactly once, in order. */
const broadcastAction = (room: Room, action: Action) => {
  if (room.batch) {
    room.batch.push(action);
    room.seq++;
  } else broadcast(room, { type: 'action', action, seq: ++room.seq });
};
/** Sends out the actions held back, as one message so browsers update the table once. */
function flushBatch(room: Room) {
  const batch = room.batch;
  room.batch = undefined;
  if (!batch?.length) return;
  const first = room.seq - batch.length + 1;
  broadcast(room, batch.length === 1 ? { type: 'action', action: batch[0], seq: first } : { type: 'actions', actions: batch, seq: first });
}
/** The whole game as it stands, for a browser joining or catching up. */
const sendSnapshot = (ws: WebSocket, room: Room) => send(ws, { type: 'snapshot', state: room.state, players: players(room), blank: room.blank, seq: room.seq, build: BUILD });

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
  const ours = (id: unknown) => mine(id) || (!!state.bot && typeof id === 'string' && state.models[id]?.owner === state.bot);
  switch (action.type) {
    case 'rolled':
    case 'backAway':
    case 'courageTaken':
    case 'arrive':
    case 'spendWill':
    case 'spellPending':
    case 'affect':
    case 'recovered':
    case 'revert':
    case 'undo':
    case 'priorityRolled':
    case 'fateRolled':
    case 'uncovered':
    case 'seatAccount':
    case 'setPrivate':
    case 'resultSaved':
    case 'startNarrative':
    case 'narrativeNote':
    case 'burned':
    case 'ringMark':
    case 'skittering':
    case 'sentried':
    case 'placing':
    case 'mightyHero':
    case 'entering':
    case 'usedTurn':
    case 'freeHeroic':
    case 'freeMove':
    case 'heard':
    case 'dieRerolled':
    case 'listen':
    case 'chronicle':
    case 'deployRolled':
    case 'warbandDown':
      return null; // only the server produces dice results, undo changes and account details
    case 'gameOver':
      return null;
    case 'startGame':
      // Not until the scenario's objectives are on the table, and everything set out in turn is down.
      return objectivesMissing(state) || !deployReady(state) ? null : { type: 'startGame', at: Date.now() };
    case 'pickSide':
    case 'placeMarker':
    case 'markerDone':
    case 'warbandDone':
      // Each player takes their own turn at setting up (the game checks it is theirs).
      return action.seat === client.role ? action : null;
    case 'updateTerrain':
      // While objective markers are placed in turn, only the player placing one moves it.
      if (!state.flow.started && state.flow.deploy && state.terrain[action.id]?.kind === 'objective' && state.flow.deploy.turn !== client.role) return null;
      return state.flow.started ? null : action;
    case 'addTerrain':
    case 'removeTerrain':
    case 'setScenery':
    case 'setBoard':
    case 'setScenario':
    case 'setPhase':
    case 'setPriority':
    case 'loadState':
      // The table, the scenario and the turn are fixed once the battle starts: the game keeps them right from then on.
      if (state.flow.started) return null;
      return action.type === 'loadState' ? { type: 'loadState', state: { ...loadState(action.state), log: [], accounts: state.accounts, result: undefined, private: state.private, listed: state.private ? false : loadState(action.state).listed } } : action;
    case 'proposeResult':
    case 'concede':
    case 'answerResult': {
      // Only the player in that seat, and the signed-in one if the seat has an account.
      const seat = action.seat;
      if (seat !== client.role) return null;
      const owner = state.accounts?.[seat];
      return !owner || owner.id === client.account?.id ? action : null;
    }
    case 'declareHeroic': {
      // A hero may declare the universal heroic actions, and the others on its profile. A Heroic Challenge names an
      // enemy hero of the same tier or higher, and the Might it can win back is capped at its starting Might.
      const m = state.models[String(action.model)];
      if (!m || !mine(m.id)) return null;
      const unit = m.profileId ? CATALOG.units[m.profileId] : undefined;
      if (state.flow.started && !mayDeclare(state, m, String(action.action), unit?.heroics, rulesFor(CATALOG, m))) return null;
      // Nor one it can't use now: out of range of anything, or out of the fight it is about.
      if (heroicBlocked(state, CATALOG, m, String(action.action))) return null;
      if (action.action !== 'Heroic Challenge') return { type: 'declareHeroic', model: m.id, action: action.action };
      const t = state.models[String(action.target)];
      if (!t || !challengeRivals(state, CATALOG, m).some(e => e.id === t.id)) return null;
      return { type: 'declareHeroic', model: m.id, action: action.action, target: t.id, cap: startingPoints(CATALOG, m)?.might ?? m.might };
    }
    case 'answerChallenge':
      return mine(action.target) ? action : null;
    case 'fightChoice':
      return ours(action.id) ? action : null;
    case 'heroicOrder':
    case 'willOfEvil':
    case 'shotPaused':
    case 'bannerRolled':
    case 'brutal':
    case 'trampled':
    case 'breached':
      return null;
    case 'pushTower':
      // Only for the side pushing it.
      return action.seat === client.role ? action : null; // the server rolls for these and settles them
    case 'board':
      return mine(action.id) && (!action.beast || mine(action.beast)) ? action : null;
    case 'takeWound':
    case 'climb':
    case 'crawl':
    case 'lieDown':
      return mine(action.id) ? action : null;
    case 'crossed': {
      // A player may only wade into a stream it was stopped at (passing the other tests is the server's to say).
      const b = state.flow.blocked?.[String(action.id)];
      return mine(action.id) && b?.test === 'Leap' && !action.stop ? { type: 'crossed', id: action.id, terrain: b.terrain } : null;
    }
    case 'pickUp':
    case 'flip':
    case 'escape':
      return mine(action.model) ? action : null;
    case 'drop': {
      const carrier = state.terrain[action.marker]?.carrier;
      return mine(carrier) ? action : null;
    }
    case 'setPick':
    case 'reliefPoint':
      return action.seat === client.role ? action : null;
    case 'pairOff':
      // Only the player with Priority pairs off the fights.
      return state.priority === client.role ? action : null;
    case 'setBotSpeed':
      return action;
    case 'setBotInstantMoves':
      return client.role === 'p1' || client.role === 'p2' ? action : null;
    case 'setAdvance':
      return client.role === 'p1' || client.role === 'p2' ? action : null;
    case 'skitterDone':
      // Said by the player moving the Spider (or for the computer, by its server).
      return state.flow.skitter && (state.flow.skitter.by === client.role || state.flow.skitter.by === state.bot) && action.seat === state.flow.skitter.by ? action : null;
    case 'compel':
      // The game starts a Compel; the caster's player says when they've finished moving the model.
      return action.compel === null && state.flow.compel && state.models[state.flow.compel.caster]?.owner === client.role ? action : null;
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
      // Not while Óin's player is deciding whether to listen through his trumpet.
      return action.seat === client.role && !trumpetDue(state, CATALOG) ? action : null;
    case 'moveModels':
      // Each player moves only their own models (and the Palantír's, in a solo game, so they can deploy it and back its
      // models away after a fight). While the armies are set up in turn, the Palantír places its own.
      if (!Array.isArray(action.moves)) return null;
      if (!state.flow.started && state.flow.deploy) return { ...action, moves: action.moves.filter(mv => mine(mv?.id)) };
      return {
        ...action,
        moves: action.moves.filter(mv => {
          // A Compelled model is moved by the caster's player, not its own.
          const compel = state.flow.compel;
          if (compel && mv?.id === compel.model) return state.models[compel.caster]?.owner === client.role || (!!state.bot && state.models[compel.caster]?.owner === state.bot);
          // A Spider moving its D6" under the Power of the Ring is moved by whichever player won its test.
          const sk = state.flow.skitter;
          if (sk && mv?.id === sk.model) return sk.by === client.role || (!!state.bot && sk.by === state.bot);
          return mine(mv?.id) || (!!state.bot && state.models[mv?.id]?.owner === state.bot);
        }),
      };
    case 'updateModel':
      // Each player changes only their own models (and the Palantír's, in a solo game), and never a base size.
      return ours(action.id) && !(action.patch && typeof action.patch === 'object' && 'base' in action.patch) ? action : null;
    case 'removeModels':
      // Taking models off is for setting up: once the battle starts the game decides who is slain.
      if (state.flow.started || !Array.isArray(action.ids)) return null;
      return action.ids.every(ours) ? action : null;
    case 'addModels':
      // Each player deploys only their own army (and the Palantír's, in a solo game); reinforcements arrive by the game.
      if (state.flow.started || !Array.isArray(action.models)) return null;
      return action.models.every(m => m?.owner === client.role || (!!state.bot && m?.owner === state.bot)) ? action : null;
    case 'wound': {
      // Wounds go on your own model, or on an enemy your models struck. (Whether it shrugs any off is the game's to roll.)
      const { checked: _checked, ...wound } = action;
      if (!state.flow.started) return wound;
      return ours(action.id) || (Array.isArray(action.by) && action.by.some(ours)) ? wound : null;
    }
    case 'placed':
      // Only the player placing the model says it's done.
      return action.seat === client.role || action.seat === state.bot ? action : null;
    case 'setName':
    case 'endActivation':
      // Your own name, and the end of your own move or shooting.
      return !state.flow.started || action.seat === client.role || action.seat === state.bot ? action : null;
    case 'choosePriority':
      // Only the player who won the roll decides who has Priority (once the other has said whether Balin re-rolls it).
      if (client.role !== 'p1' && client.role !== 'p2') return null;
      if (longbeardFor(state, CATALOG, client.role === 'p1' ? 'p2' : 'p1')) return null;
      return !state.flow.chooser || state.flow.chooser === client.role ? action : null;
    default:
      return action;
  }
}

/**
 * Whether a browser may sit in a seat. Before the battle anyone may; once it starts, only the browser holding the
 * seat's key, the signed-in player it belongs to, or anyone at all once its player has been gone a while.
 */
function maySit(room: Room, client: Client, seat: Seat, key: unknown): 'yes' | 'abandoned' | 'no' {
  const held = room.seats[seat];
  if (!room.state.flow.started || !held || key === held) return 'yes';
  const owner = room.state.accounts?.[seat];
  if (owner && client.account?.id === owner.id) return 'yes';
  const empty = ![...room.clients].some(c => c !== client && c.role === seat);
  return empty && Date.now() - room.seatSeen[seat] > SEAT_HELD_MS ? 'abandoned' : 'no';
}

/** Hands a seat's key to everyone sitting in it, making one if the seat has none yet (or was taken over). */
function giveSeatKey(room: Room, seat: Seat, fresh = false) {
  if (!room.state.flow.started) return;
  if (fresh || !room.seats[seat]) {
    room.seats[seat] = randomBytes(18).toString('base64url');
    scheduleSave(room);
  }
  for (const c of room.clients) if (c.role === seat) send(c.ws, { type: 'seatKey', seat, key: room.seats[seat]! });
}

/** How long a listed game stays open after its last player stepped away (to the home page, say). */
const OPEN_GRACE_MS = 15 * 60_000;

/** Listed games with a player at the table now or in the last few minutes, most recently active first. */
function openRooms(): RoomSummary[] {
  const now = Date.now();
  return [...rooms.values()]
    .filter(r => r.state.listed && !r.state.private && !r.state.result && ([...r.clients].some(c => c.role !== 'spectator') || now - (r.lastSeated ?? 0) < OPEN_GRACE_MS))
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
        ...(r.state.narrative ? { narrative: r.state.narrative.id } : {}),
        turn: r.state.turn,
        models: Object.keys(r.state.models).length,
        started: r.state.flow.started,
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
  // A war beast or chariot must move if it can: one its side left standing goes straight on as the side ends its move.
  if (action.type === 'endActivation' && (action.seat === 'p1' || action.seat === 'p2') && !room.state.flow.done.includes(action.seat))
    for (const m of chargesDue(room.state, CATALOG, action.seat)) {
      const out = trample(room.state, CATALOG, action.seat, { type: 'trample', id: m.id, ...(m.stampede ? straightOn(m) : chargeAim(room.state, CATALOG, m)) }, serverDice, serverId, Date.now());
      for (const a of out ?? []) apply(room, a);
    }
  // Models that fly, cross terrain specially, beat a war drum or ride a mount are marked as they come onto the table.
  if ((action.type === 'addModels' || action.type === 'startNarrative') && Array.isArray(action.models))
    action = {
      ...action,
      models: action.models.map((m: Model) => markModel(CATALOG, m)),
    };
  // Wounds a Berserker or a Horse Lord's mount may shrug off are rolled for first (see towers.ts).
  if (action.type === 'wound' && !action.checked) {
    const instead = shrugOff(room.state, CATALOG, action, serverDice, serverId, Date.now());
    if (instead) {
      for (const a of instead) apply(room, a);
      return;
    }
  }
  const before = room.state;
  room.state = reduce(room.state, action);
  broadcastAction(room, action);
  scheduleSave(room);
  // Ori's Chronicler: a friend of the Company near him that slays an enemy hero or monster may get a point back.
  if (Object.values(room.state.models).some(m => m.dead && before.models[m.id] && !before.models[m.id].dead)) {
    const deeds = chronicled(before, room.state, CATALOG, m => isMonster(CATALOG, m));
    if (deeds.length) apply(room, { type: 'chronicle', add: deeds });
  }
  // Haldir's One Final Blow, and Might won back by the Royal Standard of Rohan.
  for (const a of towersAfter(before, room.state, CATALOG, serverDice, serverId, Date.now())) apply(room, a);
  // The game declares its own winner as soon as it's over (and corrects it if the score changes before both confirm).
  if (action.type !== 'gameOver') {
    const winner = gameWinner(room.state);
    if (winner) {
      const before = room.state;
      room.state = reduce(room.state, { type: 'gameOver', winner });
      if (room.state !== before) broadcastAction(room, { type: 'gameOver', winner });
    }
  }
  settleSpells(room);
  rollRiderTests(room);
  rollBeastTests(room);
  sabotageEngines(room);
  rollBrokenTests(room);
  rollReinforcements(room);
  rollGameEnd(room);
  rollRecovery(room);
  takeWillOfEvil(room);
  narrativeUpkeep(room);
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

/** Rolls the Thrown Rider test for a rider whose mount fell, and the Courage test for a mount that lost its rider. */
let rollingRiders = false;
function rollRiderTests(room: Room) {
  if (rollingRiders || !riderTestsDue(room.state)) return;
  rollingRiders = true;
  try {
    for (const a of riderTests(room.state, CATALOG, serverDice, serverId)) apply(room, a);
  } finally {
    rollingRiders = false;
  }
}

/** Rolls a wounded war beast's Stampede tests, and the falls of those riding a beast or Howdah that is destroyed. */
let rollingBeasts = false;
function rollBeastTests(room: Room) {
  if (rollingBeasts || !beastTestsDue(room.state)) return;
  rollingBeasts = true;
  try {
    for (const a of beastTests(room.state, CATALOG, serverDice, serverId)) apply(room, a);
  } finally {
    rollingBeasts = false;
  }
}

/** As the turn ends, an enemy that did nothing this turn but stand beside a siege engine disables it. */
let sabotaging = false;
function sabotageEngines(room: Room) {
  if (sabotaging) return;
  const out = [...sabotageActions(room.state, serverId), ...chargeSabotage(room.state, serverId)];
  if (!out.length) return;
  sabotaging = true;
  try {
    for (const a of out) apply(room, a);
  } finally {
    sabotaging = false;
  }
}

/** Puts into play a cast that Might lifted and nobody can resist. */
function settleSpells(room: Room) {
  if (!spellReady(room.state)) return;
  for (const a of settleSpell(room.state, CATALOG, serverDice, serverId)) apply(room, a);
}

/** In the End phase, models with Will of Evil that fought give up a Will point. */
let takingWill = false;
function takeWillOfEvil(room: Room) {
  if (takingWill || !willOfEvilDue(room.state)) return;
  takingWill = true;
  try {
    for (const a of willOfEvilToll(room.state, CATALOG, serverId)) apply(room, a);
  } finally {
    takingWill = false;
  }
}

/**
 * The rules the game plays out by itself: a narrative scenario's late arrivals, Sauron's Will on a Ringbearer as its
 * side begins to move, and the flames of models Set Ablaze in the End phase.
 */
let upkeeping = false;
function narrativeUpkeep(room: Room) {
  if (upkeeping) return;
  upkeeping = true;
  try {
    const s = room.state;
    const bearer = sauronDue(s, CATALOG);
    const sam = longshanksDue(s);
    const out = mightyDue(s, CATALOG) ? mightyBonus(s, CATALOG, serverId) : sam ? longshanksMove(s, sam) : arrivalAuto(s) ? rollArrival(s, serverDice, serverId) : reinforceDue(s) ? companyArrives(s, serverDice, serverId) : bondsDue(s) ? rollBonds(s, serverDice, serverId) : trollDue(s) ? trollEnters(s, serverId) : trampleDue(s) ? trollTramples(s, CATALOG, serverDice, serverId) : tideDue(s) ? goblinTide(s, serverId) : legionsDue(s) ? legionsArrive(s, serverDice, serverId) : wakeDue(s) ? wakeUp(s, serverDice, serverId) : reliefDue(s) ? reliefArrives(s, serverId) : listenDue(s, CATALOG) ? listenFor(s, CATALOG) : dawnDue(s) ? rollDawn(s, serverDice, serverId) : webDue(s) ? cutWebs(s, serverDice, serverId) : nestDue(s) ? nestReturn(s, serverId) : hazeDue(s) ? hazeRolls(s, serverDice, serverId) : elvesDue(s) ? elvesArrive(s, serverId) : alarmDue(s) ? alarmRaised(s, serverId) : bearer ? sauronRoll(s, bearer, serverDice, serverId) : burnDue(s) ? burns(s, CATALOG, serverDice, serverId) : [];
    for (const a of out) apply(room, a);
  } finally {
    upkeeping = false;
  }
  if (mightyDue(room.state, CATALOG) || longshanksDue(room.state) || arrivalAuto(room.state) || reinforceDue(room.state) || bondsDue(room.state) || trollDue(room.state) || trampleDue(room.state) || tideDue(room.state) || legionsDue(room.state) || wakeDue(room.state) || reliefDue(room.state) || listenDue(room.state, CATALOG) || dawnDue(room.state) || webDue(room.state) || nestDue(room.state) || hazeDue(room.state) || elvesDue(room.state) || alarmDue(room.state) || sauronDue(room.state, CATALOG) || burnDue(room.state)) narrativeUpkeep(room);
}

/** In the End phase, Paralysed models roll to recover. */
let recovering = false;
function rollRecovery(room: Room) {
  if (recovering || !recoveryDue(room.state)) return;
  recovering = true;
  try {
    for (const a of recoveryRolls(room.state, serverDice, serverId)) apply(room, a);
  } finally {
    recovering = false;
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
  const out = resolveRequest(room.state, room.state.priority ?? 'p1', { type: 'roll', count: 1, label: endRollLabel(room.state.turn) }, serverDice, serverId, Date.now(), CATALOG);
  for (const a of out?.apply ?? []) apply(room, a);
}

/** How long a finished Fight or End phase stays up before play moves on, so the last result can be seen. */
const ADVANCE_PAUSE = 1500;

/** Moves on from a Fight or End phase with nothing left to do in it, after a short pause. */
function scheduleAdvance(room: Room) {
  if (room.advance || room.state.advance === 'click' || !phaseFinished(room.state)) return;
  const at = `${room.state.turn}:${room.state.phase}`;
  room.advance = setTimeout(() => {
    room.advance = undefined;
    // Only if it's still the same phase and still over (someone may have moved on, or backed a model into a fight).
    if (`${room.state.turn}:${room.state.phase}` === at && phaseFinished(room.state)) apply(room, { type: 'nextPhase' });
    else scheduleAdvance(room);
  }, ADVANCE_PAUSE * (room.state.bot ? BOT_PACE[room.state.botSpeed ?? 'normal'] : 1));
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
    const test = terrorTest(m, enemy, CATALOG, serverDice, serverId, Date.now(), room.state);
    for (const a of test.actions) apply(room, a);
    return test.pass;
  });
  return moves.length ? { ...action, moves } : null;
}

const BOT_PAUSE = 500;

/** Lines up the computer's next step, if it plays in this game and someone is here to see it. */
function scheduleBot(room: Room, delay = BOT_PAUSE * BOT_PACE[room.state.botSpeed ?? 'normal']) {
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
  }, Math.max(30, delay));
}

/** How long the computer may spend on one run of instant moves before sending them out and letting others have a turn. */
const BATCH_MS = 300;

/** Plays the computer's next step: one move, roll or choice, then a pause before the next. */
function runBot(room: Room) {
  const seat = room.state.bot;
  const bot = room.bot;
  if (!seat || !bot) return;
  const think = () => {
    try {
      return botStep(room.state, seat, CATALOG, bot.memo);
    } catch (err) {
      console.warn('The computer player failed a step:', err);
      return null;
    }
  };
  let step = think();
  if (!step) return;
  bot.busy = true;
  let pause: number;
  // With Instant moves, the moves that follow go straight on and out together, a short slice at a time.
  if (room.state.botInstantMoves) room.batch ??= [];
  const until = performance.now() + BATCH_MS;
  try {
    pause = playBotStep(room, seat, step);
    while (pause === 0 && performance.now() < until && (step = think())) pause = playBotStep(room, seat, step);
  } finally {
    bot.busy = false;
    flushBatch(room);
  }
  if (step) scheduleBot(room, pause);
}

/** Does one of the computer's steps, and says how long to wait before the next. */
function playBotStep(room: Room, seat: Seat, step: BotStep): number {
  let pause = botPause(room.state, step);
  const action = step.action;
  if (action && DICE_REQUESTS.has(action.type)) {
    const out = resolveRequest(room.state, seat, action, () => randomInt(1, 7), () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`, Date.now(), CATALOG);
    for (const a of [...(out?.apply ?? []), ...(out?.record ? [out.record] : [])]) apply(room, a);
  } else if (action) {
    const log = room.state.log;
    const moved = testTerror(room, action);
    // A Courage roll for terror still gets its usual pause, so it can be seen.
    if (room.state.log !== log) pause = Math.max(pause, step.delay * BOT_PACE[room.state.botSpeed ?? 'normal']);
    if (moved) apply(room, moved);
  }
  return pause;
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

const MAX_SOCKETS_PER_ADDRESS = Number(process.env.MAX_SOCKETS_PER_ADDRESS ?? 60);
const MAX_NEW_ROOMS_PER_ADDRESS = Number(process.env.MAX_NEW_ROOMS_PER_ADDRESS ?? 60);
const NEW_ROOM_WINDOW_MS = 1000 * 60 * 10;
/** Open connections, and recently opened new games, for each address. */
const sockets = new Map<string, number>();
const newRooms = new Map<string, number[]>();
setInterval(() => {
  for (const [from, times] of newRooms) if (!times.some(t => Date.now() - t < NEW_ROOM_WINDOW_MS)) newRooms.delete(from);
}, NEW_ROOM_WINDOW_MS).unref();

/**
 * The visitor's address. Behind Render's proxies the socket's own address is the proxy's, so the address the proxies
 * pass on comes first. A visitor can fake these headers, but only to dodge the limits, never to block anyone else.
 */
function addressOf(req: import('node:http').IncomingMessage): string {
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  };
  return header('cf-connecting-ip') || header('true-client-ip') || header('x-forwarded-for') || req.socket.remoteAddress || 'unknown';
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const roomId = (url.searchParams.get('room') ?? '').toLowerCase();
  if (!ROOM_ID.test(roomId)) {
    send(ws, { type: 'error', message: 'Invalid room name' });
    ws.close();
    return;
  }
  if (stopping) {
    ws.close(1012, 'Server restarting');
    return;
  }
  if (!rooms.has(roomId) && rooms.size + opening.size >= MAX_ROOMS) {
    send(ws, { type: 'error', message: 'The server is full right now. Try again in a few minutes.' });
    ws.close();
    return;
  }
  // One address can't hog the server: limits on open connections and on new games, generous enough for a shop's wifi.
  const from = addressOf(req);
  const mine = (sockets.get(from) ?? 0) + 1;
  const made = !rooms.has(roomId) ? (newRooms.get(from) ?? []).filter(t => Date.now() - t < NEW_ROOM_WINDOW_MS) : null;
  if (mine > MAX_SOCKETS_PER_ADDRESS || (made && made.length >= MAX_NEW_ROOMS_PER_ADDRESS)) {
    console.warn(`Turned away a connection from ${from}: too many ${made && made.length >= MAX_NEW_ROOMS_PER_ADDRESS ? 'new games' : 'connections'}`);
    send(ws, { type: 'error', message: 'Too many games open from your connection. Close some tabs and try again in a few minutes.' });
    ws.close();
    return;
  }
  sockets.set(from, mine);
  ws.once('close', () => {
    const n = (sockets.get(from) ?? 1) - 1;
    if (n > 0) sockets.set(from, n);
    else sockets.delete(from);
  });
  if (made) newRooms.set(from, [...made, Date.now()]);
  // Anything the browser sends while its game is being fetched waits its turn.
  const early: import('ws').RawData[] = [];
  const hold = (data: import('ws').RawData) => void (early.length < 100 && early.push(data));
  ws.on('message', hold);
  let room: Room;
  try {
    room = await openRoom(roomId);
  } catch (err) {
    console.warn(`Could not open room ${roomId}:`, err);
    ws.close(1011);
    return;
  }
  ws.off('message', hold);
  if (ws.readyState !== WebSocket.OPEN) return;
  const client: Client = { ws, role: 'spectator', tokens: 120, alive: true };
  room.clients.add(client);
  sendSnapshot(ws, room);
  ws.on('pong', () => (client.alive = true));

  const handle = (data: import('ws').RawData) => {
    try {
      onMessage(data);
    } catch (err) {
      // One bad message must never take the server (and everyone's games) down.
      console.warn('Ignored a message that failed:', err);
    }
  };
  ws.on('message', handle);

  const onMessage = (data: import('ws').RawData) => {
    client.alive = true;
    // While saving to stop, nothing more changes; the browser catches up from the new server.
    if (stopping) return;
    // Simple rate limit: refills 60 messages per second, bursts up to 120.
    if (client.tokens <= 0) return;
    client.tokens--;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      // The browser checking its link is still alive.
      send(ws, { type: 'pong' });
      return;
    }
    if (msg.type === 'sync') {
      // A browser that missed an action, or couldn't apply one, catches up from the whole game.
      sendSnapshot(ws, room);
      return;
    }
    if (msg.type === 'hello') {
      client.role = msg.role === 'p1' || msg.role === 'p2' ? msg.role : 'spectator';
      let takeover = false;
      if (client.role !== 'spectator') {
        const may = maySit(room, client, client.role, msg.seatKey);
        // Still checking who this is: their account may own the seat, so decide once that's known.
        if (may === 'no' && client.verifying) {
          void client.verifying.then(() => onMessage(data));
          return;
        }
        if (may === 'no') {
          client.role = 'spectator';
          send(ws, { type: 'seatRefused', message: 'Someone is already playing that side. If that was you on another device, sign in with the same account, or wait: a seat opens up again after 10 minutes away. Until then you can watch.' });
        }
        takeover = may === 'abandoned';
      }
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
      // Someone taking over an abandoned seat can't take back the last player's moves.
      if (client.role !== 'spectator' && takeover) room.undo[client.role] = [];
      if (client.role !== 'spectator') sendUndoDepth(room, client.role);
      if (client.role !== 'spectator') giveSeatKey(room, client.role, takeover);
      seatAccount(room, client);
      scheduleBot(room);
      // A game loaded after a restart may have been about to move on from a finished phase.
      scheduleAdvance(room);
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
      client.verifying = verifyToken(msg.token)
        .then(account => {
          client.account = account ?? undefined;
          seatAccount(room, client);
        })
        .finally(() => (client.verifying = undefined));
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
      const out = resolveRequest(room.state, client.role, msg.action, () => randomInt(1, 7), () => `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`, Date.now(), CATALOG);
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
      // Each new battle gets new seat keys, handed to whoever is sitting down for it.
      room.seats = {};
      for (const seat of ['p1', 'p2'] as const) giveSeatKey(room, seat);
      // A new game in the same room gets a voice channel of its own.
      if (room.voice && !room.voice.id && !room.voice.opening) {
        room.voice = undefined;
        updateVoice(room);
      }
    }
  };

  ws.on('close', () => {
    room.clients.delete(client);
    if (client.role !== 'spectator') room.lastSeated = Date.now();
    broadcast(room, { type: 'presence', players: players(room) });
  });
  for (const data of early) handle(data);
});

// Keep connections alive through proxies that drop idle sockets, and drop any that have stopped answering
// (a phone that lost signal never says goodbye), so the other player sees them leave.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}, HEARTBEAT_MS).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.clients) c.tokens = Math.min(120, c.tokens + 60);
    if ([...room.clients].some(c => c.role !== 'spectator')) room.seen = room.lastSeated = Date.now();
    for (const c of room.clients) if (c.role !== 'spectator') room.seatSeen[c.role] = Date.now();
    if (room.voice?.id && (Date.now() > (room.voice.closeAt ?? Infinity) || Date.now() - room.seen > VOICE_ABANDONED_MS)) closeVoice(room);
    if (room.clients.size === 0 && Date.now() - room.touched > 1000 * 60 * 30) {
      closeVoice(room);
      if (room.cloud.dirty) void cloudSave(room);
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
  void pruneRooms(ROOM_TTL_MS);
}, 1000 * 60 * 60).unref();

/**
 * On a deploy or restart, Render asks the server to stop: save every game first, then tell browsers the server is
 * restarting so they reconnect (to the new server, which loads the games just saved).
 */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: saving games before stopping`);
  server.close();
  for (const room of rooms.values()) {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      room.saveTimer = undefined;
      try {
        const { state, invite, voice } = packed(room);
        writeFileSync(join(DATA, `${room.id}.json`), JSON.stringify({ ...(state as object), ...(invite ? { _invite: invite } : {}), ...(voice ? { _voice: voice } : {}) }));
      } catch (err) {
        console.warn(`Could not save room ${room.id} to disk:`, err);
      }
    }
    clearTimeout(room.advance);
    if (room.bot?.timer) clearTimeout(room.bot.timer);
  }
  const saves = Promise.all([...rooms.values()].filter(r => r.cloud.dirty).map(r => cloudSave(r)));
  await Promise.race([saves, new Promise(done => setTimeout(done, 20_000))]);
  for (const c of wss.clients) c.close(1012, 'Server restarting');
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(PORT, () => console.log(`MESBG VTT listening on http://localhost:${PORT}`));
