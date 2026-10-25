import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Escape from Osgiliath: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches
// from the north-west corner of a 4' by 4' table. The ruined city: broken walls running every which way between open
// streets, the stumps of round towers, three great roofless ruins, two stretches of wall still
// standing to full height, and piles of rubble and fallen masonry everywhere. The Good side starts in the middle and
// must get off the west edge, with Orcs on both sides of it and more coming in from the north and south.
// (Heights and where they come from are in plans/escape-from-osgiliath-audit.md.)

export const BOARD = 48;
/** The Good side sets up wholly within 6" of the middle; the Evil side's two halves wholly within 12" of the east and west edges. */
export const MIDDLE = { x: BOARD / 2, y: BOARD / 2 };
export const GOOD_REACH = 6;
export const EVIL_DEPTH = 12;
export const EAST_ZONE: [number, number, number, number] = [BOARD - EVIL_DEPTH, 0, BOARD, BOARD];
export const WEST_ZONE: [number, number, number, number] = [0, 0, EVIL_DEPTH, BOARD];
/** The two Reinforcement Points, in the middle of the north and south edges. */
export const POINTS = { north: { x: BOARD / 2, y: 0 }, south: { x: BOARD / 2, y: BOARD } } as const;

/** Broken walls stand a storey high; the two stretches still whole stand taller; the stumps of the round towers are low. */
export const WALL_HEIGHT = 1;
export const WHOLE_HEIGHT = 4;
export const RING_HEIGHT = 0.5;
/** The great ruined buildings' walls, still a storey and more; fallen masonry, and the rubble round it. */
export const RUIN_HEIGHT = 3;
export const RUIN_THICK = 0.7;
export const SLAB_HEIGHT = 1;
export const RUBBLE_HEIGHT = 0.5;
/** How thick a wall is. */
export const WALL_THICK = 0.4;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** The broken walls, a storey high: from, to (each x, y). */
export const WALLS: [number, number, number, number][] = [
  // North-west: a low stub, the long wall along the road west, and the walls south of it.
  [10.6, 3.8, 12.8, 3.8],
  [0, 12.9, 17.8, 12.9],
  [2.7, 13.4, 2.7, 21.5],
  [2.9, 18.1, 8.8, 18.1],
  [8.8, 18.1, 8.8, 27],
  [8.8, 27, 16, 27],
  // North: the wall down from the round tower, and the T west of the northern ruin.
  [16.5, 9.2, 16.5, 12.9],
  [16.5, 12.9, 16.5, 16.1],
  [23.3, 6.6, 23.3, 7.3],
  // North-east.
  [35.2, 0.1, 35.2, 3.2],
  [43.6, 0.6, 43.6, 7.3],
  [43.6, 0.6, 48, 0.6],
  [47, 10.1, 48, 10.1],
  [32, 11.2, 37.2, 11.2],
  // The middle: the T to the north of the Good side's ground, the long wall to its east, and the walls south of it.
  [22.5, 16.6, 29.8, 16.6],
  [25.8, 16.8, 25.8, 19.3],
  [31.2, 18.8, 31.2, 30.2],
  [20.2, 26.8, 20.2, 29.3],
  [27.2, 29.6, 27.2, 31.6],
  [27.3, 30.2, 31.2, 30.2],
  [28.8, 33.4, 30.4, 33.4],
  // East.
  [41.9, 16, 46.3, 16],
  [42, 16, 42, 17.5],
  [42, 21, 42, 22.5],
  [37.2, 18, 37.2, 25.6],
  [37.2, 25.6, 39.5, 25.6],
  [42, 27.3, 42, 32.2],
  [44.2, 32.3, 45.8, 32.3],
  [35, 36.5, 40.8, 36.5],
  // South-west.
  [0, 40.9, 2.2, 40.9],
  [5.2, 40.9, 7.3, 40.9],
  [12.5, 40.9, 13.7, 40.9],
  [13.6, 40.9, 13.6, 44.9],
  [15.5, 32.6, 15.5, 38.3],
  [15.5, 32.6, 20, 32.6],
  [18.3, 35, 17.1, 36.4],
  [17.1, 36.4, 17.75, 37.5],
  [18.3, 35.2, 19.8, 35.2],
  [15.5, 38.2, 20, 38.2],
  [16.5, 38.3, 16.5, 39.5],
  // South: the long wall along the road, the wall south from it, and the wall up the east side of the open ground.
  [26, 41.5, 35, 41.5],
  [29.6, 41.7, 29.6, 48],
  [35, 35.1, 35, 43.5],
  [35, 45.3, 35, 48],
];

/** The two stretches of wall still standing whole: from, to. */
export const WHOLE: [number, number, number, number][] = [
  // An L in the north-east, its foot turned back west.
  [37.1, 3.4, 41.8, 3.4],
  [41.7, 3.4, 41.7, 7.5],
  [39.8, 7.3, 41.8, 7.3],
  // A T south of the middle.
  [20.4, 38.2, 25.4, 38.2],
  [25.4, 34, 25.4, 39.6],
];

/** The stumps of round towers, as broken arcs: centre, radius, and the stretches of the ring still standing (degrees, 0 east, clockwise). */
export const RINGS: { x: number; y: number; r: number; arcs: [number, number][] }[] = [
  { x: 16, y: 4.6, r: 2.8, arcs: [[200, 250], [262, 345], [62, 90]] },
  { x: 44.4, y: 9.6, r: 2.9, arcs: [[110, 205], [55, 100], [10, 35]] },
  { x: 24.4, y: 29.3, r: 3.1, arcs: [[130, 160], [60, 125]] },
  // (The broken arc west of the Good side's ground.)
  { x: 15.6, y: 20.2, r: 2.9, arcs: [[-78, -45], [-38, 18]] },
];

/**
 * The three great ruined buildings, their roofs long gone: thick walls round an open floor, each with a doorway broken
 * through on the side facing the street. Each as its outline (corners in order) and the side the doorway is in
 * (the edge from corner `door` to the next).
 */
export const RUINS: { outline: [number, number][]; door: number }[] = [
  // North: a square block, its doorway to the south.
  { outline: [[25.3, 2.2], [30.8, 2.2], [30.8, 7], [25.3, 7]], door: 2 },
  // South-west: an L, its doorway to the east.
  { outline: [[5.4, 28.4], [7.8, 28.4], [7.8, 31.8], [9.8, 31.8], [9.8, 34.2], [5.4, 34.2]], door: 3 },
  // South-east: a square block, its doorway to the north.
  { outline: [[39.7, 40.9], [44.6, 40.9], [44.6, 46.4], [39.7, 46.4]], door: 0 },
];
/** How wide a broken doorway is: room for a model on a 25mm base and a little over. */
export const DOOR_WIDTH = 1.6;

/** Fallen masonry and piles of rubble: middle, size, turn, height. */
export const RUBBLE: [number, number, number, number, number, number][] = [
  // Inside the three ruins, fallen from their upper floors.
  [28.6, 4.2, 1.6, 1.2, 20, RUBBLE_HEIGHT],
  [6.6, 31.6, 1, 1.4, 0, RUBBLE_HEIGHT],
  [41.6, 43.4, 1.8, 1.4, -25, RUBBLE_HEIGHT],
  // North-west.
  [8, 11.5, 1, 1, 15, SLAB_HEIGHT],
  [0.6, 12.2, 1, 0.8, 0, RUBBLE_HEIGHT],
  [2.8, 13.5, 0.8, 0.8, 0, RUBBLE_HEIGHT],
  [14.7, 5.6, 1.8, 1.4, 20, RUBBLE_HEIGHT],
  [15.3, 7.7, 1.1, 1.4, 15, SLAB_HEIGHT],
  [13.2, 9.4, 0.7, 1.4, 0, RUBBLE_HEIGHT],
  [13.4, 10.6, 0.8, 0.8, 0, RUBBLE_HEIGHT],
  [12.4, 18.6, 1.2, 1.4, 0, RUBBLE_HEIGHT],
  [8.4, 17.2, 1.2, 0.8, 0, RUBBLE_HEIGHT],
  [12.4, 26.3, 1, 1, 0, RUBBLE_HEIGHT],
  // North.
  [20.8, 4.3, 1.4, 1.2, -40, SLAB_HEIGHT],
  [21.2, 5.6, 1, 1.2, 0, RUBBLE_HEIGHT],
  [24.3, 8.6, 2.4, 2, 15, SLAB_HEIGHT],
  [25.6, 8.3, 1.2, 0.4, 0, RUBBLE_HEIGHT],
  [24.4, 11.4, 1, 0.8, 0, RUBBLE_HEIGHT],
  [31.4, 11, 0.8, 1.6, 0, RUBBLE_HEIGHT],
  // North-east.
  [34.5, 3.6, 0.9, 1, 0, SLAB_HEIGHT],
  [34.6, 6.6, 1.1, 2.2, 10, SLAB_HEIGHT],
  [33.8, 7, 0.5, 0.7, 0, RUBBLE_HEIGHT],
  [39, 6.6, 0.7, 0.6, 0, RUBBLE_HEIGHT],
  [38.4, 7.8, 0.6, 0.6, 0, RUBBLE_HEIGHT],
  [39.6, 9.6, 1.2, 1.8, 35, SLAB_HEIGHT],
  [41, 12, 2.2, 0.9, 25, SLAB_HEIGHT],
  [37.7, 12.1, 1, 0.9, 0, SLAB_HEIGHT],
  [45.1, 6.3, 1, 1.1, 20, SLAB_HEIGHT],
  [45.4, 8, 1.4, 1, 0, RUBBLE_HEIGHT],
  // The middle.
  [22.5, 19.9, 0.9, 0.9, 0, RUBBLE_HEIGHT],
  [22.1, 21.4, 0.6, 0.6, 0, RUBBLE_HEIGHT],
  [17, 25.2, 0.7, 1.8, 0, SLAB_HEIGHT],
  [16.2, 26.3, 0.6, 0.6, 0, RUBBLE_HEIGHT],
  [20.1, 30.6, 0.6, 1.6, 10, SLAB_HEIGHT],
  [32.5, 21.6, 0.8, 0.7, 0, RUBBLE_HEIGHT],
  [34, 27.1, 2.2, 0.6, 0, RUBBLE_HEIGHT],
  // East.
  [42.6, 20.8, 1, 1, 0, RUBBLE_HEIGHT],
  [45, 23.5, 0.9, 1, 0, RUBBLE_HEIGHT],
  [44.6, 28.6, 1.1, 0.7, -15, RUBBLE_HEIGHT],
  [39.6, 25.6, 1.2, 0.5, 0, RUBBLE_HEIGHT],
  [36.4, 23.2, 0.6, 0.8, 0, RUBBLE_HEIGHT],
  // South.
  [16.3, 37.4, 1.1, 1.1, 0, SLAB_HEIGHT],
  [16, 32.9, 0.8, 1.4, 0, RUBBLE_HEIGHT],
  [23.8, 36, 1.2, 0.8, 0, RUBBLE_HEIGHT],
  [22.5, 36.3, 0.6, 0.6, 0, RUBBLE_HEIGHT],
  [23.3, 36.9, 0.9, 0.3, 15, RUBBLE_HEIGHT],
  [24.2, 35.2, 0.4, 0.4, 0, RUBBLE_HEIGHT],
  [27.7, 33.3, 1.8, 1.8, 0, SLAB_HEIGHT],
  [28.2, 36.4, 0.8, 0.6, 0, RUBBLE_HEIGHT],
  [30.3, 47.4, 0.8, 0.8, 0, RUBBLE_HEIGHT],
  [34.5, 36.5, 0.6, 0.9, 0, RUBBLE_HEIGHT],
  [34.4, 39.2, 0.8, 0.8, 0, SLAB_HEIGHT],
  [34, 41.6, 1.2, 0.8, 0, RUBBLE_HEIGHT],
  [36.1, 47, 0.8, 0.8, 0, RUBBLE_HEIGHT],
  [39.3, 34, 1.4, 1.2, 30, SLAB_HEIGHT],
  [37.6, 35.5, 0.6, 0.5, 0, RUBBLE_HEIGHT],
  [41.4, 37.2, 1, 0.8, 0, SLAB_HEIGHT],
  [44, 37, 2, 0.9, 15, SLAB_HEIGHT],
  [44.5, 38, 0.6, 0.5, 0, RUBBLE_HEIGHT],
  // South-west.
  [8.6, 41.1, 1.8, 1.2, 0, SLAB_HEIGHT],
  [8.4, 42.1, 0.6, 0.5, 0, RUBBLE_HEIGHT],
  [6.1, 41.4, 0.5, 0.5, 0, RUBBLE_HEIGHT],
  [5.2, 41, 0.4, 0.3, 0, RUBBLE_HEIGHT],
];

/** A straight wall from one point to another. */
function wall(id: string, [x0, y0, x1, y1]: [number, number, number, number], height: number, extra: Partial<Terrain> = {}, thick = WALL_THICK): Terrain {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return piece({ id, kind: 'wall', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: len + thick, h: thick, rot: Math.round(((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI) * 10) / 10, height, ...extra });
}

/** The arcs of a broken round tower, each as a run of short straight walls. */
function ringWalls(): Terrain[] {
  const out: Terrain[] = [];
  RINGS.forEach((ring, i) =>
    ring.arcs.forEach(([a, b], j) => {
      const steps = Math.max(1, Math.round((b - a) / 20));
      for (let k = 0; k < steps; k++) {
        const p = (d: number) => [ring.x + Math.cos((d * Math.PI) / 180) * ring.r, ring.y + Math.sin((d * Math.PI) / 180) * ring.r] as const;
        const [x0, y0] = p(a + ((b - a) * k) / steps);
        const [x1, y1] = p(a + ((b - a) * (k + 1)) / steps);
        out.push(wall(`tower-${i + 1}-${j + 1}-${k + 1}`, [+x0.toFixed(2), +y0.toFixed(2), +x1.toFixed(2), +y1.toFixed(2)], RING_HEIGHT, { look: 'osgwall' }));
      }
    }),
  );
  return out;
}

/** A ruin's walls, one along each side of its outline, the doorway side in two parts either side of the gap. */
function ruinWalls(): Terrain[] {
  return RUINS.flatMap(({ outline, door }, i) =>
    outline.flatMap(([x0, y0], k) => {
      const [x1, y1] = outline[(k + 1) % outline.length];
      const id = `ruin-${i + 1}-${k + 1}`;
      const make = (a: number, b: number, part = '') => wall(`${id}${part}`, [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b].map(v => +v.toFixed(2)) as [number, number, number, number], RUIN_HEIGHT, { look: 'osgwall' }, RUIN_THICK);
      if (k !== door) return [make(0, 1)];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const half = (DOOR_WIDTH + RUIN_THICK) / 2 / len;
      return [make(0, 0.5 - half, 'a'), make(0.5 + half, 1, 'b')];
    }),
  );
}

export function osgiliathTerrain(): NarrativeTerrain[] {
  return [
    ...ruinWalls(),
    ...WALLS.map((w, i) => wall(`wall-${i + 1}`, w, WALL_HEIGHT, { look: 'osgwall' })),
    ...WHOLE.map((w, i) => wall(`whole-wall-${i + 1}`, w, WHOLE_HEIGHT, { look: 'osgwall' })),
    ...ringWalls(),
    ...RUBBLE.map(([x, y, w, h, rot, height], i) => piece({ id: `rubble-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height, difficult: true, look: 'rubble' })),
  ];
}

// ——— The cast ———

/** How far a point is from a piece of the table (0 on it), for keeping the starting spots off the walls. */
function gap(t: Terrain, x: number, y: number): number {
  const a = (-t.rot * Math.PI) / 180;
  const dx = x - t.x;
  const dy = y - t.y;
  const u = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
  const v = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
  if (t.shape === 'circle') return Math.max(0, Math.hypot(dx, dy) - Math.max(t.w, t.h) / 2);
  return Math.hypot(Math.max(0, u - t.w / 2), Math.max(0, v - t.h / 2));
}

/**
 * Spots for `count` models on 25mm bases, in staggered rows `pitch` apart (1.1" packs them shoulder to shoulder), as near a point as they'll go: wholly within `reach` of it
 * (when given) or wholly inside a box, and clear of every wall, building and pile of rubble.
 */
export function packSpots(count: number, at: { x: number; y: number }, keep: { reach?: number; box?: [number, number, number, number]; pitch?: number; tall?: number; radius?: number }, taken: [number, number, number?][] = []): [number, number][] {
  const terrain = osgiliathTerrain();
  const r = keep.radius ?? 0.5;
  const pitch = keep.pitch ?? 1.1;
  const out: [number, number][] = [];
  const grid: [number, number][] = [];
  for (let j = -40; j <= 40; j++) for (let i = -40; i <= 40; i++) grid.push([+(at.x + i * pitch + (j % 2 ? pitch / 2 : 0)).toFixed(2), +(at.y + j * pitch * 0.9).toFixed(2)]);
  // (Nearest first; a `tall` group spreads that much further north and south than east and west.)
  const far = (p: [number, number]) => Math.hypot((p[0] - at.x) * (keep.tall ?? 1), p[1] - at.y);
  grid.sort((p, q) => far(p) - far(q));
  for (const [x, y] of grid) {
    if (out.length >= count) break;
    if (keep.reach !== undefined && Math.hypot(x - at.x, y - at.y) + r > keep.reach - 0.05) continue;
    if (keep.box && (x - r < keep.box[0] + 0.05 || x + r > keep.box[2] - 0.05 || y - r < keep.box[1] + 0.05 || y + r > keep.box[3] - 0.05)) continue;
    if (terrain.some(t => gap(t, x, y) < r + 0.05)) continue;
    if ([...out, ...taken].some(([a, b, rb]) => Math.hypot(a - x, b - y) < r + (rb ?? 0.5) + 0.05)) continue;
    out.push([x, y]);
  }
  return out;
}

/** The Good side: Faramir, Madril and Damrod, 12 Warriors of Minas Tirith and 12 Rangers of Gondor. */
const GOOD: Omit<CastMember, 'place'>[] = [
  { key: 'faramir', side: 'good', unit: '[garrison-of-ithilien] faramir' },
  { key: 'madril', side: 'good', unit: '[garrison-of-ithilien] madril' },
  { key: 'damrod', side: 'good', unit: '[garrison-of-ithilien] damrod' },
  ...(['Shield', 'Shield and spear', 'Bow'] as const).flatMap(o => Array.from({ length: 4 }, (): Omit<CastMember, 'place'> => ({ key: 'warrior', side: 'good', unit: '[garrison-of-ithilien] warrior-of-minas-tirith', options: [o] }))),
  ...Array.from({ length: 4 }, (): Omit<CastMember, 'place'> => ({ key: 'ranger', side: 'good', unit: '[garrison-of-ithilien] ranger-of-gondor', options: ['Spear'] })),
  ...Array.from({ length: 8 }, (): Omit<CastMember, 'place'> => ({ key: 'ranger', side: 'good', unit: '[garrison-of-ithilien] ranger-of-gondor' })),
];

/** Six Morannon Orcs of each kind: three go east with Gothmog, three west with Guritz. */
const ORC_KITS: string[][] = [['Shield'], ['Spear'], ['Shield and spear'], []];
const orcs = (): Omit<CastMember, 'place'>[] => ORC_KITS.flatMap(o => Array.from({ length: 3 }, (): Omit<CastMember, 'place'> => ({ key: 'orc', side: 'evil', unit: '[army-of-gothmog] morannon-orc', ...(o.length ? { options: o } : {}) })));

/** Room for the Mordor Troll: half its 60mm base and a little over, so nobody stands touching it. */
const TROLL_RADIUS = 1.4;

/** Where the cast starts: the Good side in the middle, Gothmog's half to the east and Guritz's to the west. */
export function osgiliathCast(): CastMember[] {
  const good = { circle: [MIDDLE.x, MIDDLE.y, GOOD_REACH] as [number, number, number] };
  const goodSpots = packSpots(GOOD.length, MIDDLE, { reach: GOOD_REACH, pitch: 1.75 });
  const east: Omit<CastMember, 'place'>[] = [
    { key: 'gothmog', side: 'evil', unit: '[army-of-gothmog] gothmog' },
    { key: 'enforcer', side: 'evil', unit: "[army-of-gothmog] gothmog's-enforcer" },
    ...orcs(),
  ];
  const west: Omit<CastMember, 'place'>[] = [
    { key: 'guritz', side: 'evil', unit: '[army-of-gothmog] guritz' },
    { key: 'troll', side: 'evil', unit: '[army-of-gothmog] mordor-troll' },
    ...orcs(),
  ];
  // The Orcs come in from beyond the table, so each half starts strung out along its own edge, as far from the Good
  // side as its zone lets it: the leaders in the middle of the line, the Troll (on a bigger base) among the west half.
  const line = { pitch: 2.1, tall: 3 };
  const eastSpots = packSpots(east.length, { x: BOARD - 2, y: 24 }, { box: EAST_ZONE, ...line });
  const trollSpot = packSpots(1, { x: 2.5, y: 26 }, { box: WEST_ZONE, radius: TROLL_RADIUS });
  const westSpots = packSpots(west.length - 1, { x: 2, y: 23 }, { box: WEST_ZONE, ...line }, [[...trollSpot[0], TROLL_RADIUS]]);
  return [
    ...GOOD.map((c, i): CastMember => ({ ...c, place: { area: good, at: goodSpots[i] } })),
    ...east.map((c, i): CastMember => ({ ...c, place: { area: { box: EAST_ZONE }, at: eastSpots[i] } })),
    ...west.filter(c => c.key !== 'troll').map((c, i): CastMember => ({ ...c, place: { area: { box: WEST_ZONE }, at: westSpots[i] } })),
    { ...west.find(c => c.key === 'troll')!, place: { area: { box: WEST_ZONE }, at: trollSpot[0] } },
  ];
}
