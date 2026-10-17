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

type Pt = [number, number];

/**
 * Something laid along a course of board points (a river, stream or road): the course is smoothed into a
 * gently winding centreline, and the width wanders a little as it goes so it doesn't look ruled.
 * Courses for rivers and roads start and end a few inches off the table, so they run cleanly off the edge.
 */
function band(kind: 'water' | 'road', course: Pt[], width: number, wander: number): Piece {
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
  // The same width at matching points from either end, so a course through the middle stays balanced.
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) pts[i][2] = (width / 2) * (1 + wander * Math.sin((i / n) * Math.PI * 6));
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - width, Math.max(...xs) + width, Math.min(...ys) - width, Math.max(...ys) + width];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { kind, shape: 'rect', x: cx, y: cy, w: Math.min(48, x1 - x0), h: Math.min(48, y1 - y0), rot: 0, path: pts.map(([x, y, hw]) => [+(x - cx).toFixed(2), +(y - cy).toFixed(2), +hw.toFixed(2)]) };
}

export const river = (course: Pt[], width: number) => band('water', course, width, 0.16);
const road = (course: Pt[], width = 2.8) => band('road', course, width, 0.05);

/** A bridge centred on a point, its deck running at `rot` degrees (the direction of the road over it). */
const bridge = (x: number, y: number, rot: number, span = 8): Piece => ({ kind: 'bridge', shape: 'rect', x, y, w: span, h: 2.8, rot });

/**
 * Original layouts for a 48"×48" table. At this scale a model's base is about an inch, so a 6"×4"
 * building is a cottage and a 12"×7" field is a small paddock. Every board has a reason for its terrain
 * to be where it is (a road to a bridge, houses along a street, fields round a farm). The two halves
 * are laid out differently but get a similar amount of cover, so neither side starts ahead
 * (tests/boards.test.ts checks this, and that nothing sits in a river, on a road or on top of another piece).
 * Player 1 deploys from the bottom edge, player 2 from the top.
 */
export const STARTER_BOARDS: StarterBoard[] = [
  {
    id: 'river-crossing',
    name: 'River Crossing',
    blurb: 'A river cuts the field in two. The road meets it at an old bridge, the only quick way across.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: [
      road([[20, 51], [22, 40], [25, 32], [24, 24.5], [22.5, 16], [25, 8], [24, -3]]),
      river([[-3, 20], [9, 23.5], [17, 21], [24, 24.5], [31, 27], [40, 24], [51, 27]], 4.2),
      bridge(24, 24.5, 81),
      // South bank: a ruined mill, a farm by the road, and a copse.
      rect('ruin', 33, 34, 5, 4, 10),
      rect('building', 30, 41, 5, 3.5, -4),
      rect('field', 40.5, 39, 7, 6),
      rect('field', 45.5, 32.5, 4.5, 6),
      circle('wood', 9, 33, 10, 6.5, -8),
      circle('wood', 16.5, 30.5, 4.5, 3.5, 10),
      circle('rock', 14, 40, 3.2, 2.4, 30),
      // North bank: a watchtower on a hill, a cottage with its garden wall, an old wood.
      circle('hill', 37, 12, 11, 7, 15),
      rect('ruin', 37, 12, 4, 4, 15),
      circle('wood', 6.5, 10, 10, 8),
      rect('building', 16, 14, 5, 3.5, 5),
      rect('wall', 16, 10.8, 6, 0.5, 5),
      rect('field', 30, 16.5, 7, 5),
      circle('rock', 44.5, 19, 3, 2.2),
      circle('wood', 45, 8, 4.5, 6),
    ],
  },
  {
    id: 'ruined-city',
    name: 'Ruined Town',
    blurb: 'A burned-out market town: houses along two crossing streets, walled yards behind them and a manor hall to the north.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: [
      road([[-3, 23], [12, 24.5], [24, 24], [36, 23.5], [51, 25]], 3.2),
      road([[25, 51], [24.5, 36], [24, 24], [23.5, 12], [23, -3]], 2.8),
      // South side of the main street.
      rect('building', 4.5, 29.5, 7, 4),
      rect('ruin', 12, 30, 6, 5),
      rect('building', 19, 29.5, 4.5, 4),
      rect('ruin', 30, 30, 5, 5),
      rect('building', 36.5, 30, 6, 5),
      rect('ruin', 44, 29.5, 5.5, 4),
      rect('wall', 6, 35, 9, 0.5),
      rect('ruin', 32, 40, 6, 7),
      rect('building', 17.5, 40.5, 5, 4),
      circle('rock', 9, 41, 2.4, 1.8, 20),
      circle('rock', 41.5, 38, 2.6, 1.9),
      // North side: a different row, and the old manor behind it.
      rect('ruin', 4, 18, 5.5, 5),
      rect('building', 11, 18.5, 6, 4.5),
      rect('ruin', 18, 18, 4.5, 5.5),
      rect('building', 29.6, 18.5, 5.5, 4.5),
      rect('ruin', 36.5, 18, 6.5, 5.5),
      rect('building', 43.5, 18.5, 5, 4.5),
      rect('ruin', 12.5, 8, 9, 6),
      rect('wall', 36, 12, 10, 0.5),
      circle('wood', 33, 7, 6, 4),
      circle('rock', 43, 9, 2.4, 1.8),
    ],
  },
  {
    id: 'woodland-edge',
    name: 'Woodland Edge',
    blurb: 'Deep woods on the flanks, low hills, and a stream winding between them, crossed by two footbridges.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: [
      river([[-3, 7], [6, 10.5], [13, 16], [19, 20], [25, 24.5], [31, 27], [36, 33], [42, 38.5], [51, 41]], 2.6),
      bridge(13, 16, 126, 6),
      bridge(36, 33, 136, 6),
      // South
      circle('wood', 6, 34, 11, 14, 5),
      circle('hill', 17.5, 31, 9, 6, 20),
      circle('wood', 28, 41, 6, 4.5, -15),
      rect('building', 37, 44, 4.5, 3.5, -10),
      rect('field', 45, 30.5, 5, 6),
      circle('rock', 25, 34, 3, 2.2),
      // North
      circle('wood', 42, 13, 11, 15, -5),
      circle('hill', 30, 14, 8, 5.5, -15),
      circle('wood', 20, 7, 7, 5),
      rect('field', 5, 20.5, 7, 5),
      rect('ruin', 23, 15, 4, 4, 10),
      rect('building', 11, 4, 4.5, 3.5),
    ],
  },
  {
    id: 'mountain-pass',
    name: 'Mountain Pass',
    blurb: 'A road climbs through a snowbound pass between two ridges, past a ruined watchtower.',
    mat: 'snow',
    w: 48,
    h: 48,
    pieces: [
      road([[17, 51], [20, 41], [26, 31], [24, 24], [21, 16], [27, 7], [30, -3]], 3),
      // The western ridge reaches down the south half.
      circle('cliff', 3, 27, 6, 9, 15),
      circle('cliff', 7, 33, 7, 6, -20),
      circle('cliff', 4, 39.5, 6, 7),
      circle('cliff', 12, 38, 5, 4, -30),
      rect('ruin', 15, 30, 5, 5, 20),
      circle('wood', 33, 31, 6, 4.5),
      circle('cliff', 44.5, 33.5, 7, 8, 10),
      circle('cliff', 38.5, 38, 6, 4.5, 25),
      circle('rock', 30, 41, 2.8, 2.2, 15),
      // The eastern ridge holds the north half; a lower spur comes in from the west.
      circle('cliff', 45, 15, 6, 10),
      circle('cliff', 39, 10, 7, 6, 30),
      circle('cliff', 35.5, 17, 5, 4, -20),
      circle('cliff', 4, 13, 7, 8),
      circle('cliff', 9.5, 9, 6, 4.5, -25),
      rect('ruin', 31, 21, 4, 4, -10),
      circle('wood', 13, 19, 6, 4),
      circle('rock', 18, 6, 2.6, 2),
      circle('cliff', 41, 21, 5, 4, 10),
      circle('rock', 18.5, 11, 3, 2.4),
    ],
  },
  {
    id: 'farmstead',
    name: 'Farmstead',
    blurb: 'A farm lane runs between hedged fields, past a farmhouse and barn round a yard, an orchard and a mill.',
    mat: 'plains',
    w: 48,
    h: 48,
    pieces: [
      road([[-3, 21], [12, 23], [24, 24.5], [36, 23], [51, 26]], 2.6),
      // South: the farm itself.
      rect('field', 7, 33, 12, 7),
      rect('field', 19.4, 33, 12, 7),
      rect('building', 33, 30.5, 7, 4),
      rect('building', 39.8, 33.5, 4, 7),
      rect('wall', 33, 36.5, 8, 0.5),
      circle('wood', 45.5, 39, 4.5, 7),
      circle('water', 29, 42, 5, 3.5, 15),
      circle('wood', 12, 41.5, 7, 4.5),
      // North: wider fields, the mill and a spinney.
      rect('field', 36, 13, 14, 8),
      rect('field', 10, 14, 10, 7),
      rect('ruin', 21.5, 15, 5, 4),
      circle('wood', 25, 6.5, 7, 5),
      rect('building', 4, 6, 4.5, 3.5),
      circle('rock', 46, 19, 2.4, 1.8),
    ],
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

/** Five markers in the usual spread; unlocked so players can drag them where the scenario says. */
export function objectiveMarkers(w: number, h: number, newId: (p: string) => string): Terrain[] {
  return OBJECTIVE_SPOTS.map(([dx, dy]) => ({ id: newId('t'), kind: 'objective', shape: 'circle', x: w / 2 + dx, y: h / 2 + dy, w: 1.6, h: 1.6, rot: 0, locked: false }));
}

export function starterTerrain(b: StarterBoard, newId: (p: string) => string): Terrain[] {
  return b.pieces.map(p => ({ rot: 0, ...p, id: newId('t'), locked: true }));
}

/** Share of the table a layout covers, using each piece's footprint. */
export function coverage(b: StarterBoard) {
  // Roads are open ground, so they don't count as cover.
  const area = b.pieces.filter(p => p.kind !== 'road').reduce((sum, p) => sum + (p.path ? polygonArea(bandOutline(p.path)) : p.shape === 'circle' ? (Math.PI * p.w * p.h) / 4 : p.w * p.h), 0);
  return area / (b.w * b.h);
}

function polygonArea(poly: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(a) / 2;
}
