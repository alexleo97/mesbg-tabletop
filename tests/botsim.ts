import { cutWebs, webDue } from '../src/shared/unseen.ts';
import { elvesArrive, elvesDue, hazeDue, hazeRolls, nestDue, nestReturn } from '../src/shared/elves.ts';
import { alarmDue, alarmRaised } from '../src/shared/lake.ts';
import { eaglesArrive, eaglesDue, wrathDue, wrathMove } from '../src/shared/eagles.ts';
import catalogJson from '../src/data/mesbg-data.json';
import { botStep, newMemo, type BotMemo } from '../src/shared/bot.ts';
import { botRoster } from '../src/shared/botList.ts';
import type { Catalog } from '../src/shared/catalog.ts';
import { combats } from '../src/shared/flow.ts';
import { fightDone } from '../src/shared/movement.ts';
import { deployList } from '../src/shared/importList.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { DICE_REQUESTS, resolveRequest } from '../src/shared/resolve.ts';
import { arrivalsDue, rollArrivals } from '../src/shared/maelstrom.ts';
import { scenarioById, scenarioMarkers } from '../src/shared/scenarios.ts';
import { endCheck, endRollLabel, gameWinner } from '../src/shared/status.ts';
import { listEntries } from '../src/shared/warbands.ts';
import type { Action, GameState, Seat } from '../src/shared/types.ts';
import { openDuel } from '../src/shared/bot.ts';
import { arrivalAuto, rollArrival } from '../src/shared/narrative.ts';
import { chargeSabotage, reliefArrives, reliefDue } from '../src/shared/helms.ts';
import { shrugOff, towersAfter } from '../src/shared/towers.ts';
import { markModel } from '../src/shared/marking.ts';
import { legionsArrive, legionsDue, wakeDue, wakeUp } from '../src/shared/amon.ts';
import { gandalfArrives, gandalfDue, hordeArrives, hordeDue, relentlessDue, relentlessHits } from '../src/shared/goblin.ts';
import { hordeArrives as osgHordeArrives, hordeDue as osgHordeDue, masterDue, masterRoll } from '../src/shared/osgiliath.ts';
import { gollumHides, hideGollum, hordeArrives as doomHordeArrives, hordeDue as doomHordeDue, setDown, setDownDue } from '../src/shared/doom.ts';
import { pelennorArrives, pelennorDue } from '../src/shared/pelennor.ts';
import { unseat, unseatedDue } from '../src/shared/passengers.ts';
import { imposingDue, imposingRoll } from '../src/shared/pelennorRules.ts';
import { goblinTide, tideDue, trample, trampleDue, trollDue, trollEnters } from '../src/shared/balin.ts';
import { dawnDue, reinforceDue, rollDawn, rollReinforcements } from '../src/shared/mutton.ts';
import { bondsDue, rollBonds } from '../src/shared/ambush.ts';
import { chronicled, listenDue, listenFor } from '../src/shared/company.ts';
import { isMonster } from '../src/shared/monsters.ts';
import { recoveryDue, recoveryRolls } from '../src/shared/powers.ts';
import { sauronDue, sauronRoll } from '../src/shared/ring.ts';
import { burnDue, burns } from '../src/shared/fire.ts';
import { willOfEvilDue, willOfEvilToll } from '../src/shared/courage.ts';
import { mightyBonus, mightyDue } from '../src/shared/mighty.ts';
import { longshanksDue, longshanksMove } from '../src/shared/sam.ts';

export const catalog = catalogJson as unknown as Catalog;

/** A seeded random number generator, so a failing game can be played again. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function setup(armies: [string, string], points: number, scenario: string | null, rand: () => number): GameState {
  let state = initialState();
  let n = 0;
  if (scenario) {
    state = reduce(state, { type: 'setScenario', id: scenario });
    const s = scenarioById(scenario)!;
    for (const t of scenarioMarkers(s, 48, 48, p => `${p}${n++}`, rand)) state = reduce(state, { type: 'addTerrain', terrain: t });
  }
  (['p1', 'p2'] as const).forEach((seat, i) => {
    const r = botRoster(catalog, armies[i], points, rand);
    const entries = listEntries(r, catalog).flatMap(g => g.entries);
    const models = deployList(entries, seat, state, scenario ? scenarioById(scenario) : undefined).map(m => ({ ...m, id: `${seat}-${n++}` }));
    state = reduce(state, { type: 'addModels', models });
  });
  return reduce(state, { type: 'startGame', at: 1 });
}

/** Plays a whole game between two computer players. Returns the final state and how many steps it took. */
export function play(state: GameState, rand: () => number, maxSteps = 20000, watch?: (s: GameState, steps: number) => boolean | void, onAction?: (s: GameState, seat: Seat, a: Action, ok: boolean) => void) {
  const memos: Record<Seat, BotMemo> = { p1: newMemo(), p2: newMemo() };
  const d6 = () => 1 + Math.floor(rand() * 6);
  let id = 0;
  const uid = () => `u${id++}`;
  let now = 1000;
  let steps = 0;
  let idle = 0;
  const apply = (seat: Seat, a: Action) => {
    if (DICE_REQUESTS.has(a.type)) {
      const out = resolveRequest(state, seat, a, d6, uid, now, catalog);
      if (!out) return false;
      const before = state;
      for (const x of [...out.apply, ...(out.record ? [out.record] : [])]) take(x);
      chronicle(before);
      return true;
    }
    const before = state;
    take(a);
    chronicle(before);
    return state !== before;
  };
  // As the server does: wounds a model may shrug off are rolled first, then One Final Blow and the Royal Standard.
  const take = (a: Action): void => {
    // (And marks the models that come on, as the server does: mounts, war drums and so on.)
    if ((a.type === 'addModels' || a.type === 'startNarrative') && Array.isArray(a.models)) a = { ...a, models: a.models.map(m => markModel(catalog, m)) };
    const instead = a.type === 'wound' ? shrugOff(state, catalog, a, d6, uid, now) : null;
    if (instead) return instead.forEach(take);
    const before = state;
    state = reduce(state, a);
    for (const x of towersAfter(before, state, catalog, d6, uid, now)) take(x);
  };
  // As the server does: Ori's Chronicler, as models fall.
  const chronicle = (before: GameState) => {
    const deeds = chronicled(before, state, catalog, m => isMonster(catalog, m));
    if (deeds.length) state = reduce(state, { type: 'chronicle', add: deeds });
  };
  const longest: Record<string, number> = {};
  const counts: Record<string, number> = {};
  while (steps++ < maxSteps) {
    now += 500;
    // As the server does: Maelstrom warbands roll to arrive as their side starts to move.
    const due = arrivalsDue(state);
    if (due) for (const a of rollArrivals(state, due, d6, uid, rand, now)) state = reduce(state, a);
    // And a narrative scenario's own rules, the One Ring and fire, and Will of Evil.
    if (mightyDue(state, catalog)) for (const a of mightyBonus(state, catalog, uid, now)) state = reduce(state, a);
    const sam = longshanksDue(state);
    if (sam) for (const a of longshanksMove(state, sam)) state = reduce(state, a);
    if (state.narrative) {
      for (let k = 0; k < 4; k++) {
        const bearer = sauronDue(state, catalog);
        const out = arrivalAuto(state) ? rollArrival(state, d6, uid, now) : reinforceDue(state) ? rollReinforcements(state, d6, uid, now) : bondsDue(state) ? rollBonds(state, d6, uid, now) : trollDue(state) ? trollEnters(state, uid, now) : trampleDue(state) ? trample(state, catalog, d6, uid, now) : tideDue(state) ? goblinTide(state, uid, now) : legionsDue(state) ? legionsArrive(state, d6, uid, now) : wakeDue(state) ? wakeUp(state, d6, uid, now) : reliefDue(state) ? reliefArrives(state, uid, now) : listenDue(state, catalog) ? listenFor(state, catalog) : dawnDue(state) ? rollDawn(state, d6, uid, now) : webDue(state) ? cutWebs(state, d6, uid, now) : nestDue(state) ? nestReturn(state, uid, now) : hazeDue(state) ? hazeRolls(state, d6, uid, now) : elvesDue(state) ? elvesArrive(state, uid, now) : eaglesDue(state) ? eaglesArrive(state, uid, now) : gandalfDue(state) ? gandalfArrives(state, d6, uid, now) : hordeDue(state) ? hordeArrives(state, d6, uid, now) : osgHordeDue(state) ? osgHordeArrives(state, d6, uid, now) : doomHordeDue(state) ? doomHordeArrives(state, catalog, uid, now) : pelennorDue(state) ? pelennorArrives(state, uid, now) : unseatedDue(state) ? unseat(state, catalog, d6, uid, now) : imposingDue(state, catalog) ? imposingRoll(state, catalog, d6, uid, now) : gollumHides(state) ? hideGollum(state, uid, now) : setDownDue(state) ? setDown() : masterDue(state, catalog) ? masterRoll(state, catalog, d6, uid, now) : relentlessDue(state) ? relentlessHits(state, catalog, d6, uid, now) : wrathDue(state) ? wrathMove(state, uid, now) : alarmDue(state) ? alarmRaised(state, uid, now) : bearer ? sauronRoll(state, bearer, d6, uid, now) : burnDue(state) ? burns(state, catalog, d6, uid, now) : willOfEvilDue(state) ? willOfEvilToll(state, catalog, uid, now) : [];
        for (const a of out) state = reduce(state, a);
        if (!out.length) break;
      }
    }
    // And Paralysed models (or those in a Troll's sack) rolling to recover in the End phase.
    if (recoveryDue(state)) for (const a of recoveryRolls(state, d6, uid, now)) state = reduce(state, a);
    // And Demolition Charges disabled by an enemy beside them as the turn ends.
    for (const a of chargeSabotage(state, uid, now)) state = reduce(state, a);
    if (gameWinner(state) && !state.result) state = reduce(state, { type: 'gameOver', winner: gameWinner(state)! });
    if (state.result) break;
    // (The caller may stop the game early.)
    if (watch?.(state, steps)) break;
    let acted = false;
    for (const seat of ['p1', 'p2'] as const) {
      const t0 = performance.now();
      const step = botStep(state, seat, catalog, memos[seat], now, false);
      const ms = performance.now() - t0;
      const k = `${state.phase}`;
      longest[k] = Math.max(longest[k] ?? 0, ms);
      if (step?.action) {
        const was = state;
        const ok = apply(seat, step.action);
        onAction?.(was, seat, step.action, ok);
        const k2 = `${seat}:${step.action.type}${ok ? '' : ' (refused)'}`;
        counts[k2] = (counts[k2] ?? 0) + 1;
        if (step.action.type === 'updateModel') counts[`${seat}:fled`] = (counts[`${seat}:fled`] ?? 0) + 1;
        acted = true;
      } else if (step && step.delay === 0) acted = true; // (still thinking: it carries on next step)
    }
    if (acted) {
      idle = 0;
      continue;
    }
    if (++idle < 12) continue;
    idle = 0;
    // Both are waiting on the other player: do what a person would.
    if (state.phase === 'fight') {
      const open = combats(state).filter(c => !fightDone(state, c));
      const c = open[0];
      if (c) {
        const duel = openDuel(state, c);
        if (duel) {
          const req = { sides: [c.p1.map(i => ({ id: i, name: i, f: 3, a: 1, s: 3, d: 4 })), c.p2.map(i => ({ id: i, name: i, f: 3, a: 1, s: 3, d: 4 }))] as never, targets: [c.p2[0], c.p1[0]] as [string, string], trapped: false, combat: c.key };
          apply('p1', { type: 'strikes', fight: req, group: duel.group });
          continue;
        }
      }
      apply('p1', { type: 'nextPhase' });
    } else if (state.phase === 'end') {
      const check = endCheck(state, { p1: 'a', p2: 'b' });
      if (check?.rollNeeded && !state.log.some(r => r.label === endRollLabel(state.turn))) apply('p1', { type: 'roll', count: 1, label: endRollLabel(state.turn) });
      else if (check?.over || state.log.some(r => r.label === endRollLabel(state.turn) && r.dice[0] <= 2)) break;
      else if (state.turn >= (state.narrative ? 40 : 12)) break;
      else apply('p1', { type: 'nextPhase' });
    } else {
      throw new Error(`Stuck in turn ${state.turn} ${state.phase}`);
    }
  }
  return { state, steps, longest, counts };
}
