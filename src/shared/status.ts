import { scenarioById } from './scenarios.ts';
import { vpTotals } from './scoring.ts';
import { narrativeWinner } from './narrative.ts';
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
  // A mount fighting on without its rider isn't counted: the cavalry model was lost when its rider fell. Nor is a
  // siege engine (its crew are).
  const all = Object.values(state.models).filter(m => m.owner === seat && !m.steed && !m.siege);
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
    const artefacts = Object.values(state.terrain).filter(t => t.object === 'artefact');
    if (artefacts.length && artefacts.every(t => t.gone === 'off')) return { over: true, rollNeeded: false, reason: 'Every Artefact has left the table, so the game ends.' };
    return quartered.length === 2 ? { over: true, rollNeeded: false, reason: 'Both armies are down to 25%, so the game ends.' } : null;
  }
  return quartered.length
    ? { over: true, rollNeeded: false, reason: `${quartered.map(x => names[x]).join(' and ')} ${quartered.length > 1 ? 'are' : 'is'} down to 25% or fewer, so the game ends this turn.` }
    : null;
}

export const endRollLabel = (turn: number) => `Game end roll, turn ${turn} (1-2 ends)`;

/** Whether the game has ended this turn: the scenario's end condition is met, or its end roll came up 1-2. */
export function gameEnded(state: GameState): boolean {
  if (state.phase !== 'end' || !state.flow.started) return false;
  const check = endCheck(state, { p1: '', p2: '' });
  if (check?.over) return true;
  const roll = [...state.log].reverse().find(r => r.label === endRollLabel(state.turn));
  return !!check?.rollNeeded && !!roll && roll.dice[0] <= 2;
}

/**
 * Who won, once the game is over: an army wiped out loses, otherwise the scenario's victory points decide.
 * Null while the game is still going.
 */
export function gameWinner(state: GameState): Seat | 'draw' | null {
  if (!state.flow.started) return null;
  // A narrative scenario is won by its own objectives, the moment one side achieves them.
  if (state.narrative) return narrativeWinner(state);
  const left = { p1: armyStatus(state, 'p1'), p2: armyStatus(state, 'p2') };
  if (left.p1.start && left.p2.start) {
    const gone = (['p1', 'p2'] as const).filter(s => left[s].left === 0);
    if (gone.length === 2) return 'draw';
    if (gone.length === 1) return gone[0] === 'p1' ? 'p2' : 'p1';
  }
  if (!scenarioById(state.scenario) || !gameEnded(state)) return null;
  const vp = vpTotals(state);
  return vp.p1 === vp.p2 ? 'draw' : vp.p1 > vp.p2 ? 'p1' : 'p2';
}
