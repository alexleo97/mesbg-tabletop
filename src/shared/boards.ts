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

/** Original layouts for a 48"×48" table. Player 1 deploys from the bottom edge, player 2 from the top. */
export const STARTER_BOARDS: StarterBoard[] = [
  {
    id: 'river-crossing',
    name: 'River Crossing',
    blurb: 'A river splits the field, with one shallow ford in the middle worth fighting over.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: [
      rect('water', 10.5, 24, 21, 3.5),
      rect('water', 37.5, 24, 21, 3.5),
      rect('ruin', 27.5, 19.5, 3.5, 2.5, 10),
      rect('ruin', 20, 28.5, 3, 2, -8),
      circle('wood', 8, 12, 10, 7),
      circle('wood', 40, 36, 10, 7),
      circle('hill', 40, 11, 11, 7, 15),
      circle('rock', 31, 13, 3, 2.5),
      circle('rock', 16, 35, 3.5, 2.5, 30),
      rect('field', 8, 38, 9, 6),
      rect('wall', 8, 34.5, 9, 0.5),
    ],
  },
  {
    id: 'ruined-city',
    name: 'Ruined City',
    blurb: 'Broken streets and roofless halls. Lots of cover, narrow lanes, and an open square at the heart.',
    mat: 'stone',
    w: 48,
    h: 48,
    pieces: [
      rect('ruin', 11, 11, 7, 5.5),
      rect('ruin', 37, 12, 6, 7, 5),
      rect('building', 11, 37, 7, 5),
      rect('ruin', 36.5, 36.5, 7, 6, -4),
      rect('ruin', 19, 18, 3.5, 2.5, 20),
      rect('ruin', 29, 30, 3.5, 2.5, -15),
      rect('wall', 24, 9, 7, 0.6),
      rect('wall', 24, 39, 7, 0.6),
      rect('wall', 6, 24, 7, 0.6, 90),
      rect('wall', 42, 24, 7, 0.6, 90),
      circle('rock', 28, 18.5, 2, 1.5),
      circle('rock', 20, 30, 2, 1.5, 40),
      circle('water', 24, 24, 3, 3),
    ],
  },
  {
    id: 'woodland-edge',
    name: 'Woodland Edge',
    blurb: 'Dense forest along one flank, a hill to hold on the other, and a stream between.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: [
      circle('wood', 6, 13, 11, 13),
      circle('wood', 8, 31, 13, 12),
      circle('wood', 17, 22, 8, 8),
      circle('hill', 35, 24, 13, 9, -10),
      circle('rock', 30, 9, 3, 3),
      circle('rock', 41, 39, 4, 3, 20),
      rect('field', 39, 7, 9, 5),
      rect('water', 26, 37, 2, 15, 35),
      rect('building', 38, 31.5, 3.5, 3),
    ],
  },
  {
    id: 'mountain-pass',
    name: 'Mountain Pass',
    blurb: 'Snowbound cliffs squeeze the armies into a narrow pass guarded by an old watchtower.',
    mat: 'snow',
    w: 48,
    h: 48,
    pieces: [
      rect('cliff', 4.5, 24, 9, 28),
      rect('cliff', 43.5, 24, 9, 28),
      circle('cliff', 14, 24, 7, 11),
      circle('cliff', 34, 24, 7, 11),
      rect('ruin', 24, 24, 3.5, 3.5, 45),
      circle('rock', 24, 13, 3, 2),
      circle('rock', 22, 35, 3.5, 2.5, 25),
      circle('water', 31, 32, 4, 3),
      circle('wood', 7, 43, 8, 4),
      circle('wood', 41, 5, 8, 4),
    ],
  },
];

export function starterTerrain(b: StarterBoard, newId: (p: string) => string): Terrain[] {
  return b.pieces.map(p => ({ rot: 0, ...p, id: newId('t'), locked: true }));
}
