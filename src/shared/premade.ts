import type { Catalog, CatalogUnit } from './catalog.ts';
import type { WarbandEntry } from './warbands.ts';

/** The points sizes every premade army comes in. */
export const PREMADE_SIZES = [500, 750] as const;
export type PremadeSize = (typeof PREMADE_SIZES)[number];
/** The premade size closest to a points total. */
export const premadeSize = (points: number): PremadeSize => (points > 625 ? 750 : 500);

/** Followers in a premade warband: how many, the unit (its id without the army), then any options by name. */
type Followers = [count: number, unit: string, ...options: string[]];
interface PremadeWarband {
  hero: string;
  options?: string[];
  with?: Followers[];
}
export interface Premade {
  id: string;
  name: string;
  army: string;
  side: 'Good' | 'Evil';
  about: string;
  lists: Record<PremadeSize, PremadeWarband[]>;
}

/**
 * Ready-made armies for players and the solo opponent, built by hand at exactly 500 and 750 points from each army
 * book's Army Composition page, using only the units and options printed there (tests/premade.test.ts checks them).
 */
export const PREMADE: Premade[] = [
  {
    id: 'white-tower',
    name: 'The White Tower',
    army: 'Minas Tirith',
    side: 'Good',
    about: "Boromir's spears and shields hold the line while Irolas' Citadel Guard shoot; at 750 Faramir's knights ride out.",
    lists: {
      500: [
        { hero: 'boromir-captain-of-the-white-tower', options: ['Shield'], with: [[12, 'warrior-of-minas-tirith', 'Shield and spear'], [2, 'warrior-of-minas-tirith', 'Shield'], [1, 'warrior-of-minas-tirith', 'Banner']] },
        { hero: 'irolas', with: [[4, 'citadel-guard', 'Longbow'], [4, 'citadel-guard', 'Spear'], [3, 'warrior-of-minas-tirith', 'Bow']] },
      ],
      750: [
        { hero: 'boromir-captain-of-the-white-tower', options: ['Shield'], with: [[8, 'warrior-of-minas-tirith', 'Shield and spear'], [6, 'warrior-of-minas-tirith', 'Shield'], [1, 'warrior-of-minas-tirith', 'Banner']] },
        { hero: 'faramir', options: ['Horse', 'Shield'], with: [[8, 'knight-of-minas-tirith']] },
        { hero: 'irolas', with: [[4, 'citadel-guard', 'Longbow'], [4, 'citadel-guard', 'Spear'], [4, 'warrior-of-minas-tirith', 'Bow']] },
      ],
    },
  },
  {
    id: 'riders-of-the-mark',
    name: 'Riders of the Mark',
    army: 'Kingdom of Rohan',
    side: 'Good',
    about: "All cavalry: Théoden's Royal Guard and Éomer's Riders, charging for +1 Strength.",
    lists: {
      500: [
        { hero: 'theoden', options: ['Snowmane with armour', 'Shield'], with: [[4, 'rohan-royal-guard', 'Horse and throwing spears']] },
        { hero: 'eomer', options: ['Firefoot'], with: [[6, 'rider-of-rohan']] },
        { hero: 'captain-of-rohan', options: ['Horse'], with: [[2, 'rider-of-rohan'], [1, 'rider-of-rohan', 'Throwing spears']] },
      ],
      750: [
        { hero: 'theoden', options: ['Snowmane with armour', 'Exchange armour for heavy armour', 'Shield'], with: [[5, 'rohan-royal-guard', 'Horse and throwing spears']] },
        { hero: 'eomer', options: ['Firefoot', 'Shield'], with: [[8, 'rider-of-rohan']] },
        { hero: 'gamling', options: ['Royal Standard of Rohan', 'Horse'], with: [[4, 'rider-of-rohan']] },
        { hero: 'eowyn', options: ['Horse', 'Armour', 'Shield'], with: [[3, 'rider-of-rohan']] },
      ],
    },
  },
  {
    id: 'golden-wood',
    name: 'The Golden Wood',
    army: 'Lothlorien',
    side: 'Good',
    about: "Galadhrim shields and spears in front, Haldir's archers behind, and the Lady or Lord of the wood at the centre.",
    lists: {
      500: [
        { hero: 'celeborn-lord-of-lothlorien', with: [[6, 'galadhrim-warrior', 'Shield and Elven spear'], [4, 'galadhrim-warrior', 'Shield'], [1, 'galadhrim-warrior', 'Banner'], [3, 'guard-of-the-galadhrim-court']] },
        { hero: 'haldir-galadhrim-captain', options: ['Heavy armour', 'Elf bow', 'Elven cloak'], with: [[6, 'lothlorien-warrior', 'Elf bow'], [2, 'galadhrim-warrior', 'Shield and Elven spear'], [3, 'lothlorien-warrior', 'Wood Elf spear']] },
      ],
      750: [
        { hero: 'galadriel-lady-of-lothlorien', options: ['Mirror of Galadriel'], with: [[10, 'galadhrim-warrior', 'Shield and Elven spear'], [1, 'galadhrim-warrior', 'Banner'], [3, 'guard-of-the-galadhrim-court']] },
        { hero: 'haldir-galadhrim-captain', options: ['Heavy armour', 'Elf bow', 'Elven cloak'], with: [[6, 'lothlorien-warrior', 'Elf bow'], [1, 'wood-elf-sentinel'], [3, 'galadhrim-warrior', 'Shield and Elven spear']] },
        { hero: 'rumil-warden-of-caras-galadhon', with: [[3, 'galadhrim-knight', 'Shield'], [3, 'galadhrim-warrior', 'Shield'], [4, 'lothlorien-warrior', 'Elf bow']] },
      ],
    },
  },
  {
    id: 'last-homely-house',
    name: 'The Last Homely House',
    army: 'Rivendell',
    side: 'Good',
    about: "Elrond's spear wall with Arwen's knights at 500; at 750 Elrond and his sons lead a host of Rivendell Knights.",
    lists: {
      500: [
        { hero: 'elrond', with: [[9, 'rivendell-warrior', 'Shield and Elven spear'], [4, 'rivendell-warrior', 'Elf bow'], [1, 'rivendell-warrior', 'Banner']] },
        { hero: 'arwen', options: ['Asfaloth'], with: [[3, 'rivendell-knight', 'Shield']] },
      ],
      750: [
        { hero: 'elrond', options: ['Horse'], with: [[6, 'rivendell-knight', 'Shield'], [1, 'rivendell-knight', 'Exchange Elven lance for banner']] },
        { hero: 'elladan', options: ['Horse'], with: [[5, 'rivendell-knight', 'Shield']] },
        { hero: 'elrohir', options: ['Horse'], with: [[4, 'rivendell-knight', 'Shield']] },
      ],
    },
  },
  {
    id: 'sons-of-durin',
    name: 'Sons of Durin',
    army: 'Kingdom of Khazad-Dum',
    side: 'Good',
    about: "A Dwarf King and his Khazâd Guard, Mardin's Iron Guard and dwarf bows; Durin himself leads at 750.",
    lists: {
      500: [
        { hero: 'dwarf-king', with: [[6, 'khazad-guard'], [4, 'dwarf-warrior', 'Shield'], [1, 'dwarf-warrior', 'Banner'], [4, 'dwarf-warrior', 'Dwarf bow']] },
        { hero: "mardin-the-king's-ward", with: [[4, 'iron-guard'], [5, 'dwarf-warrior', 'Shield'], [2, 'dwarf-warrior', 'Two-handed weapon'], [1, 'dwarf-warrior'], [3, 'dwarf-ranger', 'Dwarf longbow']] },
      ],
      750: [
        { hero: 'durin-king-of-khazad-dum', with: [[6, 'khazad-guard'], [6, 'dwarf-warrior', 'Shield'], [1, 'dwarf-warrior', 'Banner'], [5, 'dwarf-warrior', 'Dwarf bow']] },
        { hero: "mardin-the-king's-ward", with: [[4, 'iron-guard'], [6, 'dwarf-warrior', 'Shield'], [2, 'dwarf-warrior', 'Two-handed weapon'], [3, 'dwarf-ranger', 'Dwarf longbow']] },
        { hero: 'dwarf-captain', with: [[4, 'dwarf-warrior', 'Shield'], [2, 'dwarf-warrior', 'Two-handed weapon'], [2, 'dwarf-ranger', 'Dwarf longbow']] },
      ],
    },
  },
  {
    id: 'north-kingdom',
    name: 'The North Kingdom',
    army: 'Arnor',
    side: 'Good',
    about: "Arvedui's shield wall and rangers, with knights on the flank and Rangers of the North alongside.",
    lists: {
      500: [
        { hero: 'arvedui-last-king-of-arnor', with: [[12, 'warrior-of-arnor'], [1, 'warrior-of-arnor', 'Swap spear and shield for banner'], [5, 'ranger-of-arnor']] },
        { hero: 'captain-of-arnor', with: [[7, 'knight-of-arnor'], [3, 'warrior-of-arnor']] },
        { hero: 'ranger-of-the-north', options: ['Armour', 'Spear'] },
        { hero: 'ranger-of-the-north', options: ['Armour', 'Spear'] },
      ],
      750: [
        { hero: 'arvedui-last-king-of-arnor', with: [[12, 'warrior-of-arnor'], [1, 'warrior-of-arnor', 'Swap spear and shield for banner'], [5, 'ranger-of-arnor']] },
        { hero: 'argadir', with: [[8, 'knight-of-arnor']] },
        { hero: 'malbeth-the-seer', with: [[6, 'warrior-of-arnor'], [4, 'ranger-of-arnor']] },
        { hero: 'captain-of-arnor', with: [[4, 'knight-of-arnor'], [2, 'warrior-of-arnor']] },
      ],
    },
  },
  {
    id: 'host-of-mordor',
    name: 'Host of Mordor',
    army: 'Legions of Mordor',
    side: 'Evil',
    about: "Gothmog's Morannon Orcs and a Mordor Troll; at 750 a Ringwraith on a Fell Beast leads from the sky.",
    lists: {
      500: [
        { hero: 'gothmog', with: [[1, 'mordor-troll'], [1, 'morannon-orc', 'Banner'], [4, 'morannon-orc', 'Shield and spear'], [5, 'morannon-orc', 'Shield'], [4, 'morannon-orc', 'Spear']] },
        { hero: 'morannon-orc-captain', with: [[5, 'morannon-orc', 'Shield'], [4, 'morannon-orc', 'Spear']] },
      ],
      750: [
        { hero: 'ringwraith', options: ['2A / 2M / 14W / 2F'], with: [[1, 'morannon-orc', 'Banner'], [3, 'morannon-orc', 'Shield and spear'], [3, 'morannon-orc', 'Shield'], [3, 'morannon-orc', 'Spear']] },
        { hero: 'gothmog', with: [[1, 'mordor-troll'], [1, 'morannon-orc', 'Banner'], [3, 'morannon-orc', 'Shield and spear'], [4, 'morannon-orc', 'Shield'], [3, 'morannon-orc', 'Spear']] },
        { hero: 'morannon-orc-captain', with: [[4, 'morannon-orc', 'Shield'], [4, 'morannon-orc', 'Spear']] },
      ],
    },
  },
  {
    id: 'white-hand',
    name: 'The White Hand',
    army: 'Muster of Isengard',
    side: 'Evil',
    about: "Saruman's Uruk-hai: pikes behind shields, Berserkers to break the line and a few crossbows.",
    lists: {
      500: [
        { hero: 'saruman', with: [[6, 'uruk-hai-warrior', 'Pike'], [5, 'uruk-hai-warrior', 'Shield'], [1, 'uruk-hai-warrior', 'Banner'], [2, 'uruk-hai-berserker']] },
        { hero: 'uruk-hai-captain', with: [[4, 'uruk-hai-warrior', 'Pike'], [4, 'uruk-hai-warrior', 'Shield'], [1, 'uruk-hai-warrior', 'Crossbow']] },
      ],
      750: [
        { hero: 'saruman', with: [[6, 'uruk-hai-warrior', 'Pike'], [5, 'uruk-hai-warrior', 'Shield'], [1, 'uruk-hai-warrior', 'Banner'], [4, 'uruk-hai-berserker']] },
        { hero: 'uruk-hai-captain', with: [[6, 'uruk-hai-warrior', 'Pike'], [3, 'uruk-hai-warrior', 'Shield'], [3, 'uruk-hai-warrior', 'Crossbow']] },
        { hero: 'uruk-hai-captain', with: [[6, 'uruk-hai-warrior', 'Pike'], [3, 'uruk-hai-warrior', 'Shield'], [3, 'uruk-hai-warrior', 'Crossbow']] },
      ],
    },
  },
  {
    id: 'goblin-town',
    name: 'Goblin-town',
    army: 'Goblin-town',
    side: 'Evil',
    about: 'The Goblin King and his jailers with a horde of goblins, every Goblin Hero leading six more than usual.',
    lists: {
      500: [
        { hero: 'the-goblin-king', with: [[16, 'goblin-warrior'], [4, 'goblin-warrior', 'Two-handed weapon']] },
        { hero: 'grinnah-goblin-jailer', with: [[14, 'goblin-warrior'], [2, 'goblin-warrior', 'Two-handed weapon']] },
        { hero: 'goblin-captain', with: [[10, 'goblin-warrior'], [4, 'goblin-warrior', 'Two-handed weapon']] },
      ],
      750: [
        { hero: 'the-goblin-king', with: [[18, 'goblin-warrior'], [6, 'goblin-warrior', 'Two-handed weapon']] },
        { hero: 'grinnah-goblin-jailer', with: [[14, 'goblin-warrior'], [4, 'goblin-warrior', 'Two-handed weapon']] },
        { hero: 'the-goblin-scribe', with: [[14, 'goblin-warrior'], [4, 'goblin-warrior', 'Two-handed weapon']] },
        { hero: 'goblin-captain', with: [[12, 'goblin-warrior']] },
        { hero: 'goblin-captain', with: [[8, 'goblin-warrior'], [1, 'goblin-warrior', 'Two-handed weapon']] },
      ],
    },
  },
  {
    id: 'dread-of-angmar',
    name: 'The Dread of Angmar',
    army: 'Shadows of Angmar',
    side: 'Evil',
    about: 'Spirits and orcs: the Shadow of Rhudaur, Barrow-wights, Spectres and Werewolves; Gûlavhar joins at 750.',
    lists: {
      500: [
        { hero: 'the-shadow-of-rhudaur', with: [[1, 'angmar-orc-warrior', 'Banner'], [5, 'angmar-orc-warrior', 'Shield'], [4, 'angmar-orc-warrior', 'Spear'], [2, 'spectre'], [3, 'angmar-warg-rider', 'Shield and throwing spears']] },
        { hero: 'shade', with: [[4, 'angmar-orc-warrior', 'Shield'], [4, 'angmar-orc-warrior', 'Spear'], [4, 'angmar-orc-warrior', 'Orc bow']] },
        { hero: 'barrow-wight', with: [[3, 'spectre'], [1, 'werewolf']] },
      ],
      750: [
        { hero: 'gulavhar-the-terror-of-arnor', with: [[1, 'angmar-orc-warrior', 'Banner'], [7, 'angmar-orc-warrior', 'Shield'], [7, 'angmar-orc-warrior', 'Spear'], [3, 'spectre']] },
        { hero: 'the-shadow-of-rhudaur', with: [[5, 'angmar-orc-warrior', 'Shield'], [5, 'angmar-orc-warrior', 'Spear'], [4, 'angmar-orc-warrior', 'Orc bow']] },
        { hero: 'barrow-wight', with: [[2, 'spectre'], [2, 'werewolf']] },
        { hero: 'angmar-orc-captain', with: [[4, 'angmar-warg-rider', 'Shield and throwing spears']] },
      ],
    },
  },
  {
    id: 'serpent-horde',
    name: 'The Serpent Horde',
    army: 'The Serpent Horde',
    side: 'Evil',
    about: "Suladân's Serpent Riders and Guard with poisoned Haradrim bows, half the warriors carrying bows.",
    lists: {
      500: [
        { hero: 'suladan-the-serpent-lord', options: ['Armoured horse'], with: [[4, 'serpent-rider'], [6, 'serpent-guard'], [1, 'haradrim-warrior', 'Banner'], [7, 'haradrim-warrior', 'Bow']] },
        { hero: 'haradrim-chieftain', with: [[3, 'haradrim-warrior', 'Spear'], [3, 'haradrim-warrior', 'Bow']] },
        { hero: 'haradrim-taskmaster', with: [[2, 'haradrim-warrior', 'Spear'], [2, 'haradrim-warrior', 'Bow'], [1, 'haradrim-warrior']] },
      ],
      750: [
        { hero: 'suladan-the-serpent-lord', options: ['Armoured horse'], with: [[6, 'serpent-rider'], [6, 'serpent-guard'], [1, 'haradrim-warrior', 'Banner'], [5, 'haradrim-warrior', 'Bow']] },
        { hero: 'raza-fang-of-the-serpent', with: [[6, 'serpent-guard'], [6, 'haradrim-warrior', 'Bow']] },
        { hero: 'haradrim-chieftain', with: [[6, 'haradrim-warrior', 'Spear'], [5, 'haradrim-warrior', 'Bow']] },
        { hero: 'haradrim-taskmaster', with: [[6, 'haradrim-warrior', 'Spear'], [4, 'haradrim-warrior', 'Bow']] },
      ],
    },
  },
  {
    id: 'hordes-of-gundabad',
    name: 'Hordes of Gundabad',
    army: 'Army of Gundabad',
    side: 'Evil',
    about: "Azog's armoured Gundabad Orcs and Berserkers; at 750 a Gundabad Troll and goblin mercenaries join.",
    lists: {
      500: [
        { hero: 'azog-the-defiler', with: [[6, 'gundabad-orc-warrior', 'Shield'], [6, 'gundabad-orc-warrior', 'Spear'], [1, 'gundabad-orc-warrior', 'Banner and shield'], [2, 'gundabad-berserker']] },
        { hero: 'gundabad-orc-captain', with: [[4, 'gundabad-orc-warrior', 'Shield'], [3, 'gundabad-orc-warrior', 'Spear']] },
      ],
      750: [
        { hero: 'azog-the-defiler', with: [[6, 'gundabad-orc-warrior', 'Shield'], [6, 'gundabad-orc-warrior', 'Spear'], [1, 'gundabad-orc-warrior', 'Banner and shield'], [2, 'gundabad-berserker'], [1, 'gundabad-berserker', 'Two-handed weapon']] },
        { hero: 'gundabad-orc-captain', with: [[1, 'gundabad-troll'], [4, 'gundabad-orc-warrior', 'Shield'], [4, 'gundabad-orc-warrior', 'Spear']] },
        { hero: 'goblin-mercenary-captain', with: [[9, 'goblin-mercenary']] },
      ],
    },
  },
];

/** A premade army's list at the size closest to `points`, as saved-list entries: each hero leads the followers listed after it. */
export function premadeRoster(catalog: Catalog, id: string, points: number): { entries: WarbandEntry[]; leader?: string } | null {
  const p = PREMADE.find(x => x.id === id);
  if (!p) return null;
  const ids = catalog.armies[p.army]?.units ?? [];
  const find = (slug: string) => ids.find(u => u.endsWith(`] ${slug}`));
  const optionIds = (unit: CatalogUnit, names: string[]) => names.flatMap(n => unit.options.find(o => o.name.toLowerCase() === n.toLowerCase())?.id ?? []);
  const entries: WarbandEntry[] = [];
  for (const band of p.lists[premadeSize(points)]) {
    const heroId = find(band.hero);
    if (!heroId) continue;
    const key = `p${entries.length}`;
    entries.push({ key, unitId: heroId, count: 1, optionIds: optionIds(catalog.units[heroId], band.options ?? []) });
    for (const [count, slug, ...options] of band.with ?? []) {
      const unitId = find(slug);
      if (unitId) entries.push({ key: `p${entries.length}`, unitId, count, optionIds: optionIds(catalog.units[unitId], options), lead: key });
    }
  }
  // The first warband's hero leads the army.
  return { entries, leader: entries[0]?.key };
}
