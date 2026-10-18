// Weapons, armour, equipment and the common special rules: what they do to a model's fights, shots, Courage and
// movement, worked out from its profile so the server, the fight card and the computer player all agree.
import { fromMarker, onTable } from './objects.ts';
import { modelStats, type Catalog } from './catalog.ts';
import type { Fighter } from './fight.ts';
import { gearOf, hasGear } from './gear.ts';
import { distanceBetween } from './geometry.ts';
import { duelLeader, duelSettled } from './fight.ts';
import { sightTo } from './sight.ts';
import { declared } from './heroics.ts';
import { hasKeyword, isCavalry } from './powers.ts';
import { mountLabel, mountOf } from './cavalry.ts';
import { isMonster } from './monsters.ts';
import type { DiceRoll, GameState, Model, Seat } from './types.ts';

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);

/** Whether a model's profile has a special rule (by its name, with or without a bracketed value). */
export const hasRule = (catalog: Catalog | null | undefined, m: Model, name: string) => !!unitOf(catalog, m)?.rules.some(r => r === name || r.startsWith(`${name} `) || r.startsWith(`${name}(`));

/** The bracketed values of a rule a model has, such as ["Man"] for Hatred (Man). */
export const ruleArgs = (catalog: Catalog | null | undefined, m: Model, name: string) =>
  (unitOf(catalog, m)?.rules ?? []).filter(r => r.startsWith(`${name} (`) || r.startsWith(`${name}(`)).map(r => r.slice(r.indexOf('(') + 1, r.lastIndexOf(')')).trim());

// Our data has no keywords, so the kinds rules name (Elf, Dwarf, Orc, Man and so on) are told from the model's name,
// army and the realm it comes from.
const HOBBIT = /hobbit|baggins|bilbo|frodo|samwise|\bsam\b|merry|meriadoc|pippin|peregrin|took|brandybuck|gamgee|cotton|maggot|bolger|lobelia|paladin|bounder|shirriff|shire/i;
const ELF = /\belf\b|\belves\b|elven|galadhrim|rivendell|mirkwood|lothl[oó]rien|legolas|elrond|arwen|glorfindel|galadriel|celeborn|haldir|thranduil|tauriel|gil-galad|c[ií]rdan|elladan|elrohir|lindir|erestor|r[uú]mil|orophin|palace guard|sentinel|high elf/i;
const DWARF = /dwar(f|ves|ven)|khazad|iron guard|iron hills|erebor|grim hammer|vault warden|gimli|balin|dwalin|thorin|dain|d[aá]in|thr[oó]r|thr[aá]in|fili|kili|oin|gloin|bifur|bofur|bombur|dori|nori|\bori\b|murin|drar|mardin|durin/i;
const ORC = /\borcs?\b|uruk|goblin|gorbag|shagrat|grishnakh|ugluk|lurtz|mauhur|gothmog|azog|bolg|gundabad|morannon|black gate|warg rider/i;
const GOBLIN = /goblin|moria|great goblin|grinnah|druzhag|gollum/i;
const MAN_NOT = /troll|ent\b|treebeard|eagle|beorn|wolf|warg|spider|bat|crebain|dragon|smaug|balrog|fell beast|m[uû]mak|spirit|wraith|nazg|witch-king|kham[uû]l|wight|of the dead|wizard|gandalf|saruman|radagast|sauron|gollum|tom bombadil|goldberry|great beast|bear|giant|oliphaunt|horror|watcher|shade|castellan|necromancer/i;
const REALM: Record<string, RegExp> = {
  rohan: /rohan|edoras|riders of|th[eé]oden|[eé]omer|[eé]owyn|helm|rohirrim|gamling|hama|erkenbrand|grimbold|elfhelm|dernhelm|westfold|dunharrow/i,
  mordor: /mordor|barad|minas morgul|morgul|cirith ungol|black gate|gothmog|great eye|legions/i,
  angmar: /angmar|carn d[uû]m|witch-king|shadows of angmar|wolf pack/i,
  gundabad: /gundabad|b[uû]hrdur/i,
  dunland: /dunland|dunlending/i,
  dragon: /dragon|smaug/i,
  'uruk-hai': /uruk/i,
};

/** Whether a model counts as the kind a rule names, such as Hatred (Orc) or Ancient Enemies (Elf). */
export function isKind(catalog: Catalog | null | undefined, m: Model, kind: string): boolean {
  const unit = unitOf(catalog, m);
  const name = `${unit?.name ?? ''} ${m.name}`;
  const realm = `${name} ${unit?.army ?? ''} ${unit?.origin ?? ''}`;
  const k = kind.toLowerCase().replace(/s$/, '');
  if (k === 'hobbit') return HOBBIT.test(name) || /the shire|bywater/i.test(unit?.army ?? '');
  if (k === 'elf') return !HOBBIT.test(name) && !/gandalf/i.test(name) && (ELF.test(name) || unit?.origin === 'Elven Kingdoms');
  if (k === 'dwarf') return !HOBBIT.test(name) && !/gandalf/i.test(name) && (DWARF.test(name) || unit?.origin === 'Dwarven Holds');
  if (k === 'orc') return ORC.test(name);
  if (k === 'goblin') return GOBLIN.test(realm) && ORC.test(`${name} goblin`) && !/troll|spider|bat|warg/i.test(name);
  if (k === 'man') return !HOBBIT.test(name) && !ELF.test(name) && !DWARF.test(name) && !ORC.test(name) && !MAN_NOT.test(name) && unit?.origin !== 'Elven Kingdoms' && unit?.origin !== 'Dwarven Holds';
  if (REALM[k]) return REALM[k].test(realm);
  return hasKeyword(catalog ?? null, m, kind);
}

// ——— What a model carries ———

const TWO_HANDED = /two-handed|two handed|great ?axe|mattock|halberd|war ?hammer|great ?sword|\bmaul\b|scythe/;
const HAND_AND_A_HALF = /hand-and-a-half|hand and a half/;
/** Melee weapons other than two-handed ones: anything that isn't missile, armour or equipment. */
const MELEE = /weapon|sword|blade|axe|spear|pike|dagger|knife|club|mace|hammer|whip|lance|staff|claws?|fangs?|teeth|beak|tusks?|glaive|flail|cleaver|scimitar|sting|glamdring|orcrist|and[uú]ril|herugrim|guthwin[eë]|narsil|grond|hand weapons?/;
const NOT_MELEE = /\bbow\b|bows\b|crossbow|throwing|sling|blowpipe|javelin|armour|amour|shield|cloak|war horn|banner|drum|ring\b|horse|warg\b|pony|goat|steed|camel|mount|chariot/;

const melee = (catalog: Catalog | null | undefined, m: Model) => gearOf(catalog, m).filter(g => (MELEE.test(g) || TWO_HANDED.test(g) || HAND_AND_A_HALF.test(g)) && !NOT_MELEE.test(g.replace(/two-handed|hand weapons?/g, '')));

/** How a model can fight with its weapons: whether it must, or may, wield a two-handed weapon. */
export function twoHandedChoice(catalog: Catalog | null | undefined, m: Model): 'must' | 'may' | 'no' {
  const weapons = melee(catalog, m);
  const big = weapons.filter(g => TWO_HANDED.test(g));
  const other = weapons.filter(g => !TWO_HANDED.test(g));
  if (big.length && !other.length) return 'must';
  if (big.length || other.some(g => HAND_AND_A_HALF.test(g))) return 'may';
  return 'no';
}

export const hasShield = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bshields?\b/);
const heavyShield = (catalog: Catalog | null | undefined, m: Model) => gearOf(catalog, m).some(g => /\bshields?\b/.test(g) && !/light shield/.test(g));
export const isUnarmed = (catalog: Catalog | null | undefined, m: Model) => gearOf(catalog, m).some(g => g === 'unarmed') || (m.lostGear?.length ? !melee(catalog, m).length : false);
export const carriesBanner = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bbanner\b/);
const missile = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bbows?\b|crossbow|sling|blowpipe/);

/** Why a model can't use Shielding in a fight, or null if it can: it needs a shield and must be on foot. */
export function cantShield(catalog: Catalog | null | undefined, m: Model): string | null {
  if (!hasShield(catalog, m)) return 'has no shield';
  if (isCavalry(catalog ?? null, m)) return 'is mounted';
  if (twoHandedChoice(catalog, m) === 'must') return 'needs both hands for its weapon';
  return null;
}

/** Shieldwall: a model with a shield touching two or more friends with Shieldwall and shields gets +1 Defence. */
export function inShieldwall(state: GameState, catalog: Catalog | null | undefined, m: Model): boolean {
  if (!hasRule(catalog, m, 'Shieldwall') || !heavyShield(catalog, m) || m.prone || isCavalry(catalog ?? null, m)) return false;
  const near = Object.values(state.models).filter(f => f.id !== m.id && f.owner === m.owner && !f.dead && !f.prone && distanceBetween(f, m) <= 0.1 && hasRule(catalog, f, 'Shieldwall') && heavyShield(catalog, f));
  return near.length >= 2;
}

/** Choices a player makes for a model at the start of a fight. */
export interface FightChoice {
  /** Shielding: twice the Attacks, but no strikes. */
  shielding?: boolean;
  /** Fighting with a hand-and-a-half weapon (or a spare two-handed one) in both hands. */
  twoHanded?: boolean;
}

/**
 * A model as it fights: its profile with options, its heroic actions, and what its weapons, armour, equipment and
 * special rules do, given the choices its player made. Powers are added on top later (see resolve.adjustFight).
 */
export function fighterOf(state: GameState, catalog: Catalog | null | undefined, m: Model, choice: FightChoice = {}): Fighter {
  const st = modelStats(catalog, m);
  const strength = st?.S ?? 3;
  const f: Fighter = {
    id: m.id,
    name: m.name,
    f: st?.Fv ?? 3,
    a: st?.A ?? 1,
    s: declared(state, m.id, 'Heroic Strength') ? Math.min(10, strength * 2) : strength,
    d: st?.D ?? 4,
    ...(declared(state, m.id, 'Heroic Strike') ? { strike: true } : {}),
    ...(declared(state, m.id, 'Heroic Defence') ? { defence: true } : {}),
  };
  if (!st) return f;
  const notes: string[] = [];
  // A rider fights with its mount's Fight, Strength and Attacks where they're better, and either can be struck.
  const mount = mountOf(m);
  if (mount) {
    const label = mountLabel(mount.name);
    // A hero's chariot adds its Attacks to the hero's.
    const better = [mount.f > f.f && 'F', mount.s > strength && 'S', mount.chariot ? mount.a > 0 && `+${mount.a} A` : mount.a > f.a && 'A'].filter(Boolean);
    f.f = Math.max(f.f, mount.f);
    f.a = mount.chariot ? Math.min(10, f.a + mount.a) : Math.max(f.a, mount.a);
    if (mount.s > strength) f.s = declared(state, m.id, 'Heroic Strength') ? Math.min(10, mount.s * 2) : mount.s;
    if (better.length) notes.push(`${label}: its ${better.join(', ')}`);
    if (mount.left > 0) f.mount = { name: label, d: mount.d, s: mount.s, ...(mount.chariot ? { chariot: true } : {}) };
  }
  if (isMonster(catalog, m)) f.monster = true;
  // A hero's Fate might yet save it, so only a model without Fate is known to be slain by its last wound.
  if (!(m.hero && m.fate > 0)) f.left = m.wounds;
  let duel = 0;
  let wound = 0;
  const two = twoHandedChoice(catalog, m);
  const shielding = !!choice.shielding && !cantShield(catalog, m);
  const twoHanded = !shielding && (two === 'must' || (two === 'may' && !!choice.twoHanded));
  if (shielding) {
    f.shielding = true;
    f.a = Math.min(10, f.a * 2);
    f.noStrike = 'Shielding';
    notes.push('Shielding: double Attacks, no strikes');
  } else if (twoHanded) {
    // A shield is no help to a model using both hands on its weapon.
    if (two === 'may' && heavyShield(catalog, m)) f.d = Math.max(1, f.d - 1);
    if (!hasRule(catalog, m, 'Burly')) {
      duel--;
      f.sixSafe = true;
    }
    wound++;
    f.twoHanded = true;
    notes.push(hasRule(catalog, m, 'Burly') ? 'Two-handed: +1 to wound (Burly: no duel penalty)' : 'Two-handed: -1 duel (not on a 6), +1 to wound');
  }
  if (hasGear(catalog, m, /\bpikes?\b/) && (hasShield(catalog, m) || missile(catalog, m))) {
    duel--;
    notes.push('Pike with a shield or bow: -1 duel');
  }
  if (carriesBanner(catalog, m)) {
    duel--;
    notes.push('Banner: -1 duel');
  }
  if (isUnarmed(catalog, m)) {
    duel--;
    wound--;
    notes.push('Unarmed: -1 duel, -1 to wound');
  }
  if (duel) f.duelMod = duel;
  if (wound) f.woundMod = wound;
  if (inShieldwall(state, catalog, m)) {
    f.d = Math.min(10, f.d + 1);
    notes.push('Shieldwall: +1 Defence');
  }
  if (!shielding) {
    const poison = ruleArgs(catalog, m, 'Poisoned Attacks');
    if ((hasRule(catalog, m, 'Poisoned Attacks') && !poison.length) || poison.some(w => !/bow|blowpipe|sling|throwing/i.test(w))) f.ones = true;
    if (hasRule(catalog, m, 'Bane of Kings')) f.reroll = true;
    if (hasRule(catalog, m, 'Mighty Blow')) f.mighty = true;
    if (hasRule(catalog, m, 'Backstabbers')) f.backstab = true;
    if (hasRule(catalog, m, 'Blades of the Dead')) f.blades = true;
    const hates = ruleArgs(catalog, m, 'Hatred');
    if (hates.length) f.hates = hates;
    const ancient = ruleArgs(catalog, m, 'Ancient Enemies');
    if (ancient.length) f.ancient = ancient;
  }
  if (st.C !== undefined) f.c = st.C;
  if (notes.length) f.notes = notes;
  return f;
}

/**
 * What one fighter's strikes need against another, after the rules that depend on who is struck: Hatred, Ancient
 * Enemies and Blades of the Dead. Returns the Defence to roll against and the bonus to wound.
 */
export function strikeAgainst(catalog: Catalog | null | undefined, state: GameState, f: Fighter, t: Fighter): { d: number; wound: number; ones: boolean } {
  const victim = state.models[t.id];
  const kind = (k: string) => !!victim && isKind(catalog, victim, k);
  const d = f.blades && t.c !== undefined ? Math.max(1, Math.min(10, 10 - t.c)) : t.d;
  return { d, wound: (f.woundMod ?? 0) + (f.hates?.some(kind) ? 1 : 0), ones: !!f.ones || !!f.ancient?.some(kind) };
}

// ——— Shooting ———

/** Poisoned shots: Poisoned Attacks tied to the weapon being shot (or with no weapon named). */
export function poisonedShot(catalog: Catalog | null | undefined, m: Model, weapon: string): boolean {
  if (!hasRule(catalog, m, 'Poisoned Attacks')) return false;
  const named = ruleArgs(catalog, m, 'Poisoned Attacks');
  return !named.length || named.some(w => weapon.toLowerCase().includes(w.toLowerCase().replace(/s$/, '')) || (/bow/i.test(w) && /bow/i.test(weapon)));
}

/** A target's Defence against shots: light armour helps only here. */
export const shotDefence = (catalog: Catalog | null | undefined, m: Model, d: number) => Math.min(10, d + (hasGear(catalog, m, /light armour/) ? 1 : 0));

/** Hard to hit: an Elven cloak on a model on foot makes shots at it 1 harder. */
export const cloaked = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /elven cloak|elven cloaks/) && !isCavalry(catalog ?? null, m);

/** Can't be seen from further than 6" unless in plain view: Stalk Unseen, or an Elven cloak. */
export const stalks = (catalog: Catalog | null | undefined, m: Model) => (hasRule(catalog, m, 'Stalk Unseen') || hasGear(catalog, m, /elven cloak/)) && !isCavalry(catalog ?? null, m);

/** Throw Stones: the range and Strength of a model's thrown stones, if it has them. */
export function stones(catalog: Catalog | null | undefined, m: Model): { name: string; range: number; s: number } | undefined {
  const arg = ruleArgs(catalog, m, 'Throw Stones')[0];
  if (!arg) return undefined;
  const range = Number(/range\s*(\d+)/i.exec(arg)?.[1]);
  const s = Number(/strength\s*(\d+)/i.exec(arg)?.[1]);
  return range && s ? { name: 'Thrown stones', range, s } : undefined;
}

// ——— Courage ———

/** War horns within 24" give +1; an enemy Harbinger of Evil in range gives -1 (unless the model has it too). */
export function courageBonus(state: GameState, catalog: Catalog | null | undefined, m: Model): number {
  const alive = Object.values(state.models).filter(o => !o.dead && !o.escaped && !o.waiting);
  const horn = alive.some(o => o.owner === m.owner && distanceBetween(o, m) <= 24 && hasGear(catalog, o, /war ?horn/));
  const harbinger =
    !hasRule(catalog, m, 'Harbinger of Evil') &&
    alive.some(o => {
      if (o.owner === m.owner) return false;
      const range = Number(/(\d+)/.exec(ruleArgs(catalog, o, 'Harbinger of Evil')[0] ?? '')?.[1]);
      return range > 0 && distanceBetween(o, m) <= range;
    });
  // Defenders within 6" of their Rallying Point take heart.
  const rally = onTable(state).some(t => t.object === 'rally' && t.side === m.owner && fromMarker(m, t) <= 6);
  return (horn ? 1 : 0) + (rally ? 1 : 0) - (harbinger ? 1 : 0);
}

/**
 * Passes Courage tests without rolling while the model it guards lives: Sworn Protector (a named hero) and Bodyguard
 * (its army's leader, which we take to be its side's General, or failing that its highest-tier hero).
 */
export function guards(state: GameState, catalog: Catalog | null | undefined, m: Model): string | null {
  const friends = Object.values(state.models).filter(o => o.owner === m.owner && o.id !== m.id && !o.dead && !o.escaped);
  for (const name of ruleArgs(catalog, m, 'Sworn Protector')) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (friends.some(o => o.hero && (re.test(o.name) || re.test(unitOf(catalog, o)?.name ?? '')))) return 'Sworn Protector';
  }
  if (hasRule(catalog, m, 'Bodyguard')) {
    const heroes = Object.values(state.models).filter(o => o.owner === m.owner && o.hero);
    const ward = heroes.find(o => o.general) ?? [...heroes].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0];
    if (ward && !ward.dead && !ward.escaped) return 'Bodyguard';
  }
  return null;
}

// ——— Movement ———

/** Terrain a model's special rules let it cross as open ground, read by moveCost: 'wood', 'rock', 'all' or 'dry'. */
export function terrainRules(catalog: Catalog | null | undefined, m: Model): string[] {
  const out: string[] = [];
  if (hasRule(catalog, m, 'Woodland Creature')) out.push('wood');
  if (hasRule(catalog, m, 'Mountain Dweller')) out.push('rock');
  if (hasRule(catalog, m, 'Cave Dweller')) out.push('cave');
  if (hasRule(catalog, m, 'Spectral Walk')) out.push('spectral');
  if (hasRule(catalog, m, 'Swift Movement')) out.push('swift');
  // (Not terrain, but carried the same way: a Burly model or a monster carries a Heavy Object at full speed.)
  if (hasRule(catalog, m, 'Burly') || isMonster(catalog, m)) out.push('burly');
  return out;
}

// ——— Banners ———

/** How far a banner's sway reaches. */
export const BANNER_RANGE = 3;

/**
 * The banner that lets `seat` re-roll a die of duel roll `r`, if one does: a standing friendly banner within 3" of one
 * of its models in the fight (or supporting it) that can see it. Each side re-rolls one die per duel, and not to
 * throw away a duel it is winning.
 */
export function bannerFor(state: GameState, catalog: Catalog | null | undefined, r: DiceRoll, seat: Seat): Model | undefined {
  if (r.side === undefined || r.f === undefined || !r.group?.startsWith('f-')) return undefined;
  const rolls = state.log.filter(x => x.group === r.group);
  if (rolls.some(duelSettled) || rolls.some(x => x.banner && x.side === r.side)) return undefined;
  const ours = rolls.filter(x => x.side === r.side && x.model).map(x => state.models[x.model!]).filter((m): m is Model => !!m && !m.dead);
  if (!ours.length || ours[0].owner !== seat) return undefined;
  if (duelLeader(rolls)?.winner === r.side) return undefined;
  const flag = Object.values(state.models).find(b => b.owner === seat && !b.dead && !b.escaped && !b.waiting && !b.prone && carriesBanner(catalog, b) && ours.some(m => (m.id === b.id || distanceBetween(b, m) <= BANNER_RANGE) && (m.id === b.id || sightTo(state, m, b) !== 'hidden')));
  if (flag) return flag;
  // A Rallying Point is the defenders' banner.
  const rally = onTable(state).find(t => t.object === 'rally' && t.side === seat && ours.some(m => fromMarker(m, t) <= BANNER_RANGE));
  return rally ? { ...ours[0], id: rally.id, name: 'Rallying Point' } : undefined;
}
