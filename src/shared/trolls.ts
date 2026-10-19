import { rulesFor, type Catalog } from './catalog.ts';
import { mounted } from './cavalry.ts';
import { steadfast } from './company.ts';
import type { FightRequest } from './fight.ts';
import { basesOverlap } from './movement.ts';
import { nearCampfire } from './monsters.ts';
import { radius } from './narrative.ts';
import type { Action, DiceRoll, GameState, Model, ModelEffect, Seat } from './types.ts';

// Bill, Bert and Tom: the rules on the Trolls' own profiles, in our own words. Their Brutal Power Attacks (Mince 'em
// Fine, Roast 'em Slowly, Squash 'em into Jelly) are rolled with the fight (see fight.resolveStrikes); here are the
// sacks, Tom's cold and what follows a roast.

const rule = (catalog: Catalog | null | undefined, m: Model, re: RegExp) => rulesFor(catalog, m).some(r => re.test(r));

/** Keep 'em for Later: a Troll that wins may stuff a foe in a sack instead of striking. */
export const keepsForLater = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Keep 'em for later/i);
/** Only a model on a 25mm base fits in the sack. */
export const fitsSack = (m: Model) => m.base.shape === 'round' && m.base.w === 25 && !mounted(m) && !m.beast;
/** Tom's Lingering Cold. */
export const lingeringCold = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Lingering Cold$/);

/** The sacks held open in this fight: each Troll's pick, an enemy in the fight that fits. */
export function trollSacks(state: GameState, catalog: Catalog | null | undefined, req: FightRequest): { by: string; target: string }[] {
  const out: { by: string; target: string }[] = [];
  for (const side of [0, 1] as const) {
    const foes = req.sides[1 - side].filter(f => !f.support).map(f => f.id);
    for (const f of req.sides[side]) {
      const m = state.models[f.id];
      const target = state.flow.choices?.[f.id]?.sack;
      const t = target ? state.models[target] : undefined;
      if (f.support || !m || !t || !foes.includes(t.id) || !keepsForLater(catalog, m) || !fitsSack(t)) continue;
      out.push({ by: f.id, target: t.id });
    }
  }
  return out;
}

/** The sack's hold: Paralysed (and so Prone), and it lasts whatever becomes of the Troll or its Will. */
export const sackEffect = (by: string, turn: number): ModelEffect => ({ power: 'Paralyse', by, turn, duration: 'Exhaustion', sack: true });

/** A foe a Troll has bagged: Bofur may steady it first, and otherwise it goes in the sack. */
export function bag(state: GameState, catalog: Catalog | null | undefined, troll: Model, t: Model, d6: () => number, seat: Seat, id: string, now: number, group: string): { rolls: DiceRoll[]; actions: Action[] } {
  const rolls: DiceRoll[] = [];
  const steady = steadfast(state, catalog, t, "the Troll's sack", d6, t.owner, `${id}-sf`, now, group);
  if (steady.roll) rolls.push(steady.roll);
  if (steady.saved) return { rolls, actions: [] };
  rolls.push({ id, by: seat, label: `Keep 'em for Later: ${troll.name} stuffs ${t.name} in a sack`.slice(0, 80), dice: [], model: troll.id, at: now, group });
  return { rolls, actions: [{ type: 'affect', id: t.id, patch: { prone: true, effects: [...(t.effects ?? []).filter(e => !e.sack), sackEffect(troll.id, state.turn)] } }] };
}

/** Where a roasted foe is put: touching the fire, on the side nearest where it stood, clear of everyone else. */
export function roastSpot(state: GameState, t: Model, fire: { x: number; y: number; w: number }): { x: number; y: number } | null {
  const r = fire.w / 2 + radius(t) + 0.02;
  const from = Math.atan2(t.y - fire.y, t.x - fire.x);
  for (let k = 0; k <= 36; k++) {
    for (const sign of k ? [1, -1] : [1]) {
      const a = from + sign * k * (Math.PI / 36);
      const p = { x: fire.x + Math.cos(a) * r, y: fire.y + Math.sin(a) * r };
      const there = { ...t, ...p };
      const clear = Object.values(state.models).every(o => o.id === t.id || o.dead || o.waiting || o.escaped || !basesOverlap(there, o));
      if (clear && p.x >= radius(t) && p.y >= radius(t) && p.x <= state.board.w - radius(t) && p.y <= state.board.h - radius(t)) return p;
    }
  }
  return null;
}

/** Bert's Roast 'em Slowly: the foe he picked is carried to the fire and Set Ablaze. */
export function roast(state: GameState, bert: Model, t: Model): Action[] {
  const fire = nearCampfire(state, bert);
  if (!fire) return [];
  const at = roastSpot(state, t, fire);
  return [...(at ? [{ type: 'backAway', moves: [{ id: t.id, x: at.x, y: at.y }] } as Action] : []), { type: 'affect', id: t.id, patch: { ablaze: true } }];
}

/**
 * Bofur's Steadfast against a Troll's own Brutal Power Attack: for each foe it would hit, a 3+ to shrug it off.
 * Rolled before the fight's strikes; returns the rolls and who is spared.
 */
export function steadyAgainst(state: GameState, catalog: Catalog | null | undefined, ids: string[], what: string, d6: () => number, group: string, now: number): { rolls: DiceRoll[]; immune: string[] } {
  const rolls: DiceRoll[] = [];
  const immune: string[] = [];
  for (const id of ids) {
    const t = state.models[id];
    if (!t) continue;
    const s = steadfast(state, catalog, t, what, d6, t.owner, `${group}-sf-${id}`.slice(0, 80), now, group);
    if (s.roll) rolls.push(s.roll);
    if (s.saved) immune.push(id);
  }
  return { rolls, immune };
}

// ——— Tom's Lingering Cold ———

/**
 * Tom's sneeze, as a fight starts: a Will point to halve the Fight of the foe he picked (one he is fighting) until the
 * turn ends. Returns the roll for the log and the changes, or nothing if he can't.
 */
export function sneeze(state: GameState, catalog: Catalog | null | undefined, req: FightRequest, d6: () => number, seat: Seat, group: string, now: number): { rolls: DiceRoll[]; actions: Action[] } {
  const rolls: DiceRoll[] = [];
  const actions: Action[] = [];
  for (const side of [0, 1] as const) {
    const foes = req.sides[1 - side].filter(f => !f.support).map(f => f.id);
    for (const f of req.sides[side]) {
      const tom = state.models[f.id];
      const t = state.models[state.flow.choices?.[f.id]?.cold ?? ''];
      if (f.support || !tom || !t || !foes.includes(t.id) || !lingeringCold(catalog, tom) || tom.will < 1 || t.chilled === state.turn) continue;
      actions.push({ type: 'affect', id: tom.id, patch: { will: tom.will - 1 } });
      const steady = steadfast(state, catalog, t, 'the cold', d6, t.owner, `${group}-cold-sf`, now, group);
      rolls.push({ id: `${group}-cold`, by: seat, label: `Lingering Cold: ${tom.name} sneezes on ${t.name} (1 Will)`.slice(0, 80), dice: [], model: tom.id, at: now, group: `${group}-pre` });
      if (steady.roll) rolls.push({ ...steady.roll, group: `${group}-pre` });
      if (!steady.saved) actions.push({ type: 'affect', id: t.id, patch: { chilled: state.turn } });
    }
  }
  return { rolls, actions };
}
