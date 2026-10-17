import { useState } from 'react';
import { activeSeat, other, type Combat } from '../shared/flow.ts';
import { scenarioById, vpTotal } from '../shared/scenarios.ts';
import { armyStatus, endCheck } from '../shared/status.ts';
import { PHASES, type Action, type GameState, type Role, type Seat } from '../shared/types.ts';

const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { priority: 'Priority', move: 'Move', shoot: 'Shoot', fight: 'Fight', end: 'End' };

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  role: Role;
  combats: Combat[];
  openTab: (t: 'army' | 'table') => void;
  openFight: (key: string) => void;
}

/** The turn guide: says what happens now, whose go it is, and offers the next step as one button. */
export function CoachBar({ state, dispatch, role, combats, openTab, openFight }: Props) {
  const [small, setSmall] = useState(false);
  const name = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const Who = ({ s, mid }: { s: Seat; mid?: boolean }) => <b className={s}>{s === role ? (mid ? 'you' : 'You') : name(s)}</b>;
  const me = role === 'spectator' ? null : role;
  const { flow } = state;

  let title: React.ReactNode;
  let body: React.ReactNode;

  if (!flow.started) {
    const count = (s: Seat) => Object.values(state.models).filter(m => m.owner === s).length;
    const scenario = scenarioById(state.scenario);
    title = 'Set up the battle';
    body = (
      <>
        <ol className="setup-steps">
          <li className={scenario ? 'ok' : ''}>
            <span>{scenario ? scenario.name : 'Pick a scenario, or play without one'}</span>
            <button onClick={() => openTab('table')}>Scenario</button>
          </li>
          <li className={Object.keys(state.terrain).length ? 'ok' : ''}>
            <span>{Object.keys(state.terrain).length ? `${Object.keys(state.terrain).length} pieces of terrain` : 'Lay out the terrain'}</span>
            <button onClick={() => openTab('table')}>Board</button>
          </li>
          <li className={count('p1') && count('p2') ? 'ok' : ''}>
            <span>
              Armies: <b className="p1">{name('p1')}</b> {count('p1')} · <b className="p2">{name('p2')}</b> {count('p2')}
            </span>
            <button onClick={() => openTab('army')}>Army</button>
          </li>
          <li>
            <span>Deploy each army in its zone{scenario ? ' (shown on the board)' : ''}.</span>
          </li>
        </ol>
        {me && (
          <button className="primary go" onClick={() => dispatch({ type: 'startGame' })}>
            Start the battle
          </button>
        )}
      </>
    );
  } else if (state.phase === 'priority') {
    title = 'Priority';
    const rolled = flow.chooserTurn === state.turn && flow.chooser;
    if (!rolled) {
      body = (
        <>
          <p>Both players roll a D6. The winner chooses who has Priority this turn and acts first in each phase.</p>
          {me && (
            <button className="primary go" onClick={() => dispatch({ type: 'rollPriority' })}>
              Roll for priority
            </button>
          )}
        </>
      );
    } else if (!state.priority) {
      const c = flow.chooser!;
      const tie = flow.roll && flow.roll[0] === flow.roll[1];
      body = (
        <>
          <p>
            {flow.roll && (
              <>
                Rolled <b className="p1">{flow.roll[0]}</b>–<b className="p2">{flow.roll[1]}</b>
                {tie ? ', a tie, so the choice passes over. ' : '. '}
              </>
            )}
            <Who s={c} /> {c === role ? 'choose' : 'chooses'} who has Priority.
          </p>
          {me === c && (
            <div className="row">
              <button className="primary go" onClick={() => dispatch({ type: 'choosePriority', seat: c })}>
                Take priority
              </button>
              <button onClick={() => dispatch({ type: 'choosePriority', seat: other(c) })}>Give it to {name(other(c))}</button>
            </div>
          )}
        </>
      );
    }
    // Armies that went past their Break Point are Broken from the start of this turn.
    const broken = (['p1', 'p2'] as const).filter(s => armyStatus(state, s).broken);
    if (broken.length)
      body = (
        <>
          {body}
          {broken.map(s => (
            <p key={s} className="warn">
              <Who s={s} /> {s === role ? 'are' : 'is'} Broken: each model takes a Courage test when it activates and flees if it fails.
            </p>
          ))}
        </>
      );
  } else if (state.phase === 'move' || state.phase === 'shoot') {
    const act = activeSeat(state);
    const verb = state.phase === 'move' ? 'moving' : 'shooting';
    title = `${PHASE_LABEL[state.phase]} · ${name(state.priority ?? 'p1')} has priority`;
    const broken = act && armyStatus(state, act).broken;
    body = act ? (
      <>
        <p>
          {state.phase === 'move' ? (
            <>
              Heroic actions are declared first. Then <Who s={act} mid /> {act === role ? 'move' : 'moves'} each model up to its Move. Enemy control zones (1") can only be entered to charge.
            </>
          ) : (
            <>
              <Who s={act} /> {act === role ? 'shoot' : 'shoots'}. Select a model with a missile weapon, then tap its target. Models that moved more than half their Move can't shoot.
            </>
          )}
        </p>
        {broken && (
          <p className="warn">
            <Who s={act} /> {act === role ? 'are' : 'is'} Broken: as each model activates, tap it and roll Courage on its card. A model that fails flees.
          </p>
        )}
        {me === act ? (
          <button className="primary go" onClick={() => dispatch({ type: 'endActivation', seat: act })}>
            Done {verb}
          </button>
        ) : (
          <p className="muted">Waiting for {name(act)} to finish {verb}.</p>
        )}
      </>
    ) : null;
  } else if (state.phase === 'fight') {
    title = `Fight · ${name(state.priority ?? 'p1')} picks the order`;
    const open = combats.filter(c => !flow.resolved.includes(c.key));
    const label = (c: Combat) => {
      const n = (ids: string[]) => (ids.length === 1 ? state.models[ids[0]]?.name : `${state.models[ids[0]]?.name} +${ids.length - 1}`);
      return `${n(c.p1)} vs ${n(c.p2)}`;
    };
    body = (
      <>
        {combats.length === 0 && <p>No models are in base contact, so there are no fights this turn.</p>}
        {combats.length > 0 && (
          <div className="fight-list">
            {combats.map(c => (
              <button key={c.key} className={flow.resolved.includes(c.key) ? 'done' : ''} onClick={() => openFight(c.key)}>
                {flow.resolved.includes(c.key) ? '✓ ' : '⚔ '}
                {label(c)}
              </button>
            ))}
          </div>
        )}
        {me && (
          <button className={open.length ? 'go' : 'primary go'} onClick={() => dispatch({ type: 'nextPhase' })}>
            {open.length ? `End fights (${open.length} not rolled)` : 'End the Fight phase'}
          </button>
        )}
      </>
    );
  } else {
    title = 'End of turn';
    const names = { p1: name('p1'), p2: name('p2') };
    const check = endCheck(state, names);
    const rollLabel = `Game end roll, turn ${state.turn} (1-2 ends)`;
    const endRoll = [...state.log].reverse().find(r => r.label === rollLabel);
    const over = check?.over || (endRoll !== undefined && endRoll.dice[0] <= 2);
    const vp = { p1: vpTotal(state.vp.p1), p2: vpTotal(state.vp.p2) };
    const lead: Seat | null = vp.p1 === vp.p2 ? null : vp.p1 > vp.p2 ? 'p1' : 'p2';
    body = (
      <>
        {scenarioById(state.scenario) && !over && <p>Score any victory points the scenario gives at the end of a turn in the Table tab.</p>}
        {check && <p className="warn">{check.reason}</p>}
        {check?.rollNeeded && !endRoll && me && (
          <button className="primary go" onClick={() => dispatch({ type: 'roll', count: 1, label: rollLabel })}>
            Roll for game end
          </button>
        )}
        {endRoll && (
          <p>
            Rolled a <b>{endRoll.dice[0]}</b>: {endRoll.dice[0] <= 2 ? 'the game ends.' : 'play another turn.'}
          </p>
        )}
        {over ? (
          <p className="result">
            Game over.{' '}
            {scenarioById(state.scenario) ? `${names.p1} ${vp.p1} – ${vp.p2} ${names.p2}: ${lead ? `${names[lead]} wins.` : 'a draw.'}` : ''}
          </p>
        ) : (
          me &&
          (!check?.rollNeeded || endRoll) && (
            <button className="primary go" onClick={() => dispatch({ type: 'nextPhase' })}>
              Start turn {state.turn + 1}
            </button>
          )
        )}
      </>
    );
  }

  return (
    <section className={`coach ${small ? 'small' : ''}`} aria-label="Turn guide">
      <div className="coach-head">
        {flow.started && (
          <ol className="phase-dots" aria-label="Turn phases">
            <li className="turn">T{state.turn}</li>
            {PHASES.map(p => (
              <li key={p} className={state.phase === p ? 'on' : PHASES.indexOf(p) < PHASES.indexOf(state.phase) ? 'past' : ''}>
                {PHASE_LABEL[p]}
              </li>
            ))}
          </ol>
        )}
        <h3>{title}</h3>
        <button className="coach-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show turn guide' : 'Hide turn guide'}>
          {small ? '▴' : '▾'}
        </button>
      </div>
      {!small && <div className="coach-body">{body}</div>}
    </section>
  );
}
