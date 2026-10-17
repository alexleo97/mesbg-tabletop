import type { Mat, Terrain } from './types.ts';

type Piece = Omit<Terrain, 'id' | 'locked' | 'rot'> & { rot?: number };

export interface StarterBoard {
  id: string;
  name: string;
  blurb: string;
  mat: Mat;
  w: number;
  h: number;
  pieces: Piece[];
}

const circle = (kind: Terrain['kind'], x: number, y: number, w: number, h: number, rot = 0): Piece => ({ kind, shape: 'circle', x, y, w, h, rot });
const rect = (kind: Terrain['kind'], x: number, y: number, w: number, h: number, rot = 0): Piece => ({ kind, shape: 'rect', x, y, w, h, rot });

/**
 * Each player's half mirrored through the centre (a half turn), the way tournament tables are set
 * up so neither side gets the better deployment. Centre pieces are listed once.
 */
function balanced(half: Piece[], centre: Piece[] = []): Piece[] {
  const turned = half.map(p => ({ ...p, x: 48 - p.x, y: 48 - p.y, rot: ((p.rot ?? 0) + 180) % 360 }));
  return [...centre, ...half, ...turned];
}

/**
 * Original layouts for a 48"×48" table, built on the usual tournament guidance: roughly a quarter to
 * a third of the table covered, something in the middle that blocks line of sight, clear lanes to
 * move through, and the same terrain in front of both deployment zones. Player 1 deploys from the
 * bottom edge, player 2 from the top.
 */
export const STARTER_BOARDS: StarterBoard[] = [
  {
    id: 'river-crossing',
    name: 'River Crossing',
    blurb: 'A river splits the field, with one shallow ford in the middle worth fighting over.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced([
      rect('water', 10, 24, 19, 3.5),
      circle('wood', 8, 10, 11, 8),
      circle('wood', 26, 6, 7, 4.5, 10),
      circle('hill', 38, 11, 12, 8, 15),
      rect('ruin', 20, 18.5, 4, 3, 10),
      circle('rock', 30, 15, 3.5, 2.5),
      rect('field', 42, 19, 8, 4.5),
    ]),
  },
  {
    id: 'ruined-city',
    name: 'Ruined City',
    blurb: 'Broken streets and roofless halls around a fallen tower. Lots of cover and narrow lanes.',
    mat: 'stone',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        rect('ruin', 10, 10, 9, 7),
        rect('building', 36, 9, 8, 6, 5),
        rect('ruin', 28, 11, 5, 4),
        rect('ruin', 17.5, 19, 4, 3, 20),
        rect('building', 17, 30, 5, 4, -5),
        rect('ruin', 4.5, 38, 5, 4),
        rect('ruin', 40, 30, 5, 4, 10),
        rect('wall', 24, 6, 7, 0.6),
        rect('wall', 3, 22, 7, 0.6, 90),
        circle('rock', 24, 15, 2, 1.5),
        rect('ruin', 40, 21, 4, 5),
      ],
      [rect('ruin', 24, 24, 6, 6, 45)],
    ),
  },
  {
    id: 'woodland-edge',
    name: 'Woodland Edge',
    blurb: 'Thick woods on the flanks and a low hill in the middle that blocks the view across.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        circle('wood', 7, 14, 12, 14),
        circle('wood', 19, 6, 8, 5.5, -10),
        circle('rock', 36, 12, 3.5, 3),
        rect('field', 41, 5.5, 9, 5),
        rect('building', 31, 18, 3.5, 3, 10),
        rect('water', 14, 27, 2, 9, 30),
      ],
      [circle('hill', 24, 24, 12, 9, -20)],
    ),
  },
  {
    id: 'mountain-pass',
    name: 'Mountain Pass',
    blurb: 'Snowbound cliffs squeeze the armies into a narrow pass guarded by an old watchtower.',
    mat: 'snow',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        circle('cliff', 9, 14, 16, 22),
        circle('cliff', 12, 36, 12, 13, 15),
        circle('rock', 21, 9, 3, 2.5),
        circle('wood', 24, 4, 7, 3.5),
        circle('rock', 2.5, 28, 3, 4),
      ],
      [rect('ruin', 24, 24, 5, 5, 45)],
    ),
  },
];

/** Five markers in the Domination pattern: one in the centre, four more at least 12" from it and each other, kept in the open lanes. */
export const OBJECTIVE_SPOTS: [number, number][] = [
  [0, 0],
  [-6, -11],
  [6, -11],
  [-6, 11],
  [6, 11],
];

export function objectiveMarkers(w: number, h: number, newId: (p: string) => string): Terrain[] {
  return OBJECTIVE_SPOTS.map(([dx, dy]) => ({ id: newId('t'), kind: 'objective', shape: 'circle', x: w / 2 + dx, y: h / 2 + dy, w: 1.6, h: 1.6, rot: 0, locked: true }));
}

export function starterTerrain(b: StarterBoard, newId: (p: string) => string): Terrain[] {
  return b.pieces.map(p => ({ rot: 0, ...p, id: newId('t'), locked: true }));
}

/** Share of the table a layout covers, using each piece's footprint. */
export function coverage(b: StarterBoard) {
  const area = b.pieces.reduce((sum, p) => sum + (p.shape === 'circle' ? (Math.PI * p.w * p.h) / 4 : p.w * p.h), 0);
  return area / (b.w * b.h);
}
