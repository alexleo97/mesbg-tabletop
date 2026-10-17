import { woundNeed } from './rules.ts';

// Chances of dice results, for the computer player to weigh up fights and shots.

/** Chance one die scores `target` or more. */
export const chance = (target: number) => Math.max(0, Math.min(1, (7 - target) / 6));

/** Chance one strike of Strength `s` wounds Defence `d` (both dice for 6/4+ style results). */
export function woundChance(s: number, d: number): number {
  const need = woundNeed(s, d);
  return need ? chance(need.target) * (need.then ? chance(need.then) : 1) : 0;
}

/** Chance the highest of `n` dice is `k` or less. */
const atMost = (n: number, k: number) => (n <= 0 ? 1 : Math.pow(Math.max(0, k) / 6, n));

/**
 * Chance a side rolling `a` dice with best Fight `fa` wins the duel against `b` dice with best Fight `fb`:
 * the highest die wins, then the higher Fight, then a roll-off.
 */
export function duelChance(a: number, fa: number, b: number, fb: number): number {
  if (a <= 0) return 0;
  if (b <= 0) return 1;
  const tie = fa > fb ? 1 : fa === fb ? 0.5 : 0;
  let win = 0;
  for (let k = 1; k <= 6; k++) {
    const pa = atMost(a, k) - atMost(a, k - 1);
    win += pa * (atMost(b, k - 1) + (atMost(b, k) - atMost(b, k - 1)) * tie);
  }
  return win;
}

export interface Side {
  /** Attacks, Fight, Strength, Defence and Wounds left of each model. */
  models: { a: number; f: number; s: number; d: number; w: number; value: number }[];
}

export interface FightOdds {
  /** Chance this side wins the duel. */
  win: number;
  /** Expected wounds this side deals if it wins, and takes if it loses. */
  dealt: number;
  taken: number;
  /** Expected worth of the enemy models slain, less our own. */
  score: number;
}

/** How a fight between two groups is likely to go, striking at each side's weakest target. */
export function fightOdds(us: Side, them: Side, trapped = { us: false, them: false }): FightOdds {
  if (!us.models.length || !them.models.length) return { win: 0, dealt: 0, taken: 0, score: 0 };
  const dice = (s: Side) => s.models.reduce((n, m) => n + m.a, 0);
  const best = (s: Side) => Math.max(...s.models.map(m => m.f));
  const win = duelChance(dice(us), best(us), dice(them), best(them));
  const strike = (from: Side, to: Side, doubled: boolean) => {
    // The winner picks whichever target it expects to do the most against.
    let top = { wounds: 0, worth: 0 };
    for (const t of to.models) {
      const wounds = from.models.reduce((n, m) => n + m.a * (doubled ? 2 : 1) * woundChance(m.s, t.d), 0);
      const worth = Math.min(1, wounds / Math.max(1, t.w)) * t.value;
      if (worth > top.worth) top = { wounds, worth };
    }
    return top;
  };
  const ours = strike(us, them, trapped.them);
  const theirs = strike(them, us, trapped.us);
  return { win, dealt: ours.wounds, taken: theirs.wounds, score: win * ours.worth - (1 - win) * theirs.worth };
}
