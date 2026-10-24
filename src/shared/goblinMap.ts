import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Escape from Goblin-town: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches
// from the north-west corner of a 4' by 4' table. Goblin-town is a sprawl of ramshackle plank walkways and platforms
// over bottomless chasms, joined here and there by a ladder laid across a gap, with rocky outcrops jutting up between
// them and the cavern walls along the north and east edges. The Goblin King's throne stands on the great platform in
// the middle, under a crag. Everything that isn't plank, ladder or rock is the chasm: a model that falls in is lost.
// (Heights and where they come from are in plans/escape-from-goblin-town-audit.md.)

export const BOARD = 48;
/** The Dwarves set up wholly within 3" of the middle of the table; the Goblins at least 3" from any of them. */
export const MIDDLE = { x: BOARD / 2, y: BOARD / 2 };
export const COMPANY_REACH = 3;
export const GOBLIN_GAP = 3;
/** The cavern walls stand this tall; the rocky outcrops barely rise above the planks; the throne. */
export const WALL_HEIGHT = 6;
export const ROCK_HEIGHT = 0.5;
export const THRONE_HEIGHT = 2.5;
/** The pile of the Dwarves' confiscated weapons: a 25mm marker on the great platform, in front of the throne. */
export const WEAPON_PILE = { x: 24.2, y: 15.3 };
export const MARKER_SIZE = 25 / 25.4;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The plank walkways and platforms: middle, length, width, and which way the length runs (degrees). */
export const PLANKS: [number, number, number, number, number][] = [
  // North-west: the walkway down from the north edge, and the platforms off it.
  [10.9, 5, 10, 2.4, 90],
  [10.8, 11.2, 3.2, 2.6, 95],
  [10.3, 15.55, 5.5, 2.4, 91],
  [5.3, 4.8, 6.4, 4.2, 20],
  [8.9, 2.7, 2.6, 1.6, 90],
  // West: the platform at the west edge, and the way down to the south-west.
  [3.6, 15, 5.6, 5.4, -3],
  [1, 13.3, 4, 2, 80],
  [2.3, 11.3, 4.6, 1.6, -25],
  [7.55, 15.63, 3.35, 2.3, 60],
  [7.8, 20.57, 6.05, 5, 90],
  [10.6, 19, 5.2, 2.3, 0],
  [13.3, 19.4, 2.6, 1, 0],
  [16.4, 13.8, 6.6, 6.6, 0],
  [7.9, 26, 5.3, 5.4, 0],
  [4.38, 22.4, 4, 2.1, 95],
  [4.1, 26.3, 4.6, 3, 25],
  [4, 28.6, 8.2, 2.4, 8],
  // The ways in to the great platform from the west.
  [16.6, 21.2, 7.5, 2.6, 42],
  [19.8, 23.6, 3.6, 2.6, -25],
  [18.5, 28.3, 8.6, 2.6, 90],
  [17, 31.5, 2.6, 2.6, 0],
  [19.84, 12.65, 2.55, 3.45, 20],
  [20.14, 11.3, 2.5, 1.05, -10],
  // North: the long walkways up to the north edge, past the throne's crag.
  [24.8, 8.3, 10, 2.6, -33],
  [28.2, 3.2, 7.4, 2.6, 52],
  [32, 8.6, 9, 2.8, 63],
  [25.36, 10.3, 2.6, 2.4, 0],
  [20.4, 9.6, 3, 2.2, 0],
  [22.73, 12.6, 2.75, 2.6, 0],
  // The great platform before the Goblin King's throne.
  [25, 23.52, 20.25, 8.4, 90],
  // North-east: the walkway from the north edge, and the one out to the east edge.
  [32.7, 15.71, 5.1, 2.5, 90],
  [37, 16.38, 6.4, 3.25, 0],
  [41.2, 16.25, 2.6, 3.5, 0],
  [45.1, 15.6, 6, 2.5, -2],
  [39.5, 4, 8, 3, 90],
  [40.6, 11.3, 7, 2.4, 92],
  // East: the platforms east of the great platform, and the long walkway south.
  [33.82, 20.73, 5.55, 2.7, 95],
  [32.18, 25.8, 6.5, 6.05, 90],
  [31.2, 27.8, 3.6, 2.2, 30],
  [38.1, 26.3, 9.5, 3, 90],
  [37.4, 32.2, 3.6, 2.6, 100],
  [43, 21.7, 6.9, 7.5, 0],
  [38.8, 20.35, 2.4, 2.5, 0],
  [43.5, 33.65, 16.5, 2.3, 91],
  // South-east: the walkway out to the east edge, and the platforms at the south edge.
  [33.4, 38.95, 7, 5.5, 3],
  [39.52, 39.97, 5.35, 3.55, 5],
  [46.2, 40.47, 3.6, 2.95, 0],
  [37, 45.6, 7.3, 4.6, 0],
  [43.2, 44.2, 5.9, 4.6, 0],
  [32.97, 33.5, 7.65, 3, 0],
  // South: the platform below the great one (the gatehouse), the walkway to the south edge, and the way west.
  [17.5, 33.8, 8, 2.5, 3],
  [25.9, 37.8, 12.2, 8.4, 0],
  [19.6, 44.6, 7.2, 2.6, 98],
  [15.6, 36.7, 3.4, 3.2, 10],
  [9.1, 34.6, 6.2, 5, 8],
  [12.74, 39.35, 6.5, 3.5, 100],
  [11.6, 32, 2.2, 1.6, 75],
  [14.15, 34.4, 3.7, 3.6, 5],
];

/** Ladders laid across gaps as bridges: middle, length, which way they run. */
export const LADDERS: [number, number, number, number][] = [
  [12.4, 15.6, 2.6, 0],
  [27, 8.8, 2.6, 88],
  [30.6, 34.9, 2.4, 90],
];
export const LADDER_WIDTH = 0.8;

/** Rocky outcrops jutting up out of the chasm: middle, size, turn. Some stand alone, out of reach. */
export const ROCKS: [number, number, number, number, number][] = [
  [9.4, 7.6, 2.2, 5.2, 0],
  [7.4, 6.2, 2.4, 3, 20],
  [12.8, 20.9, 3.4, 2.8, 10],
  [20.2, 5.8, 4.8, 5, 15],
  // The crag over the Goblin King's throne.
  [27.1, 13.2, 5, 4.4, 0],
  [15.1, 28, 2.6, 4, 0],
  [38, 8.2, 3.6, 8.6, 0],
  [34.4, 32.4, 2.6, 2, 0],
  [45.6, 33.6, 2, 3.6, 0],
  [9.3, 38.8, 2.4, 3.4, 15],
  [4.6, 42.1, 3.8, 3.8, 0],
];

/** The cavern walls along the north and east edges: middle, size, turn. */
export const WALLS: [number, number, number, number, number][] = [
  [4.6, 0.5, 9.4, 1.6, 0],
  [17.5, 0.4, 11, 1.4, 0],
  [23.8, 0.9, 3, 2.4, 0],
  [33.5, 0.5, 8, 1.6, 0],
  [47.1, 6.7, 2.4, 13.6, 0],
  [47.2, 26, 2.2, 17, 0],
];

/** The Goblin King's throne. */
export const THRONE = { x: 26.9, y: 16.4, w: 2.4, h: 1.8 };

export function goblinTerrain(): NarrativeTerrain[] {
  return [
    // The chasm under everything: wherever no plank, ladder or rock stands, there is nothing to stand on.
    piece({ id: 'chasm', kind: 'water', x: BOARD / 2, y: BOARD / 2, w: BOARD, h: BOARD, deep: true, difficult: false, look: 'chasm' }),
    ...WALLS.map(([x, y, w, h, rot], i) => piece({ id: `cave-wall-${i + 1}`, kind: 'cliff', shape: 'circle', x, y, w, h, rot, height: WALL_HEIGHT, sheer: true, look: 'cavewall' })),
    ...ROCKS.map(([x, y, w, h, rot], i) => piece({ id: `crag-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height: ROCK_HEIGHT, difficult: true, look: 'crag' })),
    ...PLANKS.map(([x, y, w, h, rot], i) => piece({ id: `planks-${i + 1}`, kind: 'road', x, y, w, h, rot, look: 'gobplanks' })),
    ...LADDERS.map(([x, y, w, rot], i) => piece({ id: `ladder-bridge-${i + 1}`, kind: 'road', x, y, w, h: LADDER_WIDTH, rot, look: 'rungs' })),
    piece({ id: 'throne', kind: 'building', x: THRONE.x, y: THRONE.y, w: THRONE.w, h: THRONE.h, height: THRONE_HEIGHT, sheer: true, look: 'throne' }),
    { ...piece({ id: 'weapon-pile', kind: 'objective', shape: 'circle', x: WEAPON_PILE.x, y: WEAPON_PILE.y, w: MARKER_SIZE, h: MARKER_SIZE }), object: 'weapons' },
  ];
}

/** Thorin's Company, in the order they stand round the middle of the table. */
export const DWARVES = ['thorin', 'balin', 'dwalin', 'fili', 'kili', 'dori', 'nori', 'ori', 'oin', 'gloin', 'bifur', 'bofur', 'bombur'] as const;

/** Where the Dwarves start: Thorin in the middle, the rest in two rings round him, all within 3" of the middle. */
function companySpots(): [number, number][] {
  const out: [number, number][] = [[MIDDLE.x, MIDDLE.y]];
  for (let i = 0; i < 6; i++) out.push([+(MIDDLE.x + Math.cos((i * Math.PI) / 3) * 1.1).toFixed(2), +(MIDDLE.y + Math.sin((i * Math.PI) / 3) * 1.1).toFixed(2)]);
  for (let i = 0; i < 6; i++) out.push([+(MIDDLE.x + Math.cos(((i + 0.5) * Math.PI) / 3) * 2.15).toFixed(2), +(MIDDLE.y + Math.sin(((i + 0.5) * Math.PI) / 3) * 2.15).toFixed(2)]);
  return out;
}

/**
 * Where the Goblins start: across the walkways, at least 3" from the Dwarves, most of them on the ways out of the
 * middle and at the walkways' ends by the table edges.
 */
export const GOBLIN_SPOTS: [number, number][] = [
  // Round the great platform, 3" clear of the Dwarves.
  [21.8, 17.5],
  [23.2, 17.5],
  [25.2, 16.8],
  [28.2, 28.5],
  [21.8, 30.5],
  [23.2, 31.5],
  [26.5, 31.5],
  [28.2, 17.5],
  // The ways west.
  [15.2, 19.9],
  [18.5, 27],
  [16.6, 21.2],
  [17.5, 33.8],
  // North.
  [10.9, 2],
  [10.9, 6],
  [27.4, 1.6],
  [24.8, 8.3],
  [39.5, 1.6],
  [40.6, 12],
  // East.
  [32.6, 24.6],
  [32.6, 27],
  [45.5, 15.6],
  [43, 21.7],
  [43.5, 30],
  [46.3, 40.3],
  // South.
  [37, 45.6],
  [43.2, 44.2],
  [19.8, 46.6],
  [25.9, 38.8],
  [33.4, 39],
  // West.
  [2, 15],
];

/** Where the cast starts: the Dwarves in the middle, the Goblin King at his throne, the Goblins across the walkways. */
export function goblinCast(): CastMember[] {
  const ring = companySpots();
  const company = { circle: [MIDDLE.x, MIDDLE.y, COMPANY_REACH] as [number, number, number] };
  return [
    ...DWARVES.map(
      (k, i): CastMember => ({
        key: k,
        side: 'good',
        unit: `[thorin's-company] ${k === 'thorin' ? 'thorin-oakenshield' : `${k}-the-dwarf`}`,
        ...(k === 'thorin' ? { options: ['Orcrist', 'The Oakenshield'] } : {}),
        // (Dwalin and Nori, Weapon Masters, never count as Unarmed, so they keep theirs.)
        ...(k === 'dwalin' || k === 'nori' ? {} : { unarmed: true }),
        place: { area: company, at: ring[i] },
      }),
    ),
    { key: 'gandalf', side: 'good', unit: "[thorin's-company] gandalf-the-grey", place: { aside: true } },
    { key: 'goblin-king', side: 'evil', unit: '[goblin-town] the-goblin-king', place: { against: 'throne', at: [THRONE.x, THRONE.y + THRONE.h / 2 + 0.81] } },
    { key: 'grinnah', side: 'evil', unit: '[goblin-town] grinnah-goblin-jailer', place: { clear: GOBLIN_GAP, at: [28.2, 19.5] } },
    ...GOBLIN_SPOTS.map((at): CastMember => ({ key: 'goblin', side: 'evil', unit: '[goblin-town] goblin-warrior', place: { clear: GOBLIN_GAP, at } })),
  ];
}
