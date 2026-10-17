import { activeSeat } from './flow.ts';
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
  { name: 'Heroic March', phase: 'move', order: true, tip: '+3" Move (+5" for cavalry or Fly) but cannot charge. May shout At the Double for friends within 6".' },
  { name: 'Heroic Resolve', phase: 'move', tip: 'Friends within 6" get a free die on Resist tests this turn; the hero passes Broken Courage tests.' },
  { name: 'Heroic Channelling', phase: 'move', tip: 'Its next Casting test this turn counts as a 6 (it still spends the Will point).' },
  { name: 'Heroic Shoot', phase: 'shoot', universal: true, order: true, tip: 'Shoots before other models. May shout Loose: friends within 6" shoot at the same time.' },
  { name: 'Heroic Accuracy', phase: 'shoot', order: true, tip: 'Gains Sharpshooter and re-rolls failed In the Way tests. May shout Take Aim for friends within 6".' },
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
  return Object.values(state.models).filter(m => m.owner === seat && m.hero && !m.dead && m.might > 0 && !done.has(m.id));
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

/**
 * Whether a player can activate models now. In the Move and Shoot phases that waits until heroic actions are
 * declared, and then it is the side whose turn it is to activate, or a side whose hero called a heroic action that
 * goes out of turn (such as a Heroic Move). Other phases don't take turns.
 */
export function canActivate(state: GameState, seat: Seat): boolean {
  if (!state.flow.started || (state.phase !== 'move' && state.phase !== 'shoot')) return true;
  if (!heroicsSettled(state)) return false;
  return activeSeat(state) === seat || phaseHeroics(state).some(h => heroicInfo(h.action)?.order && state.models[h.model]?.owner === seat);
}

/**
 * Whether the rules let a player do this now, once the battle is under way: shooting only in the Shoot phase,
 * fights only in the Fight phase, and objectives only handled as models move. Moving models is held to the phase
 * by their move allowance (see movement.ts).
 */
export function phaseAllows(state: GameState, seat: Seat, action: { type: string; model?: string; shot?: { shooter?: { id?: string } } }): boolean {
  if (!state.flow.started) return true;
  switch (action.type) {
    case 'shoot':
      return state.phase === 'shoot' && canActivate(state, seat) && state.models[String(action.shot?.shooter?.id)]?.owner === seat;
    case 'fight':
    case 'strikes':
      return state.phase === 'fight' && heroicsSettled(state);
    case 'pickUp':
    case 'flip':
    case 'uncover':
    case 'escape':
      return state.phase === 'move' && canActivate(state, seat);
    default:
      return true;
  }
}
