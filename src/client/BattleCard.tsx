import { NarrativeCast } from './NarrativePanel.tsx';
import { useState, type ReactNode, type Ref } from 'react';
import type { Combat } from '../shared/flow.ts';
import { objectivesMissing, scenarioById } from '../shared/scenarios.ts';
import { isMaelstrom } from '../shared/maelstrom.ts';
import { BOT_NAME, type Action, type GameState, type Model, type Role } from '../shared/types.ts';
import { FightView } from './FightPanel.tsx';
import { ArmyPanel } from './Panels.tsx';
import { ScenarioPanel } from './ScenarioPanel.tsx';
import { useDraggable } from './useDraggable.tsx';

export type BattleTab = 'army' | 'scenario' | 'fight';
export type SetupTab = 'map' | 'scenario' | 'army';

/**
 * The card down the left of the table: the board tools, then the armies, the scenario (victory points, special rules, game end) and the
 * fight being rolled. It stays put, and on a computer it can be dragged somewhere else and locked there.
 */
export function BattleCard({ tools, lesson, state, dispatch, role, tab, setTab, fight, fights, openFight, photoFor }: { tools: ReactNode; lesson?: boolean; state: GameState; dispatch: (a: Action) => void; role: Role; tab: BattleTab; setTab: (t: BattleTab) => void; fight?: Combat; fights: Combat[]; openFight: (key: string | null) => void; photoFor: (m: Model) => string | undefined }) {
  const drag = useDraggable('battle-card');
  const [small, setSmall] = useState(false);
  const shown = tab === 'fight' && !fight ? 'army' : tab;
  const tabs: [BattleTab, string][] = [
    ['army', 'Armies'],
    // A lesson is never fought over a scenario.
    ...(lesson ? [] : [['scenario', scenarioById(state.scenario) || state.narrative ? 'Scenario' : 'No scenario'] as [BattleTab, string]]),
    ...(fight ? [['fight', 'Fight'] as [BattleTab, string]] : []),
  ];
  return (
    <section ref={drag.ref as Ref<HTMLElement>} style={drag.style} className={`battle-card ${small ? 'small' : ''}`} aria-label="Battle">
      {tools}
      {state.flow.started && (
        <>
          <div className={`battle-head ${drag.draggable ? 'grab' : ''}`} onPointerDown={drag.onPointerDown}>
            <nav className="battle-tabs" aria-label="Battle card">
              {tabs.map(([t, label]) => (
                <button key={t} className={shown === t ? 'on' : ''} aria-pressed={shown === t} onClick={() => { setTab(t); setSmall(false); }}>
                  {label}
                </button>
              ))}
            </nav>
            {drag.controls}
            <button className="coach-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show the battle card' : 'Fold the battle card'}>
              {small ? '▸' : '▾'}
            </button>
          </div>
          {!small && (
            <div className="battle-body">
              {shown === 'army' && <ArmyPanel state={state} dispatch={dispatch} role={role} />}
              {shown === 'scenario' && <ScenarioPanel state={state} dispatch={dispatch} role={role} />}
              {shown === 'fight' && fight && <FightView state={state} dispatch={dispatch} role={role} fight={fight} fights={fights} open={openFight} photoFor={photoFor} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The foot of the set-up card: what still stands in the way, then the one button that starts the battle. */
function StartBattle({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role }) {
  if (role !== 'p1' && role !== 'p2') return <p className="setup-foot hint">The players set up the battle; it starts when one of them is ready.</p>;
  const count = (s: 'p1' | 'p2') => Object.values(state.models).filter(m => m.owner === s).length;
  const missing = objectivesMissing(state);
  // A narrative scenario sets everything itself; otherwise both armies must be on the table, and a solo battle is fought over a scenario.
  const waiting = state.narrative
    ? ''
    : state.bot && !scenarioById(state.scenario)
      ? 'Pick a scenario first.'
      : missing
        ? `Place ${missing} more objective marker${missing === 1 ? '' : 's'} first.`
        : !count(role)
          ? 'Deploy your army first.'
          : !count(role === 'p1' ? 'p2' : 'p1')
            ? state.bot
              ? `Deploy ${BOT_NAME}'s army first.`
              : 'Waiting for your opponent to deploy their army.'
            : '';
  return (
    <div className="setup-foot">
      {waiting ? <p className="hint">{waiting}</p> : <p className="hint">{isMaelstrom(state) ? 'Your warbands wait off the table and roll to arrive as your side starts to move.' : 'Drag your models where you want them in your zone, then start.'}</p>}
      <button className="primary go" disabled={!!waiting} onClick={() => dispatch({ type: 'startGame' })}>
        Start the battle
      </button>
    </div>
  );
}

/**
 * Before the battle: one card for choosing the table, the scenario and the armies, in that order. It goes away once
 * the battle starts, and the battle card takes over.
 */
export function SetupCard({ state, dispatch, role, tab, setTab, table }: { state: GameState; dispatch: (a: Action) => void; role: Role; tab: SetupTab; setTab: (t: SetupTab) => void; table: ReactNode }) {
  const drag = useDraggable('setup-card');
  const [small, setSmall] = useState(false);
  const count = (s: 'p1' | 'p2') => Object.values(state.models).filter(m => m.owner === s).length;
  const done: Record<SetupTab, boolean> = { map: Object.keys(state.terrain).length > 0, scenario: !!scenarioById(state.scenario), army: count('p1') > 0 && count('p2') > 0 };
  const steps: [SetupTab, string][] = [
    ['map', '1 · Table'],
    ['scenario', '2 · Scenario'],
    ['army', '3 · Armies'],
  ];
  return (
    <section ref={drag.ref as Ref<HTMLElement>} style={drag.style} className={`setup-card ${small ? 'small' : ''}`} aria-label="Set up the battle">
      <div className={`battle-head ${drag.draggable ? 'grab' : ''}`} onPointerDown={drag.onPointerDown}>
        <h3>Set up the battle</h3>
        {drag.controls}
        <button className="coach-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show the set-up card' : 'Fold the set-up card'}>
          {small ? '▸' : '▾'}
        </button>
      </div>
      {!small && state.narrative && (
        // A narrative scenario sets the table and both casts: there is nothing to choose but the side.
        <div className="battle-body narrative-setup">
          <ScenarioPanel state={state} dispatch={dispatch} role={role} />
          <NarrativeCast state={state} />
        </div>
      )}
      {!small && !state.narrative && (
        <>
          <nav className="battle-tabs setup-steps-nav" aria-label="Set-up steps">
            {steps.map(([t, label]) => (
              <button key={t} className={`${tab === t ? 'on' : ''} ${done[t] ? 'done' : ''}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {label}
                {done[t] && ' ✓'}
              </button>
            ))}
          </nav>
          <div className="battle-body">
            {tab === 'map' && table}
            {tab === 'scenario' && <ScenarioPanel state={state} dispatch={dispatch} role={role} />}
            {tab === 'army' && <ArmyPanel state={state} dispatch={dispatch} role={role} />}
          </div>
        </>
      )}
      {!small && <StartBattle state={state} dispatch={dispatch} role={role} />}
    </section>
  );
}
