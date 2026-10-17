// Courage tests the app rolls by itself: every model of a Broken army as its side starts to move, and a model
// charging a terrifying enemy as it moves into contact.
import { modelStats, type Catalog } from './catalog.ts';
import { activeSeat, CONTACT_SLACK } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { heroicsSettled, phaseHeroics } from './heroics.ts';
import { armyStatus } from './status.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

/** How close a hero's friends must be to share its Stand Fast! or Heroic Resolve. */
export const STAND_FAST_RANGE = 6;

const courageOf = (catalog: Catalog | null, m: Model) => modelStats(catalog, m)?.C ?? 7;
const isHero = (m: Model) => m.hero;
export const causesTerror = (catalog: Catalog | null, m: Model) =>
  !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Terror\b/.test(r)));

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
 * Courage tests for every model of a Broken side. Heroes go first; a hero that passes calls Stand Fast!, so friends
 * near it pass without rolling. A hero with a Heroic Resolve passes, and so do its friends nearby.
 */
export function brokenTests(state: GameState, seat: Seat, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const r: Roller = { d6, uid, now, by: seat };
  const models = Object.values(state.models).filter(m => m.owner === seat && !m.dead && !m.escaped);
  const resolute = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Resolve').map(h => h.model));
  const rolls: DiceRoll[] = [];
  const results: Record<string, boolean> = {};
  const anchors: Model[] = [];
  const heroes = models.filter(isHero).sort((a, b) => courageOf(catalog, b) - courageOf(catalog, a));
  for (const h of heroes) {
    if (resolute.has(h.id)) {
      results[h.id] = true;
      anchors.push(h);
      continue;
    }
    const d = roll(h, courageOf(catalog, h), `Courage test (Broken): ${h.name}`, r);
    rolls.push(d);
    results[h.id] = passed(d);
    if (results[h.id]) anchors.push(h);
  }
  for (const m of models) {
    if (m.id in results) continue;
    if (anchors.some(h => distanceBetween(h, m) <= STAND_FAST_RANGE)) {
      results[m.id] = true;
      continue;
    }
    const d = roll(m, courageOf(catalog, m), `Courage test (Broken): ${m.name}`, r);
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
  return [...rolls.map((roll): Action => ({ type: 'rolled', roll })), { type: 'rolled', roll: summary }, { type: 'courageTaken', results, broken: seat }];
}

/** A terrifying enemy this move would put the model in contact with, if it hasn't tested its Courage this turn. */
export function terrorAhead(state: GameState, m: Model, to: { x: number; y: number }, catalog: Catalog | null): Model | null {
  if (!state.flow.started || state.phase !== 'move' || state.flow.courage?.[m.id] !== undefined || causesTerror(catalog, m)) return null;
  const here = { ...m, ...to };
  return Object.values(state.models).find(e => e.owner !== m.owner && !e.dead && distanceBetween(here, e) <= CONTACT_SLACK && causesTerror(catalog, e)) ?? null;
}

/** The Courage test to charge a terrifying enemy. A model that fails stays where it is for the rest of the turn. */
export function terrorTest(m: Model, enemy: Model, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): { actions: Action[]; pass: boolean } {
  const d = roll(m, courageOf(catalog, m), `Courage to charge ${enemy.name} (Terror): ${m.name}`, { d6, uid, now, by: m.owner });
  const pass = passed(d);
  return { actions: [{ type: 'rolled', roll: d }, { type: 'courageTaken', results: { [m.id]: pass } }], pass };
}
