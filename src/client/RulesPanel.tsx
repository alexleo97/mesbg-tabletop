import { useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { D6_TABLES, formatNeed, HEROIC_ACTIONS, MISSILE_WEAPONS, TURN_SUMMARY, woundNeed } from '../shared/rules.ts';
import type { Action, GameState, Model, Role } from '../shared/types.ts';
import { useCatalog } from './ListBuilder.tsx';
import { RollRow } from './Panels.tsx';
import { FightPanel } from './FightPanel.tsx';
import { MagicPanel } from './MagicPanel.tsx';

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

export function RulesPanel({ state, dispatch, role, selected }: { state: GameState; dispatch: Dispatch; role: Role; selected: Set<string> }) {
  const [s, setS] = useState(3);
  const [d, setD] = useState(4);
  const [dice, setDice] = useState(1);
  const [sv, setSv] = useState(4);
  const [weapon, setWeapon] = useState('');
  const [lastLabel, setLastLabel] = useState('');
  const one = selected.size === 1 ? state.models[[...selected][0]] : undefined;
  const stats = useStats(one);
  const need = woundNeed(s, d);
  const spectator = role === 'spectator';

  const roll = (count: number, label: string, target?: number, then?: number, sum?: number) => {
    dispatch({ type: 'roll', count, target, then, label, ...(sum ? { sum } : {}) });
    setLastLabel(label);
  };
  const last = lastLabel ? [...state.log].reverse().find(r => r.label === lastLabel && r.by === role) : undefined;
  const lastTable = last && D6_TABLES.find(t => `${t.name} test` === last.label);
  const tableRow = (v: number) => (v === 1 ? 0 : v === 6 ? 2 : 1);

  return (
    <div className="panel-body rules">
      <FightPanel state={state} dispatch={dispatch} role={role} ids={[...selected]} />

      <h4>Roll to wound</h4>
      {one && stats && (
        <div className="row wrap">
          <span className="muted">{one.name}:</span>
          {stats.S !== undefined && <button onClick={() => { setS(stats.S!); setWeapon(''); }}>Use its S{stats.S}</button>}
          {stats.D !== undefined && <button onClick={() => setD(stats.D!)}>Target D{stats.D}</button>}
          {stats.A !== undefined && <button onClick={() => setDice(stats.A!)}>{stats.A} strikes</button>}
        </div>
      )}
      <label>
        Weapon
        <select
          value={weapon}
          onChange={e => {
            setWeapon(e.target.value);
            const w = MISSILE_WEAPONS.find(x => x.name === e.target.value);
            if (w) setS(w.s);
          }}
        >
          <option value="">Close combat / other</option>
          {MISSILE_WEAPONS.map(w => (
            <option key={w.name} value={w.name}>
              {w.name} ({w.range}", S{w.s})
            </option>
          ))}
        </select>
      </label>
      <div className="row wrap">
        <Num label="S" value={s} min={1} max={10} onChange={v => { setS(v); setWeapon(''); }} />
        <Num label="D" value={d} min={1} max={10} onChange={setD} />
        <Num label="Dice" value={dice} min={1} max={30} onChange={setDice} />
      </div>
      <p className="need">
        Needs <b>{formatNeed(need)}</b>
      </p>
      <button
        className="primary"
        disabled={spectator || !need}
        onClick={() => need && roll(dice, `To wound: S${s} vs D${d} (${formatNeed(need)})`, need.target, need.then)}
      >
        Roll {dice} to wound
      </button>

      <h4>Roll to hit</h4>
      {one && stats?.Sv !== undefined && (
        <div className="row">
          <button onClick={() => setSv(stats.Sv!)}>Use {one.name}’s Shoot {stats.Sv}+</button>
        </div>
      )}
      <div className="row wrap">
        <Num label="Shoot" value={sv} min={1} max={6} onChange={setSv} />
        <button disabled={spectator} onClick={() => roll(dice, `To hit on ${sv}+`, sv)}>Roll {dice} to hit</button>
        <button disabled={spectator} onClick={() => roll(1, 'In the Way (4+ gets past)', 4)}>In the Way</button>
      </div>

      <h4>Tests</h4>
      <div className="row wrap">
        <button disabled={spectator} onClick={() => roll(2, 'Courage test', undefined, undefined, stats?.C)}>Courage 2D6</button>
        <button disabled={spectator} onClick={() => roll(2, 'Intelligence test', undefined, undefined, stats?.I)}>Intelligence 2D6</button>
        {D6_TABLES.map(t => (
          <button key={t.name} disabled={spectator} onClick={() => roll(1, `${t.name} test`)}>
            {t.name}
          </button>
        ))}
      </div>

      {last && (
        <div className="rules-result">
          <ol className="log">
            <RollRow r={last} state={state} />
          </ol>
          {lastTable && <p className="table-result">{lastTable.results[tableRow(last.dice[0])]}</p>}
        </div>
      )}

      <MagicPanel state={state} dispatch={dispatch} role={role} selected={selected} />

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
                      <td key={di} className={si + 1 === s && di + 1 === d ? 'on' : ''} onClick={() => { setS(si + 1); setD(di + 1); setWeapon(''); }}>
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
