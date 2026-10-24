import { modelStats, type Catalog } from './catalog.ts';
import { activeSeat } from './flow.ts';
import { distanceBetween, halfExtents } from './geometry.ts';
import { heroicsSettled, mayActivate } from './heroics.ts';
import { engaged, limitMove, moveStart, retrace, RETRACE, spent } from './movement.ts';
import { castModel, seatOf } from './narrative.ts';
import { touching } from './objects.ts';
import { cannotAct, intelligenceWorse } from './powers.ts';
import { APART, BOARD } from './unseenMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// The Unseen Hero (Flies and Spiders, part 1): the scenario's own rules, in our own words. Bilbo, wearing the Ring,
// must find which two of the three webbed bundles hold the Dwarves and cut them free; six Mirkwood Giant Spiders
// blunder about the trees after him.

export const isUnseen = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'the-unseen-hero';
export const isSpider = (m: Pick<Model, 'cast'>) => m.cast === 'spider';

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

export const bilboOf = (state: GameState) => castModel(state, 'bilbo');

/** The webbed bundles, still on the table or not. */
export const bundles = (state: GameState) => Object.values(state.terrain).filter(t => t.object === 'cocoon');

/** The bundle the Evil player chose to hold no Dwarves (the last one, if they never said). */
export function decoyOf(state: GameState): string | undefined {
  const evil = seatOf(state, 'evil');
  const pick = evil ? state.flow.picks?.[evil]?.decoy : undefined;
  return pick && state.terrain[pick]?.object === 'cocoon' ? pick : bundles(state).sort((a, b) => (a.id < b.id ? -1 : 1)).at(-1)?.id;
}

/** How many Dwarves Bilbo has freed so far: the bundles he has cut open that held them. */
export const freed = (state: GameState) => bundles(state).filter(t => t.gone === 'rescued').length;

/** The Power of the Ring: while Bilbo wears it, the Spiders only blunder about after him. */
export function ringPower(state: GameState): boolean {
  if (!isUnseen(state) || !state.flow.started) return false;
  const b = bilboOf(state);
  return alive(b) && !!b.ringOn;
}

/** Bilbo has been charged by a Spider this turn, so the rest pass their tests without rolling. */
export const bilboCharged = (state: GameState) => {
  const b = bilboOf(state);
  return !!b && Object.entries(state.flow.charges ?? {}).some(([id, foe]) => foe === b.id && state.models[id] && isSpider(state.models[id]));
};

/** Whether a Spider must take its Intelligence test now, at the start of its activation under the Power of the Ring. */
export function skitterDue(state: GameState, m: Model): boolean {
  if (!ringPower(state) || !isSpider(m) || !alive(m) || state.phase !== 'move' || state.flow.skitter) return false;
  if (!heroicsSettled(state) || activeSeat(state) !== m.owner || !mayActivate(state, m)) return false;
  return !state.flow.skittered?.includes(m.id) && !state.flow.stopped?.includes(m.id) && !engaged(state, m) && !cannotAct(state, m);
}

/** The Spiders still to take their test this Move phase. */
export const spidersDue = (state: GameState, seat: Seat) => Object.values(state.models).filter(m => m.owner === seat && skitterDue(state, m));

/**
 * The Spider's Intelligence test (2D6, its Intelligence or more) and the D6" it moves. Passed, the Evil player moves it;
 * failed, the Good player does. After a Spider has charged Bilbo this turn, the rest pass without rolling.
 */
export function skitterRequest(state: GameState, catalog: Catalog | null, seat: Seat, id: string, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  const m = state.models[id];
  if (!m || m.owner !== seat || !skitterDue(state, m)) return null;
  const good = seatOf(state, 'good');
  if (!good) return null;
  const sure = bilboCharged(state);
  const need = Math.min(13, (modelStats(catalog, m)?.I ?? 8) + intelligenceWorse(state, m));
  const dice = sure ? [] : [d6(), d6()];
  const pass = sure || dice[0] + dice[1] >= need;
  const dist = d6();
  const by = pass ? seat : good;
  const test: DiceRoll = sure
    ? { id: `r-${uid()}`, by: seat, label: `The Power of the Ring: ${m.name}`.slice(0, 80), dice: [], model: m.id, note: 'Bilbo has been charged this turn: the test is passed.', at: now }
    : { id: `r-${uid()}`, by: seat, label: `Intelligence test: ${m.name} (The Power of the Ring)`.slice(0, 80), dice, sum: need, model: m.id, note: pass ? 'Passed: the Evil player moves it.' : 'Failed: the Good player moves it.', at: now };
  const move: DiceRoll = { id: `r-${uid()}`, by: seat, label: `${m.name} moves D6"`.slice(0, 80), dice: [dist], model: m.id, note: `It must move the full ${dist}", stopping only if it touches Bilbo.`, at: now };
  return [{ type: 'rolled', roll: test }, { type: 'rolled', roll: move }, { type: 'skittering', skitter: { model: m.id, by, dist } }];
}

/** The Spider moving its D6" now, if one is. */
export const skittering = (state: GameState) => (state.flow.skitter ? state.models[state.flow.skitter.model] : undefined);

/** Whether a move by `m` stops on touching `e`: a Spider moving its D6" runs into Bilbo, Invisible or not. */
export const skittersInto = (state: GameState, m: Model, e: Model) => state.flow.skitter?.model === m.id && e.cast === 'bilbo';

/** How much of its D6" the Spider moving now has still to go. */
export function skitterLeft(state: GameState): number {
  const s = state.flow.skitter;
  const m = s && state.models[s.model];
  return s && m ? Math.max(0, s.dist - spent(state, m)) : 0;
}

/**
 * Whether the Spider moving now can't go any further: it touches Bilbo, or every way on from where it stands is blocked
 * (by models, terrain it can't cross, the table's edge, or ground too rough for what it has left), short of going back
 * the way it came.
 */
export function skitterStuck(state: GameState): boolean {
  const m = skittering(state);
  if (!m) return false;
  const b = bilboOf(state);
  if (alive(b) && distanceBetween(m, b) <= 0.05) return true;
  const left = skitterLeft(state);
  const trail = state.flow.paths?.[m.id];
  const start = moveStart(state, m);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    const to = keepOnTable(state, m, { x: m.x + Math.cos(a) * Math.max(left, 0.3), y: m.y + Math.sin(a) * Math.max(left, 0.3) });
    const p = limitMove(state, m, to, left, m.owner, m);
    if (Math.hypot(p.x - m.x, p.y - m.y) > 0.05 && Math.hypot(p.x - start.x, p.y - start.y) > RETRACE && !retrace(trail, p)) return false;
  }
  return true;
}

/** How near the whole D6" a Spider's move must come (a quarter of an inch: no hand on a table measures closer). */
export const SKITTER_SLACK = 0.25;

/** Whether the player moving the Spider may say it's done: it has gone the whole way, or can't go on (a Sentry moving up to half its Move, at Lake-town, any time). */
export const skitterDone = (state: GameState) => !!state.flow.skitter && (!!state.flow.skitter.upTo || skitterLeft(state) <= SKITTER_SLACK || skitterStuck(state));

/** Keeps a Spider moving under the Power of the Ring on the table. */
export function keepOnTable(state: GameState, m: Model, to: { x: number; y: number }) {
  const r = radius(m);
  return { x: Math.min(state.board.w - r, Math.max(r, to.x)), y: Math.min(state.board.h - r, Math.max(r, to.y)) };
}

/** Brave Master Baggins: in a turn Bilbo charges, +1 Fight and +1 Attack. */
export const braveBaggins = (state: GameState, m: Model) => isUnseen(state) && m.cast === 'bilbo' && !!state.flow.charges?.[m.id];

/** Brave Master Baggins: Bilbo's stones are a throwing weapon (Strength 1, 8"), not Throw Stones. */
export const BILBO_STONES = { name: 'Throwing stones', range: 8, s: 1 };
export const bilboStones = (state: GameState, m: Model) => (isUnseen(state) && m.cast === 'bilbo' ? BILBO_STONES : undefined);

/** Before the battle, where a webbed bundle may be put: on the table, clear of the great trunks, 6" from the others. */
export function bundleFits(state: GameState, t: Terrain, p: { x: number; y: number }): boolean {
  const r = t.w / 2;
  if (p.x < r || p.y < r || p.x > BOARD - r || p.y > BOARD - r) return false;
  if (Object.values(state.terrain).some(o => o.look === 'trunk' && Math.hypot(o.x - p.x, o.y - p.y) < o.w / 2 + r)) return false;
  return bundles(state).every(o => o.id === t.id || Math.hypot(o.x - p.x, o.y - p.y) - r - o.w / 2 >= APART - 0.01);
}

/** Caught in a Web: the bundles Bilbo is touching in the End phase, still to be rolled for this turn. */
export function webRollsDue(state: GameState): Terrain[] {
  if (!isUnseen(state) || !state.flow.started || state.phase !== 'end' || state.result || state.narrative?.webbed === state.turn) return [];
  const b = bilboOf(state);
  if (!alive(b)) return [];
  return bundles(state).filter(t => !t.gone && touching(b, t));
}
export const webDue = (state: GameState) => webRollsDue(state).length > 0;

/** Bilbo touching a bundle in the End phase rolls a D6 for it: on a 3+ it is cut open, and its secret revealed. */
export function cutWebs(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const b = bilboOf(state);
  const good = seatOf(state, 'good');
  if (!b || !good) return [];
  const decoy = decoyOf(state);
  const out: Action[] = [];
  const due = webRollsDue(state);
  due.forEach((t, i) => {
    const die = d6();
    const open = die >= 3;
    const dwarves = t.id !== decoy;
    const note = !open ? 'The webs hold.' : dwarves ? 'Bilbo cuts it open: Dwarves, alive!' : 'Bilbo cuts it open: nothing but webs. A decoy.';
    out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: good, label: `Caught in a Web: Bilbo at bundle ${i + 1} of ${due.length} (3+)`.slice(0, 80), dice: [die], target: 3, model: b.id, note, at: now } });
    if (open) out.push({ type: 'updateTerrain', id: t.id, patch: { gone: dwarves ? 'rescued' : 'revealed', hidden: false } });
  });
  out.push({ type: 'narrativeNote', webbed: state.turn });
  return out;
}

/**
 * The battle ends with the turn in which a side does what it came to do. Bilbo wins if he has freed both lots of
 * Dwarves or every Spider is slain; the Spiders win if Bilbo is slain. Both in one turn is a draw.
 */
export function unseenWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil || state.phase !== 'end' || webDue(state)) return null;
  const spiders = Object.values(state.models).filter(m => m.owner === evil && isSpider(m));
  const goodWins = freed(state) >= 2 || (spiders.length > 0 && spiders.every(m => m.dead));
  const evilWins = !alive(bilboOf(state));
  if (goodWins && evilWins) return 'draw';
  return goodWins ? good : evilWins ? evil : null;
}
