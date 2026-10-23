import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// The Elves of Mirkwood (Flies and Spiders, part 2): the table, drawn in our own way from the scenario's map, and where
// the cast starts. Inches from the north-west corner of a 4' by 4' table. The overgrown floor of Mirkwood: great
// gnarled trees on mounds of roots and stones, crooked lesser trees in tangles of undergrowth, boulders, and a long
// rocky ridge running down from the north-east of the middle. The Dwarves and Bilbo start in the middle.
// (Heights and where they come from are in plans/the-elves-of-mirkwood-audit.md.)

export const BOARD = 48;
/** How tall the great trunks stand, and the lesser trees with their undergrowth (as in The Unseen Hero). */
export const TRUNK_HEIGHT = 8;
export const TREE_HEIGHT = 6;
/** The mounds of roots and stones under the great trees, and the rocky ridge. */
export const ROOTS_HEIGHT = 0.5;
export const RIDGE_HEIGHT = 1;
/** Thorin's Company sets up within 6" of the middle of the table. */
export const MIDDLE = { x: 24, y: 24, r: 6 };
/** The Spiders set up, and come back from their nest, at least 10" from every Good model. */
export const NEST_GAP = 10;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The great trees: the mound of roots each stands on (middle, size, turn), and how wide its trunk is. */
export const GREAT_TREES: { id: string; roots: [number, number, number, number, number]; trunk: number }[] = [
  { id: 'nw', roots: [3.8, 4.4, 5.6, 6, 0], trunk: 2.4 },
  { id: 'n', roots: [19.8, 2.6, 3.2, 3.6, 0], trunk: 1.8 },
  { id: 'nnw', roots: [25, 11, 5, 5.6, 0], trunk: 2.4 },
  { id: 'ne', roots: [37, 6, 6, 7, 0], trunk: 2.8 },
  { id: 'ene', roots: [44, 11, 4.2, 4.2, 0], trunk: 2 },
  { id: 'e', roots: [36.2, 19.5, 4.5, 5.5, 0], trunk: 2.2 },
  { id: 'ee', roots: [44, 20, 6, 5, 0], trunk: 2.4 },
  { id: 'w', roots: [14.5, 23.2, 5, 5, 0], trunk: 2.2 },
  { id: 'wsw', roots: [3.5, 24.8, 5.5, 3.6, -10], trunk: 1.8 },
  { id: 'sw', roots: [10.3, 27.5, 4.7, 6, 0], trunk: 2.2 },
  { id: 'ww', roots: [2.6, 34, 4, 5.5, 0], trunk: 1.8 },
  { id: 's', roots: [22.8, 35.3, 5.5, 6, 0], trunk: 2.4 },
  { id: 'ssw', roots: [5, 44.5, 6, 6, 0], trunk: 2.6 },
  { id: 'sss', roots: [19.7, 45.2, 3.5, 4, 0], trunk: 1.8 },
  { id: 'se', roots: [44.8, 38.8, 5.5, 5.5, 0], trunk: 2.4 },
  { id: 'sse', roots: [40.2, 44.5, 4, 5, 20], trunk: 2 },
];

/** The lesser trees and their undergrowth: middle, size, turn. */
export const TREES: [number, number, number, number, number][] = [
  [14, 3, 4, 4.5, 0],
  [9.5, 3, 3, 5, 0],
  [9.8, 10.5, 4, 4.6, 0],
  // The fallen tree lying across the north-west.
  [13.8, 13.2, 9, 3, 10],
  [4.5, 15.5, 4.5, 4, 0],
  [3.2, 19.8, 4, 5, 0],
  [11.6, 18, 3.6, 3.6, 0],
  [34, 12.7, 5, 5.2, 0],
  // The tangle in the middle, where the Dwarves are.
  [24.7, 26, 4, 5, 0],
  [6.5, 32, 5, 3.6, 30],
  [12, 33.3, 6.5, 4, 20],
  [18, 30, 6, 4.5, 15],
  [7.8, 38.3, 4.5, 3.5, -20],
  [15.7, 39, 6, 4, 0],
  [20, 40.3, 3.5, 3, 0],
  [14.7, 43.6, 2.7, 2.7, 0],
  [39, 27.3, 4.5, 5, 0],
  [44, 27, 4, 4.5, 0],
  [34, 33.3, 3.5, 3, 0],
  [34, 40, 4, 4, 0],
  [29.8, 44, 3.5, 4.5, 0],
  [39, 38.3, 2.7, 4.5, 0],
  [29.5, 40.3, 3.5, 3.3, 0],
];

/** Boulders: middle, across, height. */
export const BOULDERS: [number, number, number, number][] = [
  [12.6, 9.2, 1.4, 1],
  [14.2, 8.4, 1, 1],
  [14.8, 18.2, 2.2, 1.5],
  [9.5, 39.6, 1.2, 1],
  [37.2, 29.6, 1, 1],
  [41.5, 25, 1, 1],
  [37, 33.6, 1.6, 1.5],
  [33.4, 31, 1.4, 1],
  [40.3, 32.5, 1.2, 1],
  [28.8, 37.5, 0.9, 1],
  [30.2, 37.2, 0.9, 1],
];

/** The long rocky ridge running down from the north-east of the middle: middle, length, width, turn. */
export const RIDGE: [number, number, number, number, number] = [31.6, 22.4, 12.4, 3.4, 53];

export function elvesTerrain(): NarrativeTerrain[] {
  const [rx, ry, rl, rw, rr] = RIDGE;
  return [
    piece({ id: 'ridge', kind: 'rock', x: rx, y: ry, w: rl, h: rw, rot: rr, height: RIDGE_HEIGHT, difficult: true, look: 'roots' }),
    // The mounds of roots and stones, then the great trunks on them.
    ...GREAT_TREES.map(t => piece({ id: `roots-${t.id}`, kind: 'rock', shape: 'circle', x: t.roots[0], y: t.roots[1], w: t.roots[2], h: t.roots[3], rot: t.roots[4], height: ROOTS_HEIGHT, difficult: true, look: 'roots' })),
    ...GREAT_TREES.map(t => piece({ id: `trunk-${t.id}`, kind: 'building', shape: 'circle', x: t.roots[0], y: t.roots[1], w: t.trunk, h: t.trunk, height: TRUNK_HEIGHT, sheer: true, look: 'trunk' })),
    ...TREES.map(([x, y, w, h, rot], i) => piece({ id: `trees-${i + 1}`, kind: 'wood', shape: 'circle', x, y, w, h, rot, height: TREE_HEIGHT, look: 'gnarled' })),
    ...BOULDERS.map(([x, y, d, height], i) => piece({ id: `boulder-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w: d, h: d * 0.9, height, look: 'stone' })),
  ];
}

/** The Dwarves of Thorin's Company, in the scenario's order. */
export const DWARVES = ['thorin', 'kili', 'fili', 'balin', 'dwalin', 'bifur', 'bofur', 'bombur', 'ori', 'nori', 'dori', 'oin', 'gloin'] as const;

/** Where the cast starts: the Dwarves round the middle, the Spiders out among the trees, the Elves kept aside. */
export function elvesCast(): CastMember[] {
  const ring = (i: number, n: number, r: number, turn: number): [number, number] => {
    const a = (i / n) * Math.PI * 2 + turn;
    return [+(MIDDLE.x + Math.cos(a) * r).toFixed(2), +(MIDDLE.y + Math.sin(a) * r).toFixed(2)];
  };
  const spiders: [number, number][] = [
    [8, 7.5],
    [24, 4.5],
    [31, 6],
    [43, 4],
    [42.5, 15.5],
    [6.5, 22.5],
    [43, 32.5],
    [11, 46],
    [27, 46],
    [35.5, 46],
  ];
  return [
    ...DWARVES.map((k, i): CastMember => ({
      key: k,
      side: 'good',
      unit: `[thorin's-company] ${k === 'thorin' ? 'thorin-oakenshield' : `${k}-the-dwarf`}`,
      ...(k === 'thorin' ? { options: ['Orcrist'] } : {}),
      place: { area: { circle: [MIDDLE.x, MIDDLE.y, MIDDLE.r] }, at: i < 5 ? ring(i, 5, 2.4, 0.3) : ring(i - 5, 9, 4.4, 0) },
    })),
    // Bilbo, there with them in the story (and on the map), with Sting and the Ring.
    { key: 'bilbo', side: 'good', unit: "[thorin's-company] bilbo-baggins", options: ['Sting', 'The One Ring'], place: { area: { circle: [MIDDLE.x, MIDDLE.y, MIDDLE.r] }, at: ring(8, 9, 4.4, 0) } },
    ...spiders.map(([x, y]): CastMember => ({ key: 'spider', side: 'evil', unit: '[fell-beings-of-mirkwood] mirkwood-giant-spider', place: { clear: NEST_GAP, at: [x, y] } })),
    { key: 'legolas', side: 'good', unit: '[rangers-of-mirkwood] legolas-greenleaf-prince-of-mirkwood', options: ['Elven cloak'], place: { aside: true } },
    { key: 'tauriel', side: 'good', unit: '[rangers-of-mirkwood] tauriel-ranger-of-mirkwood', options: ['Elf bow'], place: { aside: true } },
    ...Array.from({ length: 10 }, (): CastMember => ({ key: 'ranger', side: 'good', unit: '[rangers-of-mirkwood] mirkwood-ranger', place: { aside: true } })),
  ];
}
