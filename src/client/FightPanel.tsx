import { useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { duelLeader, duelSettled, strikeWounds, woundsTaken, type Fighter } from '../shared/fight.ts';
import { combats, enemiesTouching } from '../shared/flow.ts';
import { supporters } from '../shared/support.ts';
import { defence } from '../shared/barriers.ts';
import { declared, phaseAllows } from '../shared/heroics.ts';
import { waitingOnMight } from '../shared/bot.ts';
import { foughtThisTurn } from '../shared/movement.ts';
import { noStrikes, under } from '../shared/powers.ts';
import { BOT_NAME, type Action, type GameState, type Model, type Role, type Seat } from '../shared/types.ts';
import { useCatalog } from './ListBuilder.tsx';
import { RollRow } from './Panels.tsx';

type Dispatch = (a: Action) => void;

/** What the powers on a model do in a fight, for its row (the game applies them as it rolls). */
function fightEffects(state: GameState, m: Model): string[] {
  const out: string[] = [];
  if (under(state, m, 'Paralyse')) out.push('Paralysed: adds nothing');
  else if (noStrikes(state, m)) out.push(`${noStrikes(state, m)}: no strikes${m.prone ? ', trapped if it loses' : ''}`);
  if (under(state, m, 'Bladewrath')) out.push('Bladewrath: strikes at S6');
  if (under(state, m, 'Enchant Blades')) out.push('Enchant Blades: re-rolls To Wound');
  if (under(state, m, 'Enrage Beast')) out.push('Enraged: +2 F, S and A');
  if (m.withered) out.push(`Withered: S -${m.withered}`);
  return out;
}
type Stat = 'f' | 'a' | 's' | 'd';
const STATS: [Stat, string][] = [['f', 'F'], ['a', 'A'], ['s', 'S'], ['d', 'D']];

/**
 * Rolls a fight between the given models (from both sides) in two steps: the duel, when heroes can
 * spend Might on their dice, then the winner's strikes.
 * With `combat`, it resolves that fight on the table and the turn tracker ticks it off.
 */
export function FightPanel({ state, dispatch, role, ids, combat, title = 'Fight' }: { state: GameState; dispatch: Dispatch; role: Role; ids: string[]; combat?: string; title?: string }) {
  const { catalog } = useCatalog();
  const [edits, setEdits] = useState<Record<string, Partial<Record<Stat, number>>>>({});
  const [targets, setTargets] = useState<Record<Seat, string>>({ p1: '', p2: '' });
  const [trapped, setTrapped] = useState(false);
  /** Where each model puts each of its strikes, when it beats more than one enemy. */
  const [aims, setAims] = useState<Record<string, string[]>>({});
  /** Spear and pike models the player chose to keep out of this fight. */
  const [benched, setBenched] = useState<Set<string>>(new Set());

  const chosen = ids.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  const sides: Record<Seat, Model[]> = { p1: chosen.filter(m => m.owner === 'p1'), p2: chosen.filter(m => m.owner === 'p2') };
  const seatName = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  // Models with the same name on a side are numbered, so a strike can be aimed at the right one.
  const tag = (m: Model) => {
    const same = chosen.filter(x => x.owner === m.owner && x.name === m.name);
    return same.length > 1 ? `${m.name} ${same.indexOf(m) + 1}` : m.name;
  };

  const fighter = (m: Model): Fighter => {
    const st = modelStats(catalog, m);
    const strength = st?.S ?? 3;
    const base = {
      f: st?.Fv ?? 3,
      a: st?.A ?? 1,
      s: declared(state, m.id, 'Heroic Strength') ? Math.min(10, strength * 2) : strength,
      d: st?.D ?? 4,
    };
    return {
      id: m.id,
      name: m.name,
      ...base,
      ...edits[m.id],
      ...(declared(state, m.id, 'Heroic Strike') ? { strike: true } : {}),
      ...(declared(state, m.id, 'Heroic Defence') ? { defence: true } : {}),
    };
  };

  // The latest fight rolled between these models, if any.
  const idSet = new Set(ids);
  const lastGroup = [...state.log]
    .reverse()
    .find(r => r.group?.startsWith('f-') && r.side !== undefined && r.model && idSet.has(r.model))?.group;
  const lastRolls = lastGroup ? state.log.filter(r => r.group === lastGroup) : [];
  const struck = lastRolls.some(duelSettled);
  const leader = lastGroup && !struck ? duelLeader(lastRolls) : null;
  // Each model struck, and the wounds it takes.
  const victims = struck ? [...new Set(lastRolls.filter(r => r.against).map(r => r.against!))].map(id => ({ m: state.models[id], wounds: strikeWounds(lastRolls.filter(r => r.against === id)) })).filter(v => v.m) : [];

  // Spears and pikes behind the front rank: offered before the duel, and the ones that rolled in it after.
  const offered = sides.p1.length && sides.p2.length ? supporters(state, catalog, { key: combat ?? '', p1: sides.p1.map(m => m.id), p2: sides.p2.map(m => m.id) }) : { p1: [], p2: [] };
  const helping = (s: Seat): Model[] =>
    (lastGroup && !struck ? lastRolls.filter(r => r.support && r.side === (s === 'p1' ? 0 : 1)).map(r => r.model!) : offered[s].filter(id => !benched.has(id)))
      .map(id => state.models[id])
      .filter((m): m is Model => !!m && !m.dead);

  // A model that backed away into another fight has already fought this turn, so it doesn't roll again.
  const fought = state.flow.started && state.phase === 'fight' ? foughtThisTurn(state) : new Set<string>();
  const ready = sides.p1.length > 0 && sides.p2.length > 0 && role !== 'spectator';
  // Fights are rolled in the Fight phase once the battle is under way.
  const fightNow = role === 'spectator' || phaseAllows(state, role, { type: 'fight' });
  const priorityOnly = state.flow.started && state.phase === 'fight' && !!state.priority && role !== state.priority;
  const side = (s: Seat) => [...sides[s].map(fighter), ...helping(s).map(m => ({ ...fighter(m), a: 1, support: true }))];
  const request = () => {
    const target = (s: Seat) => (sides[s].some(m => m.id === targets[s]) ? targets[s] : sides[s][0].id);
    return { sides: [side('p1'), side('p2')] as [Fighter[], Fighter[]], targets: [target('p2'), target('p1')] as [string, string], trapped, aims, ...(combat ? { combat } : {}) };
  };
  const duel = () => dispatch({ type: 'fight', fight: request() });
  const strikes = () => lastGroup && dispatch({ type: 'strikes', fight: request(), group: lastGroup });
  const applyWounds = (victim: Model, wounds: number) => {
    if (!lastGroup) return;
    // Whoever struck the blows gets the credit, for scenarios that count kills.
    const by = [...new Set(lastRolls.filter(r => r.against === victim.id && r.model).map(r => r.model!))];
    dispatch({ type: 'wound', id: victim.id, count: wounds, by, how: 'fight', group: lastGroup });
  };
  // Models in this fight touching enemies in another one: the player with Priority can say who they fight, before any duel.
  const choosing = state.flow.started && state.phase === 'fight' && role === state.priority && !state.flow.duels?.length && !state.flow.resolved.length;
  const others = choosing ? chosen.map(m => ({ m, foes: enemiesTouching(state, m.id).filter(id => !idSet.has(id)) })).filter(x => x.foes.length) : [];
  const fightOf = (id: string) => combats(state).find(c => c.p1.includes(id) || c.p2.includes(id));
  // A fight over a defended wall, ledge or doorway.
  const held = sides.p1.length === 1 && sides.p2.length === 1 ? defence(state, [[sides.p1[0].id], [sides.p2[0].id]]) : null;
  const sideName = (i: 0 | 1) => {
    const ms = i === 0 ? sides.p1 : sides.p2;
    return ms.length === 1 ? ms[0].name : seatName(i === 0 ? 'p1' : 'p2');
  };

  return (
    <div className="fight">
      <h4>{title}</h4>
      {!ready && (
        <p className="hint">
          {role === 'spectator' ? 'Spectators can watch fights but not roll them.' : 'Select at least one model from each side (Select tool or shift-click) to fight.'}
        </p>
      )}
      {ready &&
        (['p1', 'p2'] as const).map(seat => {
          const foe: Seat = seat === 'p1' ? 'p2' : 'p1';
          return (
            <div key={seat} className={`fight-side ${seat}`}>
              <b>{seatName(seat)}</b>
              {sides[seat].map(m => {
                const f = fighter(m);
                return (
                  <div key={m.id} className="fighter">
                    <span className="fighter-name">
                      {tag(m)}
                      {f.strike && <small className="heroic-tag">Heroic Strike</small>}
                      {f.defence && <small className="heroic-tag">Heroic Defence</small>}
                      {declared(state, m.id, 'Heroic Strength') && <small className="heroic-tag">Heroic Strength</small>}
                      {fought.has(m.id) && <small className="heroic-tag">Fought this turn: sits this one out</small>}
                      {fightEffects(state, m).map(t => (
                        <small key={t} className="heroic-tag spell-tag">
                          {t}
                        </small>
                      ))}
                    </span>
                    {STATS.map(([k, label]) => (
                      <label key={k} className="mini-stat">
                        {label}
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={f[k]}
                          onChange={e => setEdits(x => ({ ...x, [m.id]: { ...x[m.id], [k]: Number(e.target.value) || 1 } }))}
                        />
                      </label>
                    ))}
                  </div>
                );
              })}
              {helping(seat).map(m => (
                <div key={m.id} className="fighter supporter">
                  <span className="fighter-name">
                    {m.name}
                    <small className="heroic-tag">Supporting: 1 die and 1 strike, can't be struck</small>
                  </span>
                  {!lastGroup || struck ? (
                    <button className="link" onClick={() => setBenched(b => new Set(b).add(m.id))}>
                      Leave out
                    </button>
                  ) : null}
                </div>
              ))}
              {sides[foe].length > 1 && leader?.winner !== (seat === 'p1' ? 0 : 1) && (
                <label className="strike-at">
                  Strikes at
                  <select value={targets[seat]} onChange={e => setTargets(t => ({ ...t, [seat]: e.target.value }))}>
                    {sides[foe].map(m => (
                      <option key={m.id} value={m.id}>
                        {tag(m)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {sides[foe].length > 1 && leader?.winner === (seat === 'p1' ? 0 : 1) &&
                [...sides[seat], ...helping(seat)]
                  .filter(m => !noStrikes(state, m))
                  .map(m => {
                    const f = fighter(m);
                    const count = helping(seat).includes(m) ? 1 : f.a;
                    const def = sides[foe].some(x => x.id === targets[seat]) ? targets[seat] : sides[foe][0].id;
                    return (
                      <div key={m.id} className="strike-at">
                        {tag(m)}'s strike{count === 1 ? '' : 's'}:
                        {Array.from({ length: count }, (_, i) => (
                          <select
                            key={i}
                            aria-label={`${m.name}'s strike ${i + 1}`}
                            value={aims[m.id]?.[i] ?? def}
                            onChange={e =>
                              setAims(a => {
                                const list = Array.from({ length: count }, (_, j) => a[m.id]?.[j] ?? def);
                                list[i] = e.target.value;
                                return { ...a, [m.id]: list };
                              })
                            }
                          >
                            {sides[foe].map(t => (
                              <option key={t.id} value={t.id}>
                                {tag(t)}
                              </option>
                            ))}
                          </select>
                        ))}
                      </div>
                    );
                  })}
            </div>
          );
        })}
      {others.length > 0 && (
        <div className="pairing">
          <p className="hint">You have Priority, so you pair off the fights: these models touch enemies in another fight too.</p>
          {others.map(({ m, foes }) => (
            <label key={m.id} className="strike-at">
              {m.name} fights
              <select value="" onChange={e => e.target.value && dispatch({ type: 'pairOff', id: m.id, with: e.target.value })}>
                <option value="">in this fight</option>
                {foes.map(id => (
                  <option key={id} value={id}>
                    {state.models[id]?.name} (move to {fightOf(id) ? 'its fight' : 'a new fight'})
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {held && (
        <p className="hint">
          {state.models[held.defender].name} is defending {held.name} against {state.models[held.attacker].name}: the strikes come before anyone backs away, {state.models[held.attacker].name}'s strikes each need a 4+ to get past {held.name}, and {state.models[held.defender].name} never backs away. If it falls, {state.models[held.attacker].name} takes its place.
        </p>
      )}
      {ready && priorityOnly && (!lastGroup || struck) && <p className="hint">{seatName(state.priority!)} has Priority, so they choose the order the fights are rolled in.</p>}
      {ready && (!lastGroup || struck) && (
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={trapped} onChange={e => setTrapped(e.target.checked)} /> Loser is trapped (double strikes; checked for you when it can't back away)
          </label>
          <button className="primary" onClick={duel} disabled={!fightNow || priorityOnly} title={fightNow ? undefined : 'Fights are rolled in the Fight phase.'}>
            {struck ? 'Roll a new duel' : 'Roll the duel'}
          </button>
        </div>
      )}
      {lastRolls.length > 0 && (
        <div className="rules-result">
          <ol className="log">
            {lastRolls.map(r => (
              <RollRow key={r.id} r={r} state={state} role={role} dispatch={dispatch} />
            ))}
          </ol>
          {lastGroup && !struck && (
            <>
              <p className="duel-lead">
                {leader ? (
                  <>
                    <b>{sideName(leader.winner)}</b> {leader.how === 'dice' ? 'is winning with the highest die' : 'is winning on Fight value'}.
                  </>
                ) : (
                  'Tied on dice and Fight: a roll-off will decide.'
                )}{' '}
                Heroes can spend Might on their own dice first.
              </p>
              {state.bot && state.bot !== role && combat && waitingOnMight(state) === combat && (
                <p className="warn">{BOT_NAME} is waiting for you: spend Might on your hero's dice if you want to, then roll the strikes.</p>
              )}
              {ready && (
                <div className="row wrap">
                  <label className="check">
                    <input type="checkbox" checked={trapped} onChange={e => setTrapped(e.target.checked)} /> Loser is trapped (double strikes; checked for you when it can't back away)
                  </label>
                  <button className="primary" onClick={strikes} disabled={!fightNow} title={fightNow ? undefined : 'Fights are rolled in the Fight phase.'}>
                    Roll strikes
                  </button>
                </div>
              )}
            </>
          )}
          {struck &&
            role !== 'spectator' &&
            victims
              .filter(({ m, wounds }) => wounds > 0 && !m.dead && !woundsTaken(state.flow.applied, lastGroup!, m.id))
              .map(({ m, wounds }) => (
                <button key={m.id} onClick={() => applyWounds(m, wounds)}>
                  Wound {m.name} {wounds} time{wounds === 1 ? '' : 's'}
                  {m.hero && m.fate > 0 ? ' (Fate can be rolled)' : m.wounds - wounds <= 0 ? ' (slain)' : ''}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
