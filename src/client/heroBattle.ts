// The battle on the home page banner, as tokens on the River Crossing table (inches, book base sizes in mm).

export interface Token {
  origin: string;
  name: string;
  mm: number;
  x: number;
  y: number;
  hero?: boolean;
}

// The river's course on the River Crossing table, and a spot `off` inches north (negative) or south of its middle.
const COURSE: [number, number][] = [[17, 21], [24, 24.5], [31, 27], [40, 24]];
const riverY = (x: number) => {
  const i = Math.max(0, COURSE.findIndex(([cx], k) => k > 0 && x <= cx) - 1);
  const [[x0, y0], [x1, y1]] = [COURSE[i], COURSE[i + 1]];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
};
const bank = (x: number, off: number) => ({ x, y: riverY(x) + off });

const gondor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Gondor', name, mm, hero, ...at });
const mordor = (name: string, at: { x: number; y: number }, mm = 25, hero = false): Token => ({ origin: 'Mordor', name, mm, hero, ...at });

// Gondor and Mordor drawn up on either bank, facing each other across the river with their heroes in the front rank.
const FRONT = 2.75;
const BACK = 3.85;
export const GOOD: Token[] = [
  gondor('Knight of Minas Tirith', bank(26.2, FRONT + 0.3), 40),
  gondor('Warrior of Minas Tirith', bank(27.8, FRONT)),
  gondor('Warrior of Minas Tirith', bank(28.9, FRONT)),
  gondor('Aragorn, King Elessar', bank(30.0, FRONT), 25, true),
  gondor('Boromir, Captain of the White Tower', bank(31.1, FRONT), 25, true),
  gondor('Citadel Guard', bank(32.2, FRONT)),
  gondor('Citadel Guard', bank(33.3, FRONT)),
  gondor('Knight of Minas Tirith', bank(34.9, FRONT + 0.3), 40),
  gondor('Warrior of Minas Tirith', bank(28.3, BACK)),
  gondor('Warrior of Minas Tirith', bank(29.4, BACK)),
  gondor('Ranger of Gondor', bank(30.5, BACK)),
  gondor('Ranger of Gondor', bank(31.6, BACK)),
  gondor('Warrior of Minas Tirith', bank(32.7, BACK)),
];
export const EVIL: Token[] = [
  mordor('Mordor Troll', bank(26.4, -FRONT - 0.7), 60),
  mordor('Mordor Orc Warrior', bank(28.3, -FRONT)),
  mordor('Mordor Uruk-Hai', bank(29.4, -FRONT)),
  mordor('Gothmog', bank(30.5, -FRONT), 25, true),
  mordor('Mordor Orc Captain', bank(31.6, -FRONT), 25, true),
  mordor('Mordor Uruk-Hai', bank(32.7, -FRONT)),
  mordor('Mordor Orc Warrior', bank(33.8, -FRONT)),
  mordor('Mordor Warg Rider', bank(35.4, -FRONT - 0.3), 40),
  mordor('Mordor Orc Warrior', bank(28.8, -BACK)),
  mordor('Mordor Orc Warrior', bank(29.9, -BACK)),
  mordor('Mordor Orc Warrior', bank(31.0, -BACK)),
  mordor('Mordor Orc Warrior', bank(32.1, -BACK)),
  mordor('Mordor Orc Warrior', bank(33.2, -BACK)),
];
