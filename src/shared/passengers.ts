// Passengers: a model carried into battle on another's mount, behind its rider (Pippin on Shadowfax with Gandalf, Merry
// on Éowyn's horse). Each is a model in its own right, counted wherever models are counted, but while it rides it can't
// activate, shoot or join a fight. A shot that would hit the rider hits it instead on a 1-3; when the rider's side loses
// a fight it can be struck like the rider; it takes a Thrown Rider test if the mount or the rider falls; and it may get
// down beside the mount during that mount's move, moving no further that phase (and must, if the rider gets down).
// While it rides, the rider has the boons its profile gives (Resistant to Magic and so on) and may spend its Might, Will
// and Fate as though they were the rider's own.
import { mounted } from './cavalry.ts';
import { hasRule } from './wargear.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { distanceBetween } from './geometry.ts';
import { woundNeed, formatNeed } from './rules.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

type D6 = () => number;

/** The mount a model rides as a Passenger, if it does: a cavalry model (not a war beast) it is aboard. */
export function carrierOf(state: GameState, m: Model): Model | undefined {
  const c = m.aboard ? state.models[m.aboard] : undefined;
  return c && !c.beast && !!c.mount ? c : undefined;
}

export const isPassenger = (state: GameState, m: Model) => !m.dead && !!carrierOf(state, m);

/** The Passenger riding behind a rider, if any. */
export const passengerOf = (state: GameState, rider: Model): Model | undefined =>
  rider.mount && !rider.beast ? Object.values(state.models).find(p => p.aboard === rider.id && !p.dead) : undefined;

/** The boon a rider has from the Passenger behind it (its profile names the Passenger's rule): 'Pippin' or 'Merry'. */
export function passengerBoon(state: GameState, catalog: Catalog | null | undefined, rider: Model): 'Pippin' | 'Merry' | null {
  if (!mounted(rider) || !passengerOf(state, rider)) return null;
  if (hasRule(catalog, rider, 'Pippin')) return 'Pippin';
  if (hasRule(catalog, rider, 'Merry')) return 'Merry';
  return null;
}

/** A free spot touching the mount for a Passenger getting down: behind it first, then further round. */
export function alightSpot(state: GameState, carrier: Model, p: Model): { x: number; y: number } {
  const r = Math.max(carrier.base.w, carrier.base.h) / 50.8 + p.base.w / 50.8 + 0.03;
  const back = ((carrier.rot + 180) * Math.PI) / 180;
  for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) {
    const a = back + (turn * Math.PI) / 180;
    const at = { x: carrier.x + Math.sin(a) * r, y: carrier.y - Math.cos(a) * r };
    if (at.x < 0.6 || at.y < 0.6 || at.x > state.board.w - 0.6 || at.y > state.board.h - 0.6) continue;
    const here = { ...p, ...at, aboard: undefined };
    if (Object.values(state.models).some(o => o.id !== p.id && o.id !== carrier.id && !o.dead && !o.waiting && !o.escaped && !o.aboard && distanceBetween(here, o) < 0.01)) continue;
    return at;
  }
  return { x: carrier.x, y: carrier.y };
}

/**
 * A Passenger parting from its rider: put down beside it, with what is left of the Might, Will and Fate it lent (no
 * more than it lent, and no more than the rider has left).
 */
export function parting(p: Model, carrier: Model, at: { x: number; y: number }): Action[] {
  const [m, w, f] = p.lent ?? [0, 0, 0];
  const back = { might: Math.min(m, carrier.might), will: Math.min(w, carrier.will), fate: Math.min(f, carrier.fate) };
  const out: Action[] = [{ type: 'affect', id: p.id, patch: { aboard: '', x: at.x, y: at.y, rot: carrier.rot, ...back } }];
  if (back.might || back.will || back.fate) out.push({ type: 'affect', id: carrier.id, patch: { might: carrier.might - back.might, will: carrier.will - back.will, fate: carrier.fate - back.fate } });
  return out;
}

/** Why a Passenger can't get down now; unset if it may (during its mount's move, before that move is over). */
export function alightBlocked(state: GameState, p: Model | undefined, seat: Seat): string | undefined {
  const c = p ? carrierOf(state, p) : undefined;
  if (!p || !c || p.dead || p.owner !== seat) return 'Not a Passenger';
  if (!state.flow.started) return 'Only during the battle';
  if (state.phase !== 'move') return 'Only in the Move phase';
  if (state.flow.stopped?.includes(c.id)) return "Its mount's move is over";
  if (state.flow.activated?.includes(c.id)) return "Its mount's move is over";
  return undefined;
}

/** The Passenger gets down: beside its mount, and it moves no further this phase (though it may otherwise act). */
export function alight(state: GameState, p: Model, uid: () => string, now = Date.now()): Action[] {
  const c = carrierOf(state, p)!;
  const at = alightSpot(state, c, p);
  const roll: DiceRoll = { id: `p-${uid()}`, by: p.owner, label: `${p.name} gets down from ${c.name}'s ${c.mount}`.slice(0, 80), dice: [], model: p.id, at: now, note: `${p.name} moves no further this phase.` };
  return [{ type: 'rolled', roll }, ...parting(p, c, at), { type: 'crossed', id: p.id, stop: true }];
}

/** The Passengers left without a mount to ride: its rider slain, thrown or got down, or the mount slain. */
export const unseated = (state: GameState): Model[] =>
  Object.values(state.models).filter(p => {
    const c = carrierOf(state, p);
    return !!c && !p.dead && (c.dead || !mounted(c));
  });

export const unseatedDue = (state: GameState) => state.flow.started && !state.result && unseated(state).length > 0;

/**
 * A Passenger whose mount or rider falls takes a Thrown Rider test: on a 1 it is knocked flying (a Strength 3 hit, then
 * Prone), on a 2-5 it does nothing more this turn, on a 6 it lands on its feet. It is put down beside the mount.
 */
export function unseat(state: GameState, catalog: Catalog | null | undefined, d6: D6, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const p of unseated(state)) {
    const c = carrierOf(state, p)!;
    const group = `p-${uid()}`;
    const die = d6();
    const what = die === 1 ? 'is knocked flying' : die < 6 ? 'picks itself up, and does nothing more this turn' : 'lands on its feet';
    out.push({ type: 'rolled', roll: { id: `${group}-0`, by: p.owner, label: `Thrown Rider: ${p.name}, a Passenger`.slice(0, 80), dice: [die], model: p.id, at: now, group, note: `${p.name} ${what}.` } });
    out.push(...parting(p, c, alightSpot(state, c, p)));
    if (die < 6) out.push({ type: 'affect', id: p.id, patch: { stunned: state.turn, ...(die === 1 ? { prone: true } : {}) } });
    if (die === 1) {
      const d = modelStats(catalog, p)?.D ?? 4;
      const need = woundNeed(3, d);
      if (need) {
        const dice = [d6()];
        const follow = need.then && dice[0] >= need.target ? [d6()] : undefined;
        const hurt = need.then ? !!follow && follow[0] >= need.then : dice[0] >= need.target;
        out.push({ type: 'rolled', roll: { id: `${group}-1`, by: p.owner, label: `Knocked flying: S3 hit on ${p.name} (${formatNeed(need)})`.slice(0, 80), dice, target: need.target, against: p.id, ...(need.then ? { then: need.then, follow } : {}), at: now, group, note: hurt ? `${p.name} takes a wound.` : `${p.name} shrugs it off.` } });
        if (hurt) out.push({ type: 'wound', id: p.id, count: 1, how: 'other', group: `${group}-1` });
      }
    }
  }
  return out;
}
