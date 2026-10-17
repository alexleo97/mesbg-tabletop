import { bandOutline } from './sight.ts';
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

type Pt = [number, number];

/**
 * A river along a course of board points: the course is smoothed into a gently winding centreline,
 * and the water narrows and widens a little as it goes, so it reads as a real river rather than a strip.
 */
export function river(course: Pt[], width: number): Piece {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < course.length - 1; i++) {
    const p0 = course[Math.max(0, i - 1)];
    const p1 = course[i];
    const p2 = course[i + 1];
    const p3 = course[Math.min(course.length - 1, i + 2)];
    const steps = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.2));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      pts.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1]), 0]);
    }
  }
  const last = course[course.length - 1];
  pts.push([last[0], last[1], 0]);
  // Width varies along the course, the same at both ends so a river through the middle stays balanced.
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) pts[i][2] = (width / 2) * (1 + 0.16 * Math.sin((i / n) * Math.PI * 6));
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const pad = width;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { kind: 'water', shape: 'rect', x: cx, y: cy, w: Math.min(48, x1 - x0), h: Math.min(48, y1 - y0), rot: 0, path: pts.map(([x, y, hw]) => [+(x - cx).toFixed(2), +(y - cy).toFixed(2), +hw.toFixed(2)]) };
}

/** A bridge across a river at a point, the river's course there running at `angle` degrees. */
const bridge = (x: number, y: number, angle: number, span = 7.5): Piece => ({ kind: 'bridge', shape: 'rect', x, y, w: span, h: 2.6, rot: angle + 90 });

/**
 * Original layouts for a 48"×48" table, built on the usual tournament guidance: roughly a quarter to
 * a third of the table covered, something in the middle that blocks line of sight or funnels the
 * armies, clear lanes to move through, and the same terrain in front of both deployment zones.
 * Player 1 deploys from the bottom edge, player 2 from the top. Rivers through the middle are laid out
 * symmetrically about the centre, so they're listed once.
 */
export const STARTER_BOARDS: StarterBoard[] = [
  {
    id: 'river-crossing',
    name: 'River Crossing',
    blurb: 'A winding river splits the field. The old bridge in the middle is the only quick way across.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        circle('wood', 9, 31, 10, 6.5, -8),
        rect('ruin', 30.5, 30.5, 4.5, 3.5, 20),
        rect('wall', 34, 33, 3.5, 0.5, 20),
        rect('field', 40, 39.5, 9, 5.5, -4),
        circle('rock', 18, 36.5, 3.2, 2.4, 30),
        circle('hill', 5, 43, 9, 6),
        circle('wood', 44, 36, 6, 5),
      ],
      [river([[0, 19], [8, 22.5], [16, 20], [24, 24], [32, 28], [40, 25.5], [48, 29]], 4.2), bridge(24, 24, 27)],
    ),
  },
  {
    id: 'ruined-city',
    name: 'Ruined City',
    blurb: 'Roofless halls and walled yards around a fallen tower. Lots of cover and narrow streets.',
    mat: 'stone',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        rect('building', 5.5, 30, 7, 5),
        rect('ruin', 5.5, 35.5, 7, 5),
        rect('ruin', 16.5, 33, 6, 6),
        rect('wall', 16.5, 29.7, 6, 0.6),
        rect('building', 27, 32, 6, 4),
        rect('ruin', 27, 36.5, 6, 4),
        rect('building', 39, 33, 6, 7),
        rect('ruin', 45, 33, 4.5, 6),
        rect('wall', 41.5, 37.5, 11, 0.6),
        rect('ruin', 20, 43, 6, 4),
        rect('ruin', 9, 44, 4, 3),
        circle('rock', 31.5, 42, 2.4, 1.8, 20),
        circle('rock', 19, 26.5, 2.2, 1.6),
      ],
      [rect('ruin', 24, 24, 7, 7, 45)],
    ),
  },
  {
    id: 'woodland-edge',
    name: 'Woodland Edge',
    blurb: 'Deep woods on the flanks, low hills, and a stream winding between them, crossed by two footbridges.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        circle('wood', 6, 33, 11, 15, 5),
        circle('wood', 14.5, 43.5, 8, 5),
        circle('wood', 31, 38, 6, 4.5, -15),
        rect('building', 36, 43, 4.5, 3.5, -10),
        rect('field', 42, 29, 8, 4.5, -10),
        circle('hill', 17, 30.5, 9, 6, 20),
        circle('rock', 27, 37, 3, 2.2),
        bridge(16.5, 18.5, 46, 6),
      ],
      [river([[0, 7], [7, 10], [13, 15.5], [19, 21], [24, 24], [29, 27], [35, 32.5], [41, 38], [48, 41]], 2.6)],
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
        circle('cliff', 5, 22, 12, 20, 5),
        circle('cliff', 11, 30, 9, 10, -20),
        circle('cliff', 14, 40, 7, 6, 10),
        circle('rock', 20, 32, 3, 2.4, 15),
        circle('wood', 3.5, 41, 6, 7),
        circle('rock', 33, 38, 3.5, 2.6, -10),
        circle('wood', 42, 44, 9, 4),
      ],
      [rect('ruin', 24, 24, 5, 5, 45), circle('rock', 19, 22.5, 2.6, 2), circle('rock', 29, 25.5, 2.6, 2)],
    ),
  },
  {
    id: 'farmstead',
    name: 'Farmstead',
    blurb: 'Fields and hedges around a farmhouse, with an orchard, a mill pond and walled lanes to fight along.',
    mat: 'plains',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        rect('field', 8, 31, 12, 7),
        rect('wall', 8, 35, 12, 0.5),
        rect('wall', 14.25, 31, 0.5, 8.5),
        rect('building', 30, 32, 6, 4),
        rect('building', 37, 33.5, 3, 3),
        rect('wall', 30, 36.5, 9, 0.5),
        circle('wood', 42, 36, 8, 7),
        circle('rock', 20.5, 39, 2.6, 2),
        rect('field', 22, 44, 10, 4),
      ],
      [circle('water', 24, 24, 8, 5, 20), circle('wood', 13, 22, 6, 5), circle('wood', 35, 26, 6, 5)],
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
  const area = b.pieces.reduce((sum, p) => sum + (p.path ? polygonArea(bandOutline(p.path)) : p.shape === 'circle' ? (Math.PI * p.w * p.h) / 4 : p.w * p.h), 0);
  return area / (b.w * b.h);
}

function polygonArea(poly: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(a) / 2;
}
