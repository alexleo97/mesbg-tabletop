import type { ReactElement } from 'react';
import type { Catalog } from '../shared/catalog.ts';
import { detonateOptions, helmsObjectives, helmsTally, helmsTurns, isHelms, mayChooseRelief, raiseLadderTargets, reliefPoint, RELIEF_SPAN, RELIEF_TURN, rideOutBlocked, RIDE_OUT_TURN } from '../shared/helms.ts';
import { planShot, weaponFor } from '../shared/shooting.ts';
import { shotsTaken } from '../shared/towers.ts';
import { hasRule } from '../shared/wargear.ts';
import type { Action, GameState, Model, Role, Seat } from '../shared/types.ts';

type Dispatch = (a: Action) => void;

/**
 * Helm's Deep in the scenario panel: the seven objectives as they stand, who holds each, and (for the defenders,
 * until it rides on) where the Relief Force comes onto the south edge.
 */
export function HelmsTally({ state, dispatch, seat }: { state: GameState; dispatch: Dispatch; seat: Seat | null }) {
  const objectives = helmsObjectives(state);
  const tally = helmsTally(state);
  const choose = !!seat && mayChooseRelief(state, seat);
  return (
    <div className="helms-tally">
      <p className="small">
        <b>
          Good {tally.good}, Evil {tally.evil}
        </b>{' '}
        <span className="muted">after {helmsTurns(state)} turns, or at once if a side is wiped out.</span>
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
      {choose ? (
        <label className="small helms-relief">
          The Relief Force rides on in turn {RELIEF_TURN}, {reliefPoint(state)}" along the south edge from the west:
          <input type="range" min={RELIEF_SPAN[0]} max={RELIEF_SPAN[1]} step={1} value={reliefPoint(state)} onChange={e => dispatch({ type: 'reliefPoint', seat: seat!, x: Number(e.target.value) })} />
        </label>
      ) : (
        state.turn <= RELIEF_TURN && <p className="muted small">The Relief Force rides on in turn {RELIEF_TURN}, {reliefPoint(state)}" along the south edge.</p>
      )}
    </div>
  );
}

/**
 * Helm's Deep on a model's card: a hero by the gate Riding Out, a Demolition Charge to set off, the Assault Ballista's
 * Raise the Ladders!, and Legolas's Pinpoint Shot.
 */
export function HelmsPanel({ state, catalog, dispatch, role, m }: { state: GameState; catalog: Catalog | null; dispatch: Dispatch; role: Role; m: Model }) {
  if (m.owner !== role || m.dead || !state.flow.started) return null;
  const out: ReactElement[] = [];
  if (isHelms(state) && m.cast && ['theoden', 'aragorn', 'gamling', 'legolas'].includes(m.cast) && !m.mount) {
    const why = rideOutBlocked(state, m);
    out.push(
      <button key="ride" className="small" disabled={!!why} title={why ?? 'Mount up by the gate and ride out'} onClick={() => dispatch({ type: 'rideOut', model: m.id })}>
        Ride Out{why && state.turn < RIDE_OUT_TURN ? ` (from turn ${RIDE_OUT_TURN})` : ''}
      </button>,
    );
  }
  for (const t of detonateOptions(state, m))
    out.push(
      <button key={`boom-${t.id}`} className="small primary" title="A Courage test, then it goes off (without a torch, only on a 6)" onClick={() => dispatch({ type: 'detonate', model: m.id, charge: t.id })}>
        Set off the Demolition Charge{m.torch ? ' (torch)' : ''}
      </button>,
    );
  if (m.siege)
    for (const r of raiseLadderTargets(state, catalog, m))
      out.push(
        <button key={`raise-${r.ladder.id}`} className="small" title="Instead of shooting: a hit puts the ladder up against the wall, and a friend touching it goes up to the top" onClick={() => dispatch({ type: 'raiseLadder', model: m.id, ladder: r.ladder.id })}>
          Raise the Ladders! (the ladder {Math.round(Math.hypot(r.ladder.x - m.x, r.ladder.y - m.y))}" away)
        </button>,
      );
  const weapon = state.phase === 'shoot' && hasRule(catalog, m, 'Pinpoint Shot') && !shotsTaken(state, m) ? weaponFor(catalog, m) : undefined;
  if (weapon)
    for (const e of Object.values(state.models).filter(e => e.owner !== m.owner && !e.dead && !planShot(state, catalog, m, e, { pinpoint: true }).why))
      out.push(
        <button key={`pin-${e.id}`} className="small" title="His only Shooting Attack this phase: one shot at an enemy fighting a friend, with nothing in the way" onClick={() => dispatch({ type: 'shoot', shot: { shooter: { id: m.id, name: m.name, weapon: weapon.name, shoot: 3, s: weapon.s, shots: 1 }, target: { id: e.id, name: e.name, d: 4 }, obstacles: 0, pinpoint: true } })}>
          Pinpoint Shot at {e.name}
        </button>,
      );
  return out.length ? <div className="row wrap helms-actions">{out}</div> : null;
}
