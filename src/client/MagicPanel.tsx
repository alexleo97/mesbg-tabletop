import { useState } from 'react';
import magic from '../data/magic.json';
import type { Action, GameState, Model, Role } from '../shared/types.ts';
import { RollRow } from './Panels.tsx';

interface Power {
  name: string;
  range: string;
  duration: string;
  target: string;
  effect: string;
}
const POWERS = magic.powers as Power[];

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

/** Casting and resisting rolls, spending the selected hero's Will, plus the powers reference. */
export function MagicPanel({ state, dispatch, role, selected }: { state: GameState; dispatch: (a: Action) => void; role: Role; selected: Set<string> }) {
  const [power, setPower] = useState(POWERS[0].name);
  const [cv, setCv] = useState(4);
  const [castWill, setCastWill] = useState(1);
  const [resistWill, setResistWill] = useState(1);
  const one: Model | undefined = selected.size === 1 ? state.models[[...selected][0]] : undefined;
  const p = POWERS.find(x => x.name === power)!;
  const spectator = role === 'spectator';

  const lastCast = [...state.log].reverse().find(r => r.label.startsWith('Cast '));
  const lastResist = lastCast && [...state.log].reverse().find(r => r.label.startsWith('Resist ') && r.at >= lastCast.at);
  const castBest = lastCast ? Math.max(...lastCast.dice) : 0;
  const castOk = lastCast ? castBest >= (lastCast.target ?? 7) : false;

  const spend = (n: number) => {
    if (one && one.will > 0) dispatch({ type: 'updateModel', id: one.id, patch: { will: Math.max(0, one.will - n) } });
  };
  const cast = () => {
    dispatch({ type: 'roll', count: castWill, target: cv, label: `Cast ${power} (${cv}+)${one ? ` by ${one.name}` : ''}`, ...(one ? { model: one.id } : {}) });
    spend(castWill);
  };
  const resist = () => {
    dispatch({ type: 'roll', count: resistWill, target: castBest, label: `Resist ${lastCast?.label.slice(5).replace(/ \(\d\+\).*/, '')} (${castBest}+)${one ? ` by ${one.name}` : ''}`, ...(one ? { model: one.id } : {}) });
    spend(resistWill);
  };

  return (
    <div className="magic">
      <h4>Magic</h4>
      <label>
        Power
        <select value={power} onChange={e => setPower(e.target.value)}>
          {POWERS.map(x => (
            <option key={x.name}>{x.name}</option>
          ))}
        </select>
      </label>
      <p className="power-card">
        <span className="muted">
          {p.range} · {p.duration} · {p.target}
        </span>
        <br />
        {p.effect}
      </p>
      {one && (
        <p className="muted">
          {one.name} has {one.will} Will{one.will ? '; dice spent come off it' : ''}.
        </p>
      )}
      <div className="row wrap">
        <Num label="Casting value" value={cv} min={2} max={6} onChange={setCv} />
        <Num label="Will" value={castWill} min={1} max={6} onChange={setCastWill} />
      </div>
      <button className="primary" disabled={spectator} onClick={cast}>
        Cast with {castWill} {castWill === 1 ? 'die' : 'dice'}
      </button>
      {lastCast && (
        <div className="rules-result">
          <ol className="log">
            <RollRow r={lastCast} state={state} role={role} dispatch={dispatch} />
            {lastResist && <RollRow r={lastResist} state={state} role={role} dispatch={dispatch} />}
          </ol>
          <p className="table-result">
            {!castOk
              ? 'The power fails.'
              : lastResist
                ? lastResist.dice.some(d => d >= castBest)
                  ? 'Resisted: the power has no effect.'
                  : 'Not resisted: the power takes effect.'
                : `Cast on a ${castBest}. The target can resist by rolling a ${castBest} or more.`}
          </p>
          {castOk && !lastResist && (
            <div className="row wrap">
              <Num label="Resist Will" value={resistWill} min={1} max={6} onChange={setResistWill} />
              <button disabled={spectator} onClick={resist}>
                Resist
              </button>
            </div>
          )}
        </div>
      )}
      <details>
        <summary>Casting and resisting</summary>
        <ul>
          {[...magic.casting, ...magic.resisting].map(x => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <ul>
          {magic.durations.map(d => (
            <li key={d.name}>
              <b>{d.name}:</b> {d.text}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Magical powers</summary>
        <ul className="heroics">
          {POWERS.map(x => (
            <li key={x.name}>
              <b>{x.name}</b> <span className="muted">({x.range}, {x.duration})</span> {x.effect}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
