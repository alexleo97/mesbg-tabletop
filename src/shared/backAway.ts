// After a duel the losers back away 1" from the winners. The app does it for the players: each loser steps
// straight away from the enemies it fought, or as close to that as it can get, and a loser with nowhere to go is
// trapped.
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { insidePolygon, outline } from './sight.ts';
import type { GameState, Model } from './types.ts';

/** How far a loser backs away. */
export const BACK_AWAY = 1;

/** Terrain a model can't back into. */
const SOLID = new Set(['building', 'cliff']);

/** Gap between two bases, negative when they overlap (round bases); 0 when touching or overlapping otherwise. */
function gap(a: Model, b: Model): number {
  if (a.base.shape === 'round' && b.base.shape === 'round') return Math.hypot(a.x - b.x, a.y - b.y) - halfExtents(a.base).rx - halfExtents(b.base).rx;
  return distanceBetween(a, b);
}

/** Whether a model could stand here after backing away. */
function canStand(state: GameState, models: Record<string, Model>, m: Model, at: Point): boolean {
  const here = { ...m, ...at };
  const { rx, ry } = halfExtents(m.base);
  const r = Math.max(rx, ry);
  if (at.x - r < 0 || at.y - r < 0 || at.x + r > state.board.w || at.y + r > state.board.h) return false;
  for (const t of Object.values(state.terrain)) if (SOLID.has(t.kind) && insidePolygon(outline(t), at)) return false;
  for (const o of Object.values(models)) {
    if (o.id === m.id || o.dead || o.escaped) continue;
    if (Math.abs(o.x - at.x) > 6 || Math.abs(o.y - at.y) > 6) continue;
    const g = gap(here, o);
    // It can't stay in touch with an enemy, and can't end up on top of a friend.
    if (o.owner !== m.owner ? g < 0.05 : g < -0.02) return false;
  }
  return true;
}

/**
 * Where each loser of a fight backs away to. Losers are moved one at a time so they don't land on each other;
 * those that can't move at all are listed as trapped.
 */
export function backAway(state: GameState, losers: string[], winners: string[]): { moves: { id: string; x: number; y: number }[]; trapped: string[] } {
  const models = { ...state.models };
  const moves: { id: string; x: number; y: number }[] = [];
  const trapped: string[] = [];
  const foes = winners.map(id => state.models[id]).filter((m): m is Model => !!m && !m.dead);
  for (const id of losers) {
    const m = models[id];
    if (!m || m.dead || m.escaped) continue;
    // Away from the enemies it fought (the nearest ones count most), or back towards its own table edge.
    let dx = 0;
    let dy = 0;
    for (const f of foes) {
      const d = Math.hypot(m.x - f.x, m.y - f.y) || 1;
      const w = 1 / Math.max(0.1, distanceBetween(m, f) + 0.5);
      dx += ((m.x - f.x) / d) * w;
      dy += ((m.y - f.y) / d) * w;
    }
    if (Math.hypot(dx, dy) < 1e-6) dy = m.owner === 'p1' ? 1 : -1;
    const heading = Math.atan2(dy, dx);
    let to: Point | null = null;
    for (const turn of [0, 20, -20, 40, -40, 60, -60, 80, -80]) {
      const a = heading + (turn * Math.PI) / 180;
      const at = { x: m.x + Math.cos(a) * BACK_AWAY, y: m.y + Math.sin(a) * BACK_AWAY };
      // Still clear of every enemy once it's there.
      if (canStand(state, models, m, at)) {
        to = at;
        break;
      }
    }
    if (!to) {
      trapped.push(id);
      continue;
    }
    models[id] = { ...m, ...to };
    moves.push({ id, x: Math.round(to.x * 1000) / 1000, y: Math.round(to.y * 1000) / 1000 });
  }
  return { moves, trapped };
}
