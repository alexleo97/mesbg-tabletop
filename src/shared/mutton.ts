import { castModel, radius, seatOf } from './narrative.ts';
import { basesOverlap } from './movement.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Roast Mutton: the scenario's own rules, in our own words. Thorin's Company comes on from the middle of the west edge
// as reinforcements in the first two turns, the Trolls may not strike Bilbo at first, and from turn 7 the sun may rise
// and end it all. (The Trolls' and the Dwarves' own rules are in trolls.ts and company.ts.)

export const isMutton = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'roast-mutton';

const TROLLS = ['bill', 'bert', 'tom'];
export const isTroll = (m: Pick<Model, 'cast'>) => !!m.cast && TROLLS.includes(m.cast);

/** Where a reinforcement steps onto the table: touching the middle of the west edge, or the nearest clear point along it. */
export function entrySpot(state: GameState, m: Model): { x: number; y: number } | undefined {
  const x = radius(m);
  const mid = state.board.h / 2;
  const clear = (y: number) => !Object.values(state.models).some(o => o.id !== m.id && !o.dead && !o.waiting && !o.escaped && basesOverlap({ ...m, x, y, waiting: undefined }, o));
  for (let d = 0; d <= mid; d += 0.05) {
    for (const y of d ? [mid - d, mid + d] : [mid]) if (y >= radius(m) && y <= state.board.h - radius(m) && clear(y)) return { x, y };
  }
  return undefined;
}

/** The Dwarves still to come on, in the order of the cast. */
export const offTable = (state: GameState): Model[] => {
  const good = seatOf(state, 'good');
  return Object.values(state.models).filter(m => m.owner === good && m.waiting && !m.dead);
};

/**
 * The Good side has asked to end its move in turn 1 or 2 with Dwarves still to come: roll for them (turn 1, a 3+ each)
 * or bring the rest on (turn 2) before it does.
 */
export function reinforceDue(state: GameState): boolean {
  return isMutton(state) && state.flow.started && state.phase === 'move' && !state.result && state.flow.reinforce === seatOf(state, 'good') && state.flow.entering?.turn !== state.turn;
}

/** Whether ending this side's move now must wait for its reinforcements (see reducer endActivation). */
export function reinforcementsPending(state: GameState, seat: Seat): boolean {
  return isMutton(state) && state.phase === 'move' && seat === seatOf(state, 'good') && state.turn <= 2 && state.flow.entering?.turn !== state.turn && offTable(state).length > 0;
}

/** Rolls for the Dwarves off the table (turn 1) or brings them all (turn 2); those that come move on one at a time. */
export function rollReinforcements(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'good')!;
  const waiting = offTable(state);
  const out: Action[] = [];
  let coming: Model[];
  if (state.turn === 1) {
    const dice = waiting.map(() => d6());
    coming = waiting.filter((_, i) => dice[i] >= 3);
    const roll: DiceRoll = {
      id: `n-${uid()}`,
      by: seat,
      label: 'The Company arrives: a 3+ for each Dwarf',
      dice,
      target: 3,
      note: coming.length ? `${coming.map(m => m.name).join(', ')} ${coming.length === 1 ? 'comes' : 'come'} on from the west edge.` : 'Nobody yet: they all come next turn.',
      at: now,
    };
    out.push({ type: 'rolled', roll });
  } else {
    coming = waiting;
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: 'The rest of the Company arrives', dice: [], note: `${coming.map(m => m.name).join(', ')} come on from the west edge.`, at: now } });
  }
  out.push({ type: 'entering', seat, ids: coming.map(m => m.id), from: [0, state.board.h / 2] });
  return out;
}

/**
 * The next reinforcement to step onto the table and where, once the one before it has made its move (or its player has
 * moved on from it); undefined when none is waiting or the edge is full.
 */
export function nextEntering(state: GameState): { model: Model; at: { x: number; y: number } } | undefined {
  const e = state.flow.entering;
  if (!e || e.turn !== state.turn) return undefined;
  const on = e.on ? state.models[e.on] : undefined;
  if (on && !on.dead && e.at && Math.hypot(on.x - e.at[0], on.y - e.at[1]) < 1e-3) return undefined;
  const model = e.ids.map(id => state.models[id]).find(m => m && m.waiting && !m.dead);
  const at = model && entrySpot(state, model);
  return model && at ? { model, at } : undefined;
}

/** A reinforcement stands at the edge, yet to make its move. */
export function onEdge(state: GameState): Model | undefined {
  const e = state.flow.entering;
  const on = e?.turn === state.turn && e.on ? state.models[e.on] : undefined;
  return on && !on.dead && e!.at && Math.hypot(on.x - e!.at[0], on.y - e!.at[1]) < 1e-3 ? on : undefined;
}

/** Whether reinforcements are still coming on this activation: one stands at the edge yet to move, or another can step on. */
export const stillEntering = (state: GameState) => !!onEdge(state) || !!nextEntering(state);

/** Models moving onto the table this turn as reinforcements: they may not charge. */
export const entering = (state: GameState, m: Model) => state.flow.entering?.turn === state.turn && state.flow.entering.ids.includes(m.id);

// ——— A Burrahobbit? ———

/** The models a Troll may not strike yet: Bilbo, until turn 3 begins or he has charged one of them. */
export function spareFor(state: GameState, m: Model): string[] {
  if (!isMutton(state) || !isTroll(m) || state.turn >= 3 || state.narrative?.bilbo) return [];
  const bilbo = castModel(state, 'bilbo');
  return bilbo && !bilbo.dead ? [bilbo.id] : [];
}

// ——— The dawn ———

/** At the start of turn 7 and each turn after, the roll for the sun. */
export function dawnDue(state: GameState): boolean {
  const ns = state.narrative;
  return isMutton(state) && state.flow.started && !state.result && state.turn >= 7 && state.phase === 'priority' && !ns?.dawn && !ns?.rolled?.includes(state.turn);
}

export function rollDawn(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const die = d6();
  const up = die >= 4;
  const roll: DiceRoll = { id: `n-${uid()}`, by: seatOf(state, 'good')!, label: 'The dawn: a 4+ and Gandalf lets the sun in', dice: [die], target: 4, note: up ? 'Sunlight floods the clearing and the Trolls turn to stone.' : 'Still dark.', at: now };
  return [{ type: 'rolled', roll }, { type: 'narrativeNote', rolled: state.turn, ...(up ? { dawn: state.turn } : {}) }];
}

// ——— Who wins ———

/** In a sack: out of the fight for good (see trolls.ts). */
export const sacked = (m: Model) => !!m.effects?.some(e => e.sack);

export function muttonWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const bilboDead = !!castModel(state, 'bilbo')?.dead;
  const trolls = Object.values(state.models).filter(m => m.owner === evil);
  if (trolls.length && trolls.every(m => m.dead)) return bilboDead ? 'draw' : good;
  const company = Object.values(state.models).filter(m => m.owner === good);
  if (company.length && company.every(m => m.dead || sacked(m))) return evil;
  if (state.narrative?.dawn) return 'draw';
  return null;
}
