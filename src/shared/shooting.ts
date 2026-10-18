// Who may shoot whom, and how hard the shot is: the rules for a Shooting Attack, applied alike by the server, the
// model card and the computer player.
import { modelStats, type Catalog } from './catalog.ts';
import { mounted, mountOf } from './cavalry.ts';
import { CONTACT_SLACK, combats } from './flow.ts';
import { gearOf, sideOf } from './gear.ts';
import { distanceBetween, type Point } from './geometry.ts';
import { phaseHeroics } from './heroics.ts';
import { engaged, limitMove, moveAllowance, moveStart } from './movement.ts';
import { cannotAct, shotNeed } from './powers.ts';
import { missileWeapon, MISSILE_WEAPONS } from './rules.ts';
import { distanceToTerrain, heightOf, obstructions, sightTo, type Obstruction } from './sight.ts';
import { howdahFor } from './warBeasts.ts';
import { cloaked, hasRule, poisonedShot, shotDefence, stalks, stones } from './wargear.ts';
import type { GameState, Model } from './types.ts';

export type Weapon = (typeof MISSILE_WEAPONS)[number];

/** The missile weapon a model carries, from its profile and options. */
export const weaponFor = (catalog: Catalog | null | undefined, m: Model): Weapon | undefined => (howdahArchers(m) ? MISSILE_WEAPONS.find(w => w.name === 'Orc Bow') : missileWeapon(gearOf(catalog, m)));
/** A Great Beast's Howdah full of Orc archers: as many shots as it has Wounds left, at its own Shoot Value, however far the beast moved. */
export const howdahArchers = (m: Model) => (m.beast === 'war' && (m.howdahWounds ?? 0) > 0 ? howdahFor(m.name)?.sv : undefined);
export const isThrowing = (w: Weapon) => /^throwing/i.test(w.name);
const isCrossbow = (w: Weapon) => /crossbow/i.test(w.name);
const isSling = (w: Weapon) => /^sling/i.test(w.name);

/** Cover a shooter can lean on: walls, hedges and crops, and any other low piece it is touching. */
const LOW_COVER = new Set(['wall', 'field']);
const area = (m: Model) => m.base.w * m.base.h;

export interface ShotPlan {
  weapon?: Weapon;
  /** Why the shot can't be taken, as the end of a sentence about the shooter ("is in a fight"); unset if it can. */
  why?: string;
  /** The printed Shoot value and what the shot needs to hit now. */
  printed: number;
  need: number;
  /** It moved in the Move phase, so shoots 1 worse (not for a throw while charging). */
  moved: boolean;
  shots: number;
  dist: number;
  /** What the shot must get past, nearest the shooter first. */
  inWay: Obstruction[];
  /** Shooting into a fight: the shooter's own models in it that a stray shot could hit, nearest first. */
  fight?: string[];
  /** Heroic Accuracy (the hero's own, or a Take Aim within 6"): failed In the Way tests are re-rolled. */
  rerolls: boolean;
  /** The target's Defence against this shot (light armour helps here). */
  d?: number;
  /** Re-rolls 1s to wound (Poisoned Attacks on this weapon), or every miss (Bane of Kings). */
  ones?: boolean;
  bane?: boolean;
}

/** Why a model can't shoot (or throw as it charges) this turn, whatever it aims at; unset if it can. */
export function shooterBlocked(state: GameState, m: Model, weapon: Weapon, charge?: boolean): string | undefined {
  if (!state.flow.started) return undefined;
  const moved = !!state.flow.moved?.includes(m.id);
  if (state.flow.shot?.includes(m.id)) return 'has shot this turn';
  if (m.prone) return 'is Prone';
  if (cannotAct(state, m)) return 'is held and can’t act';
  if (engaged(state, m)) return 'is in a fight';
  // A war beast's Commander is busy steering it.
  if (m.aboard && /commander/i.test(m.name)) return 'commands its war beast, and can’t shoot';
  // A chariot shoots however far it drove, and so do a Great Beast's archers.
  if (howdahArchers(m)) return charge ? 'can only shoot in the Shoot phase' : undefined;
  if (m.beast === 'chariot' || (mounted(m) && mountOf(m)?.chariot)) return charge ? 'can only throw a throwing weapon as it charges' : undefined;
  if (charge) return state.phase === 'move' && isThrowing(weapon) ? undefined : 'can only throw a throwing weapon as it charges';
  if (isCrossbow(weapon) && moved) return 'moved, and a crossbow can’t be shot after moving';
  if (!isThrowing(weapon) && state.flow.farMoved?.includes(m.id)) return 'moved more than half its Move';
  return undefined;
}

/**
 * Plans a shot from `shooter` at `target`. `charge` is a throwing weapon thrown in the Move phase as the model
 * charges. `fallback` is the weapon and Shoot value the player sent, for a model without a profile.
 */
export function planShot(
  state: GameState,
  catalog: Catalog | null | undefined,
  shooter: Model,
  target: Model,
  opts: { charge?: boolean; fallback?: { weapon?: Weapon; shoot?: number } } = {},
): ShotPlan {
  const started = !!state.flow.started;
  // (A chariot shoots on the move without penalty.)
  const archers = howdahArchers(shooter);
  const moved = started && !opts.charge && !!state.flow.moved?.includes(shooter.id) && shooter.beast !== 'chariot' && !archers && !(mounted(shooter) && mountOf(shooter)?.chariot);
  // Thrown stones, for a model that has nothing better and didn't move.
  const rocks = !opts.charge ? stones(catalog, shooter) : undefined;
  const weapon = weaponFor(catalog, shooter) ?? (rocks && !moved ? rocks : undefined) ?? opts.fallback?.weapon;
  const printed = archers ?? modelStats(catalog, shooter)?.Sv ?? opts.fallback?.shoot ?? 4;
  const dist = distanceBetween(shooter, target);
  const plan: ShotPlan = { weapon, printed, need: printed, moved, shots: 1, dist, inWay: [], rerolls: false };
  const no = (why: string) => ({ ...plan, why });
  if (!weapon) return no(rocks ? 'moved, and only throws stones standing still' : 'has no missile weapon');
  if (target.owner === shooter.owner) return no('only shoots at enemies');
  if (target.dead || target.escaped || target.waiting) return no('has nothing there to shoot at');
  const blocked = shooterBlocked(state, shooter, weapon, opts.charge);
  if (blocked) return no(blocked);
  plan.shots = archers ? shooter.howdahWounds! : isSling(weapon) && started && !moved && !opts.charge ? 2 : 1;
  // An Elven cloak makes a model on foot 1 harder to hit.
  plan.need = Math.min(6, shotNeed(state, shooter, target, printed + (moved ? 1 : 0) + (cloaked(catalog, target) ? 1 : 0)));
  if (dist > weapon.range + 0.01) return no(`is out of range (${weapon.range}")`);
  const sight = sightTo(state, shooter, target);
  if (sight === 'hidden') return no('can’t see the target');
  // Stalk Unseen (or an Elven cloak): beyond 6" it can only be picked out in plain view.
  if (sight !== 'clear' && dist > 6 && stalks(catalog, target) && !hasRule(catalog, shooter, 'Fell Sight')) return no('can’t pick out a model stalking unseen beyond 6"');
  plan.d = shotDefence(catalog, target, modelStats(catalog, target)?.D ?? 4);
  if (poisonedShot(catalog, shooter, weapon.name)) plan.ones = true;
  if (hasRule(catalog, shooter, 'Bane of Kings')) plan.bane = true;

  // Shooting over a low wall it touches, or over the shoulder of a friend no bigger than itself (and that friend's wall).
  const others = Object.values(state.models).filter(m => !m.dead && !m.escaped && !m.waiting);
  const shoulders = others.filter(f => f.owner === shooter.owner && f.id !== shooter.id && area(f) <= area(shooter) && distanceBetween(f, shooter) <= CONTACT_SLACK && !engaged(state, f));
  const leanOn = (o: Obstruction) => {
    const t = o.terrain ? state.terrain[o.terrain] : undefined;
    if (!t || !(LOW_COVER.has(t.kind) || (t.kind !== 'wood' && heightOf(t) <= 1))) return false;
    return [shooter, ...shoulders].some(m => distanceToTerrain(m, t) <= CONTACT_SLACK);
  };
  // Those riding a war beast are up on it, never in the way; nor is the beast in the way of a shot at its own riders.
  const onBeast = (id: string) => !!state.models[id]?.aboard || id === target.aboard;
  let inWay = obstructions(state, shooter, target).filter(o => !leanOn(o) && !(o.model && (shoulders.some(f => f.id === o.model) || onBeast(o.model))));

  const fight = engaged(state, target) ? combats(state).find(c => c.p1.includes(target.id) || c.p2.includes(target.id)) : undefined;
  const side = sideOf(catalog, shooter);
  if (side === 'Good') {
    // Good models never risk hitting their own: not past a friend, an enemy fighting a friend, nor into a fight.
    if (fight) return no('is Good, and Good models don’t shoot into a fight');
    const risky = inWay.find(o => o.model && (state.models[o.model].owner === shooter.owner || engaged(state, state.models[o.model])));
    if (risky) return no(state.models[risky.model!].owner === shooter.owner ? 'is Good, and won’t shoot past a friend in the way' : `is Good, and won’t shoot past ${risky.name}, who is fighting a friend`);
  }
  if (fight) {
    // Models in the target's own fight aren't in the way of it; a stray shot hits the nearest friend there instead.
    const members = new Set([...fight.p1, ...fight.p2]);
    inWay = inWay.filter(o => !o.model || !members.has(o.model));
    plan.fight = [...fight[shooter.owner]]
      .map(id => state.models[id])
      .filter(m => m && sightTo(state, shooter, m) !== 'hidden')
      .sort((a, b) => distanceBetween(shooter, a) - distanceBetween(shooter, b))
      .map(m => m.id);
  }
  plan.inWay = inWay;
  plan.rerolls = phaseHeroics(state).some(h => {
    const hero = state.models[h.model];
    return h.action === 'Heroic Accuracy' && hero && !hero.dead && hero.owner === shooter.owner && (hero.id === shooter.id || distanceBetween(hero, shooter) <= 6);
  });
  return plan;
}

/**
 * Where a model throwing as it charges stops to throw: 1" short of its target, if its Move gets it there; where it
 * stands if it set off that close already. Null if it can't get within 1".
 */
export function throwingPoint(state: GameState, m: Model, target: Model): Point | null {
  const start = moveStart(state, m);
  if (distanceBetween({ ...m, ...start }, target) <= 1 + 0.05) return distanceBetween(m, target) <= 1 + 0.05 ? { x: m.x, y: m.y } : null;
  if (distanceBetween(m, target) <= 1 + 0.05) return { x: m.x, y: m.y };
  // Step along the line to the target until the bases are just over 1" apart.
  const dx = target.x - m.x;
  const dy = target.y - m.y;
  const len = Math.hypot(dx, dy) || 1;
  let lo = 0;
  let hi = len;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (distanceBetween({ ...m, x: m.x + (dx / len) * t, y: m.y + (dy / len) * t }, target) > 1.02) lo = t;
    else hi = t;
  }
  const at = { x: m.x + (dx / len) * lo, y: m.y + (dy / len) * lo };
  const reach = limitMove(state, start, at, moveAllowance(state, m) ?? m.move, m.owner, m);
  return Math.hypot(reach.x - at.x, reach.y - at.y) < 1e-3 ? at : null;
}
