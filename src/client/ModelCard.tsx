import { useEffect, useState, type Ref } from 'react';
import { loadRulesText, modelStats, pictureUrl, startingPoints, statsWithOptions, STAT_NAMES, type Catalog } from '../shared/catalog.ts';
import { strikeWounds, woundsTaken } from '../shared/fight.ts';
import { CONTACT_SLACK, type Combat } from '../shared/flow.ts';
import { engaged, fightDone, moveLeft } from '../shared/movement.ts';
import { atCrossing, crossBlocked, fallingHits, terrainName, type CrossTest } from '../shared/terrainTests.ts';
import { heroicInfo, phaseAllows } from '../shared/heroics.ts';
import { carriedBy, markerActions, OBJECT_NAMES } from '../shared/objects.ts';
import { causesTerror } from '../shared/courage.ts';
import { effectNotes, heldBy } from '../shared/powers.ts';
import { isThrowing, planShot, shooterBlocked, throwingPoint, weaponFor } from '../shared/shooting.ts';
import { flooredAt, floorHeight, floorName, sightTo, standingAt } from '../shared/sight.ts';
import RULES from '../data/special-rules.json';
import { CastBox } from './MagicPanel.tsx';
import { RollRow } from './Panels.tsx';
import { useDraggable } from './useDraggable.tsx';
import { distanceBetween, formatInches } from '../shared/geometry.ts';
import { formatNeed, woundNeed } from '../shared/rules.ts';
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
export const weaponOf = (m: Model, catalog: Catalog | null) => weaponFor(catalog, m);

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

const TEST_HELP: Record<CrossTest, string> = {
  Jump: 'a Jump test gets it over',
  Climb: 'a Climb test gets it up',
  'Climb down': 'a Climb test gets it down',
  Leap: 'a Leap test gets it across',
};

/** In the Move phase: the test for terrain the model was stopped at, and crawling or lying down. */
function TerrainMoves({ state, dispatch, m }: { state: GameState; dispatch: (a: Action) => void; m: Model }) {
  const at = atCrossing(state, m);
  const left = moveLeft(state, m);
  const moved = !!state.flow.starts?.[m.id];
  const stopped = state.flow.stopped?.includes(m.id);
  if (at) {
    const t = state.terrain[at.terrain];
    const c = { terrain: at.terrain, test: at.test, stop: { x: at.stop[0], y: at.stop[1] }, landing: { x: at.landing[0], y: at.landing[1] }, drop: at.drop };
    const why = crossBlocked(state, m, c);
    const falls = at.test === 'Climb down' && fallingHits(m, at.drop) ? `, and a fall this far does ${fallingHits(m, at.drop)} Strength 3 hit${fallingHits(m, at.drop) === 1 ? '' : 's'}` : '';
    return (
      <div className="terrain-test">
        <p>
          {m.name} is at the {terrainName(t)}: {TEST_HELP[at.test]}. On a 1 it {at.test === 'Jump' ? 'stays put' : 'falls and is Prone'}
          {falls}; on 2-5 it gets {at.test === 'Leap' ? 'across' : at.test === 'Climb' ? 'up' : at.test === 'Climb down' ? 'down' : 'over'} and its move ends; on a 6 it carries on.
        </p>
        {why && <p className="warn">{why}.</p>}
        <div className="row wrap">
          <button className="primary" disabled={!!why} onClick={() => dispatch({ type: 'cross', id: m.id })}>
            {at.test === 'Climb down' ? 'Climb down' : at.test}
          </button>
          {at.test === 'Leap' && <button onClick={() => dispatch({ type: 'crossed', id: m.id, terrain: at.terrain })}>Wade in</button>}
        </div>
      </div>
    );
  }
  if (stopped) return <p className="hint">{m.name}'s move has ended this turn.</p>;
  if (m.prone && !moved && !state.flow.crawling?.includes(m.id) && !state.flow.lay?.includes(m.id))
    return (
      <div className="row wrap terrain-test">
        <p className="muted small">Prone: moving it stands it up for half its Move, or it can crawl 1" and stay down.</p>
        <button onClick={() => dispatch({ type: 'crawl', id: m.id })}>Crawl 1"</button>
      </div>
    );
  if (m.prone && state.flow.crawling?.includes(m.id)) return <p className="hint">{m.name} is crawling: up to 1", staying Prone.</p>;
  if (!m.prone && left !== null && left + 1e-6 >= m.move / 2 && !state.flow.stood?.includes(m.id) && !engaged(state, m))
    return (
      <div className="row wrap terrain-test">
        <button className="small" title={`Lying down costs half its Move and ends its move. Prone, it is half as tall for sight but has no Control Zone.`} onClick={() => dispatch({ type: 'lieDown', id: m.id })}>
          Lie down
        </button>
      </div>
    );
  return null;
}

/** A selected model's card: its profile at a glance and the actions that make sense in this phase. */
export function ModelCard({ state, dispatch, role, model: m, catalog, target, clearTarget, combat, openFight, openTab, close }: Props) {
  const drag = useDraggable('model-card');
  const [photoFailed, setPhotoFailed] = useState(false);
  const [openRule, setOpenRule] = useState<string | null>(null);
  const seen = target ? sightTo(state, m, target) : null;
  const up = Math.round(standingAt(state, m) * 10) / 10;
  // Inside a building with floors, the model's player picks which level it stands on (climbing costs Move in the battle).
  const building = !m.dead ? flooredAt(state, m) : undefined;
  const left = building ? moveLeft(state, m) : null;
  const climbCost = (level: number) => (building ? Math.abs(floorHeight(building, level) - floorHeight(building, m.floor ?? 0)) : 0);
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

  // In the Move phase, charging an enemy with Terror within reach needs a Courage test first.
  const terrifying =
    state.phase === 'move' && mine && state.flow.started
      ? Object.values(state.models).filter(e => e.owner !== m.owner && !e.dead && distanceBetween(m, e) <= m.move + 1 && causesTerror(catalog, e, state))
      : [];
  const heroics = state.flow.heroics.filter(h => h.model === m.id);
  // This model's own latest roll, while it's still recent, so a hero can spend Might on it here.
  const recent = state.log.slice(-6).reverse().find(r => r.model === m.id);
  const rules = rulesOf(m, catalog);
  const effects = state.flow.started ? effectNotes(state, catalog, m) : [];
  const held = state.flow.started && state.phase === 'move' ? heldBy(state, m) : null;

  let action: React.ReactNode = null;
  const throwing = state.phase === 'move' && !!weapon && isThrowing(weapon);
  const mustCharge = state.flow.mustCharge?.model === m.id ? state.models[state.flow.mustCharge.target] : undefined;
  if (state.phase === 'move' && mine && mustCharge && !mustCharge.dead && distanceBetween(m, mustCharge) > CONTACT_SLACK) {
    action = <p className="hint">{m.name} threw at {mustCharge.name}, so it must now finish its charge: move it into contact with {mustCharge.name}.</p>;
  } else if ((state.phase === 'shoot' || (throwing && target)) && mine && weapon && state.flow.started) {
    const charge = state.phase === 'move';
    const hasShot = !!state.flow.shot?.includes(m.id);
    const held = heldBy(state, m);
    const blocked = shooterBlocked(state, m, weapon, charge);
    if (held) action = <p className="hint">{m.name} is {held === 'Thrown from its mount' ? 'thrown from its mount' : held}, so it can't shoot this turn.</p>;
    else if (blocked && (!target || hasShot)) action = <p className="hint">{m.name} {blocked}{hasShot ? '. Each model shoots once a turn.' : ', so it can’t shoot this turn.'}</p>;
    else if (!target)
      action = (
        <p className="hint">
          Tap an enemy model to aim the {weapon.name.toLowerCase()} ({weapon.range}", S{weapon.s}).
          {state.flow.moved?.includes(m.id) ? ' It moved this turn, so it shoots 1 worse.' : ''}
        </p>
      );
    else {
      const plan = planShot(state, catalog, m, target, { charge });
      const tStats = modelStats(catalog, target);
      const d = tStats?.D ?? 4;
      const need = woundNeed(weapon.s, d);
      const stand = charge ? throwingPoint(state, m, target) : null;
      const why = plan.why ?? (charge && !stand ? `can’t get within 1" of ${target.name} to throw` : undefined);
      const ok = !why && !!need && phaseAllows(state, role, { type: 'shoot', shot: { shooter: { id: m.id }, charge } });
      const harder = [plan.moved ? '1 worse for moving' : '', plan.need > plan.printed + (plan.moved ? 1 : 0) ? 'a power makes it harder' : ''].filter(Boolean).join(', ');
      const stray = plan.fight?.[0] ? state.models[plan.fight[0]] : undefined;
      action = (
        <div className="aim-card">
          <p>
            {charge ? 'Throw at' : 'At'} <b>{target.name}</b>: {formatInches(plan.dist)} of {weapon.range}". Hits on {plan.need}+{harder ? ` (${harder})` : ''}, wounds on {formatNeed(need)}
            {plan.shots > 1 ? `, ${plan.shots} shots (it didn't move)` : ''}.
          </p>
          {why && <p className="warn">{m.name} {why}.</p>}
          {!why && seen === 'partial' && <p className="muted small">{target.name} is partly hidden.</p>}
          {!why && (
            <p className="muted small">
              {plan.inWay.length
                ? `In the way: ${plan.inWay.map(o => o.name).join(', ')}. That's ${plan.inWay.length} In the Way roll${plan.inWay.length === 1 ? '' : 's'}, rolled for you; a model in the way that stops the shot is hit instead.`
                : 'Nothing is in the way.'}
              {stray ? ` ${target.name} is in a fight: on a 1-3 the shot hits ${stray.name} instead.` : ''}
              {plan.rerolls ? ' Heroic Accuracy re-rolls failed In the Way rolls.' : ''}
              {charge ? ` ${m.name} stops 1" short to throw, then must charge ${target.name} unless the throw slays it.` : ''}
            </p>
          )}
          <div className="row wrap">
            <button
              className="primary"
              disabled={!ok}
              title={hasShot ? `${m.name} has shot this turn. Each model shoots once a turn.` : !phaseAllows(state, role, { type: 'shoot', shot: { shooter: { id: m.id }, charge } }) ? 'Models shoot in the Shoot phase, when it is their side’s turn.' : undefined}
              onClick={() =>
                dispatch({
                  type: 'shoot',
                  shot: { shooter: { id: m.id, name: m.name, weapon: weapon.name, shoot: plan.printed, s: weapon.s, shots: plan.shots }, target: { id: target.id, name: target.name, d }, obstacles: plan.inWay.length, ...(charge ? { charge: true } : {}) },
                })
              }
            >
              {hasShot ? 'Shot this turn' : charge ? 'Throw and charge' : 'Shoot'}
            </button>
            <button onClick={clearTarget}>Change target</button>
          </div>
          {lastShot && !woundsTaken(state.flow.applied, lastShot.group ?? '', lastShot.against!) && (() => {
            const victim = state.models[lastShot.against!];
            const wounds = strikeWounds(shotRolls.filter(r => r.against === victim?.id));
            return victim && !victim.dead && wounds > 0 ? (
              <button onClick={() => dispatch({ type: 'wound', id: victim.id, count: wounds, by: [m.id], how: 'shoot', group: lastShot.group })}>
                Wound {victim.name} {wounds} time{wounds === 1 ? '' : 's'}
                {victim.hero && victim.fate > 0 ? ' (Fate can be rolled)' : victim.wounds - wounds <= 0 ? ' (slain)' : ''}
              </button>
            ) : null;
          })()}
        </div>
      );
    }
  } else if (state.phase === 'fight' && combat) {
    const done = fightDone(state, combat);
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
      {building && (
        <div className="floors">
          <span className="muted">{floorName(building, m.floor ?? 0)} of the {building.kind === 'ruin' ? 'ruins' : 'building'}.</span>
          {mine && (
            <div className="row wrap">
              {Array.from({ length: (building.floors ?? 0) + 1 }, (_, level) => {
                const cost = climbCost(level);
                const blocked = level !== (m.floor ?? 0) && left !== null && (state.phase !== 'move' || left + 1e-6 < cost || !!m.prone);
                return (
                  <button key={level} className={level === (m.floor ?? 0) ? 'on' : ''} disabled={level === (m.floor ?? 0) || blocked} title={left !== null && cost ? `Costs ${formatInches(cost)} of Move` : undefined} onClick={() => dispatch({ type: 'climb', id: m.id, floor: level })}>
                    {floorName(building, level)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
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
      {effects.length > 0 && (
        <ul className="effects">
          {effects.map(e => (
            <li key={e}>✦ {e}</li>
          ))}
        </ul>
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
      {held ? (
        <p className="warn">{m.name} is {held === 'Thrown from its mount' ? 'thrown from its mount' : held}, so it can't move or act this turn.</p>
      ) : state.flow.compel?.model === m.id ? (
        <p className="warn">{m.name} is Compelled: {state.models[state.flow.compel.caster]?.name ?? 'the caster'}'s player moves it up to {formatInches(state.flow.compel.max)}.</p>
      ) : state.flow.held?.includes(m.id) && state.phase === 'move' ? (
        <p className="warn">{m.name} was Compelled, so it can't move again this turn.</p>
      ) : state.flow.courage?.[m.id] === false && state.phase === 'move' ? (
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
      {mine && state.phase === 'move' && state.flow.started && !held && <TerrainMoves state={state} dispatch={dispatch} m={m} />}
      {mine && state.phase === 'move' && <CastBox state={state} dispatch={dispatch} role={role} model={m} />}
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
