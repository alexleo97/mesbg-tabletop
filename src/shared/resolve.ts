import { backAway } from './backAway.ts';
import { inTheWay } from './sight.ts';
import { cleanFight, cleanShot, duelSettled, resolveDuel, resolveShot, resolveStrikes, type DrawRule, type Fighter, type FightRequest } from './fight.ts';
import { combatFromKey, priorityChooser } from './flow.ts';
import { hasElvenWeapon, sideOf } from './gear.ts';
import { supporters } from './support.ts';
import { fightDone, foughtThisTurn } from './movement.ts';
import { rollCast, rollResist } from './magic.ts';
import { cannotAct, intelligenceWorse, noStrikes, shotNeed, under, witheredStrength } from './powers.ts';
import type { Catalog } from './catalog.ts';
import { touching } from './objects.ts';
import { MAX_DICE } from './reducer.ts';
import type { Action, DiceRoll, GameState, Seat } from './types.ts';

/** Dice requests a player sends, which only whoever holds the dice (the server, or the browser in practice games) can answer. */
export const DICE_REQUESTS = new Set<Action['type']>(['roll', 'fight', 'strikes', 'shoot', 'rollFate', 'rollPriority', 'uncover', 'cast', 'resist']);

export interface Resolved {
  /** Results everyone applies, in order. */
  apply: Action[];
  /** A follow-on change the player can undo, such as ticking off a fight. */
  record?: Action;
}

/**
 * Whether any of these models is in a duel rolled this turn but not yet struck, so a second request for the same
 * fight (both players clicking at once, or the Palantír and its opponent) doesn't roll it again.
 */
function duelOpen(state: GameState, ids: string[]) {
  const set = new Set(ids);
  const r = [...state.log].reverse().find(x => x.group?.startsWith('f-') && x.side !== undefined && x.model && set.has(x.model));
  return !!r && !!state.flow.duels?.includes(r.group!) && !state.log.some(x => x.group === r.group && duelSettled(x));
}

/**
 * Leaves out of a fight any model that has already fought this turn, such as one that backed away from its own
 * fight into another. Null if that leaves a side with no one.
 */
function freshFighters(state: GameState, req: FightRequest | null): FightRequest | null {
  if (!req || !state.flow.started || state.phase !== 'fight') return req;
  const fought = foughtThisTurn(state);
  const sides = req.sides.map(side => side.filter(f => !fought.has(f.id))) as [Fighter[], Fighter[]];
  if (!sides[0].length || !sides[1].length) return null;
  const target = (id: string, side: Fighter[]) => (side.some(f => f.id === id) ? id : side[0].id);
  return { ...req, sides, targets: [target(req.targets[0], sides[1]), target(req.targets[1], sides[0])] };
}

/**
 * What the game decides about a fight whatever the player sent: a supporting model must really be able to support
 * (once its duel is rolled, it must have rolled in it) and lends one die; a Heroic Strike keeps the bonus rolled at
 * the hero's first fight this phase; and a tie between Good and Evil is settled by the Good/Evil roll.
 */
function prepareFight(state: GameState, catalog: Catalog | null, req: FightRequest | null, duel?: DiceRoll[]): FightRequest | null {
  const fresh = freshFighters(state, req);
  if (!fresh) return null;
  const front = fresh.sides.map(side => side.filter(f => !f.support).map(f => f.id));
  if (!front[0].length || !front[1].length) return null;
  const offered = supporters(state, catalog, { key: '', p1: front[0], p2: front[1] });
  const sides = fresh.sides.map((side, i) =>
    side
      .filter(f => {
        if (!f.support) return true;
        const m = state.models[f.id];
        if (!m || m.owner !== (i === 0 ? 'p1' : 'p2')) return false;
        return duel ? duel.some(r => r.support && r.model === f.id && r.side === i) : offered[m.owner].includes(f.id);
      })
      .map(f => ({ ...f, ...(f.support ? { a: 1 } : {}), ...(f.strike && state.flow.strikeBonus?.[f.id] ? { strikeBonus: state.flow.strikeBonus[f.id] } : {}) })),
  ) as [Fighter[], Fighter[]];
  const sideOfFight = (i: 0 | 1) => {
    const found = new Set(front[i].map(id => state.models[id] && sideOf(catalog, state.models[id])));
    return found.size === 1 ? [...found][0] : undefined;
  };
  const [a, b] = [sideOfFight(0), sideOfFight(1)];
  const elven = [0, 1].map(i => front[i].some(id => state.models[id] && hasElvenWeapon(catalog, state.models[id]))) as [boolean, boolean];
  const draw: DrawRule | undefined = a && b && a !== b ? { good: a === 'Good' ? 0 : 1, elven } : undefined;
  return { ...fresh, sides, ...(draw ? { draw } : {}) };
}

/**
 * What the powers on each fighter do to it, worked out here whatever the player sent: Wither and Enrage Beast change
 * its numbers, Bladewrath makes its strikes Strength 6, Enchant Blades re-rolls its misses, a Paralysed model adds
 * nothing, and a Transfixed, Prone or thrown one makes no strikes.
 */
export function adjustFight(state: GameState, req: FightRequest): FightRequest {
  const adjust = (f: Fighter): Fighter => {
    const m = state.models[f.id];
    if (!m) return f;
    const out: Fighter = { ...f, s: witheredStrength(m, f.s) };
    if (under(state, m, 'Enrage Beast')) Object.assign(out, { f: Math.min(10, out.f + 2), s: Math.min(10, out.s + 2), a: Math.min(10, out.a + 2) });
    if (under(state, m, 'Bladewrath')) out.s = 6;
    if (under(state, m, 'Enchant Blades')) out.reroll = true;
    if (under(state, m, 'Paralyse')) out.still = true;
    const why = noStrikes(state, m);
    if (why) out.noStrike = why;
    return out;
  };
  return { ...req, sides: [req.sides[0].map(adjust), req.sides[1].map(adjust)] };
}

/**
 * Rolls the dice for a player's request and returns the results to apply, or null if the request isn't allowed.
 * `d6` rolls one die and `uid` makes a unique id; `catalog` gives the profiles some powers need.
 */
export function resolveRequest(state: GameState, seat: Seat, action: Action, d6: () => number, uid: () => string, now = Date.now(), catalog: Catalog | null = null): Resolved | null {
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
      // The player with Priority picks the order the fights are rolled in, so they start each one.
      if (state.flow.started && state.phase === 'fight' && state.priority && seat !== state.priority) return null;
      const fresh = prepareFight(state, catalog, cleanFight(action.fight));
      const req = fresh && adjustFight(state, fresh);
      if (!req || (state.flow.started && req.combat && fightDone(state, combatFromKey(state, req.combat) ?? { key: req.combat, p1: [], p2: [] })) || duelOpen(state, req.sides.flat().map(f => f.id))) return null;
      return { apply: resolveDuel(req, d6, seat, `f-${uid()}`, now).map(roll => ({ type: 'rolled', roll })) };
    }
    case 'strikes': {
      const group = String(action.group ?? '');
      const rolls = state.log.filter(r => r.group === group);
      const fresh = prepareFight(state, catalog, cleanFight(action.fight), rolls);
      const req = fresh && adjustFight(state, fresh);
      // Strikes follow a duel that's still in the log, once.
      if (!req || !group.startsWith('f-') || !rolls.some(r => r.side !== undefined) || rolls.some(r => duelSettled(r))) return null;
      // The losers back away 1" by themselves; one with nowhere to go is trapped, and takes double strikes.
      let retreat: ReturnType<typeof backAway> | undefined;
      // Supporting models aren't in the fight: they neither back away nor get up.
      const ids = (side: 0 | 1) => req.sides[side].filter(f => !f.support).map(f => f.id).filter(id => state.models[id]);
      const cornered = (winner: 0 | 1, target: string) => {
        retreat = backAway(state, ids((1 - winner) as 0 | 1), ids(winner));
        // A Prone model that loses is always trapped.
        return retreat.trapped.includes(target) || !!state.models[target]?.prone;
      };
      const { rolls: strikes, outcome } = resolveStrikes(req, rolls, d6, seat, group, now, cornered);
      // A Prone winner gets up instead of striking (unless Paralysed).
      const rise = ids(outcome.winner).filter(id => state.models[id].prone && !under(state, state.models[id], 'Paralyse'));
      // Wounds go first, so a loser they slay stays where it fell rather than backing away.
      return {
        apply: [
          ...strikes.map((roll): Action => ({ type: 'rolled', roll })),
          ...outcome.hits.flatMap(h => {
            const at = strikes.filter(r => r.against === h.target.id);
            return woundAction(state, at, h.target.id, h.wounds, [...new Set(at.map(r => r.model!).filter(Boolean))], 'fight', group);
          }),
          ...(retreat?.moves.length ? [{ type: 'backAway', moves: retreat.moves } as Action] : []),
          ...rise.map((id): Action => ({ type: 'affect', id, patch: { prone: false } })),
        ],
        ...(req.combat ? { record: { type: 'resolveCombat', key: req.combat } } : {}),
      };
    }
    case 'shoot': {
      const req = cleanShot(action.shot);
      if (!req || state.flow.shot?.includes(req.shooter.id) || state.flow.farMoved?.includes(req.shooter.id)) return null;
      // The game counts what's in the way itself, from the table.
      const shooter = state.models[req.shooter.id];
      const target = state.models[req.target.id];
      // Prone models never shoot, and nor do ones held by a power.
      if (shooter && state.flow.started && (shooter.prone || cannotAct(state, shooter))) return null;
      if (shooter && target) {
        req.obstacles = Math.min(5, inTheWay(state, shooter, target).length);
        req.shooter.shoot = shotNeed(state, shooter, target, req.shooter.shoot);
      }
      const group = `s-${uid()}`;
      const shot = resolveShot(req, d6, seat, group, now);
      return {
        apply: [...shot.rolls.map((roll): Action => ({ type: 'rolled', roll })), ...woundAction(state, shot.rolls, req.target.id, shot.wounds, [req.shooter.id], 'shoot', group)],
      };
    }
    case 'cast': {
      const out = rollCast(state, seat, action, d6, uid, now, catalog);
      return out && { apply: out };
    }
    case 'resist': {
      const out = rollResist(state, seat, action.will, d6, uid, now, catalog);
      return out && { apply: out };
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
      // An enemy Fog of Disarray makes the test 1 harder.
      const sum = Math.max(2, Math.min(12, (Math.round(Number(action.intelligence)) || 7) + intelligenceWorse(state, m)));
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
