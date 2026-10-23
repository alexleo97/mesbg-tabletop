import { breachesLeft } from './breach.ts';
import { combats } from './flow.ts';
import { heroicsSettled } from './heroics.ts';
import { fightDone, fightsAgain } from './movement.ts';
import { recoveryDue } from './powers.ts';
import { endCheck, endRollLabel, gameEnded } from './status.ts';
import { webDue } from './unseen.ts';
import type { GameState } from './types.ts';

// The Fight and End phases move on by themselves once there's nothing left to do in them, so nobody has to click
// Next twice a turn. The server waits a moment first, so the last roll can be seen.

/** The End phase needs its game-end roll (a scenario where a Broken army ends the game on a 1-2), not yet rolled. */
export function endRollDue(state: GameState): boolean {
  if (!state.flow.started || state.result || state.phase !== 'end') return false;
  return !!endCheck(state, { p1: '', p2: '' })?.rollNeeded && !state.log.some(r => r.label === endRollLabel(state.turn));
}

/** Whether the phase is over and play can go on to the next one without anyone clicking. */
export function phaseFinished(state: GameState): boolean {
  if (!state.flow.started || state.result) return false;
  if (state.phase === 'fight') {
    if (!heroicsSettled(state) || combats(state).some(c => !fightDone(state, c))) return false;
    // A hero who won a Heroic Combat (or a monster that barged) may move and fight again: that's the player's call.
    // So may anyone still able to strike at a gate or swing a ram.
    return !Object.values(state.models).some(m => fightsAgain(state, m)) && !breachesLeft(state);
  }
  if (state.phase === 'end') return !endRollDue(state) && !recoveryDue(state) && !webDue(state) && !gameEnded(state);
  return false;
}
