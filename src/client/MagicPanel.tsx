import { useState } from 'react';
import magic from '../data/magic.json';
import type { Action, GameState, Model, Role } from '../shared/types.ts';
import type { Catalog } from '../shared/catalog.ts';
import { distanceBetween, formatInches } from '../shared/geometry.ts';
import { canActivate } from '../shared/heroics.ts';
import { canCast, castTargets, powersOf } from '../shared/magic.ts';
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

/** The power's plain-words effect, from our own summaries. */
function powerEffect(catalog: Catalog | null, rulesText: Record<string, string>, m: Model, name: string): { info?: Power; effect?: string } {
  const info = POWERS.find(y => y.name === name || y.name === name.replace(/ \(.*\)$/, ''));
  const ref = m.profileId ? catalog?.units[m.profileId]?.ruleRefs?.[name] : undefined;
  return { info, effect: info?.effect ?? (ref ? rulesText[ref] : undefined) };
}

/**
 * Casting from a model's card in the Move phase: the powers on its profile, the targets in range it can see, and how
 * much Will to spend. The game rolls, takes the Will off and asks the target's player about resisting.
 */
export function CastBox({ state, dispatch, role, model: m }: { state: GameState; dispatch: (a: Action) => void; role: Role; model: Model }) {
  const { catalog } = useCatalog();
  const rulesText = useRulesText();
  const powers = powersOf(catalog, m);
  const [picked, setPicked] = useState('');
  const [aim, setAim] = useState('');
  const [will, setWill] = useState(1);
  const power = powers.find(x => x.name === picked) ?? powers[0];
  if (!power || role !== m.owner || !state.flow.started || state.phase !== 'move') return null;
  const targets = castTargets(state, m, power.range);
  const target = targets.find(t => t.id === aim) ?? targets[0];
  const n = Math.max(1, Math.min(will, m.will));
  const { info, effect } = powerEffect(catalog, rulesText, m, power.name);
  const ready = canCast(state, m, seat => canActivate(state, seat));
  const why = state.flow.cast?.includes(m.id)
    ? `${m.name} has cast a power this turn.`
    : m.will < 1
      ? `${m.name} has no Will left.`
      : state.flow.spell
        ? 'Another power is waiting to be resisted.'
        : !ready
          ? 'Powers are cast during your own move.'
          : !target
            ? 'No target in range that it can see.'
            : null;
  return (
    <div className="magic cast-box">
      <div className="row wrap">
        <label>
          Cast
          <select value={power.name} onChange={e => setPicked(e.target.value)}>
            {powers.map(x => (
              <option key={x.name} value={x.name}>
                {x.name} ({x.cv}+)
              </option>
            ))}
          </select>
        </label>
        {power.range > 0 && (
          <label>
            at
            <select value={target?.id ?? ''} onChange={e => setAim(e.target.value)} disabled={!targets.length}>
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.owner === m.owner ? ' (friend)' : ''}, {formatInches(distanceBetween(m, t))}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="power-card muted small">
        {power.range > 0 ? `${power.range}"` : 'Self'} · casts on {power.cv}+{info ? ` · ${info.duration}` : ''}
        {effect && (
          <>
            <br />
            {effect}
          </>
        )}
      </p>
      {why ? (
        <p className="muted small">{why}</p>
      ) : (
        <div className="row wrap">
          <Num label="Will" value={n} min={1} max={Math.max(1, m.will)} onChange={setWill} />
          <button className="primary" onClick={() => dispatch({ type: 'cast', model: m.id, target: target!.id, power: power.name, cv: power.cv, will: n })}>
            Cast with {n} {n === 1 ? 'die' : 'dice'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The latest power cast and how it went; casting itself is on the caster's card. */
export function MagicPanel({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role; selected?: Set<string> }) {
  const lastCast = [...state.log].reverse().find(r => r.label.startsWith('Cast '));
  if (!lastCast) return null;
  const lastResist = [...state.log].reverse().find(r => r.label.startsWith('Resist ') && r.at >= lastCast.at);
  return (
    <div className="magic">
      <h4>Magic</h4>
      <p className="muted">Heroes cast their powers from their card in the Move phase. The game rolls, spends the Will and asks the target's player about resisting.</p>
      <div className="rules-result">
        <ol className="log">
          <RollRow r={lastCast} state={state} role={role} dispatch={dispatch} />
          {lastResist && <RollRow r={lastResist} state={state} role={role} dispatch={dispatch} />}
        </ol>
      </div>
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
