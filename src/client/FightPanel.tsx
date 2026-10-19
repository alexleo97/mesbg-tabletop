import { useMemo, useState } from 'react';
import { modelStats } from '../shared/catalog.ts';
import { duelLeader, duelSettled, strikeWounds, woundsTaken, type Fighter } from '../shared/fight.ts';
import { combats, enemiesTouching, type Combat } from '../shared/flow.ts';
import { oneSpearEach, supporters } from '../shared/support.ts';
import { defence } from '../shared/barriers.ts';
import { declared, phaseAllows } from '../shared/heroics.ts';
import { waitingOnMight } from '../shared/bot.ts';
import { fightDone, foughtThisTurn } from '../shared/movement.ts';
import { noStrikes, under } from '../shared/powers.ts';
import { cantShield, fighterOf, twoHandedChoice } from '../shared/wargear.ts';
import { mountLabel, mountOf } from '../shared/cavalry.ts';
import { brutalOptions, chargeEffects } from '../shared/monsters.ts';
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
/** Time between the lines of a roll that came in all at once (the duel, then each model's strikes). */
const REVEAL_STEP = 900;
type Stat = 'f' | 'a' | 's' | 'd';
const STATS: [Stat, string][] = [['f', 'F'], ['a', 'A'], ['s', 'S'], ['d', 'D']];

/**
 * Rolls a fight between the given models (from both sides) in two steps: the duel, when heroes can
 * spend Might on their dice, then the winner's strikes.
 * With `combat`, it resolves that fight on the table and the turn tracker ticks it off.
 */
export function FightPanel({ state, dispatch, role, ids, combat, title = 'Fight', photoFor }: { state: GameState; dispatch: Dispatch; role: Role; ids: string[]; combat?: string; title?: string; photoFor?: (m: Model) => string | undefined }) {
  const { catalog } = useCatalog();
  const [edits, setEdits] = useState<Record<string, Partial<Record<Stat, number>>>>({});
  /** Where each model puts each of its strikes, when it beats more than one enemy. */
  const [aims, setAims] = useState<Record<string, string[]>>({});
  /** Spear and pike models the player chose to keep out of this fight. */
  const [benched, setBenched] = useState<Set<string>>(new Set());
  /** A winning monster's Brutal Power Attack: '' to strike as normal, or 'rend:<id>', 'barge', 'hurl:<id>'. */
  const [brutal, setBrutal] = useState('');

  const choices = state.flow.choices ?? {};
  const chosen = ids.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  const sides: Record<Seat, Model[]> = { p1: chosen.filter(m => m.owner === 'p1'), p2: chosen.filter(m => m.owner === 'p2') };
  const seatName = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  // Models with the same name on a side are numbered, so a strike can be aimed at the right one.
  const tag = (m: Model) => {
    const same = chosen.filter(x => x.owner === m.owner && x.name === m.name);
    return same.length > 1 ? `${m.name} ${same.indexOf(m) + 1}` : m.name;
  };

  const fighter = (m: Model): Fighter => {
    // A model with a profile fights as its wargear and rules say (the server works it out the same way).
    if (modelStats(catalog, m)) return fighterOf(state, catalog, m, { shielding: shieldingSide(m.owner), twoHanded: !!choices[m.id]?.twoHanded });
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

  // What a winner can strike: each enemy, and a rider's mount as well as the rider (only the chariot, for a chariot's crew).
  const strikable = (s: Seat) =>
    sides[s].flatMap(m => {
      const p = mountOf(m);
      if (p?.chariot && p.left > 0) return [{ id: `${m.id}#mount`, label: `${tag(m)}'s chariot` }];
      return [{ id: m.id, label: tag(m) }, ...(p && p.left > 0 ? [{ id: `${m.id}#mount`, label: `${tag(m)}'s ${mountLabel(p.name).toLowerCase()}` }] : [])];
    });

  // The latest fight rolled between these models, if any.
  const idSet = new Set(ids);
  // (In a battle, only a fight from this turn counts: the same models may fight again next turn.)
  const lastGroup = [...state.log]
    .reverse()
    .find(r => r.group?.startsWith('f-') && r.side !== undefined && r.model && idSet.has(r.model) && (!state.flow.started || !!state.flow.duels?.includes(r.group)))?.group;
  const lastRolls = lastGroup ? state.log.filter(r => r.group === lastGroup) : [];
  const struck = lastRolls.some(duelSettled);
  const leader = lastGroup && !struck ? duelLeader(lastRolls) : null;
  // Each model struck, and the wounds it takes.
  const victims = struck
    ? [...new Set(lastRolls.filter(r => r.against).map(r => r.against!))].map(id => ({ id, m: state.models[id.replace(/#mount$/, '')], mount: id.endsWith('#mount'), wounds: strikeWounds(lastRolls.filter(r => r.against === id)) })).filter(v => v.m)
    : [];

  // Spears and pikes behind the front rank (one spear per fighter): offered before the duel, and the ones that rolled in it after.
  const offered = sides.p1.length && sides.p2.length ? supporters(state, catalog, { key: combat ?? '', p1: sides.p1.map(m => m.id), p2: sides.p2.map(m => m.id) }) : { p1: [], p2: [] };
  const helping = (s: Seat): Model[] =>
    (lastGroup && !struck ? lastRolls.filter(r => r.support && r.side === (s === 'p1' ? 0 : 1)).map(r => r.model!) : oneSpearEach(state, catalog, sides[s].map(m => m.id), offered[s].filter(id => !benched.has(id))))
      .map(id => state.models[id])
      .filter((m): m is Model => !!m && !m.dead);

  // A model that backed away into another fight has already fought this turn, so it doesn't roll again.
  const fought = state.flow.started && state.phase === 'fight' ? foughtThisTurn(state) : new Set<string>();
  const ready = sides.p1.length > 0 && sides.p2.length > 0 && role !== 'spectator';
  // Fights are rolled in the Fight phase once the battle is under way.
  const fightNow = role === 'spectator' || phaseAllows(state, role, { type: 'fight' });
  // Shielding and two-handed weapons are chosen before the duel is rolled, by the side's own player.
  const choosingFor = (s: Seat) => (!lastGroup || struck) && role === s;
  const priorityOnly = state.flow.started && state.phase === 'fight' && !!state.priority && role !== state.priority;
  // A roll that just came in shows one line after another, so each can be followed.
  const reveal = (i: number) => {
    const r = lastRolls[i];
    const batch = lastRolls.filter(x => x.at === r.at);
    // (Not at Instant speed against the computer, which is meant to be over at once.)
    return batch.length > 1 && !(state.bot && state.botSpeed === 'instant') ? batch.indexOf(r) * REVEAL_STEP : 0;
  };
  // Who is winning, and what to do next, show once the last line is in.
  const lastId = lastRolls.at(-1)?.id;
  const settle = useMemo(() => (lastRolls.length && Date.now() - lastRolls[lastRolls.length - 1].at < 2500 ? reveal(lastRolls.length - 1) + 400 : 0), [lastId]);
  // Shielding needs every model on the side able to do it, and then none of them can be Supported.
  function canShieldSide(s: Seat) {
    return sides[s].length > 0 && sides[s].every(m => !cantShield(catalog, m));
  }
  function shieldingSide(s: Seat) {
    return canShieldSide(s) && sides[s].some(m => choices[m.id]?.shielding);
  }
  // Choices go to the game, so whichever player rolls the fight rolls it as both sides chose.
  const choose = (m: Model, pick: { shielding?: boolean; twoHanded?: boolean }) => dispatch({ type: 'fightChoice', id: m.id, ...choices[m.id], ...pick });
  const side = (s: Seat) => [...sides[s].map(fighter), ...(shieldingSide(s) ? [] : helping(s).map(m => ({ ...fighter(m), a: 1, support: true, shielding: undefined, noStrike: undefined })))];
  const request = () => {
    // The loser's model struck first; with more than one, the winner aims each strike after the duel.
    const target = (s: Seat) => sides[s][0].id;
    const [kind, victim] = brutal.split(':');
    const brute = brutalBy();
    return {
      sides: [side('p1'), side('p2')] as [Fighter[], Fighter[]],
      targets: [target('p2'), target('p1')] as [string, string],
      // The game works out who is trapped.
      trapped: false,
      aims,
      ...(combat ? { combat } : {}),
      ...(brute && kind ? { brutal: { by: brute.id, kind: kind as 'rend' | 'barge' | 'hurl', ...(victim ? { target: victim } : {}) } } : {}),
    };
  };
  const duel = () => dispatch({ type: 'fight', fight: request() });
  const strikes = () => lastGroup && dispatch({ type: 'strikes', fight: request(), group: lastGroup });
  const applyWounds = (victim: Model, wounds: number, mount = false) => {
    if (!lastGroup) return;
    // Whoever struck the blows gets the credit, for scenarios that count kills.
    const at = mount ? `${victim.id}#mount` : victim.id;
    const by = [...new Set(lastRolls.filter(r => r.against === at && r.model).map(r => r.model!))];
    dispatch({ type: 'wound', id: victim.id, count: wounds, by, how: 'fight', group: lastGroup, ...(mount ? { mount: true } : {}) });
  };
  /** The monster on the winning side that may make a Brutal Power Attack, when it's this player's to choose. */
  function brutalBy(): Model | undefined {
    if (!leader || role === 'spectator') return undefined;
    const seat: Seat = leader.winner === 0 ? 'p1' : 'p2';
    return seat === role ? sides[seat].find(m => brutalOptions(state, catalog, m).length && !noStrikes(state, m)) : undefined;
  }
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
      {!ready && !lastRolls.length && (
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
                    <Portrait m={m} photo={photoFor?.(m)} />
                    <span className="fighter-name">
                      {tag(m)}
                      {f.strike && <small className="heroic-tag">Heroic Strike</small>}
                      {f.defence && <small className="heroic-tag">Heroic Defence</small>}
                      {declared(state, m.id, 'Heroic Strength') && <small className="heroic-tag">Heroic Strength</small>}
                      {fought.has(m.id) && <small className="heroic-tag">Fought this turn: sits this one out</small>}
                      {[...(f.notes ?? []), ...chargeEffects(state, catalog, m, sides[foe], held?.attacker === m.id).notes].map(t => (
                        <small key={t} className="heroic-tag gear-tag">
                          {t}
                        </small>
                      ))}
                      {fightEffects(state, m).map(t => (
                        <small key={t} className="heroic-tag spell-tag">
                          {t}
                        </small>
                      ))}
                    </span>
                    <span className="mini-stat wounds" title="Wounds left">
                      W <b>{m.wounds}</b>
                    </span>
                    {STATS.map(([k, label]) =>
                      // Profile numbers come from the game; a model added by hand can have its numbers typed in.
                      modelStats(catalog, m) ? (
                        <span key={k} className="mini-stat">
                          {label} <b>{f[k]}</b>
                        </span>
                      ) : (
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
                      ),
                    )}
                    {choosingFor(m.owner) && twoHandedChoice(catalog, m) === 'may' && !shieldingSide(seat) && (
                      <button className={`toggle small ${choices[m.id]?.twoHanded ? 'on' : ''}`} aria-pressed={!!choices[m.id]?.twoHanded} title="Strike with both hands: -1 to the duel roll, +1 To Wound" onClick={() => choose(m, { twoHanded: !choices[m.id]?.twoHanded })}>
                        Two-handed
                      </button>
                    )}
                  </div>
                );
              })}
              {choosingFor(seat) && canShieldSide(seat) && (
                <button className={`toggle small ${shieldingSide(seat) ? 'on' : ''}`} aria-pressed={shieldingSide(seat)} title="Double Attacks in the duel, but no strikes and no support" onClick={() => { const on = !shieldingSide(seat); sides[seat].forEach(m => choose(m, { shielding: on })); }}>
                  🛡 Shielding
                </button>
              )}
              {!shieldingSide(seat) && helping(seat).map(m => (
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
              {brutalBy()?.owner === seat && (() => {
                const brute = brutalBy()!;
                const kinds = brutalOptions(state, catalog, brute);
                const s = fighter(brute).s;
                return (
                  <label className="strike-at">
                    {tag(brute)} wins:
                    <select value={brutal} onChange={e => setBrutal(e.target.value)} aria-label="Brutal Power Attack">
                      <option value="">Strike as normal</option>
                      {kinds.includes('rend') && strikable(foe).map(t => <option key={`rend:${t.id}`} value={`rend:${t.id}`}>Rend {t.label}: To Wound against its Strength</option>)}
                      {kinds.includes('barge') && <option value="barge">Barge: every foe back 3", then move again</option>}
                      {kinds.includes('hurl') && sides[foe].filter(t => fighter(t).s < s).map(t => <option key={`hurl:${t.id}`} value={`hurl:${t.id}`}>Hurl {tag(t)} at another enemy</option>)}
                    </select>
                  </label>
                );
              })()}
              {strikable(foe).length > 1 && leader?.winner === (seat === 'p1' ? 0 : 1) && !(brutal && brutalBy()?.owner === seat) &&
                [...sides[seat], ...helping(seat)]
                  .filter(m => !noStrikes(state, m))
                  .map(m => {
                    const f = fighter(m);
                    const count = helping(seat).includes(m) ? 1 : f.a;
                    const def = sides[foe][0].id;
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
                            {strikable(foe).map(t => (
                              <option key={t.id} value={t.id}>
                                {t.label}
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
      {ready && !lastGroup && (
        <div className="row wrap">
          <button className="primary" onClick={duel} disabled={!fightNow || priorityOnly} title={fightNow ? undefined : 'Fights are rolled in the Fight phase.'}>
            Roll the duel
          </button>
        </div>
      )}
      {lastRolls.length > 0 && (
        <div className="rules-result">
          <ol className="log">
            {lastRolls.map((r, i) => (
              <RollRow key={r.id} r={r} state={state} role={role} dispatch={dispatch} delay={reveal(i)} />
            ))}
          </ol>
          {lastGroup && !struck && (
            <div className={settle ? 'reveal' : ''} style={settle ? { animationDelay: `${settle}ms` } : undefined}>
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
                  <button className="primary" onClick={strikes} disabled={!fightNow} title={fightNow ? undefined : 'Fights are rolled in the Fight phase.'}>
                    Roll strikes
                  </button>
                </div>
              )}
            </div>
          )}
          {struck &&
            role !== 'spectator' &&
            victims
              .filter(({ id, m, wounds }) => wounds > 0 && !m.dead && !woundsTaken(state.flow.applied, lastGroup!, id))
              .map(({ id, m, mount, wounds }) => (
                <button key={id} onClick={() => applyWounds(m, wounds, mount)}>
                  Wound {mount ? `${m.name}'s mount` : m.name} {wounds} time{wounds === 1 ? '' : 's'}
                  {mount ? '' : m.hero && m.fate > 0 ? ' (Fate can be rolled)' : m.wounds - wounds <= 0 ? ' (slain)' : ''}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

/** A fighter's picture, or its initial when there is none. */
function Portrait({ m, photo }: { m: Model; photo?: string }) {
  const [failed, setFailed] = useState(false);
  return photo && !failed ? <img className="portrait" src={photo} alt="" onError={() => setFailed(true)} /> : <span className="portrait avatar">{m.name.slice(0, 1)}</span>;
}

/**
 * The fight being rolled, shown in the battle card beside the board. Every fight this turn is listed at the top, so the
 * next one can be picked from here; once this one is done, a button moves on to the next.
 */
export function FightView({ state, dispatch, role, fight, fights, open, photoFor }: { state: GameState; dispatch: Dispatch; role: Role; fight: Combat; fights: Combat[]; open: (key: string | null) => void; photoFor?: (m: Model) => string | undefined }) {
  const battle = state.flow.started && state.phase === 'fight';
  // Named by the first model on each side, even once it has fallen.
  const name = (c: Combat) => c.key.split(',|,').map((ids, i) => state.models[(i ? c.p2 : c.p1)[0] ?? ids.split(',')[0]]?.name ?? 'the fallen').join(' vs ');
  const next = battle && fightDone(state, fight) ? fights.find(c => c.key !== fight.key && !fightDone(state, c)) : undefined;
  return (
    <div className="fight-view">
      {battle && fights.length > 1 && (
        <div className="fight-list" aria-label="Fights this turn">
          {fights.map((c, i) => (
            <button key={c.key} className={`small ${c.key === fight.key ? 'on' : ''} ${fightDone(state, c) ? 'done' : ''}`} title={name(c)} onClick={() => open(c.key)}>
              {fightDone(state, c) ? '✓' : '⚔'} {i + 1}
            </button>
          ))}
        </div>
      )}
      <FightPanel state={state} dispatch={dispatch} role={role} ids={[...fight.p1, ...fight.p2]} combat={fight.key} title={name(fight)} photoFor={photoFor} />
      {next && (
        <button className="primary next-fight" onClick={() => open(next.key)}>
          Next fight: {name(next)} →
        </button>
      )}
    </div>
  );
}
