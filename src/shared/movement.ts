import { distanceBetween, type Point } from './geometry.ts';
import { moveCost } from './sight.ts';
import { combatFromKey } from './flow.ts';
import { canActivate, phaseHeroics } from './heroics.ts';
import type { GameState, Model } from './types.ts';

/**
 * How far a model may go this phase, from where it began the phase, once the battle is under way: its Move in the
 * Move phase, 1" in the Fight phase (to back away or make way for a friend), and not at all in the other phases,
 * where it can only turn on the spot. In the Move phase that waits for its side's turn to move (see canActivate).
 * Null before the battle starts, when models can be set up anywhere.
 */
export function moveAllowance(state: GameState, m: Model): number | null {
  if (!state.flow.started || m.dead) return null;
  if (state.phase === 'move') return canActivate(state, m.owner) && state.flow.courage?.[m.id] !== false ? m.move : 0;
  if (state.phase === 'fight') return heroicCombatWon(state, m) ? m.move : 1;
  return 0;
}

/**
 * Whether a model is free to move again in the Fight phase: its side's hero called a Heroic Combat, and the fight
 * they were both in is over with every enemy in it slain. The model can then move (and charge) as in the Move phase.
 */
export function heroicCombatWon(state: GameState, m: Model): boolean {
  if (state.phase !== 'fight' || m.dead) return false;
  const heroes = phaseHeroics(state).filter(h => h.action === 'Heroic Combat' && state.models[h.model]?.owner === m.owner).map(h => h.model);
  if (!heroes.length) return false;
  return state.flow.resolved.some(key => {
    const c = combatFromKey(state, key);
    if (!c) return false;
    const ours = m.owner === 'p1' ? c.p1 : c.p2;
    const theirs = m.owner === 'p1' ? c.p2 : c.p1;
    return ours.includes(m.id) && ours.some(id => heroes.includes(id)) && theirs.every(id => state.models[id].dead);
  });
}

/** Whether a model's moves are held to an allowance this phase (see moveAllowance). */
export const movesLimited = (state: GameState, m: Model) => moveAllowance(state, m) !== null;

/** Where a model stood when this Move phase began (where it is now, if it hasn't moved yet). */
export function moveStart(state: GameState, m: Model): Point {
  const s = state.flow.starts?.[m.id];
  return s ? { x: s[0], y: s[1] } : { x: m.x, y: m.y };
}

/**
 * The furthest a model can get towards `to` from where it started this phase, spending at most `move` inches
 * (difficult terrain counts double). Returns `to` itself when it's in reach.
 */
export function limitMove(state: GameState, from: Point, to: Point, move: number): Point {
  if (moveCost(state, from, to).cost <= move + 1e-6) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (moveCost(state, from, p).cost <= move) lo = t;
    else hi = t;
  }
  return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo };
}

/**
 * A model dropped inside an enemy's control zone (1") without touching it can only be charging, so it goes the
 * rest of the way into base contact, as long as its Move still reaches. Returns where it should end up.
 */
export function settleMove(state: GameState, m: Model, at: Point): Point {
  if (!movesLimited(state, m) || !(state.phase === 'move' || heroicCombatWon(state, m))) return at;
  const here = { ...m, ...at };
  let best: { e: Model; d: number } | null = null;
  for (const e of Object.values(state.models)) {
    if (e.owner === m.owner || e.dead) continue;
    const d = distanceBetween(here, e);
    if (d < 1 && (!best || d < best.d)) best = { e, d };
  }
  if (!best || best.d < 0.02) return at;
  // Step towards the enemy until the bases touch.
  const dx = best.e.x - at.x;
  const dy = best.e.y - at.y;
  const len = Math.hypot(dx, dy) || 1;
  let lo = 0;
  let hi = best.d + 2;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (distanceBetween({ ...m, x: at.x + (dx / len) * t, y: at.y + (dy / len) * t }, best.e) > 0.01) lo = t;
    else hi = t;
  }
  const contact = { x: at.x + (dx / len) * hi, y: at.y + (dy / len) * hi };
  const reach = limitMove(state, moveStart(state, m), contact, m.move);
  return Math.hypot(reach.x - contact.x, reach.y - contact.y) < 1e-3 ? contact : at;
}
