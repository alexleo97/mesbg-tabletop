import type { Catalog } from './catalog.ts';
import { distanceBetween } from './geometry.ts';
import { sightTo } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Magical powers, handled by the game: the caster picks a power, a target and how much Will to spend, the game rolls,
// takes the Will off and, when the power works on an enemy with Will of its own, asks that enemy's player whether to
// resist and with how much. What each power then does is left to the players (the power's text is shown).

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

/** The models a power can be cast on: the caster itself for a Self power, otherwise any model in range that it can see. */
export function castTargets(state: GameState, caster: Model, range: number): Model[] {
  if (range <= 0) return [caster];
  return Object.values(state.models)
    .filter(t => t.id !== caster.id && !t.dead && !t.waiting && !t.escaped && distanceBetween(caster, t) <= range && sightTo(state, caster, t) !== 'hidden')
    .sort((a, b) => Number(a.owner === caster.owner) - Number(b.owner === caster.owner) || distanceBetween(caster, a) - distanceBetween(caster, b));
}

/** Whether a model may cast now: its own side's Move activation, Will left, and no power cast yet this turn. */
export function canCast(state: GameState, m: Model, canActivate: (seat: Seat) => boolean): boolean {
  return state.flow.started && state.phase === 'move' && !m.dead && m.will > 0 && !state.flow.cast?.includes(m.id) && !state.flow.spell && canActivate(m.owner);
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

/** Rolls a cast. Null if the model can't cast it now. */
export function rollCast(state: GameState, seat: Seat, a: Extract<Action, { type: 'cast' }>, d6: () => number, uid: () => string, now: number): Action[] | null {
  const m = state.models[String(a.model)];
  const t = state.models[String(a.target)];
  if (!m || !t || m.owner !== seat || m.dead || t.dead || m.will < 1 || state.flow.spell || state.flow.cast?.includes(m.id)) return null;
  if (state.flow.started && state.phase !== 'move') return null;
  const power = String(a.power ?? '').slice(0, 60);
  const cv = Math.max(1, Math.min(6, Math.round(Number(a.cv)) || 4));
  const n = Math.max(1, Math.min(m.will, Math.round(Number(a.will)) || 1));
  const dice = Array.from({ length: n }, d6);
  const best = Math.max(...dice);
  const enemy = t.owner !== m.owner;
  // Might can still lift a die that fell short, if the hero has enough of it.
  const liftable = best < cv && m.hero && m.might >= cv - best;
  const resistable = enemy && t.will > 0;
  const note =
    best < cv
      ? liftable
        ? `Short by ${cv - best}: ${m.name} can spend Might to raise a die.`
        : 'The power fails.'
      : resistable
        ? `Cast on a ${best}. ${t.name} may resist with Will, needing a ${best} or more.`
        : `${t.id === m.id ? '' : enemy ? `${t.name} has no Will to resist. ` : ''}The power takes effect.`;
  const roll: DiceRoll = { id: `w-${uid()}-0`, by: seat, label: castLabel(power, cv, m, t), dice, target: cv, model: m.id, aim: t.id, note, at: now };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'spendWill', id: m.id, count: n }];
  if (liftable || (best >= cv && resistable)) out.push({ type: 'spellPending', spell: { roll: roll.id, caster: m.id, target: t.id, power, cv } });
  return out;
}

/** Rolls the target's resistance (or none, when it chooses not to resist). Null if no cast is waiting on that player. */
export function rollResist(state: GameState, seat: Seat, will: number, d6: () => number, uid: () => string, now: number): Action[] | null {
  const p = pendingSpell(state);
  if (!p || !p.cast || p.target.owner !== seat) return null;
  const n = Math.max(0, Math.min(p.target.will, Math.round(Number(will)) || 0));
  const dice = Array.from({ length: n }, d6);
  const resisted = dice.some(d => d >= p.best);
  // A hero gets back the Will for each natural 6 it rolls to resist.
  const back = p.target.hero ? dice.filter(d => d === 6).length : 0;
  const roll: DiceRoll = {
    id: `r-${uid()}`,
    by: seat,
    label: `Resist ${p.power} (${p.best}+) by ${p.target.name}`,
    dice,
    ...(n ? { target: p.best } : {}),
    model: p.target.id,
    note: !n
      ? `${p.target.name} doesn't resist: the power takes effect.`
      : `${resisted ? 'Resisted: the power has no effect.' : 'Not resisted: the power takes effect.'}${back ? ` A 6 gives back ${back} Will.` : ''}`,
    at: now,
  };
  return [{ type: 'rolled', roll }, ...(n - back ? [{ type: 'spendWill', id: p.target.id, count: n - back } as Action] : []), { type: 'spellPending', spell: null }];
}
