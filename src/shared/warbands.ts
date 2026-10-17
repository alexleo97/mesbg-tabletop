import { entryPoints, isHeroType, type Catalog, type CatalogUnit } from './catalog.ts';

/** One line of a saved army list. `lead` is the key of the hero entry whose warband it's in. */
export interface WarbandEntry {
  key: string;
  unitId: string;
  count: number;
  optionIds: string[];
  lead?: string;
}

/** Higher tiers lead bigger warbands and usually make the better leader. */
const TIER: Record<string, number> = {
  'Hero of Legend': 5,
  'Hero of Valour': 4,
  'Hero of Fortitude': 3,
  'Minor Hero': 2,
  'Siege Engine': 1,
  'Independent Hero': 0,
};

export const tierOf = (unit: CatalogUnit | undefined) => (unit ? (TIER[unit.type] ?? 0) : 0);
/** Models an entry puts on the table: some profiles are several models (a hero with a companion). */
export const modelCount = (unit: CatalogUnit | undefined, count: number) => count * Math.max(1, unit?.mwfw?.length ?? 1);
/** Whether this unit heads a warband of its own. */
export const leadsWarband = (unit: CatalogUnit | undefined) => (unit?.warbandSize ?? 0) > 0;
export const isWarrior = (unit: CatalogUnit | undefined) => !!unit && !isHeroType(unit.type) && unit.type !== 'Siege Engine';

const BOW = /bow\b/i;
/** Whether the models carry a bow or crossbow, from their kit or a chosen option. */
export function hasBow(unit: CatalogUnit, optionIds: string[]): boolean {
  if (unit.wargear.some(w => BOW.test(w))) return true;
  return unit.options.some(o => (optionIds.includes(o.id) || o.included) && BOW.test(o.name));
}

export interface Warband {
  leader: WarbandEntry;
  unit: CatalogUnit;
  members: WarbandEntry[];
  /** Followers in the warband, not counting the hero. */
  size: number;
  max: number;
}

/**
 * Sorts a list into warbands. Entries without a valid `lead` (older lists, or a hero that was removed)
 * join the first warband with room (or the one with the most room), so nothing is lost; `loose` holds what's left when there's no hero at all.
 */
export function organise(entries: WarbandEntry[], catalog: Catalog) {
  const warbands: Warband[] = entries
    .filter(e => leadsWarband(catalog.units[e.unitId]))
    .map(e => ({ leader: e, unit: catalog.units[e.unitId], members: [], size: 0, max: catalog.units[e.unitId].warbandSize ?? 0 }));
  const independents = entries.filter(e => !leadsWarband(catalog.units[e.unitId]) && isHeroType(catalog.units[e.unitId]?.type ?? ''));
  const loose: WarbandEntry[] = [];
  const byKey = new Map(warbands.map(w => [w.leader.key, w]));
  const followers = entries.filter(e => catalog.units[e.unitId] && !leadsWarband(catalog.units[e.unitId]) && !isHeroType(catalog.units[e.unitId].type));
  const join = (w: Warband, e: WarbandEntry) => {
    w.members.push(e);
    w.size += modelCount(catalog.units[e.unitId], e.count);
  };
  const unplaced: WarbandEntry[] = [];
  for (const e of followers) {
    const w = e.lead ? byKey.get(e.lead) : undefined;
    if (w) join(w, e);
    else unplaced.push(e);
  }
  for (const e of unplaced) {
    const n = modelCount(catalog.units[e.unitId], e.count);
    const w = warbands.find(x => x.size + n <= x.max) ?? [...warbands].sort((a, b) => b.max - b.size - (a.max - a.size))[0];
    if (w) join(w, e);
    else loose.push(e);
  }
  return { warbands, independents, loose };
}

/** The hero who leads the army: the one picked, or else the highest tier, then the most points. */
export function armyLeader(entries: WarbandEntry[], catalog: Catalog, picked?: string): WarbandEntry | undefined {
  const heroes = entries.filter(e => isHeroType(catalog.units[e.unitId]?.type ?? ''));
  return (
    heroes.find(e => e.key === picked) ??
    [...heroes].sort((a, b) => tierOf(catalog.units[b.unitId]) - tierOf(catalog.units[a.unitId]) || (catalog.units[b.unitId]?.points ?? 0) - (catalog.units[a.unitId]?.points ?? 0))[0]
  );
}

export interface ListCheck {
  ok: boolean;
  text: string;
}

/** Plain-language checks for a list: a hero to lead it, warband sizes, the bow limit and the points limit. */
export function checkList(entries: WarbandEntry[], catalog: Catalog, pointsLimit?: number): ListCheck[] {
  const out: ListCheck[] = [];
  const { warbands, loose } = organise(entries, catalog);
  const points = entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);

  out.push(warbands.length ? { ok: true, text: `${warbands.length} warband${warbands.length === 1 ? '' : 's'}, each led by a hero` } : { ok: false, text: 'Add a hero to lead your first warband.' });
  for (const w of warbands) {
    if (w.size > w.max) out.push({ ok: false, text: `${w.unit.name}'s warband has ${w.size} models; a ${w.unit.type} leads up to ${w.max}.` });
  }
  if (loose.length) out.push({ ok: false, text: `${loose.length} unit${loose.length === 1 ? " isn't" : "s aren't"} in a warband yet.` });

  const warriors = entries.filter(e => isWarrior(catalog.units[e.unitId]));
  const total = warriors.reduce((a, e) => a + e.count, 0);
  const bows = warriors.filter(e => hasBow(catalog.units[e.unitId], e.optionIds)).reduce((a, e) => a + e.count, 0);
  const limit = Math.ceil(total / 3);
  if (bows) out.push({ ok: bows <= limit, text: `${bows} of ${total} warriors carry bows (usual limit ${limit}, a third rounded up)` });

  if (pointsLimit) {
    out.push(
      points <= pointsLimit
        ? { ok: true, text: `${points} of ${pointsLimit} pts (${pointsLimit - points} left)` }
        : { ok: false, text: `${points - pointsLimit} pts over your ${pointsLimit} pt limit.` },
    );
  }
  return out;
}
