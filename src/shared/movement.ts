import { difficultTimes, mounted } from './cavalry.ts';
import { distanceBetween, halfExtents, MM_PER_INCH, mmToIn, type Point } from './geometry.ts';
import { flooredAt, heightOfModel, moveCost, sightTo } from './sight.ts';
import { overWallSpot, reaches, secondAttacker, touching, wallBetween } from './barriers.ts';
import { combatFromKey, CONTACT_SLACK, type Combat } from './flow.ts';
import { canActivate, phaseHeroics, shoutedFor, SHOUT_RANGE } from './heroics.ts';
import { cannotAct } from './powers.ts';
import { laden, overlapsPiece, shutGates } from './fortress.ts';
import { crossingAhead } from './terrainTests.ts';
import { invisibleTo, mayChargeAt } from './ring.ts';
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
    // A model held by a power or a Compel (or stunned by Sam's Frying Pan) stays put; one getting up from Prone has half its Move left.
    if (!canActivate(state, m.owner) || state.flow.courage?.[m.id] === false || cannotAct(state, m) || state.flow.held?.includes(m.id) || m.panned === state.turn || m.noMove === state.turn) return 0;
    // A model already in a fight when its turn to move comes can't move (one that has just charged may still adjust).
    if (!state.flow.starts?.[m.id] && engaged(state, m)) return 0;
    // A model whose move has ended (a failed test, or a test passed on 2-5) goes no further; a Prone one crawls 1".
    if (state.flow.stopped?.includes(m.id)) return 0;
    if (m.prone && (state.flow.crawling?.includes(m.id) || state.flow.lay?.includes(m.id))) return 1;
    // Climbing between floors of a building spends Move too.
    const climbed = state.flow.climbed?.[m.id] ?? 0;
    // So does carrying a Heavy Object alone.
    const halved = m.prone || state.flow.stood?.includes(m.id) || laden(state, m);
    return Math.max(0, (halved ? m.move / 2 : m.move) + marchBonus(state, m) - climbed);
  }
  if (state.phase === 'fight') return heroicCombatWon(state, m) ? m.move : (bargeMove(state, m) ?? 1);
  return 0;
}

/** Whether a model is in base contact with an enemy: Engaged in Combat. */
export function engaged(state: GameState, m: Model, except?: string): boolean {
  // A siege engine is never in a fight, and nobody fights one.
  if (m.siege) return false;
  return Object.values(state.models).some(e => e.owner !== m.owner && e.id !== except && !e.siege && !e.dead && !e.waiting && !e.escaped && Math.abs(e.x - m.x) < 5 && Math.abs(e.y - m.y) < 5 && touching(state, m, e));
}

/**
 * The extra Move from a Heroic March this phase: 3" (5" on a horse) for the hero who called it and for friends that
 * began the phase within 6" of it. Marching models can't charge.
 */
export function marchBonus(state: GameState, m: Model): number {
  if (state.phase !== 'move') return 0;
  return marchedBy(state, m) ? (mounted(m) || m.fly ? 5 : 3) : 0;
}

/** How far a Heroic March's At the Double reaches, and how close friends must finish: 12" for a war drum's. */
export const marchRange = (hero: Model) => (hero.drum && !hero.hero ? 12 : 6);
const armyOf = (m: Model) => m.profileId?.slice(0, m.profileId.indexOf(']') + 1) ?? '';

/**
 * The hero whose Heroic March this model moves with this phase: its own, or a friend's whose At the Double reached
 * it (within 6" of where the hero began the phase). A hero charged or held before it moves loses its March.
 */
export function marchedBy(state: GameState, m: Model): Model | undefined {
  if (state.phase !== 'move') return undefined;
  const start = moveStart(state, m);
  for (const h of phaseHeroics(state)) {
    const hero = h.action === 'Heroic March' ? state.models[h.model] : undefined;
    if (!hero || hero.owner !== m.owner || hero.dead) continue;
    // Nobody marches with an Invisible hero.
    if (hero.ringOn && hero.id !== m.id) continue;
    if (!state.flow.starts?.[hero.id] && (engaged(state, hero) || cannotAct(state, hero))) continue;
    // A war drum's March reaches 12", but only friends of the drummer's own army.
    if (hero.drum && !hero.hero && hero.id !== m.id && armyOf(hero) !== armyOf(m)) continue;
    if (hero.id === m.id || Math.hypot(moveStart(state, hero).x - start.x, moveStart(state, hero).y - start.y) <= marchRange(hero) + (mmToIn(hero.base.w) + mmToIn(m.base.w)) / 2) return hero;
  }
  return undefined;
}

/**
 * The hero a model must stay within 6" of as it moves: the one whose With Me it is going with (`heroic`, the hero
 * whose heroic move is under way), or whose At the Double it is marching to.
 */
export function followed(state: GameState, m: Model, heroic = state.flow.heroicNow): Model | undefined {
  const hero = heroic ? state.models[heroic] : undefined;
  if (hero && hero.id !== m.id && hero.owner === m.owner && shoutedFor(state, hero).some(f => f.id === m.id)) return hero;
  const march = marchedBy(state, m);
  return march && march.id !== m.id ? march : undefined;
}

/**
 * Where a move from `here` (where the model is now) towards `to` has to stop to end within 6" of `leader`: `to`, or
 * the last point along that way that is. A model already further off (its hero went on ahead) may still close in.
 */
export function keepNear(m: Model, here: Point, to: Point, leader: Model): Point {
  const gap = (p: Point) => distanceBetween({ ...m, ...p }, leader);
  const near = (p: Point) => gap(p) <= Math.max(SHOUT_RANGE, marchRange(leader)) + 1e-6;
  if (near(to) || gap(to) <= gap(here) + 1e-6) return to;
  for (let i = 1; i <= 50; i++) {
    const f = 1 - i / 50;
    const p = { x: here.x + (to.x - here.x) * f, y: here.y + (to.y - here.y) * f };
    if (near(p)) return p;
  }
  return here;
}

/**
 * Where a move on from `here` to `to` ends once the model keeps within 6" of the hero it goes with (unless that hero
 * is being moved with it), and a siege crew within 6" of its engine (where `models` has it now).
 */
export function leashed(state: GameState, m: Model, here: Point, to: Point, together: ReadonlySet<string>, heroic = state.flow.heroicNow, models = state.models): Point {
  const leader = state.phase === 'move' ? followed(state, m, heroic) : undefined;
  if (leader && !together.has(leader.id)) to = keepNear(m, here, to, leader);
  const home = m.crewOf ? models[m.crewOf] : undefined;
  if (home && !home.dead) to = keepNear(m, here, to, home);
  return to;
}

/** How far (in inches) two bases may run into each other and still count as touching rather than overlapping. */
export const OVERLAP_SLACK = 0.01;

/** Whether two models' bases overlap (rather than just touch), by more than `slack` inches. */
export function basesOverlap(a: Model, b: Model, slack = OVERLAP_SLACK): boolean {
  const reach = reachOf(a) + reachOf(b);
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) return false;
  if (a.base.shape === 'round' && b.base.shape === 'round') return Math.hypot(a.x - b.x, a.y - b.y) < reach - slack;
  // Other shapes: shrink each base by half the slack all round, and see whether what's left still meets.
  const shrink = (m: Model): Model => ({ ...m, base: { ...m.base, w: Math.max(1, m.base.w - slack * MM_PER_INCH), h: Math.max(1, m.base.h - slack * MM_PER_INCH) } });
  return distanceBetween(shrink(a), shrink(b)) === 0;
}

/** How far a model's base reaches from its centre at most. */
const reachOf = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

/**
 * Which level a model moving from where it stands would be on at `p`: the floor it is on while it stays in the same
 * building, and the ground once it leaves it.
 */
function levelOnTheWay(state: GameState, m: Model): (p: Point) => number {
  const inside = m.floor ? flooredAt(state, m) : undefined;
  return p => (inside && flooredAt(state, p) === inside ? m.floor! : 0);
}

/** Whether a model set down at `p` would overlap another model there (one on another floor of a building aside). */
export function crowded(state: GameState, m: Model, p: Point, skip?: ReadonlySet<string>): boolean {
  const level = levelOnTheWay(state, m)(p);
  const here = { ...m, x: p.x, y: p.y };
  return Object.values(state.models).some(e => e.id !== m.id && !e.dead && !e.waiting && !e.escaped && !e.aboard && !skip?.has(e.id) && (e.floor ?? 0) === level && basesOverlap(here, e));
}

/**
 * The moves of one drag in the order to make them: the models furthest along the way they're going first, so each
 * steps into room the one ahead of it has left, and none ends up on top of another.
 */
export function frontFirst<T extends { id: string; x: number; y: number }>(state: GameState, moves: T[]): T[] {
  if (!Array.isArray(moves) || moves.length < 2) return moves;
  let dx = 0;
  let dy = 0;
  for (const mv of moves) {
    const m = mv && state.models[mv.id];
    if (m && Number.isFinite(mv.x) && Number.isFinite(mv.y)) {
      dx += mv.x - m.x;
      dy += mv.y - m.y;
    }
  }
  const ahead = (mv: T) => {
    const m = mv && state.models[mv.id];
    return m ? m.x * dx + m.y * dy : -Infinity;
  };
  return [...moves].sort((a, b) => ahead(b) - ahead(a));
}

/**
 * Where a move from `from` to `to` has to stop, walking the straight line between them:
 * - short of any other model's base (models can't pass through each other, so a gap must be wide enough), and of
 *   an objective marker at the end of the move;
 * - short of a gate or door shut to it (one its own side holds it walks through);
 * - outside every enemy's control zone (1"), unless charging. A model charges the enemy it ends up next to, which it
 *   must have been able to see when it set off; once inside that enemy's zone it ignores the others. An enemy in a
 *   fight or lying Prone has no zone, and a model that starts inside a zone may move off without getting closer.
 *   A model up on a walkway or rooftop has no zone over one at its foot it couldn't fight, nor that one over it.
 * `skip` lists models moving alongside this one, which don't block it.
 */
/**
 * Whether a model may not end a move (nor back away or make way) overlapping an objective marker: only infantry and
 * cavalry are kept off them, so war beasts, chariots and siege engines may stop on one. (A monster on foot counts
 * as infantry, as in monsters.ts.)
 */
export const keptOffMarkers = (m: Model) => !m.beast && !m.siege;

/** Whether two models may move through each other: one is Invisible to the other (see ring.ts). */
export const passesThrough = (a: Model, b: Model) => invisibleTo(a, b) || invisibleTo(b, a);

export function blockMove(state: GameState, m: Model, from: Point, to: Point, skip?: ReadonlySet<string>, charge = true): Point {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-6) return to;
  // Terrain that needs a Jump, Climb or Leap test stops the model at it, to take the test (see terrainTests.ts).
  const ahead = state.flow.started && testsTerrain(state, m) ? crossingAhead(state, m, from, to) : null;
  if (ahead) to = ahead.stop;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 1e-6) return to;
  const at = (p: Point): Model => ({ ...m, x: p.x, y: p.y });
  const near = (e: Model) => {
    const reach = Math.max(5, reachOf(m) + reachOf(e) + 1.1);
    return e.x > Math.min(from.x, to.x) - reach && e.x < Math.max(from.x, to.x) + reach && e.y > Math.min(from.y, to.y) - reach && e.y < Math.max(from.y, to.y) + reach;
  };
  const all = Object.values(state.models).filter(e => e.id !== m.id && !e.dead && !e.waiting && !e.escaped && !e.aboard && !skip?.has(e.id) && near(e));
  // An Invisible model and those that can't see it pass through each other, though neither may stop on the other.
  const ghosts = all.filter(e => passesThrough(m, e));
  const others = all.filter(e => !ghosts.includes(e));
  const zonesApply = state.phase === 'move' || fightsAgain(state, m);
  const enemies = zonesApply ? others.filter(e => e.owner !== m.owner) : [];
  // (A siege engine has no control zone, nor has an Invisible model, and an Invisible model ignores those of foes
  // that can't see it.)
  const zoned = enemies.filter(e => !e.prone && !e.siege && !engaged(state, e, m.id) && !invisibleTo(m, e));
  const start = at(from);
  const startD = new Map(zoned.map(e => [e.id, distanceBetween(start, e)]));
  // The enemy being charged: the nearest one the move ends within 1" of, if this model may charge and could see it.
  const end = at(to);
  const target = charge && !marchBonus(state, m) ? enemies.filter(e => distanceBetween(end, e) < 1 && reaches(state, end, e)).sort((a, b) => distanceBetween(end, a) - distanceBetween(end, b))[0] : undefined;
  const sees = target && sightTo(state, start, target) !== 'hidden' ? target : undefined;
  const markers = keptOffMarkers(m) ? Object.values(state.terrain).filter(t => t.kind === 'objective' && !t.carrier && !t.gone) : [];
  const onMarker = (p: Point) => markers.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.w / 2 + mmToIn(m.base.w) / 2 - 0.05);
  // (A model already overlapping a gate, put there by hand, may step off it.)
  const gates = state.flow.started ? shutGates(state, m, from, to).filter(t => !overlapsPiece(m, t, from)) : [];
  // Models on another floor of a building (one inside it on the ground, one on its roof) pass over and under each other.
  const level = others.some(e => e.floor) || m.floor ? levelOnTheWay(state, m) : () => 0;
  // A model already overlapping another (set down there by hand) may move off it, but not further onto it.
  const overlapped = new Map(others.filter(e => basesOverlap(start, e)).map(e => [e.id, Math.hypot(e.x - from.x, e.y - from.y)]));
  const bumps = (p: Point) => {
    const here = at(p);
    return others.some(e => (e.floor ?? 0) === level(p) && basesOverlap(here, e) && !(overlapped.has(e.id) && Math.hypot(e.x - p.x, e.y - p.y) >= overlapped.get(e.id)! - 1e-6));
  };
  const stops = (p: Point) => {
    if (bumps(p) || gates.some(t => overlapsPiece(m, t, p))) return true;
    const here = at(p);
    if (sees && distanceBetween(here, sees) < 1) return false;
    // (One up on a wall's walkway holds nobody at its foot, nor they it: neither could fight the other there.)
    return zoned.some(e => {
      const de = distanceBetween(here, e);
      return de < 1 - 1e-3 && de < startD.get(e.id)! - 1e-3 && reaches(state, here, e);
    });
  };
  // It stops in base contact with a model it walks into, not on it (one it touches already holds it back only once
  // they'd overlap by more than a hair).
  const clearOf = others.filter(e => !basesOverlap(start, e, 0));
  const halts = (p: Point) => stops(p) || clearOf.some(e => (e.floor ?? 0) === level(p) && basesOverlap(at(p), e, 0));
  const steps = Math.ceil(d / 0.05);
  let last = from;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const p = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    if (halts(p)) {
      // Close the last small step exactly.
      let [ok, bad] = [last, p];
      for (let k = 0; k < 12; k++) {
        const mid = { x: (ok.x + bad.x) / 2, y: (ok.y + bad.y) / 2 };
        if (halts(mid)) bad = mid;
        else ok = mid;
      }
      last = ok;
      break;
    }
    last = p;
  }
  // Nor may it end its move on top of a model it passed through, nor touching an Invisible foe it hasn't passed the
  // test to charge, nor on an objective marker.
  const unseen = zonesApply ? ghosts.filter(e => e.owner !== m.owner && !mayChargeAt(state, m, e) && distanceBetween(start, e) > CONTACT_SLACK) : [];
  const onGhost = (p: Point) => ghosts.some(e => basesOverlap(at(p), e)) || unseen.some(e => distanceBetween(at(p), e) <= CONTACT_SLACK + 0.02);
  if (onGhost(last)) {
    const back = last;
    for (let i = steps; i >= 0; i--) {
      const f = i / steps;
      const p = { x: from.x + (back.x - from.x) * f, y: from.y + (back.y - from.y) * f };
      if (!onGhost(p)) {
        last = p;
        break;
      }
      if (i === 0) last = from;
    }
  }
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
 * How far a monster that barged its foes aside may move this Fight phase (and charge into a new fight), until it has
 * fought again; undefined for any other model.
 */
export function bargeMove(state: GameState, m: Model): number | undefined {
  const b = state.phase === 'fight' && !m.dead ? state.flow.barged?.[m.id] : undefined;
  if (!b || state.flow.resolved.slice(b[1]).some(k => k.split(',').includes(m.id))) return undefined;
  return b[0];
}

/** Whether a model may move and fight again this Fight phase: it won a Heroic Combat, or barged its foes aside. */
/** Whether a move now takes Jump, Climb and Leap tests: in the Move phase, and in a Heroic Combat's move (Rulebook FAQ). */
export const testsTerrain = (state: GameState, m: Model) => state.phase === 'move' || heroicCombatWon(state, m);
export const fightsAgain = (state: GameState, m: Model) => heroicCombatWon(state, m) || bargeMove(state, m) !== undefined;

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
    // Friends of an Invisible hero don't get to move on with it.
    return ours.includes(m.id) && ours.some(id => heroes.includes(id) && (id === m.id || !state.models[id].ringOn)) && theirs.every(id => state.models[id].dead);
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
  const ids = state.flow.resolved.flatMap(k => k.split(',')).filter(id => state.models[id] && !fightsAgain(state, state.models[id]));
  return new Set(ids);
}

/** Whether a model's moves are held to an allowance this phase (see moveAllowance). */
export const movesLimited = (state: GameState, m: Model) => moveAllowance(state, m) !== null;

/** Models that have gone more than half their Move this Move phase (difficult terrain counting double), which can't shoot this turn. */
export function movedTooFar(state: GameState): string[] {
  return Object.entries(state.flow.starts ?? {})
    .filter(([id, [x, y]]) => {
      const m = state.models[id];
      return m && !m.dead && (state.flow.walked?.[id] ?? costOf(state, m, { x, y }, m)) + (state.flow.climbed?.[id] ?? 0) > m.move / 2 + 0.05;
    })
    .map(([id]) => id)
    .concat(Object.entries(state.flow.climbed ?? {}).filter(([id, c]) => !state.flow.starts?.[id] && state.models[id] && c > state.models[id].move / 2 + 0.05).map(([id]) => id));
}

/** What a model's move from a to b costs: difficult ground under any of its base counts double (four times for cavalry), and climbing double. */
export const costOf = (state: GameState, m: Model, a: Point, b: Point) => moveCost(state, a, b, m.owner, Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry), heightOfModel(m), m.ground, difficultTimes(m)).cost;

/** Models that moved at all this Move phase, even a little or only between floors, so shoot 1 worse. */
export function movedAtAll(state: GameState): string[] {
  const walked = Object.entries(state.flow.starts ?? {}).filter(([id, [x, y]]) => state.models[id] && (state.flow.walked?.[id] ?? costOf(state, state.models[id], { x, y }, state.models[id])) > 0.05);
  const climbed = Object.entries(state.flow.climbed ?? {}).filter(([, c]) => c > 0);
  return [...new Set([...walked, ...climbed].map(([id]) => id))];
}

/** How much Move a model has spent walking this phase: along the way it went, or straight from its start if unknown. */
export function spent(state: GameState, m: Model): number {
  return state.flow.walked?.[m.id] ?? costOf(state, m, moveStart(state, m), m);
}

/** How much of its Move a model still has this phase, after the ground it's walked and any floors it's climbed. */
export function moveLeft(state: GameState, m: Model): number | null {
  const allowance = moveAllowance(state, m);
  return allowance === null ? null : Math.max(0, allowance - spent(state, m));
}

/** How near (in inches) a drop must be to the way a model came for it to count as stepping back along it. */
export const RETRACE = 0.4;

/**
 * Dragging a model back along the way it came this phase takes it back there and gives the Move it spent beyond that
 * point back, so a move that went wrong can be tried again. Returns the trail up to the nearest point on it, or null
 * when `to` isn't close to the way it came.
 */
export function retrace(trail: [number, number][] | undefined, to: Point): { at: Point; trail: [number, number][] } | null {
  if (!trail || trail.length < 2) return null;
  // How far back along the trail each of its points is from where the model is now.
  const behind: number[] = trail.map(() => 0);
  for (let i = trail.length - 2; i >= 0; i--) behind[i] = behind[i + 1] + Math.hypot(trail[i + 1][0] - trail[i][0], trail[i + 1][1] - trail[i][1]);
  for (let i = 0; i < trail.length - 1; i++) {
    const [ax, ay] = trail[i];
    const [bx, by] = trail[i + 1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((to.x - ax) * (bx - ax) + (to.y - ay) * (by - ay)) / len2)) : 0;
    const at = { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    // (The last bit of the way, even round a bend made of many short legs, is near where the model is now: a drag on
    // from there is a nudge, not a step back.)
    if (behind[i + 1] + Math.hypot(at.x - bx, at.y - by) < RETRACE) continue;
    if (Math.hypot(to.x - at.x, to.y - at.y) <= RETRACE) return { at, trail: [...trail.slice(0, i + 1), [at.x, at.y]] };
  }
  return null;
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
export function limitMove(state: GameState, from: Point, to: Point, move: number, seat?: Seat, m?: Model, skip?: ReadonlySet<string>, charge = true): Point {
  // Terrain that needs a test stops the model at it first, whatever its Move would allow beyond.
  const ahead = m && state.flow.started && testsTerrain(state, m) ? crossingAhead(state, m, from, to) : null;
  if (ahead) to = ahead.stop;
  const reached = reachable(state, from, to, move, seat, m);
  return m ? blockMove(state, m, from, reached, skip, charge) : reached;
}

/**
 * Where a model a player drags from `from` and drops at `to` ends up: as limitMove, except that models move freely
 * over an objective marker but may not end on it, so one dropped on a marker goes on past it instead of back, when
 * that's nearer and the model's Move gets it there clear of everything else.
 */
export function dropMove(state: GameState, from: Point, to: Point, move: number, seat: Seat, m: Model, skip?: ReadonlySet<string>, charge = true): Point {
  const ahead = state.flow.started && testsTerrain(state, m) ? crossingAhead(state, m, from, to) : null;
  if (ahead) to = ahead.stop;
  const reached = reachable(state, from, to, move, seat, m);
  const stop = blockMove(state, m, from, reached, skip, charge);
  const past = pastMarker(state, m, from, reached);
  if (!past || Math.hypot(past.x - reached.x, past.y - reached.y) >= Math.hypot(stop.x - reached.x, stop.y - reached.y)) return stop;
  const there = reachable(state, from, past, move, seat, m);
  if (Math.hypot(there.x - past.x, there.y - past.y) > 1e-3) return stop;
  const end = blockMove(state, m, from, past, skip, charge);
  return Math.hypot(end.x - past.x, end.y - past.y) < 1e-3 ? end : stop;
}

/** The first spot past the objective markers a model would end on at `to`, going on the way it came from `from`; null if it's on none. */
function pastMarker(state: GameState, m: Model, from: Point, to: Point): Point | null {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 1e-6 || !keptOffMarkers(m)) return null;
  const r = mmToIn(m.base.w) / 2;
  const markers = Object.values(state.terrain).filter(t => t.kind === 'objective' && !t.carrier && !t.gone);
  const onMarker = (p: Point) => markers.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.w / 2 + r - 0.05);
  if (!onMarker(to)) return null;
  const [ux, uy] = [(to.x - from.x) / d, (to.y - from.y) / d];
  for (let k = 0.05; k < 6; k += 0.05) {
    const p = { x: to.x + ux * k, y: to.y + uy * k };
    if (!onMarker(p)) return p;
  }
  return null;
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
  if (!movesLimited(state, m) || !(state.phase === 'move' || fightsAgain(state, m))) return at;
  const here = { ...m, ...at };
  let best: { e: Model; d: number } | null = null;
  for (const e of Object.values(state.models)) {
    // A Prone enemy has no Control Zone, nor has an Invisible one, and an Invisible model ignores them.
    if (e.owner === m.owner || e.dead || e.prone || passesThrough(m, e)) continue;
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
    const reach = limitMove(state, { x: m.x, y: m.y }, over, moveLeft(state, m) ?? m.move, m.owner, m);
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
  const reach = limitMove(state, { x: m.x, y: m.y }, contact, moveLeft(state, m) ?? m.move, m.owner, m);
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
    if (e.owner === m.owner || e.dead || e.waiting || e.escaped || e.prone || e.siege || passesThrough(m, e) || engaged(state, e, m.id)) return false;
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
