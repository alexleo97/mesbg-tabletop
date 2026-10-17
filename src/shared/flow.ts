// The turn sequence as the app runs it: who acts now, who rolls for priority, and which fights are on.
import { distanceBetween } from './geometry.ts';
import type { GameState, Model, Seat } from './types.ts';

export const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/**
 * Bases this close count as touching. Real base contact is 0", but dragging on a phone is rough,
 * so a little slack stops a fight being missed because a model stopped a hair short.
 */
export const CONTACT_SLACK = 0.2;

export interface Combat {
  /** Stable id for this group of models, so a resolved fight stays ticked off. */
  key: string;
  p1: string[];
  p2: string[];
}

/** Groups models in base contact with enemies into fights (models touching several enemies join one fight). */
export function combats(state: GameState): Combat[] {
  const alive = Object.values(state.models).filter(m => !m.dead);
  const p1 = alive.filter(m => m.owner === 'p1');
  const p2 = alive.filter(m => m.owner === 'p2');
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const engaged = new Set<string>();
  for (const a of p1) {
    for (const b of p2) {
      // Cheap reject first: no base is wider than about 4".
      if (Math.abs(a.x - b.x) > 5 || Math.abs(a.y - b.y) > 5) continue;
      if (distanceBetween(a, b) > CONTACT_SLACK) continue;
      engaged.add(a.id).add(b.id);
      parent.set(find(a.id), find(b.id));
    }
  }
  const groups = new Map<string, Model[]>();
  for (const m of alive) {
    if (!engaged.has(m.id)) continue;
    const root = find(m.id);
    groups.set(root, [...(groups.get(root) ?? []), m]);
  }
  return [...groups.values()].map(ms => {
    const ids = (s: Seat) => ms.filter(m => m.owner === s).map(m => m.id).sort();
    return { key: [...ids('p1'), '|', ...ids('p2')].join(','), p1: ids('p1'), p2: ids('p2') };
  });
}

/**
 * Who chooses priority from a roll-off. On turn 1 a tie is re-rolled (null); later a tie goes to
 * the player who didn't choose last turn.
 */
export function priorityChooser(dice: [number, number], turn: number, lastChooser: Seat | null): Seat | null {
  if (dice[0] !== dice[1]) return dice[0] > dice[1] ? 'p1' : 'p2';
  if (turn <= 1 || !lastChooser) return null;
  return other(lastChooser);
}

/** In the Move and Shoot phases, the player who should be activating models now (priority first). */
export function activeSeat(state: GameState): Seat | null {
  if (state.phase !== 'move' && state.phase !== 'shoot') return null;
  const first = state.priority ?? 'p1';
  if (!state.flow.done.includes(first)) return first;
  const second = other(first);
  return state.flow.done.includes(second) ? null : second;
}
