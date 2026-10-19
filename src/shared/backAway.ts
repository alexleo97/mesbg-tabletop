// After a duel the losers back away 1" from the winners. The app does it for the players: each loser steps
// straight away from the enemies it fought, or as close to that as it can get, never onto another model. Friends may
// make way for it; a loser with nowhere to go is trapped, unless it can go over the edge of a drop.
import { shutTo } from './fortress.ts';
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

/** Whether two bases overlap by more than a hair; just touching is fine. */
function overlaps(a: Model, b: Model): boolean {
  if (a.base.shape === 'round' && b.base.shape === 'round') return gap(a, b) < -0.02;
  // Other shapes: shrink one base by a millimetre all round and see whether it still meets the other.
  return distanceBetween({ ...a, base: { ...a.base, w: a.base.w - 1, h: a.base.h - 1 } }, b) < 0.001;
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
    else if (t.kind === 'wall' && !t.gone && heightOf(t) > tall / 2 && crosses(outline(t), m, at)) return no;
    // Nor back through a gate shut to it.
    else if (shutTo(t, m.owner) && crosses(outline(t), m, at)) return no;
  }
  if (!m.floor) {
    const rise = climbedLevel(state, at) - climbedLevel(state, m);
    if (rise > tall / 2 + 1e-6) return no;
    if (-rise > tall + 1e-6) return { ok: true, drop: -rise };
  }
  for (const o of Object.values(models)) {
    if (o.id === m.id || o.dead || o.escaped || o.waiting) continue;
    if (Math.abs(o.x - at.x) > 6 || Math.abs(o.y - at.y) > 6) continue;
    // It can't stay in touch with an enemy, and can't end up on top of any other model.
    if (o.owner !== m.owner ? gap(here, o) < 0.05 : overlaps(here, o)) return no;
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

/** The least a friend can move (in quarter inches, up to `reach`) to get out of `spot`, and where it goes; null if it can't. */
function nudge(state: GameState, models: Record<string, Model>, f: Model, spot: Model, reach: number): Point | null {
  for (let d = 0.25; d <= reach + 1e-6; d += 0.25)
    for (let k = 0; k < 16; k++) {
      const p = at(f, (k * Math.PI) / 8, d);
      if (overlaps({ ...f, ...p }, spot)) continue;
      const s = step(state, models, f, p);
      if (s.ok && !s.drop) return p;
    }
  return null;
}

/**
 * Making way: a loser hemmed in only by friends has every friend in its way that is free to move step aside, each the
 * least it can (up to `reach`), so it can back away `dist`. Straight back is tried first, then further round. Null if
 * no way works, for instance when a friend in the way is fighting too.
 */
function makeRoom(state: GameState, models: Record<string, Model>, m: Model, heading: number, dist: number, reach: number, losers: string[]): { to: Point; moves: { f: Model; p: Point }[] } | null {
  for (const turn of TURNS) {
    const to = at(m, heading + (turn * Math.PI) / 180, dist);
    const here = { ...m, ...to };
    const inWay = Object.values(models).filter(f => f.owner === m.owner && f.id !== m.id && !f.dead && !f.escaped && !f.waiting && overlaps(here, f));
    if (!inWay.length || inWay.some(f => losers.includes(f.id) || !canMakeWay(state, f))) continue;
    const without = Object.fromEntries(Object.entries(models).filter(([k]) => !inWay.some(f => f.id === k)));
    const s = step(state, without, m, to);
    if (!s.ok || s.drop) continue;
    let room: Record<string, Model> = { ...without, [m.id]: here };
    const moves: { f: Model; p: Point }[] = [];
    for (const f of inWay) {
      const p = nudge(state, room, f, here, reach);
      if (!p) break;
      room = { ...room, [f.id]: { ...f, ...p } };
      moves.push({ f, p });
    }
    if (moves.length === inWay.length) return { to, moves };
  }
  return null;
}

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
 * hemmed in by friends has them make way, each moving the least it can up to 1"; one with nowhere else to go but over the edge of a drop goes over it; the rest are trapped.
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
      // Friends in the way step aside to let it through.
      const room = makeRoom(state, models, m, heading, BACK_AWAY, BACK_AWAY, losers);
      for (const { f, p } of room?.moves ?? []) {
        models[f.id] = { ...f, ...p };
        out.moves.push({ id: f.id, ...rounded(p) });
        out.madeWay.push({ id: f.id, for: m.id });
      }
      if (room) to = room.to;
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
 * A monster's Barge: each model backs away `dist` (3") rather than 1", straight back if it can and otherwise the
 * way that lets it go furthest, with friends making way where that lets it go the whole way. One that can't go the whole way goes as far as it can and is knocked Prone.
 */
export function pushBack(state: GameState, losers: string[], winners: string[], dist: number): { moves: { id: string; x: number; y: number }[]; short: string[] } {
  const models = { ...state.models };
  const out = { moves: [] as { id: string; x: number; y: number }[], short: [] as string[] };
  const foes = winners.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  for (const id of losers) {
    const m = models[id];
    if (!m || m.dead || m.escaped) continue;
    const heading = headingAway(m, foes);
    let best: { p: Point; d: number } | null = null;
    for (let d = dist; d > 0.2 && !best; d -= 0.25)
      for (const turn of TURNS) {
        const p = at(m, heading + (turn * Math.PI) / 180, d);
        const s = step(state, models, m, p);
        if (s.ok && !s.drop) {
          best = { p, d };
          break;
        }
      }
    // Friends may make way for it to go the whole distance, moving only as far as they need to.
    if (!best || best.d < dist - 1e-6) {
      const room = makeRoom(state, models, m, heading, dist, dist, losers);
      for (const { f, p } of room?.moves ?? []) {
        models[f.id] = { ...f, ...p };
        out.moves.push({ id: f.id, ...rounded(p) });
      }
      if (room) best = { p: room.to, d: dist };
    }
    if (!best || best.d < dist - 1e-6) out.short.push(id);
    if (!best) continue;
    models[id] = { ...m, ...best.p };
    out.moves.push({ id, ...rounded(best.p) });
  }
  return out;
}
