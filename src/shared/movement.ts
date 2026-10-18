import { distanceBetween, halfExtents, mmToIn, type Point } from './geometry.ts';
import { heightOfModel, moveCost, sightTo } from './sight.ts';
import { overWallSpot, secondAttacker, touching, wallBetween } from './barriers.ts';
import { combatFromKey, CONTACT_SLACK, type Combat } from './flow.ts';
import { canActivate, phaseHeroics } from './heroics.ts';
import { cannotAct } from './powers.ts';
import { crossingAhead } from './terrainTests.ts';
import type { GameState, Model, Seat } from './types.ts';

/**
 * How far a model may go this phase, from where it began the phase, once the battle is under way: its Move in the
 * Move phase, 1" in the Fight phase (to back away or make way for a friend), and not at all in the other phases,
 * where it can only turn on the spot. In the Move phase that waits for its side's turn to move (see canActivate).
 * Null before the battle starts, when models can be set up anywhere.
 */
export function moveAllowance(state: GameState, m: Model): number | null {
  if (!state.flow.started || m.dead) return null;
  if (state.phase === 'move') {
    // A model held by a power or a Compel stays put; one getting up from Prone has half its Move left.
    if (!canActivate(state, m.owner) || state.flow.courage?.[m.id] === false || cannotAct(state, m) || state.flow.held?.includes(m.id)) return 0;
    // A model already in a fight when its turn to move comes can't move (one that has just charged may still adjust).
    if (!state.flow.starts?.[m.id] && engaged(state, m)) return 0;
    // A model whose move has ended (a failed test, or a test passed on 2-5) goes no further; a Prone one crawls 1".
    if (state.flow.stopped?.includes(m.id)) return 0;
    if (m.prone && (state.flow.crawling?.includes(m.id) || state.flow.lay?.includes(m.id))) return 1;
    // Climbing between floors of a building spends Move too.
    const climbed = state.flow.climbed?.[m.id] ?? 0;
    return Math.max(0, (m.prone || state.flow.stood?.includes(m.id) ? m.move / 2 : m.move) + marchBonus(state, m) - climbed);
  }
  if (state.phase === 'fight') return heroicCombatWon(state, m) ? m.move : 1;
  return 0;
}

/** Whether a model is in base contact with an enemy: Engaged in Combat. */
export function engaged(state: GameState, m: Model, except?: string): boolean {
  return Object.values(state.models).some(e => e.owner !== m.owner && e.id !== except && !e.dead && !e.waiting && !e.escaped && Math.abs(e.x - m.x) < 5 && Math.abs(e.y - m.y) < 5 && touching(state, m, e));
}

/**
 * The extra Move from a Heroic March this phase: 3" (5" on a horse) for the hero who called it and for friends that
 * began the phase within 6" of it. Marching models can't charge.
 */
export function marchBonus(state: GameState, m: Model): number {
  if (state.phase !== 'move') return 0;
  const start = moveStart(state, m);
  const marched = phaseHeroics(state).some(h => {
    const hero = h.action === 'Heroic March' ? state.models[h.model] : undefined;
    return hero && hero.owner === m.owner && (hero.id === m.id || Math.hypot(moveStart(state, hero).x - start.x, moveStart(state, hero).y - start.y) <= 6 + (mmToIn(hero.base.w) + mmToIn(m.base.w)) / 2);
  });
  return marched ? (m.base.h > m.base.w ? 5 : 3) : 0;
}

/** Whether two models' bases overlap (rather than just touch). */
export function basesOverlap(a: Model, b: Model): boolean {
  const shrink = (m: Model): Model => ({ ...m, base: { ...m.base, w: Math.max(1, m.base.w - 1.5), h: Math.max(1, m.base.h - 1.5) } });
  if (Math.abs(a.x - b.x) > 4 || Math.abs(a.y - b.y) > 4) return false;
  return distanceBetween(shrink(a), shrink(b)) === 0;
}

/**
 * Where a move from `from` to `to` has to stop, walking the straight line between them:
 * - short of any other model's base (models can't pass through each other, so a gap must be wide enough), and of
 *   an objective marker at the end of the move;
 * - outside every enemy's control zone (1"), unless charging. A model charges the enemy it ends up next to, which it
 *   must have been able to see when it set off; once inside that enemy's zone it ignores the others. An enemy in a
 *   fight or lying Prone has no zone, and a model that starts inside a zone may move off without getting closer.
 * `skip` lists models moving alongside this one, which don't block it.
 */
export function blockMove(state: GameState, m: Model, from: Point, to: Point, skip?: ReadonlySet<string>, charge = true): Point {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-6) return to;
  // Terrain that needs a Jump, Climb or Leap test stops the model at it, to take the test (see terrainTests.ts).
  const ahead = state.flow.started && state.phase === 'move' ? crossingAhead(state, m, from, to) : null;
  if (ahead) to = ahead.stop;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 1e-6) return to;
  const at = (p: Point): Model => ({ ...m, x: p.x, y: p.y });
  const near = (e: Model) => e.x > Math.min(from.x, to.x) - 5 && e.x < Math.max(from.x, to.x) + 5 && e.y > Math.min(from.y, to.y) - 5 && e.y < Math.max(from.y, to.y) + 5;
  const others = Object.values(state.models).filter(e => e.id !== m.id && !e.dead && !e.waiting && !e.escaped && !skip?.has(e.id) && near(e));
  const zonesApply = state.phase === 'move' || heroicCombatWon(state, m);
  const enemies = zonesApply ? others.filter(e => e.owner !== m.owner) : [];
  const zoned = enemies.filter(e => !e.prone && !engaged(state, e, m.id));
  const start = at(from);
  const startD = new Map(zoned.map(e => [e.id, distanceBetween(start, e)]));
  // The enemy being charged: the nearest one the move ends within 1" of, if this model may charge and could see it.
  const end = at(to);
  const target = charge && !marchBonus(state, m) ? enemies.filter(e => distanceBetween(end, e) < 1).sort((a, b) => distanceBetween(end, a) - distanceBetween(end, b))[0] : undefined;
  const sees = target && sightTo(state, start, target) !== 'hidden' ? target : undefined;
  const markers = Object.values(state.terrain).filter(t => t.kind === 'objective' && !t.carrier && !t.gone);
  const onMarker = (p: Point) => markers.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.w / 2 + mmToIn(m.base.w) / 2 - 0.05);
  const steps = Math.ceil(d / 0.05);
  let last = from;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const p = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    const here = at(p);
    if (others.some(e => basesOverlap(here, e))) break;
    if (!(sees && distanceBetween(here, sees) < 1)) {
      if (zoned.some(e => {
        const de = distanceBetween(here, e);
        return de < 1 - 1e-3 && de < startD.get(e.id)! - 1e-3;
      }))
        break;
    }
    last = p;
  }
  // Nor may it end its move on top of an objective marker.
  if (markers.length && onMarker(last)) {
    for (let i = steps; i >= 0; i--) {
      const f = i / steps;
      const p = { x: from.x + (last.x - from.x) * f, y: from.y + (last.y - from.y) * f };
      if (!onMarker(p)) return p;
    }
    return from;
  }
  return last;
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

/**
 * Whether a fight has been fought this turn. Once one is, a model slain in it changes which models touch, so the
 * survivors make up a "new" fight; it's still done if everyone on one side has already fought this turn (unless
 * a Heroic Combat freed them to fight again).
 */
export function fightDone(state: GameState, c: Combat): boolean {
  if (state.flow.resolved.includes(c.key)) return true;
  const fought = foughtThisTurn(state);
  return [c.p1, c.p2].some(side => side.length > 0 && side.every(id => fought.has(id)));
}

/** Models that have fought this turn and may not fight again (a Heroic Combat won lets its side fight again). */
export function foughtThisTurn(state: GameState): Set<string> {
  const ids = state.flow.resolved.flatMap(k => k.split(',')).filter(id => state.models[id] && !heroicCombatWon(state, state.models[id]));
  return new Set(ids);
}

/** Whether a model's moves are held to an allowance this phase (see moveAllowance). */
export const movesLimited = (state: GameState, m: Model) => moveAllowance(state, m) !== null;

/** Models that have gone more than half their Move this Move phase (difficult terrain counting double), which can't shoot this turn. */
export function movedTooFar(state: GameState): string[] {
  return Object.entries(state.flow.starts ?? {})
    .filter(([id, [x, y]]) => {
      const m = state.models[id];
      return m && !m.dead && costOf(state, m, { x, y }, m) + (state.flow.climbed?.[id] ?? 0) > m.move / 2 + 0.05;
    })
    .map(([id]) => id)
    .concat(Object.entries(state.flow.climbed ?? {}).filter(([id, c]) => !state.flow.starts?.[id] && state.models[id] && c > state.models[id].move / 2 + 0.05).map(([id]) => id));
}

/** What a model's move from a to b costs: difficult ground under any of its base counts double, and so does climbing. */
export const costOf = (state: GameState, m: Model, a: Point, b: Point) => moveCost(state, a, b, m.owner, Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry), heightOfModel(m)).cost;

/** Models that moved at all this Move phase, even a little or only between floors, so shoot 1 worse. */
export function movedAtAll(state: GameState): string[] {
  const walked = Object.entries(state.flow.starts ?? {}).filter(([id, [x, y]]) => state.models[id] && costOf(state, state.models[id], { x, y }, state.models[id]) > 0.05);
  const climbed = Object.entries(state.flow.climbed ?? {}).filter(([, c]) => c > 0);
  return [...new Set([...walked, ...climbed].map(([id]) => id))];
}

/** How much of its Move a model still has this phase, after the ground it's walked and any floors it's climbed. */
export function moveLeft(state: GameState, m: Model): number | null {
  const allowance = moveAllowance(state, m);
  return allowance === null ? null : Math.max(0, allowance - costOf(state, m, moveStart(state, m), m));
}

/** Where a model stood when this Move phase began (where it is now, if it hasn't moved yet). */
export function moveStart(state: GameState, m: Model): Point {
  const s = state.flow.starts?.[m.id];
  return s ? { x: s[0], y: s[1] } : { x: m.x, y: m.y };
}

/**
 * The furthest a model can get towards `to` from where it started this phase, spending at most `move` inches
 * (difficult terrain counts double). Returns `to` itself when it's in reach.
 */
export function limitMove(state: GameState, from: Point, to: Point, move: number, seat?: Seat, m?: Model, skip?: ReadonlySet<string>): Point {
  // Terrain that needs a test stops the model at it first, whatever its Move would allow beyond.
  const ahead = m && state.flow.started && state.phase === 'move' ? crossingAhead(state, m, from, to) : null;
  if (ahead) to = ahead.stop;
  const reached = reachable(state, from, to, move, seat, m);
  return m ? blockMove(state, m, from, reached, skip) : reached;
}

function reachable(state: GameState, from: Point, to: Point, move: number, seat?: Seat, m?: Model): Point {
  const cost = (p: Point) => (m ? costOf(state, m, from, p) : moveCost(state, from, p, seat).cost);
  if (cost(to) <= move + 1e-6) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (cost(p) <= move) lo = t;
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
    // A Prone enemy has no Control Zone.
    if (e.owner === m.owner || e.dead || e.prone) continue;
    const d = distanceBetween(here, e);
    if (d < 1 && (!best || d < best.d)) best = { e, d };
  }
  if (!best || best.d < 0.02) return at;
  // Only an enemy it could see when it set off can be charged; nor can a marching model charge.
  if (marchBonus(state, m) || sightTo(state, { ...m, ...moveStart(state, m) }, best.e) === 'hidden') return at;
  // Across a wall it goes up to the wall, as close to the enemy as it can get (unless it's touching the wall already).
  if (wallBetween(state, here, best.e)) return at;
  const over = overWallSpot(state, m, best.e, at);
  if (over) {
    const reach = limitMove(state, moveStart(state, m), over, moveAllowance(state, m) ?? m.move, m.owner, m);
    return Math.hypot(reach.x - over.x, reach.y - over.y) < 1e-3 ? over : at;
  }
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
  const reach = limitMove(state, moveStart(state, m), contact, moveAllowance(state, m) ?? m.move, m.owner, m);
  return Math.hypot(reach.x - contact.x, reach.y - contact.y) < 1e-3 ? contact : at;
}

/**
 * A move that stops inside an enemy's control zone is a charge: it goes on into base contact if it can, and if it
 * can't it has to stay out of the zone.
 */
export function finishCharge(state: GameState, m: Model, from: Point, to: Point, skip?: ReadonlySet<string>): Point {
  const settled = oneOverTheWall(state, m, from, settleMove(state, m, to));
  if (settled !== to) return settled;
  const here = { ...m, ...to };
  const before = { ...m, ...from };
  const short = Object.values(state.models).some(e => {
    if (e.owner === m.owner || e.dead || e.waiting || e.escaped || e.prone || engaged(state, e, m.id)) return false;
    const d = distanceBetween(here, e);
    return d > CONTACT_SLACK && d < 1 - 1e-3 && d < distanceBetween(before, e) - 1e-3 && !touching(state, here, e);
  });
  return short ? blockMove(state, m, from, to, skip, false) : to;
}

/**
 * Only one model may charge a defender over a wall or up to a ledge: a second one is held back along its way, just
 * out of reach. Returns where it ends up.
 */
function oneOverTheWall(state: GameState, m: Model, from: Point, to: Point): Point {
  if (!secondAttacker(state, m, to)) return to;
  for (let i = 1; i <= 40; i++) {
    const f = 1 - i / 40;
    const p = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    if (!secondAttacker(state, m, p)) return p;
  }
  return from;
}
