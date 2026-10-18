import { botRoster } from './botList.ts';
import type { Catalog } from './catalog.ts';
import type { WarbandEntry } from './warbands.ts';

/** Ready-made armies for players and the solo opponent (Good ones seeded below 20): the same list every time for a given size. */
export const PREMADE: { id: string; name: string; army: string; seed: number }[] = [
  { id: 'white-tower', name: 'The White Tower', army: 'Minas Tirith', seed: 11 },
  { id: 'riders-of-the-mark', name: 'Riders of the Mark', army: 'Kingdom of Rohan', seed: 12 },
  { id: 'golden-wood', name: 'The Golden Wood', army: 'Lothlorien', seed: 13 },
  { id: 'last-homely-house', name: 'The Last Homely House', army: 'Rivendell', seed: 14 },
  { id: 'sons-of-durin', name: 'Sons of Durin', army: 'Kingdom of Khazad-Dum', seed: 15 },
  { id: 'north-kingdom', name: 'The North Kingdom', army: 'Arnor', seed: 16 },
  { id: 'host-of-mordor', name: 'Host of Mordor', army: 'Legions of Mordor', seed: 21 },
  { id: 'white-hand', name: 'The White Hand', army: 'Muster of Isengard', seed: 22 },
  { id: 'goblin-town', name: 'Goblin-town', army: 'Goblin-town', seed: 23 },
  { id: 'dread-of-angmar', name: 'The Dread of Angmar', army: 'Shadows of Angmar', seed: 24 },
  { id: 'serpent-horde', name: 'The Serpent Horde', army: 'The Serpent Horde', seed: 25 },
  { id: 'hordes-of-gundabad', name: 'Hordes of Gundabad', army: 'Army of Gundabad', seed: 26 },
];

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function premadeRoster(catalog: Catalog, id: string, points: number): { entries: WarbandEntry[]; leader?: string } | null {
  const p = PREMADE.find(x => x.id === id);
  return p ? botRoster(catalog, p.army, points, seeded(p.seed)) : null;
}
