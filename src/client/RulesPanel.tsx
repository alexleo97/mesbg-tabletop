import { mounted } from '../shared/cavalry.ts';
import { useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { D6_TABLES, formatNeed, HEROIC_ACTIONS, MISSILE_WEAPONS, TURN_SUMMARY, woundNeed } from '../shared/rules.ts';
import type { Action, GameState, Model, Role } from '../shared/types.ts';
import { useCatalog } from './ListBuilder.tsx';
import { RollRow } from './Panels.tsx';
import { FightPanel } from './FightPanel.tsx';
import { MagicPanel, MagicReference } from './MagicPanel.tsx';

type Dispatch = (a: Action) => void;

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="stepper">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Less ${label}`}>−</button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
    </label>
  );
}

function useStats(m: Model | undefined) {
  const { catalog } = useCatalog();
  return modelStats(catalog, m);
}

/**
 * The rolls the game can't take care of by itself. Fights and shooting run from the model card; this panel holds the
 * tests for the selected model, its magic, and a free roll for anything else, each filled from the model's profile.
 */
export function RulesPanel({ state, dispatch, role, selected }: { state: GameState; dispatch: Dispatch; role: Role; selected: Set<string> }) {
  const one = selected.size === 1 ? state.models[[...selected][0]] : undefined;
  const stats = useStats(one);
  const [s, setS] = useState(3);
  const [d, setD] = useState(4);
  const [dice, setDice] = useState(1);
  const [lastLabel, setLastLabel] = useState('');
  const need = woundNeed(s, d);
  const spectator = role === 'spectator';
  const who = one ? ` (${one.name})` : '';
  // Thrown Rider only matters to a model on a mount.
  const tables = D6_TABLES.filter(t => t.name !== 'Thrown Rider' || !one || mounted(one));

  const roll = (count: number, label: string, target?: number, then?: number, sum?: number) => {
    dispatch({ type: 'roll', count, target, then, label, ...(sum ? { sum } : {}), ...(one ? { model: one.id } : {}) });
    setLastLabel(label);
  };
  const last = lastLabel ? [...state.log].reverse().find(r => r.label === lastLabel && r.by === role) : undefined;
  const lastTable = last && D6_TABLES.find(t => last.label.startsWith(`${t.name} test`));
  const tableRow = (v: number) => (v === 1 ? 0 : v === 6 ? 2 : 1);

  return (
    <div className="panel-body rules">
      <FightPanel state={state} dispatch={dispatch} role={role} ids={[...selected]} />

      <h4>Tests</h4>
      <div className="row wrap">
        {stats?.C !== undefined && (
          <button disabled={spectator} onClick={() => roll(2, `Courage test${who}`, undefined, undefined, stats.C)}>
            Courage <span className="muted">{stats.C}+</span>
          </button>
        )}
        {stats?.I !== undefined && (
          <button disabled={spectator} onClick={() => roll(2, `Intelligence test${who}`, undefined, undefined, stats.I)}>
            Intelligence <span className="muted">{stats.I}+</span>
          </button>
        )}
        {tables.map(t => (
          <button key={t.name} disabled={spectator} onClick={() => roll(1, `${t.name} test${who}`)} title={t.when}>
            {t.name}
          </button>
        ))}
      </div>
      <p className="fine">
        {stats?.C !== undefined ? 'Courage and Intelligence roll 2D6 and pass on the total shown or more.' : 'Select a model to roll its Courage and Intelligence.'}
      </p>

      {last && (
        <div className="rules-result">
          <ol className="log">
            <RollRow r={last} state={state} role={role} dispatch={dispatch} />
          </ol>
          {lastTable && <p className="table-result">{lastTable.results[tableRow(last.dice[0])]}</p>}
        </div>
      )}

      <MagicPanel state={state} dispatch={dispatch} role={role} selected={selected} />

      <details
        className="other-rolls"
        onToggle={e => {
          // Start from the selected model's own Strength and Attacks.
          if ((e.target as HTMLDetailsElement).open && stats) {
            if (stats.S !== undefined) setS(stats.S);
            if (stats.A !== undefined) setDice(stats.A);
          }
        }}
      >
        <summary>Other rolls</summary>
        <p className="fine">For anything a special rule asks for. Fights and shooting roll from the model card.</p>
        <div className="row wrap">
          <Num label="S" value={s} min={1} max={10} onChange={setS} />
          <Num label="D" value={d} min={1} max={10} onChange={setD} />
          <Num label="Dice" value={dice} min={1} max={30} onChange={setDice} />
        </div>
        <div className="row wrap">
          <button disabled={spectator || !need} onClick={() => need && roll(dice, `To wound: S${s} vs D${d} (${formatNeed(need)})`, need.target, need.then)}>
            Roll {dice} to wound ({formatNeed(need)})
          </button>
          <button disabled={spectator} onClick={() => roll(1, 'In the Way (4+ gets past)', 4)}>
            In the Way
          </button>
          <button disabled={spectator} onClick={() => roll(dice, 'D6')}>
            Roll {dice} D6
          </button>
        </div>
      </details>

      <h4>Reference</h4>
      <details>
        <summary>D6 tables</summary>
        {D6_TABLES.map(t => (
          <div key={t.name} className="d6-table">
            <b>{t.name}</b> <span className="muted">{t.when}</span>
            <table>
              <tbody>
                {(['1', '2–5', '6'] as const).map((k, i) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{t.results[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </details>

      <details>
        <summary>To wound chart</summary>
        <div className="chart-scroll">
          <table className="wound-chart">
            <thead>
              <tr>
                <th>S \ D</th>
                {Array.from({ length: 10 }, (_, i) => <th key={i}>{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, si) => (
                <tr key={si}>
                  <th>{si + 1}</th>
                  {Array.from({ length: 10 }, (_, di) => {
                    const n = woundNeed(si + 1, di + 1);
                    return (
                      <td key={di} className={si + 1 === s && di + 1 === d ? 'on' : ''} onClick={() => { setS(si + 1); setD(di + 1); }}>
                        {n ? `${n.target}${n.then ? `/${n.then}` : ''}` : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary>Missile weapons</summary>
        <table className="ref">
          <tbody>
            {MISSILE_WEAPONS.map(w => (
              <tr key={w.name}>
                <td>{w.name}</td>
                <td>{w.range}"</td>
                <td>S{w.s}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary>Turn sequence</summary>
        {TURN_SUMMARY.map(p => (
          <div key={p.phase}>
            <b>{p.phase}</b>
            <ul>
              {p.points.map(x => <li key={x}>{x}</li>)}
            </ul>
          </div>
        ))}
      </details>

      <MagicReference />

      <details>
        <summary>Heroic actions</summary>
        <ul className="heroics">
          {HEROIC_ACTIONS.map(h => (
            <li key={h.name}>
              <b>{h.name}</b> <span className="muted">({h.phase})</span> {h.text}
            </li>
          ))}
        </ul>
      </details>
      <p className="fine">Shorthand only. Check the rulebook for the full wording.</p>
    </div>
  );
}
