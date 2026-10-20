import { useState } from 'react';
import { ResultReport } from './ResultReport.tsx';
import { activeSeat, other, type Combat } from '../shared/flow.ts';
import { phaseFinished } from '../shared/autoPhase.ts';
import { breachesLeft } from '../shared/breach.ts';
import { fightDone } from '../shared/movement.ts';
import { canDeclare, GOES_FIRST, heroicInfo, heroicNow, heroicsSettled, heroicTurn, HEROICS, mayDeclare, orderRollLabel, orderRollNeeded, phaseHeroics, shoutedFor } from '../shared/heroics.ts';
import { distanceBetween } from '../shared/geometry.ts';
import { rulesFor, startingPoints } from '../shared/catalog.ts';
import { longbeardFor, mayAxeTest, spentPoints, swapPair, trumpetDue } from '../shared/company.ts';
import { onEdge, reinforceDue } from '../shared/mutton.ts';
import { tierOf } from '../shared/warbands.ts';
import { RollRow } from './Panels.tsx';
import { useDraggable } from './useDraggable.tsx';
import { useLocked } from './lessonLock.ts';
import { pendingSpell } from '../shared/magic.ts';
import { freeResistDice, isAreaPower, isLinePower } from '../shared/powers.ts';
import { formatInches } from '../shared/geometry.ts';
import { useCatalog } from './ListBuilder.tsx';
import { arrivalAuto, arrivalDue, mayCry } from '../shared/narrative.ts';
import { placingNow } from '../shared/placing.ts';
import { longshanksFree } from '../shared/sam.ts';
import { waitingWarbands, warbandName } from '../shared/maelstrom.ts';
import { scenarioById } from '../shared/scenarios.ts';
import { scoreLines, vpTotals } from '../shared/scoring.ts';
import { armyStatus, endCheck, endRollLabel } from '../shared/status.ts';
import { PHASES, type Action, type GameState, type Model, type Role, type Seat } from '../shared/types.ts';

const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { priority: 'Priority', move: 'Move', shoot: 'Shoot', fight: 'Fight', end: 'End' };

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  role: Role;
  combats: Combat[];
  /** Opens a tab of the battle card on the left. */
  /** What the card shows: the turn guide, or the table's settings or the dice log in its place. */
  view: CoachView;
  setView: (v: CoachView) => void;
  table: React.ReactNode;
  log: React.ReactNode;
  openFight: (key: string) => void;
  /** The server moves finished Fight and End phases on by itself (not in the training, which runs in the browser). */
  auto?: boolean;
}

type Dispatch = (a: Action) => void;
export type CoachView = 'turn' | 'table' | 'log';

/** Declaring heroic actions at the start of the Move, Shoot and Fight phases, taking turns from the player without Priority. */
/** A power cast and waiting: its target's player chooses whether to resist, or its caster whether to spend Might. */
function SpellStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const locked = useLocked();
  const p = pendingSpell(state);
  const { catalog } = useCatalog();
  const [will, setWill] = useState(1);
  if (!p) return null;
  const { caster, target } = p;
  if (p.ready) return <p className="spell-step">{p.power} works: the game is putting it into play.</p>;
  if (!p.cast)
    return (
      <div className="spell-step">
        <p>
          {caster.name} rolled a {p.best} casting {p.power} and needs {p.cv}.{' '}
          {caster.owner === role ? 'Spend Might on the die in the log to raise it, or let it fail.' : `Waiting for ${name(caster.owner)} to spend Might or let it fail.`}
        </p>
        <ol className="log">
          <RollRow r={p.rollEntry} state={state} role={role} dispatch={dispatch} />
        </ol>
        {caster.owner === role && <button {...locked({ type: 'letSpellFail' })} onClick={() => dispatch({ type: 'letSpellFail' })}>Let it fail</button>}
      </div>
    );
  const n = Math.max(1, Math.min(will, target.will));
  // Free dice (Fortify Spirit, Resistant to Magic, Heroic Resolve) are always rolled, and cost nothing.
  const free = freeResistDice(state, catalog, target);
  const freeText = free ? ` plus ${free} free ${free === 1 ? 'die' : 'dice'}` : '';
  const all = isAreaPower(p.power) || isLinePower(p.power);
  return (
    <div className="spell-step">
      <p>
        {caster.name} cast <b>{p.power}</b> on a {p.best}{all ? `; ${target.name} resists for all it hits` : ` at ${target.name}`}.{' '}
        {target.owner === role
          ? `Resist by spending Will: each point is a die, and any ${p.best === 6 ? '6' : `${p.best} or more`} stops it. ${target.name} has ${target.will} Will${freeText}.`
          : `Waiting for ${name(target.owner)} to choose whether ${target.name} resists.`}
      </p>
      {target.owner === role && (
        <div className="row wrap">
          {target.will > 0 && (
            <>
              <label className="stepper">
                <span>Will</span>
                <button onClick={() => setWill(Math.max(1, n - 1))} aria-label="Less Will">−</button>
                <b>{n}</b>
                <button onClick={() => setWill(Math.min(target.will, n + 1))} aria-label="More Will">+</button>
              </label>
              <button className="primary" {...locked({ type: 'resist', will: n })} onClick={() => dispatch({ type: 'resist', will: n })}>
                Resist with {n + free} {n + free === 1 ? 'die' : 'dice'}
              </button>
            </>
          )}
          <button className={target.will > 0 ? '' : 'primary'} {...locked({ type: 'resist', will: 0 })} onClick={() => dispatch({ type: 'resist', will: 0 })}>
            {free ? `Roll only the free ${free === 1 ? 'die' : 'dice'}` : "Don't resist"}
          </button>
        </div>
      )}
    </div>
  );
}

/** A hero's shot that stopped on a roll its Might could still save: spend it on the die, or carry on. */
function ShotPauseStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const p = state.flow.shotPause;
  const hero = p && state.models[p.shot.shooter.id];
  const r = p && state.log.filter(x => x.group === p.group).at(-1);
  if (!p || !hero || !r) return null;
  return (
    <div className="spell-step">
      <p>
        {hero.name}'s shot is waiting: {hero.owner === role ? `spend Might on the die to raise it (${hero.might} left), or carry on.` : `${name(hero.owner)} can spend Might on it before it goes on.`}
      </p>
      <ol className="log">
        <RollRow r={r} state={state} role={role} dispatch={dispatch} />
      </ol>
    </div>
  );
}

/** A Compel that worked: its caster's player drags the enemy model, then says they're done. */
function CompelStep({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  const locked = useLocked();
  const c = state.flow.compel;
  const t = c && state.models[c.model];
  const caster = c && state.models[c.caster];
  if (!c || !t || !caster) return null;
  return (
    <div className="spell-step">
      <p>
        {c.ring
          ? caster.owner === role
            ? `Sauron's Will has ${t.name}: drag it up to ${formatInches(c.max)} wherever you like (charging if you can), then say you're done.`
            : `Sauron's Will has ${t.name}: the other player moves it up to ${formatInches(c.max)} this turn.`
          : caster.owner === role
          ? `Drag ${t.name} up to ${formatInches(c.max)} (you can charge with it, but not take it out of a fight). It can't move again this turn.`
          : `${caster.name} has Compelled ${t.name}: the other player moves it up to ${formatInches(c.max)}.`}
      </p>
      {caster.owner === role && (
        <button className="primary" {...locked({ type: 'compel', compel: null })} onClick={() => dispatch({ type: 'compel', compel: null })}>
          Done moving {t.name}
        </button>
      )}
    </div>
  );
}

/** A model its player places before play goes on: Aragorn arriving, or a Ringwraith fleeing a flaming brand. */
function PlacingStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const locked = useLocked();
  const p = placingNow(state);
  const m = p && state.models[p.model];
  if (!p || !m) return null;
  const mine = p.seat === role;
  const from = (p.away ?? []).map(id => state.models[id]?.name).filter(Boolean).join(' and ') || 'the flames';
  const what =
    p.kind === 'join'
      ? p.stay
        ? `${m.name} can't reach Frodo's fight, so the game has moved ${m.name} as near to Frodo as possible.`
        : mine
          ? `${m.name} won the Heroic Combat and goes to Frodo's aid. The game has put ${m.name} in Frodo's fight: drag ${m.name} elsewhere in it if you like, then confirm.`
          : `${m.name} goes to Frodo's aid: ${name(p.seat)} is placing ${m.name} in Frodo's fight.`
      : p.kind === 'arrive'
      ? mine
        ? `${m.name} has arrived. Drag ${m.name} anywhere round the edge of the ruin, touching it, then confirm.`
        : `${m.name} has arrived: ${name(p.seat)} is placing ${m.name} round the edge of the ruin.`
      : mine
        ? `${m.name} retreats ${formatInches(p.dist ?? 0)} from ${from}. Drag it the way you want it to go (never back towards the brand), then say you're done.`
        : `${m.name} retreats ${formatInches(p.dist ?? 0)} from ${from}: ${name(p.seat)} is choosing which way.`;
  return (
    <div className="spell-step">
      <p>{what}</p>
      {mine && (
        <button className="primary" {...locked({ type: 'placed', seat: p.seat })} onClick={() => dispatch({ type: 'placed', seat: p.seat })}>
          {p.kind === 'retreat' ? `Done moving ${m.name}` : `${m.name} stands here`}
        </button>
      )}
    </div>
  );
}

/**
 * Roast Mutton and Thorin's Company: Óin's Hearing Trumpet when an enemy hero calls a heroic action near him, Kíli and
 * Fíli swapping places as a phase starts, Bifur's test for a free Heroic Move, and the Company coming on from the west.
 */
function CompanyStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const locked = useLocked();
  const { catalog } = useCatalog();
  const me = role === 'spectator' ? null : role;
  const heard = trumpetDue(state, catalog);
  const twins = me ? swapPair(state, catalog, me) : null;
  const bifur = me ? Object.values(state.models).find(m => m.owner === me && mayAxeTest(state, catalog, m)) : undefined;
  const coming = onEdge(state);
  const caller = heard ? state.models[heard.heroic.model] : undefined;
  const deed = state.flow.chronicles?.[0];
  if (!heard && !twins && !bifur && !coming && !deed && !reinforceDue(state)) return null;
  const POINT = { might: 'Might', will: 'Will', fate: 'Fate' } as const;
  return (
    <div className="spell-step">
      {deed && (deed.seat === me ? (
        <>
          <p>Chronicler: Ori has seen the deed. {deed.ids.length === 1 && state.models[deed.ids[0]] ? `${state.models[deed.ids[0]].name} may get back a point spent earlier.` : 'The hero who did it has nothing spent, so another friend near Ori may get back a point instead.'}</p>
          {deed.ids.map(id => state.models[id]).filter(Boolean).flatMap(m => spentPoints(catalog, m).map(p => (
            <button key={`${m.id}-${p}`} {...locked({ type: 'chronicled', model: m.id, point: p })} onClick={() => dispatch({ type: 'chronicled', model: m.id, point: p })}>
              {deed.ids.length > 1 ? `${m.name}: ` : ''}a {POINT[p]} point
            </button>
          )))}
          <button {...locked({ type: 'chronicled' })} onClick={() => dispatch({ type: 'chronicled' })}>Let it go</button>
        </>
      ) : (
        <p>{name(deed.seat)} is choosing who gets a point back from Ori's Chronicler.</p>
      ))}
      {heard && caller && (heard.oin.owner === me ? (
        <>
          <p>
            {caller.name} calls a {heard.heroic.action} within 6" of {heard.oin.name}. Listen through the Hearing Trumpet? On a 5+ he calls the same for nothing; on a 1 he loses a Will point ({heard.oin.will ? `he has ${heard.oin.will}` : "he has none, so he can't move this turn"}).
          </p>
          <button className="primary" {...locked({ type: 'trumpet', listen: true })} onClick={() => dispatch({ type: 'trumpet', listen: true })}>Listen (roll a D6)</button>
          <button {...locked({ type: 'trumpet', listen: false })} onClick={() => dispatch({ type: 'trumpet', listen: false })}>Let it pass</button>
        </>
      ) : (
        <p>{name(heard.oin.owner)} is deciding whether {heard.oin.name} listens through his Hearing Trumpet.</p>
      ))}
      {twins && (
        <>
          <p>Combat Synergy: before any heroic action this phase, {twins[0].name} and {twins[1].name} may swap places (not a move). If they do, each may re-roll a die in his duels this turn.</p>
          <button {...locked({ type: 'swap', a: twins[0].id, b: twins[1].id })} onClick={() => dispatch({ type: 'swap', a: twins[0].id, b: twins[1].id })}>Swap {twins[0].name} and {twins[1].name}</button>
        </>
      )}
      {bifur && (
        <>
          <p>Embedded Axe: with the axe out of his head, {bifur.name} may take an Intelligence test now; passed, he can declare a Heroic Move this turn for nothing.</p>
          <button {...locked({ type: 'axeTest', model: bifur.id })} onClick={() => dispatch({ type: 'axeTest', model: bifur.id })}>Test {bifur.name}'s Intelligence</button>
        </>
      )}
      {reinforceDue(state) && <p>Rolling for the rest of the Company…</p>}
      {coming && (
        <p>
          {coming.owner === me ? 'Move' : `${name(coming.owner)} is moving`} {coming.name} on from the west edge (no charging). {coming.owner === me ? 'End the move to leave him at the edge.' : ''} The next Dwarf steps on when he has moved.
        </p>
      )}
    </div>
  );
}

function HeroicStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const locked = useLocked();
  const me = role === 'spectator' ? null : role;
  const { catalog } = useCatalog();
  const heroes = me ? canDeclare(state, me) : [];
  const [hero, setHero] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const turn = heroicTurn(state);
  const settled = heroicsSettled(state);
  const declaredNow = phaseHeroics(state);
  const pickedHero = heroes.find(m => m.id === hero) ?? heroes[0];
  const unitOf = (m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
  // Only the heroic actions this hero can call: the universal ones, and the rest if they're on its profile.
  const actions = HEROICS.filter(h => h.phase === state.phase && (!pickedHero || mayDeclare(state, pickedHero, h.name, unitOf(pickedHero)?.heroics, rulesFor(catalog, pickedHero))));
  const pickedAction = actions.find(a => a.name === action) ?? actions[0];
  // A Heroic Challenge names an enemy hero within 6", of the same tier or higher.
  const rivals = pickedHero
    ? Object.values(state.models).filter(e => e.hero && !e.dead && !e.escaped && !e.waiting && e.owner !== pickedHero.owner && distanceBetween(e, pickedHero) <= 6 && (!unitOf(e) || !unitOf(pickedHero) || tierOf(unitOf(e)) >= tierOf(unitOf(pickedHero))))
    : [];
  const pickedRival = rivals.find(e => e.id === target) ?? rivals[0];
  const challenge = pickedAction?.name === 'Heroic Challenge';
  const asked = (state.flow.challenges ?? []).filter(c => c.accepted === undefined && state.models[c.target]?.owner === role);
  const now = settled ? heroicNow(state) : null;
  const going = now?.hero ? state.models[now.hero] : undefined;
  const orderLabel = orderRollLabel(state);
  const orderRoll = [...state.log].reverse().find(r => r.label === orderLabel);

  return (
    <div className="heroic-step">
      {declaredNow.length > 0 && (
        <ul className="heroic-list">
          {declaredNow.map(h => {
            const m = state.models[h.model];
            return (
              <li key={h.model} className={m?.owner} title={heroicInfo(h.action)?.tip}>
                ⚡ <b>{m?.name ?? 'Hero'}</b> {h.action}
                {h.free ? ' (free)' : ''}
              </li>
            );
          })}
        </ul>
      )}
      {asked.map(c => (
        <div key={c.target} className="row wrap challenge-ask">
          <p>
            <b>{state.models[c.by]?.name}</b> challenges <b>{state.models[c.target]?.name}</b> to a duel. Accept, and the two get +1 Attack and +1 to wound against each other.
          </p>
          <button className="primary" {...locked({ type: 'answerChallenge', target: c.target, accept: true })} onClick={() => dispatch({ type: 'answerChallenge', target: c.target, accept: true })}>
            Accept
          </button>
          <button {...locked({ type: 'answerChallenge', target: c.target, accept: false })} onClick={() => dispatch({ type: 'answerChallenge', target: c.target, accept: false })}>Decline</button>
        </div>
      ))}
      {!settled && turn && (
        <>
          <p>
            Heroic actions: <b className={turn}>{turn === role ? 'you' : name(turn)}</b> {turn === role ? 'can' : 'can now'} declare one (1 Might) or pass.
          </p>
          {me === turn && pickedHero && (
            <>
              <div className="row wrap heroic-pick">
                <select value={pickedHero.id} onChange={e => setHero(e.target.value)} aria-label="Hero">
                  {heroes.map((m: Model) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.might} Might)
                    </option>
                  ))}
                </select>
                <select value={pickedAction?.name ?? ''} onChange={e => setAction(e.target.value)} aria-label="Heroic action">
                  {actions.map(a => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                      {a.name === 'Heroic Combat' && longshanksFree(state, pickedHero) ? ' (free: to Frodo!)' : ''}
                    </option>
                  ))}
                </select>
                {challenge && (
                  <select value={pickedRival?.id ?? ''} onChange={e => setTarget(e.target.value)} aria-label="Hero to challenge">
                    {!rivals.length && <option value="">No enemy hero within 6"</option>}
                    {rivals.map(e => (
                      <option key={e.id} value={e.id}>
                        Challenge {e.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {pickedAction && <p className="muted small">{pickedAction.tip}</p>}
              {pickedAction?.name === 'Heroic Combat' && longshanksFree(state, pickedHero) && (
                <p className="muted small">"Let him go or I'll have you, Longshanks!": no Might needed, but if it wins through {pickedHero.name} must go straight into Frodo's fight.</p>
              )}
              <div className="row choice-pair">
                <button
                  className="go"
                  {...locked({ type: 'declareHeroic', model: pickedHero.id, action: pickedAction?.name ?? '' })}
                  disabled={!pickedAction || (challenge && !pickedRival)}
                  onClick={() =>
                    pickedAction &&
                    dispatch({ type: 'declareHeroic', model: pickedHero.id, action: pickedAction.name, ...(challenge && pickedRival ? { target: pickedRival.id, cap: startingPoints(catalog, pickedHero)?.might ?? pickedHero.might } : {}) })
                  }
                >
                  Declare
                </button>
                <button className="go" {...locked({ type: 'passHeroic', seat: me })} onClick={() => dispatch({ type: 'passHeroic', seat: me })}>{declaredNow.some(h => state.models[h.model]?.owner === me) ? 'No more' : 'Pass'}</button>
              </div>
            </>
          )}
        </>
      )}
      {now?.seat ? (
        <p>
          {going
            ? `${going.owner === role ? 'Finish' : `${name(going.owner)} is finishing`} ${going.name}'s ${GOES_FIRST[state.phase]}${shoutedFor(state, going).length ? `, with the friends within 6" of where it began` : ''}, then end the activation.`
            : now.seat === role
              ? `Pick a hero to make its ${GOES_FIRST[state.phase]}: start moving it, or end the activation to skip it.`
              : `${name(now.seat)} picks a hero to make its ${GOES_FIRST[state.phase]}.`}
        </p>
      ) : null}
      {settled && orderRollNeeded(state) && (
        <p>
          Both sides declared heroic actions that go first.{' '}
          {orderRoll ? (
            <>
              Rolled a <b>{orderRoll.dice[0]}</b>: the <b>{orderRoll.dice[0] <= 3 ? 'Evil' : 'Good'}</b> player picks a hero to go first, then the players alternate.
            </>
          ) : state.priority === role ? (
            <button className="primary" {...locked({ type: 'roll', count: 1, label: orderLabel })} onClick={() => dispatch({ type: 'roll', count: 1, label: orderLabel })}>
              Roll for who goes first
            </button>
          ) : (
            `${name(state.priority ?? 'p1')} rolls a D6: 1-3 the Evil player's hero goes first, 4+ the Good player's.`
          )}
        </p>
      )}
    </div>
  );
}

/** Heroes with wounds waiting on Fate rolls. */
function FateStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const locked = useLocked();
  const waiting = Object.values(state.models).filter(m => m.pending && !m.dead);
  if (!waiting.length) return null;
  return (
    <div className="fate-step">
      {waiting.map(m => {
        const last = m.fateRoll ? state.log.find(r => r.id === m.fateRoll) : undefined;
        const n = m.pending!;
        return (
          <div key={m.id} className={`fate ${m.owner}`}>
            <p>
              <b>{m.name}</b> has {n} wound{n === 1 ? '' : 's'} to resolve and {m.fate} Fate left. Each Fate point is a D6: 4+ saves one wound.
            </p>
            {last && (
              <ol className="log">
                <RollRow r={last} state={state} role={role} dispatch={dispatch} />
              </ol>
            )}
            {m.owner === role ? (
              <div className="row wrap">
                {m.fate > 0 && (
                  <button className="primary" {...locked({ type: 'rollFate', id: m.id })} onClick={() => dispatch({ type: 'rollFate', id: m.id })}>
                    Roll Fate
                  </button>
                )}
                <button {...locked({ type: 'takeWound', id: m.id })} onClick={() => dispatch({ type: 'takeWound', id: m.id })}>Take {n === 1 ? 'the wound' : 'one wound'}</button>
                {n > 1 && <button {...locked({ type: 'takeWound', id: m.id, all: true })} onClick={() => dispatch({ type: 'takeWound', id: m.id, all: true })}>Take all {n}</button>}
              </div>
            ) : (
              <p className="muted">Waiting for {name(m.owner)} to roll Fate.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The turn guide: says what happens now, whose go it is, and offers the next step as one button. */
/** Maelstrom of Battle: the warbands still off the table, which the game rolls for as their side starts to move. */
function Reinforcements({ state, name }: { state: GameState; name: (s: Seat) => string }) {
  const sides = (['p1', 'p2'] as Seat[]).map(s => ({ s, bands: waitingWarbands(state, s) })).filter(x => x.bands.length);
  if (!sides.length) return null;
  return (
    <div className="reinforcements">
      {sides.map(({ s, bands }) => (
        <p key={s} className="muted small">
          {state.narrative ? (
            <>
              <b className={s}>{name(s)}</b> off the table: {countNames(bands.flat().map(m => m.name))}, until the scenario brings them on (see its special rules).
            </>
          ) : (
            <>
              <b className={s}>{name(s)}</b> off the table: {bands.map(b => `${warbandName(b)} (${b.length})`).join(', ')}. They roll to arrive as {name(s)} starts to move.
            </>
          )}
        </p>
      ))}
    </div>
  );
}

export function CoachBar({ state, dispatch, role, combats: allCombats, openFight, auto, view, setView, table, log }: Props) {
  const locked = useLocked();
  let combats = allCombats;
  const [small, setSmall] = useState(false);
  const drag = useDraggable('coach');
  const name = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const Who = ({ s, mid }: { s: Seat; mid?: boolean }) => <b className={s}>{s === role ? (mid ? 'you' : 'You') : name(s)}</b>;
  /** "You have priority" for yourself (and the practice table's "You" seat), "Sam has priority" for others. */
  const says = (s: Seat, you: string, them: string) => (s === role || name(s) === 'You' ? `You ${you}` : `${name(s)} ${them}`);
  const me = role === 'spectator' ? null : role;
  const { flow } = state;
  const { catalog } = useCatalog();

  let title: React.ReactNode;
  let body: React.ReactNode;

  if (!flow.started) {
    // At a real table the set-up card starts the battle; this is only shown in a lesson, which lays out the table itself.
    title = 'Set up the battle';
    body = (
      <>
        <p>The table and both armies are ready.</p>
        {me && (
          <button className="primary go" {...locked({ type: 'startGame' })} onClick={() => dispatch({ type: 'startGame' })}>
            Start the battle
          </button>
        )}
      </>
    );
  } else if (state.phase === 'priority') {
    title = 'Priority';
    const rolled = flow.chooserTurn === state.turn && flow.chooser;
    if (!rolled) {
      body = (
        <>
          <p>Both players roll a D6. The winner chooses who has Priority this turn and acts first in each phase.</p>
          {me && (
            <button className="primary go" {...locked({ type: 'rollPriority' })} onClick={() => dispatch({ type: 'rollPriority' })}>
              Roll for priority
            </button>
          )}
        </>
      );
    } else if (!state.priority) {
      const c = flow.chooser!;
      const tie = flow.roll && flow.roll[0] === flow.roll[1];
      // Balin's Longbeard: his side may have its die rolled again before the choice is made.
      const balin = longbeardFor(state, catalog, 'p1') ?? longbeardFor(state, catalog, 'p2');
      body = (
        <>
          <p>
            {flow.roll && (
              <>
                Rolled <b className="p1">{flow.roll[0]}</b>–<b className="p2">{flow.roll[1]}</b>
                {tie ? ', a tie, so the choice passes over. ' : '. '}
              </>
            )}
            <Who s={c} /> {c === role ? 'choose' : 'chooses'} who has Priority.
          </p>
          {balin && balin.owner === me && (
            <div className="row choice-pair">
              <button className="primary go" {...locked({ type: 'longbeard', model: balin.id })} onClick={() => dispatch({ type: 'longbeard', model: balin.id })} title="Longbeard: Balin spends a Will point and your Priority die is rolled again">
                Balin: re-roll our die (1 Will)
              </button>
              <button className="go" {...locked({ type: 'longbeard', model: balin.id, skip: true })} onClick={() => dispatch({ type: 'longbeard', model: balin.id, skip: true })}>
                Keep the roll
              </button>
            </div>
          )}
          {balin && balin.owner !== me && <p className="hint">Waiting for <Who s={balin.owner} /> to say whether Balin has the roll made again.</p>}
          {me === c && !balin && (
            <div className="row choice-pair">
              <button className="primary go" {...locked({ type: 'choosePriority', seat: c })} onClick={() => dispatch({ type: 'choosePriority', seat: c })}>
                Take priority
              </button>
              <button className="go" {...locked({ type: 'choosePriority', seat: other(c) })} onClick={() => dispatch({ type: 'choosePriority', seat: other(c) })}>
                Give it to {name(other(c))}
              </button>
            </div>
          )}
        </>
      );
    }
    // Armies that went past their Break Point are Broken from the start of this turn.
    const broken = (['p1', 'p2'] as const).filter(s => armyStatus(state, s).broken);
    if (broken.length)
      body = (
        <>
          {body}
          {broken.map(s => (
            <p key={s} className="warn">
              <Who s={s} /> {s === role ? 'are' : 'is'} Broken: as its turn to move starts, every model tests its Courage and those that fail flee. The dice are rolled for you.
            </p>
          ))}
        </>
      );
  } else if ((state.phase === 'move' || state.phase === 'shoot' || state.phase === 'fight') && !heroicsSettled(state)) {
    title = `${PHASE_LABEL[state.phase]} · heroic actions`;
    body = <HeroicStep state={state} dispatch={dispatch} role={role} name={name} />;
  } else if (state.phase === 'move' || state.phase === 'shoot') {
    const act = activeSeat(state);
    const verb = state.phase === 'move' ? 'moving' : 'shooting';
    title = `${PHASE_LABEL[state.phase]} · ${says(state.priority ?? 'p1', 'have priority', 'has priority')}`;
    const broken = act && armyStatus(state, act).broken;
    body = act ? (
      <>
        <HeroicStep state={state} dispatch={dispatch} role={role} name={name} />
        <p>
          {state.phase === 'move' ? (
            <>
              <Who s={act} /> {act === role ? 'move' : 'moves'} each model up to its Move. Enemy control zones (1") can only be entered to charge.
            </>
          ) : (
            <>
              <Who s={act} /> {act === role ? 'shoot' : 'shoots'}. Select a model with a missile weapon, then tap its target. Models that moved shoot 1 worse, and ones that moved more than half their Move can't shoot (throwing weapons can).
            </>
          )}
        </p>
        {broken && (
          <p className="warn">
            <Who s={act} /> {act === role ? 'are' : 'is'} Broken: Courage tests were rolled as this move began, and models that failed have fled. See the log.
          </p>
        )}
        {state.flow.shotPause ? null : me === act ? (
          <button className="primary go" {...locked({ type: 'endActivation', seat: act })} onClick={() => dispatch({ type: 'endActivation', seat: act })}>
            Done {verb}
          </button>
        ) : (
          <p className="muted">Waiting for {name(act)} to finish {verb}.</p>
        )}
      </>
    ) : state.flow.done.length === 2 ? (
      // Both sides are done, and the players move on themselves.
      <>
        <p>Both sides have finished {verb}.</p>
        {me && !placingNow(state) && !arrivalDue(state) && (
          <button className="primary go" {...locked({ type: 'nextPhase' })} onClick={() => dispatch({ type: 'nextPhase' })}>
            Go to the {state.phase === 'move' ? 'Shoot' : 'Fight'} phase
          </button>
        )}
      </>
    ) : null;
  } else if (state.phase === 'fight') {
    title = `Fight · ${says(state.priority ?? 'p1', 'pick the order', 'picks the order')}`;
    // Fights with a Heroic Combat go first.
    const heroicCombat = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Combat').map(h => h.model));
    const isHeroic = (c: Combat) => [...c.p1, ...c.p2].some(id => heroicCombat.has(id));
    combats = [...combats].sort((a, b) => Number(isHeroic(b)) - Number(isHeroic(a)));
    const open = combats.filter(c => !fightDone(state, c));
    const label = (c: Combat) => {
      const n = (ids: string[]) => (ids.length === 0 ? 'the fallen' : ids.length === 1 ? state.models[ids[0]]?.name : `${state.models[ids[0]]?.name} +${ids.length - 1}`);
      return `${n(c.p1)} vs ${n(c.p2)}`;
    };
    body = (
      <>
        <HeroicStep state={state} dispatch={dispatch} role={role} name={name} />
        {combats.length === 0 && <p>{flow.resolved.length ? 'Every fight this turn has been fought, and the losers have backed away.' : 'No models are in base contact, so there are no fights this turn.'}</p>}
        {breachesLeft(state) && <p>Models at an enemy gate that haven't fought can strike at it, and a battering ram against it can swing: pick one to see its options.</p>}
        {combats.length > 0 && (
          <div className="fight-list">
            {combats.map(c => (
              <button key={c.key} className={fightDone(state, c) ? 'done' : ''} onClick={() => openFight(c.key)}>
                {fightDone(state, c) ? '✓ ' : isHeroic(c) ? '⚡ ' : '⚔ '}
                {label(c)}
              </button>
            ))}
          </div>
        )}
        {auto && state.advance !== 'click' && phaseFinished(state) && <p className="muted">Nothing left to fight: moving on to the End phase.</p>}
        {me && (
          <button className={open.length ? 'go' : 'primary go'} {...locked({ type: 'nextPhase' })} onClick={() => dispatch({ type: 'nextPhase' })}>
            {open.length ? `End fights (${open.length} not rolled)` : 'End the Fight phase'}
          </button>
        )}
      </>
    );
  } else {
    title = 'End of turn';
    const names = { p1: name('p1'), p2: name('p2') };
    const check = endCheck(state, names);
    const rollLabel = endRollLabel(state.turn);
    const endRoll = [...state.log].reverse().find(r => r.label === rollLabel);
    const over = check?.over || (endRoll !== undefined && endRoll.dice[0] <= 2);
    const vp = vpTotals(state);
    const manual = scoreLines(state).some(l => !l.auto);
    const lead: Seat | null = vp.p1 === vp.p2 ? null : vp.p1 > vp.p2 ? 'p1' : 'p2';
    body = (
      <>
        {scenarioById(state.scenario) && manual && <p>The game keeps the score. Enter the lines it can't see, like secret picks or carried objects, in the Scenario tab on the left.</p>}
        {check && <p className="warn">{check.reason}</p>}
        {check?.rollNeeded && !endRoll && me && (
          <button className="primary go" {...locked({ type: 'roll', count: 1, label: rollLabel })} onClick={() => dispatch({ type: 'roll', count: 1, label: rollLabel })}>
            Roll for game end
          </button>
        )}
        {endRoll && (
          <p>
            Rolled a <b>{endRoll.dice[0]}</b>: {endRoll.dice[0] <= 2 ? 'the game ends.' : 'play another turn.'}
          </p>
        )}
        {over ? (
          <>
            <p className="result">
              Game over.{' '}
              {scenarioById(state.scenario) ? `${names.p1} ${vp.p1} – ${vp.p2} ${names.p2}: ${lead ? `${names[lead]} wins.` : 'a draw.'}` : ''}
            </p>
          </>
        ) : (
          me &&
          (!check?.rollNeeded || endRoll) && (
            <>
              {auto && state.advance !== 'click' && phaseFinished(state) && <p className="muted">Turn {state.turn + 1} starts in a moment.</p>}
              <button className="primary go" {...locked({ type: 'nextPhase' })} onClick={() => dispatch({ type: 'nextPhase' })}>
                Start turn {state.turn + 1}
              </button>
            </>
          )
        )}
      </>
    );
  }

  return (
    <section ref={drag.ref} style={drag.style} className={`coach ${small ? 'small' : ''}`} aria-label="Turn guide">
      <div className={`coach-head ${drag.draggable ? 'grab' : ''}`} onPointerDown={drag.onPointerDown}>
        {flow.started && (
          <ol className="phase-dots" aria-label="Turn phases">
            <li className="turn">T{state.turn}</li>
            {PHASES.map(p => (
              <li key={p} className={state.phase === p ? 'on' : PHASES.indexOf(p) < PHASES.indexOf(state.phase) ? 'past' : ''}>
                {PHASE_LABEL[p]}
              </li>
            ))}
          </ol>
        )}
        <h3>{view === 'table' ? 'Table' : view === 'log' ? 'Dice log' : title}</h3>
        <nav className="coach-views" aria-label="Turn guide">
          {(
            [
              ['turn', flow.started ? 'Turn' : 'Set up'],
              ['table', 'Table'],
              ['log', 'Log'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => { setView(v); setSmall(false); }}>
              {label}
            </button>
          ))}
        </nav>
        {drag.controls}
        <button className="coach-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show turn guide' : 'Hide turn guide'}>
          {small ? '▴' : '▾'}
        </button>
      </div>
      {!small && view !== 'turn' && <div className="coach-view">{view === 'table' ? table : log}</div>}
      {!small && view === 'turn' && (
        <div className="coach-body">
          {flow.started && <SpellStep state={state} dispatch={dispatch} role={role} name={name} />}
          {flow.started && <CompelStep state={state} dispatch={dispatch} role={role} />}
          {flow.started && <PlacingStep state={state} dispatch={dispatch} role={role} name={name} />}
          {flow.started && role !== 'spectator' && mayCry(state, role) && (
            <div className="spell-step">
              <p>Once a game, before anyone moves, the Nazgûl can give their Cry: every Good model's Courage is 3 worse this turn, and Aragorn comes at once.</p>
              <button {...locked({ type: 'cry', seat: role })} onClick={() => dispatch({ type: 'cry', seat: role })}>Give the Cry of the Nazgûl</button>
            </div>
          )}
          {flow.started && arrivalDue(state) && !arrivalAuto(state) && (
            <div className="spell-step">
              {role === state.narrative?.good ? (
                <>
                  <p>Your move is done. You may roll a D6 for Aragorn: on a 4+ he arrives at the edge of the ruin.</p>
                  <button className="primary" {...locked({ type: 'aragorn', roll: true })} onClick={() => dispatch({ type: 'aragorn', roll: true })}>Roll for Aragorn</button>
                  <button {...locked({ type: 'aragorn', roll: false })} onClick={() => dispatch({ type: 'aragorn', roll: false })}>Not this turn</button>
                </>
              ) : (
                <p>{name(state.narrative!.good)} is deciding whether to roll for Aragorn.</p>
              )}
            </div>
          )}
          {flow.started && <CompanyStep state={state} dispatch={dispatch} role={role} name={name} />}
          {flow.started && <ShotPauseStep state={state} dispatch={dispatch} role={role} name={name} />}
          {flow.started && <FateStep state={state} dispatch={dispatch} role={role} name={name} />}
          {flow.started && <Reinforcements state={state} name={name} />}
          {state.result && <ResultReport state={state} role={role} dispatch={dispatch} />}
          {/* Once the game is over, the result is all the guide shows; a draw offer sits above the turn as usual. */}
          {!(state.result && (state.result.by === 'game' || state.result.agreed)) && body}
        </div>
      )}
    </section>
  );
}

/** Names in order, repeats counted: "Éomer, Gandalf the White, 24 × Rider of Rohan". */
function countNames(names: string[]): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([x, k]) => (k > 1 ? `${k} × ${x}` : x)).join(', ');
}
