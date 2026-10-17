import { STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { mmToIn } from '../shared/geometry.ts';
import { outline } from '../shared/sight.ts';

// The battle on the home page banner, as tokens on the River Crossing table (inches, book base sizes in mm).

export interface Token {
  origin: string;
  name: string;
  mm: number;
  x: number;
  y: number;
  hero?: boolean;
}

export const BOARD = STARTER_BOARDS.find(b => b.id === 'river-crossing')!;

// The river's real outline on the table, and where its north and south banks cross a line down the table at x.
const WATER = outline(starterTerrain(BOARD, () => 'water').find(t => t.kind === 'water')!);
function banks(x: number) {
  const ys: number[] = [];
  for (let i = 0, j = WATER.length - 1; i < WATER.length; j = i++) {
    const [a, b] = [WATER[i], WATER[j]];
    if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
  return { north: Math.min(...ys), south: Math.max(...ys) };
}

// Clear of the water's edge and its muddy shore.
const SHORE = 0.35;

/** A base `back` inches behind the front rank on one bank, its whole rim on dry ground. */
function onBank(side: 'north' | 'south', x: number, mm: number, back = 0) {
  const r = mmToIn(mm) / 2;
  const edges = [-r, -r / 2, 0, r / 2, r].map(dx => banks(x + dx)[side]);
  return side === 'north'
    ? { x, y: Math.min(...edges) - SHORE - r - back }
    : { x, y: Math.max(...edges) + SHORE + r + back };
}

const gondor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Gondor', name, mm, hero, ...at });
const mordor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Mordor', name, mm, hero, ...at });

// Mordor holds the north bank and Gondor the south, drawn up in ranks along the water's edge with their heroes in
// the middle of the front rank, facing each other across the river.
export const GOOD: Token[] = [
  gondor('Warrior of Minas Tirith', onBank('south', 26.6, 25)),
  gondor('Citadel Guard', onBank('south', 27.7, 25)),
  gondor('Citadel Guard', onBank('south', 28.8, 25)),
  gondor('Aragorn, King Elessar', onBank('south', 29.9, 25), 25, true),
  gondor('Boromir, Captain of the White Tower', onBank('south', 31.0, 25), 25, true),
  gondor('Citadel Guard', onBank('south', 32.1, 25)),
  gondor('Ranger of Gondor', onBank('south', 33.2, 25)),
  gondor('Ranger of Gondor', onBank('south', 34.3, 25)),
  gondor('Knight of Minas Tirith', onBank('south', 36.0, 40), 40),
  gondor('Warrior of Minas Tirith', onBank('south', 27.2, 25, 1.2)),
  gondor('Warrior of Minas Tirith', onBank('south', 28.3, 25, 1.2)),
  gondor('Osgiliath Veteran', onBank('south', 29.4, 25, 1.2)),
  gondor('Osgiliath Veteran', onBank('south', 30.5, 25, 1.2)),
  gondor('Warrior of Minas Tirith', onBank('south', 31.6, 25, 1.2)),
  gondor('Damrod', onBank('south', 32.7, 25, 1.2), 25, true),
];
export const EVIL: Token[] = [
  mordor('Mordor Troll', onBank('north', 27.2, 60), 60),
  mordor('Morannon Orc', onBank('north', 29.2, 25)),
  mordor('Gothmog', onBank('north', 30.3, 25), 25, true),
  mordor('Mordor Orc Captain', onBank('north', 31.4, 25), 25, true),
  mordor('Mordor Uruk-Hai', onBank('north', 32.5, 25)),
  mordor('Mordor Uruk-Hai', onBank('north', 33.6, 25)),
  mordor('Mordor Orc Warrior', onBank('north', 34.7, 25)),
  mordor('Mordor Warg Rider', onBank('north', 36.4, 40), 40),
  mordor('Mordor Orc Warrior', onBank('north', 29.8, 25, 1.2)),
  mordor('Mordor Orc Warrior', onBank('north', 30.9, 25, 1.2)),
  mordor('Morannon Orc', onBank('north', 32.0, 25, 1.2)),
  mordor('Morannon Orc', onBank('north', 33.1, 25, 1.2)),
  mordor('Mordor Orc Warrior', onBank('north', 34.2, 25, 1.2)),
];
