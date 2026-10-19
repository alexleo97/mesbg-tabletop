import { distanceBetween } from './geometry.ts';
import { activeSeat, other } from './flow.ts';
import { engaged, moveStart } from './movement.ts';
import { cannotAct } from './powers.ts';
import type { GameState, Model, Phase, Seat } from './types.ts';

export interface HeroicInfo {
  name: string;
  phase: Phase;
  /** Every hero can declare it; the others need it on the hero's profile. */
  universal?: boolean;
  /** Changes who acts first, so opposing declarations are rolled off. */
  order?: boolean;
  /** A short reminder of what it does, in our own words. */
  tip: string;
}

export const HEROICS: HeroicInfo[] = [
  { name: 'Heroic Move', phase: 'move', universal: true, order: true, tip: 'Activates before Priority. May shout With Me: friends within 6" activate with it and finish within 6".' },
  { name: 'Heroic March', phase: 'move', tip: '+3" Move (+5" for cavalry or Fly) but cannot charge. May shout At the Double for friends within 6".' },
  { name: 'Heroic Resolve', phase: 'move', tip: 'Friends within 6" get a free die on Resist tests this turn; the hero passes Broken Courage tests.' },
  { name: 'Heroic Channelling', phase: 'move', tip: 'Its next Casting test this turn counts as a 6 (it still spends the Will point).' },
  { name: 'Heroic Shoot', phase: 'shoot', universal: true, order: true, tip: 'Shoots before other models. May shout Loose: friends within 6" shoot at the same time.' },
  { name: 'Heroic Accuracy', phase: 'shoot', tip: 'Gains Sharpshooter and re-rolls failed In the Way tests. May shout Take Aim for friends within 6".' },
  { name: 'Heroic Combat', phase: 'fight', universal: true, order: true, tip: 'Its fight goes first. If every enemy in it dies, the winners may move again and even charge.' },
  { name: 'Heroic Strike', phase: 'fight', tip: 'Adds D3 to its Fight value (max 10) for the phase, rolled with its first duel.' },
  { name: 'Heroic Strength', phase: 'fight', tip: 'Doubles its Strength (max 10) for its strikes until the End phase.' },
  { name: 'Heroic Defence', phase: 'fight', tip: 'Only wounded on a natural 6 this phase (6 then 6 for 6/4+ style rolls).' },
  { name: 'Heroic Challenge', phase: 'fight', tip: 'Names an enemy hero within 6". While fighting each other both get +1 Attack and +1 to wound; the slayer gains 1 Might.' },
];

export const heroicInfo = (name: string) => HEROICS.find(h => h.name === name);

/** Heroic actions declared this phase, in the order they were declared. */
export const phaseHeroics = (state: GameState) => state.flow.heroics.filter(h => h.phase === state.phase);

/** A model's heroic action of the given name this turn, if it declared one. */
export const declared = (state: GameState, model: string, action: string) => state.flow.heroics.some(h => h.model === model && h.action === action);

/** Heroes of a player who could still declare a heroic action this phase. */
export function canDeclare(state: GameState, seat: Seat): Model[] {
  if (state.phase !== 'move' && state.phase !== 'shoot' && state.phase !== 'fight') return [];
  const done = new Set(phaseHeroics(state).map(h => h.model));
  // A hero held by a power (Transfix, Paralyse) can't call one.
  // A model with a war drum can call a free Heroic March in the Move phase.
  return Object.values(state.models).filter(m => m.owner === seat && !m.dead && !done.has(m.id) && !cannotAct(state, m) && ((m.hero && m.might > 0) || (m.drum && state.phase === 'move')));
}

/** Both players have declared what they want (or have no one who could), so models can activate. */
export const heroicsSettled = (state: GameState) =>
  !state.flow.started || (['p1', 'p2'] as const).every(s => state.flow.passed.includes(s) || canDeclare(state, s).length === 0);

/** Whose turn it is to declare: the player without Priority starts, then it goes back and forth. */
export function heroicTurn(state: GameState): Seat | null {
  if (heroicsSettled(state)) return null;
  const open = (s: Seat) => !state.flow.passed.includes(s) && canDeclare(state, s).length > 0;
  const first: Seat = state.priority === 'p1' ? 'p2' : 'p1';
  const last = state.flow.lastHeroic;
  const next: Seat = last ? (last === 'p1' ? 'p2' : 'p1') : first;
  return open(next) ? next : open(next === 'p1' ? 'p2' : 'p1') ? (next === 'p1' ? 'p2' : 'p1') : null;
}

/** Both sides declared heroic actions that change the order this phase, so the Priority player rolls to see who goes first. */
export function orderRollNeeded(state: GameState): boolean {
  const seats = new Set(
    phaseHeroics(state)
      .filter(h => heroicInfo(h.action)?.order)
      .map(h => state.models[h.model]?.owner),
  );
  return seats.has('p1') && seats.has('p2');
}

export const orderRollLabel = (state: GameState) => `Heroic order, turn ${state.turn} ${state.phase} (1-3 Evil first, 4+ Good first)`;

/** The heroic action that lets a hero activate before the others in this phase: a Heroic Move, or a Heroic Shoot. */
export const GOES_FIRST: Partial<Record<Phase, string>> = { move: 'Heroic Move', shoot: 'Heroic Shoot' };
/** How close friends must be to a hero to go with it (With Me, Loose, At the Double). */
export const SHOUT_RANGE = 6;

/** The roll that decided who goes first this phase, if it has been made. */
export const orderRoll = (state: GameState) => [...state.log].reverse().find(r => r.label === orderRollLabel(state));

/**
 * The heroes whose heroic activation (a Heroic Move or Heroic Shoot) is still to come this phase, in the order they
 * were declared. A hero charged, or held by a power, before its turn comes loses it.
 */
export function heroicQueue(state: GameState): Model[] {
  const action = GOES_FIRST[state.phase];
  if (!action || !state.flow.started) return [];
  const done = new Set(state.flow.heroicDone ?? []);
  return phaseHeroics(state)
    .filter(h => h.action === action && !done.has(h.model))
    .map(h => state.models[h.model])
    .filter((m): m is Model => !!m && !m.dead && !m.escaped && !cannotAct(state, m) && (state.flow.heroicNow === m.id || !engaged(state, m)));
}

/**
 * The heroic activation going on now, before the rest of the phase: whose it is (null while the roll for who goes
 * first is still to be made) and, once one of that side's heroes has started, which hero. Null when there are none.
 * When both sides declared, the roll picks the side to start and they then alternate.
 */
export function heroicNow(state: GameState): { seat: Seat | null; hero?: string } | null {
  const queue = heroicQueue(state);
  if (!queue.length) return null;
  const action = GOES_FIRST[state.phase]!;
  const declared = phaseHeroics(state).filter(h => h.action === action);
  const seats = new Set(declared.map(h => state.models[h.model]?.owner));
  let first: Seat;
  if (seats.size > 1) {
    if (!state.flow.heroicFirst) return { seat: null };
    first = state.flow.heroicFirst;
  } else first = queue[0].owner;
  if (state.flow.heroicNow && queue.some(m => m.id === state.flow.heroicNow)) return { seat: state.models[state.flow.heroicNow].owner, hero: state.flow.heroicNow };
  // The sides take turns, starting with `first`; a side with no heroes left to go skips its turn.
  const turn: Seat = (state.flow.heroicDone?.length ?? 0) % 2 === 0 ? first : other(first);
  return { seat: queue.some(m => m.owner === turn) ? turn : other(turn) };
}

/** The friends a hero takes with it on its heroic activation: those within 6" of where it stood as it began. */
export function shoutedFor(state: GameState, hero: Model): Model[] {
  const at = { ...hero, ...moveStart(state, hero) };
  const others = new Set(heroicQueue(state).map(m => m.id));
  return Object.values(state.models).filter(f => f.owner === hero.owner && f.id !== hero.id && !f.dead && !f.escaped && !f.waiting && !others.has(f.id) && distanceBetween(at, { ...f, ...moveStart(state, f) }) <= SHOUT_RANGE);
}

/**
 * Whether a model may act (move, or shoot) now. During a heroic activation only that hero and the friends it
 * shouts for may; afterwards, the models that went with a hero have had their activation for the phase.
 */
export function mayActivate(state: GameState, m: Model): boolean {
  if (!state.flow.started || (state.phase !== 'move' && state.phase !== 'shoot')) return true;
  const now = heroicNow(state);
  if (now) {
    if (now.seat !== m.owner) return false;
    if (!now.hero) return heroicQueue(state).some(h => h.id === m.id && h.owner === m.owner);
    const hero = state.models[now.hero];
    return m.id === hero.id || shoutedFor(state, hero).some(f => f.id === m.id);
  }
  return !state.flow.activated?.includes(m.id);
}

/**
 * Whether a player can activate models now. In the Move and Shoot phases that waits until heroic actions are
 * declared, and then it is the side whose turn it is to activate: a side whose hero is making a heroic activation
 * first (see heroicNow), then the usual order. Other phases don't take turns.
 */
export function canActivate(state: GameState, seat: Seat): boolean {
  if (!state.flow.started || (state.phase !== 'move' && state.phase !== 'shoot')) return true;
  if (!heroicsSettled(state)) return false;
  return activeSeat(state) === seat;
}

/**
 * Whether a hero may declare this heroic action: the universal ones any hero may, the rest only a hero with it on
 * its profile (`heroics`, from the catalog). A hero in a fight can't call a Heroic Shoot or Heroic Accuracy.
 */
export function mayDeclare(state: GameState, m: Model, action: string, heroics: string[] | undefined): boolean {
  const info = heroicInfo(action);
  if (!info || info.phase !== state.phase) return false;
  if (!m.hero || m.might < 1) return !!m.drum && action === 'Heroic March';
  if (!info.universal && heroics && !heroics.includes(action)) return false;
  if ((action === 'Heroic Shoot' || action === 'Heroic Accuracy') && engaged(state, m)) return false;
  return true;
}

/**
 * Whether the rules let a player do this now, once the battle is under way: shooting only in the Shoot phase,
 * fights only in the Fight phase, and objectives only handled as models move. Moving models is held to the phase
 * by their move allowance (see movement.ts).
 */
export function phaseAllows(state: GameState, seat: Seat, action: { type: string; model?: string; shot?: { shooter?: { id?: string }; charge?: boolean } }): boolean {
  if (!state.flow.started) return true;
  switch (action.type) {
    case 'shoot':
      // A throwing weapon can also be thrown in the Move phase, as the model charges.
      return (state.phase === 'shoot' || (state.phase === 'move' && !!action.shot?.charge)) && canActivate(state, seat) && state.models[String(action.shot?.shooter?.id)]?.owner === seat;
    case 'fight':
    case 'strikes':
      return state.phase === 'fight' && heroicsSettled(state);
    case 'trample':
      // (A Stampede is driven by the other player, in its owner's activation; see resolve.ts.)
      return state.phase === 'move' && heroicsSettled(state);
    case 'cross':
    case 'crossed':
    case 'dismount':
    case 'crawl':
    case 'lieDown':
    case 'pickUp':
    case 'flip':
    case 'uncover':
    case 'escape':
      return state.phase === 'move' && canActivate(state, seat);
    default:
      return true;
  }
}
