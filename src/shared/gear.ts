// What a model carries and which side it fights for, read from its profile, for the rules that depend on wargear.
import type { Catalog } from './catalog.ts';
import type { Model } from './types.ts';

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);

/** "Shield and spear", "War horn, shield, throwing spears" and the like, as separate items in lower case. */
const items = (text: string) =>
  text
    .split(/,| and | & /i)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Everything a model carries: its profile's wargear plus the options taken ("Exchange shield for banner" swaps one
 * for the other), less anything it has lost.
 */
export function gearOf(catalog: Catalog | null | undefined, m: Model): string[] {
  let gear = (unitOf(catalog, m)?.wargear ?? []).flatMap(items);
  for (const o of m.options ?? []) {
    const swap = /^(?:exchange|swap)\s+(.+?)\s+for\s+(.+)$/i.exec(o.trim());
    if (swap) {
      const out = items(swap[1]);
      gear = gear.filter(g => !out.some(x => g === x || g.endsWith(x) || x.endsWith(g)));
      gear.push(...items(swap[2]));
    } else gear.push(...items(o));
  }
  const lost = (m.lostGear ?? []).map(g => g.toLowerCase());
  return gear.filter(g => !lost.includes(g));
}

export const hasGear = (catalog: Catalog | null | undefined, m: Model, re: RegExp) => gearOf(catalog, m).some(g => re.test(g));

/** Which side a model fights for, from its army: Good or Evil (unknown for a model added by hand). */
export function sideOf(catalog: Catalog | null | undefined, m: Model): 'Good' | 'Evil' | undefined {
  const unit = unitOf(catalog, m);
  const side = unit ? catalog?.armies[unit.army]?.side : undefined;
  return side?.startsWith('Good') ? 'Good' : side?.startsWith('Evil') ? 'Evil' : undefined;
}

/** A spear for fighting with (not one for throwing), which lets the model support a friend in a fight. */
export const hasSpear = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /^(?!.*throwing).*\bspears?\b/);
/** A pike: supports like a spear, and can support another pike that is supporting. */
export const hasPike = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\bpikes?\b|easterling halberd/);
/** An Elven hand weapon, blade or other Elven melee weapon (not a bow), which helps in a drawn fight. */
/** An Elven bow (or a Galadhrim one). */
export const elvenBow = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\belven\b.*\bbow\b|\belf ?bow\b|galadhrim bow|bow of the galadhrim/);
export const hasElvenWeapon = (catalog: Catalog | null | undefined, m: Model) => hasGear(catalog, m, /\belven\b(?!.*\b(bow|cloak|throwing)\b)|\belf(?:-made)? (?:blade|weapon)|\bglamdring\b/);
