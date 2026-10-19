import type { Catalog } from './catalog.ts';
import type { FightRequest } from './fight.ts';
import { touchingEnemies } from './barriers.ts';
import { combats } from './flow.ts';
import { distanceBetween, type Point } from './geometry.ts';
import { phaseHeroics } from './heroics.ts';
import { engaged, heroicCombatWon, limitMove } from './movement.ts';
import { radius } from './narrative.ts';
import { mounted } from './cavalry.ts';
import { isMonster } from './monsters.ts';
import type { Action, GameState, Model, Placing } from './types.ts';

// Samwise Gamgee's own rules: "Let him go or I'll have you, Longshanks!", a free Heroic Combat to get to Frodo, and
// his Frying Pan, swung instead of striking to stop an enemy moving next turn.

export const isSam = (m: Pick<Model, 'profileId'>) => /\] samwise-gamgee$/.test(m.profileId ?? '');
export const isFrodo = (m: Pick<Model, 'profileId'>) => /\] frodo-baggins$/.test(m.profileId ?? '');

const frodoOf = (state: GameState, m: Model) => Object.values(state.models).find(f => f.owner === m.owner && !f.dead && !f.waiting && isFrodo(f));

/** Frodo's fight, if he is in one. */
const frodoFight = (state: GameState, frodo: Model) => combats(state).find(c => c.p1.includes(frodo.id) || c.p2.includes(frodo.id));

/**
 * Whether Sam may call a Heroic Combat for free now: in the Fight phase, with Frodo within 6" and in a fight that
 * Sam isn't already in.
 */
export function longshanksFree(state: GameState, m: Model): boolean {
  if (!isSam(m) || m.dead || state.phase !== 'fight') return false;
  const frodo = frodoOf(state, m);
  if (!frodo || distanceBetween(m, frodo) > 6 || !engaged(state, frodo)) return false;
  const c = frodoFight(state, frodo);
  return !c || !(c.p1.includes(m.id) || c.p2.includes(m.id));
}

/** Sam, whose free Heroic Combat has just won through, and must now go to Frodo's fight. */
export function longshanksDue(state: GameState): Model | undefined {
  if (!state.flow.started || state.phase !== 'fight' || state.flow.placing?.length) return undefined;
  for (const h of phaseHeroics(state)) {
    const m = state.models[h.model];
    if (!h.free || !m || m.dead || state.flow.joined?.includes(m.id) || !heroicCombatWon(state, m)) continue;
    return m;
  }
  return undefined;
}

/** Where Sam may end his move: touching an enemy that is fighting Frodo, if he can reach one. */
function joinSpots(state: GameState, sam: Model, frodo: Model, from: Point, reach: number): Point[] {
  const out: Point[] = [];
  for (const e of touchingEnemies(state, frodo)) {
    const r = radius(e) + radius(sam) + 0.02;
    for (let a = 0; a < 360; a += 10) {
      const p = { x: e.x + Math.sin((a * Math.PI) / 180) * r, y: e.y - Math.cos((a * Math.PI) / 180) * r };
      if (joinsFight(state, sam, frodo, from, reach, p)) out.push(p);
    }
  }
  return out;
}

/** Whether Sam can get to `p` from `from` and would be in Frodo's fight there. */
function joinsFight(state: GameState, sam: Model, frodo: Model, from: Point, reach: number, p: Point): boolean {
  const got = limitMove(state, from, p, reach, sam.owner, { ...sam, ...from }, new Set([sam.id]));
  if (Math.hypot(got.x - p.x, got.y - p.y) > 0.05) return false;
  const there = { ...state, models: { ...state.models, [sam.id]: { ...sam, ...p } } };
  const foes = new Set(touchingEnemies(there, frodo).map(e => e.id));
  return touchingEnemies(there, there.models[sam.id]).some(e => foes.has(e.id));
}

/**
 * Moves Sam into Frodo's fight, as near to where he stands as can be (or as near to Frodo as he can get when
 * that's impossible), for his player to move elsewhere into the fight if they like.
 */
export function longshanksMove(state: GameState, sam: Model): Action[] {
  const frodo = frodoOf(state, sam);
  const from = { x: sam.x, y: sam.y };
  const reach = sam.move;
  const spots = frodo && engaged(state, frodo) ? joinSpots(state, sam, frodo, from, reach) : [];
  const best = spots.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  const to = best ?? (frodo ? limitMove(state, from, frodo, reach, sam.owner, sam, new Set([sam.id])) : from);
  const placing: Placing = { model: sam.id, seat: sam.owner, kind: 'join', from: [from.x, from.y], dist: reach, ...(frodo ? { away: [frodo.id] } : {}), ...(best ? {} : { stay: true }) };
  return [{ type: 'backAway', moves: [{ id: sam.id, x: to.x, y: to.y }] }, { type: 'placing', placing }];
}

/** Where Sam goes when his player drags him towards `asked`: anywhere in Frodo's fight he can reach. */
export function joinSpot(state: GameState, p: Placing, sam: Model, asked: Point): Point | null {
  if (p.stay) return null;
  const frodo = p.away?.[0] ? state.models[p.away[0]] : undefined;
  if (!frodo || frodo.dead) return null;
  const from = { x: p.from[0], y: p.from[1] };
  return joinsFight(state, sam, frodo, from, p.dist ?? sam.move, asked) ? asked : null;
}

// ——— The Frying Pan ———

export const FRYING_PAN = 'Frying Pan';
export const hasFryingPan = (catalog: Catalog | null | undefined, m: Model) => !!(m.profileId && catalog?.units[m.profileId]?.rules.includes(FRYING_PAN));

/** Whether the pan can be swung at this enemy: infantry, not a monster or a rider. */
export const pannable = (catalog: Catalog | null | undefined, m: Model) => !mounted(m) && !m.beast && !m.siege && !isMonster(catalog, m);

/** The Frying Pans swung in this fight instead of striking, each at an enemy infantry model in it. */
export function fryingPans(state: GameState, catalog: Catalog | null | undefined, req: FightRequest): { by: string; target: string }[] {
  const out: { by: string; target: string }[] = [];
  for (const side of [0, 1] as const) {
    const foes = req.sides[1 - side].filter(f => !f.support).map(f => f.id);
    for (const f of req.sides[side]) {
      const m = state.models[f.id];
      const target = state.flow.choices?.[f.id]?.pan;
      const t = target ? state.models[target] : undefined;
      if (f.support || !m || !t || !foes.includes(t.id) || !hasFryingPan(catalog, m) || !pannable(catalog, t)) continue;
      out.push({ by: f.id, target: t.id });
    }
  }
  return out;
}

/** A model stunned by the pan can't move this turn. */
export const stunnedByPan = (state: GameState, m: Model) => m.panned === state.turn;
