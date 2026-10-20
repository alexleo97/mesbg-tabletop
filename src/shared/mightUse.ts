import type { Catalog } from './catalog.ts';
import { woundsTaken } from './fight.ts';
import { combats } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { heroicInfo, SHOUT_RANGE } from './heroics.ts';
import { powersOf } from './magic.ts';
import { planShot } from './shooting.ts';
import { tierOf } from './warbands.ts';
import type { DiceRoll, GameState, Model } from './types.ts';

// When a hero may spend Might: on a heroic action it can actually use now (in range, in a fight and so on), and on
// one of its own rolls while that roll's result is still to be used. Once the game has acted on a roll (the duel's
// strikes are rolled, the wounds taken, the cast resisted) a point spent on it would be lost for nothing, so the
// reducer refuses it and the dice log offers no +1.

/** Rolls Might can never change: re-rolls for Priority, and the Royal Standard's roll to give a point back. */
const NEVER = /^(Longbeard:|Royal Standard of Rohan:|Mighty Hero:)/;

/** Why the roll's hero can't spend Might on it now, or null if it can. (Will on a Courage test is held to the same.) */
export function mightBlocked(state: GameState, r: DiceRoll): string | null {
  const m = r.model ? state.models[r.model] : undefined;
  if (!m?.hero || m.dead) return 'Only a hero on the table can spend Might on its own dice.';
  if (!r.dice.length || NEVER.test(r.label)) return 'Might can’t change this roll.';
  const group = r.group;
  // A paused shot takes Might only on the roll it paused on.
  if (group?.startsWith('s-') && (state.flow.shotPause?.group !== group || state.log.filter(x => x.group === group).at(-1)?.id !== r.id)) return 'Too late: the shot has gone on.';
  if (group?.startsWith('f-')) {
    // A duel roll counts until its winner strikes; a strike until its wounds are taken.
    if (r.side !== undefined && state.log.some(x => x.group === group && x.against)) return 'Too late: the duel is won and the strikes are rolled.';
    if (r.against && woundsTaken(state.flow.applied, group, r.against)) return 'Too late: the wounds have been taken.';
    // Against Heroic Defence only a natural 6 wounds, so Might can't make one.
    if (r.against && state.flow.heroics.some(h => h.model === r.against && h.action === 'Heroic Defence')) return 'Against Heroic Defence only a natural 6 wounds.';
  }
  // A Fate roll only while its wound is still waiting on it.
  if (/^Fate roll/.test(r.label) && m.fateRoll !== r.id) return 'Too late: the wound has been settled.';
  // A cast only while it waits to be resisted (or to fail); a resist is settled as soon as it is rolled.
  if (/^Cast /.test(r.label) && state.flow.spell?.roll !== r.id) return 'Too late: the power has been settled.';
  if (/^Resist /.test(r.label)) return 'Too late: the power has been settled.';
  return null;
}

/** How far a Heroic Challenge reaches. */
export const CHALLENGE_RANGE = 6;

/** The enemy heroes a hero could challenge: within 6", of its Heroic Tier or higher. */
export function challengeRivals(state: GameState, catalog: Catalog | null | undefined, m: Model): Model[] {
  const unitOf = (x: Model) => (x.profileId ? catalog?.units[x.profileId] : undefined);
  return Object.values(state.models).filter(
    e => e.hero && !e.dead && !e.escaped && !e.waiting && e.owner !== m.owner && distanceBetween(e, m) <= CHALLENGE_RANGE && (!unitOf(e) || !unitOf(m) || tierOf(unitOf(e)) >= tierOf(unitOf(m))),
  );
}

/** Whether a model can shoot at any enemy from where it stands: in range, in sight and free to shoot. */
const hasShot = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  Object.values(state.models).some(e => e.owner !== m.owner && !e.dead && !e.escaped && !e.waiting && !planShot(state, catalog, m, e).why);

/**
 * Why a hero's heroic action would do nothing now, so its Might would be thrown away; null if it can be used.
 * (Whether the hero may call it at all, from its profile, is mayDeclare in heroics.ts.)
 *  - The Fight phase ones are about the hero's own fight, so it must be in one.
 *  - A Heroic Challenge needs an enemy hero within 6" of its tier or higher.
 *  - A Heroic Shoot or Heroic Accuracy needs someone to shoot: the hero, or a friend within 6" it could shout for,
 *    with an enemy in range and sight.
 *  - A Heroic Channelling needs a power to cast and the Will to cast it, this turn. (Its target can still come into
 *    range as the hero moves, so that isn't asked yet.)
 */
export function heroicBlocked(state: GameState, catalog: Catalog | null | undefined, m: Model, action: string): string | null {
  const info = heroicInfo(action);
  if (!info || !state.flow.started) return null;
  if (info.phase === 'fight' && !combats(state).some(c => c.p1.includes(m.id) || c.p2.includes(m.id))) return `${m.name} isn't in a fight.`;
  if (action === 'Heroic Challenge' && !challengeRivals(state, catalog, m).length) return `No enemy hero within ${CHALLENGE_RANGE}" of ${m.name}'s Heroic Tier or higher.`;
  if (action === 'Heroic Shoot' || action === 'Heroic Accuracy') {
    // A hero wearing the One Ring can't shout for its friends.
    const friends = m.ringOn ? [] : Object.values(state.models).filter(f => f.owner === m.owner && f.id !== m.id && !f.dead && !f.escaped && !f.waiting && distanceBetween(f, m) <= SHOUT_RANGE);
    if (![m, ...friends].some(x => hasShot(state, catalog, x))) return `No enemy in range and sight of ${m.name}${m.ringOn ? '' : ` or the friends within ${SHOUT_RANGE}"`}.`;
  }
  if (action === 'Heroic Channelling') {
    if (!powersOf(catalog ?? null, m).length) return `${m.name} has no magical powers.`;
    if (m.will < 1) return `${m.name} has no Will left to cast with.`;
    if (state.flow.cast?.includes(m.id)) return `${m.name} has cast a power this turn.`;
  }
  return null;
}
