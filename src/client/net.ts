import { useSyncExternalStore } from 'react';
import { initialState, loadState, reduce } from '../shared/reducer.ts';
import { addMark, PING_MS } from '../shared/marks.ts';
import type { Action, GameState, Mark, Role, ServerMessage } from '../shared/types.ts';

const SAVE_PREFIX = 'mesbg-save:';
const MAX_SAVES = 10;

/** This browser's last copy of a game, used to bring it back if the server restarts and forgets it. */
function readSave(room: string): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + room);
    return raw ? loadState(JSON.parse(raw).state) : null;
  } catch {
    return null;
  }
}

function writeSave(room: string, state: GameState) {
  try {
    localStorage.setItem(SAVE_PREFIX + room, JSON.stringify({ at: Date.now(), state }));
    // Keep only the most recent games.
    const saves: [string, number][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SAVE_PREFIX)) continue;
      try {
        saves.push([key, JSON.parse(localStorage.getItem(key) ?? '{}').at ?? 0]);
      } catch {
        saves.push([key, 0]);
      }
    }
    saves.sort((a, b) => b[1] - a[1]);
    for (const [key] of saves.slice(MAX_SAVES)) localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the game still works, it just can't be restored.
  }
}

const INVITE_PREFIX = 'mesbg-invite:';
/** The invite code this browser holds for a private game, from an invite link or from being seated when it was made private. */
function readInvite(room: string): string | null {
  try {
    return localStorage.getItem(INVITE_PREFIX + room);
  } catch {
    return null;
  }
}
function writeInvite(room: string, code: string | null) {
  try {
    if (code) localStorage.setItem(INVITE_PREFIX + room, code);
    else localStorage.removeItem(INVITE_PREFIX + room);
  } catch {
    // Storage blocked: the code only lasts for this visit.
  }
}

const SEAT_PREFIX = 'mesbg-seat:';
/** The key to this browser's seat in a room's battle, which lets it back into that seat. */
function readSeatKey(room: string): { seat: string; key: string } | null {
  try {
    const raw = localStorage.getItem(SEAT_PREFIX + room);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSeatKey(room: string, seat: string, key: string) {
  try {
    localStorage.setItem(SEAT_PREFIX + room, JSON.stringify({ seat, key }));
  } catch {
    // Storage blocked: the seat is still yours until you close the tab.
  }
}

/** Whether a game has anything worth bringing back. */
const worthKeeping = (s: GameState) => s.flow.started || Object.keys(s.models).length > 0 || Object.keys(s.terrain).length > 0;

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** How often an open link is checked, and how long an answer may take before the link counts as dropped. */
const CHECK_EVERY_MS = 5_000;
const ANSWER_WITHIN_MS = 10_000;

/**
 * What to do with an action numbered `seq` when the last one applied was `last`: apply it, skip it (already in the
 * game), or ask for the whole game again because one went missing. Unnumbered actions (an older server) are applied.
 */
export function actionFits(last: number, seq: number | undefined): 'apply' | 'skip' | 'gap' {
  if (seq === undefined) return 'apply';
  if (seq <= last) return 'skip';
  return seq === last + 1 ? 'apply' : 'gap';
}

/** Whether this page is older than the code the server now hands out, so it should reload. Never in development. */
export const staleBuild = (mine: string, server: string | undefined) => !!server && server !== 'dev' && mine !== 'dev' && server !== mine;

export interface Snapshot {
  state: GameState;
  status: ConnectionStatus;
  players: Role[];
  /** How many of this player's changes can be undone. */
  undoDepth: number;
  /** This browser's invite code for the room, if it has one. */
  invite?: string | null;
  /** Why the seat you asked for was refused (a private game without its invite). */
  refused?: string;
  /** Pings and arrows on the table right now. */
  marks?: Mark[];
  /** Has been connected before, so a dropped link is a reconnection rather than the first connection. */
  wasOnline?: boolean;
}

/** Puts a mark on the table, taking a ping off again once it has faded. */
export function showMark(get: () => Snapshot, set: (p: Partial<Snapshot>) => void, mark: Mark) {
  set({ marks: addMark(get().marks ?? [], mark) });
  if (mark.kind === 'ping') setTimeout(() => set({ marks: (get().marks ?? []).filter(m => m.id !== mark.id) }), PING_MS);
}

/** Arrows are for planning the turn at hand, so they go when a new turn starts. */
export const turnMarks = (before: GameState, after: GameState, marks: Mark[] | undefined) =>
  after.turn !== before.turn && marks?.some(m => m.kind === 'arrow') ? { marks: marks.filter(m => m.kind !== 'arrow') } : {};

/** What the game screen needs from a game: the live server room, or a practice game in the browser. */
export interface Connection {
  readonly room: string;
  subscribe: (l: () => void) => () => void;
  getSnapshot: () => Snapshot;
  dispatch(action: Action): void;
  setRole(role: Role): void;
  /** The player's sign-in token, so the server can tell who is in each seat. */
  setToken?(token: string | null): void;
  /** Makes the game invite-only, or open to anyone again. */
  setPrivate?(on: boolean): void;
  /** Shows everyone a ping or an arrow, or takes your arrows away. */
  mark(mark: Pick<Mark, 'kind' | 'x' | 'y' | 'x2' | 'y2'>): void;
  clearMarks(): void;
  close(): void;
}

/** Keeps this browser's copy of a room in step with the server, reconnecting when the link drops. */
export class RoomConnection implements Connection {
  private ws?: WebSocket;
  private listeners = new Set<() => void>();
  private retry = 0;
  private closed = false;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private checkTimer?: ReturnType<typeof setInterval>;
  /** When the unanswered link check went out, if one is waiting. */
  private asked?: number;
  /** The number of the last action applied. */
  private seq = 0;
  /** Waiting for the whole game after missing an action. */
  private syncing = false;
  private token: string | null = null;
  private snap: Snapshot = { state: initialState(), status: 'connecting', players: [], undoDepth: 0 };

  constructor(
    readonly room: string,
    private role: Role,
  ) {
    // Arriving by invite link: keep the code, and take it out of the address bar so it isn't passed on by accident.
    const url = new URL(location.href);
    const code = url.searchParams.get('invite');
    if (code) {
      writeInvite(room, code);
      url.searchParams.delete('invite');
      history.replaceState(null, '', url);
    }
    this.snap.invite = readInvite(room);
    this.connect();
    this.checkTimer = setInterval(this.check, CHECK_EVERY_MS);
    addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
  }

  private connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.asked = undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}`);
    this.ws = ws;
    this.set({ status: 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      // Who you are first, so a signed-in player can be let back into their seat from another device.
      if (this.token) ws.send(JSON.stringify({ type: 'identify', token: this.token }));
      this.hello();
    };
    ws.onmessage = ev => {
      // Anything from the server shows the link is alive.
      this.asked = undefined;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'snapshot') {
        if (staleBuild(__BUILD_ID__, msg.build) && this.reload(msg.build!)) return;
        this.seq = msg.seq ?? 0;
        this.syncing = false;
        this.set({ state: loadState(msg.state), players: msg.players, status: 'online', wasOnline: true });
        const saved = msg.blank && this.role !== 'spectator' ? readSave(this.room) : null;
        if (saved && worthKeeping(saved)) ws.send(JSON.stringify({ type: 'restore', state: saved, invite: this.snap.invite ?? undefined }));
      } else if (msg.type === 'mark') showMark(this.getSnapshot, p => this.set(p), msg.mark);
      else if (msg.type === 'clearMarks') this.set({ marks: (this.snap.marks ?? []).filter(m => m.by !== msg.by) });
      else if (msg.type === 'action') {
        if (this.syncing) return;
        const fits = actionFits(this.seq, msg.seq);
        if (fits === 'skip') return;
        if (fits === 'gap') return this.resync();
        let state: GameState;
        try {
          state = reduce(this.snap.state, msg.action);
        } catch (err) {
          console.warn('Could not apply a change from the server; fetching the whole game again.', err);
          return this.resync();
        }
        if (msg.seq !== undefined) this.seq = msg.seq;
        this.set({ state, ...turnMarks(this.snap.state, state, this.snap.marks) });
        this.scheduleSave();
      } else if (msg.type === 'presence') this.set({ players: msg.players });
      else if (msg.type === 'undo') this.set({ undoDepth: msg.count });
      else if (msg.type === 'invite') {
        writeInvite(this.room, msg.code);
        this.set({ invite: msg.code });
      } else if (msg.type === 'seatKey') writeSeatKey(this.room, msg.seat, msg.key);
      else if (msg.type === 'seatRefused') this.set({ refused: msg.message });
      else if (msg.type === 'error') console.warn(msg.message);
    };
    ws.onclose = () => this.lost(ws);
  }

  /** The link is gone: show it, and try again after a pause that grows with each failed attempt. */
  private lost(ws: WebSocket) {
    if (ws !== this.ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    this.ws = undefined;
    this.set({ status: 'offline' });
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(10_000, 500 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Asks the server for the whole game, after missing a change or failing to apply one. */
  private resync() {
    if (this.syncing || this.ws?.readyState !== WebSocket.OPEN) return;
    this.syncing = true;
    this.ws.send(JSON.stringify({ type: 'sync' }));
  }

  /** Reloads onto the server's newer code, once per build, keeping the seat (it's remembered per room). */
  private reload(build: string) {
    const key = `mesbg-reloaded:${build}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch {
      return false;
    }
    if (worthKeeping(this.snap.state)) writeSave(this.room, this.snap.state);
    this.close();
    location.reload();
    return true;
  }

  /**
   * Checks the link every few seconds. A phone that loses signal often never sees the link close, so a check the
   * server doesn't answer counts as a dropped link. Timed from the check itself, so a background tab's slowed timers
   * don't make a healthy link look dead.
   */
  private check = () => {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.asked === undefined) {
      this.asked = Date.now();
      ws.send(JSON.stringify({ type: 'ping' }));
    } else if (Date.now() - this.asked > ANSWER_WITHIN_MS) {
      ws.close();
      this.lost(ws);
    }
  };

  /** Back online, or back to this tab: reconnect straight away rather than waiting out the pause, or check the link. */
  private wake = () => {
    if (this.closed || document.visibilityState === 'hidden') return;
    if (!this.ws) {
      this.retry = 0;
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN && this.asked === undefined) {
      this.asked = Date.now();
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  };

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      if (worthKeeping(this.snap.state)) writeSave(this.room, this.snap.state);
    }, 1500);
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private hello() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const held = readSeatKey(this.room);
    const seatKey = held?.seat === this.role ? held.key : undefined;
    this.ws.send(JSON.stringify({ type: 'hello', role: this.role, invite: this.snap.invite ?? undefined, seatKey }));
  }

  setRole(role: Role) {
    this.role = role;
    this.set({ undoDepth: 0, refused: undefined });
    this.hello();
  }

  setPrivate(on: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'privacy', private: on }));
  }

  setToken(token: string | null) {
    if (token === this.token) return;
    this.token = token;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'identify', token }));
  }

  dispatch(action: Action) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'action', action }));
  }

  mark(mark: Pick<Mark, 'kind' | 'x' | 'y' | 'x2' | 'y2'>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'mark', mark }));
  }

  clearMarks() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'clearMarks' }));
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snap;

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.checkTimer);
    removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    this.ws?.close();
  }
}

export function useRoom(conn: Connection) {
  return useSyncExternalStore(conn.subscribe, conn.getSnapshot, conn.getSnapshot);
}
