import { castModel, radius, seatOf } from './narrative.ts';
import { distanceBetween } from './geometry.ts';
import { basesOverlap } from './movement.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Roast Mutton: the scenario's own rules, in our own words. Thorin's Company comes on from the middle of the west edge
// as reinforcements in the first two turns, the Trolls may not strike Bilbo at first, and from turn 7 the sun may rise
// and end it all. (The Trolls' and the Dwarves' own rules are in trolls.ts and company.ts.)

export const isMutton = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'roast-mutton';

const TROLLS = ['bill', 'bert', 'tom'];
export const isTroll = (m: Pick<Model, 'cast'>) => !!m.cast && TROLLS.includes(m.cast);

/** The table edge reinforcements are coming on from, and which way they face as they step on. */
export function entryEdge(state: GameState): { edge: 'north' | 'east' | 'south' | 'west'; facing: number } {
  const from = state.flow.entering?.from ?? [0, state.board.h / 2];
  if (from[1] >= state.board.h - 0.01) return { edge: 'south', facing: 0 };
  if (from[1] <= 0.01 && from[0] > 0.01) return { edge: 'north', facing: 180 };
  if (from[0] >= state.board.w - 0.01) return { edge: 'east', facing: 270 };
  return { edge: 'west', facing: 90 };
}

/**
 * Where a reinforcement steps onto the table: touching the edge at the point they come on from (the middle of the west
 * edge in Roast Mutton), or the nearest clear point along it, within the stretch of edge they may use.
 */
export function entrySpot(state: GameState, m: Model): { x: number; y: number } | undefined {
  const { edge, facing } = entryEdge(state);
  const from = state.flow.entering?.from ?? [0, state.board.h / 2];
  const across = edge === 'north' || edge === 'south';
  const r = radius(m);
  const [lo, hi] = state.flow.entering?.span ?? [0, across ? state.board.w : state.board.h];
  const fixed = edge === 'west' || edge === 'north' ? r : edge === 'east' ? state.board.w - r : state.board.h - r;
  const mid = across ? from[0] : from[1];
  const spot = (t: number) => (across ? { x: t, y: fixed } : { x: fixed, y: t });
  // (Only those near that edge can be in the way.)
  const near = Object.values(state.models).filter(o => o.id !== m.id && !o.dead && !o.waiting && !o.escaped && Math.abs((across ? o.y : o.x) - fixed) < 4);
  const foes = near.filter(o => o.owner !== m.owner);
  const len = across ? state.board.w : state.board.h;
  // Clear of other bases and, where it can be, outside every enemy's control zone, so it chooses whether to charge.
  const clear = (t: number, roomy: boolean) => {
    const here = { ...m, ...spot(t), rot: facing, waiting: undefined };
    return !near.some(o => basesOverlap(here, o)) && (!roomy || !foes.some(o => distanceBetween(here, o) < 1));
  };
  for (const roomy of [true, false]) {
    for (let d = 0; d <= hi - lo; d += 0.05) {
      for (const t of d ? [mid - d, mid + d] : [mid]) if (t >= lo + r && t <= hi - r && clear(t, roomy)) return spot(t);
    }
  }
  // With no room left along its stretch of the edge, a reinforcement comes on at the nearest clear spot beyond it
  // (though at Balin's Tomb there is no way in but the doorway, nor in Goblin-town but the walkway, nor at the Black Gate but the gateway, nor out of Minas Tirith but its Gates: it waits for next turn).
  if ((lo > 0 || hi < len) && state.narrative?.id !== 'balins-tomb' && state.narrative?.id !== 'escape-from-goblin-town' && state.narrative?.id !== 'the-end-of-all-things' && state.narrative?.id !== 'battle-of-pelennor-fields') {
    for (const roomy of [true, false]) {
      for (let d = 0; d <= len; d += 0.05) {
        for (const t of [lo - d, hi + d]) if (t >= r && t <= len - r && clear(t, roomy)) return spot(t);
      }
    }
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

/** Models moving onto the table this turn as reinforcements. */
export const entering = (state: GameState, m: Model) => state.flow.entering?.turn === state.turn && state.flow.entering.ids.includes(m.id);
/** Reinforcements may not charge as they come on, unless the scenario lets them (Helm's Deep's Relief Force). */
export const enteringNoCharge = (state: GameState, m: Model) => entering(state, m) && !state.flow.entering?.charge;

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
  // (Still in a sack as the game ends, he counts as slain.)
  const bilbo = castModel(state, 'bilbo');
  const bilboDead = !!bilbo && (bilbo.dead || sacked(bilbo));
  const trolls = Object.values(state.models).filter(m => m.owner === evil);
  if (trolls.length && trolls.every(m => m.dead)) return bilboDead ? 'draw' : good;
  const company = Object.values(state.models).filter(m => m.owner === good);
  if (company.length && company.every(m => m.dead || sacked(m))) return evil;
  if (state.narrative?.dawn) return 'draw';
  return null;
}
