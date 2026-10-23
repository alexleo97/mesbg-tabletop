import type { Point } from './geometry.ts';
import type { Area, CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Amon Hen: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches from the
// north-west corner of a 4' by 4' table. The Anduin runs down the west edge with the boats drawn up at its bank; the
// woods close in along the other three edges, and stands of trees and thickets fill the slopes between. The Seeing Seat
// is in the east, a paved platform with steps up to the dais and the seat on it. (Heights and where they come from are
// in plans/amon-hen-audit.md.)

export const BOARD = 48;
/** Where the river's east bank runs, every few inches down the table: [y, x]. */
const BANK: [number, number][] = [
  [-0.5, 3], [0, 3], [2, 2.8], [4, 2.6], [6, 3.2], [8, 3.9], [10, 4.4], [12, 4.6], [14, 4.4], [16, 3.8], [18, 3.2], [20, 2.6], [22, 2.1],
  [24, 2.4], [26, 2.2], [28, 1.4], [30, 0.9], [32, 0.6], [36, 0.5], [40, 0.8], [44, 1.6], [46, 2.2], [48, 2.6], [48.5, 2.7],
];
/** How far the river reaches into the table at a point down it. */
export function riverBank(y: number): number {
  for (let i = 1; i < BANK.length; i++) {
    const [y0, x0] = BANK[i - 1];
    const [y1, x1] = BANK[i];
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1);
  }
  return BANK[BANK.length - 1][1];
}
/** The boats, drawn up at the bank where the map marks them. */
export const BOATS = { id: 'boats', x: 1.6, y: 22.9, w: 1.6, h: 3.2 };
/** The Seeing Seat: its paved platform, the steps up to the dais, and the seat itself. */
export const SEAT = { x0: 36.7, y0: 22.9, x1: 42.8, y1: 26.5 };
/** The middle of the west edge, which the Merry, Pippin and Boromir set up between 6" and 12" from. */
export const WEST_MIDDLE: Point = { x: 0, y: 24 };

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** Stands of trees, measured off the map: [x, y, across]. */
const TREES: [number, number, number][] = [
  [28.3, 8.4, 3.6], [22.7, 9.7, 4.6], [16.5, 10.7, 5.1], [31.9, 13, 4.6], [13.5, 13.2, 2.8], [19.3, 15.6, 5.2], [33.7, 18, 4.7], [38.8, 18.7, 4.7],
  [23, 20.6, 4.5], [10.7, 26.1, 3], [16.5, 26.8, 3.5], [23, 30, 5.1], [28.6, 30.1, 5.2], [38.3, 30.2, 3.6], [6.1, 32.7, 4.9], [34.2, 32.3, 3.6],
  [23.5, 33.9, 2.8], [31.1, 35.6, 4.7], [11, 35.9, 2.6], [15.3, 37.1, 4.6], [37.6, 37.1, 4.6], [7.9, 37.7, 4.7], [27.3, 39.1, 4.8], [33.1, 38.6, 2.6],
];
/** Thickets of lower foliage, the paler patches on the map. */
const THICKETS: [number, number, number][] = [
  [31.9, 7, 1.6], [36.8, 8.8, 1.8], [38.2, 12.7, 4.1], [25.7, 14.3, 4.2], [14, 18.2, 2.3], [27.2, 18.6, 2.3], [32.2, 27, 2.3], [12.5, 32, 4.2],
  [16.9, 31.1, 2.3], [20.3, 37.6, 4.2], [18.1, 41, 2.3],
];
export const TREE_HEIGHT = 6;
export const THICKET_HEIGHT = 1.5;

export function amonTerrain(): NarrativeTerrain[] {
  // (The water's centreline halfway out to the bank, as far either side, from the piece's middle.)
  const river: [number, number, number][] = BANK.map(([y, x]) => [+(x / 2 - 2.5).toFixed(2), y - 24, Math.max(0.25, x / 2)]);
  return [
    // The Anduin along the west edge.
    piece({ id: 'anduin', kind: 'water', x: 2.5, y: 24, w: 5, h: 49, path: river }),
    // The woods closing in round the other three edges.
    piece({ id: 'woods-n', kind: 'wood', x: 28, y: 2.5, w: 40, h: 5, height: TREE_HEIGHT }),
    piece({ id: 'woods-e', kind: 'wood', x: 45.25, y: 23.5, w: 5.5, h: 37, height: TREE_HEIGHT }),
    piece({ id: 'woods-s', kind: 'wood', x: 28, y: 44.75, w: 40, h: 6.5, height: TREE_HEIGHT }),
    ...TREES.map(([x, y, d], i) => piece({ id: `trees-${i + 1}`, kind: 'wood', shape: 'circle', x, y, w: d, h: d, height: TREE_HEIGHT })),
    ...THICKETS.map(([x, y, d], i) => piece({ id: `thicket-${i + 1}`, kind: 'wood', shape: 'circle', x, y, w: d, h: d, height: THICKET_HEIGHT, look: 'brush' })),
    // The Seeing Seat: a paved platform a step up, steps rising east to the dais, and the seat on the dais.
    piece({ id: 'seeing-seat', kind: 'wall', x: (SEAT.x0 + SEAT.x1) / 2, y: (SEAT.y0 + SEAT.y1) / 2, w: SEAT.x1 - SEAT.x0, h: SEAT.y1 - SEAT.y0, height: 0.5, walk: true, look: 'stone' }),
    piece({ id: 'seat-steps', kind: 'road', x: 38.9, y: 24.7, w: 2.2, h: 2.6, rot: 90, stairs: true, look: 'stone' }),
    piece({ id: 'seat-dais', kind: 'wall', x: 41.4, y: 24.7, w: 2.8, h: 3.2, height: 1, walk: true, look: 'stone' }),
    piece({ id: 'seat', kind: 'building', shape: 'circle', x: 42.2, y: 24.7, w: 1, h: 1, height: 3.5, look: 'stone' }),
    // The boats.
    { ...piece({ id: BOATS.id, kind: 'objective', object: 'boat', x: BOATS.x, y: BOATS.y, w: BOATS.w, h: BOATS.h }) },
  ];
}

type Member = Omit<CastMember, 'place'>;
const CLOAK = ['Elven cloak'];

/** Amon Hen: the book's cast, where the scenario starts them. */
export function amonCast(): CastMember[] {
  const F = '[the-fellowship]';
  const U = "[lurtz's-scouts]";
  const corner: Area = { circle: [BOARD, 0, 6] };
  const shore: Area = { ring: [WEST_MIDDLE.x, WEST_MIDDLE.y, 6, 12] };
  const out: CastMember[] = [
    // Frodo and Aragorn at the foot of the Seeing Seat.
    { key: 'frodo', side: 'good', unit: `${F} frodo-baggins`, options: ['Sting', 'Mithril Coat'], gear: CLOAK, facing: 270, place: { against: 'seeing-seat', at: [36.19, 25.4] } },
    { key: 'aragorn', side: 'good', unit: `${F} aragorn-strider`, options: ['Bow'], gear: CLOAK, facing: 270, place: { against: 'seeing-seat', at: [36.19, 23.9] } },
    // Legolas and Gimli in the north-east corner.
    { key: 'legolas', side: 'good', unit: `${F} legolas`, gear: CLOAK, facing: 225, place: { area: corner, at: [44.6, 2.6] } },
    { key: 'gimli', side: 'good', unit: `${F} gimli`, gear: CLOAK, facing: 225, place: { area: corner, at: [45.6, 3.7] } },
    // Merry, Pippin and Boromir together, between 6" and 12" from the middle of the river bank.
    { key: 'boromir', side: 'good', unit: `${F} boromir-of-gondor`, gear: CLOAK, facing: 90, place: { area: shore, at: [9, 24], close: { keys: ['merry', 'pippin'], within: 1 } } },
    { key: 'merry', side: 'good', unit: `${F} meriadoc-brandybuck`, gear: CLOAK, facing: 90, place: { area: shore, at: [9.9, 23.3], close: { keys: ['boromir', 'pippin'], within: 1 } } },
    { key: 'pippin', side: 'good', unit: `${F} peregrin-took`, gear: CLOAK, facing: 90, place: { area: shore, at: [9.9, 24.7], close: { keys: ['boromir', 'merry'], within: 1 } } },
    // Sam, off on his own, at least 12" from the rest.
    { key: 'sam', side: 'good', unit: `${F} samwise-gamgee`, gear: CLOAK, facing: 0, place: { apart: 12, at: [21, 40.5] } },
  ];
  const times = (n: number, f: () => Member): Member[] => Array.from({ length: n }, f);
  const scouts = (): Member[] => [
    ...times(4, () => ({ key: 'scout', side: 'evil' as const, unit: `${U} uruk-hai-scout`, options: ['Shield'] })),
    ...times(4, () => ({ key: 'scout', side: 'evil' as const, unit: `${U} uruk-hai-scout`, options: ['Uruk-hai bow'] })),
    ...times(4, () => ({ key: 'scout', side: 'evil' as const, unit: `${U} uruk-hai-scout` })),
  ];
  // The Scout Captain and twelve Scouts round the Seeing Seat.
  const seat: Area = { piece: 'seeing-seat', within: 6 };
  const near = seatSlots();
  [{ key: 'scout-captain', side: 'evil' as const, unit: `${U} uruk-hai-scout-captain` }, ...scouts()].forEach((c, i) =>
    out.push({ ...c, facing: Math.round((Math.atan2(36 - near[i].x, near[i].y - 25) * 180) / Math.PI + 360) % 360, place: { area: seat, at: [near[i].x, near[i].y] } }),
  );
  // Lurtz and twelve more, between 6" and 12" from Boromir.
  const hunt: Area = { around: 'boromir', from: 6, to: 12 };
  const far = huntSlots({ x: 9, y: 24 });
  [{ key: 'lurtz', side: 'evil' as const, unit: `${U} lurtz` }, ...scouts()].forEach((c, i) => out.push({ ...c, facing: 270, place: { area: hunt, at: [far[i].x, far[i].y] } }));
  return out;
}

const R25 = 25 / 25.4 / 2;
const GAP = 2 * R25 + 0.06;

/** Spots wholly within 6" of the Seeing Seat's platform, round its north, east and south sides, clear of Frodo and Aragorn. */
export function seatSlots(): Point[] {
  const out: Point[] = [];
  const good = [
    { x: 36.25, y: 25.4 },
    { x: 36.2, y: 23.9 },
  ];
  const toSeat = (p: Point) => Math.hypot(Math.max(SEAT.x0 - p.x, 0, p.x - SEAT.x1), Math.max(SEAT.y0 - p.y, 0, p.y - SEAT.y1));
  for (let y = SEAT.y0 - 5; y <= SEAT.y1 + 5; y += GAP) {
    for (let x = SEAT.x0 - 3; x <= BOARD - R25; x += GAP) {
      const p = { x, y };
      const d = toSeat(p);
      // (Off the platform, a little way out from it, and well clear of the two at its foot.)
      if (d < 0.8 || d + R25 > 5.9 || good.some(g => Math.hypot(g.x - x, g.y - y) < 2.6)) continue;
      out.push(p);
    }
  }
  return out.sort((a, b) => toSeat(a) - toSeat(b)).slice(0, 13);
}

/** Spots between 6" and 12" from Boromir, on the land side, nearest 8" from him first. */
export function huntSlots(boromir: Point): Point[] {
  const out: Point[] = [];
  for (let y = boromir.y - 11; y <= boromir.y + 11; y += GAP) {
    for (let x = boromir.x + 5; x <= boromir.x + 12; x += GAP) {
      const d = Math.hypot(x - boromir.x, y - boromir.y);
      if (d - R25 - R25 < 6.3 || d + R25 > 12 + R25 - 0.1) continue;
      out.push({ x, y });
    }
  }
  return out.sort((a, b) => Math.abs(Math.hypot(a.x - boromir.x, a.y - boromir.y) - 8) - Math.abs(Math.hypot(b.x - boromir.x, b.y - boromir.y) - 8) || a.y - b.y).slice(0, 13);
}
