import type { ReactElement } from 'react';
import type { Catalog } from '../shared/catalog.ts';
import { ARRIVAL_TURN, arrivalPoint, arrivalWaiting, mayChoosePoint, pelennorObjectives, pelennorTally, pelennorTurns, SPAN } from '../shared/pelennor.ts';
import { alightBlocked, isPassenger, passengerOf } from '../shared/passengers.ts';
import { mayLightBlade } from '../shared/pelennorRules.ts';
import type { Action, GameState, Model, Role, Seat } from '../shared/types.ts';

type Dispatch = (a: Action) => void;

const ARRIVING = { mumakil: 'The Mûmakil come on from the south edge', 'witch-king': 'The Witch-king flies in over the walls from the north edge' } as const;

/**
 * Battle of Pelennor Fields in the scenario panel: the five objectives as they stand, who holds each, and (for the
 * Evil player, until they arrive) where along their edges the Mûmakil and the Witch-king come on.
 */
export function PelennorTally({ state, dispatch, seat }: { state: GameState; dispatch: Dispatch; seat: Seat | null }) {
  const objectives = pelennorObjectives(state);
  const tally = pelennorTally(state);
  return (
    <div className="helms-tally">
      <p className="small">
        <b>
          Good {tally.good}, Evil {tally.evil}
        </b>{' '}
        <span className="muted">after {pelennorTurns(state)} turns, or at once if a side is wiped out.</span>
      </p>
      <table className="small">
        <tbody>
          {objectives.map(o => (
            <tr key={o.key}>
              <td>{o.name}</td>
              <td className="muted">{o.detail}</td>
              <td>{o.holder === 'good' ? 'Good' : o.holder === 'evil' ? 'Evil' : 'Nobody'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(['mumakil', 'witch-king'] as const).map(which => {
        if (!arrivalWaiting(state, which).length) return null;
        const at = arrivalPoint(state, which);
        const when = state.turn <= ARRIVAL_TURN[which] ? `in turn ${ARRIVAL_TURN[which]}` : 'as soon as they can';
        return !!seat && mayChoosePoint(state, seat, which) ? (
          <label key={which} className="small helms-relief">
            {ARRIVING[which]} {when}, {at}" from the west:
            <input type="range" min={SPAN[0]} max={SPAN[1]} step={1} value={at} onChange={e => dispatch({ type: 'arrivalPoint', seat: seat!, which, x: Number(e.target.value) })} />
          </label>
        ) : (
          <p key={which} className="muted small">
            {ARRIVING[which]} {when}.
          </p>
        );
      })}
    </div>
  );
}

/** Battle of Pelennor Fields on a model's card: a Passenger getting down, and the Witch-king setting his blade alight. */
export function PelennorPanel({ state, catalog, dispatch, role, m }: { state: GameState; catalog: Catalog | null; dispatch: Dispatch; role: Role; m: Model }) {
  if (m.owner !== role || m.dead || !state.flow.started) return null;
  const out: ReactElement[] = [];
  // (On the Passenger's card, or its rider's.)
  const p = isPassenger(state, m) ? m : passengerOf(state, m);
  if (p) {
    const why = alightBlocked(state, p, p.owner);
    out.push(
      <button key="alight" className="small" disabled={!!why} title={why ?? `${p.name} gets down beside the mount, during its move, and moves no further this phase.`} onClick={() => dispatch({ type: 'alight', id: p.id })}>
        {p.id === m.id ? `Get down from the ${state.models[m.aboard!]?.mount ?? 'horse'}` : `${p.name} gets down`}
      </button>,
    );
  }
  if (mayLightBlade(state, catalog, m))
    out.push(
      <button key="crown" className="small primary" title="Once a game, as the Fight phase begins: until the turn ends, anyone wounded by his strikes is Set Ablaze." onClick={() => dispatch({ type: 'crownBlade', id: m.id })}>
        Set his blade alight (Crown of Morgul)
      </button>,
    );
  return out.length ? <div className="row wrap helms-actions">{out}</div> : null;
}
