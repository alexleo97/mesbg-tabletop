// Courage tests the app rolls by itself: every model of a Broken army as its side starts to move, and a model
// charging a terrifying enemy as it moves into contact.
import { modelStats, type Catalog } from './catalog.ts';
import { activeSeat, CONTACT_SLACK } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { heroicsSettled, phaseHeroics } from './heroics.ts';
import { cannotAct, courageAuto, courageWorse, madeFearful, terrifying } from './powers.ts';
import { engaged } from './movement.ts';
import { sightTo } from './sight.ts';
import { armyStatus } from './status.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

/** How close a hero's friends must be to share its Stand Fast! or Heroic Resolve. */
export const STAND_FAST_RANGE = 6;

/** The 2D6 total a model needs to pass a Courage test, after powers such as Drain Courage and Aura of Dismay. */
const courageOf = (state: GameState, catalog: Catalog | null, m: Model) => Math.min(13, (modelStats(catalog, m)?.C ?? 7) + courageWorse(state, m));
const isHero = (m: Model) => m.hero;
export const causesTerror = (catalog: Catalog | null, m: Model, state?: GameState) =>
  !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Terror\b/.test(r))) || (!!state && terrifying(state, m));
/** Fearful models test their Courage to charge any enemy. */
const isFearful = (state: GameState, catalog: Catalog | null, m: Model) =>
  !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Fearful\b/.test(r))) || madeFearful(state, m);

type Roller = { d6: () => number; uid: () => string; now: number; by: Seat };

function roll(m: Model, c: number, label: string, r: Roller): DiceRoll {
  return { id: `c-${r.uid()}`, by: r.by, label: label.slice(0, 80), dice: [r.d6(), r.d6()], sum: c, model: m.id, at: r.now };
}
const passed = (d: DiceRoll) => d.dice[0] + d.dice[1] >= (d.sum ?? 7);

/** The side that should take its Broken army Courage tests now, if any: a Broken side as its Move activation starts. */
export function brokenSideToTest(state: GameState): Seat | null {
  if (!state.flow.started || state.phase !== 'move' || !heroicsSettled(state)) return null;
  const seat = activeSeat(state);
  if (!seat || state.flow.braved?.includes(seat) || !armyStatus(state, seat).broken) return null;
  return seat;
}

/**
 * A hero that fails a Courage test spends what Might and Will it needs to pass, if it has enough: Will first unless
 * it casts powers (it needs its Will for those), Might otherwise. Returns the roll as raised and the points spent.
 */
function rescue(catalog: Catalog | null, m: Model, d: DiceRoll): { roll: DiceRoll; might: number; will: number } | null {
  const short = (d.sum ?? 7) - d.dice[0] - d.dice[1];
  if (!m.hero || short <= 0 || short > m.might + m.will || 12 - d.dice[0] - d.dice[1] < short) return null;
  const caster = !!(m.profileId && catalog?.units[m.profileId]?.powers?.length);
  const firstWill = caster ? 0 : Math.min(m.will, short);
  const might = Math.min(m.might, short - firstWill);
  const will = short - might;
  if (will > m.will) return null;
  const dice = [...d.dice];
  for (let left = short; left > 0; left--) dice[dice[0] < 6 ? 0 : 1]++;
  const paid = [might ? `${might} Might` : '', will ? `${will} Will` : ''].filter(Boolean).join(' and ');
  return { roll: { ...d, dice, ...(might ? { might } : {}), note: `${m.name} spends ${paid} to pass.` }, might, will };
}

/**
 * Courage tests for a Broken side's models as it starts to move: those that can activate (not in a fight, nor held
 * by a power). Heroes go first; a hero that passes calls Stand Fast!, so warriors within 6" that can see it pass
 * without rolling. A hero with a Heroic Resolve passes, and calls Stand Fast! even from a fight. A hero that fails
 * spends Might or Will to pass if it can.
 */
export function brokenTests(state: GameState, seat: Seat, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const r: Roller = { d6, uid, now, by: seat };
  const resolute = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Resolve').map(h => h.model));
  const models = Object.values(state.models).filter(m => m.owner === seat && !m.dead && !m.escaped && !m.waiting && !cannotAct(state, m) && (!engaged(state, m) || resolute.has(m.id)));
  const rolls: DiceRoll[] = [];
  const spent: Action[] = [];
  const results: Record<string, boolean> = {};
  const anchors: Model[] = [];
  const heroes = models.filter(isHero).sort((a, b) => courageOf(state, catalog, b) - courageOf(state, catalog, a));
  for (const h of heroes) {
    // A Heroic Resolve, or a power such as Aura of Command, passes it without a roll.
    if (resolute.has(h.id) || courageAuto(state, catalog, h)) {
      results[h.id] = true;
      anchors.push(h);
      continue;
    }
    let d = roll(h, courageOf(state, catalog, h), `Courage test (Broken): ${h.name}`, r);
    const saved = !passed(d) && rescue(catalog, h, d);
    if (saved) {
      d = saved.roll;
      if (saved.might) spent.push({ type: 'affect', id: h.id, patch: { might: h.might - saved.might } });
      if (saved.will) spent.push({ type: 'spendWill', id: h.id, count: saved.will });
    }
    rolls.push(d);
    results[h.id] = passed(d);
    if (results[h.id]) anchors.push(h);
  }
  for (const m of models) {
    if (m.id in results) continue;
    if (anchors.some(h => distanceBetween(h, m) <= STAND_FAST_RANGE && sightTo(state, m, h) !== 'hidden') || courageAuto(state, catalog, m)) {
      results[m.id] = true;
      continue;
    }
    const d = roll(m, courageOf(state, catalog, m), `Courage test (Broken): ${m.name}`, r);
    rolls.push(d);
    results[m.id] = passed(d);
  }
  const fled = models.filter(m => !results[m.id]).length;
  const held = models.length - fled;
  const summary: DiceRoll = {
    id: `c-${uid()}`,
    by: seat,
    label: `Broken army: ${held} stand${held === 1 ? 's' : ''} firm, ${fled} flee${fled === 1 ? 's' : ''}${anchors.length ? ' (Stand Fast! from heroes who passed)' : ''}`.slice(0, 80),
    dice: [],
    at: now,
  };
  return [...rolls.map((roll): Action => ({ type: 'rolled', roll })), ...spent, { type: 'rolled', roll: summary }, { type: 'courageTaken', results, broken: seat }];
}

/**
 * The enemy this move would put the model in contact with that it must test its Courage to charge, if it hasn't
 * tested this turn: a terrifying one, or any enemy for a Fearful model. A Compelled model never tests.
 */
export function terrorAhead(state: GameState, m: Model, to: { x: number; y: number }, catalog: Catalog | null): Model | null {
  if (!state.flow.started || state.phase !== 'move' || state.flow.courage?.[m.id] !== undefined || state.flow.compel?.model === m.id) return null;
  const fearful = isFearful(state, catalog, m);
  if (!fearful && causesTerror(catalog, m, state)) return null;
  const here = { ...m, ...to };
  return Object.values(state.models).find(e => e.owner !== m.owner && !e.dead && distanceBetween(here, e) <= CONTACT_SLACK && (fearful || causesTerror(catalog, e, state))) ?? null;
}

/** The Courage test to charge a terrifying enemy (or any, when Fearful). A model that fails stays where it is for the rest of the turn. */
export function terrorTest(m: Model, enemy: Model, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now(), state?: GameState): { actions: Action[]; pass: boolean } {
  const why = state && isFearful(state, catalog, m) ? 'Fearful' : 'Terror';
  const auto = state && courageAuto(state, catalog, m);
  if (auto) {
    const note: DiceRoll = { id: `c-${uid()}`, by: m.owner, label: `Courage to charge ${enemy.name} (${why}): ${m.name}`.slice(0, 80), dice: [], note: `Passes without a roll (${auto}).`, model: m.id, at: now };
    return { actions: [{ type: 'rolled', roll: note }, { type: 'courageTaken', results: { [m.id]: true } }], pass: true };
  }
  const need = state ? courageOf(state, catalog, m) : (modelStats(catalog, m)?.C ?? 7);
  const d = roll(m, need, `Courage to charge ${enemy.name} (${why}): ${m.name}`, { d6, uid, now, by: m.owner });
  const pass = passed(d);
  return { actions: [{ type: 'rolled', roll: d }, { type: 'courageTaken', results: { [m.id]: pass } }], pass };
}

/** Will of Evil: the model fades away when it runs out of Will. */
export const willOfEvil = (catalog: Catalog | null, m: Model) => !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Will of Evil\b/.test(r)));

/** Whether Will of Evil is still to take its toll this End phase. */
export const willOfEvilDue = (state: GameState) => state.flow.started && state.phase === 'end' && !state.result && state.flow.willed !== state.turn;

/**
 * In the End phase each model with Will of Evil that fought this turn (any model touching an enemy fights) gives up
 * 1 Will, and is banished when it has none left.
 */
export function willOfEvilToll(state: GameState, catalog: Catalog | null, uid: () => string, now = Date.now()): Action[] {
  const fought = new Set(state.flow.resolved.flatMap(k => k.split(',')));
  const out: Action[] = [];
  for (const m of Object.values(state.models)) {
    if (m.dead || m.escaped || !willOfEvil(catalog, m) || !fought.has(m.id)) continue;
    const will = Math.max(0, m.will - 1);
    out.push({ type: 'rolled', roll: { id: `c-${uid()}`, by: m.owner, label: `Will of Evil: ${m.name} gives up 1 Will`.slice(0, 80), dice: [], model: m.id, note: will ? `${will} Will left.` : `${m.name} has no Will left and is banished.`, at: now } });
    out.push({ type: 'affect', id: m.id, patch: will ? { will } : { will: 0, wounds: 0, dead: true } });
  }
  out.push({ type: 'willOfEvil' });
  return out;
}
