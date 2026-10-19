import type { Catalog } from './catalog.ts';
import { courageOf } from './courage.ts';
import { activeSeat } from './flow.ts';
import { hasGear } from './gear.ts';
import { distanceBetween } from './geometry.ts';
import { heroicsSettled, mayActivate } from './heroics.ts';
import { mounted } from './cavalry.ts';
import { engaged } from './movement.ts';
import { isRingwraith } from './narrative.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// The One Ring. Its bearer may put it on during its activation and is then Invisible (the Nine see it all the same).
// Each time it begins an activation wearing the Ring it rolls for Sauron's Will: on a 1 or 2 its foes move it this
// time. Taking the Ring off again needs a Courage test, one try a turn.

export const SAURON_LABEL = "Sauron's Will";
export const RING_OFF_LABEL = 'Courage test: taking off the One Ring';

export const ringbearer = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bone ring\b/i);

/** Whether a model can't be picked out by `by`: it wears the Ring, and `by` isn't one of the Nine. */
export const invisibleTo = (m: Model, by: Model) => !!m.ringOn && !isRingwraith(by);

/** Why a Ringbearer can't put the Ring on now (unset if it can). */
export function cantWear(state: GameState, catalog: Catalog | null | undefined, m: Model): string | undefined {
  if (!ringbearer(catalog, m)) return 'doesn’t carry the One Ring';
  if (m.ringOn) return 'already wears the Ring';
  if (!state.flow.started || state.phase !== 'move') return 'can only put it on as it activates, in the Move phase';
  if (!mayActivate(state, m)) return 'isn’t activating now';
  if (engaged(state, m)) return 'is in a fight, so can’t activate';
  if (mounted(m)) return 'is riding (its mount would bolt)';
  return undefined;
}

/** Why a Ringbearer can't try to take the Ring off now (unset if it can). */
export function cantRemove(state: GameState, m: Model): string | undefined {
  if (!m.ringOn) return 'isn’t wearing the Ring';
  if (!state.flow.started || state.phase !== 'move' || !mayActivate(state, m)) return 'can only try as it activates, in the Move phase';
  if (state.flow.compel?.ring && state.flow.compel.model === m.id) return 'is in Sauron’s grip this turn';
  if (state.flow.ringTried?.includes(m.id)) return 'has tried already this turn';
  return undefined;
}

/** A Ringbearer that has just begun its side's move wearing the Ring and must roll for Sauron's Will. */
export function sauronDue(state: GameState): Model | undefined {
  if (!state.flow.started || state.phase !== 'move' || !heroicsSettled(state) || state.result) return undefined;
  const seat = activeSeat(state);
  return Object.values(state.models).find(m => m.owner === seat && m.ringOn && !m.dead && !m.waiting && !state.flow.sauron?.includes(m.id));
}

/**
 * Sauron's Will: a D6 (Might can raise it), 3+ keeps control. On a 1-2 the nearest enemy's side moves the Ringbearer
 * as it likes this activation, up to its full Move, charging if it can.
 */
export function sauronRoll(state: GameState, m: Model, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const die = d6();
  const lost = die < 3;
  const roll: DiceRoll = { id: `r-${uid()}`, by: m.owner, label: `${SAURON_LABEL}: ${m.name} (3+ keeps control)`.slice(0, 80), dice: [die], target: 3, model: m.id, note: lost ? `The Ring takes hold: the enemy moves ${m.name} this turn.` : `${m.name} keeps control.`, at: now };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'ringMark', key: 'sauron', id: m.id }];
  const foe = Object.values(state.models).filter(o => o.owner !== m.owner && !o.dead && !o.waiting && !o.escaped).sort((a, b) => distanceBetween(a, m) - distanceBetween(b, m))[0];
  if (lost && foe) out.push({ type: 'compel', compel: { model: m.id, caster: foe.id, max: m.move, from: [m.x, m.y], ring: true } });
  return out;
}

/** Puts the Ring on, or rolls the Courage test to take it off (Will can help it pass afterwards). */
export function ringRequest(state: GameState, catalog: Catalog | null, seat: Seat, id: string, on: boolean, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  const m = state.models[id];
  if (!m || m.owner !== seat || m.dead) return null;
  if (on) {
    if (cantWear(state, catalog, m)) return null;
    // Put on during its activation: it has already begun, so no roll for Sauron's Will until it next activates.
    const note: DiceRoll = { id: `r-${uid()}`, by: seat, label: `${m.name} puts on the One Ring`.slice(0, 80), dice: [], model: m.id, note: 'Invisible to all but the Nine.', at: now };
    return [{ type: 'rolled', roll: note }, { type: 'affect', id: m.id, patch: { ringOn: true } }, { type: 'ringMark', key: 'sauron', id: m.id }];
  }
  if (cantRemove(state, m)) return null;
  const sum = courageOf(state, catalog, m);
  const dice = [d6(), d6()];
  const pass = dice[0] + dice[1] >= sum;
  const roll: DiceRoll = { id: `c-${uid()}`, by: seat, label: `${RING_OFF_LABEL} (${m.name})`.slice(0, 80), dice, sum, model: m.id, note: pass ? `${m.name} takes the Ring off.` : `${m.name} can’t bring himself to take it off this turn.`, at: now };
  return [{ type: 'rolled', roll }, { type: 'ringMark', key: 'ringTried', id: m.id }, ...(pass ? [{ type: 'affect', id: m.id, patch: { ringOn: false } } as Action] : [])];
}

/** After Might or Will raised a roll: Sauron's Will now held, or the Ring now comes off. */
export function ringAfterMight(state: GameState, roll: DiceRoll): GameState {
  const m = roll.model ? state.models[roll.model] : undefined;
  if (!m) return state;
  if (roll.label.startsWith(SAURON_LABEL) && roll.dice[0] >= 3 && state.flow.compel?.ring && state.flow.compel.model === m.id) {
    const held = (state.flow.held ?? []).filter(x => x !== m.id);
    return { ...state, flow: { ...state.flow, compel: undefined, held }, log: state.log.map(r => (r.id === roll.id ? { ...r, note: `${m.name} keeps control.` } : r)) };
  }
  if (roll.label.startsWith(RING_OFF_LABEL) && m.ringOn && roll.dice[0] + roll.dice[1] >= (roll.sum ?? 7)) {
    const { ringOn: _, ...off } = m;
    return { ...state, models: { ...state.models, [m.id]: off }, log: state.log.map(r => (r.id === roll.id ? { ...r, note: `${m.name} takes the Ring off.` } : r)) };
  }
  return state;
}
