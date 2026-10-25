import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// The End of All Things: the two tables, drawn in our own way from the scenario's maps, and where the cast starts.
// The book plays it on two tables at once: a 2' by 2' one for the Crack of Doom, where Frodo and Sam climb Mount Doom,
// and a 4' by 4' one for the Black Gate, where the Captains of the West make their last stand. Here they stand side by
// side on one wide table, the Crack of Doom to the west and the Black Gate to the east, with a gap between them too
// wide for any bow, spell or shout to cross (14": the longest reach in either army is a bow's 24", from at most 12" in
// from the gap). Nothing can stand in the gap, nor go round it. Inches from the north-west corner of the whole table.
// (Heights and where they come from are in plans/the-end-of-all-things-audit.md.)

/** The Crack of Doom's table: 24" square, its north-west corner here (centred down the west end). */
export const DOOM = { x: 0, y: 12, size: 24 } as const;
/** The Black Gate's table: 48" square, its north-west corner here. */
export const GATE = { x: 38, y: 0, size: 48 } as const;
export const BOARD_W = GATE.x + GATE.size;
export const BOARD_H = GATE.size;

/** The middle of the Black Gate's table: the Good side sets up wholly within 6" of it, and goes no more than 12" from it. */
export const MIDDLE = { x: GATE.x + GATE.size / 2, y: GATE.size / 2 };
export const GOOD_REACH = 6;
export const STAND_REACH = 12;
/** The Evil side sets up at least this far from every Good model. */
export const EVIL_GAP = 6;

/** The Black Gate's walls and towers: far too tall and sheer to climb. */
export const GATE_WALL_HEIGHT = 8;
export const GATE_TOWER_HEIGHT = 10;
/** Boulders on the plain before the Gate and on Mount Doom's slope: knee high, or lower for the small ones. */
export const ROCK_HEIGHT = 1;
export const STONE_HEIGHT = 0.5;

/** From the Crack of Doom's own corner to the whole table's, and from the Black Gate's. */
const doom = (x: number, y: number): [number, number] => [+(DOOM.x + x).toFixed(2), +(DOOM.y + y).toFixed(2)];
const gate = (x: number, y: number): [number, number] => [+(GATE.x + x).toFixed(2), +(GATE.y + y).toFixed(2)];

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** A piece drawn as an outline (its corners, on the whole table): its middle and size are the box round it. */
function shaped(t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind'>, corners: [number, number][]): Terrain {
  const xs = corners.map(p => p[0]);
  const ys = corners.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  return piece({ ...t, x, y, w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2), poly: corners.map(([a, b]) => [+(a - x).toFixed(3), +(b - y).toFixed(3)] as [number, number]) });
}

// ——— The Crack of Doom ———

/**
 * The flank of Mount Doom, where the slope outside meets the mountain's side (on the Crack of Doom's own table, west to
 * east): to the north-east of it is the inside of the mountain, the fire of the Crack, with nothing to stand on but
 * the walkway out over it.
 */
export const FLANK: [number, number][] = [
  [0, 0.65], [0.8, 0.95], [1, 2.2], [2, 2.6], [2.75, 3.2], [3, 2.95], [3.5, 3.5], [4.75, 4.1], [5, 3.6], [5.25, 4.5], [6, 4.8],
  [6.75, 6], [7, 5.8], [7.25, 5.9], [7.5, 6.9], [8, 7.65], [8.75, 7.7], [9.5, 8.45], [9.75, 8.4], [10, 10.1], [10.5, 9.85],
  [10.75, 10.75], [11.5, 11.1], [12, 10.7], [12.25, 11.85], [13, 12.4], [13.5, 12], [14, 12.2], [14.25, 12.95], [15, 13.45],
  [15.25, 13.9], [15.5, 13.6], [16.25, 13.7], [17, 14.35], [18, 14.35], [18.5, 14.05], [18.75, 14.3], [19, 15.1], [19.5, 16.1],
  [20, 17], [20.5, 17.8], [21.25, 18.9], [21.75, 20.7], [22.25, 22], [23, 22.4], [24, 22.8],
];

/** The walkway out over the fire: from the door in the mountain's side to the precipice at its end (its middle line), and how wide. */
export const WALKWAY = { from: doom(10.04, 10.47), to: doom(17.2, 3.1), width: 3.1 };
/** The end of the walkway that counts as the edge of the precipice: Frodo's base must touch the walkway's edge this near its end. */
export const PRECIPICE_REACH = 1.5;

/** The path up the slope, from the south-west corner to the door (its middle line, and half its width there). */
export const TRAIL: [number, number][] = [
  [0.7, 23.9], [1, 22.6], [1.5, 20.8], [2.3, 19.4], [3.3, 18.5], [4.8, 17.8], [6.5, 17.5], [8.5, 17.4], [10.5, 17.2], [12.3, 16.9],
  [13.4, 16.3], [13.8, 15.6], [13.4, 15], [12.3, 14.6], [10.5, 14.3], [8.5, 14], [6.5, 13.6], [4.8, 13.3], [3.6, 13], [3, 12.4],
  [3.4, 11.6], [4.4, 10.9], [5.8, 10.3], [7.3, 9.9], [8.5, 9.65], [9.3, 9.6],
];
export const TRAIL_HALF = 0.75;

/** Boulders and stones on the slope: middle, size and turn (on the Crack of Doom's own table). */
export const SLOPE_ROCKS: [number, number, number, number, number][] = [
  [1.7, 4.6, 1, 2.2, 15],
  [2.1, 6.6, 0.9, 1.4, -10],
  [3, 7.3, 0.6, 0.6, 0],
  [2.3, 8.3, 0.9, 1.2, 10],
  [3.1, 9.3, 0.6, 0.6, 0],
  [1.9, 10.4, 1, 0.8, 0],
  [1.9, 11.4, 0.6, 0.6, 0],
  [2.6, 12.6, 0.6, 1, 0],
  [10.6, 10.7, 0.5, 0.5, 0],
  [0.3, 20, 0.5, 0.6, 0],
  [7.6, 18.4, 1, 0.6, 0],
  [8.7, 19.4, 1, 0.7, 10],
  [9.9, 20.1, 0.8, 0.7, 0],
  [11.7, 19.6, 1.2, 0.6, 15],
  [13, 18.2, 0.8, 0.6, 0],
  [14.3, 17.1, 0.5, 0.5, 0],
  [15.1, 15.4, 0.6, 0.6, 0],
  [15.4, 17.5, 0.6, 1.2, -10],
  [16.6, 18.4, 0.8, 0.6, 0],
  [16.7, 19.7, 0.7, 0.8, 0],
  [16.7, 20.9, 0.6, 0.8, 0],
  [18.5, 22.1, 0.6, 0.8, 0],
  [7, 23.6, 0.6, 0.5, 0],
];

/** Where Frodo and Sam start: Frodo in the south-west corner, touching both edges, and Sam beside him along the south edge. */
export const FRODO_START = doom(0.5, 23.5);
export const SAM_START = doom(1.52, 23.5);

// ——— The Black Gate ———

/** The Gate's two great towers, and its walls running from them to the north and south edges (on its own table: x0, y0, x1, y1). */
export const TOWERS: [number, number, number, number][] = [
  [42.8, 12.1, 48, 17.6],
  [42.8, 30.6, 48, 36],
];
export const GATE_WALLS: [number, number, number, number][] = [
  [43.5, 0, 45.2, 12.1],
  [43.5, 36, 45.2, 48],
];
/** The open gateway between the towers, where the Orcs pour out (along the east edge, on the whole table). */
export const GATEWAY: [number, number] = [GATE.y + 17.6, GATE.y + 30.6];

/** The boulders and stones strewn across the plain: middle, size and turn (on the Black Gate's own table). */
export const PLAIN_ROCKS: [number, number, number, number, number][] = [
  [10.2, 1, 0.8, 1.2, 0],
  [28, 3.2, 1.6, 0.8, 10],
  [27.2, 4.6, 1.3, 1.1, 0],
  [30, 4.2, 1.4, 0.9, 20],
  [32, 3, 1.6, 1, -10],
  [14.2, 7.4, 1, 0.8, 30],
  [11.8, 8.8, 1, 1.8, -10],
  [13.2, 10, 1, 1.6, 10],
  [19.5, 8.2, 1.2, 1.2, 20],
  [14, 12.6, 1.2, 1.1, 0],
  [13, 16.6, 0.6, 1.2, 15],
  [2.7, 17.6, 1.6, 1, -15],
  [19.6, 18.6, 0.7, 0.7, 0],
  [27.8, 15.1, 0.6, 0.5, 0],
  [34.8, 16.3, 0.4, 0.5, 0],
  [37.8, 18.5, 1.6, 1.2, 10],
  [37, 20, 0.5, 0.8, 30],
  [30.1, 24.4, 0.4, 0.4, 0],
  [31.6, 24.7, 0.4, 0.4, 0],
  [12.2, 25.6, 1.6, 1.3, 0],
  [14.3, 27.6, 1.8, 1.3, 10],
  [16.4, 29.4, 1.8, 1.5, 0],
  [20.3, 28.8, 2, 1.2, 20],
  [26.5, 29.9, 0.8, 1, 0],
  [24.8, 32.6, 1.4, 1.4, 20],
  [8.7, 32, 2, 6.8, 10],
  [10.8, 33.8, 0.8, 0.8, 0],
  [10.3, 36.2, 1, 1.6, 10],
  [12.2, 38.2, 1.1, 1.2, 0],
  [11.3, 40.5, 0.9, 1.3, 0],
  [10.8, 42.6, 1.3, 1.3, 0],
  [13.2, 44.6, 0.8, 1.6, -10],
  [14.5, 43.5, 0.6, 0.8, 0],
  [15, 46, 0.5, 0.5, 0],
  [26.7, 41.9, 1.6, 1.6, 0],
  [29.6, 42.3, 1.8, 1.1, 10],
  [32.4, 43.1, 1.6, 1.6, 0],
  [34.3, 40.6, 3, 1.1, -5],
  [37.6, 40.7, 1.6, 1.1, 0],
  [25.7, 45.3, 2.2, 1.1, -10],
];

/** The ends of a straight line, as a piece's middle, length and turn. */
const along = ([ax, ay]: [number, number], [bx, by]: [number, number]) => ({ x: (ax + bx) / 2, y: (ay + by) / 2, len: Math.hypot(bx - ax, by - ay), rot: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI });

/**
 * The walkway's shape, as the map draws it: a spur of rock broad where it leaves the mountain's side, narrowing along
 * its length to about 1.8", and ending in a rounded knob over the fire. Each row: how far along it (0 the door, 1 the
 * end) and how far it reaches either side of its middle line, north side then south.
 */
const SPUR: [number, number, number][] = [
  [0, 1.45, 1.55], [0.06, 1.3, 1.35], [0.14, 1.12, 1.2], [0.24, 1, 1.05], [0.36, 0.93, 0.96], [0.5, 0.9, 0.92],
  [0.62, 0.92, 0.9], [0.74, 0.98, 0.95], [0.84, 1.08, 1.02], [0.92, 1.05, 0.98], [0.97, 0.82, 0.78],
];

/** The walkway as a piece: along its middle line, in the shape of the spur. */
export const walkwayPiece = (): Terrain => {
  const a = along(WALKWAY.from, WALKWAY.to);
  const len = a.len;
  const at = (f: number) => -len / 2 + f * len;
  const north = SPUR.map(([f, n]) => [+at(f).toFixed(3), -n] as [number, number]);
  // (The rounded end: a half circle round the tip.)
  const tipR = SPUR[SPUR.length - 1][1];
  const cx = at(SPUR[SPUR.length - 1][0]);
  const end = Array.from({ length: 7 }, (_, i) => {
    const t = -Math.PI / 2 + ((i + 1) * Math.PI) / 8;
    return [+(cx + Math.cos(t) * Math.max(len / 2 - cx, 0.01)).toFixed(3), +(Math.sin(t) * tipR).toFixed(3)] as [number, number];
  });
  const south = [...SPUR].reverse().map(([f, , sth]) => [+at(f).toFixed(3), sth] as [number, number]);
  const poly = [...north, ...end, ...south];
  return piece({ id: 'walkway', kind: 'road', x: +a.x.toFixed(3), y: +a.y.toFixed(3), w: +len.toFixed(3), h: WALKWAY.width, rot: +a.rot.toFixed(2), look: 'doomway', poly });
};

export function doomTerrain(): NarrativeTerrain[] {
  const flank = FLANK.map(([x, y]) => doom(x, y));
  const [w, e] = [DOOM.x, DOOM.x + DOOM.size];
  const [n, s] = [DOOM.y, DOOM.y + DOOM.size];
  // The trail, as a band in the coordinates of a piece standing at the Crack of Doom's middle.
  const mid = { x: DOOM.x + DOOM.size / 2, y: DOOM.y + DOOM.size / 2 };
  const trail = TRAIL.map(([x, y]) => doom(x, y)).map(([x, y]) => [+(x - mid.x).toFixed(3), +(y - mid.y).toFixed(3), TRAIL_HALF] as [number, number, number]);
  return [
    // Nothing between and round the two tables: the floor, too far below to stand on.
    piece({ id: 'gap', kind: 'water', x: (e + GATE.x) / 2, y: BOARD_H / 2, w: GATE.x - e, h: BOARD_H, deep: true, difficult: false, look: 'void' }),
    piece({ id: 'gap-north', kind: 'water', x: (w + e) / 2, y: n / 2, w: e - w, h: n, deep: true, difficult: false, look: 'void' }),
    piece({ id: 'gap-south', kind: 'water', x: (w + e) / 2, y: (s + BOARD_H) / 2, w: e - w, h: BOARD_H - s, deep: true, difficult: false, look: 'void' }),
    // The Crack of Doom: the ashen slope outside, the fire inside the mountain, the walkway over it, the path up.
    shaped({ id: 'slope', kind: 'road', look: 'ashslope' }, [...flank, [e, s], [w, s]]),
    shaped({ id: 'fire', kind: 'water', deep: true, difficult: false, look: 'lava' }, [[w, n], [e, n], ...[...flank].reverse()]),
    walkwayPiece(),
    piece({ id: 'trail', kind: 'road', x: mid.x, y: mid.y, w: DOOM.size, h: DOOM.size, path: trail, look: 'ashpath' }),
    ...SLOPE_ROCKS.map(([x, y, rw, rh, rot], i) => {
      const [px, py] = doom(x, y);
      return piece({ id: `slope-rock-${i + 1}`, kind: 'rock', shape: 'circle', x: px, y: py, w: rw, h: rh, rot, height: Math.max(rw, rh) >= 1 ? ROCK_HEIGHT : STONE_HEIGHT, look: 'cinder' });
    }),
    // The Black Gate: the ash and dust of the plain before it, its walls and towers along the east edge, and the rocks
    // strewn over the plain.
    shaped({ id: 'plain', kind: 'road', look: 'ashslope' }, [[GATE.x, GATE.y], [GATE.x + GATE.size, GATE.y], [GATE.x + GATE.size, GATE.y + GATE.size], [GATE.x, GATE.y + GATE.size]]),
    ...GATE_WALLS.map(([x0, y0, x1, y1], i) => {
      const [a, b] = gate(x0, y0);
      const [c, d] = gate(x1, y1);
      return piece({ id: `gate-wall-${i + 1}`, kind: 'wall', x: (a + c) / 2, y: (b + d) / 2, w: +(c - a).toFixed(2), h: +(d - b).toFixed(2), height: GATE_WALL_HEIGHT, sheer: true, look: 'blackgate' });
    }),
    ...TOWERS.map(([x0, y0, x1, y1], i) => {
      const [a, b] = gate(x0, y0);
      const [c, d] = gate(x1, y1);
      return piece({ id: `gate-tower-${i + 1}`, kind: 'building', x: (a + c) / 2, y: (b + d) / 2, w: +(c - a).toFixed(2), h: +(d - b).toFixed(2), height: GATE_TOWER_HEIGHT, sheer: true, look: 'blackgate' });
    }),
    ...PLAIN_ROCKS.map(([x, y, rw, rh, rot], i) => {
      const [px, py] = gate(x, y);
      return piece({ id: `plain-rock-${i + 1}`, kind: 'rock', shape: 'circle', x: px, y: py, w: rw, h: rh, rot, height: Math.max(rw, rh) >= 1 ? ROCK_HEIGHT : STONE_HEIGHT, look: 'cinder' });
    }),
  ];
}

// ——— The cast ———

type Member = Omit<CastMember, 'place'>;
const many = (count: number, m: Member): Member[] => Array.from({ length: count }, () => ({ ...m }));

const W = '[men-of-the-west]';
const G = '[the-black-gate]';

/** The Captains of the West at the Black Gate. */
const HEROES: Member[] = [
  { key: 'aragorn', side: 'good', unit: `${W} aragorn-king-elessar` },
  // Gandalf's Staff: since his clash with the Witch-king he has no Staff of Power.
  { key: 'gandalf', side: 'good', unit: `${W} gandalf-the-white`, lost: ['Staff of Power'] },
  { key: 'legolas', side: 'good', unit: `${W} legolas` },
  { key: 'gimli', side: 'good', unit: `${W} gimli` },
  { key: 'eomer', side: 'good', unit: `${W} eomer` },
  { key: 'merry', side: 'good', unit: `${W} meriadoc-brandybuck`, options: ['Shield'] },
  { key: 'pippin', side: 'good', unit: `${W} peregrin-took` },
];
const BOWS: Member[] = [
  ...many(8, { key: 'gondor', side: 'good', unit: `${W} warrior-of-minas-tirith`, options: ['Bow'] }),
  ...many(8, { key: 'rohan', side: 'good', unit: `${W} warrior-of-rohan`, options: ['Bow'] }),
];
const BANNERS: Member[] = [
  { key: 'gondor', side: 'good', unit: `${W} warrior-of-minas-tirith`, options: ['Banner'] },
  { key: 'rohan', side: 'good', unit: `${W} warrior-of-rohan`, options: ['Banner'] },
];
const LINE: Member[] = [
  ...many(8, { key: 'gondor', side: 'good', unit: `${W} warrior-of-minas-tirith`, options: ['Shield'] }),
  ...many(8, { key: 'gondor', side: 'good', unit: `${W} warrior-of-minas-tirith`, options: ['Shield and spear'] }),
  ...many(8, { key: 'rohan', side: 'good', unit: `${W} warrior-of-rohan`, options: ['Shield'] }),
  ...many(8, { key: 'rohan', side: 'good', unit: `${W} warrior-of-rohan`, options: ['Shield and throwing spears'] }),
];

/** The host of Mordor: its leaders, and 50 Morannon Orcs. */
const LEADERS: Member[] = [
  { key: 'mouth', side: 'evil', unit: `${G} mouth-of-sauron`, options: ['Armoured horse'] },
  // Greatest of the Trolls: Fearless, with a point more of Might, Will and Fate (the Black Gate's General profile is just that).
  { key: 'troll', side: 'evil', unit: `${G} mordor-troll-chieftain-general`, name: 'Mordor Troll Chieftain' },
  ...many(3, { key: 'captain', side: 'evil', unit: `${G} morannon-orc-captain`, options: ['Shield'] }),
];
const ORCS: Member[] = [
  ...many(12, { key: 'orc', side: 'evil', unit: `${G} morannon-orc`, options: ['Shield'] }),
  ...many(12, { key: 'orc', side: 'evil', unit: `${G} morannon-orc`, options: ['Spear'] }),
  ...many(12, { key: 'orc', side: 'evil', unit: `${G} morannon-orc`, options: ['Shield and spear'] }),
  ...many(12, { key: 'orc', side: 'evil', unit: `${G} morannon-orc` }),
  ...many(2, { key: 'orc', side: 'evil', unit: `${G} morannon-orc`, options: ['Banner'] }),
];

/** How far a point is from a piece (0 on it), for keeping the starting spots off the rocks and walls. */
function gapTo(t: Terrain, x: number, y: number): number {
  const a = (-t.rot * Math.PI) / 180;
  const dx = x - t.x;
  const dy = y - t.y;
  const u = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
  const v = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
  if (t.shape === 'circle') return Math.max(0, Math.hypot(dx, dy) - Math.max(t.w, t.h) / 2);
  return Math.hypot(Math.max(0, u - t.w / 2), Math.max(0, v - t.h / 2));
}

/** The pieces that stand in the way of a starting spot on the Black Gate's table. */
const obstacles = () => doomTerrain().filter(t => t.kind === 'rock' || t.kind === 'wall' || t.kind === 'building');

/**
 * Spots in staggered rows `pitch` apart that a model `r` across from its middle fits, nearest a point first, kept by
 * `fits` and clear of the rocks, the walls and each other.
 */
function spots(count: number, at: { x: number; y: number }, pitch: number, fits: (x: number, y: number) => boolean, r = 0.5, taken: [number, number, number][] = []): [number, number][] {
  const out: [number, number][] = [];
  const grid: [number, number][] = [];
  for (let j = -50; j <= 50; j++) for (let i = -50; i <= 50; i++) grid.push([+(at.x + i * pitch + (j % 2 ? pitch / 2 : 0)).toFixed(2), +(at.y + (j * pitch * Math.sqrt(3)) / 2).toFixed(2)]);
  grid.sort((p, q) => Math.hypot(p[0] - at.x, p[1] - at.y) - Math.hypot(q[0] - at.x, q[1] - at.y));
  const rocks = obstacles();
  for (const [x, y] of grid) {
    if (out.length >= count) break;
    if (!fits(x, y) || rocks.some(t => gapTo(t, x, y) < r + 0.05)) continue;
    if ([...out.map(([a, b]) => [a, b, 0.5] as [number, number, number]), ...taken].some(([a, b, rb]) => Math.hypot(a - x, b - y) < r + rb + 0.05)) continue;
    out.push([x, y]);
  }
  return out;
}

/** The widest spacing at which the Good side's 59 models still all fit wholly within 6" of the middle. */
function goodSpots(count: number): [number, number][] {
  const inside = (x: number, y: number) => Math.hypot(x - MIDDLE.x, y - MIDDLE.y) + 0.5 <= GOOD_REACH - 0.05;
  for (let pitch = 1.6; pitch > 1.05; pitch -= 0.02) {
    // (The grid shifted about a little, for the arrangement that fits the most.)
    for (const [dx, dy] of [[0, 0], [0.3, 0], [0, 0.3], [0.3, 0.3], [0.6, 0.2], [0.2, 0.6]]) {
      const out = spots(count, { x: MIDDLE.x + dx, y: MIDDLE.y + dy }, pitch, inside);
      if (out.length >= count) return out;
    }
  }
  return spots(count, MIDDLE, 1.05, inside);
}

/** Room for the Troll Chieftain's 60mm base and the Mouth of Sauron's horse, so nobody stands touching them. */
const BIG = 1.25;

/**
 * Where the cast starts. Frodo and Sam in the south-west corner of the Crack of Doom. At the Black Gate the Captains
 * of the West stand on their hill in the middle, spread as wide as the 6" circle lets them: the archers and the two
 * banners in the middle, the heroes round them, and the shields and spears on the outside. The host of Mordor has
 * marched out of the Gate: it stands in a great crescent round the east of the hill, 2" apart, at least 6" from every
 * Good model, its leaders in the front rank.
 */
export function doomCast(): CastMember[] {
  const good = [...BOWS, ...BANNERS, ...HEROES, ...LINE];
  const g = goodSpots(good.length);
  // (Innermost first: the archers in the middle, the heroes round them, the line outside.)
  const byReach = [...g].sort((p, q) => Math.hypot(p[0] - MIDDLE.x, p[1] - MIDDLE.y) - Math.hypot(q[0] - MIDDLE.x, q[1] - MIDDLE.y));
  const rim = (x: number, y: number) => Math.hypot(x - MIDDLE.x, y - MIDDLE.y);
  // The hosts' front rank: at least 6" from the Good side's bases (whose edges reach at most 6" from the middle).
  const clear = (r: number) => (x: number, y: number) => rim(x, y) >= GOOD_REACH + EVIL_GAP + r + 0.15 && x >= MIDDLE.x - 2 && x + r <= GATE.x + 42.6 && y - r >= 0.3 && y + r <= BOARD_H - 0.3;
  const front = { x: MIDDLE.x + 13.6, y: MIDDLE.y };
  const big = spots(2, front, 4, clear(BIG), BIG);
  const taken: [number, number, number][] = big.map(([x, y]) => [x, y, BIG]);
  const host = spots(LEADERS.length - 2 + ORCS.length, front, 2, clear(0.5), 0.5, taken);
  // (The captains stand among the front rank, spread along it; the Orcs fill in round them.)
  const front3 = [...host].sort((p, q) => rim(p[0], p[1]) - rim(q[0], q[1])).slice(0, 12).sort((p, q) => p[1] - q[1]);
  const captains = [front3[1], front3[6], front3[10]];
  const rest = host.filter(p => !captains.includes(p));
  const evil = { within: { box: [GATE.x, 0, BOARD_W, BOARD_H] as [number, number, number, number] } };
  return [
    { key: 'frodo', side: 'good', unit: '[the-fellowship] frodo-baggins', place: { at: FRODO_START } },
    // Sam carries Sting, which Frodo no longer has.
    { key: 'sam', side: 'good', unit: '[the-fellowship] samwise-gamgee', gear: ['Sting'], place: { at: SAM_START } },
    ...good.map((c, i): CastMember => ({ ...c, place: { area: { circle: [MIDDLE.x, MIDDLE.y, GOOD_REACH] }, at: byReach[i] } })),
    ...LEADERS.slice(0, 2).map((c, i): CastMember => ({ ...c, facing: 270, place: { clear: EVIL_GAP, at: big[i], ...evil } })),
    ...LEADERS.slice(2).map((c, i): CastMember => ({ ...c, facing: 270, place: { clear: EVIL_GAP, at: captains[i], ...evil } })),
    ...ORCS.map((c, i): CastMember => ({ ...c, facing: 270, place: { clear: EVIL_GAP, at: rest[i], ...evil } })),
    // Gollum is kept aside: the Ring's lure brings him out.
    { key: 'gollum', side: 'evil', unit: '[goblin-town] gollum', place: { aside: true } },
  ];
}
