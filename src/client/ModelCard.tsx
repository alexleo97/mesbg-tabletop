import { useEffect, useState, type Ref } from 'react';
import { loadRulesText, modelStats, pictureUrl, startingPoints, statsWithOptions, STAT_NAMES, type Catalog } from '../shared/catalog.ts';
import { strikeWounds } from '../shared/fight.ts';
import type { Combat } from '../shared/flow.ts';
import { heroicInfo, phaseAllows } from '../shared/heroics.ts';
import { carriedBy, markerActions, OBJECT_NAMES } from '../shared/objects.ts';
import { groundAt, inTheWay, sightTo } from '../shared/sight.ts';
import RULES from '../data/special-rules.json';
import { RollRow } from './Panels.tsx';
import { useDraggable } from './useDraggable.tsx';
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

/** A hero's Might, Will or Fate as pips: filled for what's left, hollow for what's been spent. The game spends them. */
function Points({ label, value, max }: { label: string; value: number; max: number }) {
  if (max <= 0 && value <= 0) return null;
  const total = Math.max(max, value);
  return (
    <span className="points" aria-label={`${label}: ${value} of ${total} left`} title={`${label}: ${value} of ${total} left`}>
      <small>{label}</small>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  );
}

const SUMMARIES = RULES as Record<string, string>;

/** Our summary of a special rule, looked up by its name without the bracketed part ("Hatred (Rohan)" is Hatred). */
export function ruleSummary(name: string): string | undefined {
  return SUMMARIES[name] ?? SUMMARIES[name.replace(/\s*\(.*$/, '').replace(/\.$/, '').trim()];
}

/** The special rules on a model's profile. */
export function rulesOf(m: Model, catalog: Catalog | null): string[] {
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  return unit?.rules ?? [];
}

/** A selected model's card: its profile at a glance and the actions that make sense in this phase. */
export function ModelCard({ state, dispatch, role, model: m, catalog, target, clearTarget, combat, openFight, openTab, close }: Props) {
  const drag = useDraggable('model-card');
  const [photoFailed, setPhotoFailed] = useState(false);
  const [openRule, setOpenRule] = useState<string | null>(null);
  // What's between the shooter and its target: the game rolls In the Way for each (up to 5).
  const between = target ? inTheWay(state, m, target) : [];
  const obstacles = Math.min(5, between.length);
  const seen = target ? sightTo(state, m, target) : null;
  const up = groundAt(state, m);
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  const printed = unit && statsWithOptions(unit, unit.options.filter(o => m.options?.includes(o.name)).map(o => o.id));
  const stats = modelStats(catalog, m);
  const start = startingPoints(catalog, m);
  const [rulesText, setRulesText] = useState<Record<string, string>>({});
  useEffect(() => {
    loadRulesText().then(setRulesText, () => {});
  }, []);
  const explain = (r: string) => rulesText[unit?.ruleRefs?.[r] ?? ''] ?? ruleSummary(r);
  const mine = role === m.owner;
  // Objectives are handled as models move (dropping one is always allowed).
  const markers = markerActions(state, m).filter(a => a.kind === 'drop' || phaseAllows(state, m.owner, { type: a.kind }));
  const carried = carriedBy(state, m);
  const weapon = weaponOf(m, catalog);
  const patch = (p: Partial<Model>) => dispatch({ type: 'updateModel', id: m.id, patch: p });
  const photo = unit && pictureUrl(unit);

  // This model's latest shot, so its wounds can be taken off the target in one tap.
  const lastShotGroup = [...state.log].reverse().find(r => r.group?.startsWith('s-') && r.model === m.id)?.group;
  const shotRolls = lastShotGroup ? state.log.filter(r => r.group === lastShotGroup) : [];
  const lastShot = shotRolls.find(r => r.against);
  const shotWounds = strikeWounds(shotRolls);

  // In the Move phase, charging an enemy with Terror within reach needs a Courage test first.
  const terrifying =
    state.phase === 'move' && mine && state.flow.started
      ? Object.values(state.models).filter(e => e.owner !== m.owner && !e.dead && distanceBetween(m, e) <= m.move + 1 && rulesOf(e, catalog).some(r => /^Terror\b/.test(r)))
      : [];
  const heroics = state.flow.heroics.filter(h => h.model === m.id);
  // This model's own latest roll, while it's still recent, so a hero can spend Might on it here.
  const recent = state.log.slice(-6).reverse().find(r => r.model === m.id);
  const rules = rulesOf(m, catalog);

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
          {seen === 'hidden' && <p className="warn">Terrain seems to hide {target.name} completely. Check from the model's eye level.</p>}
          <p className="muted small">
            {between.length
              ? `In the way: ${between.join(', ')}. That's ${obstacles} In the Way roll${obstacles === 1 ? '' : 's'}, rolled for you.`
              : 'Nothing is in the way.'}
          </p>
          <div className="row wrap">
            <button
              className="primary"
              disabled={!inRange || !need || !phaseAllows(state, role, { type: 'shoot', shot: { shooter: { id: m.id } } })}
              title={!phaseAllows(state, role, { type: 'shoot', shot: { shooter: { id: m.id } } }) ? 'Models shoot in the Shoot phase, when it is their side’s turn.' : undefined}
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
          {shotWounds > 0 && lastShot && lastShot.against === target.id && !state.flow.applied?.includes(lastShot.group ?? '') && !target.dead && (
            <button onClick={() => dispatch({ type: 'wound', id: target.id, count: shotWounds, by: [m.id], how: 'shoot', group: lastShot.group })}>
              Wound {target.name} {shotWounds} time{shotWounds === 1 ? '' : 's'}
              {target.hero && target.fate > 0 ? ' (Fate can be rolled)' : target.wounds - shotWounds <= 0 ? ' (slain)' : ''}
            </button>
          )}
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
    <div ref={drag.ref as Ref<HTMLDivElement>} style={drag.style} className={`model-card ${m.owner}`}>
      <button className="close" onClick={close} aria-label="Deselect">✕</button>
      {drag.controls && <span className="model-card-grip">{drag.controls}</span>}
      <div className={`card-head ${drag.draggable ? 'grab' : ''}`} onPointerDown={drag.onPointerDown}>
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
        {m.hero && (
          <>
            <Points label="Might" value={m.might} max={start?.might ?? m.might} />
            <Points label="Will" value={m.will} max={start?.will ?? m.will} />
            <Points label="Fate" value={m.fate} max={start?.fate ?? m.fate} />
          </>
        )}
      </div>
      {up > 0 && <p className="muted high-ground">▲ Standing {up}" up: sees and shoots over lower terrain.</p>}
      {heroics.length > 0 && (
        <div className="row wrap">
          {heroics.map(h => (
            <span key={h.action} className="heroic-tag" title={heroicInfo(h.action)?.tip}>
              ⚡ {h.action}
            </span>
          ))}
        </div>
      )}
      {rules.length > 0 && (
        <div className="rule-chips">
          {rules.map(r => {
            const known = explain(r);
            return (
              <button key={r} className={`rule-chip ${openRule === r ? 'on' : ''} ${known ? '' : 'plain'}`} onClick={() => setOpenRule(openRule === r ? null : r)} aria-expanded={openRule === r}>
                {r}
              </button>
            );
          })}
          {openRule && <p className="rule-text">{explain(openRule) ?? (Object.keys(rulesText).length ? 'We have no explanation for this rule yet.' : 'Loading…')}</p>}
        </div>
      )}
      {state.flow.courage?.[m.id] === false && state.phase === 'move' ? (
        <p className="warn">{m.name} failed its Courage test, so it can't move this turn.</p>
      ) : (
        terrifying.length > 0 &&
        state.flow.courage?.[m.id] === undefined && (
          <p className="muted terror">
            {terrifying.map(e => e.name).join(' and ')} {terrifying.length === 1 ? 'causes' : 'cause'} Terror. Move into contact to charge, and {m.name} tests its Courage first. If it fails, it stays put this turn.
          </p>
        )
      )}
      {action}
      {carried.length > 0 && <p className="muted carrying">Carrying {carried.map(t => `the ${OBJECT_NAMES[t.object!]}`).join(' and ')}.</p>}
      {mine && markers.length > 0 && (
        <div className="row wrap marker-actions">
          {markers.map(a => (
            <button
              key={a.kind + (a.marker ?? '')}
              className="primary"
              onClick={() =>
                dispatch(
                  a.kind === 'escape'
                    ? { type: 'escape', model: m.id }
                    : a.kind === 'drop'
                      ? { type: 'drop', marker: a.marker! }
                      : a.kind === 'uncover'
                        ? { type: 'uncover', model: m.id, marker: a.marker!, intelligence: stats?.I ?? 7 }
                        : { type: a.kind, model: m.id, marker: a.marker! },
                )
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {recent && (
        <ol className="log card-roll">
          <RollRow r={recent} state={state} role={role} dispatch={dispatch} />
        </ol>
      )}
      <div className="row wrap card-actions">
        {mine && (
          <button onClick={() => dispatch({ type: 'roll', count: 2, label: `Courage test: ${m.name}`, model: m.id, ...(stats?.C ? { sum: stats.C } : {}) })}>Courage</button>
        )}
        {mine && m.will > 0 && !!(m.profileId && catalog?.units[m.profileId]?.powers?.length) && <button onClick={() => openTab('rules')}>Cast a power</button>}
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
