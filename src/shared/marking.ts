// What the game notes on a model as it comes onto the table, from its profile: how it crosses terrain, whether it
// beats a war drum, the mount it rides (a Fell Beast or a Great Eagle flies), and whether it is a war beast, a chariot
// or a siege engine.
import { mountName, mountProfile } from './cavalry.ts';
import type { Catalog } from './catalog.ts';
import { gearOf } from './gear.ts';
import { engineSize } from './siege.ts';
import { beastKind } from './warBeasts.ts';
import { terrainRules } from './wargear.ts';
import type { Model } from './types.ts';

export function markModel(catalog: Catalog, m: Model): Model {
  if (!m?.profileId || !catalog.units[m.profileId]) return m;
  const unit = catalog.units[m.profileId];
  const ground = terrainRules(catalog, m);
  const drum = gearOf(catalog, m).some(g => /war ?drum/.test(g));
  // A rider's mount, for lists deployed before mounts were recorded.
  const mount = m.mount || m.dismounted ? undefined : mountName(unit, m.options ?? []);
  // War beasts and chariots, for lists deployed before they were recorded.
  const beast = m.beast ?? beastKind(catalog, m);
  // Siege engines too.
  const siege = m.siege ?? (unit.type === 'Siege Engine' && m.name === unit.name ? engineSize(unit.name) : undefined);
  return { ...m, ...(beast ? { beast } : {}), ...(siege ? { siege } : {}), ...(unit.rules.some(r => /^Fly\b/.test(r)) || /fell beast|great eagle/i.test(m.mount ?? mount ?? '') ? { fly: true } : {}), ...(ground.length ? { ground } : {}), ...(drum ? { drum: true } : {}), ...(mount ? { mount, mountWounds: mountProfile(mount)?.w } : {}) };
}
