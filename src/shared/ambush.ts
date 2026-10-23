import { distanceBetween } from './geometry.ts';
import { castModel, seatOf } from './narrative.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Ambush at Night: the scenario's own rules, in our own words. Éomer's riders fall on the Uruk-hai camp by the eaves of
// Fangorn. The Evil side can't move in the first turn. Merry and Pippin start Prone and bound in the middle: they crawl,
// can't charge, nobody but Grishnákh may charge them, and they and their foes move through each other. Each time the
// Good side finishes its move, each bound Hobbit rolls to cut its bonds. Grishnákh, wounded, crawls 3" after them.

export const isAmbush = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'ambush-at-night';

export const HOBBITS = ['merry', 'pippin'];
export const isHobbit = (m: Pick<Model, 'cast'>) => !!m.cast && HOBBITS.includes(m.cast);
export const isGrishnakh = (m: Pick<Model, 'cast'>) => m.cast === 'grishnakh';

/** How far a bound Hobbit crawls, and Grishnákh. */
export const HOBBIT_CRAWL = 1;
export const GRISHNAKH_CRAWL = 3;

const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;
const touches = (a: Model, b: Model) => Math.abs(a.x - b.x) < 5 && Math.abs(a.y - b.y) < 5 && distanceBetween(a, b) <= 0.2;

// ——— Surprise Attack ———

/** The Evil side may not move at all in the first turn. */
export const surprised = (state: GameState, m: Model) => isAmbush(state) && state.turn === 1 && m.owner === seatOf(state, 'evil');

// ——— Merry, Pippin and Grishnákh ———

/**
 * Whether `m` may charge `e` under the scenario's rules: a bound Hobbit charges nobody, nobody but Grishnákh charges
 * Merry or Pippin, and Grishnákh, crawling after them, charges only them.
 */
export function ambushMayCharge(state: GameState, m: Model, e: Model): boolean {
  if (!isAmbush(state)) return true;
  if (m.bound) return false;
  if (isHobbit(e)) return isGrishnakh(m);
  if (isGrishnakh(m)) return false;
  return true;
}

/**
 * A Hobbit fighting Grishnákh, or Grishnákh fighting a Hobbit, fights as normal though it lies Prone: it strikes if it
 * wins and isn't trapped if it loses.
 */
export function fightsUpright(state: GameState, m: Model): boolean {
  if (!isAmbush(state) || !m.prone || !(isHobbit(m) || isGrishnakh(m))) return false;
  return Object.values(state.models).some(e => e.owner !== m.owner && alive(e) && (isGrishnakh(m) ? isHobbit(e) : isGrishnakh(e)) && touches(m, e));
}

// ——— "Their bonds were cut" ———

/** The bound Hobbits on the table, Merry first. */
export const boundHobbits = (state: GameState): Model[] =>
  HOBBITS.map(k => castModel(state, k)).filter((m): m is Model => !!m && alive(m) && !!m.bound);

/** Whether ending this side's move now must wait for its bound Hobbits to roll (see reducer endActivation). */
export function bondsPending(state: GameState, seat: Seat): boolean {
  return isAmbush(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'good') && !state.narrative?.rolled?.includes(state.turn) && boundHobbits(state).length > 0;
}

/** The Good side has asked to end its move: each bound Hobbit rolls to cut its bonds first. */
export function bondsDue(state: GameState): boolean {
  return isAmbush(state) && !state.result && !!state.flow.bonds && state.flow.bonds === seatOf(state, 'good') && bondsPending(state, state.flow.bonds);
}

/**
 * Each bound Hobbit rolls a D6 and cuts its bonds on a 6, standing free (no longer Prone). One touching the other
 * Hobbit, already free, adds 1, so Merry going free first helps Pippin. Then the Good side's move is over.
 */
export function rollBonds(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'good')!;
  const out: Action[] = [];
  const free = new Set(HOBBITS.map(k => castModel(state, k)).filter(m => m && alive(m) && !m.bound).map(m => m!.id));
  for (const m of boundHobbits(state)) {
    const friend = HOBBITS.map(k => castModel(state, k)).find(o => o && o.id !== m.id && alive(o) && free.has(o.id) && touches(m, o));
    // (The +1 for the free friend beside him: a 5 will do.)
    const need = friend ? 5 : 6;
    const die = d6();
    const cut = die >= need;
    const roll: DiceRoll = {
      id: `n-${uid()}`,
      by: seat,
      label: `${m.name} tries to cut his bonds: ${friend ? `a 5+ with ${friend.name} beside him` : 'a 6'}`.slice(0, 80),
      dice: [die],
      target: need,
      model: m.id,
      note: cut ? 'Free! He gets to his feet.' : 'Still bound.',
      at: now,
    };
    out.push({ type: 'rolled', roll });
    if (cut) {
      free.add(m.id);
      out.push({ type: 'affect', id: m.id, patch: { bound: false, crawls: 0, prone: false } });
    }
  }
  out.push({ type: 'narrativeNote', rolled: state.turn }, { type: 'endActivation', seat });
  return out;
}

// ——— Who wins ———

/** How many of a side started the battle, and how many are left (a Hobbit that got away still counts). */
function strength(state: GameState, seat: Seat) {
  const all = Object.values(state.models).filter(m => m.owner === seat);
  return { start: all.length, left: all.filter(m => !m.dead).length };
}

/** Whether a side is down to a quarter of the models it started with. */
export const quartered = (state: GameState, seat: Seat) => {
  const s = strength(state, seat);
  return s.start > 0 && s.left <= s.start / 4;
};

/** Merry and Pippin have both left the table, alive or not. */
export const hobbitsGone = (state: GameState) => HOBBITS.map(k => castModel(state, k)).every(m => !m || m.dead || m.escaped);

/**
 * The battle ends at the end of a turn in which one side is down to a quarter and both Hobbits are off the table.
 * Good wins if the Evil side is the one down to a quarter, Evil if the Good side is, and both at once is a draw. With
 * Merry or Pippin slain, the Good side can do no better than a draw. Once the whole Evil side is slain nothing can
 * stop the Hobbits, so that ends it at once too.
 */
export function ambushWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const hobbitSlain = HOBBITS.some(k => castModel(state, k)?.dead);
  const goodWins = () => (hobbitSlain ? 'draw' : good);
  if (!strength(state, good).left) return evil;
  if (!strength(state, evil).left) return goodWins();
  if (state.phase !== 'end' || !hobbitsGone(state)) return null;
  const g = quartered(state, good);
  const e = quartered(state, evil);
  if (g && e) return 'draw';
  if (e) return goodWins();
  if (g) return evil;
  return null;
}
