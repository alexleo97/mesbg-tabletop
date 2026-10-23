import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// The Unseen Hero (Flies and Spiders, part 1): the table, drawn in our own way from the scenario's map, and where the
// cast starts. Inches from the north-west corner of a 4' by 4' table. Great gnarled trees stand on mounds of roots and
// stones, lesser trees and their tangled undergrowth fill the gaps, and a low rocky bank cuts across the south-west.
// (Heights and where they come from are in plans/the-unseen-hero-audit.md.)

export const BOARD = 48;
/** How tall the trees stand: the great trees' trunks, and the lesser trees with their undergrowth. */
export const TRUNK_HEIGHT = 8;
export const TREE_HEIGHT = 6;
/** The mounds of roots and stones the great trees stand on, and the rocky bank. */
export const ROOTS_HEIGHT = 0.5;
export const BANK_HEIGHT = 0.5;
/** The webbed bundles: 25mm markers. */
export const MARKER = 25 / 25.4;
/** How far apart the bundles, and the Spiders, must be set up. */
export const APART = 6;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The great trees: the mound of roots each stands on (middle, size, turn), and its trunk (middle, across). */
export const GREAT_TREES: { id: string; roots: [number, number, number, number, number]; trunk: [number, number, number] }[] = [
  { id: 'nw', roots: [6.3, 6, 11.5, 6.5, 50], trunk: [6.8, 6.3, 2.2] },
  { id: 'n', roots: [20.8, 6.6, 10.2, 13.2, 0], trunk: [20.3, 6.7, 2.6] },
  { id: 'w', roots: [4.4, 20.6, 7.4, 10.8, -20], trunk: [4.2, 19.8, 2.2] },
  { id: 'e', roots: [41.5, 22.4, 11.6, 11.8, 0], trunk: [42.3, 22.8, 2.6] },
  { id: 'sw', roots: [9.2, 41.3, 14.5, 13.4, 0], trunk: [9.5, 40, 3] },
  { id: 'se', roots: [39.7, 41.8, 7.4, 9.6, 0], trunk: [40.5, 42.5, 2.2] },
];

/** The lesser trees and the undergrowth round them: middle, size, turn. */
export const TREES: [number, number, number, number, number][] = [
  [11.3, 18.5, 5.5, 12, -20],
  [22.4, 18.5, 5.5, 11.5, -38],
  [29.8, 19.2, 4, 4, 0],
  [15.2, 28, 8, 4.5, -25],
  [30.5, 30.7, 11, 6, -10],
  [40.3, 31.8, 7, 7.5, 0],
  [30.6, 37.8, 5, 5, 0],
  // The thicket strewn with stones in the north-east.
  [34.5, 10.8, 12.5, 7.5, 20],
];

/** Boulders: middle, size, turn, height. */
export const BOULDERS: [number, number, number, number, number, number][] = [
  [20.5, 29.5, 2.4, 2.2, 20, 1.5],
  [18.2, 31.2, 1, 1, 0, 1],
  [34.2, 7.8, 1.1, 1, 0, 1],
  [40.8, 7.3, 1, 0.9, 30, 1],
  [36.6, 35, 1, 1, 0, 1],
];

/** The low rocky bank across the south-west, as straight stretches along its line. */
export const BANK: [number, number][] = [
  [0, 31],
  [14, 32.2],
  [23, 37.3],
  [31.6, 42],
  [31.8, 48],
];

/** Where the webbed bundles start (the Evil player may move them before the battle). */
export const BUNDLES: [number, number][] = [
  [9.5, 9.6],
  [41.5, 28.7],
  [13.6, 45.4],
];

export function unseenTerrain(): NarrativeTerrain[] {
  const bank = BANK.slice(1).map((b, i) => {
    const a = BANK[i];
    const long = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return piece({ id: `bank-${i + 1}`, kind: 'rock', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, w: +(long + 0.6).toFixed(2), h: 1.2, rot: +((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI).toFixed(1), height: BANK_HEIGHT });
  });
  return [
    ...bank,
    // The mounds of roots and stones, then the great trunks on them.
    ...GREAT_TREES.map(t => piece({ id: `roots-${t.id}`, kind: 'rock', shape: 'circle', x: t.roots[0], y: t.roots[1], w: t.roots[2], h: t.roots[3], rot: t.roots[4], height: ROOTS_HEIGHT, difficult: true, look: 'roots' })),
    ...GREAT_TREES.map(t => piece({ id: `trunk-${t.id}`, kind: 'building', shape: 'circle', x: t.trunk[0], y: t.trunk[1], w: t.trunk[2], h: t.trunk[2], height: TRUNK_HEIGHT, sheer: true, look: 'trunk' })),
    ...TREES.map(([x, y, w, h, rot], i) => piece({ id: `trees-${i + 1}`, kind: 'wood', shape: 'circle', x, y, w, h, rot, height: TREE_HEIGHT })),
    ...BOULDERS.map(([x, y, w, h, rot, height], i) => piece({ id: `boulder-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height, look: 'stone' })),
    // The three webbed bundles: two hold Dwarves, one is a decoy (the Evil player's secret).
    ...BUNDLES.map(([x, y], i) => ({ ...piece({ id: `bundle-${i + 1}`, kind: 'objective', shape: 'circle', x, y, w: MARKER, h: MARKER, object: 'cocoon', hidden: true }), locked: false })),
  ];
}

/** The Unseen Hero: Bilbo against six Spiders, where the scenario starts them. */
export function unseenCast(): CastMember[] {
  const spiders: [number, number][] = [
    [14.5, 12.5],
    [27, 9],
    [35.5, 17.5],
    [25, 26],
    [19, 41],
    [36, 38],
  ];
  return [
    ...spiders.map(([x, y]): CastMember => ({ key: 'spider', side: 'evil', unit: '[fell-beings-of-mirkwood] mirkwood-giant-spider', place: { apart: APART, at: [x, y] } })),
    { key: 'bilbo', side: 'good', unit: "[thorin's-company] bilbo-baggins", options: ['Sting', 'The One Ring'], ring: true, place: { anyEdge: true, at: [24, BOARD - 25 / 25.4 / 2 - 0.02] } },
  ];
}
