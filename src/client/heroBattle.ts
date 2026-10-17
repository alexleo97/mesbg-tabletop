// The battle on the home page banner, as tokens on the River Crossing table (inches, book base sizes in mm).

export interface Token {
  origin: string;
  name: string;
  mm: number;
  x: number;
  y: number;
  hero?: boolean;
}

// A spot on the bridge: `t` inches along the deck (negative is the north end) and `s` across it.
const DECK = { x: 24, y: 24.5, a: (81 * Math.PI) / 180 };
const deck = (t: number, s: number) => ({ x: DECK.x + t * Math.cos(DECK.a) - s * Math.sin(DECK.a), y: DECK.y + t * Math.sin(DECK.a) + s * Math.cos(DECK.a) });

const gondor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Gondor', name, mm, hero, ...at });
const mordor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Mordor', name, mm, hero, ...at });

// Mordor storms the bridge from the north bank; Gondor holds the south end. The front ranks meet in base contact
// mid-span, the way a fight looks on the table.
export const GOOD: Token[] = [
  gondor('Aragorn, King Elessar', deck(0.5, -0.65), 25, true),
  gondor('Citadel Guard', deck(0.5, 0.65)),
  gondor('Boromir, Captain of the White Tower', deck(1.6, -0.65), 25, true),
  gondor('Warrior of Minas Tirith', deck(1.6, 0.65)),
  gondor('Warrior of Minas Tirith', deck(2.7, -0.65)),
  gondor('Warrior of Minas Tirith', deck(2.7, 0.65)),
  gondor('Knight of Minas Tirith', { x: 22.0, y: 27.7 }, 40),
  gondor('Ranger of Gondor', { x: 25.6, y: 28.6 }),
  gondor('Ranger of Gondor', { x: 26.8, y: 28.6 }),
  gondor('Ranger of Gondor', { x: 28.0, y: 28.7 }),
];
export const EVIL: Token[] = [
  mordor('Mordor Orc Captain', deck(-0.5, -0.65), 25, true),
  mordor('Mordor Uruk-Hai', deck(-0.5, 0.65)),
  mordor('Mordor Orc Warrior', deck(-1.6, -0.65)),
  mordor('Mordor Orc Warrior', deck(-1.6, 0.65)),
  mordor('Mordor Troll', deck(-3.3, 0), 60),
  mordor('Gothmog', { x: 26.0, y: 20.9 }, 25, true),
  mordor('Mordor Orc Warrior', { x: 27.3, y: 21.5 }),
  mordor('Mordor Orc Warrior', { x: 26.6, y: 22.4 }),
  mordor('Mordor Uruk-Hai', { x: 25.4, y: 21.9 }),
  mordor('Mordor Warg Rider', { x: 29.2, y: 22.5 }, 40),
  mordor('Mordor Warg Rider', { x: 30.9, y: 22.9 }, 40),
];
