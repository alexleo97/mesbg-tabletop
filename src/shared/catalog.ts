import { mountBase } from './bases.ts';
import { guessBase, type ListEntry } from './importList.ts';
import type { Base } from './types.ts';

/** Shape of src/data/mesbg-data.json (generated from the MESBG List Builder). */
export interface CatalogOption {
  id: string;
  name: string;
  points: number;
  included?: boolean;
  mount?: boolean;
  mountMv?: number;
  mods?: [string, number][];
}

export interface CatalogUnit {
  name: string;
  army: string;
  origin: string;
  type: string;
  points: number;
  /** Mv, Fv, Sv, S, D, A, W, C, I as printed on the profile. */
  stats?: string[];
  mwfw?: [string, string][];
  options: CatalogOption[];
  rules: string[];
  wargear: string[];
  unique?: boolean;
  warbandSize?: number;
  pickOne?: boolean;
  /** Each rule, heroic action and magical power by name, pointing at its explanation in rules-text.json. */
  ruleRefs?: Record<string, string>;
  heroics?: string[];
  powers?: { name: string; range: string; cast: string }[];
  /** For a hero: the warriors allowed in their warband, when the army limits it. */
  followers?: string[];
}

export interface CatalogArmy {
  side: string;
  units: string[];
  rules: string[];
  /** The army's bonuses, each with its explanation id. */
  bonuses?: { name: string; id: string }[];
  /** Explanation ids for the army's own limits on what can be taken. */
  restrictions?: string[];
  /** Fraction of warriors that may carry bows (0.33 is a third), and the same for throwing weapons. */
  bowLimit?: number;
  throwLimit?: number;
}

export interface Catalog {
  source: string;
  armies: Record<string, CatalogArmy>;
  units: Record<string, CatalogUnit>;
}

export const STAT_NAMES = ['Mv', 'Fv', 'Sv', 'S', 'D', 'A', 'W', 'C', 'I'] as const;

let catalogPromise: Promise<Catalog> | null = null;
/** Loads the unit data on first use, so the initial page stays small. */
export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= import('../data/mesbg-data.json').then(m => (m.default ?? m) as unknown as Catalog);
  return catalogPromise;
}

let rulesPromise: Promise<Record<string, string>> | null = null;
/** Loads the plain-words explanation of every rule, keyed by the ids in `ruleRefs`. */
export function loadRulesText(): Promise<Record<string, string>> {
  rulesPromise ??= import('../data/rules-text.json').then(m => (m.default ?? m) as unknown as Record<string, string>);
  return rulesPromise;
}

const IMAGE_HOST = 'https://resources.mesbg-list-builder.com/v2024/images/profiles';

/** The list builder's portrait for a unit, served from its own image host. */
export function pictureUrl(unit: Pick<CatalogUnit, 'origin' | 'name'>): string {
  return `${IMAGE_HOST}/${encodeURIComponent(unit.origin)}/pictures/${encodeURIComponent(unit.name)}.png`;
}

export const isHeroType = (type: string) => /hero/i.test(type);

/** Applies the selected options' modifiers to a profile's characteristics. */
export function statsWithOptions(unit: CatalogUnit, optionIds: string[]): string[] | undefined {
  if (!unit.stats) return undefined;
  const stats = [...unit.stats];
  for (const o of unit.options) {
    if (!optionIds.includes(o.id)) continue;
    for (const [stat, mod] of o.mods ?? []) {
      const i = STAT_NAMES.indexOf(stat as (typeof STAT_NAMES)[number]);
      const n = parseInt(stats[i], 10);
      if (i >= 0 && Number.isFinite(n)) stats[i] = String(n + mod);
    }
  }
  return stats;
}

export type StatName = (typeof STAT_NAMES)[number];

/** A model's printed stats as numbers ("4+" becomes 4), with its options applied, when the unit is known. */
export function modelStats(catalog: Catalog | null | undefined, m: { profileId?: string; options?: string[] } | undefined): Partial<Record<StatName, number>> | null {
  const unit = m?.profileId ? catalog?.units[m.profileId] : undefined;
  if (!unit) return null;
  const stats = statsWithOptions(unit, unit.options.filter(o => m!.options?.includes(o.name)).map(o => o.id));
  if (!stats) return null;
  const out: Partial<Record<StatName, number>> = {};
  STAT_NAMES.forEach((k, i) => {
    const n = parseInt(stats[i], 10);
    if (Number.isFinite(n)) out[k] = n;
  });
  return out;
}

/** Mounts that come with the profile (a Knight's horse), with how far they carry the rider. */
const MOUNTS: [RegExp, number][] = [
  [/\b(armoured )?horse\b|\bsteed\b|\bcamel\b/i, 10],
  [/\bwarg\b/i, 10],
  [/\bpony\b|\bgoat\b/i, 8],
];
function wargearMount(unit: CatalogUnit): { name: string; mv: number } | undefined {
  for (const w of unit.wargear) {
    const hit = MOUNTS.find(([re]) => re.test(w));
    if (hit) return { name: w, mv: hit[1] };
  }
  return undefined;
}

/**
 * Turns a unit with chosen options into list entries ready to deploy.
 * Some units are several models (e.g. Bain with Sigrid and Tilda), so this can return more than one entry.
 */
export function entriesFor(id: string, unit: CatalogUnit, optionIds: string[], count: number): ListEntry[] {
  const chosen = unit.options.filter(o => optionIds.includes(o.id) || o.included);
  const chosenMount = chosen.find(o => o.mount);
  const mount = chosenMount ? { name: chosenMount.name, mv: chosenMount.mountMv } : wargearMount(unit);
  const stats = statsWithOptions(unit, optionIds);
  const mv = stats ? parseFloat(stats[0]) : NaN;
  const statW = stats ? parseInt(stats[6], 10) : NaN;
  const base = mount ? mountBase(mount.name) : guessBase(unit.name);
  const move = mount?.mv ?? (Number.isFinite(mv) ? mv : undefined);
  const hero = isHeroType(unit.type);
  const parts = unit.mwfw?.length ? unit.mwfw : [['', '']];

  return parts.map(([subName, mwfw]) => {
    const [might, will, fate, wounds] = (mwfw || '').split(':').map(v => parseInt(v, 10));
    return {
      name: subName || unit.name,
      count,
      hero,
      move,
      wounds: Number.isFinite(wounds) && wounds > 0 ? wounds : Number.isFinite(statW) ? statW : 1,
      might: Number.isFinite(might) ? might : 0,
      will: Number.isFinite(will) ? will : 0,
      fate: Number.isFinite(fate) ? fate : 0,
      // A war machine's crew veteran stands in for the whole engine, so it takes the engine's base.
      base: subName && !subName.startsWith(unit.name) && !mount ? guessBase(subName) : base,
      profileId: id,
      options: chosen.map(o => o.name),
    };
  });
}

/** A hero's starting Might, Will and Fate from its profile, the most it can ever have; null for a model without one. */
export function startingPoints(catalog: Catalog | null | undefined, m: { profileId?: string; name: string }): { might: number; will: number; fate: number } | null {
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  if (!unit?.mwfw?.length) return null;
  const row = unit.mwfw.find(([n]) => n && n === m.name) ?? unit.mwfw[0];
  const [might, will, fate] = (row[1] || '').split(':').map(v => parseInt(v, 10) || 0);
  return { might, will, fate };
}

export function entryPoints(unit: CatalogUnit | undefined, optionIds: string[], count: number): number {
  // A unit dropped from newer data counts for nothing rather than breaking the list.
  if (!unit) return 0;
  const opts = unit.options.filter(o => optionIds.includes(o.id) && !o.included).reduce((a, o) => a + o.points, 0);
  return (unit.points + opts) * count;
}

/**
 * Reads a list exported from the MESBG List Builder (its .json export).
 * Returns null when the text isn't that format, so callers can fall back to the generic parser.
 */
export function parseBuilderExport(text: string, catalog: Catalog): { entries: ListEntry[]; missing: string[]; name?: string } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const roster = data as { warbands?: unknown; name?: unknown };
  if (!roster || !Array.isArray(roster.warbands)) return null;
  const entries: ListEntry[] = [];
  const missing: string[] = [];
  type Picked = { model_id?: string; quantity?: number; options?: { id?: string; quantity?: number }[] } | null;
  const add = (u: Picked, count: number) => {
    if (!u?.model_id) return;
    const unit = catalog.units[u.model_id];
    if (!unit) {
      missing.push(u.model_id);
      return;
    }
    const optionIds = (u.options ?? []).filter(o => o?.id && (o.quantity ?? 1) > 0).map(o => o.id!);
    entries.push(...entriesFor(u.model_id, unit, optionIds, count));
  };
  for (const wb of roster.warbands as { hero?: Picked; units?: Picked[] }[]) {
    add(wb?.hero ?? null, 1);
    for (const u of wb?.units ?? []) add(u, Math.max(0, Math.min(100, Math.round(Number(u?.quantity ?? 1)) || 0)));
  }
  return { entries: entries.filter(e => e.count > 0), missing, name: typeof roster.name === 'string' ? roster.name : undefined };
}

export const baseLabel = (b: Base) => (b.shape === 'round' ? `${b.w}mm` : `${b.w}×${b.h}mm`);