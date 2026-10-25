import { hitModel } from './cavalry.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { distanceBetween, type Point } from './geometry.ts';
import { DWARVES, MARKER_SIZE } from './goblinMap.ts';
import { basesOverlap } from './movement.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import { inChasm, insidePolygon, outline } from './sight.ts';
import { hasRule } from './wargear.ts';
import type { Action, DiceRoll, GameState, Model, Placing, Seat } from './types.ts';

// Escape from Goblin-town (An Unexpected Journey): the scenario's own rules, in our own words. Thorin's Company, caught
// and stripped of its weapons, breaks loose in the Goblin King's court as Gandalf's light flares, and must snatch up
// its weapons and get off the table by the edge the Goblins leave open, over walkways with a bottomless drop either
// side. Goblins keep pouring in, and Gandalf turns up somewhere along the edge of the table.
// (The Goblin King's, Grinnah's and the Goblins' own rules, which work in any game, are here too.)

export const isGoblin = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'escape-from-goblin-town';

/** The battle lasts 10 turns. */
export const GOBLIN_TURNS = 10;
/** Gandalf arrives as the Good side's second Move phase ends. */
export const GANDALF_TURN = 2;
/** The Good side wins with this many models off the table by the escape edge; one fewer is a draw. */
export const ESCAPED_WIN = 9;
export const ESCAPED_DRAW = 8;

export const EDGES = ['north', 'east', 'south', 'west'] as const;
export type Edge = (typeof EDGES)[number];
const EXIT_SIDE: Record<Edge, 'top' | 'right' | 'bottom' | 'left'> = { north: 'top', east: 'right', south: 'bottom', west: 'left' };

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
export const isDwarf = (m: Pick<Model, 'cast'>) => !!m.cast && (DWARVES as readonly string[]).includes(m.cast);
const isWarrior = (m: Pick<Model, 'cast'>) => m.cast === 'goblin';

/** The pile of the Dwarves' weapons. */
export const weaponPile = (state: GameState) => Object.values(state.terrain).find(t => t.object === 'weapons' && !t.gone);

/** Somewhere nobody can stand: over the chasm, or up the sheer cavern walls. */
export function noFooting(state: GameState, p: Point): boolean {
  if (inChasm(state, p)) return true;
  return Object.values(state.terrain).some(t => t.look === 'cavewall' && Math.abs(t.x - p.x) < Math.max(t.w, t.h) / 2 + 0.1 && Math.abs(t.y - p.y) < Math.max(t.w, t.h) / 2 + 0.1 && insidePolygon(outline(t), p));
}

/** A point `d` in from the middle of an edge's stretch at `t` along it. */
function onEdge(state: GameState, edge: Edge, t: number, d: number): Point {
  const { w, h } = state.board;
  return edge === 'north' ? { x: t, y: d } : edge === 'south' ? { x: t, y: h - d } : edge === 'west' ? { x: d, y: t } : { x: w - d, y: t };
}

/**
 * Where the walkways meet an edge: each stretch of it, at least a base wide, that has planks right up to the edge.
 * (Measured half an inch in, where a model touching the edge stands.)
 */
export function mouths(state: GameState, edge: Edge): [number, number][] {
  const len = edge === 'north' || edge === 'south' ? state.board.w : state.board.h;
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let t = 0; t <= len + 0.01; t += 0.1) {
    const ok = t <= len && !noFooting(state, onEdge(state, edge, t, 0.5));
    if (ok && start === null) start = t;
    if (!ok && start !== null) {
      if (t - start >= 1) out.push([+start.toFixed(2), +(t - 0.1).toFixed(2)]);
      start = null;
    }
  }
  return out;
}

// ——— Bottomless Pits ———

/** The models standing over the chasm (a failed leap, or knocked off a platform): they fall, and are lost. (So at the Crack of Doom, over the fire.) */
export const fallen = (state: GameState) => ((isGoblin(state) || state.narrative?.id === 'the-end-of-all-things') && state.flow.started ? Object.values(state.models).filter(m => alive(m) && !m.aboard && inChasm(state, m)) : []);

/** A line for the log, from rules the game applies by itself (the same on every screen). */
function note(state: GameState, key: string, by: Seat, label: string, text: string, model?: string): DiceRoll {
  return { id: `gob-${state.turn}-${key}`.slice(0, 80), by, label, dice: [], note: text, at: state.log[state.log.length - 1]?.at ?? 0, ...(model ? { model } : {}) };
}

/**
 * The rules the game keeps to as models move: anyone over the chasm falls to their death, a Dwarf that reaches the
 * Weapon Pile takes up its weapons, and friends a model with Relentless Advance ends its charge on top of are slain.
 */
export function goblinSync(state: GameState): GameState {
  if (!state.flow.started) return state;
  let models = state.models;
  const log: DiceRoll[] = [];
  for (const m of fallen(state)) {
    models = { ...models, [m.id]: { ...models[m.id], dead: true, wounds: 0 } };
    // (The End of All Things: the fire of the Crack of Doom, or off the edge of a table.)
    const fire = Object.values(state.terrain).some(t => t.look === 'lava' && !t.gone && insidePolygon(outline(t), m));
    if (isGoblin(state)) log.push(note(state, `fall-${m.id}`, m.owner, 'Bottomless Pits', `${m.name} falls into the chasm and is lost.`, m.id));
    else log.push(note(state, `fall-${m.id}`, m.owner, fire ? 'The Crack of Doom' : 'Off the table', fire ? `${m.name} falls into the fire and is lost.` : `${m.name} goes off the edge of the table and is lost.`, m.id));
  }
  // Take Up Arms: touching the pile at any point in its move (or now).
  const pile = isGoblin(state) ? weaponPile(state) : undefined;
  if (pile) {
    for (const m of Object.values(models)) {
      if (!alive(m) || !isDwarf(m) || !m.lostGear?.length) continue;
      const reach = radius(m) + MARKER_SIZE / 2 + 0.03;
      const path = state.flow.paths?.[m.id] ?? [];
      const way: Point[] = [...path.map(([x, y]) => ({ x, y })), { x: m.x, y: m.y }];
      const touched = way.some((p, i) => (i ? toSegment(pile, way[i - 1], p) : Math.hypot(p.x - pile.x, p.y - pile.y)) <= reach);
      if (!touched) continue;
      const { lostGear: _, ...armed } = m;
      models = { ...models, [m.id]: armed };
      log.push(note(state, `arms-${m.id}`, m.owner, 'Take Up Arms', `${m.name} snatches up his weapons from the pile.`, m.id));
    }
  }
  // Relentless Advance: friends under the charger as it stops are crushed.
  for (const k of Object.values(models).filter(x => alive(x) && x.ground?.includes('relentless') && state.phase === 'move' && state.flow.paths?.[x.id]?.length)) {
    for (const f of Object.values(models)) {
      if (f.id === k.id || f.owner !== k.owner || !alive(f) || f.aboard || !basesOverlap(k, f)) continue;
      models = { ...models, [f.id]: { ...f, dead: true, wounds: 0 } };
      log.push(note(state, `crush-${f.id}`, k.owner, 'Relentless Advance', `${f.name}, under ${k.name} as he stops, is crushed.`, f.id));
    }
  }
  if (models === state.models) return state;
  return { ...state, models, log: [...state.log, ...log.filter(r => !state.log.some(x => x.id === r.id))] };
}

/** How far a point is from the segment a-b. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ——— The escape edge ———

/** The edge the Good side must escape by: the Evil player's choice, made before the battle. */
export function escapeEdge(state: GameState): Edge | undefined {
  const evil = seatOf(state, 'evil');
  const pick = evil ? state.flow.picks?.[evil]?.exit : undefined;
  return pick && (EDGES as readonly string[]).includes(pick) ? (pick as Edge) : undefined;
}

/** Whether the Evil player still has to choose the escape edge before finishing their set-up. */
export const exitPickDue = (state: GameState, seat: Seat) => isGoblin(state) && !state.flow.started && seat === seatOf(state, 'evil') && !escapeEdge(state);

/** Which table edge a model may leave by: any Good model, by the escape edge. */
export const goblinExits = (state: GameState, m: Model): ('top' | 'bottom' | 'left' | 'right')[] => {
  const edge = escapeEdge(state);
  return isGoblin(state) && edge && m.owner === seatOf(state, 'good') ? [EXIT_SIDE[edge]] : [];
};

/** The edge the computer's Goblins would leave open: the one with the fewest, narrowest ways off it. */
export function bestExit(state: GameState): Edge {
  const room = (e: Edge) => mouths(state, e).reduce((n, [a, b]) => n + (b - a), 0) + 3 * mouths(state, e).length;
  return [...EDGES].sort((a, b) => room(a) - room(b))[0];
}

// ——— A Wizard is Never Late ———

export const gandalfOf = (state: GameState) => castModel(state, 'gandalf');

/** Whether ending the Good side's move must wait for Gandalf's roll (see reducer endActivation). */
export function gandalfPending(state: GameState, seat: Seat): boolean {
  const g = gandalfOf(state);
  return isGoblin(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'good') && state.turn >= GANDALF_TURN && !state.narrative?.gandalf && !!g?.waiting && !g.dead;
}

export const gandalfDue = (state: GameState) => isGoblin(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'good') && gandalfPending(state, state.flow.reinforce);

/** Whether Gandalf (or anyone) could stand here, touching the table edge: on the planks, clear of everyone else. */
export function edgeFits(state: GameState, m: Model, p: Point): boolean {
  const r = radius(m);
  if (p.x < r - 0.01 || p.y < r - 0.01 || p.x > state.board.w - r + 0.01 || p.y > state.board.h - r + 0.01) return false;
  const touches = p.x <= r + 0.02 || p.y <= r + 0.02 || p.x >= state.board.w - r - 0.02 || p.y >= state.board.h - r - 0.02;
  if (!touches || noFooting(state, p)) return false;
  // (Its whole base on the walkway, near enough: a little either side of its middle too.)
  if ([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].some(a => noFooting(state, { x: p.x + Math.cos(a) * r * 0.7, y: p.y + Math.sin(a) * r * 0.7 }))) return false;
  return Object.values(state.models).every(o => o.id === m.id || !alive(o) || Math.hypot(o.x - p.x, o.y - p.y) >= radius(o) + r - 0.01);
}

/** Where a model being put on at the edge goes when dragged towards `asked`: touching the nearest edge there. */
export function edgeSpot(state: GameState, m: Model, asked: Point): Point | null {
  const r = radius(m);
  const { w, h } = state.board;
  const x = Math.max(r, Math.min(w - r, asked.x));
  const y = Math.max(r, Math.min(h - r, asked.y));
  const gaps = [x - r, w - r - x, y - r, h - r - y];
  const k = gaps.indexOf(Math.min(...gaps));
  const spot = { x: k === 0 ? r : k === 1 ? w - r : x, y: k === 2 ? r : k === 3 ? h - r : y };
  return edgeFits(state, m, spot) ? spot : null;
}

/**
 * Where the game first puts Gandalf for whoever places him: the Good player as near the Dwarves as the edge allows,
 * the Evil player as far from them, and from the escape edge, as it can.
 */
export function gandalfSpot(state: GameState, g: Model, placer: Seat): Point | undefined {
  const dwarves = Object.values(state.models).filter(m => isDwarf(m) && alive(m));
  const at = dwarves.length ? { x: dwarves.reduce((n, m) => n + m.x, 0) / dwarves.length, y: dwarves.reduce((n, m) => n + m.y, 0) / dwarves.length } : { x: state.board.w / 2, y: state.board.h / 2 };
  const good = placer === seatOf(state, 'good');
  const exit = escapeEdge(state);
  let best: Point | undefined;
  let score = Infinity;
  const r = radius(g);
  for (const edge of EDGES) {
    const len = edge === 'north' || edge === 'south' ? state.board.w : state.board.h;
    for (let t = r; t <= len - r; t += 0.25) {
      const p = onEdge(state, edge, t, r);
      if (!edgeFits(state, g, p)) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      const s = good ? d : -d + (edge === exit ? 40 : 0);
      if (s < score) [best, score] = [p, s];
    }
  }
  return best;
}

/**
 * A Wizard is Never Late: a D6 as the Good side's second move ends. 1-3, the Evil player puts Gandalf on; 4-6, the Good
 * player does: on a walkway touching any table edge. (The game puts him somewhere first, and the player may move him.)
 */
export function gandalfArrives(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const good = seatOf(state, 'good')!;
  const evil = seatOf(state, 'evil')!;
  const g = gandalfOf(state)!;
  const die = d6();
  const placer = die >= 4 ? good : evil;
  const at = gandalfSpot(state, g, placer);
  const roll: DiceRoll = { id: `n-${uid()}`, by: good, label: 'A Wizard is Never Late: 4+ and the Good player places Gandalf', dice: [die], target: 4, model: g.id, note: at ? `${die >= 4 ? 'The Good' : 'The Evil'} player puts Gandalf on a walkway at the table's edge.` : 'There is no room at any edge: Gandalf waits.', at: now };
  if (!at) return [{ type: 'rolled', roll }, { type: 'narrativeNote', gandalf: state.turn }];
  const rot = Math.round((Math.atan2(state.board.w / 2 - at.x, at.y - state.board.h / 2) * 180) / Math.PI + 360) % 360;
  const placing: Placing = { model: g.id, seat: placer, kind: 'edge', from: [at.x, at.y] };
  return [{ type: 'rolled', roll }, { type: 'affect', id: g.id, patch: { waiting: false, x: at.x, y: at.y, rot } }, { type: 'placing', placing }, { type: 'narrativeNote', gandalf: state.turn }];
}

// ——— Kill Them All! ———

/** The Goblin Warriors that have been slain, ready to come back. */
export const slainWarriors = (state: GameState): Model[] => Object.values(state.models).filter(m => isWarrior(m) && m.owner === seatOf(state, 'evil') && !m.escaped && (m.dead || m.waiting));

/** Whether ending the Evil side's move must wait for the slain Goblins to come back (see reducer endActivation). */
export function hordePending(state: GameState, seat: Seat): boolean {
  return isGoblin(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'evil') && state.flow.entering?.turn !== state.turn && state.narrative?.horde !== state.turn && slainWarriors(state).length > 0;
}

export const hordeDue = (state: GameState) => isGoblin(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'evil') && hordePending(state, state.flow.reinforce);

/** The edge the Goblins come back from: the Evil player's choice (any time), or else the escape edge, to cut the Dwarves off. */
export function hordeEdge(state: GameState): Edge {
  const evil = seatOf(state, 'evil');
  const pick = evil ? state.flow.picks?.[evil]?.edge : undefined;
  if (pick && (EDGES as readonly string[]).includes(pick)) return pick as Edge;
  return escapeEdge(state) ?? 'north';
}

/** The walkway on that edge they come on along: the one nearest the Dwarves. */
export function hordeMouth(state: GameState, edge: Edge): [number, number] | undefined {
  const dwarves = Object.values(state.models).filter(m => isDwarf(m) && alive(m));
  const along = (p: Point) => (edge === 'north' || edge === 'south' ? p.x : p.y);
  const mid = dwarves.length ? dwarves.reduce((n, m) => n + along(m), 0) / dwarves.length : state.board.w / 2;
  return [...mouths(state, edge)].sort((a, b) => Math.abs((a[0] + a[1]) / 2 - mid) - Math.abs((b[0] + b[1]) / 2 - mid))[0];
}

/**
 * Kill Them All!: as the Evil side's move ends, a D6, and up to that many slain Goblin Warriors move on as
 * reinforcements from the edge the Evil player chose, along a walkway that reaches it.
 */
export function hordeArrives(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'evil')!;
  const slain = slainWarriors(state);
  const die = d6();
  let edge = hordeEdge(state);
  let mouth = hordeMouth(state, edge);
  // (An edge with no walkway to it: the nearest one that has.)
  if (!mouth) for (const e of EDGES) if (!mouth && (mouth = hordeMouth(state, e))) edge = e;
  const coming = mouth ? slain.slice(0, die) : [];
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: 'Kill Them All!: a D6 slain Goblins come back', dice: [die], model: coming[0]?.id, note: coming.length ? `${coming.length} Goblin${coming.length === 1 ? '' : 's'} swarm${coming.length === 1 ? 's' : ''} back on from the ${edge} edge.` : 'No Goblins come back.', at: now };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'narrativeNote', horde: state.turn }];
  for (const g of coming) out.push({ type: 'affect', id: g.id, patch: { dead: false, waiting: true, wounds: g.maxWounds, prone: false, effects: [] } });
  const m = mouth ? (mouth[0] + mouth[1]) / 2 : 0;
  const from: [number, number] = edge === 'north' ? [m, 0] : edge === 'south' ? [m, state.board.h] : edge === 'west' ? [0, m] : [state.board.w, m];
  out.push({ type: 'entering', seat, ids: coming.map(g => g.id), from, ...(mouth ? { span: mouth } : {}) });
  return out;
}

// ——— I Know That Sword! ———

/** In the first turn the Goblin King may neither move nor declare a heroic action. */
export const swordStill = (state: GameState, m: Pick<Model, 'cast'>) => isGoblin(state) && state.turn === 1 && m.cast === 'goblin-king';

// ——— Relentless Advance ———

/** Whether `m` may move through `e` (and stop on it) as it charges: the Goblin King, through his own Goblins. */
export const relentlessThrough = (m: Model, e: Model) => !!m.ground?.includes('relentless') && e.owner === m.owner && !!e.ground?.includes('goblin') && !e.ground.includes('relentless');

/** The Goblins a Relentless Advance has gone through this phase and not yet hurt (not counting any it stands on now). */
export function trodden(state: GameState, k: Model): Model[] {
  const path = state.flow.paths?.[k.id];
  if (!state.flow.started || state.phase !== 'move' || !alive(k) || !k.ground?.includes('relentless') || !path || path.length < 1) return [];
  const way: Point[] = [...path.map(([x, y]) => ({ x, y })), { x: k.x, y: k.y }];
  const r = radius(k);
  return Object.values(state.models).filter(g => {
    if (!alive(g) || !relentlessThrough(k, g) || basesOverlap(k, g) || state.flow.usedTurn?.includes(`trodden:${g.id}`)) return false;
    const reach = r + radius(g) - 0.05;
    return way.some((p, i) => i > 0 && toSegment(g, way[i - 1], p) < reach);
  });
}

export const relentlessDue = (state: GameState) => state.flow.started && !state.result && Object.values(state.models).some(k => k.ground?.includes('relentless') && trodden(state, k).length > 0);

/** Each Goblin he went through takes a Strength 3 hit. */
export function relentlessHits(state: GameState, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const k of Object.values(state.models).filter(x => x.ground?.includes('relentless'))) {
    const under = trodden(state, k);
    if (!under.length) continue;
    const group = `ra-${uid()}`;
    for (const g of under) {
      out.push(...hitModel(g, modelStats(catalog, g)?.D ?? 3, 3, `Relentless Advance: ${k.name} tramples through`, d6, k.owner, `${group}-${uid()}`, now, group).actions);
      out.push({ type: 'usedTurn', key: 'trodden', model: g.id });
    }
  }
  return out;
}

// ——— Swap with Me ———

/**
 * Whether Grinnah may swap places with a friendly Goblin on a 25mm base within 3" of him: as the Fight phase starts,
 * before any heroic action is declared, once a phase. (Not a move.)
 */
export function maySwapWith(state: GameState, catalog: Catalog | null | undefined, a: Model | undefined, b: Model | undefined): boolean {
  if (!a || !b || a.id === b.id || a.owner !== b.owner || !alive(a) || !alive(b) || !hasRule(catalog, a, 'Swap with Me')) return false;
  if (!state.flow.started || state.phase !== 'fight' || state.flow.heroics.some(h => h.phase === 'fight') || state.flow.passed.length) return false;
  if (state.flow.resolved.length || state.flow.duels?.length || state.flow.usedTurn?.includes(`grinnah:${a.id}`)) return false;
  if (!b.ground?.includes('goblin') || b.base.shape !== 'round' || b.base.w !== 25) return false;
  return distanceBetween(a, b) <= 3;
}

/** The Goblins Grinnah could swap with now, nearest first. */
export function swapCandidates(state: GameState, catalog: Catalog | null | undefined, seat: Seat): { a: Model; b: Model }[] {
  const out: { a: Model; b: Model }[] = [];
  for (const a of Object.values(state.models).filter(m => m.owner === seat && alive(m) && hasRule(catalog, m, 'Swap with Me')))
    for (const b of Object.values(state.models)) if (maySwapWith(state, catalog, a, b)) out.push({ a, b });
  return out.sort((x, y) => distanceBetween(x.a, x.b) - distanceBetween(y.a, y.b));
}

// ——— Who wins ———

/** The Good models that have got away by the escape edge. */
export const escapedCount = (state: GameState) => Object.values(state.models).filter(m => m.owner === seatOf(state, 'good') && m.escaped && !m.dead).length;

/**
 * The battle lasts 10 turns. Nine or more Good models off the escape edge is a Good win, eight a draw, fewer an Evil
 * win. Once nine are off, or so many have fallen that eight never can be, it's settled there and then.
 */
export function goblinWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const off = escapedCount(state);
  if (off >= ESCAPED_WIN) return good;
  const left = Object.values(state.models).filter(m => m.owner === good && !m.dead && !m.escaped).length;
  if (off + left < ESCAPED_DRAW) return evil;
  if (state.turn > GOBLIN_TURNS || (state.turn === GOBLIN_TURNS && state.phase === 'end')) return off >= ESCAPED_DRAW ? 'draw' : evil;
  return null;
}

/** For the scoreboard: how many have got away, and where. */
export const escapeNote = (state: GameState) => `${escapedCount(state)} escaped${escapeEdge(state) ? ` by the ${escapeEdge(state)} edge` : ''}`;
