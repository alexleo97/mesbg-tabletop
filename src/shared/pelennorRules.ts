// The special rules of the heroes and warriors at the Pelennor (the Defenders of the Pelennor and the Legions of
// Mordor) that the rest of the game doesn't already know, worked out from their profiles so the server, the fight card
// and the computer agree. They apply wherever these profiles are fielded, not only in the narrative scenario.
import { modelStats, type Catalog } from './catalog.ts';
import type { Fighter } from './fight.ts';
import { distanceBetween } from './geometry.ts';
import { carrierOf, passengerBoon, passengerOf } from './passengers.ts';
import { hasRule } from './wargear.ts';
import type { Action, DiceRoll, GameState, Model } from './types.ts';

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.escaped && !m.waiting;
const friends = (state: GameState, m: Model) => Object.values(state.models).filter(o => o.owner === m.owner && o.id !== m.id && alive(o));

/** A model of Dunharrow: the King of the Dead, his Heralds and his Warriors. */
export const dunharrow = (m: Pick<Model, 'name'>) => /\bof the dead\b/i.test(m.name);

// ——— Éowyn ———

const isTheoden = (m: Model) => m.cast === 'theoden' || /\bth[eé]oden\b/i.test(m.name);

/** "I Shall Kill You if You Touch Him": the enemy that slew Théoden, whom Éowyn must re-roll her failed To Wound rolls against. */
export function eowynsFoe(state: GameState, catalog: Catalog | null | undefined, m: Model): string | undefined {
  if (!hasRule(catalog, m, 'I Shall Kill You if You Touch Him')) return undefined;
  const theoden = Object.values(state.models).find(o => o.owner === m.owner && isTheoden(o) && o.dead);
  return theoden?.killedBy?.ids.find(id => state.models[id]?.owner !== m.owner);
}

/** Once Théoden has fallen, Éowyn is Fearless for the rest of the game. */
export const eowynFearless = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  hasRule(catalog, m, 'I Shall Kill You if You Touch Him') && Object.values(state.models).some(o => o.owner === m.owner && isTheoden(o) && o.dead);

// ——— The Crown of Morgul ———

const CROWN = 'Crown of Morgul';
const wearsCrown = (catalog: Catalog | null | undefined, m: Model) => hasRule(catalog, m, CROWN);

/**
 * The Crown of Morgul: enemies within 6" of the Witch-king, or charging him, can't use special rules that pass Courage
 * tests without a roll (a Heroic Resolve still works).
 */
export function crownedNear(state: GameState, catalog: Catalog | null | undefined, m: Model, charging?: Model): boolean {
  if (charging && wearsCrown(catalog, charging) && charging.owner !== m.owner) return true;
  return Object.values(state.models).some(w => w.owner !== m.owner && alive(w) && wearsCrown(catalog, w) && distanceBetween(w, m) <= 6);
}

/** Whether the Witch-king may set his blade alight now: once a game, as a Fight phase begins. */
export function mayLightBlade(state: GameState, catalog: Catalog | null | undefined, m: Model | undefined): boolean {
  if (!m || !alive(m) || !wearsCrown(catalog, m) || m.used?.includes(CROWN)) return false;
  return state.flow.started && state.phase === 'fight' && !state.flow.resolved.length && !state.flow.duels?.length;
}

export function lightBlade(m: Model, uid: () => string, now = Date.now()): Action[] {
  return [
    { type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `${m.name} sets his blade alight (Crown of Morgul)`.slice(0, 80), dice: [], model: m.id, note: 'Until the turn ends, any model wounded by his strikes is Set Ablaze.', at: now } },
    { type: 'affect', id: m.id, patch: { used: [...(m.used ?? []), CROWN] } },
    { type: 'usedTurn', key: 'crown', model: m.id },
  ];
}

/** His blade is alight this turn. */
export const bladeAlight = (state: GameState, m: Model) => !!state.flow.usedTurn?.includes(`crown:${m.id}`);

// ——— The Mûmak War Leader ———

/** The Royal War Mûmak a hero with Imposing Presence or High King of the South rides, while he rides it. */
export function royalMumak(state: GameState, catalog: Catalog | null | undefined, m: Model): Model | undefined {
  if (!(hasRule(catalog, m, 'Imposing Presence') || hasRule(catalog, m, 'High King of the South')) || !alive(m) || !m.aboard) return undefined;
  const beast = state.models[m.aboard];
  return beast && alive(beast) && beast.beast === 'war' ? beast : undefined;
}

/**
 * Imposing Presence: the first Heroic Move in a turn declared by an enemy within 12" of the Royal War Mûmak (measured
 * from its base) is rolled for; on a 4+ it is called off and the Might spent on it is lost. Returns that heroic, or null.
 */
export function imposingDue(state: GameState, catalog: Catalog | null | undefined): { leader: Model; hero: Model; key: string } | null {
  if (!state.flow.started || state.result || state.phase !== 'move') return null;
  const key = `imposing:${state.turn}`;
  if (state.flow.heard?.includes(key)) return null;
  for (const leader of Object.values(state.models)) {
    const beast = hasRule(catalog, leader, 'Imposing Presence') ? royalMumak(state, catalog, leader) : undefined;
    if (!beast) continue;
    const h = state.flow.heroics.find(x => x.phase === 'move' && x.action === 'Heroic Move' && state.models[x.model]?.owner !== leader.owner && distanceBetween(beast, state.models[x.model]) <= 12);
    if (h) return { leader, hero: state.models[h.model], key };
  }
  return null;
}

export function imposingRoll(state: GameState, catalog: Catalog | null | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const due = imposingDue(state, catalog);
  if (!due) return [];
  const d = d6();
  const off = d >= 4;
  const roll: DiceRoll = { id: `r-${uid()}`, by: due.leader.owner, label: `Imposing Presence: ${due.hero.name}'s Heroic Move is called off on a 4+`.slice(0, 80), dice: [d], target: 4, model: due.leader.id, at: now, note: off ? `${due.hero.name}'s Heroic Move is lost, and the Might spent on it.` : `${due.hero.name} holds his nerve.` };
  return [{ type: 'heard', key: due.key }, { type: 'rolled', roll }, ...(off ? [{ type: 'cancelHeroic', model: due.hero.id } as Action] : [])];
}

/** High King of the South: the War Leader's Stand Fast! reaches 12", measured from the Royal War Mûmak he rides. */
export function highKingFor(state: GameState, catalog: Catalog | null | undefined, m: Model): Model | undefined {
  return friends(state, m).find(k => {
    const beast = hasRule(catalog, k, 'High King of the South') ? royalMumak(state, catalog, k) : undefined;
    return !!beast && beast.id !== m.id && distanceBetween(beast, m) <= 12;
  });
}

// ——— In a fight ———

/**
 * What these rules do to a fighter: the boons of a Passenger behind the rider (Pippin: re-roll 1s To Wound; Merry: 3
 * Attacks), the Passenger itself to be struck at, Captain of the Citadel Guard (+1 To Wound), Éowyn near Théoden
 * (re-roll 1s To Wound) and Irolas Shielding to strike all the same.
 */
export function pelennorFight(state: GameState, catalog: Catalog | null | undefined, m: Model, out: Fighter): void {
  const notes = [...(out.notes ?? [])];
  const times = out.shielding ? 2 : 1;
  const boon = passengerBoon(state, catalog, m);
  if (boon === 'Pippin') {
    out.ones = true;
    notes.push('Pippin: re-rolls 1s to wound');
  }
  if (boon === 'Merry' && out.a < 3 * times) {
    out.a = Math.min(10, 3 * times);
    notes.push('Merry: 3 Attacks');
  }
  const p = passengerOf(state, m);
  if (p && carrierOf(state, p)) out.passenger = { id: p.id, name: p.name, d: modelStats(catalog, p)?.D ?? 4 };
  if (/\bcitadel guard\b/i.test(m.name) && friends(state, m).some(o => hasRule(catalog, o, 'Captain of the Citadel Guard') && distanceBetween(o, m) <= 3)) {
    out.woundMod = (out.woundMod ?? 0) + 1;
    notes.push('Captain of the Citadel Guard: +1 to wound');
  }
  if (hasRule(catalog, m, 'I Shall Kill You if You Touch Him') && friends(state, m).some(o => isTheoden(o) && distanceBetween(o, m) <= 3)) {
    out.ones = true;
    notes.push('Near Théoden: re-rolls 1s to wound');
  }
  if (out.shielding && hasRule(catalog, m, 'Defend the White City')) {
    out.whiteCity = true;
    notes.push('Defend the White City: one strike if he wins');
  }
  if (hasRule(catalog, m, 'Drain Soul')) notes.push('Drain Soul: a wound that gets through slays');
  if (bladeAlight(state, m)) notes.push('Crown of Morgul: those he wounds are Set Ablaze');
  if (notes.length) out.notes = notes;
}

/** After the To Wound needs are worked out: Éowyn re-rolls every failed To Wound roll against the slayer of Théoden. */
export function pelennorVs(state: GameState, catalog: Catalog | null | undefined, m: Model, out: Fighter): void {
  const foe = eowynsFoe(state, catalog, m);
  if (foe && out.vs?.[foe]) out.vs[foe] = { ...out.vs[foe], reroll: true };
}
