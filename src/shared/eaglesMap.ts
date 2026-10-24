import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Out of the Frying Pan... And Into the Fire: the table, drawn in our own way from the scenario's map, and where the
// cast starts. Inches from the north-west corner of a 4' by 4' table. A stand of pines runs down the east of the
// table, each tree on its own woodland base or sharing one with a neighbour or two, with a rocky cliff edge beyond
// them along the east edge. The open ground to the west has rocky outcrops and a patch of brush with three pines in it.
// (Heights and where they come from are in plans/and-into-the-fire-audit.md.)

export const BOARD = 48;
/** How tall the pines stand, the rocky outcrops, and the broken rock along the cliff edge. */
export const PINE_HEIGHT = 6;
export const OUTCROP_HEIGHT = 1.5;
export const CLIFF_HEIGHT = 0.5;
/** How wide a pine's trunk is, as a share of its spread of branches. */
export const TRUNK_SHARE = 0.4;
/** The Evil side sets up wholly within 6" of the west edge. */
export const EVIL_ZONE: [number, number, number, number] = [0, 0, 6, BOARD];
/** How many trees the players nominate between them, a Dwarf Marker beside each. */
export const HIDING_TREES = 5;
/** A Dwarf Marker is a 25mm marker. */
export const MARKER_SIZE = 25 / 25.4;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The woodland bases the pines stand on: id, middle, size, turn. */
export const STANDS: [string, number, number, number, number, number][] = [
  ['a', 33.4, 1.3, 3, 2.6, 0],
  ['b', 38.8, 1.8, 6.6, 3.6, 8],
  ['c', 35.7, 5, 6.4, 4, -23],
  ['d', 40, 5.9, 2.6, 2.6, 0],
  ['e', 38.6, 8.9, 7, 3.6, 45],
  ['f', 35.4, 11.6, 3.6, 5.8, -25],
  ['g', 32.3, 15.4, 3.2, 3, 0],
  ['h', 38.9, 16.4, 7, 4.4, 15],
  ['i', 33.5, 18.4, 2.9, 3, 0],
  ['j', 37.6, 19.4, 5.6, 3.4, -14],
  ['k', 40.2, 22.3, 3.2, 2.8, 0],
  ['l', 35.1, 23.8, 3.6, 5.6, -13],
  ['m', 39.6, 27.2, 4.8, 5.2, 0],
  ['n', 34.3, 29.4, 6.8, 5, 20],
  ['o', 34.5, 34.6, 5.4, 3.4, -28],
  ['p', 40.5, 33, 3.2, 4.6, 0],
  ['q', 37.7, 37.1, 4.6, 3.8, -38],
  ['r', 32.7, 39.2, 3.6, 4.6, 37],
  ['s', 38, 40.6, 3.2, 3, 0],
  ['t', 41.1, 41.5, 2.6, 3, 0],
  ['u', 33, 42.7, 6.4, 3.8, -13],
  ['v', 36.1, 46.1, 2.8, 3.6, 0],
  ['w', 39.5, 45.7, 3.4, 3.6, 0],
  ['x', 33.5, 46.9, 3, 2.2, 0],
];

/** The patch of brush out on the open ground: middle, size, turn. */
export const BRUSH: [number, number, number, number, number] = [16.3, 40, 7.2, 4.4, -10];

/** The pines: middle and spread of branches. Their bases are worked out from STANDS (or the brush). */
export const PINES: [number, number, number][] = [
  [33.5, 1.3, 1.5],
  [37, 0.9, 2.2],
  [39.9, 1.9, 2.8],
  [37.8, 4, 1.6],
  [34.3, 5.5, 2.6],
  [40, 5.8, 2.2],
  [37.5, 7.5, 2.1],
  [40.2, 10.2, 2.3],
  [34.7, 10.1, 1.6],
  [36.2, 13.1, 2.6],
  [32.7, 15.2, 2],
  [40.6, 14.9, 2.1],
  [37.2, 16.4, 2.7],
  [41.2, 17.9, 1.6],
  [33.5, 18.2, 1.5],
  [36.3, 19.7, 2.4],
  [39.1, 19, 2.2],
  // Thorin's tree, the one nearest the middle of the open ground to the west (the map's dashed circle).
  [34.7, 22.3, 2],
  [40.1, 22.3, 2.2],
  [35.4, 25.3, 1.8],
  [40.5, 25.7, 2.6],
  [38.1, 27.2, 2.1],
  [40.3, 28.7, 1.6],
  [35.6, 27.8, 2],
  [32.5, 29.3, 2.8],
  [36.4, 30.9, 2.7],
  [40.1, 31.7, 1.5],
  [41, 34.1, 2],
  [35.8, 33.9, 1.9],
  [33, 35.4, 1.9],
  [38.6, 36.3, 2.4],
  [36.6, 38, 1.4],
  [33.4, 38, 1.9],
  [31.8, 40.3, 1.4],
  [37.9, 40.6, 2.3],
  [41, 41.5, 1.6],
  [34.5, 42.3, 2.4],
  [31.6, 43, 2.5],
  [36.1, 46.1, 1.9],
  [39.4, 45.6, 2.5],
  [33.4, 47.2, 1.4],
  // The three in the brush.
  [13.7, 39.6, 1.4],
  [15.7, 41.2, 2.2],
  [18.2, 39.2, 2.6],
];

/** Thorin's tree. */
export const THORINS_TREE = 'pine-18';

/** The rocky outcrops: middle, size, turn, height. */
export const OUTCROPS: [number, number, number, number, number, number][] = [
  [13.5, 6.6, 3.4, 4.6, 20, OUTCROP_HEIGHT],
  [4.4, 19.4, 5.2, 4.6, 0, 2],
  [12.6, 27.1, 3.6, 5.4, 0, OUTCROP_HEIGHT],
  [25.9, 24.7, 3.6, 4.6, 0, OUTCROP_HEIGHT],
  [9.4, 41.7, 6.6, 4.2, 25, OUTCROP_HEIGHT],
];

/** The broken rock at the top of the cliff, drawn as a line down the east edge of the table, and how wide it is. */
export const CLIFF_LINE: [number, number][] = [
  [47, -0.6],
  [46.7, 6],
  [47.1, 12],
  [46.6, 18],
  [46.9, 24],
  [46.5, 30],
  [47, 36],
  [46.8, 42],
  [47.1, 48.6],
];
export const CLIFF_WIDTH = 2.4;
const CLIFF_MIDDLE = { x: 46.9, y: BOARD / 2 };

export const pineId = (i: number) => `pine-${i + 1}`;

export function eaglesTerrain(): NarrativeTerrain[] {
  const [bx, by, bw, bh, br] = BRUSH;
  return [
    // The cliff edge: one winding band of broken rock, drawn along its line.
    piece({ id: 'cliff-edge', kind: 'cliff', x: CLIFF_MIDDLE.x, y: CLIFF_MIDDLE.y, w: 4, h: BOARD + 1.2, path: CLIFF_LINE.map(([x, y]) => [+(x - CLIFF_MIDDLE.x).toFixed(2), +(y - CLIFF_MIDDLE.y).toFixed(2), CLIFF_WIDTH / 2]), height: CLIFF_HEIGHT, difficult: true }),
    ...OUTCROPS.map(([x, y, w, h, rot, height], i) => piece({ id: `outcrop-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height })),
    piece({ id: 'brush', kind: 'wood', shape: 'circle', x: bx, y: by, w: bw, h: bh, rot: br, look: 'brush' }),
    ...STANDS.map(([id, x, y, w, h, rot]) => piece({ id: `stand-${id}`, kind: 'wood', shape: 'circle', x, y, w, h, rot, look: 'pinewood' })),
    // Each pine's trunk can't be walked through; its branches spread out over its base.
    ...PINES.map(([x, y, spread], i) => {
      const trunk = +Math.max(0.6, spread * TRUNK_SHARE).toFixed(2);
      return piece({ id: pineId(i), kind: 'building', shape: 'circle', x, y, w: trunk, h: trunk, height: PINE_HEIGHT, sheer: true, look: 'pine' });
    }),
  ];
}

/** Where the cast starts: the Evil side along the west edge, Thorin at his tree, and everyone else kept aside. */
export function eaglesCast(): CastMember[] {
  // The Warg Riders and Fell Wargs in two lines down the west edge, Azog and Fimbul in the middle, clear of the outcrop.
  const lane = [2.5, 5.4, 8.3, 11.2, 14.1, 23, 28, 31, 34, 37, 40, 43];
  const riders: [number, number][] = lane.map(y => [4.2, y]);
  const wargs: [number, number][] = lane.map(y => [1.6, y]);
  const zone = { box: EVIL_ZONE };
  return [
    { key: 'azog', side: 'evil', unit: "[azog's-hunters] azog-the-defiler", options: ['The White Warg'], place: { area: zone, at: [4.2, 25.4] } },
    { key: 'fimbul', side: 'evil', unit: "[azog's-hunters] fimbul-hunter-orc-captain", options: ['Fell Warg'], place: { area: zone, at: [1.6, 25.4] } },
    ...riders.map(([x, y]): CastMember => ({ key: 'rider', side: 'evil', unit: "[azog's-hunters] hunter-orc-warg-rider", place: { area: zone, at: [x, y] } })),
    ...wargs.map(([x, y]): CastMember => ({ key: 'warg', side: 'evil', unit: "[azog's-hunters] fell-warg", place: { area: zone, at: [x, y] } })),
    { key: 'thorin', side: 'good', unit: "[thorin's-company] thorin-oakenshield", options: ['Orcrist', 'The Oakenshield'], place: { rim: THORINS_TREE, angle: 200 } },
    { key: 'bilbo', side: 'good', unit: "[thorin's-company] bilbo-baggins", options: ['Sting', 'The One Ring'], place: { aside: true } },
    { key: 'gwaihir', side: 'good', unit: "[thorin's-company] gwaihir", place: { aside: true } },
    ...Array.from({ length: 4 }, (): CastMember => ({ key: 'eagle', side: 'good', unit: "[thorin's-company] great-eagle", place: { aside: true } })),
  ];
}
