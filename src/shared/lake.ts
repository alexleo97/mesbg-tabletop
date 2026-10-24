import { activeSeat } from './flow.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { heroicsSettled, mayActivate } from './heroics.ts';
import { engaged, limitMove, moveLeft } from './movement.ts';
import { castModel, seatOf } from './narrative.ts';
import { cannotAct } from './powers.ts';
import { sightTo } from './sight.ts';
import { SECTION_WIDTH, SECTIONS, type Section } from './lakeMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Lake-town Escape: the scenario's own rules, in our own words. The Orcs who attacked Bard's House creep back through
// Lake-town, most of them unaware of Legolas, who means to cut down every one; Bolg wants a fight with him before he
// leaves.

export const isLake = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'lake-town-escape';

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

export const legolasOf = (state: GameState) => castModel(state, 'legolas');
export const bolgOf = (state: GameState) => castModel(state, 'bolg');

// ——— Silent Assassins ———

/** The section an Orc set up in: its group's, Bolg with section A's, Fimbul with C's. */
export function sectionOf(m: Pick<Model, 'cast'>): Section | undefined {
  if (m.cast === 'bolg') return 'A';
  if (m.cast === 'fimbul') return 'C';
  const s = m.cast?.match(/^orc-([abcd])$/)?.[1]?.toUpperCase();
  return s ? (s as Section) : undefined;
}

/** Whether a section's Orcs know Legolas is about: section D's always do; the rest once the alarm is raised there. */
export const aware = (state: GameState, s: Section) => s === 'D' || !!state.narrative?.alarm?.includes(s);

/** Whether a model is still acting as a Sentry: an Orc of a section where the alarm hasn't been raised. */
export function isSentry(state: GameState, m: Model): boolean {
  if (!isLake(state) || m.owner !== seatOf(state, 'evil') || !alive(m)) return false;
  const s = sectionOf(m);
  return !!s && !aware(state, s);
}

/** The edges of a section, west and east. */
export const sectionSpan = (s: Section): [number, number] => [SECTIONS.indexOf(s) * SECTION_WIDTH, (SECTIONS.indexOf(s) + 1) * SECTION_WIDTH];

/** Whether a Sentry must roll on the Sentry Chart now: as it activates, before the rest of its side moves. */
export function sentryDue(state: GameState, m: Model): boolean {
  if (!state.flow.started || state.phase !== 'move' || state.flow.skitter || !isSentry(state, m)) return false;
  if (!heroicsSettled(state) || activeSeat(state) !== m.owner || !mayActivate(state, m)) return false;
  return !state.flow.sentried?.includes(m.id) && !state.flow.stopped?.includes(m.id) && !engaged(state, m) && !cannotAct(state, m);
}

/** The Sentries still to roll this Move phase. */
export const sentriesDue = (state: GameState, seat: Seat) => Object.values(state.models).filter(m => m.owner === seat && sentryDue(state, m));

/**
 * The Sentry Chart, rolled as a Sentry activates: 1, it searches about and doesn't move; 2-3, it heard a noise and the
 * other player moves it up to half its Move; 4-5, it's suspicious and its own player moves it up to half its Move; 6,
 * it moves as normal. Either way it can't leave its section, charge, or shoot.
 */
export function sentryRequest(state: GameState, seat: Seat, id: string, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  const m = state.models[id];
  const good = seatOf(state, 'good');
  if (!m || m.owner !== seat || !good || !sentryDue(state, m)) return null;
  const r = d6();
  const half = +(m.move / 2).toFixed(2);
  const note =
    r === 1 ? 'Searching about: it doesn’t move this turn.' : r <= 3 ? `Heard a noise: the Good player moves it up to ${half}".` : r <= 5 ? `Suspicious: the Evil player moves it up to ${half}".` : 'Spotted something: it moves as normal.';
  const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: `Sentry: ${m.name}`.slice(0, 80), dice: [r], model: m.id, note, at: now };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'sentried', id: m.id }];
  if (r === 1) out.push({ type: 'affect', id: m.id, patch: { noMove: state.turn } });
  else if (r <= 5) out.push({ type: 'skittering', skitter: { model: m.id, by: r <= 3 ? good : seat, dist: half, upTo: true } });
  return out;
}

/** Keeps a Sentry moving in its own section: it stops where its way would take it over the line. */
export function keepInSection(state: GameState, m: Model, from: Point, to: Point): Point {
  const s = isSentry(state, m) ? sectionOf(m) : undefined;
  if (!s) return to;
  const [x0, x1] = sectionSpan(s);
  const r = radius(m);
  const inside = (p: Point) => p.x >= x0 + r - 0.01 && p.x <= x1 - r + 0.01;
  if (inside(to)) return to;
  if (!inside(from)) return from;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside({ x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid })) lo = mid;
    else hi = mid;
  }
  return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo };
}

/** Sections where an Orc that knows Legolas is about has walked up to a Sentry: the alarm goes up there at once. */
export function contactAlarms(state: GameState): Section[] {
  if (!isLake(state) || !state.flow.started) return [];
  const evil = seatOf(state, 'evil');
  const orcs = Object.values(state.models).filter(m => m.owner === evil && alive(m));
  const sentries = orcs.filter(m => isSentry(state, m));
  const woken = orcs.filter(m => !isSentry(state, m));
  return [...new Set(sentries.filter(s => woken.some(o => Math.abs(o.x - s.x) < 4 && Math.abs(o.y - s.y) < 4 && distanceBetween(o, s) <= 0.05)).map(s => sectionOf(s)!))];
}

/** As the End phase begins: Sentries Legolas charged or shot at this turn and didn't slay raise the alarm. */
export const alarmDue = (state: GameState) => isLake(state) && state.flow.started && state.phase === 'end' && !state.result && state.narrative?.alarmed !== state.turn;

export function alarmRaised(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const evil = seatOf(state, 'evil');
  const out: Action[] = [];
  const raised = [
    ...new Set(
      (state.narrative?.disturbed ?? [])
        .filter(d => d.turn === state.turn)
        .map(d => state.models[d.id])
        .filter((m): m is Model => !!m && isSentry(state, m))
        .map(m => sectionOf(m)!),
    ),
  ];
  if (raised.length && evil) {
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: evil, label: 'The alarm is raised', dice: [], note: `Legolas was seen: the Orcs in section ${raised.join(' and ')} know he is about.`, at: now } });
  }
  out.push({ type: 'narrativeNote', alarmed: state.turn, ...(raised.length ? { alarm: raised } : {}) });
  return out;
}

/** Whether Legolas charging or shooting at this model disturbs a Sentry (see alarmRaised). */
export const disturbs = (state: GameState, by: Model | undefined, target: Model | undefined) => !!by && !!target && by.cast === 'legolas' && isSentry(state, target);

// ——— The Spawn of Azog ———

/** Bolg is seriously injured once he is down to his last Wound. */
export const bolgInjured = (m: Model) => m.wounds <= 1;

/**
 * Whether Bolg must charge Legolas this Move phase: he has all his Wounds, knows Legolas is about, and could reach and
 * see him from where he started the phase.
 */
export function bolgMustCharge(state: GameState): boolean {
  return !!bolgChargeAt(state);
}

/** Where Bolg's charge at Legolas takes him, if he must make one (see bolgMustCharge). */
export function bolgChargeAt(state: GameState): Point | null {
  const b = bolgOf(state);
  const l = legolasOf(state);
  if (!isLake(state) || !state.flow.started || state.phase !== 'move' || !alive(b) || !alive(l) || b.wounds < b.maxWounds || isSentry(state, b)) return null;
  if (activeSeat(state) !== b.owner || engaged(state, b, l.id) || cannotAct(state, b) || state.flow.stopped?.includes(b.id)) return null;
  const start = state.flow.starts?.[b.id];
  const from = start ? { ...b, x: start[0], y: start[1] } : b;
  if (sightTo(state, from, l) === 'hidden') return null;
  const fresh = { ...state, flow: { ...state.flow, walked: { ...state.flow.walked, [b.id]: 0 } } };
  const move = moveLeft(fresh, from) ?? 0;
  const d = Math.hypot(l.x - from.x, l.y - from.y) || 1;
  const reach = radius(b) + radius(l) + 0.01;
  const aim = { x: l.x - ((l.x - from.x) / d) * reach, y: l.y - ((l.y - from.y) / d) * reach };
  const at = limitMove(fresh, from, aim, move, b.owner, from);
  return distanceBetween({ ...b, ...at }, l) <= 0.05 ? at : null;
}

/** Bolg still owes Legolas the charge he must make: his side can't end its move until he has. */
export function bolgOwesCharge(state: GameState): boolean {
  const b = bolgOf(state);
  const l = legolasOf(state);
  return !!b && !!l && bolgMustCharge(state) && distanceBetween(b, l) > 0.05;
}

// ——— Who wins ———

/**
 * At the end of a turn: the Good side wins once every Evil model is slain; the Evil side once Legolas is slain, or Bolg
 * has left by the west edge without being seriously injured. Bolg leaving seriously injured makes it a draw. (Once
 * Legolas is slain, or every Orc, there's nobody left on that side to play out the turn, so that's decided at once.)
 */
export function lakeWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const b = bolgOf(state);
  const fled = !!b?.escaped && !b.dead;
  const orcs = Object.values(state.models).filter(m => m.owner === evil && !m.waiting);
  const goodDone = orcs.length > 0 && orcs.every(m => m.dead || m.escaped);
  if (legolasOf(state)?.dead) return evil;
  // (Bolg gone, and every Orc left behind slain: he got away, so the Good side hasn't slain every one.)
  if (goodDone) return fled ? (bolgInjured(b!) ? 'draw' : evil) : good;
  if (state.phase !== 'end' || alarmDue(state) || !fled) return null;
  return bolgInjured(b!) ? 'draw' : evil;
}
