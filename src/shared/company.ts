import { startingPoints, modelStats, type Catalog } from './catalog.ts';
import { distanceBetween } from './geometry.ts';
import { carriedBy } from './objects.ts';
import { sightTo } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Thorin's Company, as they fought the Trolls and after: the special rules on their own profiles, in our own words.
// Most change a fight (see wargear.fighterOf and resolve.adjustFight); the rest are once-a-turn abilities, re-rolls
// and the like, worked out here.

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const rule = (catalog: Catalog | null | undefined, m: Model, re: RegExp) => !!unitOf(catalog, m)?.rules.some(r => re.test(r));
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

/** Thorin's "Loyalty, honour, a willing heart": friends of the Company within 6" of him re-roll 1s to wound. */
export const loyalTo = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  inCompany(catalog, m) && Object.values(state.models).some(t => t.id !== m.id && t.owner === m.owner && onTable(t) && rule(catalog, t, /^"?Loyalty, honour/i) && distanceBetween(t, m) <= 6);

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
    // Once Kíli and Fíli have swapped this turn, each re-rolls one die in the Fight phase.
    if (state.flow.synergy !== state.turn || !hasSynergy(catalog, m) || state.flow.usedTurn?.includes(`synergy:${m.id}`)) return null;
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
  if (!state.flow.started || (state.phase !== 'move' && state.phase !== 'shoot')) return 'only in his activation';
  if (!inCompany(catalog, t) || (how === 'spirits' && t.id === m.id)) return 'only a friend of the Company';
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

/** Whether Balin may spend a Will point now to re-roll the roll for Priority: just after it, once. */
export function mayLongbeard(state: GameState, catalog: Catalog | null | undefined, m: Model | undefined): boolean {
  if (!m || !onTable(m) || m.will < 1 || !rule(catalog, m, /^Longbeard$/) || state.phase !== 'priority') return false;
  return state.flow.chooserTurn === state.turn && !!state.flow.chooser && state.flow.longbeard !== state.turn;
}

// ——— Ori ———

/** Ori's Deadeye: a natural 6 to hit with his sling wounds without In the Way tests or a roll To Wound. */
export const deadeye = (catalog: Catalog | null | undefined, m: Model, weapon: string) => /sling/i.test(weapon) && rule(catalog, m, /^Deadeye$/);

/**
 * Ori's Chronicler: a friend of the Company within 6" of Ori, that he can see, slays an enemy Hero or Monster and
 * gets back a point of Might, Will or Fate it has spent; if it has spent none, another friend near Ori does.
 * Worked out as the models fall (see reducer.ts). Returns the changes to make.
 */
export function chronicled(before: GameState, after: GameState, catalog: Catalog | null | undefined, big: (m: Model) => boolean): { id: string; patch: Partial<Model> }[] {
  const out: { id: string; patch: Partial<Model> }[] = [];
  const fallen = Object.values(after.models).filter(m => m.dead && before.models[m.id] && !before.models[m.id].dead && (m.hero || big(m)));
  for (const f of fallen) {
    const killers = (f.killedBy?.ids ?? []).map(id => after.models[id]).filter((k): k is Model => !!k && k.owner !== f.owner);
    for (const k of killers) {
      const ori = Object.values(after.models).find(o => o.owner === k.owner && onTable(o) && rule(catalog, o, /^Chronicler$/) && (o.id === k.id || (distanceBetween(o, k) <= 6 && sightTo(after, o, k) !== 'hidden')));
      if (!ori || !inCompany(catalog, k)) continue;
      const near = [k, ...Object.values(after.models).filter(o => o.owner === k.owner && o.id !== k.id && onTable(o) && inCompany(catalog, o) && (o.id === ori.id || (distanceBetween(o, ori) <= 6 && sightTo(after, ori, o) !== 'hidden')))];
      for (const m of near) {
        const full = startingPoints(catalog, m);
        const now = out.find(x => x.id === m.id)?.patch ?? {};
        const cur = { might: now.might ?? m.might, will: now.will ?? m.will, fate: now.fate ?? m.fate };
        const key = full ? (['might', 'fate', 'will'] as const).find(p => cur[p] < full[p]) : undefined;
        if (!key) continue;
        const prev = out.find(x => x.id === m.id);
        if (prev) prev.patch = { ...prev.patch, [key]: cur[key] + 1 };
        else out.push({ id: m.id, patch: { [key]: cur[key] + 1 } });
        break;
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
