import { useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { strikeWounds, type Fighter } from '../shared/fight.ts';
import type { Action, GameState, Model, Role, Seat } from '../shared/types.ts';
import { useCatalog } from './ListBuilder.tsx';
import { RollRow } from './Panels.tsx';

type Dispatch = (a: Action) => void;
type Stat = 'f' | 'a' | 's' | 'd';
const STATS: [Stat, string][] = [['f', 'F'], ['a', 'A'], ['s', 'S'], ['d', 'D']];

/**
 * Rolls the duel and the winner's strikes in one go, for the given models (from both sides).
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
    const base = { f: st?.Fv ?? 3, a: st?.A ?? 1, s: st?.S ?? 3, d: st?.D ?? 4 };
    return { id: m.id, name: m.name, ...base, ...edits[m.id] };
  };

  // The latest fight this player rolled, if any.
  const lastGroup = [...state.log].reverse().find(r => r.group?.startsWith('f-') && r.by === role)?.group;
  const lastRolls = lastGroup ? state.log.filter(r => r.group === lastGroup) : [];
  const wounds = strikeWounds(lastRolls);
  const victim = lastRolls.find(r => r.against)?.against;
  const victimModel = victim ? state.models[victim] : undefined;

  const ready = sides.p1.length > 0 && sides.p2.length > 0 && role !== 'spectator';
  const fight = () => {
    const target = (s: Seat) => (sides[s].some(m => m.id === targets[s]) ? targets[s] : sides[s][0].id);
    dispatch({
      type: 'fight',
      fight: { sides: [sides.p1.map(fighter), sides.p2.map(fighter)], targets: [target('p2'), target('p1')], trapped, ...(combat ? { combat } : {}) },
    });
  };
  const applyWounds = () => {
    if (!victimModel || !lastGroup) return;
    const left = Math.max(0, victimModel.wounds - wounds);
    dispatch({ type: 'updateModel', id: victimModel.id, patch: left ? { wounds: left } : { wounds: 0, dead: true } });
    setApplied(lastGroup);
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
                    <span className="fighter-name">{m.name}</span>
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
      {ready && (
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={trapped} onChange={e => setTrapped(e.target.checked)} /> Loser is trapped (double strikes)
          </label>
          <button className="primary" onClick={fight}>
            Roll the fight
          </button>
        </div>
      )}
      {lastRolls.length > 0 && (
        <div className="rules-result">
          <ol className="log">
            {lastRolls.map(r => (
              <RollRow key={r.id} r={r} state={state} />
            ))}
          </ol>
          {victimModel && wounds > 0 && !victimModel.dead && applied !== lastGroup && (
            <button onClick={applyWounds}>
              Take {wounds} wound{wounds === 1 ? '' : 's'} off {victimModel.name}
              {victimModel.wounds - wounds <= 0 ? ' (slain)' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
