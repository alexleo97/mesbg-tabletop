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
 * building is a cottage and a 12"×8" field is a small paddock. Every board has a reason for its
 * terrain to be where it is (a road to a bridge, houses along a street, fields round a farm) and
 * follows the usual tournament guidance: a quarter to a third of the table covered, something
 * in the middle that blocks sight or funnels the armies, clear lanes, and matching terrain in front
 * of both deployment zones. Player 1 deploys from the bottom edge, player 2 from the top; rivers and
 * roads through the middle are laid out symmetrically about the centre, so they're listed once.
 */
export const STARTER_BOARDS: StarterBoard[] = [
  {
    id: 'river-crossing',
    name: 'River Crossing',
    blurb: 'A river cuts the field in two. The road meets it at an old bridge, the only quick way across.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        rect('ruin', 31.5, 31, 5, 4, 15),
        circle('wood', 9, 32, 11, 6.5, -8),
        rect('field', 38, 34.5, 9, 7),
        rect('field', 45, 34.5, 5, 7),
        rect('building', 29.5, 38.5, 5, 3.5, -4),
        circle('rock', 15.5, 39, 3.2, 2.4, 30),
        circle('wood', 18, 31.5, 5, 4, 10),
      ],
      [
        road([[21, 51], [22.5, 40], [25, 32], [24, 24], [23, 16], [25.5, 8], [27, -3]]),
        river([[-3, 19], [8, 22.5], [16, 21.5], [24, 24], [32, 26.5], [40, 25.5], [51, 29]], 4.2),
        bridge(24, 24, 84),
      ],
    ),
  },
  {
    id: 'ruined-city',
    name: 'Ruined Town',
    blurb: 'A burned-out market town: houses along two crossing streets, walled yards behind them and a square in the middle.',
    mat: 'grass',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        // Houses fronting the main street, gardens and walls behind.
        rect('building', 4.5, 28.5, 6, 4),
        rect('ruin', 11.5, 28.8, 6, 4.5),
        rect('building', 18.5, 28.5, 5, 4),
        rect('ruin', 31, 28.8, 6, 4.5),
        rect('building', 38, 28.5, 6, 4),
        rect('ruin', 44.8, 28.8, 5.5, 4.5),
        rect('wall', 8, 35.5, 11, 0.5),
        rect('wall', 2.75, 33.3, 0.5, 4.5),
        rect('wall', 41, 35.5, 9, 0.5),
        // Along the side street towards the edge: a ruined chapel and a cottage.
        rect('ruin', 30.5, 39.5, 6, 8),
        rect('building', 18.5, 40, 5, 4),
        rect('wall', 18.5, 44.5, 7, 0.5),
        circle('rock', 9, 39.5, 2.2, 1.6, 20),
        circle('rock', 40, 40, 2.5, 1.8, 20),
      ],
      [
        road([[-3, 23], [12, 24.4], [24, 24], [36, 23.6], [51, 25]], 3.2),
        road([[25, 51], [24.5, 36], [24, 24], [23.5, 12], [23, -3]], 2.8),
        // The market square's broken well.
        circle('rock', 24, 24, 1.6, 1.6),
      ],
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
        circle('wood', 31, 38, 6, 4.5, -15),
        rect('building', 37, 40.5, 4.5, 3.5, -10),
        rect('field', 41, 29.5, 8, 6, -10),
        circle('hill', 17, 30.5, 9, 6, 20),
        circle('rock', 27, 37, 3, 2.2),
        bridge(16.5, 18.5, 136, 6),
      ],
      [river([[-3, 6], [7, 10], [13, 15.5], [19, 21], [24, 24], [29, 27], [35, 32.5], [41, 38], [51, 42]], 2.6)],
    ),
  },
  {
    id: 'mountain-pass',
    name: 'Mountain Pass',
    blurb: 'A road climbs through a snowbound pass between two ridges, past a ruined watchtower.',
    mat: 'snow',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        // The western ridge: a chain of crags along the road, not loose boulders.
        circle('cliff', 3, 27, 6, 9, 15),
        circle('cliff', 7, 32.5, 7, 6, -20),
        circle('cliff', 11.5, 36.5, 6, 5, -30),
        circle('cliff', 4, 37, 6, 7),
        // A spur of the eastern ridge narrowing the pass.
        circle('cliff', 45, 30, 6, 9, 10),
        circle('cliff', 40.5, 34.5, 8, 5.5, 25),
        circle('cliff', 35, 37, 5, 4, 35),
        rect('ruin', 17, 31, 5, 5, 20),
        circle('wood', 31, 30, 6, 4.5, -10),
        circle('rock', 26.5, 37.5, 2.8, 2.2, 15),
        circle('rock', 13.5, 27, 3, 2.4),
      ],
      [road([[17, 51], [20, 41], [26, 31], [24, 24], [22, 17], [28, 7], [31, -3]], 3)],
    ),
  },
  {
    id: 'farmstead',
    name: 'Farmstead',
    blurb: 'A farm lane runs between hedged fields, a farmhouse and barn round a yard, and an orchard.',
    mat: 'plains',
    w: 48,
    h: 48,
    pieces: balanced(
      [
        // A patchwork of fields sharing hedges, south of the lane.
        rect('field', 7, 32, 12, 7),
        rect('field', 19, 32, 12, 7),
        circle('wood', 13, 39.5, 7, 4.5),
        // The farm: house, barn and a walled yard opening onto the lane.
        rect('building', 32, 30.5, 7, 4),
        rect('building', 38.5, 33.5, 4, 7),
        rect('wall', 32, 37.25, 9, 0.5),
        circle('wood', 44, 34, 6, 6),
        circle('water', 29, 41, 5, 3.5, 15),
      ],
      [road([[-3, 21], [14, 24], [24, 24], [34, 24], [51, 27]], 2.6)],
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
  // Roads are open ground, so they don't count as cover.
  const area = b.pieces.filter(p => p.kind !== 'road').reduce((sum, p) => sum + (p.path ? polygonArea(bandOutline(p.path)) : p.shape === 'circle' ? (Math.PI * p.w * p.h) / 4 : p.w * p.h), 0);
  return area / (b.w * b.h);
}

function polygonArea(poly: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(a) / 2;
}
