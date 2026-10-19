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
export function play(state: GameState, rand: () => number, maxSteps = 20000) {
  const memos: Record<Seat, BotMemo> = { p1: newMemo(), p2: newMemo() };
  const d6 = () => 1 + Math.floor(rand() * 6);
  let id = 0;
  const uid = () => `u${id++}`;
  let now = 1000;
  let steps = 0;
  let idle = 0;
  const apply = (seat: Seat, a: Action) => {
    if (DICE_REQUESTS.has(a.type)) {
      const out = resolveRequest(state, seat, a, d6, uid, now);
      if (!out) return false;
      for (const x of [...out.apply, ...(out.record ? [out.record] : [])]) state = reduce(state, x);
      return true;
    }
    const before = state;
    state = reduce(state, a);
    return state !== before;
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
        const bearer = sauronDue(state);
        const out = arrivalAuto(state) ? rollArrival(state, d6, uid, now) : bearer ? sauronRoll(state, bearer, d6, uid, now) : burnDue(state) ? burns(state, catalog, d6, uid, now) : willOfEvilDue(state) ? willOfEvilToll(state, catalog, uid, now) : [];
        for (const a of out) state = reduce(state, a);
        if (!out.length) break;
      }
    }
    if (gameWinner(state) && !state.result) state = reduce(state, { type: 'gameOver', winner: gameWinner(state)! });
    if (state.result) break;
    let acted = false;
    for (const seat of ['p1', 'p2'] as const) {
      const t0 = performance.now();
      const step = botStep(state, seat, catalog, memos[seat], now, false);
      const ms = performance.now() - t0;
      const k = `${state.phase}`;
      longest[k] = Math.max(longest[k] ?? 0, ms);
      if (step?.action) {
        const ok = apply(seat, step.action);
        const k2 = `${seat}:${step.action.type}${ok ? '' : ' (refused)'}`;
        counts[k2] = (counts[k2] ?? 0) + 1;
        if (step.action.type === 'updateModel') counts[`${seat}:fled`] = (counts[`${seat}:fled`] ?? 0) + 1;
        acted = true;
      } else if (step) acted = acted || false;
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
