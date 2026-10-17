import { useSyncExternalStore } from 'react';
import { initialState, loadState, reduce } from '../shared/reducer.ts';
import type { Action, GameState, Role, ServerMessage } from '../shared/types.ts';

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
      if (msg.type === 'snapshot') this.set({ state: loadState(msg.state), players: msg.players, status: 'online' });
      else if (msg.type === 'action') this.set({ state: reduce(this.snap.state, msg.action) });
      else if (msg.type === 'presence') this.set({ players: msg.players });
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
