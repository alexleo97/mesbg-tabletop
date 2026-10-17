import { useState } from 'react';
import { scenarioById, vpTotal } from '../shared/scenarios.ts';
import { armyStatus, endCheck } from '../shared/status.ts';
import type { Action, GameState, Role, Seat } from '../shared/types.ts';

const SEATS = ['p1', 'p2'] as const;

/** Start- and end-of-turn reminders: which armies are Broken, and whether the scenario has ended. */
export function StatusBanner({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role }) {
  const [hidden, setHidden] = useState('');
  const names = { p1: state.names.p1 || 'Player 1', p2: state.names.p2 || 'Player 2' };
  const key = `${state.turn}-${state.phase}`;
  if (hidden === key) return null;

  const lines: React.ReactNode[] = [];
  if (state.phase === 'priority') {
    for (const s of SEATS) {
      const a = armyStatus(state, s);
      if (a.broken) lines.push(<p key={s}><b className={s}>{names[s]}</b>’s army is Broken ({a.lost} of {a.start} lost). Each of its models takes a Courage test when it activates and flees on a fail.</p>);
    }
  }
  const check = state.phase === 'end' ? endCheck(state, names) : null;
  const rollLabel = `Game end roll, turn ${state.turn} (1-2 ends)`;
  const endRoll = [...state.log].reverse().find(r => r.label === rollLabel);
  const over = check?.over || (endRoll && endRoll.dice[0] <= 2);
  if (check) lines.push(<p key="end">{check.reason}</p>);
  if (check?.rollNeeded && !endRoll)
    lines.push(
      <button key="roll" className="primary" disabled={role === 'spectator'} onClick={() => dispatch({ type: 'roll', count: 1, label: rollLabel })}>
        Roll for game end
      </button>,
    );
  if (endRoll) lines.push(<p key="rolled">Rolled a <b>{endRoll.dice[0]}</b>: {endRoll.dice[0] <= 2 ? 'the game ends.' : 'play another turn.'}</p>);
  if (over && scenarioById(state.scenario)) {
    const vp = { p1: vpTotal(state.vp.p1), p2: vpTotal(state.vp.p2) };
    const lead: Seat | null = vp.p1 === vp.p2 ? null : vp.p1 > vp.p2 ? 'p1' : 'p2';
    lines.push(
      <p key="result" className="result">
        Final score {names.p1} {vp.p1} – {vp.p2} {names.p2}: {lead ? `${names[lead]} wins.` : 'a draw.'}
      </p>,
    );
  }
  if (!lines.length) return null;
  return (
    <div className="status-banner" role="status">
      <button className="close" onClick={() => setHidden(key)} aria-label="Dismiss">✕</button>
      {lines}
    </div>
  );
}

/** Small top-bar tags for armies that are currently Broken. */
export function BrokenTags({ state }: { state: GameState }) {
  return (
    <>
      {SEATS.filter(s => armyStatus(state, s).broken).map(s => (
        <span key={s} className={`broken-tag ${s}`} title="More than half the army is lost">
          {state.names[s] || (s === 'p1' ? 'P1' : 'P2')} broken
        </span>
      ))}
    </>
  );
}
