import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { castModel, seatOf } from './narrative.ts';
import { BOARD, DWARVES, NEST_GAP } from './elvesMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// The Elves of Mirkwood (Flies and Spiders, part 2): the scenario's own rules, in our own words. Thorin's Company,
// dazed by the forest's air, fights off Spiders that keep coming out of their nest, until Legolas, Tauriel and the
// Mirkwood Rangers arrive.

export const isElves = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'the-elves-of-mirkwood';

/** The battle lasts 12 turns. */
export const ELVES_TURNS = 12;
/** The Elves arrive as the Good side's fourth Move phase ends. */
export const ELVES_TURN = 4;
/** Good wins with this many of the company alive at the end; Evil, once it has slain this many. */
export const SURVIVORS = 10;
export const KILLS = 6;

export const EDGES = ['north', 'east', 'south', 'west'] as const;
export type Edge = (typeof EDGES)[number];

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

export const isDwarf = (m: Pick<Model, 'cast'>) => !!m.cast && (DWARVES as readonly string[]).includes(m.cast);
export const isSpider = (m: Pick<Model, 'cast'>) => m.cast === 'spider';
export const isElf = (m: Pick<Model, 'cast'>) => m.cast === 'legolas' || m.cast === 'tauriel' || m.cast === 'ranger';

/** Thorin's Company: the thirteen Dwarves (and Bilbo, where he's there). */
export const company = (state: GameState) => Object.values(state.models).filter(m => isDwarf(m) || (isElves(state) && m.cast === 'bilbo'));
export const companySlain = (state: GameState) => company(state).filter(m => m.dead).length;

// ——— The Haze of Mirkwood ———

/** As each Move phase begins, every Dwarf on the table rolls to see whether the forest's air has the better of it. */
export const hazeDue = (state: GameState) => isElves(state) && state.flow.started && state.phase === 'move' && !state.result && state.narrative?.hazed !== state.turn;

/**
 * A D6 for each Dwarf: on a 1-3 it is dazed this turn. It can't act, rolls a single die in a fight and makes no
 * strikes (see powers.ts heldBy and resolve.ts adjustFight).
 */
export function hazeRolls(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const good = seatOf(state, 'good');
  const dwarves = Object.values(state.models).filter(m => isDwarf(m) && alive(m));
  const out: Action[] = [];
  if (good && dwarves.length) {
    const dice = dwarves.map(() => d6());
    const dazed = dwarves.filter((_, i) => dice[i] <= 3);
    const roll: DiceRoll = {
      id: `n-${uid()}`,
      by: good,
      label: 'The Haze of Mirkwood: a 4+ for each Dwarf',
      dice,
      target: 4,
      note: dazed.length ? `Dazed this turn: ${dazed.map(m => m.name).join(', ')}.` : 'Every Dwarf shakes it off this turn.',
      at: now,
    };
    out.push({ type: 'rolled', roll });
    for (const m of dazed) out.push({ type: 'affect', id: m.id, patch: { hazed: state.turn } });
  }
  out.push({ type: 'narrativeNote', hazed: state.turn });
  return out;
}

/** Whether a Dwarf is dazed by the Haze this turn. */
export const hazed = (state: GameState, m: Model) => isElves(state) && m.hazed === state.turn;

// ——— The Rangers ———

/** Legolas, Tauriel and the Rangers still waiting to arrive. */
export const elvesWaiting = (state: GameState) => Object.values(state.models).filter(m => isElf(m) && m.waiting && !m.dead);

/** The edge the Elves come on from: the Good player's choice, or else the one nearest the Spiders. */
export function elvesEdge(state: GameState): Edge {
  const good = seatOf(state, 'good');
  const pick = good ? state.flow.picks?.[good]?.edge : undefined;
  if (pick && (EDGES as readonly string[]).includes(pick)) return pick as Edge;
  const spiders = Object.values(state.models).filter(m => isSpider(m) && alive(m));
  const at = spiders.length ? { x: spiders.reduce((n, m) => n + m.x, 0) / spiders.length, y: spiders.reduce((n, m) => n + m.y, 0) / spiders.length } : { x: BOARD / 2, y: BOARD };
  const gaps: [Edge, number][] = [
    ['north', at.y],
    ['east', state.board.w - at.x],
    ['south', state.board.h - at.y],
    ['west', at.x],
  ];
  return gaps.sort((a, b) => a[1] - b[1])[0][0];
}

/** The middle of an edge, where the entering Elves are counted from. */
export function edgePoint(state: GameState, edge: Edge): [number, number] {
  const { w, h } = state.board;
  return edge === 'north' ? [w / 2, 0] : edge === 'east' ? [w, h / 2] : edge === 'south' ? [w / 2, h] : [0, h / 2];
}

/** Whether ending the Good side's move now must wait for the Elves to arrive (see reducer endActivation). */
export function elvesPending(state: GameState, seat: Seat): boolean {
  return isElves(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'good') && state.turn >= ELVES_TURN && state.flow.entering?.turn !== state.turn && elvesWaiting(state).length > 0;
}

export const elvesDue = (state: GameState) => isElves(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'good') && elvesPending(state, state.flow.reinforce);

/** Legolas, Tauriel and the Rangers move on from the edge the Good player chose, anywhere along it. */
export function elvesArrive(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'good')!;
  const coming = elvesWaiting(state);
  const edge = elvesEdge(state);
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: 'The Rangers of Mirkwood arrive', dice: [], note: `Legolas, Tauriel and the Rangers come on from the ${edge} edge.`, at: now };
  const across = edge === 'north' || edge === 'south';
  return [{ type: 'rolled', roll }, { type: 'entering', seat, ids: coming.map(m => m.id), from: edgePoint(state, edge), span: [0, across ? state.board.w : state.board.h] }];
}

// ——— The Spider's Nest ———

/** As each Priority phase begins (from the second turn), the Spiders slain so far come back out of the nest. */
export const nestDue = (state: GameState) => isElves(state) && state.flow.started && state.phase === 'priority' && !state.result && state.turn >= 2 && state.narrative?.nested !== state.turn;

/** Where a Spider coming back may be put: on the table, on nobody, off the great trunks, and 10" from every Good model. */
export function nestFits(state: GameState, m: Model, p: Point, others: Point[] = []): boolean {
  const r = radius(m);
  if (p.x < r || p.y < r || p.x > state.board.w - r || p.y > state.board.h - r) return false;
  const at = { ...m, ...p };
  for (const o of Object.values(state.models)) {
    if (o.id === m.id || !alive(o)) continue;
    if (o.owner !== m.owner ? distanceBetween(at, o) < NEST_GAP - 0.01 : Math.hypot(o.x - p.x, o.y - p.y) < radius(o) + r - 0.02) return false;
  }
  if (others.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 2 * r)) return false;
  return !Object.values(state.terrain).some((t: Terrain) => !t.gone && t.sheer && Math.hypot(t.x - p.x, t.y - p.y) < t.w / 2 + r);
}

/** The best spot for a Spider coming back: as near the Dwarves as it may be, clear of the others coming back. */
export function nestSpot(state: GameState, m: Model, others: Point[] = []): Point | undefined {
  const prey = company(state).filter(alive);
  const near = (p: Point) => Math.min(...prey.map(o => Math.hypot(o.x - p.x, o.y - p.y)), 999);
  let best: Point | undefined;
  let score = Infinity;
  for (let x = 2; x <= state.board.w - 2; x += 1.5) {
    for (let y = 2; y <= state.board.h - 2; y += 1.5) {
      const p = { x, y };
      if (!nestFits(state, m, p, others)) continue;
      const s = near(p);
      if (s < score) [best, score] = [p, s];
    }
  }
  return best;
}

/** The slain Spiders come back, each put down by the Evil player somewhere it may go (the game picks a spot first). */
export function nestReturn(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const evil = seatOf(state, 'evil');
  const out: Action[] = [];
  const slain = Object.values(state.models).filter(m => isSpider(m) && m.dead && m.owner === evil);
  const placed: Point[] = [];
  for (const m of slain) {
    const at = nestSpot(state, m, placed);
    if (!at) continue;
    placed.push(at);
    out.push({ type: 'affect', id: m.id, patch: { dead: false, wounds: m.maxWounds, x: at.x, y: at.y, prone: false, effects: [] } });
    out.push({ type: 'placing', placing: { model: m.id, seat: m.owner, kind: 'nest', from: [at.x, at.y] } });
  }
  if (placed.length && evil) out.unshift({ type: 'rolled', roll: { id: `n-${uid()}`, by: evil, label: "The Spider's Nest", dice: [], note: `${placed.length} slain Spider${placed.length === 1 ? ' scuttles' : 's scuttle'} back out of the nest.`, at: now } });
  out.push({ type: 'narrativeNote', nested: state.turn });
  return out;
}

// ——— Who wins ———

/**
 * The battle lasts 12 turns. The Spiders win once they have slain six of Thorin's Company; otherwise the Good side wins
 * with ten or more of the company alive at the end, and anything else is a draw.
 */
export function elvesWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  if (companySlain(state) >= KILLS) return evil;
  if (state.turn > ELVES_TURNS || (state.turn === ELVES_TURNS && state.phase === 'end')) {
    return company(state).filter(m => !m.dead).length >= SURVIVORS ? good : 'draw';
  }
  return null;
}

/** Whether a model is one of the Elves (for the bot and the cast card). */
export const elfOf = (state: GameState, key: string) => castModel(state, key);
