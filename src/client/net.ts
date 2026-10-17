import { useSyncExternalStore } from 'react';
import { initialState, loadState, reduce } from '../shared/reducer.ts';
import type { Action, GameState, Role, ServerMessage } from '../shared/types.ts';

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

/** Whether a game has anything worth bringing back. */
const worthKeeping = (s: GameState) => s.flow.started || Object.keys(s.models).length > 0 || Object.keys(s.terrain).length > 0;

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface Snapshot {
  state: GameState;
  status: ConnectionStatus;
  players: Role[];
  /** How many of this player's changes can be undone. */
  undoDepth: number;
}

/** Keeps this browser's copy of a room in step with the server, reconnecting when the link drops. */
export class RoomConnection {
  private ws?: WebSocket;
  private listeners = new Set<() => void>();
  private retry = 0;
  private closed = false;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private snap: Snapshot = { state: initialState(), status: 'connecting', players: [], undoDepth: 0 };

  constructor(
    readonly room: string,
    private role: Role,
  ) {
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
      ws.send(JSON.stringify({ type: 'hello', role: this.role }));
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === 'snapshot') {
        this.set({ state: loadState(msg.state), players: msg.players, status: 'online' });
        const saved = msg.blank && this.role !== 'spectator' ? readSave(this.room) : null;
        if (saved && worthKeeping(saved)) ws.send(JSON.stringify({ type: 'restore', state: saved }));
      } else if (msg.type === 'action') {
        this.set({ state: reduce(this.snap.state, msg.action) });
        this.scheduleSave();
      } else if (msg.type === 'presence') this.set({ players: msg.players });
      else if (msg.type === 'undo') this.set({ undoDepth: msg.count });
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

  setRole(role: Role) {
    this.role = role;
    this.set({ undoDepth: 0 });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'hello', role }));
  }

  dispatch(action: Action) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'action', action }));
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

export function useRoom(conn: RoomConnection) {
  return useSyncExternalStore(conn.subscribe, conn.getSnapshot);
}
