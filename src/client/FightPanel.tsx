import { useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { duelLeader, strikeWounds, type Fighter } from '../shared/fight.ts';
import { declared } from '../shared/heroics.ts';
import type { Action, GameState, Model, Role, Seat } from '../shared/types.ts';
import { useCatalog } from './ListBuilder.tsx';
import { RollRow } from './Panels.tsx';

type Dispatch = (a: Action) => void;
type Stat = 'f' | 'a' | 's' | 'd';
const STATS: [Stat, string][] = [['f', 'F'], ['a', 'A'], ['s', 'S'], ['d', 'D']];

/**
 * Rolls a fight between the given models (from both sides) in two steps: the duel, when heroes can
 * spend Might on their dice, then the winner's strikes.
 * With `combat`, it resolves that fight on the table and the turn tracker ticks it off.
 */
export function FightPanel({ state, dispatch, role, ids, combat, title = 'Fight' }: { state: GameState; dispatch: Dispatch; role: Role; ids: string[]; combat?: string; title?: string }) {
  const { catalog } = useCatalog();
  const [edits, setEdits] = useState<Record<string, Partial<Record<Stat, number>>>>({});
  const [targets, setTargets] = useState<Record<Seat, string>>({ p1: '', p2: '' });
  const [trapped, setTrapped] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const chosen = ids.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  const sides: Record<Seat, Model[]> = { p1: chosen.filter(m => m.owner === 'p1'), p2: chosen.filter(m => m.owner === 'p2') };
  const seatName = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');

  const fighter = (m: Model): Fighter => {
    const st = modelStats(catalog, m);
    const strength = st?.S ?? 3;
    const base = {
      f: st?.Fv ?? 3,
      a: st?.A ?? 1,
      s: declared(state, m.id, 'Heroic Strength') ? Math.min(10, strength * 2) : strength,
      d: st?.D ?? 4,
    };
    return {
      id: m.id,
      name: m.name,
      ...base,
      ...edits[m.id],
      ...(declared(state, m.id, 'Heroic Strike') ? { strike: true } : {}),
      ...(declared(state, m.id, 'Heroic Defence') ? { defence: true } : {}),
    };
  };

  // The latest fight rolled between these models, if any.
  const idSet = new Set(ids);
  const lastGroup = [...state.log]
    .reverse()
    .find(r => r.group?.startsWith('f-') && r.side !== undefined && r.model && idSet.has(r.model))?.group;
  const lastRolls = lastGroup ? state.log.filter(r => r.group === lastGroup) : [];
  const struck = lastRolls.some(r => r.side === undefined && !r.label.startsWith('Heroic Strike'));
  const leader = lastGroup && !struck ? duelLeader(lastRolls) : null;
  const wounds = struck ? strikeWounds(lastRolls) : 0;
  const victim = lastRolls.find(r => r.against)?.against;
  const victimModel = victim ? state.models[victim] : undefined;

  const ready = sides.p1.length > 0 && sides.p2.length > 0 && role !== 'spectator';
  const request = () => {
    const target = (s: Seat) => (sides[s].some(m => m.id === targets[s]) ? targets[s] : sides[s][0].id);
    return { sides: [sides.p1.map(fighter), sides.p2.map(fighter)] as [Fighter[], Fighter[]], targets: [target('p2'), target('p1')] as [string, string], trapped, ...(combat ? { combat } : {}) };
  };
  const duel = () => dispatch({ type: 'fight', fight: request() });
  const strikes = () => lastGroup && dispatch({ type: 'strikes', fight: request(), group: lastGroup });
  const applyWounds = () => {
    if (!victimModel || !lastGroup) return;
    // Whoever struck the blows gets the credit, for scenarios that count kills.
    const by = [...new Set(lastRolls.filter(r => r.against === victimModel.id && r.model).map(r => r.model!))];
    dispatch({ type: 'wound', id: victimModel.id, count: wounds, by, how: 'fight' });
    setApplied(lastGroup);
  };
  const sideName = (i: 0 | 1) => {
    const ms = i === 0 ? sides.p1 : sides.p2;
    return ms.length === 1 ? ms[0].name : seatName(i === 0 ? 'p1' : 'p2');
  };

  return (
    <div className="fight">
      <h4>{title}</h4>
      {!ready && (
        <p className="hint">
          {role === 'spectator' ? 'Spectators can watch fights but not roll them.' : 'Select at least one model from each side (Select tool or shift-click) to fight.'}
        </p>
      )}
      {ready &&
        (['p1', 'p2'] as const).map(seat => {
          const foe: Seat = seat === 'p1' ? 'p2' : 'p1';
          return (
            <div key={seat} className={`fight-side ${seat}`}>
              <b>{seatName(seat)}</b>
              {sides[seat].map(m => {
                const f = fighter(m);
                return (
                  <div key={m.id} className="fighter">
                    <span className="fighter-name">
                      {m.name}
                      {f.strike && <small className="heroic-tag">Heroic Strike</small>}
                      {f.defence && <small className="heroic-tag">Heroic Defence</small>}
                      {declared(state, m.id, 'Heroic Strength') && <small className="heroic-tag">Heroic Strength</small>}
                    </span>
                    {STATS.map(([k, label]) => (
                      <label key={k} className="mini-stat">
                        {label}
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={f[k]}
                          onChange={e => setEdits(x => ({ ...x, [m.id]: { ...x[m.id], [k]: Number(e.target.value) || 1 } }))}
                        />
                      </label>
                    ))}
                  </div>
                );
              })}
              {sides[foe].length > 1 && (
                <label className="strike-at">
                  Strikes at
                  <select value={targets[seat]} onChange={e => setTargets(t => ({ ...t, [seat]: e.target.value }))}>
                    {sides[foe].map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      {ready && (!lastGroup || struck) && (
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={trapped} onChange={e => setTrapped(e.target.checked)} /> Loser is trapped (double strikes)
          </label>
          <button className="primary" onClick={duel}>
            {struck ? 'Roll a new duel' : 'Roll the duel'}
          </button>
        </div>
      )}
      {lastRolls.length > 0 && (
        <div className="rules-result">
          <ol className="log">
            {lastRolls.map(r => (
              <RollRow key={r.id} r={r} state={state} role={role} dispatch={dispatch} />
            ))}
          </ol>
          {lastGroup && !struck && (
            <>
              <p className="duel-lead">
                {leader ? (
                  <>
                    <b>{sideName(leader.winner)}</b> {leader.how === 'dice' ? 'is winning with the highest die' : 'is winning on Fight value'}.
                  </>
                ) : (
                  'Tied on dice and Fight: a roll-off will decide.'
                )}{' '}
                Heroes can spend Might on their own dice first.
              </p>
              {ready && (
                <div className="row wrap">
                  <label className="check">
                    <input type="checkbox" checked={trapped} onChange={e => setTrapped(e.target.checked)} /> Loser is trapped (double strikes)
                  </label>
                  <button className="primary" onClick={strikes}>
                    Roll strikes
                  </button>
                </div>
              )}
            </>
          )}
          {struck && victimModel && wounds > 0 && !victimModel.dead && applied !== lastGroup && role !== 'spectator' && (
            <button onClick={applyWounds}>
              Wound {victimModel.name} {wounds} time{wounds === 1 ? '' : 's'}
              {victimModel.hero && victimModel.fate > 0 ? ' (Fate can be rolled)' : victimModel.wounds - wounds <= 0 ? ' (slain)' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
