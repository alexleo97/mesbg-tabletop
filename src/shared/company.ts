import { modelStats, rulesFor, startingPoints, type Catalog } from './catalog.ts';
import { priorityChooser } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { carriedBy } from './objects.ts';
import { sightTo } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Thorin's Company, as they fought the Trolls and after: the special rules on their own profiles, in our own words.
// Most change a fight (see wargear.fighterOf and resolve.adjustFight); the rest are once-a-turn abilities, re-rolls
// and the like, worked out here.

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const rule = (catalog: Catalog | null | undefined, m: Model, re: RegExp) => rulesFor(catalog, m).some(r => re.test(r));
const onTable = (m: Model) => !m.dead && !m.escaped && !m.waiting;

/** A member of Thorin's Company: a model from that army. */
export const inCompany = (catalog: Catalog | null | undefined, m: Model) => !!m.profileId?.startsWith("[thorin's-company]") || unitOf(catalog, m)?.army === "Thorin's Company";

/** The friend of `m` on the table with this rule, nearest first, within `range` if given. */
function friendWith(state: GameState, catalog: Catalog | null | undefined, m: Model, re: RegExp, range = Infinity): Model | undefined {
  return Object.values(state.models)
    .filter(f => f.owner === m.owner && onTable(f) && rule(catalog, f, re) && (f.id === m.id || distanceBetween(f, m) <= range))
    .sort((a, b) => distanceBetween(a, m) - distanceBetween(b, m))[0];
}

/** Model names on the profile, for the rules that name a brother: Ori, Nori. */
const named = (catalog: Catalog | null | undefined, m: Model, name: string) => new RegExp(`\\b${name}\\b`, 'i').test(`${unitOf(catalog, m)?.name ?? ''} ${m.name}`);

// ——— Steadfast ———

/** Bofur near enough to a friend for his Steadfast to steady it: a member of the Company within 3" of him. */
export function steadiedBy(state: GameState, catalog: Catalog | null | undefined, m: Model): Model | undefined {
  if (!inCompany(catalog, m)) return undefined;
  return friendWith(state, catalog, m, /^Steadfast$/, 3);
}

/**
 * Bofur's Steadfast: a friend of the Company within 3" of him that an enemy special rule or power is about to affect
 * rolls a D6, and on a 3+ isn't affected. Returns the roll (none if Bofur isn't near) and whether it shrugged it off.
 */
export function steadfast(state: GameState, catalog: Catalog | null | undefined, m: Model, what: string, d6: () => number, by: Seat, id: string, now: number, group?: string): { roll?: DiceRoll; saved: boolean } {
  const bofur = steadiedBy(state, catalog, m);
  if (!bofur) return { saved: false };
  const d = d6();
  const saved = d >= 3;
  const roll: DiceRoll = { id, by, label: `Steadfast: ${m.name} against ${what} (3+)`.slice(0, 80), dice: [d], target: 3, model: m.id, at: now, ...(group ? { group } : {}), note: saved ? `${bofur.id === m.id ? m.name : `Bofur steadies ${m.name}, who`} ignores ${what}.` : `${m.name} is affected.` };
  return { roll, saved };
}

// ——— In a fight ———

/** Thorin's "Loyalty, honour, a willing heart": the Company within 6" of him (himself too) re-roll 1s to wound. */
export const loyalTo = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  inCompany(catalog, m) && Object.values(state.models).some(t => t.owner === m.owner && onTable(t) && rule(catalog, t, /^"?Loyalty, honour/i) && distanceBetween(t, m) <= 6);

/** Thorin, whose Stand Fast! steadies the heroes of his Company as well as its warriors. */
export const thorinsCall = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^"?Loyalty, honour/i);

/** Dori's A Good Sort: with Ori or Nori within 3", he has 3 Attacks and re-rolls 1s in the duel. */
export const goodSort = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  rule(catalog, m, /^A Good Sort$/) && Object.values(state.models).some(f => f.id !== m.id && f.owner === m.owner && onTable(f) && (named(catalog, f, 'Ori') || named(catalog, f, 'Nori')) && distanceBetween(f, m) <= 3);

/** Glóin's Axe Mastery: outnumbered in a fight, he has 4 Attacks. */
export const axeMastery = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Axe Mastery$/);

/** Nori's "Just a couple of keepsakes": carrying an objective, he re-rolls failed To Wound rolls. */
export const keepsakes = (state: GameState, catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /keepsakes/i) && carriedBy(state, m).length > 0;
/** Nori never hands an objective on to a friend. */
export const keepsNori = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /keepsakes/i);

/** Dwalin's Weapon Master (and Nori's): never Unarmed. */
export const weaponMaster = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Weapon Master$/);

/** Bifur's Embedded Axe: he may headbutt instead of striking; once it frees the axe, his Heroic Moves can be free. */
export const canHeadbutt = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Embedded Axe/);
export const AXE_FREED = 'Embedded Axe';

/** A Mattock: instead of striking, its wielder may try to knock a foe down. */
export const hasMattock = (catalog: Catalog | null | undefined, m: Model) => [...(unitOf(catalog, m)?.wargear ?? []), ...(m.options ?? [])].some(g => /mattock/i.test(g)) || rule(catalog, m, /^Mattock$/);

/** Thorin with the Oakenshield: if he wins while Shielding, a Strength 4 hit on one foe. */
export const hasOakenshield = (catalog: Catalog | null | undefined, m: Model) => !!m.options?.some(o => /oakenshield/i.test(o)) || !!unitOf(catalog, m)?.wargear.some(g => /oakenshield/i.test(g));

/** Grasper & Keeper, Dwalin's axes. */
export const hasGrasper = (catalog: Catalog | null | undefined, m: Model) => !!unitOf(catalog, m)?.wargear.some(g => /grasper/i.test(g));

// ——— Kíli and Fíli: Combat Synergy ———

export const hasSynergy = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Combat Synergy$/);

/**
 * Whether Kíli and Fíli may swap places now: both on the table and within 1" of each other, as a phase starts
 * (before any heroic action is declared), and not already this phase.
 */
export function maySwap(state: GameState, catalog: Catalog | null | undefined, a: Model | undefined, b: Model | undefined): boolean {
  if (!a || !b || a.id === b.id || a.owner !== b.owner || !onTable(a) || !onTable(b) || !hasSynergy(catalog, a) || !hasSynergy(catalog, b)) return false;
  if (!state.flow.started || !['move', 'shoot', 'fight'].includes(state.phase) || state.flow.heroics.some(h => h.phase === state.phase) || state.flow.passed.length) return false;
  if (state.flow.usedTurn?.includes(`swap-${state.phase}:${a.owner}`)) return false;
  // Once anything has moved, shot or fought this phase, the phase is under way.
  if (Object.keys(state.flow.starts ?? {}).length || state.flow.done.length || state.flow.resolved.length || state.flow.duels?.length) return false;
  return distanceBetween(a, b) <= 1;
}

/** The pair that could swap now, for the buttons. */
export function swapPair(state: GameState, catalog: Catalog | null | undefined, seat: Seat): [Model, Model] | null {
  const twins = Object.values(state.models).filter(m => m.owner === seat && onTable(m) && hasSynergy(catalog, m));
  for (const a of twins) for (const b of twins) if (a.id < b.id && maySwap(state, catalog, a, b)) return [a, b];
  return null;
}

// ——— Re-rolls in the duel ———

/** Why a model's own rules let it re-roll a die of this duel roll now, if they do. */
export function rerollFor(state: GameState, catalog: Catalog | null | undefined, r: DiceRoll, why: 'synergy' | 'portents', by?: Model): string | null {
  if (r.side === undefined || r.f === undefined || r.support || !r.group?.startsWith('f-') || !r.model || r.rerolled?.includes(why)) return null;
  const rolls = state.log.filter(x => x.group === r.group);
  if (rolls.some(x => x.against || x.note || x.label.startsWith('Roll-off') || x.label.startsWith('Drawn fight'))) return null;
  const m = state.models[r.model];
  if (!m || m.dead) return null;
  if (why === 'synergy') {
    // Once Kíli and Fíli have swapped this turn, each re-rolls one die of each of his duel rolls in the Fight phase.
    if (state.flow.synergy !== state.turn || !hasSynergy(catalog, m)) return null;
    return `${m.name} (Combat Synergy)`;
  }
  // Óin's Reading the Portents: a Will point for a friend of the Company within 6" to re-roll a die.
  const oin = by && by.owner === m.owner && onTable(by) && rule(catalog, by, /^Reading the Portents$/) && by.will > 0 && inCompany(catalog, m) && distanceBetween(by, m) <= 6 ? by : undefined;
  return oin ? `Óin reads the portents for ${m.name}` : null;
}

// ——— Once a turn, in the model's activation ———

/** Óin's Healing Herbs, or Bombur's Raising Spirits, on a friend: who can be tended now, and why not. */
export function mayTend(state: GameState, catalog: Catalog | null | undefined, how: 'herbs' | 'spirits', m: Model | undefined, t: Model | undefined): string | null {
  if (!m || !t || m.owner !== t.owner || !onTable(m) || !onTable(t)) return 'nobody to tend';
  const re = how === 'herbs' ? /^Healing Herbs$/ : /^Raising Spirits$/;
  if (!rule(catalog, m, re)) return 'not his rule';
  if (state.flow.usedTurn?.includes(`${how}:${m.id}`)) return 'once a turn';
  // (A model's Activation is its turn to act in its side's Move phase.)
  if (!state.flow.started || state.phase !== 'move') return 'only in his activation';
  // (A model is always within range of itself, so Bombur can cheer himself up.)
  if (!inCompany(catalog, t)) return 'only a friend of the Company';
  if (how === 'herbs' && (t.id === m.id || distanceBetween(m, t) > 0.05)) return 'must be touching him';
  if (how === 'spirits' && distanceBetween(m, t) > 3) return 'must be within 3"';
  if (how === 'herbs' && t.wounds >= t.maxWounds) return 'has no wounds to heal';
  if (how === 'spirits' && t.will >= (startingPoints(catalog, t)?.will ?? t.will)) return 'has spent no Will';
  return null;
}

/** Rolls Healing Herbs or Raising Spirits: a 4+ heals a Wound, or gives back a Will point. */
export function tend(how: 'herbs' | 'spirits', m: Model, t: Model, d6: () => number, uid: () => string, now: number): Action[] {
  const d = d6();
  const ok = d >= 4;
  const label = how === 'herbs' ? `Healing Herbs: ${m.name} tends ${t.name} (4+)` : `Raising Spirits: ${m.name} cheers ${t.name} (4+)`;
  const note = ok ? (how === 'herbs' ? `${t.name} gets back a Wound.` : `${t.name} gets back a Will point.`) : 'No luck this time.';
  const out: Action[] = [{ type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: label.slice(0, 80), dice: [d], target: 4, model: m.id, at: now, note } }, { type: 'usedTurn', key: how, model: m.id }];
  if (ok) out.push({ type: 'affect', id: t.id, patch: how === 'herbs' ? { wounds: Math.min(t.maxWounds, t.wounds + 1) } : { will: t.will + 1 } });
  return out;
}

// ——— Balin's Longbeard ———

/** Whether Balin may spend a Will point now to have his side's roll for Priority made again: just after it, once. */
export function mayLongbeard(state: GameState, catalog: Catalog | null | undefined, m: Model | undefined): boolean {
  if (!m || !onTable(m) || m.will < 1 || !rule(catalog, m, /^Longbeard$/) || state.phase !== 'priority' || !state.flow.started) return false;
  return state.flow.chooserTurn === state.turn && !!state.flow.chooser && !state.flow.usedTurn?.includes(`longbeard:${m.id}`);
}

/** Balin on the table who may still use Longbeard this Priority phase, for a seat. */
export const longbeardFor = (state: GameState, catalog: Catalog | null | undefined, seat: Seat) => Object.values(state.models).find(m => m.owner === seat && mayLongbeard(state, catalog, m));

/** Balin's Longbeard: his side's Priority die rolled again (both, on a first-turn tie), and who chooses now. */
export function longbeard(state: GameState, m: Model, d6: () => number, uid: () => string, now: number): Action[] {
  const i = m.owner === 'p1' ? 0 : 1;
  const was = state.flow.roll ?? [1, 1];
  const roll: [number, number] = [...was];
  roll[i] = d6();
  const out: Action[] = [{ type: 'affect', id: m.id, patch: { will: m.will - 1 } }, { type: 'usedTurn', key: 'longbeard', model: m.id }];
  let chooser = priorityChooser(roll, state.turn, state.flow.lastChooser ?? null);
  out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `Longbeard: ${m.name} re-rolls a ${was[i]} for Priority (1 Will)`.slice(0, 80), dice: [roll[i]], model: m.id, at: now } });
  // A first-turn tie is rolled again.
  while (!chooser) {
    roll[0] = d6();
    roll[1] = d6();
    chooser = priorityChooser(roll, state.turn, state.flow.lastChooser ?? null);
    out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `Priority roll, turn ${state.turn}`, dice: [...roll], at: now } });
  }
  out.push({ type: 'priorityRolled', roll, chooser });
  return out;
}

// ——— Ori ———

/** Ori's Deadeye: a natural 6 to hit with his sling wounds without In the Way tests or a roll To Wound. */
export const deadeye = (catalog: Catalog | null | undefined, m: Model, weapon: string) => /sling/i.test(weapon) && rule(catalog, m, /^Deadeye$/);

/** The points a model has spent that it could get back, best first. */
export function spentPoints(catalog: Catalog | null | undefined, m: Model): ('might' | 'will' | 'fate')[] {
  const full = startingPoints(catalog, m);
  return full ? (['might', 'fate', 'will'] as const).filter(p => m[p] < full[p]) : [];
}

/**
 * Ori's Chronicler: a friend of the Company within 6" of Ori, that he can see, slays an enemy Hero or Monster and may
 * get back a point of Might, Will or Fate it has spent (its player's pick); if it has spent none, its player may pick
 * another friend near Ori to have it. Worked out as the models fall (see server apply): for each such deed, the
 * models that may take the point.
 */
export function chronicled(before: GameState, after: GameState, catalog: Catalog | null | undefined, big: (m: Model) => boolean): { seat: Seat; ids: string[] }[] {
  const out: { seat: Seat; ids: string[] }[] = [];
  const fallen = Object.values(after.models).filter(m => m.dead && before.models[m.id] && !before.models[m.id].dead && (m.hero || big(m)));
  for (const f of fallen) {
    const killers = (f.killedBy?.ids ?? []).map(id => after.models[id]).filter((k): k is Model => !!k && k.owner !== f.owner);
    for (const k of killers) {
      const ori = Object.values(after.models).find(o => o.owner === k.owner && onTable(o) && rule(catalog, o, /^Chronicler$/) && (o.id === k.id || (distanceBetween(o, k) <= 6 && sightTo(after, o, k) !== 'hidden')));
      if (!ori || !inCompany(catalog, k)) continue;
      if (!k.dead && spentPoints(catalog, k).length) out.push({ seat: k.owner, ids: [k.id] });
      else {
        const near = Object.values(after.models).filter(o => o.owner === k.owner && o.id !== k.id && onTable(o) && inCompany(catalog, o) && (o.id === ori.id || (distanceBetween(o, ori) <= 6 && sightTo(after, ori, o) !== 'hidden')) && spentPoints(catalog, o).length);
        if (near.length) out.push({ seat: k.owner, ids: near.map(o => o.id) });
      }
      break;
    }
  }
  return out;
}

/** Bombur's Lumbering: no Heroic Moves for him. */
export const lumbering = (catalog: Catalog | null | undefined, m: Model) => rule(catalog, m, /^Lumbering$/);

/** Óin's Hearing Trumpet. */
export const hasTrumpet = (catalog: Catalog | null | undefined, m: Model) => [...(unitOf(catalog, m)?.wargear ?? [])].some(g => /hearing trumpet/i.test(g));

/** The Strength a model has for a knock-down or a Troll's Mince 'em Fine roll. */
export const strengthOf = (catalog: Catalog | null | undefined, m: Model) => modelStats(catalog, m)?.S ?? 3;

// ——— Óin's Hearing Trumpet ———

/**
 * An enemy hero's heroic action that Óin, within 6" of it, has yet to listen for: his player may roll (a 5+ calls the
 * same one for nothing; a 1 costs him a Will point, or, with none, his move this turn).
 */
export function trumpetDue(state: GameState, catalog: Catalog | null | undefined): { oin: Model; heroic: { model: string; action: string }; key: string } | null {
  if (!state.flow.started || state.result) return null;
  for (const h of state.flow.heroics) {
    if (h.phase !== state.phase) continue;
    const m = state.models[h.model];
    if (!m) continue;
    const key = `${state.turn}:${h.phase}:${h.model}:${h.action}`;
    if (state.flow.heard?.includes(key)) continue;
    const oin = Object.values(state.models).find(o => o.owner !== m.owner && onTable(o) && o.hero && hasTrumpet(catalog, o) && distanceBetween(o, m) <= 6 && !state.flow.heroics.some(x => x.model === o.id && x.phase === state.phase));
    if (oin) return { oin, heroic: h, key };
  }
  return null;
}

/** A heroic action Óin could hear that the game hasn't yet held play for. */
export const listenDue = (state: GameState, catalog: Catalog | null | undefined) => {
  const due = trumpetDue(state, catalog);
  return !!due && state.flow.listen !== due.key;
};
/** Holds the heroic actions for Óin's player to decide (see heroics.heroicsSettled). */
export const listenFor = (state: GameState, catalog: Catalog | null | undefined): Action[] => [{ type: 'listen', key: trumpetDue(state, catalog)!.key }];

/** Óin's player listens through the trumpet, or doesn't. */
export function trumpet(state: GameState, catalog: Catalog | null | undefined, listen: boolean, d6: () => number, uid: () => string, now: number, tierOk: (oin: Model, t: Model) => boolean): Action[] | null {
  const due = trumpetDue(state, catalog);
  if (!due) return null;
  const { oin, heroic, key } = due;
  const out: Action[] = [{ type: 'heard', key }];
  if (!listen) return out;
  const caller = state.models[heroic.model];
  const d = d6();
  // A Heroic Challenge he copies goes at the hero who issued it, if it's one he may challenge.
  const target = heroic.action === 'Heroic Challenge' ? (tierOk(oin, caller) && !caller.dead ? caller.id : undefined) : undefined;
  const copies = d >= 5 && (heroic.action !== 'Heroic Challenge' || !!target);
  const note = d >= 5 ? (copies ? `${oin.name} calls a ${heroic.action} too, for nothing.` : `${oin.name} heard it, but has nobody to challenge.`) : d === 1 ? (oin.will > 0 ? `${oin.name} fumbles with the trumpet and loses a Will point.` : `${oin.name} can't move this turn while he fixes his trumpet.`) : 'He didn\'t quite catch it.';
  out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: oin.owner, label: `Hearing Trumpet: ${oin.name} listens to ${caller.name}'s ${heroic.action} (5+)`.slice(0, 80), dice: [d], target: 5, model: oin.id, at: now, note } });
  if (copies) out.push({ type: 'freeHeroic', model: oin.id, action: heroic.action, ...(target ? { target } : {}) });
  if (d === 1) out.push({ type: 'affect', id: oin.id, patch: oin.will > 0 ? { will: oin.will - 1 } : { noMove: state.turn } });
  return out;
}

// ——— Bifur's Embedded Axe ———

/** Whether Bifur, his axe freed, may test for a free Heroic Move now: as the Move phase starts, before any heroic action. */
export function mayAxeTest(state: GameState, catalog: Catalog | null | undefined, m: Model | undefined): boolean {
  if (!m || !onTable(m) || !m.hero || !m.used?.includes(AXE_FREED) || !canHeadbutt(catalog, m)) return false;
  if (!state.flow.started || state.phase !== 'move' || state.flow.heroics.some(h => h.phase === 'move') || state.flow.passed.length || state.flow.done.length) return false;
  return !state.flow.usedTurn?.includes(`axe:${m.id}`) && !state.flow.freeMove?.includes(m.id);
}

/** The Intelligence test (2D6, his Intelligence or more): passed, he may declare a Heroic Move this turn for nothing. */
export function axeTest(catalog: Catalog | null | undefined, m: Model, d6: () => number, uid: () => string, now: number): Action[] {
  const need = modelStats(catalog, m)?.I ?? 7;
  const dice = [d6(), d6()];
  const pass = dice[0] + dice[1] >= need;
  return [
    { type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `Embedded Axe: ${m.name}'s Intelligence test for a free Heroic Move`.slice(0, 80), dice, sum: need, model: m.id, at: now, note: pass ? `${m.name} may declare a Heroic Move this turn for nothing.` : 'Not this turn.' } },
    { type: 'usedTurn', key: 'axe', model: m.id },
    ...(pass ? [{ type: 'freeMove', model: m.id } as Action] : []),
  ];
}
