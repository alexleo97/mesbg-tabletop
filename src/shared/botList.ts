import { entryPoints, isHeroType, type Catalog, type CatalogUnit } from './catalog.ts';
import { isWarrior, leadsWarband, tierOf, type WarbandEntry } from './warbands.ts';

const BOW = /\bbow\b/i;

/** Armies that can field a proper force: at least one hero who leads a warband and some warriors to follow. */
export function playableArmies(catalog: Catalog): string[] {
  return Object.keys(catalog.armies)
    .filter(a => {
      const units = catalog.armies[a].units.map(id => catalog.units[id]).filter(Boolean);
      return units.some(u => leadsWarband(u) && isHeroType(u.type)) && units.some(isWarrior);
    })
    .sort();
}

/**
 * A ready-to-play list for the computer: heroes each leading a warband of warriors, with up to the army's share of
 * bows, as close to `points` as it gets without going over.
 */
export function botRoster(catalog: Catalog, army: string, points: number, rand: () => number = Math.random): { entries: WarbandEntry[]; leader?: string } {
  const units = (catalog.armies[army]?.units ?? []).map(id => ({ id, unit: catalog.units[id] })).filter((u): u is { id: string; unit: CatalogUnit } => !!u.unit);
  const heroes = units.filter(u => leadsWarband(u.unit) && isHeroType(u.unit.type));
  const warriors = units.filter(u => isWarrior(u.unit));
  const bowShare = catalog.armies[army]?.bowLimit ?? 1 / 3;
  const entries: WarbandEntry[] = [];
  let left = points;
  let n = 0;
  let total = 0;
  let bows = 0;
  const cost = (u: CatalogUnit, opts: string[]) => entryPoints(u, opts, 1);
  const cheapest = Math.min(...warriors.map(w => cost(w.unit, [])), Infinity);
  const usedHeroes = new Set<string>();
  let leader: string | undefined;

  while (left >= cheapest + Math.min(...heroes.map(h => cost(h.unit, [])), Infinity)) {
    // The first hero leads the army, so it can be a big one; later ones are cheaper captains.
    const share = entries.length ? 0.4 : 0.45;
    const affordable = heroes.filter(h => !usedHeroes.has(h.id) && cost(h.unit, []) <= left * share);
    const pool = affordable.length ? affordable : entries.length ? [] : heroes.filter(h => cost(h.unit, []) <= left);
    if (!pool.length) break;
    const ranked = [...pool].sort((a, b) => tierOf(b.unit) - tierOf(a.unit) || cost(b.unit, []) - cost(a.unit, []));
    const hero = ranked[Math.floor(rand() * Math.min(3, ranked.length))];
    // Unique heroes appear once; generic captains can lead more than one warband.
    if (hero.unit.unique) usedHeroes.add(hero.id);
    const key = `b${n++}`;
    entries.push({ key, unitId: hero.id, count: 1, optionIds: [] });
    leader ??= key;
    left -= cost(hero.unit, []);

    const allowed = hero.unit.followers?.length ? warriors.filter(w => hero.unit.followers!.includes(w.id)) : warriors;
    const pickFrom = allowed.length ? allowed : warriors;
    const types = [...pickFrom].sort(() => rand() - 0.5).slice(0, 2);
    let room = hero.unit.warbandSize ?? 0;
    for (const [i, w] of types.entries()) {
      const bow = w.unit.options.find(o => BOW.test(o.name) && !o.included && o.points <= 2);
      const plain = cost(w.unit, []);
      const want = Math.min(room, Math.floor(left / plain), i === 0 && types.length > 1 ? Math.ceil(room * 0.6) : room);
      if (want <= 0) continue;
      // Some of them with bows, within the army's limit.
      const bowmen = bow && w.unit.wargear.every(g => !BOW.test(g)) ? Math.max(0, Math.min(Math.floor(want / 3), Math.floor((total + want) * bowShare) - bows)) : 0;
      const archerCost = bow ? cost(w.unit, [bow.id]) : plain;
      const melee = want - bowmen;
      const shooters = Math.max(0, Math.min(bowmen, Math.floor((left - melee * plain) / archerCost)));
      if (melee > 0) entries.push({ key: `b${n++}`, unitId: w.id, count: melee, optionIds: [], lead: key });
      if (shooters > 0 && bow) entries.push({ key: `b${n++}`, unitId: w.id, count: shooters, optionIds: [bow.id], lead: key });
      left -= melee * plain + shooters * archerCost;
      total += melee + shooters;
      bows += shooters;
      room -= melee + shooters;
    }
  }
  return { entries, leader };
}
