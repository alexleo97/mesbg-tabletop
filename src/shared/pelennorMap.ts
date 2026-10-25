import { guessBase } from './importList.ts';
import type { Area, CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Battle of Pelennor Fields: the table, drawn in our own way from the scenario's map, and where the cast starts. An 8'
// by 6' table: along the north edge the outer wall of Minas Tirith, with the Great Gate between its two towers in the
// middle, broken open; everything else is the open, trampled Pelennor, with a few outcrops of rock. Inches from the
// north-west corner. (Heights and where they come from are in plans/battle-of-pelennor-fields-audit.md.)

export const BOARD_W = 96;
export const BOARD_H = 72;

/** The wall of Minas Tirith: how deep it runs in from the north edge, and how high (far too high to climb). */
export const WALL_DEPTH = 3.2;
export const WALL_HEIGHT = 12;
/** The two towers either side of the Gate, and how high they stand. */
export const TOWER_HEIGHT = 14;
export const TOWERS: [number, number, number, number][] = [
  [38.2, 0, 45.5, 5.6],
  [50.4, 0, 57.7, 5.6],
];
/** The Great Gate between them: the gateway through the wall, broken open (x0, y0, x1, y1). */
export const GATEWAY: [number, number, number, number] = [45.5, 0, 50.4, 4.6];
/** The Gates of Minas Tirith objective: models within this far of the gateway. */
export const GATES_REACH = 12;

/** The Mordor force sets up between 24" and 48" from the north edge, and at least 24" from the east and west edges. */
export const MORDOR_ZONE: [number, number, number, number] = [24, 24, 72, 48];
/** Rohan, wholly within 6" of the east edge; the Dead of Dunharrow wholly within 6" of the west edge, and 24" from the north and south. */
export const ROHAN_ZONE: [number, number, number, number] = [BOARD_W - 6, 0, BOARD_W, BOARD_H];
export const DEAD_ZONE: [number, number, number, number] = [0, 24, 6, 48];

/** The four Objective Markers, one at each corner of the Mordor force's zone, and how near a model must be to hold one. */
export const MARKERS: [number, number][] = [
  [MORDOR_ZONE[0], MORDOR_ZONE[1]],
  [MORDOR_ZONE[2], MORDOR_ZONE[1]],
  [MORDOR_ZONE[0], MORDOR_ZONE[3]],
  [MORDOR_ZONE[2], MORDOR_ZONE[3]],
];
export const MARKER_SIZE = 1;
export const MARKER_REACH = 3;

/** Outcrops of rock on the Pelennor, where the map has them: middle, size and turn; and how high (a Jump to get over). */
export const ROCKS: [number, number, number, number, number][] = [
  // Below the walls, east of the Gate.
  [65.5, 5, 2.2, 3.6, 0],
  [57.6, 8.2, 3.3, 2.4, 15],
  [56.8, 13, 3.6, 1.6, -35],
  // A long ridge of rock in the west of the Mordor force's ground.
  [30.1, 29.3, 1.6, 5.2, 10],
  // A tumble of boulders by the south-west Objective.
  [20.5, 44.2, 3.2, 2, 10],
  [17.2, 46.2, 3.4, 2.3, -10],
  [22.6, 45.4, 1.8, 1.3, 0],
  // East, before Rohan's ground.
  [87.2, 25, 2, 4, -25],
];
export const ROCK_HEIGHT = 1;
/** Broken stone scattered by the south-east Objective: low, and rough going. */
export const RUBBLE: [number, number, number, number, number] = [77.6, 43.6, 3, 1.1, 8];
export const RUBBLE_HEIGHT = 0.5;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** A box as a piece: its middle and size. */
const box = ([x0, y0, x1, y1]: [number, number, number, number]) => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2) });

/** A tower's outline, as the map draws it: an octagon, its corners cut back this far. */
const CUT = 1.7;
const octagon = (w: number, h: number): [number, number][] => [
  [-w / 2 + CUT, -h / 2],
  [w / 2 - CUT, -h / 2],
  [w / 2, -h / 2 + CUT],
  [w / 2, h / 2 - CUT],
  [w / 2 - CUT, h / 2],
  [-w / 2 + CUT, h / 2],
  [-w / 2, h / 2 - CUT],
  [-w / 2, -h / 2 + CUT],
];

export function pelennorTerrain(): NarrativeTerrain[] {
  return [
    // The Pelennor itself: open fields, trampled and scorched by the siege.
    piece({ id: 'fields', kind: 'road', x: BOARD_W / 2, y: BOARD_H / 2, w: BOARD_W, h: BOARD_H, look: 'pelennor' }),
    // The wall of the city, running into each tower (the towers cover the joins).
    piece({ id: 'wall-west', kind: 'wall', ...box([0, 0, TOWERS[0][0] + CUT, WALL_DEPTH]), height: WALL_HEIGHT, sheer: true, look: 'mtwall' }),
    piece({ id: 'wall-east', kind: 'wall', ...box([TOWERS[1][2] - CUT, 0, BOARD_W, WALL_DEPTH]), height: WALL_HEIGHT, sheer: true, look: 'mtwall' }),
    ...TOWERS.map((t, i) => {
      const b = box(t);
      return piece({ id: `tower-${i ? 'east' : 'west'}`, kind: 'building', ...b, height: TOWER_HEIGHT, sheer: true, look: 'mttower', poly: octagon(b.w, b.h) });
    }),
    // The Great Gate, broken open: its way through the wall is open ground.
    piece({ id: 'gate', kind: 'road', ...box(GATEWAY), look: 'mtgate' }),
    ...ROCKS.map(([x, y, w, h, rot], i) => piece({ id: `rock-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height: ROCK_HEIGHT, look: 'pelrock' })),
    piece({ id: 'rubble', kind: 'rock', shape: 'circle', x: RUBBLE[0], y: RUBBLE[1], w: RUBBLE[2], h: RUBBLE[3], rot: RUBBLE[4], height: RUBBLE_HEIGHT, difficult: true, look: 'pelrubble' }),
    ...MARKERS.map(([x, y], i) => piece({ id: `objective-${i + 1}`, kind: 'objective', shape: 'circle', x, y, w: MARKER_SIZE, h: MARKER_SIZE })),
  ];
}

// ——— The cast ———

type Member = Omit<CastMember, 'place'>;
const many = (count: number, m: Member): Member[] => Array.from({ length: count }, () => ({ ...m }));

const P = '[defenders-of-the-pelennor]';
const L = '[legions-of-mordor]';

/** Gondor: Gandalf on Shadowfax with Pippin, Irolas, 24 Warriors of Minas Tirith and 6 Citadel Guard, who come out of the Gate later. */
export const GONDOR: Member[] = [
  { key: 'gandalf', side: 'good', unit: `${P} gandalf-the-white`, options: ['Shadowfax', 'Pippin'] },
  { key: 'pippin', side: 'good', unit: `${P} peregrin-took`, rides: 'gandalf' },
  { key: 'irolas', side: 'good', unit: `${P} irolas` },
  ...many(8, { key: 'gondor', side: 'good', unit: `${P} warrior-of-minas-tirith`, options: ['Shield'] }),
  ...many(8, { key: 'gondor', side: 'good', unit: `${P} warrior-of-minas-tirith`, options: ['Shield and spear'] }),
  ...many(8, { key: 'gondor', side: 'good', unit: `${P} warrior-of-minas-tirith`, options: ['Bow'] }),
  ...many(3, { key: 'citadel', side: 'good', unit: `${P} citadel-guard`, options: ['Spear'] }),
  ...many(3, { key: 'citadel', side: 'good', unit: `${P} citadel-guard`, options: ['Longbow'] }),
];

/** Rohan: Théoden, Éomer, Éowyn with Merry riding behind her, Gamling with the Royal Standard, and 24 Riders. */
const ROHAN_HEROES: Member[] = [
  { key: 'theoden', side: 'good', unit: `${P} theoden`, options: ['Snowmane with armour', 'Exchange armour for heavy armour', 'Shield'] },
  { key: 'gamling', side: 'good', unit: `${P} gamling`, options: ['Royal Standard of Rohan', 'Horse'] },
  // (Éomer has throwing spears and armoured Firefoot, and no shield, though the profile offers one by default.)
  { key: 'eomer', side: 'good', unit: `${P} eomer`, options: ['Firefoot with armour', 'Throwing spears'], stats: { D: 6 }, lost: ['Shield'] },
  { key: 'eowyn', side: 'good', unit: `${P} eowyn`, options: ['Merry', 'Horse', 'Armour', 'Shield'] },
];
const MERRY: Member = { key: 'merry', side: 'good', unit: '[men-of-the-west] meriadoc-brandybuck', options: ['Shield'], rides: 'eowyn' };
const RIDERS: Member[] = [...many(8, { key: 'rider', side: 'good', unit: `${P} rider-of-rohan`, options: ['Throwing spears'] }), ...many(16, { key: 'rider', side: 'good', unit: `${P} rider-of-rohan` })];

/** The Dead of Dunharrow: Aragorn, Legolas and Gimli, the King of the Dead, his two Heralds and 20 Warriors of the Dead. */
const DEAD_HEROES: Member[] = [
  { key: 'aragorn', side: 'good', unit: `${P} aragorn-strider`, options: ['Anduril, Flame of the West', 'Elven Cloak'] },
  { key: 'king', side: 'good', unit: `${P} king-of-the-dead` },
  { key: 'legolas', side: 'good', unit: `${P} legolas`, options: ['Armour', 'Elven Cloak'] },
  { key: 'gimli', side: 'good', unit: `${P} gimli`, options: ['Elven Cloak'] },
  ...many(2, { key: 'herald', side: 'good', unit: `${P} herald-of-the-dead` }),
];
const DEAD: Member[] = [...many(10, { key: 'dead', side: 'good', unit: `${P} warrior-of-the-dead`, options: ['Shield'] }), ...many(10, { key: 'dead', side: 'good', unit: `${P} warrior-of-the-dead`, options: ['Spear'] })];

/** The Witch-king on his armoured Fell Beast, with the Crown of Morgul: 3 Attacks, 3 Might, 18 Will and 3 Fate. */
export const WITCH_KING: Member = {
  key: 'witch-king',
  side: 'evil',
  unit: `${L} the-witch-king-of-angmar`,
  options: ['3A / 3M / 18W / 3F', 'Armoured Fell Beast', 'Crown of Morgul'],
  stats: { A: 3 },
  might: 3,
  will: 18,
  fate: 3,
};

/** The three Mûmakil, each with 12 Haradrim in its Howdah: the War Leader's own Royal War Mûmak, and two War Mûmakil of Harad with their Commanders. */
export const MUMAKIL = ['royal-mumak', 'mumak-1', 'mumak-2'] as const;
const crew = (beast: string): Member[] => many(12, { key: `crew-${beast}`, side: 'evil', unit: `${L} haradrim-warrior`, options: ['Bow'], rides: beast });
export const HARAD: Member[] = [
  // (The Royal War Mûmak carries the War Leader in place of a Commander.)
  { key: 'royal-mumak', side: 'evil', unit: `${L} war-mumak-of-harad`, name: 'Royal War Mûmak', commander: false },
  { key: 'war-leader', side: 'evil', unit: `${L} mumak-war-leader`, rides: 'royal-mumak' },
  ...crew('royal-mumak'),
  { key: 'mumak-1', side: 'evil', unit: `${L} war-mumak-of-harad` },
  ...crew('mumak-1'),
  { key: 'mumak-2', side: 'evil', unit: `${L} war-mumak-of-harad` },
  ...crew('mumak-2'),
];

/** The Mordor force: two hosts of Orcs, each with its leaders and a Troll, and between them the Haradrim and the Easterlings. */
const orcs = (): Member[] =>
  [['Shield'], ['Spear'], ['Shield and spear'], []].flatMap(o => many(6, { key: 'orc', side: 'evil', unit: `${L} morannon-orc`, ...(o.length ? { options: o } : {}) }));
const EAST_HOST: Member[] = [{ key: 'gothmog', side: 'evil', unit: `${L} gothmog`, options: ['Warg'] }, { key: 'enforcer', side: 'evil', unit: `${L} gothmog's-enforcer` }, ...orcs()];
const WEST_HOST: Member[] = [{ key: 'guritz', side: 'evil', unit: `${L} guritz` }, ...orcs()];
const HARADRIM: Member[] = [
  { key: 'chieftain', side: 'evil', unit: `${L} haradrim-chieftain`, options: ['Bow'] },
  ...many(6, { key: 'haradrim', side: 'evil', unit: `${L} haradrim-warrior`, options: ['Spear'] }),
  ...many(6, { key: 'haradrim', side: 'evil', unit: `${L} haradrim-warrior`, options: ['Bow'] }),
];
const EASTERLINGS: Member[] = [
  { key: 'easterling-captain', side: 'evil', unit: `${L} easterling-captain` },
  ...many(4, { key: 'easterling', side: 'evil', unit: `${L} easterling-warrior`, options: ['Shield'] }),
  ...many(2, { key: 'easterling', side: 'evil', unit: `${L} easterling-warrior`, options: ['Easterling Halberd and shield'] }),
  ...many(4, { key: 'easterling', side: 'evil', unit: `${L} easterling-warrior`, options: ['Bow'] }),
];
const TROLL: Member = { key: 'troll', side: 'evil', unit: `${L} mordor-troll` };

/** How far a point is from a piece (0 on it), for keeping the starting spots off the rocks. */
function gapTo(t: Terrain, x: number, y: number): number {
  const a = (-t.rot * Math.PI) / 180;
  const dx = x - t.x;
  const dy = y - t.y;
  const u = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
  const v = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
  if (t.shape === 'circle') {
    // (An ellipse: near enough, how far outside it the point is along the line from its middle.)
    const k = Math.hypot(u / (t.w / 2), v / (t.h / 2));
    return k <= 1 ? 0 : Math.hypot(u, v) * (1 - 1 / k);
  }
  return Math.hypot(Math.max(0, u - t.w / 2), Math.max(0, v - t.h / 2));
}
const obstacles = () => pelennorTerrain().filter(t => t.kind === 'rock' || t.kind === 'wall' || t.kind === 'building' || t.kind === 'objective');

/** Half across, in inches, of the base a member of the cast stands on (a rider its mount's). */
export const reach = (m: Member) => {
  if (/fell beast|shadowfax|warg|horse|firefoot|snowmane/i.test((m.options ?? []).join(' ')) || /rider of rohan/.test(m.unit)) return 0.8;
  const b = guessBase(m.unit.replace(/^\[[^\]]+\] /, '').replace(/-/g, ' '));
  return Math.max(b.w, b.h) / 50.8;
};

/**
 * A body of troops in ranks: `count` spots `pitch` apart within a box, the front rank (nearest `front`, a side of the
 * box) filled first from its middle outwards, then the next rank back; clear of the rocks and the spots `taken`.
 */
function ranks(count: number, area: [number, number, number, number], front: 'north' | 'east' | 'south' | 'west', pitch: number, r: number, taken: [number, number, number][]): [number, number][] {
  const [x0, y0, x1, y1] = area;
  const across = front === 'north' || front === 'south';
  const mid = across ? (x0 + x1) / 2 : (y0 + y1) / 2;
  const rows: [number, number][][] = [];
  const depth = across ? y1 - y0 : x1 - x0;
  for (let k = 0; k * pitch <= depth - 2 * r; k++) {
    const d = r + 0.05 + k * pitch;
    const line = front === 'north' ? y0 + d : front === 'south' ? y1 - d : front === 'west' ? x0 + d : x1 - d;
    const row: [number, number][] = [];
    // (Every other rank is staggered half a pitch, so those behind see between those in front.)
    const shift = k % 2 ? pitch / 2 : 0;
    const lo = (across ? x0 : y0) + r + 0.05;
    const hi = (across ? x1 : y1) - r - 0.05;
    for (let i = 0; i < 60; i++) {
      for (const s of i ? [1, -1] : [1]) {
        const t = mid + shift + s * i * pitch;
        if (t < lo || t > hi) continue;
        row.push(across ? [+t.toFixed(2), +line.toFixed(2)] : [+line.toFixed(2), +t.toFixed(2)]);
      }
    }
    rows.push(row);
  }
  const rocks = obstacles();
  const out: [number, number][] = [];
  for (const row of rows)
    for (const [x, y] of row) {
      if (out.length >= count) return out;
      if (rocks.some(t => gapTo(t, x, y) < r + 0.1)) continue;
      if ([...out.map(([a, b]) => [a, b, r] as [number, number, number]), ...taken].some(([a, b, rb]) => Math.hypot(a - x, b - y) < r + rb + 0.1)) continue;
      out.push([x, y]);
    }
  return out;
}

const FACING = { north: 0, east: 90, south: 180, west: 270 } as const;

/**
 * Where the cast starts. The Mordor force holds the middle of the field in three bodies: Gothmog's Orcs facing east
 * towards the Rohirrim, Guritz's facing west towards the river and the Dead, and the Haradrim and Easterlings between
 * them facing the city, each leader in its front rank and each Troll behind its host. Rohan's riders are strung out
 * along the east edge in one long line for the charge, the King in the middle; the Dead of Dunharrow stand in ranks
 * along the west edge, their leaders in front. The Witch-king, the Mûmakil and the men of Gondor are kept aside.
 */
export function pelennorCast(): CastMember[] {
  const out: CastMember[] = [];
  const taken: [number, number, number][] = [];
  const zone = { box: MORDOR_ZONE };
  const body = (members: Member[], area: [number, number, number, number], front: keyof typeof FACING, pitch: number, place: Area = zone) => {
    const r = Math.max(...members.map(reach));
    const spots = ranks(members.length, area, front, pitch, r, taken);
    members.forEach((c, i) => {
      out.push({ ...c, facing: FACING[front], place: { area: place, at: spots[i] } });
      taken.push([...spots[i], reach(c)]);
    });
  };
  // Each host's Troll stands behind it, on its own (bigger) base.
  body([TROLL], [56, 33, 62, 39], 'east', 3, zone);
  body([TROLL], [34, 33, 40, 39], 'west', 3, zone);
  body(EAST_HOST, [58, 25, MORDOR_ZONE[2], 47], 'east', 2.3);
  body(WEST_HOST, [MORDOR_ZONE[0], 25, 38, 47], 'west', 2.3);
  body(EASTERLINGS, [40.5, 24, 47.5, 36], 'north', 2.2);
  body(HARADRIM, [48.5, 24, 56.5, 36], 'north', 2.2);
  // Rohan: one long line down the east edge, the King and his captains in the middle.
  const line = [...RIDERS.slice(0, 12), ...ROHAN_HEROES, ...RIDERS.slice(12)];
  const pitch = (BOARD_H - 12) / (line.length - 1);
  line.forEach((c, i) => {
    const at: [number, number] = [BOARD_W - 3, +(6 + i * pitch).toFixed(2)];
    out.push({ ...c, facing: FACING.west, place: { area: { box: ROHAN_ZONE }, at } });
    if (c.key === 'eowyn') out.push({ ...MERRY, place: { aside: true } });
  });
  // The Dead: three ranks along the west edge, the heroes in the front one.
  const dead = [...DEAD_HEROES, ...DEAD];
  const spots = ranks(dead.length, DEAD_ZONE, 'east', 2, 0.5, []);
  dead.forEach((c, i) => out.push({ ...c, facing: FACING.east, place: { area: { box: DEAD_ZONE }, at: spots[i] } }));
  // Kept aside until their time comes.
  out.push({ ...WITCH_KING, place: { aside: true } });
  for (const c of HARAD) out.push({ ...c, place: { aside: true } });
  for (const c of GONDOR) out.push({ ...c, place: { aside: true } });
  return out;
}
