import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Lake-town Escape: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches from the
// north-west corner of a 4' by 4' table. Lake-town stands on the Long Lake: wooden walkways on stilts, houses and
// towers along them, boats tied up and ice floes drifting between. Everything that isn't a walkway, a house, a boat or
// a floe is the lake itself, Deep Water. Bard's House stands on the east edge.
// (Heights and where they come from are in plans/lake-town-escape-audit.md.)

export const BOARD = 48;
/** The four sections, A to D from west to east, each 12" wide. */
export const SECTIONS = ['A', 'B', 'C', 'D'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_WIDTH = 12;
/** How tall the houses and towers stand, the walkways' width, and the ice floes' height. */
export const HOUSE_HEIGHT = 5;
export const WALK_WIDTH = 1.5;
export const FLOE_HEIGHT = 0.25;
/** The Orcs set up in their own section, not within 3" of another; those in section D within 3" of Bard's House. */
export const SECTION_GAP = 3;
export const BARDS_REACH = 3;

/** Which section a point is in. */
export const sectionAt = (x: number): Section => SECTIONS[Math.max(0, Math.min(3, Math.floor(x / SECTION_WIDTH)))];

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The walkways, each from one end of its middle line to the other. */
export const WALKWAYS: [number, number, number, number][] = [
  [10.1, 0, 10.1, 8.2],
  [10.8, 5, 13.2, 5],
  [19, 5, 26.2, 5],
  [11.4, 10, 15.6, 10],
  [16.1, 7.2, 16.1, 13.2],
  [0, 16, 13.4, 16],
  [10.4, 16, 10.4, 26.4],
  [20.4, 17.8, 26, 17.8],
  [9, 24, 21.1, 24],
  [27.5, 6.6, 27.5, 9.6],
  [29.4, 10.5, 34.9, 10.5],
  [38.4, 10.8, 44, 10.8],
  [34.8, 0, 34.8, 3.3],
  [34.1, 3.3, 36.6, 3.3],
  [38.2, 4.8, 38.2, 9.3],
  [38.2, 12.9, 38.2, 20.2],
  [30.6, 18.6, 36.8, 20.8],
  [36.2, 20.8, 43.1, 20.8],
  [27.2, 13.4, 27.2, 16.6],
  [41.7, 22.5, 41.7, 28.2],
  [27.3, 22, 27.3, 29],
  [25.3, 24.3, 26.8, 24.3],
  [0, 28.2, 7.8, 28.2],
  [10.7, 31, 10.7, 36.6],
  [11.4, 33.6, 18.6, 33.6],
  [3.4, 34.6, 3.4, 41.4],
  [17.5, 24.6, 17.5, 33],
  [18.2, 31.5, 25, 31.5],
  [16.2, 41, 23.4, 41],
  [17.6, 40.2, 17.6, 47.8],
  [8.4, 46.3, 17.2, 46.3],
  [26.2, 33, 26.2, 37.2],
  [25.8, 42.2, 25.8, 47.8],
  [28.3, 40.6, 34.8, 40.6],
  [34, 39.9, 34, 42.8],
  [33.4, 42, 40.4, 42],
  [31.4, 36.6, 36.6, 36.6],
  [38.7, 29.4, 38.7, 36.6],
  [37.4, 28.8, 48, 28.8],
];

/** The houses and towers: middle, size, turn. */
export const HOUSES: [number, number, number, number, number][] = [
  // North of section B: a long house with a wing.
  [16.6, 4.6, 5.6, 3.2, 25],
  [13.6, 5, 2.4, 3.8, 25],
  [9.3, 10, 4.3, 4],
  [16.2, 15.6, 6, 5.2, 0],
  [28.3, 5.5, 5.4, 3, 35],
  [26.5, 11.6, 6, 4.2, 0],
  [25, 13.6, 2.2, 3.4, -10],
  [36.7, 11.1, 3.8, 3.8, 0],
  [38.8, 2.2, 4.8, 2.6, -20],
  [37.3, 4.2, 2.4, 3, 30],
  [28.2, 17.9, 5.4, 3, 30],
  [23.2, 24.3, 4.3, 4, 0],
  [9.8, 28.6, 4.8, 2.6, 30],
  [12.3, 28.6, 2.4, 5, 15],
  [9.4, 38.6, 4.6, 4, 0],
  [26.6, 31.1, 3.3, 4.4, 10],
  [26.9, 38.9, 3.3, 4, -15],
  [24.8, 41.1, 3.6, 2.2, 25],
  [38.6, 38.6, 4.4, 4.2, 0],
  [43.3, 42.1, 6.2, 5, 0],
].map(([x, y, w, h, rot]) => [x, y, w, h, rot ?? 0]) as [number, number, number, number, number][];

/** Bard's House, touching the east edge. */
export const BARDS_HOUSE: [number, number, number, number] = [45.5, 21.2, 5, 5.4];

/** The boats tied up in pairs: middle, and whether it lies across the table (east-west) or along it. */
export const BOATS: [number, number, boolean][] = [
  [13.5, 12.6, true],
  [13.5, 13.4, true],
  [11.4, 21.5, false],
  [12.1, 21.5, false],
  [33.5, 5.8, false],
  [34.3, 5.8, false],
  [39.9, 9.1, false],
  [40.8, 9.1, false],
  [35.6, 14.5, false],
  [36.5, 14.5, false],
  [29, 24.6, false],
  [29.9, 24.6, false],
  [8.5, 33, false],
  [9.2, 33, false],
  [15.2, 43.9, true],
  [15.2, 44.7, true],
  [38.6, 26.4, true],
  [38.6, 27.2, true],
  [40.6, 35, false],
  [41.5, 35, false],
  [33.8, 38.3, true],
  [33.8, 39.1, true],
];

/** Ice floes: middle and size. */
export const FLOES: [number, number, number, number][] = [
  [20.9, 10.1, 2.4, 1.8],
  [22.6, 8, 0.9, 0.9],
  [21.8, 20.8, 1.1, 1],
  [41.6, 4.2, 2.2, 1.3],
  [43.5, 16.6, 1, 1],
  [31.4, 12.8, 1.1, 1],
  [5.2, 31.6, 1.4, 2],
  [6, 44, 2, 1.2],
  [14.6, 26, 1, 1],
  [19.2, 35.6, 1.2, 1.1],
  [15, 38.5, 1, 1.2],
  [21.6, 44.3, 1, 1],
  [25.8, 28.4, 0.9, 0.9],
  [33, 24, 1.2, 1.6],
  [34, 31.2, 1.1, 1],
  [30.6, 35.4, 1, 1],
  [45.5, 26.2, 1, 1],
  [45.7, 34.6, 1, 1],
];

export function lakeTerrain(): NarrativeTerrain[] {
  const [bx, by, bw, bh] = BARDS_HOUSE;
  return [
    // The Long Lake under everything: Deep Water wherever nothing stands on it.
    piece({ id: 'lake', kind: 'water', x: BOARD / 2, y: BOARD / 2, w: BOARD, h: BOARD, deep: true, difficult: false }),
    ...WALKWAYS.map(([x0, y0, x1, y1], i) =>
      piece({ id: `walk-${i + 1}`, kind: 'road', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.hypot(x1 - x0, y1 - y0), h: WALK_WIDTH, rot: +((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI).toFixed(1), look: 'planks' }),
    ),
    ...BOATS.map(([x, y, across], i) => piece({ id: `boat-${i + 1}`, kind: 'road', x, y, w: 1.9, h: 0.7, rot: across ? 0 : 90, look: 'boat' })),
    ...FLOES.map(([x, y, w, h], i) => piece({ id: `floe-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, height: FLOE_HEIGHT, look: 'floe' })),
    ...HOUSES.map(([x, y, w, h, rot], i) => piece({ id: `house-${i + 1}`, kind: 'building', x, y, w, h, rot, height: HOUSE_HEIGHT, floors: 1, look: 'lakehouse' })),
    piece({ id: 'bards-house', kind: 'building', x: bx, y: by, w: bw, h: bh, height: HOUSE_HEIGHT, floors: 1, look: 'lakehouse' }),
  ];
}

/** Where each group of Hunter Orcs starts in its section: on the walkways, clear of the other sections. */
const GROUPS: Record<Section, [number, number][]> = {
  A: [
    [2, 16],
    [4, 16],
    [6, 16],
    [2, 28.2],
    [4, 28.2],
    [6, 28.2],
  ],
  B: [
    [16.1, 8.6],
    [16.1, 11],
    [15.5, 24],
    [17.5, 26.5],
    [17.5, 29],
    [15.5, 33.6],
  ],
  C: [
    [30.2, 10.5],
    [32, 10.5],
    [27.6, 25.8],
    [27.6, 23],
    [30, 40.6],
    [32, 40.6],
  ],
  // (Within 3" of Bard's House: on the walkway south of it, the one west of it, and a floe to its north.)
  D: [
    [41.7, 22.7],
    [41.7, 23.85],
    [41.7, 25],
    [41.7, 26],
    [40.6, 20.8],
    [43.5, 16.6],
  ],
};

/** The groups' wargear, the same in each: two with Orc bows, two with two-handed weapons, two with neither. */
const KIT: (string[] | undefined)[] = [['Orc bow'], ['Two-handed weapon'], undefined, ['Orc bow'], ['Two-handed weapon'], undefined];

/** Where the cast starts: an Orc group in each section, Bolg with A's and Fimbul with C's, Legolas at Bard's House. */
export function lakeCast(): CastMember[] {
  const box = (s: Section): [number, number, number, number] => {
    const i = SECTIONS.indexOf(s);
    return [i * SECTION_WIDTH + (i ? SECTION_GAP : 0), 0, (i + 1) * SECTION_WIDTH - (i < 3 ? SECTION_GAP : 0), BOARD];
  };
  const orcs = SECTIONS.flatMap(s =>
    GROUPS[s].map(
      (at, i): CastMember => ({
        key: `orc-${s.toLowerCase()}`,
        side: 'evil',
        unit: "[azog's-hunters] hunter-orc-warrior",
        ...(KIT[i] ? { options: KIT[i] } : {}),
        place: { area: s === 'D' ? { all: [{ box: box(s) }, { piece: 'bards-house', within: BARDS_REACH }] } : { box: box(s) }, at },
      }),
    ),
  );
  return [
    { key: 'legolas', side: 'good', unit: '[halls-of-thranduil] legolas-greenleaf-prince-of-mirkwood', options: ['Orcrist'], stats: { Fv: 7, A: 3 }, place: { against: 'bards-house', at: [42.49, 20.8] } },
    { key: 'bolg', side: 'evil', unit: "[azog's-hunters] bolg-spawn-of-azog", fate: 3, place: { area: { box: box('A') }, at: [8, 16] } },
    { key: 'fimbul', side: 'evil', unit: "[azog's-hunters] fimbul-hunter-orc-captain", place: { area: { box: box('C') }, at: [27.6, 27.9] } },
    ...orcs,
  ];
}
