import type { Catalog } from './catalog.ts';
import { courageOf } from './courage.ts';
import { distanceBetween, type Point } from './geometry.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import { DOOM, GATE, GATEWAY, MIDDLE, PRECIPICE_REACH, STAND_REACH, walkwayPiece } from './doomMap.ts';
import { mordorOrc } from './osgiliath.ts';
import { inChasm, insidePolygon, outline } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// The End of All Things (The Return of the King): the scenario's own rules, in our own words. On the slopes of Mount
// Doom Frodo and Sam climb to the Crack of Doom, the Ring fighting Frodo every step of the way, while at the Black
// Gate the Captains of the West stand on their hill against the endless host of Mordor to draw the Eye away.

export const DOOM_ID = 'the-end-of-all-things';
export const isDoom = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === DOOM_ID;

/** Frodo starts with this many Resistant Points: at none, the Ring has him. */
export const RESIST = 6;
/** The Power of the Ring: what the Evil player needs on a D6 to use each power. */
export const POWERS = { exhaustion: 3, corruption: 4, lure: 5 } as const;
export type RingPower = keyof typeof POWERS;
export const POWER_NAMES: Record<RingPower, string> = { exhaustion: 'Exhaustion', corruption: 'Corruption', lure: 'Lure of the Ring' };
/** The battle of wills: a side that wins this many roll-offs in a row has its way. */
export const WILLS_RUN = 3;

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
const frodoOf = (state: GameState) => castModel(state, 'frodo');
const gollumOf = (state: GameState) => castModel(state, 'gollum');

/** Whether a point is on the Black Gate's table (rather than the Crack of Doom's). */
export const atGate = (p: Point) => p.x >= GATE.x;
/** Whether a point is on the Crack of Doom's table. */
export const atDoom = (p: Point) => p.x <= DOOM.x + DOOM.size && p.y >= DOOM.y && p.y <= DOOM.y + DOOM.size;

/** A line for the log, from rules the game applies by itself. */
const note = (by: Seat, label: string, text: string, uid: () => string, now: number, model?: string, extra: Partial<DiceRoll> = {}): DiceRoll => ({ id: `n-${uid()}`, by, label, dice: [], note: text, at: now, ...(model ? { model } : {}), ...extra });

// ——— Who wins ———

/**
 * The battle lasts until the Ring is destroyed, Frodo is taken over by it, or Frodo is slain. The Good side wins if
 * the Ring is destroyed; but with every Good hero at the Black Gate slain, the best it can get is a draw. The Evil
 * side wins if Frodo is slain or taken over.
 */
export function doomWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const n = state.narrative!;
  const frodo = frodoOf(state);
  if (n.ring === 'corrupted' || n.resist === 0 || !frodo || frodo.dead) return evil;
  if (n.ring !== 'destroyed') return null;
  const heroes = Object.values(state.models).filter(m => m.owner === good && m.hero && m.cast !== 'frodo' && m.cast !== 'sam');
  return heroes.length && heroes.every(m => m.dead) ? 'draw' : good;
}

/** For the scoreboard: Frodo's Resistant Points, and how the battle of wills stands. */
export function doomNote(state: GameState): string {
  const n = state.narrative;
  const left = n?.resist ?? RESIST;
  const w = n?.wills;
  return `Frodo: ${left} of ${RESIST} Resistant Points${w ? ` · battle of wills: ${w.g ? `Frodo ${w.g} in a row` : w.e ? `the Ring ${w.e} in a row` : 'level'}` : ''}`;
}

// ——— "Not here, not so close to the Eye!" ———

/** Frodo may not put the Ring on in this scenario. */
export const ringForbidden = (state: Pick<GameState, 'narrative'>) => isDoom(state);

// ——— The Power of the Ring ———

/** Frodo's Resistant Points left. */
export const resistLeft = (state: GameState) => state.narrative?.resist ?? RESIST;

/** The powers the Evil player may try this turn: Lure of the Ring only while Gollum lives. */
export function ringPowers(state: GameState): RingPower[] {
  const gollum = gollumOf(state);
  return (Object.keys(POWERS) as RingPower[]).filter(p => p !== 'lure' || (!!gollum && !gollum.dead));
}

/**
 * As each turn starts, before Priority is rolled, the Evil player may try one of the Ring's powers on Frodo (or none):
 * the roll for Priority waits until they have.
 */
export function ringPowerDue(state: GameState): boolean {
  if (!isDoom(state) || !state.flow.started || state.result || state.phase !== 'priority' || state.narrative?.power === state.turn) return false;
  if (state.flow.chooserTurn === state.turn && state.flow.chooser) return false;
  return alive(frodoOf(state));
}

/** Where Gollum leaps out at Frodo: touching him, on ground that will hold him and clear of everyone else. */
export function lureSpot(state: GameState, gollum: Model): Point | undefined {
  const frodo = frodoOf(state);
  if (!alive(frodo)) return undefined;
  const reach = radius(frodo) + radius(gollum) + 0.02;
  const others = Object.values(state.models).filter(o => alive(o) && o.id !== gollum.id && o.id !== frodo.id);
  // (From behind him, as he climbs: the side away from the precipice first.)
  const tip = precipicePoint();
  const away = Math.atan2(frodo.y - tip.y, frodo.x - tip.x);
  for (let k = 0; k < 72; k++) {
    const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((5 * Math.PI) / 180);
    const p = { x: frodo.x + Math.cos(a) * reach, y: frodo.y + Math.sin(a) * reach };
    if (!atDoom(p) || inChasm(state, p) || p.x < DOOM.x + radius(gollum) || p.y > DOOM.y + DOOM.size - radius(gollum) || p.y < DOOM.y + radius(gollum)) continue;
    if (others.some(o => Math.hypot(o.x - p.x, o.y - p.y) < radius(o) + radius(gollum) - 0.01)) continue;
    return p;
  }
  return undefined;
}

/**
 * The Evil player tries one of the Ring's powers (none: not this turn): a D6, needing the power's score or more.
 *  - Exhaustion: this turn Frodo takes a Courage test for each inch he moves, and collapses Prone at the first he fails.
 *  - Corruption: another D6; if it equals or beats Frodo's Resistant Points he loses one, and at none the Ring has him.
 *  - Lure of the Ring: Gollum leaps out, touching Frodo, to fight him this turn; then he slinks off again.
 * Null if that can't be done now.
 */
export function ringPower(state: GameState, seat: Seat, power: RingPower | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  if (!ringPowerDue(state) || seat !== seatOf(state, 'evil')) return null;
  if (!power) return [{ type: 'rolled', roll: note(seat, 'The Power of the Ring', 'The Ring bides its time this turn.', uid, now) }, { type: 'narrativeNote', power: state.turn }];
  if (!ringPowers(state).includes(power)) return null;
  const frodo = frodoOf(state)!;
  const need = POWERS[power];
  const die = d6();
  const works = die >= need;
  const name = POWER_NAMES[power];
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: `The Power of the Ring: ${name} (${need}+)`, dice: [die], target: need, model: frodo.id, at: now, note: works ? '' : 'The power fails to take hold this turn.' };
  const out: Action[] = [{ type: 'rolled', roll }];
  if (!works) return [...out, { type: 'narrativeNote', power: state.turn }];
  if (power === 'exhaustion') {
    roll.note = `This turn ${frodo.name} must take a Courage test for each inch he moves, and collapses Prone at the first he fails. Sam may carry him.`;
    return [...out, { type: 'narrativeNote', power: state.turn, exhaust: state.turn, strides: 0 }];
  }
  if (power === 'corruption') {
    const left = resistLeft(state);
    const d = d6();
    const loses = d >= left;
    roll.note = 'The Ring reaches for his mind.';
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: `Corruption: a ${left}+ takes one of ${frodo.name}'s ${left} Resistant Points`.slice(0, 80), dice: [d], target: left, model: frodo.id, at: now, note: loses ? (left - 1 ? `${frodo.name} has ${left - 1} Resistant Point${left - 1 === 1 ? '' : 's'} left.` : `${frodo.name} has nothing left to resist with: the Ring takes him.`) : `${frodo.name} holds out.` } });
    return [...out, { type: 'narrativeNote', power: state.turn, ...(loses ? { resist: left - 1 } : {}) }];
  }
  // Lure of the Ring: Gollum, touching Frodo, to fight him in the Fight phase.
  const gollum = gollumOf(state)!;
  const spot = lureSpot(state, gollum);
  if (!spot) {
    roll.note = 'Gollum finds no way at Frodo this turn.';
    return [...out, { type: 'narrativeNote', power: state.turn }];
  }
  roll.note = 'Gollum leaps out of hiding at the Ringbearer. They fight this turn, and then he slinks off again.';
  const facing = Math.round((Math.atan2(frodo.x - spot.x, spot.y - frodo.y) * 180) / Math.PI + 360) % 360;
  return [...out, { type: 'arrive', seat, moves: [{ id: gollum.id, x: +spot.x.toFixed(3), y: +spot.y.toFixed(3), rot: facing }] }, { type: 'narrativeNote', power: state.turn, lured: state.turn }];
}

/** Gollum fights in the Fight phase, then slinks back into hiding: as the End phase begins, he leaves the table. */
export const gollumHides = (state: GameState) => isDoom(state) && state.flow.started && !state.result && state.phase === 'end' && alive(gollumOf(state));

export function hideGollum(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const g = gollumOf(state)!;
  return [
    { type: 'rolled', roll: note(g.owner, 'Lure of the Ring', `${g.name} slinks back into hiding.`, uid, now, g.id) },
    { type: 'affect', id: g.id, patch: { waiting: true, x: -24, y: -24, prone: false, effects: undefined } },
  ];
}

// ——— Exhaustion ———

/** Whether Exhaustion has Frodo this turn. */
export const exhausted = (state: GameState) => isDoom(state) && state.flow.started && state.narrative?.exhaust === state.turn;
/** Whether he has collapsed this turn, failing a Courage test. */
export const collapsed = (state: GameState) => exhausted(state) && state.narrative?.collapsed === state.turn;

/** Frodo's Move this turn under Exhaustion: an inch for each Courage test passed (none more once he collapses). */
export function strideAllowance(state: GameState, m: Model): number | undefined {
  if (m.cast !== 'frodo' || !exhausted(state)) return undefined;
  return state.narrative?.strides ?? 0;
}

export const STRIDE_LABEL = 'Courage test (Exhaustion)';

/** Whether Frodo may test for another inch now: in his move, not collapsed, not carried, with Move still to spend. */
export function mayStride(state: GameState, m: Model | undefined, normal: number): boolean {
  if (!m || m.cast !== 'frodo' || !alive(m) || m.aboard || !exhausted(state) || collapsed(state) || state.phase !== 'move') return false;
  return (state.narrative?.strides ?? 0) < Math.floor(normal + 1e-6);
}

/**
 * Frodo struggles on another inch: a Courage test. Passed, he may move an inch more this turn; failed, he collapses
 * Prone and goes no further. (He may spend Will on it, as on any Courage test: see strideAfterWill.)
 */
export function stride(state: GameState, catalog: Catalog | null, m: Model, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const sum = courageOf(state, catalog, m);
  const dice = [d6(), d6()];
  const pass = dice[0] + dice[1] >= sum;
  const n = state.narrative?.strides ?? 0;
  const roll: DiceRoll = { id: `c-${uid()}`, by: m.owner, label: `${STRIDE_LABEL}: ${m.name}, inch ${n + 1}`.slice(0, 80), dice, sum, model: m.id, at: now, note: pass ? `${m.name} struggles on another inch.` : `${m.name} collapses, Prone.` };
  return [{ type: 'rolled', roll }, ...(pass ? [{ type: 'narrativeNote', strides: n + 1 } as Action] : [{ type: 'affect', id: m.id, patch: { prone: true } } as Action, { type: 'narrativeNote', collapsed: state.turn } as Action])];
}

/** After Will raised a failed Exhaustion test into a pass: Frodo is up again, and has his inch. */
export function strideAfterWill(state: GameState, roll: DiceRoll): GameState {
  if (!isDoom(state) || !roll.label.startsWith(STRIDE_LABEL) || !collapsed(state) || roll.dice[0] + roll.dice[1] < (roll.sum ?? 13)) return state;
  // (Only the test he failed last, this turn.)
  const last = [...state.log].reverse().find(r => r.label.startsWith(STRIDE_LABEL));
  const m = roll.model ? state.models[roll.model] : undefined;
  if (!m || last?.id !== roll.id) return state;
  const { collapsed: _, ...ns } = state.narrative!;
  return { ...state, models: { ...state.models, [m.id]: { ...m, prone: undefined } }, narrative: { ...ns, strides: (ns.strides ?? 0) + 1 }, log: state.log.map(r => (r.id === roll.id ? { ...r, note: `${m.name} struggles on another inch.` } : r)) };
}

// ——— Sam carries Frodo ———

/** The model Frodo is being carried by, if Sam has him. */
export const carrierOf = (state: GameState) => {
  const f = frodoOf(state);
  return f?.aboard ? state.models[f.aboard] : undefined;
};

/** Whether Sam carries Frodo now: his Move is halved, as for a Heavy Object. */
export const carryingFrodo = (state: GameState, m: Model) => isDoom(state) && m.cast === 'sam' && frodoOf(state)?.aboard === m.id;

/**
 * Whether Sam may pick Frodo up now: in a turn Exhaustion has him, in the Move phase, touching him, neither of them in
 * a fight. (Why not, if not: a reason for the card.)
 */
export function carryBlocked(state: GameState, sam: Model, engaged: (m: Model) => boolean): string | null {
  const frodo = frodoOf(state);
  if (!isDoom(state) || sam.cast !== 'sam' || !alive(sam) || !alive(frodo) || frodo.aboard) return 'no';
  if (!exhausted(state)) return 'Only in a turn the Ring has Frodo exhausted';
  if (state.phase !== 'move') return 'Only in the Move phase';
  if (distanceBetween(sam, frodo) > 0.2) return 'Sam must be touching Frodo';
  if (engaged(sam) || engaged(frodo)) return 'Not while either of them is in a fight';
  return null;
}

/** Where Sam puts Frodo down: touching him, on firm ground clear of everyone, as near the precipice as it can be. */
export function setDownSpot(state: GameState, sam: Model, frodo: Model): Point | undefined {
  const reach = radius(sam) + radius(frodo) + 0.02;
  const tip = precipicePoint();
  const toward = Math.atan2(tip.y - sam.y, tip.x - sam.x);
  const others = Object.values(state.models).filter(o => alive(o) && o.id !== sam.id && o.id !== frodo.id);
  for (let k = 0; k < 72; k++) {
    const a = toward + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((5 * Math.PI) / 180);
    const p = { x: sam.x + Math.cos(a) * reach, y: sam.y + Math.sin(a) * reach };
    if (!atDoom(p) || inChasm(state, p) || p.x < DOOM.x + radius(frodo) || p.y < DOOM.y + radius(frodo) || p.y > DOOM.y + DOOM.size - radius(frodo)) continue;
    if (others.some(o => Math.hypot(o.x - p.x, o.y - p.y) < radius(o) + radius(frodo) - 0.01)) continue;
    return p;
  }
  return undefined;
}

/** As the End phase begins (or if Sam falls), Sam puts Frodo down. */
export const setDownDue = (state: GameState) => {
  if (!isDoom(state) || !state.flow.started) return false;
  const f = frodoOf(state);
  if (!f?.aboard || f.dead) return false;
  const sam = state.models[f.aboard];
  return state.phase === 'end' || !sam || sam.dead;
};

// ——— Destroying the Ring ———

/** The end of the walkway, over the fire. */
export function precipicePoint(): Point {
  const w = walkwayPiece();
  const a = (w.rot * Math.PI) / 180;
  return { x: w.x + (Math.cos(a) * w.w) / 2, y: w.y + (Math.sin(a) * w.w) / 2 };
}

/**
 * Whether a model stands at the edge of the precipice: on the walkway, its base touching the walkway's edge within
 * 1.5" of its end (the end itself, or either side there).
 */
export function atPrecipice(state: GameState, m: Model): boolean {
  const w = state.terrain['n-walkway'];
  if (!w || !alive(m) || m.aboard) return false;
  const poly = outline(w);
  if (!insidePolygon(poly, m)) return false;
  // (How far along the walkway it stands, from the door.)
  const a = (w.rot * Math.PI) / 180;
  const u = (m.x - w.x) * Math.cos(a) + (m.y - w.y) * Math.sin(a) + w.w / 2;
  const r = radius(m) + 0.06;
  if (w.w - u > PRECIPICE_REACH) return false;
  return poly.some((q, j) => segmentGap(m, poly[(j || poly.length) - 1], q) <= r);
}

/** How far a point is from a line segment. */
function segmentGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The battle of wills is under way, or due: Frodo stands at the edge of the precipice, and nothing is settled yet. */
export function willsDue(state: GameState): boolean {
  if (!isDoom(state) || !state.flow.started || state.result || state.narrative?.ring) return false;
  const f = frodoOf(state);
  return !!f && atPrecipice(state, f);
}

/** The roll-off Frodo lost, which he may still turn with Might: the Good player's call before the battle goes on. */
export const willsOpen = (state: GameState) => state.narrative?.wills?.open;

/**
 * One roll-off in the battle of wills: both players roll a D6, ties rolled again. A side that wins three in a row has
 * its way: the Ring goes into the fire, or it takes Frodo. Frodo may spend Might on his die: when he loses a roll by
 * no more than his Might allows, the game waits for the Good player to spend it (`might`: how much) or let it stand.
 */
export function willsRoll(state: GameState, seat: Seat, might: number | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  if (!willsDue(state) || seat !== seatOf(state, 'good')) return null;
  const frodo = frodoOf(state)!;
  const w = state.narrative?.wills ?? { g: 0, e: 0 };
  const out: Action[] = [];
  const settle = (goodWins: boolean, dice: [number, number], spent = 0): Action[] => {
    const g = goodWins ? w.g + 1 : 0;
    const e = goodWins ? 0 : w.e + 1;
    const done = g >= WILLS_RUN ? 'destroyed' : e >= WILLS_RUN ? 'corrupted' : undefined;
    const text = done === 'destroyed' ? 'Three in a row: Frodo casts the Ring into the fire, and it is destroyed!' : done === 'corrupted' ? 'Three in a row: the Ring has Frodo. He claims it for his own.' : goodWins ? `Frodo wins it${spent ? `, spending ${spent} Might` : ''} (${g} in a row).` : `The Ring wins it (${e} in a row).`;
    return [
      ...(spent ? [{ type: 'affect', id: frodo.id, patch: { might: frodo.might - spent } } as Action] : []),
      { type: 'rolled', roll: note(seat, 'The battle of wills', text, uid, now, frodo.id, { dice }) },
      { type: 'narrativeNote', wills: { g, e }, ...(done ? { ring: done } : {}) },
    ];
  };
  if (w.open) {
    // Frodo lost the last roll: spend enough Might to win it, or let it stand.
    const [gd, ed] = w.open;
    const need = ed - gd + 1;
    if (!might) return settle(false, w.open);
    if (might < need || might > frodo.might || gd + might > 6) return null;
    return settle(true, w.open, might);
  }
  let dice: [number, number];
  do dice = [d6(), d6()];
  while (dice[0] === dice[1]);
  if (dice[0] > dice[1]) return settle(true, dice);
  const need = dice[1] - dice[0] + 1;
  if (frodo.might >= need && dice[0] + need <= 6) {
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: 'The battle of wills', dice, model: frodo.id, at: now, note: `The Ring wins this roll, ${dice[1]} to ${dice[0]}: ${frodo.name} can spend ${need} Might to win it instead.` } });
    out.push({ type: 'narrativeNote', wills: { ...w, open: dice } });
    return out;
  }
  return settle(false, dice);
}

// ——— Teeming Hordes ———

/** The Mordor Orcs slain so far, kept aside to come back. */
export const slainOrcs = (state: GameState, catalog: Catalog | null | undefined): Model[] => Object.values(state.models).filter(m => m.owner === seatOf(state, 'evil') && m.dead && (m.cast === 'orc' || m.cast === 'captain' || mordorOrc(catalog, m)) && m.cast !== 'gollum');

/** Whether ending the Evil side's move must wait for the slain Orcs to come back through the Gate (see reducer endActivation). */
export function hordePending(state: GameState, seat: Seat): boolean {
  return isDoom(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'evil') && state.flow.entering?.turn !== state.turn && state.narrative?.horde !== state.turn && Object.values(state.models).some(m => m.owner === seat && m.dead && (m.cast === 'orc' || m.cast === 'captain'));
}

export const hordeDue = (state: GameState) => isDoom(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'evil') && hordePending(state, state.flow.reinforce);

/** Teeming Hordes: as the Evil side's move ends, every Orc slain so far moves back on through the Black Gate. */
export function hordeArrives(state: GameState, catalog: Catalog | null | undefined, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'evil')!;
  const coming = slainOrcs(state, catalog);
  const out: Action[] = [{ type: 'rolled', roll: note(seat, 'Teeming Hordes', `${coming.length} Orc${coming.length === 1 ? '' : 's'} pour${coming.length === 1 ? 's' : ''} out of the Black Gate.`, uid, now) }, { type: 'narrativeNote', horde: state.turn }];
  for (const g of coming) out.push({ type: 'affect', id: g.id, patch: { dead: false, waiting: true, wounds: g.maxWounds, prone: false, effects: [] } });
  // (They come on through the gateway, between the two towers, from the east edge.)
  out.push({ type: 'entering', seat, ids: coming.map(g => g.id), from: [state.board.w, (GATEWAY[0] + GATEWAY[1]) / 2], span: [GATEWAY[0] + 0.05, GATEWAY[1] - 0.05] });
  return out;
}

// ——— "Stand Your Ground!" ———

/** Whether a model must keep within 12" of the middle of the Black Gate's table: any Good model there. */
export const standsGround = (state: GameState, m: Model) => isDoom(state) && m.owner === seatOf(state, 'good') && atGate(m);

/** How far a model's base is from the middle of the Black Gate's table. */
export const fromMiddle = (m: Model, p: Point = m) => Math.max(0, Math.hypot(p.x - MIDDLE.x, p.y - MIDDLE.y) - radius(m));

/**
 * Where a willing move from `here` to `to` ends for a Good model at the Black Gate: no more than 12" from the middle
 * (one already further out, pushed there, may come back in but not go further out).
 */
export function holdGround(m: Model, here: Point, to: Point): Point {
  const ok = (p: Point) => fromMiddle(m, p) <= STAND_REACH + 1e-6;
  if (ok(to) || fromMiddle(m, to) <= fromMiddle(m, here) + 1e-6) return to;
  for (let i = 1; i <= 50; i++) {
    const f = 1 - i / 50;
    const p = { x: here.x + (to.x - here.x) * f, y: here.y + (to.y - here.y) * f };
    if (ok(p)) return p;
  }
  return here;
}

/** Sam puts Frodo down (see setDownDue). */
export const setDown = (): Action[] => [{ type: 'carryFrodo', carry: false }];
