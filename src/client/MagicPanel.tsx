import { useState } from 'react';
import magic from '../data/magic.json';
import type { Action, GameState, Model, Role } from '../shared/types.ts';
import type { Catalog } from '../shared/catalog.ts';
import { useCatalog, useRulesText } from './ListBuilder.tsx';
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

/** The powers a model knows, from its profile, each with its fixed casting value. */
function knownPowers(catalog: Catalog | null, m: Model | undefined): { name: string; range: string; cv: number; info?: Power }[] {
  const unit = m?.profileId ? catalog?.units[m.profileId] : undefined;
  return (unit?.powers ?? []).map(x => ({
    name: x.name,
    range: x.range,
    cv: parseInt(x.cast, 10) || 4,
    // "Fury (Mordor Orc)" is the Fury power for that kind of model.
    info: POWERS.find(y => y.name === x.name || y.name === x.name.replace(/ \(.*\)$/, '')),
  }));
}

/**
 * Casting and resisting for the selected model. The powers on offer are the ones on its profile, the casting value is
 * the profile's, and the dice spent come off its Will, so nothing has to be set by hand.
 */
export function MagicPanel({ state, dispatch, role, selected }: { state: GameState; dispatch: (a: Action) => void; role: Role; selected: Set<string> }) {
  const { catalog } = useCatalog();
  const rulesText = useRulesText();
  const one: Model | undefined = selected.size === 1 ? state.models[[...selected][0]] : undefined;
  const powers = knownPowers(catalog, one);
  const [picked, setPicked] = useState('');
  const [castWill, setCastWill] = useState(1);
  const [resistWill, setResistWill] = useState(1);
  const power = powers.find(x => x.name === picked) ?? powers[0];
  const spectator = role === 'spectator';
  const will = one?.will ?? 0;

  const lastCast = [...state.log].reverse().find(r => r.label.startsWith('Cast '));
  const lastResist = lastCast && [...state.log].reverse().find(r => r.label.startsWith('Resist ') && r.at >= lastCast.at);
  const castBest = lastCast ? Math.max(...lastCast.dice) : 0;
  const castOk = lastCast ? castBest >= (lastCast.target ?? 7) : false;
  // The caster can't resist its own power; the roll names it even when it belongs to the other player.
  const isCaster = !!one && (one.id === lastCast?.model || !!lastCast?.label.endsWith(` by ${one.name}`));
  const canResist = castOk && !lastResist && one && !isCaster && will > 0;

  const spend = (n: number) => {
    if (one) dispatch({ type: 'updateModel', id: one.id, patch: { will: Math.max(0, one.will - n) } });
  };
  const cast = () => {
    if (!one || !power) return;
    const n = Math.min(castWill, will);
    dispatch({ type: 'roll', count: n, target: power.cv, label: `Cast ${power.name} (${power.cv}+) by ${one.name}`, model: one.id });
    spend(n);
  };
  const resist = () => {
    if (!one) return;
    const n = Math.min(resistWill, will);
    dispatch({ type: 'roll', count: n, target: castBest, label: `Resist ${lastCast?.label.slice(5).replace(/ \(\d\+\).*/, '')} (${castBest}+) by ${one.name}`, model: one.id });
    spend(n);
  };
  const ref = one?.profileId ? catalog?.units[one.profileId]?.ruleRefs?.[power?.name ?? ''] : undefined;
  const effect = power?.info?.effect ?? (ref ? rulesText[ref] : undefined);

  if (!powers.length && !lastCast) return null;
  return (
    <div className="magic">
      <h4>Magic</h4>
      {power && one ? (
        <>
          <label>
            Power
            <select value={power.name} onChange={e => setPicked(e.target.value)}>
              {powers.map(x => (
                <option key={x.name} value={x.name}>
                  {x.name} ({x.cv}+)
                </option>
              ))}
            </select>
          </label>
          <p className="power-card">
            <span className="muted">
              {power.range} · casts on {power.cv}+{power.info ? ` · ${power.info.duration}` : ''}
            </span>
            {effect && (
              <>
                <br />
                {effect}
              </>
            )}
          </p>
          <div className="row wrap">
            <Num label="Will to spend" value={Math.min(castWill, Math.max(1, will))} min={1} max={Math.max(1, will)} onChange={setCastWill} />
            <span className="muted">
              {one.name} has {will} Will.
            </span>
          </div>
          <button className="primary" disabled={spectator || will < 1} onClick={cast}>
            {will < 1 ? 'No Will left' : `Cast with ${Math.min(castWill, will)} ${Math.min(castWill, will) === 1 ? 'die' : 'dice'}`}
          </button>
        </>
      ) : (
        <p className="muted">Select a model with magical powers to cast.</p>
      )}
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
          {castOk && !lastResist && !canResist && <p className="muted">Select the target to resist with its Will.</p>}
          {canResist && (
            <div className="row wrap">
              <Num label={`${one.name}'s Will`} value={Math.min(resistWill, will)} min={1} max={will} onChange={setResistWill} />
              <button disabled={spectator} onClick={resist}>
                Resist
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What casting and resisting involve, and every power in plain words. */
export function MagicReference() {
  return (
    <>
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
    </>
  );
}
