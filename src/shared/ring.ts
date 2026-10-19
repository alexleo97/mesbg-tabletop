import { modelStats, type Catalog } from './catalog.ts';
import { courageOf } from './courage.ts';
import { activeSeat } from './flow.ts';
import { hasGear } from './gear.ts';
import { distanceBetween } from './geometry.ts';
import { heroicsSettled, mayActivate } from './heroics.ts';
import { mounted } from './cavalry.ts';
import { engaged } from './movement.ts';
import { isRingwraith } from './narrative.ts';
import { intelligenceWorse } from './powers.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// The One Ring. Its bearer may put it on during its activation and is then Invisible (the Nine see it all the same).
// Each time it begins an activation wearing the Ring it rolls for Sauron's Will: on a 1 or 2 its foes move it this
// time. Taking the Ring off again needs a Courage test, one try a turn.

export const SAURON_LABEL = "Sauron's Will";
export const RING_OFF_LABEL = 'Courage test: taking off the One Ring';

export const ringbearer = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bone ring\b/i);

/** Whether a model can't be picked out by `by`: it wears the Ring, and `by` isn't one of the Nine. */
export const invisibleTo = (m: Model, by: Model) => !!m.ringOn && !isRingwraith(by);

/** This turn's Intelligence test by `m` to charge the Invisible `e`, if it has taken one. */
const seekRoll = (state: GameState, m: Model, e: Model) => state.log.find(r => state.flow.sought?.includes(r.id) && r.model === m.id && r.against === e.id);

/** Whether `m` may charge `e`: it can always charge a model it can see, and an Invisible one after passing its test. */
export function mayChargeAt(state: GameState, m: Model, e: Model): boolean {
  if (!invisibleTo(e, m)) return true;
  const r = seekRoll(state, m, e);
  return !!r && r.dice[0] + r.dice[1] >= (r.sum ?? 7);
}

/**
 * The Invisible foes `m` may take an Intelligence test to charge now, and the 2D6 score each needs: its Intelligence,
 * one worse for every full inch away the foe is. One try at each a turn; failing means it can't charge that one.
 */
export function seekTargets(state: GameState, catalog: Catalog | null, m: Model): { target: Model; need: number }[] {
  if (!state.flow.started || state.phase !== 'move' || m.dead || m.waiting || m.escaped || engaged(state, m)) return [];
  if (!heroicsSettled(state) || activeSeat(state) !== m.owner || !mayActivate(state, m)) return [];
  const i = modelStats(catalog, m)?.I ?? 7;
  return Object.values(state.models)
    .filter(e => e.owner !== m.owner && !e.dead && !e.waiting && !e.escaped && invisibleTo(e, m) && !seekRoll(state, m, e))
    .map(e => ({ target: e, need: Math.min(13, Math.max(2, i + Math.floor(distanceBetween(m, e)) + intelligenceWorse(state, m))) }));
}

/** Rolls `m`'s Intelligence test to charge the Invisible `target`, or null if it can't take one now. */
export function seekRequest(state: GameState, catalog: Catalog | null, seat: Seat, id: string, target: string, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  const m = state.models[id];
  if (!m || m.owner !== seat) return null;
  const t = seekTargets(state, catalog, m).find(x => x.target.id === target);
  if (!t) return null;
  const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: `Intelligence test: ${m.name} charging ${t.target.name}`.slice(0, 80), dice: [d6(), d6()], sum: t.need, model: m.id, against: t.target.id, note: 'Fail, and it can\'t charge the Invisible model this turn.', at: now };
  return [{ type: 'rolled', roll }, { type: 'ringMark', key: 'sought', id: roll.id }];
}

/** Why a Ringbearer can't put the Ring on now (unset if it can). */
export function cantWear(state: GameState, catalog: Catalog | null | undefined, m: Model): string | undefined {
  if (!ringbearer(catalog, m)) return 'doesn’t carry the One Ring';
  if (m.ringOn) return 'already wears the Ring';
  if (!state.flow.started || state.phase !== 'move') return 'can only put it on as it activates, in the Move phase';
  if (activeSeat(state) !== m.owner || !mayActivate(state, m)) return 'isn’t activating now';
  if (engaged(state, m)) return 'is in a fight, so can’t activate';
  if (mounted(m)) return 'is riding (its mount would bolt)';
  return undefined;
}

/** Whether `seat` has Compelled the Ringbearer `m` this phase and may make it put the Ring on (the Compel power allows it). */
export function compelWear(state: GameState, catalog: Catalog | null | undefined, seat: Seat, m: Model): boolean {
  const c = state.flow.compel;
  if (!c || c.ring || c.model !== m.id || state.models[c.caster]?.owner !== seat || m.owner === seat) return false;
  return ringbearer(catalog, m) && !m.ringOn && !m.dead && !mounted(m);
}

/** Why a Ringbearer can't try to take the Ring off now (unset if it can). */
export function cantRemove(state: GameState, m: Model): string | undefined {
  if (!m.ringOn) return 'isn’t wearing the Ring';
  if (!state.flow.started || state.phase !== 'move' || activeSeat(state) !== m.owner || !mayActivate(state, m)) return 'can only try as it activates, in the Move phase';
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
  if (m && on && compelWear(state, catalog, seat, m)) {
    const note: DiceRoll = { id: `r-${uid()}`, by: seat, label: `${m.name} is made to put on the One Ring`.slice(0, 80), dice: [], model: m.id, note: 'Invisible to all but the Nine.', at: now };
    return [{ type: 'rolled', roll: note }, { type: 'affect', id: m.id, patch: { ringOn: true } }];
  }
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
