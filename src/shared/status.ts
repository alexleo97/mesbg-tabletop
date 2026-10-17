import { scenarioById } from './scenarios.ts';
import type { GameState, Seat } from './types.ts';

export interface ArmyStatus {
  start: number;
  lost: number;
  left: number;
  /** More than half of the starting models lost (the Break Point is half the starting army). */
  broken: boolean;
  /** Down to 25% or fewer of the starting models. */
  quartered: boolean;
}

/** Counts each army from the models on the table, with casualties still counted towards its starting size. */
export function armyStatus(state: GameState, seat: Seat): ArmyStatus {
  const all = Object.values(state.models).filter(m => m.owner === seat);
  const lost = all.filter(m => m.dead).length;
  const start = all.length;
  return { start, lost, left: start - lost, broken: start > 0 && lost * 2 > start, quartered: start > 0 && (start - lost) * 4 <= start };
}

/** How a scenario ends: at 25%, by a D6 roll once an army is Broken, or when both armies are at 25% (artefact games). */
export type EndRule = 'quartered' | 'broken-roll' | 'both-quartered';

export function endRule(scenarioId: string | null): EndRule | null {
  const text = scenarioById(scenarioId)?.gameEnd ?? '';
  if (/Broken, roll a D6/i.test(text)) return 'broken-roll';
  if (/both armies are down to 25%/i.test(text)) return 'both-quartered';
  if (/25%/.test(text)) return 'quartered';
  return null;
}

export interface EndCheck {
  /** The game is over at the end of this turn. */
  over: boolean;
  /** A D6 must be rolled to see if the game ends (1-2 ends it). */
  rollNeeded: boolean;
  reason: string;
}

/** What the end-of-turn checks say for the current state. */
export function endCheck(state: GameState, names: Record<Seat, string>): EndCheck | null {
  const rule = endRule(state.scenario);
  if (!rule) return null;
  const s = { p1: armyStatus(state, 'p1'), p2: armyStatus(state, 'p2') };
  const seats = ['p1', 'p2'] as const;
  if (rule === 'broken-roll') {
    const broken = seats.filter(x => s[x].broken);
    return broken.length
      ? { over: false, rollNeeded: true, reason: `${broken.map(x => names[x]).join(' and ')} ${broken.length > 1 ? 'are' : 'is'} Broken, so roll a D6: on a 1-2 the game ends.` }
      : null;
  }
  const quartered = seats.filter(x => s[x].quartered);
  if (rule === 'both-quartered') {
    return quartered.length === 2 ? { over: true, rollNeeded: false, reason: 'Both armies are down to 25%, so the game ends.' } : null;
  }
  return quartered.length
    ? { over: true, rollNeeded: false, reason: `${quartered.map(x => names[x]).join(' and ')} ${quartered.length > 1 ? 'are' : 'is'} down to 25% or fewer, so the game ends this turn.` }
    : null;
}
