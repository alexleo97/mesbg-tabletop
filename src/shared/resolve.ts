import { backAway } from './backAway.ts';
import { inTheWay } from './sight.ts';
import { cleanFight, cleanShot, resolveDuel, resolveShot, resolveStrikes } from './fight.ts';
import { priorityChooser } from './flow.ts';
import { touching } from './objects.ts';
import { MAX_DICE } from './reducer.ts';
import type { Action, DiceRoll, GameState, Seat } from './types.ts';

/** Dice requests a player sends, which only whoever holds the dice (the server, or the browser in practice games) can answer. */
export const DICE_REQUESTS = new Set<Action['type']>(['roll', 'fight', 'strikes', 'shoot', 'rollFate', 'rollPriority', 'uncover']);

export interface Resolved {
  /** Results everyone applies, in order. */
  apply: Action[];
  /** A follow-on change the player can undo, such as ticking off a fight. */
  record?: Action;
}

/**
 * Rolls the dice for a player's request and returns the results to apply, or null if the request isn't allowed.
 * `d6` rolls one die and `uid` makes a unique id.
 */
export function resolveRequest(state: GameState, seat: Seat, action: Action, d6: () => number, uid: () => string, now = Date.now()): Resolved | null {
  const mine = (id: unknown) => typeof id === 'string' && state.models[id]?.owner === seat;
  switch (action.type) {
    case 'roll': {
      const count = Math.max(1, Math.min(MAX_DICE, Math.round(Number(action.count) || 1)));
      const target = action.target === undefined ? undefined : Math.max(1, Math.min(7, Math.round(Number(action.target) || 4)));
      const then = target === undefined || action.then === undefined ? undefined : Math.max(1, Math.min(6, Math.round(Number(action.then) || 4)));
      const dice = Array.from({ length: count }, d6);
      return {
        apply: [
          {
            type: 'rolled',
            roll: {
              id: `r-${uid()}`,
              by: seat,
              label: String(action.label ?? '').slice(0, 80),
              dice,
              target,
              ...(then && target ? { then, follow: dice.filter(d => d >= target).map(() => d6()) } : {}),
              ...(action.sum !== undefined && target === undefined ? { sum: Math.max(2, Math.min(12, Math.round(Number(action.sum)) || 7)) } : {}),
              ...(mine(action.model) ? { model: action.model } : {}),
              at: now,
            },
          },
        ],
      };
    }
    case 'fight': {
      const req = cleanFight(action.fight);
      if (!req) return null;
      return { apply: resolveDuel(req, d6, seat, `f-${uid()}`, now).map(roll => ({ type: 'rolled', roll })) };
    }
    case 'strikes': {
      const req = cleanFight(action.fight);
      const group = String(action.group ?? '');
      const rolls = state.log.filter(r => r.group === group);
      // Strikes follow a duel that's still in the log, once.
      if (!req || !group.startsWith('f-') || !rolls.some(r => r.side !== undefined) || rolls.some(r => r.against || r.note || r.label.startsWith('Roll-off'))) return null;
      // The losers back away 1" by themselves; one with nowhere to go is trapped, and takes double strikes.
      let retreat: ReturnType<typeof backAway> | undefined;
      const ids = (side: 0 | 1) => req.sides[side].map(f => f.id).filter(id => state.models[id]);
      const cornered = (winner: 0 | 1, target: string) => {
        retreat = backAway(state, ids((1 - winner) as 0 | 1), ids(winner));
        return retreat.trapped.includes(target);
      };
      const { rolls: strikes, outcome } = resolveStrikes(req, rolls, d6, seat, group, now, cornered);
      // Wounds go first, so a loser they slay stays where it fell rather than backing away.
      return {
        apply: [
          ...strikes.map((roll): Action => ({ type: 'rolled', roll })),
          ...woundAction(state, strikes, outcome.target?.id, outcome.wounds, ids(outcome.winner), 'fight', group),
          ...(retreat?.moves.length ? [{ type: 'backAway', moves: retreat.moves } as Action] : []),
        ],
        ...(req.combat ? { record: { type: 'resolveCombat', key: req.combat } } : {}),
      };
    }
    case 'shoot': {
      const req = cleanShot(action.shot);
      if (!req || state.flow.shot?.includes(req.shooter.id)) return null;
      // The game counts what's in the way itself, from the table.
      const shooter = state.models[req.shooter.id];
      const target = state.models[req.target.id];
      if (shooter && target) req.obstacles = Math.min(5, inTheWay(state, shooter, target).length);
      const group = `s-${uid()}`;
      const shot = resolveShot(req, d6, seat, group, now);
      return {
        apply: [...shot.rolls.map((roll): Action => ({ type: 'rolled', roll })), ...woundAction(state, shot.rolls, req.target.id, shot.wounds, [req.shooter.id], 'shoot', group)],
      };
    }
    case 'rollFate': {
      const m = state.models[String(action.id)];
      if (!m || m.owner !== seat || !m.pending || m.fate < 1) return null;
      const roll = { id: `r-${uid()}`, by: seat, label: `Fate roll: ${m.name} (4+ saves a wound)`, dice: [d6()], target: 4, model: m.id, at: now };
      return { apply: [{ type: 'fateRolled', id: m.id, roll }] };
    }
    case 'uncover': {
      // One Intelligence test per side per Artefact each turn, by an infantry model touching it.
      const m = state.models[String(action.model)];
      const t = state.terrain[String(action.marker)];
      if (!m || m.owner !== seat || m.dead || m.escaped || m.base.h > m.base.w) return null;
      if (!t || t.object !== 'artefact' || !t.hidden || t.gone || t.tried?.[seat] === state.turn || !touching(m, t)) return null;
      const sum = Math.max(2, Math.min(12, Math.round(Number(action.intelligence)) || 7));
      const roll = { id: `r-${uid()}`, by: seat, label: `Uncover the Artefact: ${m.name}`.slice(0, 80), dice: [d6(), d6()], sum, at: now };
      return { apply: [{ type: 'uncovered', model: m.id, marker: t.id, roll }] };
    }
    case 'rollPriority': {
      // Once per turn: whoever asks first rolls for both players.
      if (state.phase !== 'priority' || (state.flow.chooserTurn === state.turn && state.flow.chooser)) return null;
      // Roll off; a first-turn tie is simply rolled again.
      const apply: Action[] = [];
      let roll: [number, number];
      let chooser: Seat | null;
      do {
        roll = [d6(), d6()];
        chooser = priorityChooser(roll, state.turn, state.flow.chooser);
        apply.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: seat, label: `Priority roll, turn ${state.turn}`, dice: roll, at: now } });
      } while (!chooser);
      apply.push({ type: 'priorityRolled', roll, chooser });
      return { apply };
    }
    default:
      return null;
  }
}

/**
 * Whether a fight or shot's wounds can be taken straight away: not while a hero who rolled could still spend Might to
 * turn a failed die into a success (then the players apply them, after deciding).
 */
function autoWound(state: GameState, rolls: DiceRoll[]): boolean {
  return !rolls.some(r => {
    const m = r.model ? state.models[r.model] : undefined;
    if (!m?.hero || m.might < 1 || r.target === undefined) return false;
    return r.dice.some(d => d < r.target!) || (r.follow ?? []).some(d => d < (r.then ?? 7));
  });
}

/** The wounds of a fight or shot, taken as soon as the dice land when nothing is left to decide. */
function woundAction(state: GameState, rolls: DiceRoll[], victim: string | undefined, count: number, by: string[], how: 'fight' | 'shoot', group: string): Action[] {
  if (!victim || count < 1 || !state.models[victim] || !autoWound(state, rolls)) return [];
  return [{ type: 'wound', id: victim, count, by, how, group }];
}
