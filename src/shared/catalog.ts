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
}

export interface Catalog {
  source: string;
  armies: Record<string, { side: string; units: string[]; rules: string[] }>;
  units: Record<string, CatalogUnit>;
}

export const STAT_NAMES = ['Mv', 'Fv', 'Sv', 'S', 'D', 'A', 'W', 'C', 'I'] as const;

let catalogPromise: Promise<Catalog> | null = null;
/** Loads the unit data on first use, so the initial page stays small. */
export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= import('../data/mesbg-data.json').then(m => (m.default ?? m) as unknown as Catalog);
  return catalogPromise;
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

function mountBase(name: string): Base {
  const b = guessBase(name);
  if (b.shape === 'round' && b.w === 25) return { shape: 'rect', w: 25, h: 50 };
  return b;
}

/**
 * Turns a unit with chosen options into list entries ready to deploy.
 * Some units are several models (e.g. Bain with Sigrid and Tilda), so this can return more than one entry.
 */
export function entriesFor(id: string, unit: CatalogUnit, optionIds: string[], count: number): ListEntry[] {
  const chosen = unit.options.filter(o => optionIds.includes(o.id) || o.included);
  const mount = chosen.find(o => o.mount);
  const stats = statsWithOptions(unit, optionIds);
  const mv = stats ? parseFloat(stats[0]) : NaN;
  const statW = stats ? parseInt(stats[6], 10) : NaN;
  const base = mount ? mountBase(mount.name) : guessBase(unit.name);
  const move = mount?.mountMv ?? (Number.isFinite(mv) ? mv : undefined);
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
      base: subName && subName !== unit.name && !mount ? guessBase(subName) : base,
      profileId: id,
      options: chosen.map(o => o.name),
    };
  });
}

export function entryPoints(unit: CatalogUnit, optionIds: string[], count: number): number {
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