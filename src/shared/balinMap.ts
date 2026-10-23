import type { Point } from './geometry.ts';
import type { CastMember, NarrativeTerrain } from './narrative.ts';
import type { Terrain } from './types.ts';

// Balin's Tomb: the table, drawn in our own way from the scenario's map, and where the cast starts. Inches from the
// north-west corner of a 2' by 2' table. A raised ledge 3" wide runs right round the chamber, broken only by the passage
// down to the doorway in the middle of the south edge; four pillars stand on each side of the floor, the tomb in the
// middle and the well towards the north. (Heights and where they come from are in plans/balins-tomb-audit.md.)

export const BOARD = 24;
/** The middle of the table, where the tomb stands and the Fellowship sets up. */
export const CENTRE: Point = { x: 12, y: 12 };
/** The doorway: the middle of the south edge, and the stretch of edge the passage down to it spans. */
export const DOORWAY: Point = { x: 12, y: 24 };
export const DOOR_SPAN: [number, number] = [9, 15];
/** How wide the ledge is, and how high it stands above the floor. */
export const LEDGE = { w: 3, h: 1 };
/** The well, 6" in from the middle of the north edge. */
export const WELL = { x: 12, y: 6, d: 1.5 };
/** The trapdoors, on the ledge in the middle of the west and east edges. */
export const TRAPDOORS = [
  { id: 'trapdoor-w', x: 1.3, y: 12 },
  { id: 'trapdoor-e', x: 22.7, y: 12 },
];
export const TRAPDOOR_SIZE = 1.4;
/** Both sides set up wholly within this far of their point. */
export const ZONE = 6;

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

/** A run of the ledge: models climb onto it and stand along its top. */
const ledge = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  piece({ id, kind: 'wall', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, height: LEDGE.h, walk: true, look: 'stone' });

export function balinTerrain(): NarrativeTerrain[] {
  const L = LEDGE.w;
  return [
    // The ledge round the chamber, broken by the passage to the doorway.
    ledge('ledge-n', 0, 0, BOARD, L),
    ledge('ledge-w', 0, L, L, BOARD - L),
    ledge('ledge-e', BOARD - L, L, BOARD, BOARD - L),
    ledge('ledge-sw', 0, BOARD - L, DOOR_SPAN[0], BOARD),
    ledge('ledge-se', DOOR_SPAN[1], BOARD - L, BOARD, BOARD),
    // The doorway, thrown open, in the middle of the south edge.
    piece({ id: 'doorway', kind: 'road', x: DOORWAY.x, y: BOARD - 0.3, w: DOOR_SPAN[1] - DOOR_SPAN[0] - 0.6, h: 0.6, look: 'doorway' }),
    // Four pillars down each side of the floor, reaching up into the dark.
    ...[5.1, 9.6, 14.2, 18.7].flatMap((y, i) => [
      piece({ id: `pillar-w${i + 1}`, kind: 'building', shape: 'circle', x: 4, y, w: 2, h: 2, height: 5, look: 'pillar' }),
      piece({ id: `pillar-e${i + 1}`, kind: 'building', shape: 'circle', x: 20, y, w: 2, h: 2, height: 5, look: 'pillar' }),
    ]),
    // Balin's tomb in the middle, and the well.
    piece({ id: 'tomb', kind: 'building', x: CENTRE.x, y: CENTRE.y, w: 2, h: 3.2, height: 1, look: 'tomb' }),
    piece({ id: 'well', kind: 'building', shape: 'circle', x: WELL.x, y: WELL.y, w: WELL.d, h: WELL.d, height: 1, look: 'well' }),
    // The trapdoors, on the ledge.
    ...TRAPDOORS.map(t => piece({ id: t.id, kind: 'road', x: t.x, y: t.y, w: TRAPDOOR_SIZE, h: TRAPDOOR_SIZE, look: 'trapdoor' })),
    // Rubble fallen from the walls, where the map shows it.
    piece({ id: 'rubble-ne', kind: 'rock', shape: 'circle', x: 15.6, y: 3.9, w: 1, h: 0.8, rot: 20, height: 0.4 }),
    piece({ id: 'rubble-w', kind: 'rock', shape: 'circle', x: 5.4, y: 12.8, w: 0.8, h: 0.6, rot: -15, height: 0.4 }),
    piece({ id: 'rubble-e', kind: 'rock', shape: 'circle', x: 17.8, y: 13.1, w: 0.9, h: 0.6, rot: 30, height: 0.4 }),
  ];
}

type Member = Omit<CastMember, 'place'>;

/** Balin's Tomb: the book's cast, the Fellowship round the tomb and the Goblins in the doorway. */
export function balinCast(): CastMember[] {
  const F = '[the-fellowship]';
  const M = '[moria]';
  const good = { circle: [CENTRE.x, CENTRE.y, ZONE] as [number, number, number] };
  const evil = { circle: [DOORWAY.x, DOORWAY.y, ZONE] as [number, number, number] };
  // The Fellowship round the tomb, Gimli up on it, the Hobbits at its north end, the fighters between them and the door.
  const fellowship: [Member, number, number][] = [
    [{ key: 'gimli', side: 'good', unit: `${F} gimli` }, 12, 12],
    [{ key: 'frodo', side: 'good', unit: `${F} frodo-baggins`, options: ['Sting', 'Mithril Coat'] }, 12, 9.8],
    [{ key: 'sam', side: 'good', unit: `${F} samwise-gamgee` }, 13.05, 9.55],
    [{ key: 'merry', side: 'good', unit: `${F} meriadoc-brandybuck` }, 10.95, 9.55],
    [{ key: 'pippin', side: 'good', unit: `${F} peregrin-took` }, 12, 8.75],
    [{ key: 'legolas', side: 'good', unit: `${F} legolas` }, 14, 11],
    [{ key: 'aragorn', side: 'good', unit: `${F} aragorn-strider`, options: ['Bow'] }, 10.2, 13.6],
    [{ key: 'boromir', side: 'good', unit: `${F} boromir-of-gondor`, options: ['Shield'] }, 13.8, 13.6],
    [{ key: 'gandalf', side: 'good', unit: `${F} gandalf-the-grey` }, 12, 14.6],
  ];
  const out: CastMember[] = fellowship.map(([c, x, y]) => ({ ...c, facing: 180, place: { area: good, at: [x, y] } }));
  // The Goblins packed into the passage and the floor before it: shields at the front, spears behind, bows at the
  // back, a Captain with each half.
  const times = (n: number, f: () => Member): Member[] => Array.from({ length: n }, f);
  const horde: Member[] = [
    ...times(8, () => ({ key: 'goblin', side: 'evil', unit: `${M} moria-goblin-warrior`, options: ['Shield'] })),
    { key: 'goblin-captain', side: 'evil', unit: `${M} moria-goblin-captain` },
    ...times(8, () => ({ key: 'goblin', side: 'evil', unit: `${M} moria-goblin-warrior`, options: ['Spear'] })),
    { key: 'goblin-captain', side: 'evil', unit: `${M} moria-goblin-captain` },
    ...times(8, () => ({ key: 'goblin', side: 'evil', unit: `${M} moria-goblin-warrior`, options: ['Orc bow'] })),
  ];
  const slots = doorwaySlots();
  horde.forEach((c, i) => out.push({ ...c, facing: 0, place: { area: evil, at: [slots[i].x, slots[i].y] } }));
  // The Cave Troll, kept back until the Evil side's fourth move.
  out.push({ key: 'cave-troll', side: 'evil', unit: `${M} cave-troll`, options: ['Hand-and-a-half weapon'], place: { aside: true } });
  return out;
}

/** Whether a point on the floor is clear of the ledge for a base this far across (its middle to its edge). */
export const offLedge = (p: Point, r: number) => {
  const L = LEDGE.w;
  if (p.x - r < L || p.x + r > BOARD - L || p.y - r < L) return false;
  return p.y + r <= BOARD - L || (p.x - r >= DOOR_SPAN[0] && p.x + r <= DOOR_SPAN[1]);
};

/** Spots for 25mm bases wholly within 6" of the doorway on the floor, the front rank first, each rank from the middle out. */
export function doorwaySlots(): Point[] {
  const r = 25 / 25.4 / 2;
  const gap = 2 * r + 0.01;
  const rows: Point[][] = [];
  // Rank by rank from the doorway in, each laid out whichever way fits more: one in the middle, or two either side of it.
  for (let y = BOARD - r - 0.005; y >= BOARD - ZONE + r; y -= gap) {
    const fits = (p: Point) => Math.hypot(p.x - DOORWAY.x, p.y - DOORWAY.y) + r <= ZONE - 0.01 && offLedge(p, r);
    const lay = (offset: number) => {
      const row: Point[] = [];
      for (let k = 0; k < 24; k++) {
        const p = { x: DOORWAY.x + offset + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * gap, y };
        if (fits(p)) row.push(p);
      }
      return row;
    };
    const [a, b] = [lay(0), lay(gap / 2)];
    rows.push(b.length > a.length ? b : a);
  }
  return rows.reverse().flat();
}
