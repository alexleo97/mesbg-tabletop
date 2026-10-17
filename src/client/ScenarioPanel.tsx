import { useEffect, useRef, useState } from 'react';
import { newId } from '../shared/importList.ts';
import { COMMON_RULES, POOLS, SCENARIOS, scenarioById, scenarioFromDice, scenarioMarkers, SELECTION_RULE, vpTotal } from '../shared/scenarios.ts';
import { scoreLines, vpTotals } from '../shared/scoring.ts';
import type { Action, GameState, Role, Seat } from '../shared/types.ts';

type Dispatch = (a: Action) => void;
const ROLL_LABEL = 'Scenario roll (pool, then scenario)';

export function ScenarioPanel({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  const s = scenarioById(state.scenario);
  const spectator = role === 'spectator';
  const seatName = (seat: Seat) => state.names[seat] || (seat === 'p1' ? 'Player 1' : 'Player 2');
  const [waiting, setWaiting] = useState(false);
  const seen = useRef(new Set(state.log.map(r => r.id)));

  // When our scenario roll comes back from the server, pick the scenario it points to.
  useEffect(() => {
    for (const r of state.log) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      if (waiting && r.by === role && r.label === ROLL_LABEL) {
        setWaiting(false);
        const pick = scenarioFromDice(r.dice);
        if (pick) choose(pick.id);
      }
    }
  }, [state.log]);

  const choose = (id: string | null) => {
    if (state.scenario && id !== state.scenario && vpTotal(state.vp.p1) + vpTotal(state.vp.p2) > 0 && !confirm('Change scenario? Victory points will reset.')) return;
    dispatch({ type: 'setScenario', id });
  };

  const placeMarkers = () => {
    if (!s) return;
    Object.values(state.terrain)
      .filter(t => t.kind === 'objective')
      .forEach(t => dispatch({ type: 'removeTerrain', id: t.id }));
    scenarioMarkers(s, state.board.w, state.board.h, newId).forEach(t => dispatch({ type: 'addTerrain', terrain: t }));
  };

  const common = s ? COMMON_RULES.filter(c => s.specialRules.some(r => r.toLowerCase().includes(c.name.toLowerCase()))) : [];

  return (
    <div className="panel-body scenario">
      <h4>Scenario</h4>
      <div className="row">
        <select value={state.scenario ?? ''} onChange={e => choose(e.target.value || null)} disabled={spectator} aria-label="Scenario">
          <option value="">Open play (no scenario)</option>
          {POOLS.slice(1).map((pool, i) => (
            <optgroup key={pool} label={`${i + 1}. ${pool}`}>
              {SCENARIOS.filter(x => x.pool === i + 1).map(x => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          disabled={spectator || waiting}
          title={SELECTION_RULE}
          onClick={() => {
            setWaiting(true);
            dispatch({ type: 'roll', count: 4, label: ROLL_LABEL });
          }}
        >
          {waiting ? 'Rolling…' : 'Roll one'}
        </button>
      </div>

      {s && (
        <>
          <p className="muted small">
            Pool {s.pool}: {POOLS[s.pool]}
          </p>

          <h4>Victory points</h4>
          <p className="fine">The game scores what it can see as if the game ended now. Lines marked ✎ are yours to enter.</p>
          <table className="vp">
            <thead>
              <tr>
                <th />
                {(['p1', 'p2'] as const).map(seat => (
                  <th key={seat} className={seat}>
                    {seatName(seat)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreLines(state).map((line, i) => (
                <tr key={i} className={line.auto ? 'auto' : 'manual'}>
                  <td>
                    {!line.auto && <span title="Enter this one yourself">✎ </span>}
                    {line.label}
                    <small>{line.points} VP</small>
                  </td>
                  {(['p1', 'p2'] as const).map(seat => {
                    const key = String(i);
                    const v = line.vp[seat];
                    return line.auto ? (
                      <td key={seat} className="vp-cell">
                        <b>{v}</b>
                      </td>
                    ) : (
                      <td key={seat} className="vp-cell">
                        <button disabled={spectator || v === 0} onClick={() => dispatch({ type: 'setVP', seat, key, value: v - 1 })} aria-label={`Less ${seatName(seat)} VP`}>
                          −
                        </button>
                        <b>{v}</b>
                        <button disabled={spectator} onClick={() => dispatch({ type: 'setVP', seat, key, value: v + 1 })} aria-label={`More ${seatName(seat)} VP`}>
                          +
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td>{vpTotals(state).p1}</td>
                <td>{vpTotals(state).p2}</td>
              </tr>
            </tbody>
          </table>

          <h4>Set up</h4>
          <p>{s.deployment.description}</p>
          {s.objectives.count > 0 && (
            <>
              <p>
                <b>Markers ({s.objectives.count}):</b> {s.objectives.placement}
              </p>
              {!!s.objectives.fixedPositions?.length && (
                <button disabled={spectator} onClick={placeMarkers}>
                  Place {s.objectives.fixedPositions.length === s.objectives.count ? 'the' : `${s.objectives.fixedPositions.length} fixed`} marker
                  {s.objectives.fixedPositions.length === 1 ? '' : 's'}
                </button>
              )}
            </>
          )}
          {s.deployment.zones.some(z => z.label?.startsWith('example')) && (
            <p className="fine">Corner zones show one example; players choose their corners.</p>
          )}

          {s.specialRules.length > 0 && (
            <>
              <h4>Special rules</h4>
              <ul>
                {s.specialRules.map(r => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {common.map(c => (
            <p key={c.id} className="small">
              <b>{c.name}:</b> {c.summary}
            </p>
          ))}

          <h4>Game end</h4>
          <p>{s.gameEnd}</p>
          <p className="fine">Our own shorthand of the matched play scenario. The Matched Play Guide has the full rules and maps.</p>
        </>
      )}
    </div>
  );
}
