// After a duel the losers back away 1" from the winners. The app does it for the players: each loser steps
// straight away from the enemies it fought, or as close to that as it can get, and its player may then pick another
// way. A friend may make way for it; a loser with nowhere to go is trapped, unless it can go over the edge of a drop.
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { engaged } from './movement.ts';
import { cannotAct } from './powers.ts';
import { climbedLevel, flooredAt, heightOf, heightOfModel, insidePolygon, outline } from './sight.ts';
import type { GameState, Model } from './types.ts';

/** How far a loser backs away. */
export const BACK_AWAY = 1;

/** Gap between two bases, negative when they overlap (round bases); 0 when touching or overlapping otherwise. */
function gap(a: Model, b: Model): number {
  if (a.base.shape === 'round' && b.base.shape === 'round') return Math.hypot(a.x - b.x, a.y - b.y) - halfExtents(a.base).rx - halfExtents(b.base).rx;
  return distanceBetween(a, b);
}

/** Whether the straight line between two points passes through a polygon. */
function crosses(poly: Point[], a: Point, b: Point): boolean {
  for (let i = 1; i <= 10; i++) if (insidePolygon(poly, { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 })) return true;
  return false;
}

/**
 * Whether a model can step from where it is to `at` in a back away or a make way move, and how far it would fall if
 * that takes it over a drop. It can't end touching an enemy, on top of a friend or an objective marker, off the
 * table, inside a building it isn't in, or get there by climbing or over a wall it would need a test for.
 */
function step(state: GameState, models: Record<string, Model>, m: Model, at: Point): { ok: boolean; drop: number } {
  const no = { ok: false, drop: 0 };
  const here = { ...m, ...at };
  const { rx, ry } = halfExtents(m.base);
  const r = Math.max(rx, ry);
  if (at.x - r < 0 || at.y - r < 0 || at.x + r > state.board.w || at.y + r > state.board.h) return no;
  const tall = heightOfModel(m);
  const inside = m.floor ? flooredAt(state, m) : undefined;
  for (const t of Object.values(state.terrain)) {
    if (Math.abs(t.x - at.x) > Math.max(t.w, t.h) / 2 + 3 || Math.abs(t.y - at.y) > Math.max(t.w, t.h) / 2 + 3) continue;
    if (t.kind === 'objective') {
      if (!t.carrier && !t.gone && Math.hypot(t.x - at.x, t.y - at.y) < t.w / 2 + r - 0.05) return no;
    } else if (t.kind === 'building' && t !== inside && insidePolygon(outline(t), at)) return no;
    else if (t.kind === 'wall' && heightOf(t) > tall / 2 && crosses(outline(t), m, at)) return no;
  }
  if (!m.floor) {
    const rise = climbedLevel(state, at) - climbedLevel(state, m);
    if (rise > tall / 2 + 1e-6) return no;
    if (-rise > tall + 1e-6) return { ok: true, drop: -rise };
  }
  for (const o of Object.values(models)) {
    if (o.id === m.id || o.dead || o.escaped || o.waiting) continue;
    if (Math.abs(o.x - at.x) > 6 || Math.abs(o.y - at.y) > 6) continue;
    const g = gap(here, o);
    // It can't stay in touch with an enemy, and can't end up on top of a friend.
    if (o.owner !== m.owner ? g < 0.05 : g < -0.02) return no;
  }
  return { ok: true, drop: 0 };
}

const TURNS = [0, 20, -20, 40, -40, 60, -60, 80, -80];
const at = (m: Point, a: number, d = BACK_AWAY): Point => ({ x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d });
const rounded = (p: Point) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

/** The way straight back from the enemies a model fought (the nearest count most), or towards its own table edge. */
function headingAway(m: Model, foes: Model[]): number {
  let dx = 0;
  let dy = 0;
  for (const f of foes) {
    const d = Math.hypot(m.x - f.x, m.y - f.y) || 1;
    const w = 1 / Math.max(0.1, distanceBetween(m, f) + 0.5);
    dx += ((m.x - f.x) / d) * w;
    dy += ((m.y - f.y) / d) * w;
  }
  if (Math.hypot(dx, dy) < 1e-6) dy = m.owner === 'p1' ? 1 : -1;
  return Math.atan2(dy, dx);
}

/** Where a model backs away to on solid ground, trying straight back first and then further round; null if nowhere. */
function findSpot(state: GameState, models: Record<string, Model>, m: Model, heading: number): Point | null {
  for (const turn of TURNS) {
    const p = at(m, heading + (turn * Math.PI) / 180);
    const s = step(state, models, m, p);
    if (s.ok && !s.drop) return p;
  }
  return null;
}

/** Whether a friend could make way: not in a fight, and free to move. */
const canMakeWay = (state: GameState, f: Model) => !f.dead && !f.escaped && !f.waiting && !engaged(state, f) && !cannotAct(state, f) && !state.flow.held?.includes(f.id);

export interface Retreat {
  moves: { id: string; x: number; y: number }[];
  trapped: string[];
  /** Friends that made way, by the loser they made way for. */
  madeWay: { id: string; for: string }[];
  /** Losers pushed back over the edge of a drop, and how far they fall (after the strikes). */
  falls: { id: string; drop: number }[];
}

/**
 * Where each loser of a fight backs away to. Losers are moved one at a time so they don't land on each other. One
 * hemmed in by a friend has that friend make way, moving up to 1" (only one friend may, and only if that's enough);
 * one with nowhere else to go but over the edge of a drop goes over it; the rest are trapped.
 */
export function backAway(state: GameState, losers: string[], winners: string[]): Retreat {
  const models = { ...state.models };
  const out: Retreat = { moves: [], trapped: [], madeWay: [], falls: [] };
  const foes = winners.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  for (const id of losers) {
    const m = models[id];
    if (!m || m.dead || m.escaped) continue;
    const heading = headingAway(m, foes);
    let to = findSpot(state, models, m, heading);
    if (!to) {
      // A friend steps aside, the least it can, to let it through.
      const friends = Object.values(models).filter(f => f.owner === m.owner && f.id !== m.id && !losers.includes(f.id) && Math.hypot(f.x - m.x, f.y - m.y) < 4 && canMakeWay(state, f));
      let best: { f: Model; p: Point; to: Point; d: number } | null = null;
      for (const f of friends) {
        for (let d = 0.25; d <= 1 + 1e-6 && !(best && best.d <= d); d += 0.25) {
          for (let k = 0; k < 16; k++) {
            const p = at(f, (k * Math.PI) / 8, d);
            const s = step(state, models, f, p);
            if (!s.ok || s.drop) continue;
            const spot = findSpot(state, { ...models, [f.id]: { ...f, ...p } }, m, heading);
            if (spot && (!best || d < best.d)) best = { f, p, to: spot, d };
          }
        }
      }
      if (best) {
        models[best.f.id] = { ...best.f, ...best.p };
        out.moves.push({ id: best.f.id, ...rounded(best.p) });
        out.madeWay.push({ id: best.f.id, for: m.id });
        to = best.to;
      }
    }
    if (!to) {
      // Pinned at the edge of a sheer drop: it goes over.
      for (const turn of TURNS) {
        const p = at(m, heading + (turn * Math.PI) / 180);
        const s = step(state, models, m, p);
        if (s.ok && s.drop) {
          to = p;
          out.falls.push({ id, drop: s.drop });
          break;
        }
      }
    }
    if (!to) {
      out.trapped.push(id);
      continue;
    }
    models[id] = { ...m, ...to };
    out.moves.push({ id, ...rounded(to) });
  }
  return out;
}

/**
 * After the strikes, the winners step slightly apart from a trapped loser that lived, so they're no longer touching:
 * each moves straight away from it, just far enough.
 */
export function separate(state: GameState, trapped: string[], winners: string[]): { id: string; x: number; y: number }[] {
  const models = { ...state.models };
  const moves: { id: string; x: number; y: number }[] = [];
  for (const t of trapped) {
    const m = models[t];
    if (!m || m.dead) continue;
    for (const w of winners) {
      const f = models[w];
      if (!f || f.dead || distanceBetween(m, f) > 0.25) continue;
      const a = Math.atan2(f.y - m.y, f.x - m.x);
      for (const turn of [0, 30, -30, 60, -60]) {
        const p = at(f, a + (turn * Math.PI) / 180, 0.3);
        if (distanceBetween({ ...f, ...p }, m) <= 0.2) continue;
        const others = Object.fromEntries(Object.entries(models).filter(([k]) => k !== t));
        if (!step(state, others, f, p).ok) continue;
        models[w] = { ...f, ...p };
        moves.push({ id: w, ...rounded(p) });
        break;
      }
    }
  }
  return moves;
}

/**
 * The ways a model that just backed away could have gone instead, for its player to pick: eight directions round
 * where it stood, each 1" away, and whether it can stand there.
 */
export function retreatSpots(state: GameState, id: string): { x: number; y: number; ok: boolean; dir: number }[] {
  const m = state.models[id];
  const from = state.flow.retreat?.[id];
  if (!m || m.dead || !from) return [];
  const was = { ...m, x: from[0], y: from[1] };
  const models = { ...state.models, [id]: was };
  return Array.from({ length: 8 }, (_, k) => {
    const p = at(was, (k * Math.PI) / 4);
    const s = step(state, models, was, p);
    return { ...rounded(p), ok: s.ok && !s.drop, dir: k * 45 };
  });
}

/** Whether a model that backed away may be put at `p` instead: 1" from where it stood, somewhere it could stand. */
export function canRetreatTo(state: GameState, id: string, p: Point): boolean {
  const m = state.models[id];
  const from = state.flow.retreat?.[id];
  if (!m || m.dead || !from) return false;
  if (Math.abs(Math.hypot(p.x - from[0], p.y - from[1]) - BACK_AWAY) > 0.05) return false;
  const was = { ...m, x: from[0], y: from[1] };
  const s = step(state, { ...state.models, [id]: was }, was, p);
  return s.ok && !s.drop;
}
