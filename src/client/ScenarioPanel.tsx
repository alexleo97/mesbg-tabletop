import { useEffect, useRef, useState } from 'react';
import { newId } from '../shared/importList.ts';
import { COMMON_RULES, POOLS, SCENARIOS, scenarioById, scenarioFromDice, scenarioMarkers, SELECTION_RULE, vpTotal } from '../shared/scenarios.ts';
import { PICKS, pickOptions } from '../shared/picks.ts';
import { scoreLines, vpTotals } from '../shared/scoring.ts';
import { gameEnded } from '../shared/status.ts';
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
          {state.bot ? (
            !state.scenario && (
              <option value="" disabled>
                Pick a scenario…
              </option>
            )
          ) : (
            <option value="">Open play (no scenario)</option>
          )}
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

          <PicksPanel state={state} dispatch={dispatch} role={role} seatName={seatName} />
          <h4>Victory points</h4>
          <p className="fine">The game scores every line from the table as if the game ended now.</p>
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

/**
 * Secret picks for scenarios that need them. Your own are yours to set before the game starts; your opponent's stay
 * hidden until the game is over.
 */
function PicksPanel({ state, dispatch, role, seatName }: { state: GameState; dispatch: Dispatch; role: Role; seatName: (s: Seat) => string }) {
  const specs = state.scenario ? PICKS[state.scenario] : undefined;
  if (!specs) return null;
  const over = gameEnded(state) || !!state.result;
  const nameOf = (id: string | undefined) => (id ? (state.models[id]?.name ?? 'a terrain piece') : 'nothing');
  const mine = role === 'p1' || role === 'p2' ? role : null;
  return (
    <div className="picks">
      <h4>Secret picks</h4>
      {mine ? (
        specs.map(p => {
          const value = state.flow.picks?.[mine]?.[p.key] ?? '';
          const opts = pickOptions(state, mine, p);
          return (
            <div key={p.key} className="pick-row">
              <span>{p.label}</span>
              <select aria-label={p.label} value={value} disabled={state.flow.started} onChange={e => dispatch({ type: 'setPick', seat: mine, key: p.key, value: e.target.value || null })}>
                <option value="">{opts.length ? 'Choose…' : 'Nothing to choose yet'}</option>
                {opts.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })
      ) : (
        <p className="fine">Each player picks in secret; you'll see them once the game is over.</p>
      )}
      {mine && !state.flow.started && specs.some(p => !state.flow.picks?.[mine]?.[p.key]) && (
        <p className="fine">Make your picks before the game starts. They score nothing until they're made.</p>
      )}
      {(['p1', 'p2'] as const)
        .filter(seat => seat !== mine)
        .map(seat => {
          const theirs = state.flow.picks?.[seat] ?? {};
          const made = specs.filter(p => theirs[p.key]).length;
          return (
            <p key={seat} className="fine">
              {over
                ? `${seatName(seat)} picked ${specs.map(p => `${p.label.replace(/^Your /, 'their ').toLowerCase()}: ${nameOf(theirs[p.key])}`).join('; ')}.`
                : `${seatName(seat)} has made ${made} of ${specs.length} pick${specs.length === 1 ? '' : 's'}.`}
            </p>
          );
        })}
    </div>
  );
}
