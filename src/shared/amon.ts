import { BOARD } from './amonMap.ts';
import type { Point } from './geometry.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import { carriedBy, touching } from './objects.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// Amon Hen: the scenario's own rules, in our own words. The Fellowship is scattered through the woods round the Seeing
// Seat, and the Uruk-hai have orders to take the Halflings alive. A Hobbit brought down is knocked out instead of slain,
// and the Uruk-hai can carry him off the table; Frodo must reach the boats on the Anduin. Every Scout slain may come
// back from the north, south or east edge.

export const isAmon = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'amon-hen';

const HOBBITS = ['frodo', 'sam', 'merry', 'pippin'];
export const isHalfling = (m: Pick<Model, 'cast'>) => !!m.cast && HOBBITS.includes(m.cast);
const isScout = (m: Pick<Model, 'cast'>) => m.cast === 'scout';
const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;

// ——— "Find the Halflings!" ———

/** The marker a knocked-out Hobbit lies as, while he is out (it is carried like a Heavy Object). */
export const koId = (m: Pick<Model, 'id'>) => `ko-${m.id}`;
export const koMarker = (state: GameState, m: Pick<Model, 'id'>): Terrain | undefined => state.terrain[koId(m)];
/** Knocked out and still on the table (lying where he fell, or being carried off). */
export const knockedOut = (state: GameState, m: Pick<Model, 'id'>) => {
  const t = koMarker(state, m);
  return !!t && !t.gone;
};
/** Carried off the table by the Uruk-hai. */
export const captured = (state: GameState, m: Pick<Model, 'id'>) => koMarker(state, m)?.gone === 'off';
export const capturedHobbits = (state: GameState) => Object.values(state.models).filter(m => isHalfling(m) && captured(state, m));

/** Where a Hobbit comes round: where he lies, or beside whoever is carrying him, at the nearest clear spot. */
function comeRoundSpot(state: GameState, h: Model, t: Terrain): Point {
  const r = radius(h);
  const others = Object.values(state.models).filter(o => o.id !== h.id && alive(o));
  const clear = (p: Point) => p.x >= r && p.y >= r && p.x <= state.board.w - r && p.y <= state.board.h - r && others.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= radius(o) + r + 0.02);
  if (clear(t)) return { x: t.x, y: t.y };
  for (let d = 0.2; d <= 6; d += 0.2) {
    for (let a = 0; a < 24; a++) {
      const p = { x: t.x + Math.cos((a * Math.PI) / 12) * d, y: t.y + Math.sin((a * Math.PI) / 12) * d };
      if (clear(p)) return p;
    }
  }
  return { x: t.x, y: t.y };
}

/** Brings knocked-out Hobbits round: back on the table where they lay, Prone. */
export function reviveHobbits(state: GameState, ids: string[]): GameState {
  let next = state;
  for (const id of ids) {
    const h = next.models[id];
    const t = h && koMarker(next, h);
    if (!h || !t || t.gone) continue;
    const at = comeRoundSpot(next, h, t);
    const { waiting: _w, ...rest } = h;
    const { [t.id]: _t, ...terrain } = next.terrain;
    next = { ...next, terrain, models: { ...next.models, [h.id]: { ...rest, ...at, prone: true } } };
  }
  return next;
}

/** The knocked-out Hobbits a Good model is touching. */
export const revivable = (state: GameState): Model[] => {
  const good = seatOf(state, 'good');
  return Object.values(state.models).filter(h => {
    const t = isHalfling(h) && knockedOut(state, h) ? koMarker(state, h)! : undefined;
    return !!t && Object.values(state.models).some(f => f.owner === good && f.id !== h.id && alive(f) && touching(f, t));
  });
};

/**
 * The scenario's hold on the game, after every action: a Hobbit that suffers his final Wound is knocked out instead of
 * slain (he lies as a marker the Uruk-hai can carry), and as the Good side finishes its move a friend touching him
 * brings him round.
 */
export function findTheHalflings(before: GameState, state: GameState): GameState {
  if (!isAmon(state) || !state.flow.started) return state;
  let next = state;
  for (const h of Object.values(state.models)) {
    if (!isHalfling(h) || !h.dead || before.models[h.id]?.dead !== false) continue;
    const { dead: _d, killedBy: _k, pending: _p, effects: _e, ...rest } = h;
    const t: Terrain = { id: koId(h), kind: 'objective', object: 'hobbit', who: h.id, side: h.owner, shape: 'circle', x: h.x, y: h.y, w: 2 * radius(h), h: 2 * radius(h), rot: 0, locked: true };
    next = { ...next, models: { ...next.models, [h.id]: { ...rest, dead: false, waiting: true, wounds: 1, prone: false } }, terrain: { ...next.terrain, [t.id]: t } };
  }
  const good = seatOf(state, 'good');
  if (good && !before.flow.done.includes(good) && state.flow.done.includes(good) && state.phase === 'move') next = reviveHobbits(next, revivable(next).map(h => h.id));
  return next;
}

/** Whether a Good model may pick up a Hobbit's marker: never; an Evil one may, if it isn't carrying one already. */
export const mayCarryHobbit = (state: GameState, m: Model, t: Terrain) => t.side !== m.owner && !carriedBy(state, m).some(c => c.object === 'hobbit');

/** Knocked-out Hobbits roll to come round in the End phase, as a Paralysed model does: a 6. */
export const wakeDue = (state: GameState) =>
  isAmon(state) && state.flow.started && state.phase === 'end' && !state.result && state.narrative?.woke !== state.turn && Object.values(state.models).some(h => isHalfling(h) && knockedOut(state, h));

export function wakeUp(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  const up: string[] = [];
  for (const h of Object.values(state.models).filter(h => isHalfling(h) && knockedOut(state, h))) {
    const die = d6();
    if (die === 6) up.push(h.id);
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: h.owner, label: `${h.name} comes round (6)`, dice: [die], target: 6, model: h.id, note: die === 6 ? `${h.name} comes round, Prone.` : 'Still out cold.', at: now } });
  }
  out.push({ type: 'narrativeNote', woke: state.turn, ...(up.length ? { revive: up } : {}) });
  return out;
}

// ——— Getting away ———

/** The boats: Frodo touching them can get away down the river. */
export const boats = (state: GameState) => Object.values(state.terrain).find(t => t.object === 'boat' && !t.gone);
export const atBoats = (state: GameState, m: Model) => {
  const b = boats(state);
  return isAmon(state) && m.cast === 'frodo' && alive(m) && !!b && touching(m, b);
};

/** An Uruk-hai carrying a Hobbit off the table goes by the north, south or east edge (not into the Anduin). */
export const carriesHobbit = (state: GameState, m: Model) => isAmon(state) && carriedBy(state, m).some(t => t.object === 'hobbit');

// ——— The Legions of Isengard ———

/** The Scouts slain so far, or that rolled to come back and are still waiting for room. */
export const fallenScouts = (state: GameState): Model[] => Object.values(state.models).filter(m => isScout(m) && !m.escaped && (m.dead || m.waiting));

/** Whether ending the Evil side's move now must wait for the Legions of Isengard (see reducer endActivation). */
export function legionsPending(state: GameState, seat: Seat): boolean {
  return isAmon(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'evil') && state.flow.entering?.turn !== state.turn && fallenScouts(state).length > 0;
}

export const legionsDue = (state: GameState) => isAmon(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'evil') && legionsPending(state, state.flow.reinforce);

/**
 * Where the Scouts come on: the point on the north, south or east edge nearest Frodo, or where he lies; with him being
 * carried off already, nearest another Hobbit still standing, or else the nearest of the Fellowship.
 */
export function legionsPoint(state: GameState): [number, number] {
  const frodo = castModel(state, 'frodo');
  const t = frodo && koMarker(state, frodo);
  const good = Object.values(state.models).filter(m => m.owner === seatOf(state, 'good') && alive(m));
  const at = (t && !t.gone && !t.carrier ? t : undefined) ?? (frodo && alive(frodo) ? frodo : undefined) ?? good.find(isHalfling) ?? good[0] ?? { x: BOARD / 2, y: BOARD / 2 };
  const { w, h } = state.board;
  const options: [number, number, number][] = [
    [at.x, 0, at.y],
    [at.x, h, h - at.y],
    [w, at.y, w - at.x],
  ];
  const [x, y] = options.sort((a, b) => a[2] - b[2])[0];
  return [Math.max(4, Math.min(w, x)), y];
}

/** A D6 for each Scout slain: on a 4+ it comes back on; any still waiting for room from before come on too. */
export function legionsArrive(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'evil')!;
  const slain = fallenScouts(state).filter(m => m.dead);
  const already = fallenScouts(state).filter(m => !m.dead);
  const dice = slain.map(() => d6());
  const coming = [...already, ...slain.filter((_, i) => dice[i] >= 4)];
  const from = legionsPoint(state);
  const edge = from[1] <= 0 ? 'north' : from[1] >= state.board.h ? 'south' : 'east';
  const out: Action[] = [];
  if (slain.length) {
    const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: 'The Legions of Isengard: a 4+ for each Scout slain', dice, target: 4, note: coming.length ? `${coming.length} Scout${coming.length === 1 ? '' : 's'} come${coming.length === 1 ? 's' : ''} on from the ${edge} edge.` : 'None come back this turn.', at: now };
    out.push({ type: 'rolled', roll });
  }
  for (const m of coming) out.push({ type: 'affect', id: m.id, patch: { dead: false, waiting: true, wounds: m.maxWounds, prone: false } });
  out.push({ type: 'entering', seat, ids: coming.map(m => m.id), from });
  return out;
}

// ——— Who wins ———

/**
 * The game lasts until Frodo leaves the table. Getting away in the boats wins it for the Good side, unless two of the
 * other Hobbits have been carried off, which lets the Evil side claim a draw; Frodo carried off wins it for the Evil side.
 */
export function amonWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  const frodo = castModel(state, 'frodo');
  if (!good || !evil || !frodo) return null;
  if (captured(state, frodo)) return evil;
  if (frodo.escaped) return capturedHobbits(state).length >= 2 ? 'draw' : good;
  return null;
}
