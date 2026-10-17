import { useState } from 'react';
import { ResultReport } from './ResultReport.tsx';
import { activeSeat, other, type Combat } from '../shared/flow.ts';
import { canDeclare, heroicInfo, heroicsSettled, heroicTurn, HEROICS, orderRollLabel, orderRollNeeded, phaseHeroics } from '../shared/heroics.ts';
import { RollRow } from './Panels.tsx';
import { useDraggable } from './useDraggable.tsx';
import { isMaelstrom, waitingWarbands, warbandName } from '../shared/maelstrom.ts';
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
  openTab: (t: 'army' | 'table') => void;
  openFight: (key: string) => void;
}

type Dispatch = (a: Action) => void;

/** Declaring heroic actions at the start of the Move, Shoot and Fight phases, taking turns from the player without Priority. */
function HeroicStep({ state, dispatch, role, name }: { state: GameState; dispatch: Dispatch; role: Role; name: (s: Seat) => string }) {
  const me = role === 'spectator' ? null : role;
  const heroes = me ? canDeclare(state, me) : [];
  const actions = HEROICS.filter(h => h.phase === state.phase);
  const [hero, setHero] = useState('');
  const [action, setAction] = useState('');
  const turn = heroicTurn(state);
  const settled = heroicsSettled(state);
  const declaredNow = phaseHeroics(state);
  const pickedHero = heroes.find(m => m.id === hero) ?? heroes[0];
  const pickedAction = actions.find(a => a.name === action) ?? actions[0];
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
              </li>
            );
          })}
        </ul>
      )}
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
                <select value={pickedAction.name} onChange={e => setAction(e.target.value)} aria-label="Heroic action">
                  {actions.map(a => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                      {a.universal ? '' : ' (if on its profile)'}
                    </option>
                  ))}
                </select>
              </div>
              <p className="muted small">{pickedAction.tip}</p>
              <div className="row wrap">
                <button className="primary" onClick={() => dispatch({ type: 'declareHeroic', model: pickedHero.id, action: pickedAction.name })}>
                  Declare
                </button>
                <button onClick={() => dispatch({ type: 'passHeroic', seat: me })}>{declaredNow.some(h => state.models[h.model]?.owner === me) ? 'No more' : 'Pass'}</button>
              </div>
            </>
          )}
        </>
      )}
      {settled && orderRollNeeded(state) && (
        <p>
          Both sides declared heroic actions that go first.{' '}
          {orderRoll ? (
            <>
              Rolled a <b>{orderRoll.dice[0]}</b>: the <b>{orderRoll.dice[0] <= 3 ? 'Evil' : 'Good'}</b> player picks a hero to go first, then the players alternate.
            </>
          ) : state.priority === role ? (
            <button className="primary" onClick={() => dispatch({ type: 'roll', count: 1, label: orderLabel })}>
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
                  <button className="primary" onClick={() => dispatch({ type: 'rollFate', id: m.id })}>
                    Roll Fate
                  </button>
                )}
                <button onClick={() => dispatch({ type: 'takeWound', id: m.id })}>Take {n === 1 ? 'the wound' : 'one wound'}</button>
                {n > 1 && <button onClick={() => dispatch({ type: 'takeWound', id: m.id, all: true })}>Take all {n}</button>}
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
          <b className={s}>{name(s)}</b> off the table: {bands.map(b => `${warbandName(b)} (${b.length})`).join(', ')}. They roll to arrive as {name(s)} starts to move.
        </p>
      ))}
    </div>
  );
}

export function CoachBar({ state, dispatch, role, combats: allCombats, openTab, openFight }: Props) {
  let combats = allCombats;
  const [small, setSmall] = useState(false);
  const drag = useDraggable('coach');
  const name = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const Who = ({ s, mid }: { s: Seat; mid?: boolean }) => <b className={s}>{s === role ? (mid ? 'you' : 'You') : name(s)}</b>;
  /** "You have priority" for yourself (and the practice table's "You" seat), "Sam has priority" for others. */
  const says = (s: Seat, you: string, them: string) => (s === role || name(s) === 'You' ? `You ${you}` : `${name(s)} ${them}`);
  const me = role === 'spectator' ? null : role;
  const { flow } = state;

  let title: React.ReactNode;
  let body: React.ReactNode;

  if (!flow.started) {
    const count = (s: Seat) => Object.values(state.models).filter(m => m.owner === s).length;
    const scenario = scenarioById(state.scenario);
    // Both armies must be on the table first; a solo battle is always fought over a scenario.
    const waiting = state.bot && !scenario ? 'Pick a scenario first.' : !count('p1') || !count('p2') ? 'Deploy both armies first.' : '';
    title = 'Set up the battle';
    body = (
      <>
        <ol className="setup-steps">
          <li className={scenario ? 'ok' : ''}>
            <span>{scenario ? scenario.name : state.bot ? 'Pick a scenario' : 'Pick a scenario, or play without one'}</span>
            <button onClick={() => openTab('table')}>Scenario</button>
          </li>
          <li className={Object.keys(state.terrain).length ? 'ok' : ''}>
            <span>{Object.keys(state.terrain).length ? `${Object.keys(state.terrain).length} pieces of terrain` : 'Lay out the terrain'}</span>
            <button onClick={() => openTab('table')}>Board</button>
          </li>
          <li className={count('p1') && count('p2') ? 'ok' : ''}>
            <span>
              Armies: <b className="p1">{name('p1')}</b> {count('p1')} · <b className="p2">{name('p2')}</b> {count('p2')}
            </span>
            <button onClick={() => openTab('army')}>Army</button>
          </li>
          <li>
            <span>
              {isMaelstrom(state)
                ? 'Maelstrom of Battle: deploy your list and it waits off the table. Each warband rolls to arrive as its side starts to move.'
                : `Deploy each army in its zone${scenario ? ' (shown on the board)' : ''}.`}
            </span>
          </li>
        </ol>
        {me && waiting && <p className="hint">{waiting}</p>}
        {me && (
          <button className="primary go" disabled={!!waiting} onClick={() => dispatch({ type: 'startGame' })}>
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
            <button className="primary go" onClick={() => dispatch({ type: 'rollPriority' })}>
              Roll for priority
            </button>
          )}
        </>
      );
    } else if (!state.priority) {
      const c = flow.chooser!;
      const tie = flow.roll && flow.roll[0] === flow.roll[1];
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
          {me === c && (
            <div className="row">
              <button className="primary go" onClick={() => dispatch({ type: 'choosePriority', seat: c })}>
                Take priority
              </button>
              <button onClick={() => dispatch({ type: 'choosePriority', seat: other(c) })}>Give it to {name(other(c))}</button>
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
              <Who s={act} /> {act === role ? 'shoot' : 'shoots'}. Select a model with a missile weapon, then tap its target. Models that moved more than half their Move can't shoot.
            </>
          )}
        </p>
        {broken && (
          <p className="warn">
            <Who s={act} /> {act === role ? 'are' : 'is'} Broken: Courage tests were rolled as this move began, and models that failed have fled. See the log.
          </p>
        )}
        {me === act ? (
          <button className="primary go" onClick={() => dispatch({ type: 'endActivation', seat: act })}>
            Done {verb}
          </button>
        ) : (
          <p className="muted">Waiting for {name(act)} to finish {verb}.</p>
        )}
      </>
    ) : null;
  } else if (state.phase === 'fight') {
    title = `Fight · ${says(state.priority ?? 'p1', 'pick the order', 'picks the order')}`;
    // Fights with a Heroic Combat go first.
    const heroicCombat = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Combat').map(h => h.model));
    const isHeroic = (c: Combat) => [...c.p1, ...c.p2].some(id => heroicCombat.has(id));
    combats = [...combats].sort((a, b) => Number(isHeroic(b)) - Number(isHeroic(a)));
    const open = combats.filter(c => !flow.resolved.includes(c.key));
    const label = (c: Combat) => {
      const n = (ids: string[]) => (ids.length === 1 ? state.models[ids[0]]?.name : `${state.models[ids[0]]?.name} +${ids.length - 1}`);
      return `${n(c.p1)} vs ${n(c.p2)}`;
    };
    body = (
      <>
        <HeroicStep state={state} dispatch={dispatch} role={role} name={name} />
        {combats.length === 0 && <p>{flow.resolved.length ? 'Every fight this turn has been fought, and the losers have backed away.' : 'No models are in base contact, so there are no fights this turn.'}</p>}
        {combats.length > 0 && (
          <div className="fight-list">
            {combats.map(c => (
              <button key={c.key} className={flow.resolved.includes(c.key) ? 'done' : ''} onClick={() => openFight(c.key)}>
                {flow.resolved.includes(c.key) ? '✓ ' : isHeroic(c) ? '⚡ ' : '⚔ '}
                {label(c)}
              </button>
            ))}
          </div>
        )}
        {me && (
          <button className={open.length ? 'go' : 'primary go'} onClick={() => dispatch({ type: 'nextPhase' })}>
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
        {scenarioById(state.scenario) && manual && <p>The game keeps the score. Enter the lines it can't see, like secret picks or carried objects, in the Table tab.</p>}
        {check && <p className="warn">{check.reason}</p>}
        {check?.rollNeeded && !endRoll && me && (
          <button className="primary go" onClick={() => dispatch({ type: 'roll', count: 1, label: rollLabel })}>
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
            <button className="primary go" onClick={() => dispatch({ type: 'nextPhase' })}>
              Start turn {state.turn + 1}
            </button>
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
        <h3>{title}</h3>
        {drag.controls}
        <button className="coach-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show turn guide' : 'Hide turn guide'}>
          {small ? '▴' : '▾'}
        </button>
      </div>
      {!small && (
        <div className="coach-body">
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
