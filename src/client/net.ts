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

/** Whether a game has anything worth bringing back. */
const worthKeeping = (s: GameState) => s.flow.started || Object.keys(s.models).length > 0 || Object.keys(s.terrain).length > 0;

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

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
  }

  private connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}`);
    this.ws = ws;
    this.set({ status: 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      this.hello();
      if (this.token) ws.send(JSON.stringify({ type: 'identify', token: this.token }));
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === 'snapshot') {
        this.set({ state: loadState(msg.state), players: msg.players, status: 'online' });
        const saved = msg.blank && this.role !== 'spectator' ? readSave(this.room) : null;
        if (saved && worthKeeping(saved)) ws.send(JSON.stringify({ type: 'restore', state: saved, invite: this.snap.invite ?? undefined }));
      } else if (msg.type === 'mark') showMark(this.getSnapshot, p => this.set(p), msg.mark);
      else if (msg.type === 'clearMarks') this.set({ marks: (this.snap.marks ?? []).filter(m => m.by !== msg.by) });
      else if (msg.type === 'action') {
        const state = reduce(this.snap.state, msg.action);
        this.set({ state, ...turnMarks(this.snap.state, state, this.snap.marks) });
        this.scheduleSave();
      } else if (msg.type === 'presence') this.set({ players: msg.players });
      else if (msg.type === 'undo') this.set({ undoDepth: msg.count });
      else if (msg.type === 'invite') {
        writeInvite(this.room, msg.code);
        this.set({ invite: msg.code });
      } else if (msg.type === 'seatRefused') this.set({ refused: msg.message });
      else if (msg.type === 'error') console.warn(msg.message);
    };
    ws.onclose = () => {
      this.set({ status: 'offline' });
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

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
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'hello', role: this.role, invite: this.snap.invite ?? undefined }));
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
    this.ws?.close();
  }
}

export function useRoom(conn: Connection) {
  return useSyncExternalStore(conn.subscribe, conn.getSnapshot);
}
