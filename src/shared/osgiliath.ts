import { modelStats, type Catalog } from './catalog.ts';
import { distanceBetween, type Point } from './geometry.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import { POINTS } from './osgiliathMap.ts';
import { armyStatus } from './status.ts';
import { hasRule, isKind } from './wargear.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Escape from Osgiliath (The Return of the King): the scenario's own rules, in our own words. Gothmog's Orcs pour
// into the ruined city from the east and the west at once, with more crossing the Anduin all the time, and Faramir's
// garrison, caught in the middle, must get out by the west edge. The Nazgûl wheel overhead, freezing men with fear.
// (Gothmog's, his Enforcer's, Guritz's, Faramir's and Damrod's own rules, which work in any game, are here too.)

export const isOsgiliath = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'escape-from-osgiliath';

/** The Good side wins with this many models (a third of its 27) off the west edge. */
export const ESCAPE_WIN = 9;
/** Hordes Without End: a slain Orc comes back on this or more. */
export const HORDE_ROLL = 4;
/** "Nazgûl!": the chosen Warrior is frozen with fear on this or more. */
export const DREAD_ROLL = 3;

export const POINT_NAMES = ['north', 'south'] as const;
export type PointName = (typeof POINT_NAMES)[number];

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
export const isOrc = (m: Pick<Model, 'cast'>) => m.cast === 'orc';

// ——— Getting away ———

/** The Good side gets away by the west edge, and only by it. */
export const osgiliathExits = (state: GameState, m: Model): ('top' | 'bottom' | 'left' | 'right')[] => (isOsgiliath(state) && m.owner === seatOf(state, 'good') ? ['left'] : []);

/** How many models have got away, counting Dominant ones (Faramir, under Wizard's Pupil) as more than one. */
export const escapedWorth = (state: GameState) =>
  Object.values(state.models)
    .filter(m => m.owner === seatOf(state, 'good') && m.escaped && !m.dead)
    .reduce((n, m) => n + Math.max(1, m.dominant ?? 1), 0);

/**
 * The battle goes on until no Good model is left on the table. Nine or more off the west edge is a Good win, fewer an
 * Evil win; but Faramir getting off holds the Evil side to a draw at best, and Faramir slain holds the Good side to
 * one. The result is settled as soon as nothing left can change it.
 */
export function osgiliathWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const off = escapedWorth(state);
  const left = Object.values(state.models).filter(m => m.owner === good && alive(m));
  const most = off + left.reduce((n, m) => n + Math.max(1, m.dominant ?? 1, m.ground?.includes('pupil') ? 2 : 1), 0);
  const faramir = castModel(state, 'faramir');
  const away = !!faramir?.escaped && !faramir.dead;
  const slain = !!faramir?.dead;
  // (What the game would end as now, and what it can still become.)
  const result = (escaped: boolean): Seat | 'draw' => (escaped ? (slain ? 'draw' : good) : away ? 'draw' : evil);
  if (!left.length) return result(off >= ESCAPE_WIN);
  if (off >= ESCAPE_WIN && (away || slain)) return result(true);
  if (most < ESCAPE_WIN && (away || slain)) return result(false);
  return null;
}

/** For the scoreboard: how many have got away. */
export const osgiliathNote = (state: GameState) => `${escapedWorth(state)} of ${ESCAPE_WIN} escaped west`;

// ——— Wizard's Pupil ———

/**
 * Wizard's Pupil: in a turn its side won the roll for Priority and handed it over, while Faramir is on the table, he
 * (and his Warriors within 3") are Dominant (2). Here that only matters if he gets off the table that turn; Warriors
 * that got it from being near him lose it as they leave (see the Dominant rule), so only he counts double.
 */
export const pupilNow = (state: GameState, m: Model) =>
  !!m.ground?.includes('pupil') && state.flow.started && state.flow.chooser === m.owner && state.flow.chooserTurn === state.turn && !!state.priority && state.priority !== m.owner && alive(m);

// ——— Hordes Without End ———

/** The Morannon Orcs slain so far: each may come back (the Troll never does). */
export const slainOrcs = (state: GameState): Model[] => Object.values(state.models).filter(m => isOrc(m) && m.owner === seatOf(state, 'evil') && m.dead);

/** Whether ending the Evil side's move must wait for slain Orcs to come back (see reducer endActivation). */
export function hordePending(state: GameState, seat: Seat): boolean {
  return isOsgiliath(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'evil') && state.flow.entering?.turn !== state.turn && state.narrative?.horde !== state.turn && slainOrcs(state).length > 0;
}

export const hordeDue = (state: GameState) => isOsgiliath(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'evil') && hordePending(state, state.flow.reinforce);

/** The Reinforcement Point the Orcs come on from: the Evil player's choice, or else the one nearer the Good side. */
export function hordePoint(state: GameState): PointName {
  const evil = seatOf(state, 'evil');
  const pick = evil ? state.flow.picks?.[evil]?.edge : undefined;
  if (pick === 'north' || pick === 'south') return pick;
  const men = Object.values(state.models).filter(m => m.owner === seatOf(state, 'good') && alive(m));
  const y = men.length ? men.reduce((n, m) => n + m.y, 0) / men.length : state.board.h / 2;
  return y < state.board.h / 2 ? 'north' : 'south';
}

/**
 * Hordes Without End: a D6 for every slain Orc, and each 4+ moves back on as reinforcements from the Reinforcement
 * Point the Evil player picked. (Rolled as the Evil side's move ends, when reinforcements come on; nothing that
 * happens in between can change who rolls.)
 */
export function hordeArrives(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'evil')!;
  const slain = slainOrcs(state);
  const dice = slain.map(() => d6());
  const coming = slain.filter((_, i) => dice[i] >= HORDE_ROLL);
  const point = hordePoint(state);
  const roll: DiceRoll = {
    id: `n-${uid()}`,
    by: seat,
    label: 'Hordes Without End: a 4+ for each slain Orc',
    dice,
    target: HORDE_ROLL,
    note: coming.length ? `${coming.length} Orc${coming.length === 1 ? '' : 's'} come${coming.length === 1 ? 's' : ''} back from the ${point} Reinforcement Point.` : 'No Orcs come back this turn.',
    at: now,
  };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'narrativeNote', horde: state.turn }];
  for (const g of coming) out.push({ type: 'affect', id: g.id, patch: { dead: false, waiting: true, wounds: g.maxWounds, prone: false, effects: [] } });
  const p = POINTS[point];
  // (They come on at the point: a little either side of it, as there's room.)
  out.push({ type: 'entering', seat, ids: coming.map(g => g.id), from: [p.x, p.y], span: [p.x - 3, p.x + 3] });
  return out;
}

// ——— "Nazgûl!" ———

/** The Good Warriors the Evil player may pick to freeze with fear. */
export const dreadTargets = (state: GameState): Model[] => Object.values(state.models).filter(m => m.owner === seatOf(state, 'good') && alive(m) && !m.hero);

/** Whether a Warrior is frozen with fear this turn: it can't act, and fights with Fight 1 (see powers.ts and resolve.ts). */
export const dreaded = (state: GameState, m: Model) => isOsgiliath(state) && m.dread === state.turn;

/**
 * As a Move phase begins the Evil player picks a Good Warrior (or nobody) and rolls a D6: on a 3+ it is frozen with
 * fear this turn. Null if that can't be done now.
 */
export function nazgulCry(state: GameState, seat: Seat, target: string | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  if (!isOsgiliath(state) || seat !== seatOf(state, 'evil') || state.narrative?.dread === state.turn || !state.flow.started || state.phase !== 'move') return null;
  if (!target) return [{ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: '"Nazgûl!": the Nazgûl pass overhead', dice: [], note: 'Nobody is picked out this turn.', at: now } }, { type: 'narrativeNote', dread: state.turn }];
  const m = dreadTargets(state).find(x => x.id === target);
  if (!m) return null;
  const die = d6();
  const frozen = die >= DREAD_ROLL;
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: `"Nazgûl!": ${m.name} is frozen with fear on a 3+`.slice(0, 80), dice: [die], target: DREAD_ROLL, model: m.id, note: frozen ? `${m.name} can't move, shoot or act this turn, and fights with Fight 1.` : `${m.name} holds firm.`, at: now };
  return [{ type: 'rolled', roll }, ...(frozen ? [{ type: 'affect', id: m.id, patch: { dread: state.turn } } as Action] : []), { type: 'narrativeNote', dread: state.turn }];
}

/** The Warrior the computer freezes: the one nearest getting away, or else the one nearest the Orcs. */
export function dreadPick(state: GameState): Model | undefined {
  return [...dreadTargets(state)].sort((a, b) => a.x - b.x)[0];
}

// ——— Gothmog and his Orcs ———

/** A Mordor Orc: Gothmog's "time of the Orc" and "Age of Men" are for these. */
export const mordorOrc = (catalog: Catalog | null | undefined, m: Model) => isKind(catalog, m, 'Orc') && isKind(catalog, m, 'mordor');

/** "The Age of Men is Over": friendly Mordor Orcs within 3" of Gothmog have Hatred (Man). (Not Gothmog himself.) */
export function ageOfMen(state: GameState, catalog: Catalog | null | undefined, m: Model): boolean {
  if (!mordorOrc(catalog, m) || hasRule(catalog, m, '"The Age of Men is Over"')) return false;
  return Object.values(state.models).some(g => g.owner === m.owner && alive(g) && hasRule(catalog, g, '"The Age of Men is Over"') && distanceBetween(g, m) <= 3);
}

const ORC_TIME = 'The time of the Orc';

/** Whether Gothmog may call "The time of the Orc has come" now: once a game, as a Fight phase begins. */
export function mayOrcTime(state: GameState, catalog: Catalog | null | undefined, m: Model | undefined): boolean {
  if (!m || !alive(m) || !hasRule(catalog, m, '"The time of the Orc has come"') || m.used?.includes(ORC_TIME)) return false;
  return state.flow.started && state.phase === 'fight' && !state.flow.resolved.length && !state.flow.duels?.length;
}

/** Gothmog calls it: until the turn ends, friendly Mordor Orcs within 12" of him re-roll failed To Wound rolls. */
export function orcTime(m: Model, uid: () => string, now = Date.now()): Action[] {
  return [
    { type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `${m.name}: "The time of the Orc has come"`, dice: [], model: m.id, note: 'Mordor Orcs within 12" of him re-roll failed To Wound rolls this turn.', at: now } },
    { type: 'affect', id: m.id, patch: { used: [...(m.used ?? []), ORC_TIME] } },
    { type: 'usedTurn', key: 'orctime', model: m.id },
  ];
}

/** Whether a Mordor Orc re-rolls its failed To Wound rolls this turn: Gothmog called the time of the Orc within 12". */
export function orcTimeFor(state: GameState, catalog: Catalog | null | undefined, m: Model): boolean {
  if (!mordorOrc(catalog, m)) return false;
  return Object.values(state.models).some(g => g.owner === m.owner && alive(g) && state.flow.usedTurn?.includes(`orctime:${g.id}`) && distanceBetween(g, m) <= 12);
}

/** End the Race of Man: +1 Fight while in a fight with an enemy Man. */
export const endTheRace = (catalog: Catalog | null | undefined, m: Model, foes: Model[]) => hasRule(catalog, m, 'End the Race of Man') && foes.some(f => isKind(catalog, f, 'Man'));

/**
 * Gothmog's Right Hand: within 3" of his Enforcer, Gothmog may pay for a Heroic Move or Heroic March with the
 * Enforcer's Will rather than his own Might. (The game uses the Enforcer's Will first, while he has any.)
 */
export function rightHand(state: GameState, m: Model | undefined): Model | undefined {
  if (!m || !m.ground?.includes('gothmog')) return undefined;
  return Object.values(state.models).find(e => e.owner === m.owner && e.ground?.includes('righthand') && alive(e) && e.will > 0 && distanceBetween(e, m) <= 3);
}
export const RIGHT_HAND_ACTIONS = ['Heroic Move', 'Heroic March'];

/** The Enforcer a Heroic Move or March of Gothmog's may be shouted from, as well as from Gothmog himself. */
export const shoutsFrom = (state: GameState, hero: Model): Model | undefined =>
  hero.ground?.includes('gothmog') ? Object.values(state.models).find(e => e.owner === hero.owner && e.ground?.includes('righthand') && alive(e) && distanceBetween(e, hero) <= 3) : undefined;

// ——— Faramir ———

/**
 * "A Chance for Faramir to show his Quality": once his army is Broken, he re-rolls failed To Wound rolls for his
 * strikes, and has a free Heroic Resolve every turn.
 */
export const faramirsChance = (state: GameState, m: Model) => !!m.ground?.includes('chance') && armyStatus(state, m.owner).broken;

// ——— Master of Battle ———

/** The score a Master of Battle needs, from the bracket on its rule ("Master of Battle (2+)"). */
const masterNeed = (catalog: Catalog | null | undefined, m: Model) => {
  const rule = (m.profileId ? catalog?.units[m.profileId]?.rules : undefined)?.find(r => r.startsWith('Master of Battle'));
  return rule ? Number(/\((\d)\+?\)/.exec(rule)?.[1] ?? 7) : 0;
};

/**
 * An enemy hero's heroic action that a Master of Battle within 6" of it has yet to roll for. On the score in brackets
 * or more he declares the same one for nothing (even with no Might, or one he couldn't normally declare); otherwise he
 * may still declare his own as usual.
 */
export function masterDue(state: GameState, catalog: Catalog | null | undefined): { master: Model; heroic: { model: string; action: string }; key: string } | null {
  if (!state.flow.started || state.result) return null;
  for (const h of state.flow.heroics) {
    if (h.phase !== state.phase) continue;
    const m = state.models[h.model];
    if (!m || !m.hero) continue;
    const key = `mob:${state.turn}:${h.phase}:${h.model}:${h.action}`;
    if (state.flow.heard?.includes(key)) continue;
    const master = Object.values(state.models).find(o => o.owner !== m.owner && alive(o) && o.hero && masterNeed(catalog, o) > 0 && distanceBetween(o, m) <= 6 && !state.flow.heroics.some(x => x.model === o.id && x.phase === state.phase));
    if (master) return { master, heroic: h, key };
  }
  return null;
}

/** The game rolls for the Master of Battle, and on a pass declares the same heroic action for him. */
export function masterRoll(state: GameState, catalog: Catalog | null | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const due = masterDue(state, catalog);
  if (!due) return [];
  const { master, heroic, key } = due;
  const need = masterNeed(catalog, master);
  const caller = state.models[heroic.model];
  const d = d6();
  const copies = d >= need;
  const out: Action[] = [{ type: 'heard', key }];
  out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: master.owner, label: `Master of Battle: ${master.name} answers ${caller.name}'s ${heroic.action} (${need}+)`.slice(0, 80), dice: [d], target: need, model: master.id, at: now, note: copies ? `${master.name} declares a ${heroic.action} too, for nothing.` : `${master.name} may still declare a heroic action of his own, as usual.` } });
  if (copies) out.push({ type: 'freeHeroic', model: master.id, action: heroic.action, ...(heroic.action === 'Heroic Challenge' ? { target: caller.id } : {}) });
  return out;
}

// ——— Damrod ———

/** Well-aimed Shot: the first In the Way roll Damrod fails in a shot, an Intelligence test (2D6, his Intelligence or more) gets it past. */
export const wellAimed = (catalog: Catalog | null | undefined, m: Model): number | undefined => (hasRule(catalog, m, 'Well-aimed Shot') ? (modelStats(catalog, m)?.I ?? 7) : undefined);

// ——— The computer ———

/** Where a Good model heads to get away: the west edge, level with where it is (pulled away from the corners). */
export const westSpot = (state: GameState, m: Model): Point => ({ x: radius(m) + 0.02, y: Math.max(4, Math.min(state.board.h - 4, m.y)) });
