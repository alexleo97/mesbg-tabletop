import { useState } from 'react';
import { modelStats, pictureUrl, statsWithOptions, STAT_NAMES, type Catalog } from '../shared/catalog.ts';
import type { Combat } from '../shared/flow.ts';
import { distanceBetween, formatInches } from '../shared/geometry.ts';
import { formatNeed, missileWeapon, woundNeed } from '../shared/rules.ts';
import type { Action, GameState, Model, Role } from '../shared/types.ts';

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  role: Role;
  model: Model;
  catalog: Catalog | null;
  /** The enemy this model is aiming at in the Shoot phase. */
  target: Model | undefined;
  clearTarget: () => void;
  combat: Combat | undefined;
  openFight: (key: string) => void;
  openTab: (t: 'model' | 'rules') => void;
  close: () => void;
}

/** What the gear of a model says it can shoot with, if anything. */
export function weaponOf(m: Model, catalog: Catalog | null) {
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  return unit ? missileWeapon([...unit.wargear, ...(m.options ?? [])]) : undefined;
}

function Counter({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="counter">
      <button onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Spend ${label}`}>−</button>
      <span>
        {label} <b>{value}</b>
      </span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Add ${label}`}>+</button>
    </span>
  );
}

/** A selected model's card: its profile at a glance and the actions that make sense in this phase. */
export function ModelCard({ state, dispatch, role, model: m, catalog, target, clearTarget, combat, openFight, openTab, close }: Props) {
  const [obstacles, setObstacles] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  const printed = unit && statsWithOptions(unit, unit.options.filter(o => m.options?.includes(o.name)).map(o => o.id));
  const stats = modelStats(catalog, m);
  const mine = role === m.owner;
  const weapon = weaponOf(m, catalog);
  const patch = (p: Partial<Model>) => dispatch({ type: 'updateModel', id: m.id, patch: p });
  const photo = unit && pictureUrl(unit);

  let action: React.ReactNode = null;
  if (state.phase === 'shoot' && mine && weapon && state.flow.started) {
    if (!target) action = <p className="hint">Tap an enemy model to aim the {weapon.name.toLowerCase()} ({weapon.range}", S{weapon.s}).</p>;
    else {
      const dist = distanceBetween(m, target);
      const tStats = modelStats(catalog, target);
      const d = tStats?.D ?? 4;
      const shoot = stats?.Sv ?? 4;
      const need = woundNeed(weapon.s, d);
      const inRange = dist <= weapon.range;
      action = (
        <div className="aim-card">
          <p>
            At <b>{target.name}</b>: {formatInches(dist)} of {weapon.range}"{inRange ? '' : ', out of range'}. Hits on {shoot}+, wounds on {formatNeed(need)}.
          </p>
          <div className="row wrap">
            <span className="counter">
              <button onClick={() => setObstacles(o => Math.max(0, o - 1))} aria-label="Fewer things in the way">−</button>
              <span>
                In the way <b>{obstacles}</b>
              </span>
              <button onClick={() => setObstacles(o => Math.min(5, o + 1))} aria-label="More things in the way">+</button>
            </span>
            <button
              className="primary"
              disabled={!inRange || !need}
              onClick={() =>
                dispatch({
                  type: 'shoot',
                  shot: { shooter: { id: m.id, name: m.name, weapon: weapon.name, shoot, s: weapon.s, shots: 1 }, target: { id: target.id, name: target.name, d }, obstacles },
                })
              }
            >
              Shoot
            </button>
            <button onClick={clearTarget}>Change target</button>
          </div>
        </div>
      );
    }
  } else if (state.phase === 'fight' && combat) {
    const done = state.flow.resolved.includes(combat.key);
    action = (
      <button className={done ? '' : 'primary'} onClick={() => openFight(combat.key)}>
        {done ? '✓ Fight rolled, view it' : 'Roll this fight'}
      </button>
    );
  }

  return (
    <div className={`model-card ${m.owner}`}>
      <button className="close" onClick={close} aria-label="Deselect">✕</button>
      <div className="card-head">
        {photo && !photoFailed ? <img src={photo} alt="" onError={() => setPhotoFailed(true)} /> : <span className="avatar">{m.name.slice(0, 1)}</span>}
        <div>
          <b>{m.name}</b>
          {printed && (
            <div className="stat-line">
              {STAT_NAMES.map((k, i) => (
                <span key={k}>
                  <small>{k}</small>
                  {printed[i]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="row wrap counters">
        <span className="wound-pips" aria-label={`${m.wounds} of ${m.maxWounds} wounds`}>
          {Array.from({ length: m.maxWounds }, (_, i) => (
            <button key={i} className={i < m.wounds ? 'on' : ''} disabled={!mine} onClick={() => patch(i < m.wounds ? { wounds: i } : { wounds: i + 1 })} aria-label={`Set wounds to ${i < m.wounds ? i : i + 1}`}>
              ♥
            </button>
          ))}
        </span>
        {m.hero && mine && (
          <>
            <Counter label="Might" value={m.might} max={9} onChange={v => patch({ might: v })} />
            <Counter label="Will" value={m.will} max={9} onChange={v => patch({ will: v })} />
            <Counter label="Fate" value={m.fate} max={9} onChange={v => patch({ fate: v })} />
          </>
        )}
      </div>
      {action}
      <div className="row wrap card-actions">
        {mine && (
          <button onClick={() => dispatch({ type: 'roll', count: 2, label: `Courage test: ${m.name}`, ...(stats?.C ? { sum: stats.C } : {}) })}>Courage</button>
        )}
        {mine && m.hero && m.will > 0 && <button onClick={() => openTab('rules')}>Cast a power</button>}
        {mine && (
          <button onClick={() => patch(m.wounds > 0 ? { wounds: 0, dead: true } : { dead: true })} title="Move to the casualty pile">
            Slain
          </button>
        )}
        <button onClick={() => openTab('model')}>More</button>
      </div>
    </div>
  );
}
