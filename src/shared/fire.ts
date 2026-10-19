import { pushBack } from './backAway.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { hasRule } from './wargear.ts';
import { insidePolygon, outline } from './sight.ts';
import { isRingwraith } from './narrative.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Fire: models Set Ablaze burn in every End phase until they put the fire out, and the flaming brands the Hobbits
// wave at Weathertop drive the Ringwraiths back.

/** Fire can't touch it (a Balrog, a Dragon). */
export const fireproof = (catalog: Catalog | null | undefined, m: Model) => hasRule(catalog, m, 'Flame of Udun') || hasRule(catalog, m, '"I am fire, I am death"');

/** Whether the fires are still to burn this End phase. */
export const burnDue = (state: GameState) => state.flow.started && state.phase === 'end' && !state.result && state.flow.burned !== state.turn && Object.values(state.models).some(m => m.ablaze && !m.dead);

/** In the End phase each model Set Ablaze takes a Strength 5 hit. */
export function burns(state: GameState, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const m of Object.values(state.models)) {
    if (!m.ablaze || m.dead || m.escaped) continue;
    const need = woundNeed(5, modelStats(catalog, m)?.D ?? 4);
    const label = `Set Ablaze: a Strength 5 hit on ${m.name}`;
    if (!need) {
      out.push({ type: 'rolled', roll: { id: `b-${uid()}`, by: m.owner, label: label.slice(0, 80), dice: [], model: m.id, note: 'The flames can\'t hurt it.', at: now } });
      continue;
    }
    const dice = [d6()];
    const follow = need.then && dice[0] >= need.target ? [d6()] : undefined;
    const hurt = need.then ? !!follow && follow[0] >= need.then : dice[0] >= need.target;
    const roll: DiceRoll = { id: `b-${uid()}`, by: m.owner, label: `${label} (${formatNeed(need)})`.slice(0, 80), dice, target: need.target, against: m.id, ...(need.then ? { then: need.then, follow } : {}), note: hurt ? `${m.name} is wounded by the flames.` : `${m.name} shrugs off the flames.`, at: now };
    out.push({ type: 'rolled', roll });
    if (hurt) out.push({ type: 'wound', id: m.id, count: 1, how: 'other' });
  }
  out.push({ type: 'burned' });
  return out;
}

/** A model Set Ablaze puts the fire out by crawling 1" while Prone, or by getting into water. */
export function putOut(state: GameState, m: Model): boolean {
  if (!m.ablaze) return false;
  if (m.prone && state.flow.crawling?.includes(m.id) && (state.flow.walked?.[m.id] ?? 0) >= 0.95) return true;
  return Object.values(state.terrain).some(t => t.kind === 'water' && insidePolygon(outline(t), m));
}

/**
 * Flaming brands: every Ringwraith that lost the fight to a model carrying a brand, and lived, retreats D6" further
 * away from it once it has backed away (`after` holds where everyone stands by then). It goes straight back at first,
 * and its player then picks the way it goes (see placing.ts).
 */
export function brandRetreats(after: GameState, losers: string[], winners: string[], d6: () => number, by: Seat, group: string, now: number): Action[] {
  const brands = winners.map(id => after.models[id]).filter(w => w && !w.dead && w.brand);
  if (!brands.length) return [];
  const out: Action[] = [];
  let state = after;
  for (const id of losers) {
    const m = state.models[id];
    if (!m || m.dead || !isRingwraith(m)) continue;
    const d = d6();
    const away = pushBack(state, [id], brands.map(b => b.id), d);
    const moves = away.moves.filter(mv => mv.id === id);
    out.push({ type: 'rolled', roll: { id: `${group}-brand${out.length}`, by, label: `Flaming brand: ${m.name} retreats ${d}"`.slice(0, 80), dice: [d], model: m.id, group, note: `${m.name} shrinks from the fire.`, at: now } });
    if (moves.length) {
      out.push({ type: 'backAway', moves });
      state = { ...state, models: { ...state.models, [id]: { ...m, x: moves[0].x, y: moves[0].y } } };
    }
    // Driven straight back to start with; its player then picks which way it goes.
    out.push({ type: 'placing', placing: { model: id, seat: m.owner, kind: 'retreat', from: [m.x, m.y], dist: d, away: brands.map(b => b.id) } });
  }
  return out;
}

export const fireLine = (m: Model) => (m.ablaze ? 'Set Ablaze: a Strength 5 hit in each End phase, until it crawls 1" while Prone or gets into water.' : undefined);
