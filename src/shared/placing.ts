import { limitMove } from './movement.ts';
import { along, angleOf, radius, rimPiece } from './narrative.ts';
import { joinSpot } from './sam.ts';
import { nestFits } from './elves.ts';
import type { Point } from './geometry.ts';
import type { GameState, Model, Placing, Seat } from './types.ts';

// Models a player puts down where they choose, within the scenario's limits, before play goes on: Aragorn arriving
// at Weathertop (anywhere touching the ruin's edge), a Spider back from its nest, or a Ringwraith driven off by a flaming brand (its full D6", any
// way that takes it away from the brand). The game puts each one somewhere sensible first, so the player only drags
// it if they want it elsewhere, then says they're done.

/** The model waiting to be placed now, if any. */
export const placingNow = (state: GameState): Placing | undefined => state.flow.placing?.[0];

/** Whether `seat` is to place a model before anything else happens. */
export const placingFor = (state: GameState, seat: Seat) => placingNow(state)?.seat === seat;

/** Where a model being placed ends up when its player drags it towards `asked`, or null if it can't go there. */
export function placeSpot(state: GameState, p: Placing, m: Model, asked: Point): Point | null {
  if (p.kind === 'join') return joinSpot(state, p, m, asked);
  // A Spider back from its nest (The Elves of Mirkwood): anywhere 10" from every Good model.
  if (p.kind === 'nest') return nestFits(state, m, asked) ? asked : null;
  if (p.kind === 'arrive') {
    const t = p.rim ? rimPiece(state, p.rim) : undefined;
    if (!t) return null;
    const spot = along(t, angleOf(t, asked), t.w / 2 + radius(m) + 0.02);
    const r = radius(m);
    if (spot.x < r || spot.y < r || spot.x > state.board.w - r || spot.y > state.board.h - r) return null;
    const clear = Object.values(state.models).every(o => o.id === m.id || o.dead || o.waiting || o.escaped || Math.hypot(o.x - spot.x, o.y - spot.y) >= radius(o) + r - 0.01);
    return clear ? spot : null;
  }
  // A retreat goes its full distance, in any direction that doesn't bring it closer to what it flees.
  const from = { x: p.from[0], y: p.from[1] };
  const dist = p.dist ?? 0;
  const len = Math.hypot(asked.x - from.x, asked.y - from.y);
  if (len < 0.05 || dist <= 0) return null;
  let u = { x: (asked.x - from.x) / len, y: (asked.y - from.y) / len };
  const foes = (p.away ?? []).map(id => state.models[id]).filter(o => o && !o.dead);
  const near = foes.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  if (near) {
    const gap = Math.hypot(from.x - near.x, from.y - near.y) || 1;
    const w = { x: (from.x - near.x) / gap, y: (from.y - near.y) / gap };
    const dot = u.x * w.x + u.y * w.y;
    if (dot < 0) {
      // Towards the brand: slide it round to the nearest way that isn't.
      const side = { x: u.x - dot * w.x, y: u.y - dot * w.y };
      const s = Math.hypot(side.x, side.y);
      u = s > 1e-3 ? { x: side.x / s, y: side.y / s } : w;
    }
  }
  const to = { x: from.x + u.x * dist, y: from.y + u.y * dist };
  return limitMove(state, from, to, dist, m.owner, m, new Set([m.id]));
}
