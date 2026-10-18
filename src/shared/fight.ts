import { formatNeed, woundNeed } from './rules.ts';
import type { DiceRoll, Role } from './types.ts';

export interface Fighter {
  id: string;
  name: string;
  /** Fight value. */
  f: number;
  /** Attacks. */
  a: number;
  s: number;
  d: number;
  /** Heroic Strike: adds D3 to Fight, rolled with the duel. */
  strike?: boolean;
  /** Heroic Defence: only wounded on natural 6s. */
  defence?: boolean;
  // Set by the game from the powers on the model (see adjustFight), never taken from a player's request:
  /** Paralysed: rolls no dice and adds no Fight to the duel. */
  still?: boolean;
  /** Makes no strikes if its side wins (Transfixed, Prone and so on): the reason. */
  noStrike?: string;
  /** Enchant Blades: re-rolls failed To Wound rolls on its strikes. */
  reroll?: boolean;
}

export interface FightRequest {
  sides: [Fighter[], Fighter[]];
  /** Who each side strikes if it wins: the id of a model on the other side. */
  targets: [string, string];
  /** The losing side can't back away, so the winner's strikes are doubled. */
  trapped: boolean;
  /** The combat this resolves, so the turn tracker can tick it off. */
  combat?: string;
}

export interface ShotRequest {
  shooter: { id: string; name: string; weapon: string; shoot: number; s: number; shots: number };
  target: { id: string; name: string; d: number };
  /** Things in the way (models or terrain): each needs a 4+ for the shot to get past. */
  obstacles: number;
}

export interface FightOutcome {
  winner: 0 | 1;
  /** Why the winner won: higher die, higher Fight, or a roll-off. */
  how: 'dice' | 'fight' | 'roll-off';
  target: Fighter | undefined;
  wounds: number;
}

type D6 = () => number;

const clamp = (n: unknown, lo: number, hi: number, fb: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb;
};

/** Cleans an untrusted request; null if it isn't a fight between two sides. */
export function cleanFight(raw: unknown): FightRequest | null {
  const o = raw as Partial<FightRequest> | null;
  if (!o || !Array.isArray(o.sides) || o.sides.length !== 2) return null;
  const side = (s: unknown) =>
    (Array.isArray(s) ? s : []).slice(0, 10).map((f: Partial<Fighter>) => ({
      id: String(f?.id ?? '').slice(0, 64),
      name: String(f?.name ?? 'Model').slice(0, 40),
      f: clamp(f?.f, 1, 10, 3),
      a: clamp(f?.a, 1, 10, 1),
      s: clamp(f?.s, 1, 10, 3),
      d: clamp(f?.d, 1, 10, 4),
      ...(f?.strike === true ? { strike: true } : {}),
      ...(f?.defence === true ? { defence: true } : {}),
    }));
  const sides: [Fighter[], Fighter[]] = [side(o.sides[0]), side(o.sides[1])];
  if (!sides[0].length || !sides[1].length) return null;
  const t = Array.isArray(o.targets) ? o.targets : [];
  const combat = typeof o.combat === 'string' ? o.combat.slice(0, 2000) : undefined;
  return { sides, targets: [String(t[0] ?? ''), String(t[1] ?? '')], trapped: o.trapped === true, ...(combat ? { combat } : {}) };
}

const names = (side: Fighter[]) => (side.length === 1 ? side[0].name : `${side[0].name} +${side.length - 1}`);

/** Wounds caused by a group of rolls: successes on strikes, counting only follow-up dice for 6/4 results. */
export function strikeWounds(rolls: DiceRoll[]): number {
  return rolls
    .filter(r => r.against && r.target)
    .reduce((n, r) => n + (r.then && r.follow ? r.follow.filter(d => d >= r.then!).length : r.dice.filter(d => d >= r.target!).length), 0);
}

/** Rolls the duel: one roll per model so each hero can spend Might on its own dice. Heroic Strike's D3 comes first. */
export function resolveDuel(req: FightRequest, d6: D6, by: Role, group: string, now = Date.now()): DiceRoll[] {
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) =>
    rolls.push({ id: `${group}-${rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  req.sides.forEach((side, i) => {
    for (const f of side) {
      // A Paralysed model adds nothing to the duel; a side of nothing else loses it.
      if (f.still) continue;
      let fv = f.f;
      if (f.strike) {
        const bonus = Math.ceil(d6() / 2);
        fv = Math.min(10, fv + bonus);
        push(`Heroic Strike: ${f.name} +${bonus} Fight`, [bonus]);
      }
      push(`Duel: ${f.name} (F${fv})`, Array.from({ length: f.a }, d6), { model: f.id, f: fv, side: i as 0 | 1 });
    }
  });
  return rolls;
}

/** Who is winning a duel from its rolls (after any Might): the highest die, then the highest Fight; null if it needs a roll-off. */
export function duelLeader(rolls: DiceRoll[]): { winner: 0 | 1; how: 'dice' | 'fight' } | null {
  const duel = rolls.filter(r => r.side !== undefined && r.f !== undefined);
  const best = [0, 1].map(s => Math.max(0, ...duel.filter(r => r.side === s).flatMap(r => r.dice)));
  const fight = [0, 1].map(s => Math.max(0, ...duel.filter(r => r.side === s).map(r => r.f!)));
  if (best[0] !== best[1]) return { winner: best[0] > best[1] ? 0 : 1, how: 'dice' };
  if (fight[0] !== fight[1]) return { winner: fight[0] > fight[1] ? 0 : 1, how: 'fight' };
  return null;
}

/**
 * Rolls the winner's strikes for a duel already rolled. `duel` is that duel's rolls, as the log now has them.
 * `cornered` says whether the model being struck can't back away, which doubles the strikes as `trapped` does.
 */
export function resolveStrikes(req: FightRequest, duel: DiceRoll[], d6: D6, by: Role, group: string, now = Date.now(), cornered?: (winner: 0 | 1, target: string) => boolean): { rolls: DiceRoll[]; outcome: FightOutcome } {
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) =>
    rolls.push({ id: `${group}-${duel.length + rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  const lead = duelLeader(duel);
  let winner: 0 | 1;
  let how: FightOutcome['how'];
  if (lead) ({ winner, how } = lead);
  else {
    how = 'roll-off';
    let r: number[];
    do r = [d6(), d6()];
    while (r[0] === r[1]);
    push(`Roll-off: ${names(req.sides[0])} vs ${names(req.sides[1])}`, r);
    winner = r[0] > r[1] ? 0 : 1;
  }

  const losers = req.sides[1 - winner];
  const target = losers.find(f => f.id === req.targets[winner]) ?? losers[0];
  const trapped = req.trapped || !!cornered?.(winner, target.id);
  const idle: string[] = [];
  for (const f of req.sides[winner]) {
    if (f.noStrike) {
      idle.push(`${f.name} (${f.noStrike})`);
      continue;
    }
    const base = woundNeed(f.s, target.d);
    // Heroic Defence: only natural 6s wound (both dice for 6/4+ style results).
    const need = base && target.defence ? { target: 6, ...(base.then ? { then: 6 } : {}) } : base;
    if (!need) continue;
    let dice = Array.from({ length: f.a * (trapped ? 2 : 1) }, d6);
    if (f.reroll) dice = dice.map(d => (d >= need.target ? d : d6()));
    const follow = need.then ? dice.filter(d => d >= need.target).map(d6).map(d => (f.reroll && d < need.then! ? d6() : d)) : undefined;
    const label = `${f.name} strikes ${target.name}${trapped ? ', trapped,' : ''}${f.reroll ? ', re-rolling misses,' : ''} (${formatNeed(need)})`;
    push(label, dice, { target: need.target, against: target.id, model: f.id, ...(need.then ? { then: need.then, follow } : {}) });
  }
  const wounds = strikeWounds(rolls);
  const why = how === 'dice' ? 'higher roll' : how === 'fight' ? 'higher Fight' : 'roll-off';
  const note = `${names(req.sides[winner])} wins the duel (${why})${idle.length ? `. No strikes from ${idle.join(', ')}` : ''}`;
  if (rolls.length) rolls[rolls.length - 1].note = note.slice(0, 200);
  else push(idle.length ? `${names(req.sides[winner])} makes no strikes` : `${names(req.sides[winner])} can't wound ${target.name}`, [], { note });
  return { rolls, outcome: { winner, how, target, wounds } };
}

/** Rolls a whole fight in one go: the duel, any roll-off and the strikes. */
export function resolveFight(req: FightRequest, d6: D6, by: Role, group: string, now = Date.now()): { rolls: DiceRoll[]; outcome: FightOutcome } {
  const duel = resolveDuel(req, d6, by, group, now);
  const { rolls, outcome } = resolveStrikes(req, duel, d6, by, group, now);
  return { rolls: [...duel, ...rolls], outcome };
}

export function cleanShot(raw: unknown): ShotRequest | null {
  const o = raw as Partial<ShotRequest> | null;
  if (!o?.shooter || !o.target) return null;
  return {
    shooter: {
      id: String(o.shooter.id ?? '').slice(0, 64),
      name: String(o.shooter.name ?? 'Model').slice(0, 40),
      weapon: String(o.shooter.weapon ?? 'Bow').slice(0, 30),
      shoot: clamp(o.shooter.shoot, 1, 6, 4),
      s: clamp(o.shooter.s, 1, 10, 2),
      shots: clamp(o.shooter.shots, 1, 6, 1),
    },
    target: { id: String(o.target.id ?? '').slice(0, 64), name: String(o.target.name ?? 'Model').slice(0, 40), d: clamp(o.target.d, 1, 10, 4) },
    obstacles: clamp(o.obstacles, 0, 5, 0),
  };
}

/** Resolves a shooting attack: to hit, In the Way for each obstacle, then to wound. */
export function resolveShot(req: ShotRequest, d6: D6, by: Role, group: string, now = Date.now()): { rolls: DiceRoll[]; wounds: number } {
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) =>
    rolls.push({ id: `${group}-${rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  const { shooter, target } = req;
  const toHit = Array.from({ length: shooter.shots }, d6);
  push(`${shooter.name} shoots ${target.name} (${shooter.weapon}, ${shooter.shoot}+)`, toHit, { target: shooter.shoot, model: shooter.id, aim: target.id });
  let hits = toHit.filter(d => d >= shooter.shoot).length;
  for (let i = 0; i < req.obstacles && hits > 0; i++) {
    const past = Array.from({ length: hits }, d6);
    push(`In the Way ${i + 1} (4+ gets past)`, past, { target: 4, model: shooter.id });
    hits = past.filter(d => d >= 4).length;
  }
  const need = woundNeed(shooter.s, target.d);
  if (hits > 0 && need) {
    const dice = Array.from({ length: hits }, d6);
    const follow = need.then ? dice.filter(d => d >= need.target).map(d6) : undefined;
    push(`To wound ${target.name}: S${shooter.s} vs D${target.d} (${formatNeed(need)})`, dice, { target: need.target, against: target.id, model: shooter.id, ...(need.then ? { then: need.then, follow } : {}) });
  }
  const wounds = strikeWounds(rolls);
  rolls[rolls.length - 1].note =
    hits === 0 ? `${shooter.name} misses ${target.name}` : !need ? `${shooter.weapon} can't wound ${target.name}` : `${shooter.name} hits ${target.name}`;
  return { rolls, wounds };
}
