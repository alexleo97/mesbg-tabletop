import { useState } from 'react';
import { other } from '../shared/flow.ts';
import { narrativeById, NARRATIVES, type Side } from '../shared/narrative.ts';
import { BOT_NAME, type Action, type GameState, type Role, type Seat } from '../shared/types.ts';

type Dispatch = (a: Action) => void;

/** The narrative scenarios in the scenario list, as options of their own group. */
export function NarrativeOptions() {
  return (
    <optgroup label="Narrative">
      {NARRATIVES.map(n => (
        <option key={n.id} value={`n:${n.id}`}>
          {n.name}
        </option>
      ))}
    </optgroup>
  );
}

/**
 * A narrative scenario: who plays which side (you pick, and the other player or the Palantír takes the rest), then
 * the story's table, cast, objectives and special rules.
 */
export function NarrativePanel({ state, dispatch, role, id }: { state: GameState; dispatch: Dispatch; role: Role; id: string }) {
  const n = narrativeById(id);
  const [asking, setAsking] = useState(false);
  if (!n) return null;
  const set = state.narrative?.id === n.id;
  const seat: Seat | null = role === 'p1' || role === 'p2' ? role : null;
  const fixed = !seat || state.flow.started;
  const nameOf = (s: Seat) => (state.bot === s ? BOT_NAME : s === seat ? 'You' : state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2'));
  const play = (side: Side) => {
    if (!seat) return;
    if (Object.keys(state.models).length && !set && !asking) {
      setAsking(true);
      return;
    }
    setAsking(false);
    dispatch({ type: 'setNarrative', id: n.id, good: side === 'good' ? seat : other(seat) });
  };
  const sideSeat = (side: Side): Seat | undefined => (set ? (side === 'good' ? state.narrative!.good : other(state.narrative!.good)) : undefined);
  return (
    <div className="narrative">
      <p className="muted small">Narrative scenario from {n.from}. The cast and the table are the story's own.</p>
      <h4>Choose your side</h4>
      <div className="narrative-sides">
        {(['good', 'evil'] as const).map(side => {
          const at = sideSeat(side);
          const mine = !!at && at === seat;
          return (
            <button key={side} className={`side-card ${side} ${mine ? 'on' : ''}`} disabled={fixed || mine} aria-pressed={mine} onClick={() => play(side)}>
              <b>{n.sides[side].name}</b>
              <span>{n.sides[side].cast}</span>
              <small>{at ? nameOf(at) : side === 'good' ? 'Good' : 'Evil'}</small>
            </button>
          );
        })}
      </div>
      {asking && <p className="warn">This takes the armies and terrain off the table to set up {n.name}. Pick your side again to go ahead.</p>}
      {!set && !fixed && <p className="fine">{state.bot ? `${BOT_NAME} plays the other side.` : 'Your opponent plays the other side.'}</p>}

      <h4>Objectives</h4>
      <p>{n.objectives}</p>
      <h4>The table</h4>
      <p>
        {n.board.w}"×{n.board.h}". {n.layout}
      </p>
      <h4>Starting positions</h4>
      <p>{n.deployment}</p>
      <h4>Special rules</h4>
      {n.rules.map(r => (
        <p key={r.name} className="small">
          <b>{r.name}:</b> {r.text}
        </p>
      ))}
      <p className="fine">Our own shorthand of the narrative scenario; the game plays its rules for you.</p>
    </div>
  );
}

/** In the army step of a narrative scenario: the casts are fixed, so this just says who is on the table. */
export function NarrativeCast({ state }: { state: GameState }) {
  const n = narrativeById(state.narrative?.id);
  if (!n || !state.narrative) return null;
  const list = (side: Side) => {
    const s = side === 'good' ? state.narrative!.good : other(state.narrative!.good);
    const ms = Object.values(state.models).filter(m => m.owner === s);
    return (
      <div key={side} className={`army-roster ${s}`}>
        <b>{n.sides[side].name}</b>
        <ul>
          {ms.map(m => (
            <li key={m.id}>
              {m.name}
              {m.waiting ? ' (kept aside)' : ''}
              {m.brand ? ', flaming brand' : ''}
              {m.options?.filter(o => !/\//.test(o)).length ? `, ${m.options.filter(o => !/\//.test(o)).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="panel-body">
      <p className="hint">{n.name} has a fixed cast, so there are no lists to pick. Drag models round before the battle where the scenario lets them stand.</p>
      {list('good')}
      {list('evil')}
    </div>
  );
}
