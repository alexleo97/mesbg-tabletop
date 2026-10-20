import { invisibleTo } from './ring.ts';
import type { Catalog } from './catalog.ts';
import { distanceBetween } from './geometry.ts';
import { affected, cannotAct, fitsTarget, freeResistDice, isAreaPower, isLinePower, powerInfo, powerTakesEffect, resister } from './powers.ts';
import { sightTo } from './sight.ts';
import { declared } from './heroics.ts';
import { willOfEvil } from './courage.ts';
import type { Action, DiceRoll, GameState, Model, Seat, SpellPending } from './types.ts';

// Magical powers, handled by the game: the caster picks a power, a target and how much Will to spend, the game rolls,
// takes the Will off and, when the power works on an enemy with Will of its own, asks that enemy's player whether to
// resist and with how much. Then the game puts the power's effect into play (see powers.ts).

export interface KnownPower {
  name: string;
  /** Range in inches; 0 for a power the caster uses on itself. */
  range: number;
  /** The casting value: a die this high or higher casts it. */
  cv: number;
}

/** The powers on a model's profile. */
export function powersOf(catalog: Catalog | null, m: Model | undefined): KnownPower[] {
  const unit = m?.profileId ? catalog?.units[m.profileId] : undefined;
  return (unit?.powers ?? []).map(p => ({ name: p.name, range: /self/i.test(p.range) ? 0 : parseFloat(p.range) || 12, cv: parseInt(p.cast, 10) || 4 }));
}

/** Whether a power is aimed at nobody in particular: one on the caster itself, or one that hits every enemy in range. */
export const untargeted = (power: string, range: number) => !isLinePower(power) && (range <= 0 || isAreaPower(power));

/**
 * The models a power can be cast on: the caster itself for a Self power or one that hits everyone in range, otherwise
 * the models in range it can see that the power suits (an enemy Spirit for Banishment, say). Tremor's line can run
 * towards any model.
 */
export function castTargets(state: GameState, caster: Model, range: number, power = '', catalog: Catalog | null = null): Model[] {
  if (untargeted(power, range)) return [caster];
  const reach = isLinePower(power) ? 200 : range;
  return Object.values(state.models)
    // (A siege engine shrugs off every power.)
    .filter(t => t.id !== caster.id && !t.dead && !t.waiting && !t.escaped && !t.siege && distanceBetween(caster, t) <= reach && (isLinePower(power) || sightTo(state, caster, t) !== 'hidden'))
    .filter(t => !power || fitsTarget(state, catalog, caster, power, t))
    // Nobody but the Nine can pick out a model wearing the One Ring.
    .filter(t => !invisibleTo(t, caster))
    .sort((a, b) => Number(a.owner === caster.owner) - Number(b.owner === caster.owner) || distanceBetween(caster, a) - distanceBetween(caster, b));
}

/** Whether a model may cast now: its own side's Move activation, Will left, on its feet and free to act, and no power cast yet this turn. */
export function canCast(state: GameState, m: Model, canActivate: (seat: Seat) => boolean): boolean {
  return state.flow.started && state.phase === 'move' && !m.dead && !m.prone && !cannotAct(state, m) && m.will > 0 && !state.flow.cast?.includes(m.id) && !state.flow.spell && canActivate(m.owner);
}

/** A cast waiting on a decision: the target's player choosing whether to resist, or the caster whether to spend Might. */
export function pendingSpell(state: GameState) {
  const spell = state.flow.spell;
  const roll = spell && state.log.find(r => r.id === spell.roll);
  const caster = spell && state.models[spell.caster];
  const target = spell && state.models[spell.target];
  if (!spell || !roll || !caster || !target) return null;
  const best = Math.max(0, ...roll.dice);
  return { ...spell, rollEntry: roll, caster, target, best, cast: best >= spell.cv };
}

const castLabel = (power: string, cv: number, caster: Model, target: Model) =>
  `Cast ${power} (${cv}+) by ${caster.name}${target.id === caster.id ? '' : ` at ${target.name}`}`;

/** Rolls a cast, and puts its effect into play when nobody can resist it. Null if the model can't cast it now. */
export function rollCast(state: GameState, seat: Seat, a: Extract<Action, { type: 'cast' }>, d6: () => number, uid: () => string, now: number, catalog: Catalog | null = null): Action[] | null {
  const m = state.models[String(a.model)];
  const picked = state.models[String(a.target)];
  if (!m || !picked || m.owner !== seat || m.dead || picked.dead || m.will < 1 || state.flow.spell || state.flow.cast?.includes(m.id)) return null;
  if (state.flow.started && (state.phase !== 'move' || m.prone || cannotAct(state, m))) return null;
  const power = String(a.power ?? '').slice(0, 60);
  const self = /^self/i.test(powerInfo(power)?.range ?? '') && !isLinePower(power);
  // A Self power or one that hits all in range is aimed at the caster; a Tremor's line runs towards the model picked.
  const t = self || isAreaPower(power) ? m : picked;
  if (t.id !== m.id && powerInfo(power) && !fitsTarget(state, catalog, m, power, t)) return null;
  // A power on the caster's profile is cast at its own casting value, and only at a target in its range that the
  // caster can see (so no Will, and no Might after it, goes on a cast that can't reach).
  const known = powersOf(catalog, m);
  const listed = known.find(x => x.name === power);
  if (known.length && !listed) return null;
  if (state.flow.started && listed && !castTargets(state, m, listed.range, power, catalog).some(x => x.id === t.id)) return null;
  const cv = listed?.cv ?? Math.max(1, Math.min(6, Math.round(Number(a.cv)) || 4));
  // A model kept alive by Will of Evil can't spend its last point.
  const spare = willOfEvil(catalog, m) ? m.will - 1 : m.will;
  if (spare < 1) return null;
  // Heroic Channelling: its cast this turn counts as a 6, for one Will point and no roll.
  const channelled = declared(state, m.id, 'Heroic Channelling');
  const n = channelled ? 1 : Math.max(1, Math.min(spare, Math.round(Number(a.will)) || 1));
  const dice = channelled ? [6] : Array.from({ length: n }, d6);
  const best = Math.max(...dice);
  const reach = isLinePower(power) ? Math.ceil(d6() / 2) + 3 : undefined;
  const spell: SpellPending = { roll: `w-${uid()}-0`, caster: m.id, target: t.id, power, cv, ...(reach ? { reach, aim: t.id } : {}) };
  // Of the enemies it would hit, the one with the most dice resists for them all.
  const res = resister(state, catalog, m, affected(state, catalog, spell));
  if (res) spell.target = res.id;
  spell.resistable = !!res;
  // Might can still lift a die that fell short, if the hero has enough of it.
  const liftable = best < cv && m.hero && m.might >= cv - best;
  const note =
    best < cv
      ? liftable
        ? `Short by ${cv - best}: ${m.name} can spend Might to raise a die.`
        : 'The power fails.'
      : res
        ? `Cast on a ${best}. ${res.name} may resist${res.id === t.id ? '' : ' for all it hits'}, needing a ${best} or more.`
        : `${t.id === m.id || t.owner === m.owner ? '' : `${t.name} has no Will to resist. `}The power takes effect.`;
  const roll: DiceRoll = { id: spell.roll, by: seat, label: `${castLabel(power, cv, m, t)}${channelled ? ' (Heroic Channelling)' : ''}`.slice(0, 80), dice, target: cv, model: m.id, aim: t.id, note, at: now };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'spendWill', id: m.id, count: n }];
  if (liftable || (best >= cv && res)) out.push({ type: 'spellPending', spell });
  else if (best >= cv) out.push(...powerTakesEffect(state, catalog, spell, d6, uid, now));
  return out;
}

/**
 * Rolls the target's resistance: the Will its player chose to spend plus any free dice it has. With no dice at all
 * it doesn't resist. Then the power takes effect unless resisted. Null if no cast is waiting on that player.
 */
export function rollResist(state: GameState, seat: Seat, will: number, d6: () => number, uid: () => string, now: number, catalog: Catalog | null = null): Action[] | null {
  const p = pendingSpell(state);
  if (!p || !p.cast || p.ready || p.target.owner !== seat) return null;
  const n = Math.max(0, Math.min(p.target.will, Math.round(Number(will)) || 0));
  const free = freeResistDice(state, catalog, p.target);
  const bought = Array.from({ length: n }, d6);
  const dice = [...bought, ...Array.from({ length: free }, d6)];
  const resisted = dice.some(d => d >= p.best);
  // A hero gets back the Will for each natural 6 it rolls with Will (free dice give nothing back).
  const back = p.target.hero ? bought.filter(d => d === 6).length : 0;
  const roll: DiceRoll = {
    id: `r-${uid()}`,
    by: seat,
    label: `Resist ${p.power} (${p.best}+) by ${p.target.name}${free ? `, ${free} free` : ''}`,
    dice,
    ...(dice.length ? { target: p.best } : {}),
    model: p.target.id,
    note: !dice.length
      ? `${p.target.name} doesn't resist: the power takes effect.`
      : `${resisted ? 'Resisted: the power has no effect.' : 'Not resisted: the power takes effect.'}${back ? ` A 6 gives back ${back} Will.` : ''}`,
    at: now,
  };
  return [
    { type: 'rolled', roll },
    ...(n - back ? [{ type: 'spendWill', id: p.target.id, count: n - back } as Action] : []),
    { type: 'spellPending', spell: null },
    ...(resisted ? [] : powerTakesEffect(state, catalog, state.flow.spell!, d6, uid, now)),
  ];
}

/** A cast that Might lifted and nobody can resist, waiting for the game to put it into play. */
export const spellReady = (state: GameState) => !!state.flow.spell?.ready && !!pendingSpell(state)?.cast;

/** Puts a ready cast's effect into play. */
export function settleSpell(state: GameState, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const p = spellReady(state) && pendingSpell(state);
  return p ? [{ type: 'spellPending', spell: null }, ...powerTakesEffect(state, catalog, state.flow.spell!, d6, uid, now)] : [];
}
