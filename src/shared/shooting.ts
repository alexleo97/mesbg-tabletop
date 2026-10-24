import { isMonster } from './monsters.ts';
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
import { distanceToTerrain, heightOf, obstructions, sightTo, swimming, type Obstruction } from './sight.ts';
import { howdahFor } from './warBeasts.ts';
import { acrossCable, engineBlocked, engineCantHit, firingCrew, siegeWeapon } from './siege.ts';
import { cloaked, hasRule, poisonedShot, shotDefence, stalks, stones } from './wargear.ts';
import { invisibleTo } from './ring.ts';
import { bilboStones } from './unseen.ts';
import { isSentry } from './lake.ts';
import { deadlyShot, finalCount, luckyShot, shotsPerPhase, shotsTaken, steadyOnTheMove, unsteady } from './towers.ts';
import type { GameState, Model } from './types.ts';

export type Weapon = (typeof MISSILE_WEAPONS)[number];

/** The missile weapon a model carries, from its profile and options. */
export const weaponFor = (catalog: Catalog | null | undefined, m: Model): Weapon | undefined =>
  m.siege ? siegeWeapon(catalog, m) : howdahArchers(m) ? MISSILE_WEAPONS.find(w => w.name === 'Orc Bow') : (missileWeapon(gearOf(catalog, m)) ?? (hasRule(catalog, m, 'Spider Webs') ? SPIDER_WEBS : undefined));
/** A Mirkwood Giant Spider's webs: a throwing weapon whose hit Paralyses rather than wounds (see resolveShot). */
export const SPIDER_WEBS: Weapon = { name: 'Throwing webs', range: 8, s: 1 };
export const isWebs = (w: Weapon | undefined) => w?.name === SPIDER_WEBS.name;
/** A Great Beast's Howdah full of Orc archers: as many shots as it has Wounds left, at its own Shoot Value, however far the beast moved. */
export const howdahArchers = (m: Model) => (m.beast === 'war' && (m.howdahWounds ?? 0) > 0 ? howdahFor(m.name)?.sv : undefined);
export const isThrowing = (w: Weapon) => /^throwing|brand/i.test(w.name);
/** The Goblin King's Goblin Projectile: a Goblin he is touching, hurled 12" like a throwing weapon, at Strength 8. */
export const GOBLIN_PROJECTILE: Weapon = { name: 'Throwing Goblin', range: 12, s: 8 };
export const isGoblinThrow = (w: Weapon | undefined) => w?.name === GOBLIN_PROJECTILE.name;
/**
 * The Goblin a model with Goblin Projectile could throw now: a friend it is touching, neither of them in a fight, in
 * the Shoot phase (a warrior before a hero).
 */
export function goblinAmmo(state: GameState, catalog: Catalog | null | undefined, m: Model): Model | undefined {
  if (!hasRule(catalog, m, 'Goblin Projectile') || (state.flow.started && state.phase !== 'shoot') || engaged(state, m)) return undefined;
  return Object.values(state.models)
    .filter(g => g.id !== m.id && g.owner === m.owner && !g.dead && !g.waiting && !g.escaped && !g.aboard && !!g.ground?.includes('goblin') && !engaged(state, g) && distanceBetween(m, g) <= CONTACT_SLACK)
    .sort((a, b) => Number(!!a.hero) - Number(!!b.hero) || distanceBetween(m, a) - distanceBetween(m, b))[0];
}
/** Aragorn's flaming brand, thrown once (Weathertop): a throwing weapon whose hit Sets the target Ablaze, with no roll To Wound. */
export const FLAMING_BRAND: Weapon = { name: 'Flaming Brand', range: 6, s: 3 };
/** Whether a model may still throw its flaming brand. */
export const canThrowBrand = (m: Model) => !!m.brand && m.cast === 'aragorn';
const isCrossbow = (w: Weapon) => /crossbow/i.test(w.name);
const isSling = (w: Weapon) => /^sling/i.test(w.name);
const isBow = (w: Weapon) => /bow/i.test(w.name) && !isCrossbow(w);

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
  /** Added to its rolls To Wound (Legolas behind in his count with Gimli). */
  woundBonus?: number;
  /** Aldor's Lucky Shot: misses to hit are re-rolled (and to wound, as `bane`). */
  lucky?: boolean;
  /** Legolas's Pinpoint Shot: one shot that may pick out an enemy in a fight with a friend and hits it with nothing in the way. */
  pinpoint?: boolean;
}

/**
 * Plans a siege engine's shot: its crew's Shoot value (1 worse if it was turned this turn), its range and Arc of
 * Sight, and, for a Direct Shot, what's in the way. Where it actually lands is rolled as it shoots (see siege.ts).
 */
function planEngineShot(state: GameState, catalog: Catalog | null | undefined, engine: Model, target: Model): ShotPlan {
  const weapon = siegeWeapon(catalog, engine);
  const crew = firingCrew(state, catalog, engine);
  const turned = !!state.flow.turned?.includes(engine.id);
  const printed = crew?.sv ?? 6;
  const dist = distanceBetween(engine, target);
  const plan: ShotPlan = { weapon, printed, need: Math.min(6, printed + (turned ? 1 : 0)), moved: turned, shots: 1, dist, inWay: [], rerolls: false };
  const no = (why: string) => ({ ...plan, why });
  if (!weapon) return no('has no profile');
  if (target.owner === engine.owner) return no('only shoots at enemies');
  if (target.dead || target.escaped || target.waiting) return no('has nothing there to shoot at');
  if (state.flow.started && state.flow.shot?.includes(engine.id)) return no('has shot this turn');
  const blocked = state.flow.started ? engineBlocked(state, catalog, engine) : undefined;
  if (blocked) return no(blocked);
  if (dist > weapon.range + 0.01) return no(`is out of range (${weapon.range}")`);
  const cant = engineCantHit(state, catalog, engine, target);
  if (cant) return no(cant);
  plan.d = modelStats(catalog, target)?.D ?? 4;
  if (!hasRule(catalog, engine, 'Arcing Shot')) plan.inWay = obstructions(state, engine, target).filter(o => !(o.model && state.models[o.model]?.aboard));
  if (sideOf(catalog, engine) === 'Good') {
    if (engaged(state, target)) return no('is Good, and Good models don’t shoot into a fight');
    if (plan.inWay.some(o => o.model && state.models[o.model].owner === engine.owner)) return no('is Good, and won’t shoot past a friend in the way');
  }
  return plan;
}

/** Why a model can't shoot (or throw as it charges) this turn, whatever it aims at; unset if it can. */
export function shooterBlocked(state: GameState, m: Model, weapon: Weapon, charge?: boolean, catalog?: Catalog | null): string | undefined {
  if (!state.flow.started) return undefined;
  const moved = !!state.flow.moved?.includes(m.id);
  // (Legolas and Haldir make more than one Shooting Attack, in the Shoot phase.)
  if (shotsTaken(state, m) >= (charge || m.siege ? 1 : shotsPerPhase(catalog, m))) return 'has shot this turn';
  if (m.prone) return 'is Prone';
  if (cannotAct(state, m)) return 'is held and can’t act';
  // Nobody shoots while swimming.
  if (swimming(state, m)) return 'is in deep water';
  // A Sentry doesn't know the enemy is there.
  if (isSentry(state, m)) return 'is a Sentry, and doesn’t know the enemy is there';
  // Legolas shoots even in a fight (Deadly Shot), on foot or mounted.
  if (engaged(state, m) && !(deadlyShot(catalog, m) && !charge && isBow(weapon))) return 'is in a fight';
  // A siege engine shoots only if it stayed put, with enough crew beside it and no enemy.
  if (m.siege) return charge ? 'can only shoot in the Shoot phase' : engineBlocked(state, null, m);
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
  opts: { charge?: boolean; brand?: boolean; pinpoint?: boolean; fallback?: { weapon?: Weapon; shoot?: number } } = {},
): ShotPlan {
  const started = !!state.flow.started;
  if (shooter.siege) return planEngineShot(state, catalog, shooter, target);
  // (A chariot shoots on the move without penalty.)
  const archers = howdahArchers(shooter);
  // (Nor does Legolas on foot: Deadly Shot.)
  const moved = started && !opts.charge && !!state.flow.moved?.includes(shooter.id) && shooter.beast !== 'chariot' && !archers && !(mounted(shooter) && mountOf(shooter)?.chariot) && !steadyOnTheMove(catalog, shooter);
  // Thrown stones, for a model that has nothing better and didn't move.
  const rocks = !opts.charge ? stones(catalog, shooter) : undefined;
  // (The Unseen Hero: Bilbo's stones are a throwing weapon, thrown however far he moved, or as he charges.)
  const weapon = opts.brand ? (canThrowBrand(shooter) ? FLAMING_BRAND : undefined) : (weaponFor(catalog, shooter) ?? bilboStones(state, shooter) ?? (!opts.charge && goblinAmmo(state, catalog, shooter) ? GOBLIN_PROJECTILE : undefined) ?? (rocks && !moved ? rocks : undefined) ?? opts.fallback?.weapon);
  const printed = archers ?? modelStats(catalog, shooter)?.Sv ?? opts.fallback?.shoot ?? 4;
  const dist = distanceBetween(shooter, target);
  const plan: ShotPlan = { weapon, printed, need: printed, moved, shots: 1, dist, inWay: [], rerolls: false };
  const no = (why: string) => ({ ...plan, why });
  if (!weapon) return no(opts.brand ? 'has no flaming brand left to throw' : rocks ? 'moved, and only throws stones standing still' : 'has no missile weapon');
  if (target.owner === shooter.owner) return no('only shoots at enemies');
  if (target.dead || target.escaped || target.waiting) return no('has nothing there to shoot at');
  if (invisibleTo(target, shooter)) return no('can’t see a model wearing the One Ring');
  const blocked = shooterBlocked(state, shooter, weapon, opts.charge, catalog);
  if (blocked) return no(blocked);
  // Aldor's Unsteady Nerves: his side's other models wait until he has shot (or can't).
  if (started && state.phase === 'shoot' && !opts.charge && aldorFirst(state, catalog, shooter)) return no(`waits for ${aldorFirst(state, catalog, shooter)!.name} to shoot first (Unsteady Nerves)`);
  const pinpoint = !!opts.pinpoint && hasRule(catalog, shooter, 'Pinpoint Shot');
  if (opts.pinpoint && !pinpoint) return no('can’t make a Pinpoint Shot');
  if (pinpoint && shotsTaken(state, shooter) > 0) return no('has already shot this phase, so can’t make a Pinpoint Shot');
  plan.shots = archers ? shooter.howdahWounds! : isSling(weapon) && started && !moved && !opts.charge ? 2 : 1;
  // An Elven cloak makes a model on foot 1 harder to hit.
  plan.need = Math.min(6, shotNeed(state, shooter, target, printed + (moved ? 1 : 0) + (cloaked(catalog, target) ? 1 : 0)));
  if (dist > weapon.range + 0.01) return no(`is out of range (${weapon.range}")`);
  // An Iron Hills Ballista's line stops anything but the heaviest shots crossing it.
  if (weapon.s <= 6 && acrossCable(state, shooter, target)) return no('would have to shoot across an Iron Hills Ballista’s line');
  const sight = sightTo(state, shooter, target);
  if (sight === 'hidden') return no('can’t see the target');
  // Stalk Unseen (or an Elven cloak): beyond 6" it can only be picked out in plain view.
  if (sight !== 'clear' && dist > 6 && stalks(catalog, target) && !hasRule(catalog, shooter, 'Fell Sight')) return no('can’t pick out a model stalking unseen beyond 6"');
  plan.d = shotDefence(catalog, target, modelStats(catalog, target)?.D ?? 4);
  if (poisonedShot(catalog, shooter, weapon.name)) plan.ones = true;
  if (hasRule(catalog, shooter, 'Bane of Kings')) plan.bane = true;
  if (finalCount(state, catalog, shooter)) plan.woundBonus = 1;
  if (luckyShot(catalog, shooter)) plan.lucky = plan.bane = true;

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
  // A Large Target stands over everything but monsters, war beasts and siege engines.
  if (hasRule(catalog, target, 'Large Target')) inWay = inWay.filter(o => !o.model || isMonster(catalog, state.models[o.model]) || state.models[o.model].beast === 'war' || !!state.models[o.model].siege);

  const fight = engaged(state, target) ? combats(state).find(c => c.p1.includes(target.id) || c.p2.includes(target.id)) : undefined;
  // Legolas shooting a foe he is fighting himself, or making a Pinpoint Shot at one fighting a friend: nothing is in
  // the way, and no stray shot can hit his friends.
  const own = !!fight && deadlyShot(catalog, shooter) && fight[shooter.owner].includes(shooter.id);
  if (pinpoint && !fight) return no('only makes a Pinpoint Shot at an enemy in a fight with a friend');
  if (pinpoint || own) {
    plan.inWay = [];
    if (pinpoint) Object.assign(plan, { pinpoint: true, shots: 1 });
    plan.rerolls = false;
    return plan;
  }
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
    return h.action === 'Heroic Accuracy' && hero && !hero.dead && hero.owner === shooter.owner && (hero.id === shooter.id || (!hero.ringOn && distanceBetween(hero, shooter) <= 6));
  });
  return plan;
}

/** Plans worked out for Aldor's Unsteady Nerves, per game state, so asking again for every shot costs nothing. */
const aldorCache = new WeakMap<GameState, Map<string, Model | null>>();

/**
 * Aldor's Unsteady Nerves: the friend who must shoot before `shooter` may, if one must. That is an Aldor on its side
 * that hasn't shot this phase and could shoot at some enemy now.
 */
export function aldorFirst(state: GameState, catalog: Catalog | null | undefined, shooter: Model): Model | null {
  if (!catalog || unsteady(catalog, shooter)) return null;
  let seen = aldorCache.get(state);
  if (!seen) aldorCache.set(state, (seen = new Map()));
  if (seen.has(shooter.owner)) return seen.get(shooter.owner)!;
  const aldor = Object.values(state.models).find(m => m.owner === shooter.owner && !m.dead && !m.escaped && !m.waiting && unsteady(catalog, m) && !shotsTaken(state, m));
  const ready = aldor && Object.values(state.models).some(e => e.owner !== aldor.owner && !e.dead && !e.escaped && !e.waiting && !planShot(state, catalog, aldor, e).why) ? aldor : null;
  seen.set(shooter.owner, ready);
  return ready;
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
