import type { Point } from './geometry.ts';
import type { Area, CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Last March of the Ents: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches
// from the north-west corner of a 4' by 4' table. The tower of Orthanc stands in the middle; timber scaffolds and pits
// are dotted round it, rubble lies about, and the dam holding back the River Isen fills the middle of the west edge.
// (Heights and where they come from are in plans/last-march-of-the-ents-audit.md.)

export const BOARD = 48;
/** The dam, along the middle of the west edge. */
export const DAM = { id: 'dam', x0: 0, x1: 1.9, y0: 12.5, y1: 34 };
/** Orthanc: its square core and the four great piers that make a cross of it, rising sheer from the ground. */
export const ORTHANC = { x: 24, y: 24, core: 4.8, arm: 13.4, armWidth: 3.6, height: 18 };
/** How high the scaffolds' decks stand: the lower decks, and the upper ones built on top of them. */
export const DECK = { low: 2.5, high: 4.5 };

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** A scaffold's deck: middle, length along its planks, width, which way it runs (degrees) and how high it is. */
export const SCAFFOLDS: { id: string; x: number; y: number; long: number; wide: number; rot: number; height: number }[] = [
  { id: 'scaffold-nw-low', x: 15.35, y: 16.8, long: 7.7, wide: 2.4, rot: 26, height: DECK.low },
  { id: 'scaffold-nw-high', x: 14.6, y: 12.7, long: 5.2, wide: 2.4, rot: 121, height: DECK.high },
  { id: 'scaffold-ne', x: 38.15, y: 12.9, long: 7.3, wide: 2.3, rot: 41, height: DECK.low },
  { id: 'scaffold-sw-low', x: 14.2, y: 34.3, long: 4.8, wide: 2.4, rot: 30, height: DECK.low },
  { id: 'scaffold-sw-high', x: 16.4, y: 36.2, long: 4.7, wide: 2.4, rot: 118, height: DECK.high },
];
/**
 * A point on a scaffold's deck, `k` inches from its middle towards the end its rotation points at, and `side` inches
 * out to its left (looking that way).
 */
export const onDeck = (id: string, k: number, side = 0): Point => {
  const s = SCAFFOLDS.find(x => x.id === id)!;
  const a = (s.rot * Math.PI) / 180;
  return { x: +(s.x + Math.cos(a) * k + Math.sin(a) * side).toFixed(2), y: +(s.y + Math.sin(a) * k - Math.cos(a) * side).toFixed(2) };
};

/**
 * Ladders: up from the ground at the ends of the decks (leaning against the end, most of it on the ground), and from a
 * lower deck to the upper one on it.
 */
const LADDERS: { id: string; on: string; k: number; side?: number }[] = [
  { id: 'ladder-nw-e', on: 'scaffold-nw-low', k: 4.25 },
  { id: 'ladder-nw-w', on: 'scaffold-nw-low', k: -4.25 },
  { id: 'ladder-nw-up', on: 'scaffold-nw-high', k: 2.6 },
  { id: 'ladder-ne-sw', on: 'scaffold-ne', k: -4.05 },
  { id: 'ladder-ne-se', on: 'scaffold-ne', k: 4.05 },
  { id: 'ladder-sw-w', on: 'scaffold-sw-low', k: -2.8 },
  { id: 'ladder-sw-up', on: 'scaffold-sw-high', k: -0.6, side: -1.2 },
  { id: 'ladder-sw-s', on: 'scaffold-sw-high', k: 2.75 },
];

/**
 * The pits: narrow crevices torn in the ground, each a run of straight stretches along the middle of the pale scars
 * the map draws (the scars are their crumbling edges). Points are (x, y); every crevice is PIT_WIDTH across.
 */
export const PIT_WIDTH = 1.2;
export const PITS: Point[][] = [
  // North of the north-west scaffold, from the north edge round to the scaffold.
  [{ x: 15.2, y: 0 }, { x: 18, y: 3 }, { x: 21.5, y: 5.5 }, { x: 20.5, y: 8.5 }, { x: 18.5, y: 11.5 }, { x: 17.6, y: 13.6 }],
  // Across the north-east, from the north edge to the east edge.
  [{ x: 30, y: 0 }, { x: 34, y: 2 }, { x: 38, y: 4 }, { x: 41, y: 6.5 }, { x: 44, y: 8 }, { x: 48, y: 9.5 }],
  // The short one north-east of Orthanc, running up to the north-east scaffold.
  [{ x: 26, y: 14.3 }, { x: 30, y: 13.6 }, { x: 34, y: 13.9 }, { x: 37.2, y: 14.6 }],
  // South-east of Orthanc, down towards the south edge.
  [{ x: 38.2, y: 25.5 }, { x: 36.8, y: 29.5 }, { x: 35.4, y: 33.5 }, { x: 35, y: 36.5 }, { x: 37.5, y: 38.5 }, { x: 39.8, y: 41.5 }, { x: 41.6, y: 45.5 }],
  // Its short branch to the west.
  [{ x: 35, y: 36.5 }, { x: 32.6, y: 37.3 }],
];

/** Rubble lying about: middle, size, turn. */
const RUBBLE: [number, number, number, number, number][] = [
  [28.4, 13.8, 2.4, 1.2, 0],
  [33.2, 13.3, 1.8, 1, 0],
  [4.8, 22, 2, 1, 30],
  [6.8, 25, 1.2, 1.6, 10],
  [13.3, 30, 1, 1.6, 30],
  [13.3, 39.4, 1.6, 0.8, 0],
  [21, 42.2, 1, 1.6, 30],
  [29.3, 40.3, 2.6, 1.6, -30],
  [31.1, 36.9, 1.1, 0.8, 0],
  [33.2, 36.9, 2, 0.8, -15],
  [33.5, 41.5, 1.2, 0.9, 30],
  [37.6, 32, 1.2, 0.8, -20],
  [41, 27.8, 1.6, 1.4, -30],
  [43, 25, 1.2, 1.4, 0],
];
export const RUBBLE_HEIGHT = 1;

/** One straight stretch of a crevice, from a to b. */
const stretch = (id: string, a: Point, b: Point): Terrain => {
  const long = Math.hypot(b.x - a.x, b.y - a.y);
  // (Each stretch runs a little past its ends, so the bends join up.)
  return piece({ id, kind: 'water', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: +(long + PIT_WIDTH * 0.6).toFixed(2), h: PIT_WIDTH, rot: +((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(1), difficult: true, look: 'pit' });
};

export function entsTerrain(): NarrativeTerrain[] {
  const pits = PITS.flatMap((run, i) => run.slice(1).map((b, j) => stretch(`pit-${i + 1}-${j + 1}`, run[j], b)));
  return [
    // The banks of the Isen's valley either side of the dam.
    piece({ id: 'bank-n', kind: 'cliff', x: 0.7, y: DAM.y0 / 2, w: 1.4, h: DAM.y0, height: 3 }),
    piece({ id: 'bank-s', kind: 'cliff', x: 0.7, y: (DAM.y1 + BOARD) / 2, w: 1.4, h: BOARD - DAM.y1, height: 3 }),
    // The dam, held by the Evil side: Defence 10, 5 Wounds, and only harmed in combat.
    { ...piece({ id: DAM.id, kind: 'gate', x: (DAM.x0 + DAM.x1) / 2, y: (DAM.y0 + DAM.y1) / 2, w: DAM.x1 - DAM.x0, h: DAM.y1 - DAM.y0, door: 'dam', height: 3 }), held: 'evil' },
    // Orthanc: the two great piers that cross it, and its core (drawn over them).
    piece({ id: 'orthanc-piers-a', kind: 'building', x: ORTHANC.x, y: ORTHANC.y, w: ORTHANC.arm, h: ORTHANC.armWidth, rot: 45, height: ORTHANC.height, sheer: true, look: 'orthanc' }),
    piece({ id: 'orthanc-piers-b', kind: 'building', x: ORTHANC.x, y: ORTHANC.y, w: ORTHANC.arm, h: ORTHANC.armWidth, rot: -45, height: ORTHANC.height, sheer: true, look: 'orthanc' }),
    piece({ id: 'orthanc', kind: 'building', x: ORTHANC.x, y: ORTHANC.y, w: ORTHANC.core, h: ORTHANC.core, height: ORTHANC.height, sheer: true, look: 'orthanc' }),
    // The pits.
    ...pits,
    // The scaffolds' decks, and the ladders up them.
    ...SCAFFOLDS.map(s => piece({ id: s.id, kind: 'wall', x: s.x, y: s.y, w: s.long, h: s.wide, rot: s.rot, height: s.height, walk: true, look: 'scaffold' })),
    ...LADDERS.map(l => {
      const s = SCAFFOLDS.find(x => x.id === l.on)!;
      const p = onDeck(l.on, l.k, l.side);
      return piece({ id: l.id, kind: 'road', x: p.x, y: p.y, w: 1, h: 1.3, rot: s.rot + 90, stairs: true, look: 'ladder' });
    }),
    // Rubble.
    ...RUBBLE.map(([x, y, w, h, rot], i) => piece({ id: `rubble-${i + 1}`, kind: 'rock', shape: 'circle', x, y, w, h, rot, height: RUBBLE_HEIGHT, look: 'stone' })),
  ];
}

type Member = Omit<CastMember, 'place'>;

/** The Good side sets up wholly within 6" of the east edge. */
export const GOOD_AREA: Area = { box: [BOARD - 6, 0, BOARD, BOARD] };
/** The Evil side, wholly within the western half of the table or on top of any of the scaffolds. */
export const EVIL_AREA: Area = { any: [{ box: [0, 0, BOARD / 2, BOARD] }, { on: SCAFFOLDS.map(s => s.id) }] };

const R25 = 25 / 25.4 / 2;
const GAP = 2 * R25 + 0.06;

/** Last March of the Ents: the book's cast, where the scenario starts them. */
export function entsCast(): CastMember[] {
  const F = '[fangorn]';
  const W = '[army-of-the-white-hand]';
  // The Ents in a line down the east edge, Treebeard in the middle.
  const ents: Member[] = [
    { key: 'ent', side: 'good', unit: `${F} ent` },
    { key: 'birchseed', side: 'good', unit: `${F} birchseed` },
    { key: 'treebeard', side: 'good', unit: `${F} treebeard`, options: ['Merry & Pippin'] },
    { key: 'ent', side: 'good', unit: `${F} ent` },
    { key: 'beechbone', side: 'good', unit: `${F} beechbone` },
    { key: 'ent', side: 'good', unit: `${F} ent` },
  ];
  const out: CastMember[] = ents.map((c, i) => ({ ...c, facing: 270, place: { area: GOOD_AREA, at: [45, 14 + i * 4] } }));
  const orc = (option: string): Member => ({ key: 'orc', side: 'evil', unit: `${W} isengard-orc-warrior`, options: [option] });
  const evil = (c: Member, at: Point): CastMember => ({ ...c, facing: 90, place: { area: EVIL_AREA, at: [+at.x.toFixed(2), +at.y.toFixed(2)] } });
  // A shield wall in front of the dam, spears behind it.
  for (let i = 0; i < 16; i++) out.push(evil(orc('Shield'), { x: 10, y: 15.2 + i * GAP }));
  for (let i = 0; i < 16; i++) out.push(evil(orc('Spear'), { x: 10 - GAP, y: 15.2 + i * GAP }));
  // The two-handed weapons west of Orthanc, ready to go in.
  for (let i = 0; i < 8; i++) out.push(evil(orc('Two-handed weapon'), { x: 16.5, y: 20.2 + i * GAP }));
  // The archers up on the scaffolds.
  const decks: [string, number][] = [
    ['scaffold-ne', -1.6],
    ['scaffold-ne', 0],
    ['scaffold-ne', 1.6],
    ['scaffold-nw-low', 1.4],
    ['scaffold-nw-low', 2.6],
    ['scaffold-nw-high', 0.6],
    ['scaffold-sw-low', 0.4],
    ['scaffold-sw-high', 0.9],
  ];
  for (const [id, k] of decks) out.push(evil(orc('Orc bow'), onDeck(id, k)));
  // A Captain at each end of the shield wall, and two with the two-handed weapons.
  const captain: Member = { key: 'captain', side: 'evil', unit: `${W} isengard-orc-captain` };
  for (const at of [
    { x: 11.3, y: 14.6 },
    { x: 11.3, y: 31.9 },
    { x: 16.5, y: 18.9 },
    { x: 16.5, y: 28.8 },
  ])
    out.push(evil(captain, at));
  return out;
}
