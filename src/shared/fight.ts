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

/**
 * Resolves a whole fight: the duel roll, any tie-break, then the winner's strikes.
 * Returns the rolls in order, all sharing `group`, for the dice log.
 */
export function resolveFight(req: FightRequest, d6: D6, by: Role, group: string, now = Date.now()): { rolls: DiceRoll[]; outcome: FightOutcome } {
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) =>
    rolls.push({ id: `${group}-${rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  const duel = req.sides.map(side => Array.from({ length: Math.min(30, side.reduce((n, f) => n + f.a, 0)) }, d6));
  req.sides.forEach((side, i) => push(`Duel: ${names(side)}`, duel[i]));

  const best = duel.map(d => Math.max(...d));
  const fight = req.sides.map(side => Math.max(...side.map(f => f.f)));
  let winner: 0 | 1;
  let how: FightOutcome['how'] = 'dice';
  if (best[0] !== best[1]) winner = best[0] > best[1] ? 0 : 1;
  else if (fight[0] !== fight[1]) {
    winner = fight[0] > fight[1] ? 0 : 1;
    how = 'fight';
  } else {
    how = 'roll-off';
    let r: number[];
    do r = [d6(), d6()];
    while (r[0] === r[1]);
    push(`Roll-off: ${names(req.sides[0])} vs ${names(req.sides[1])}`, r);
    winner = r[0] > r[1] ? 0 : 1;
  }

  const losers = req.sides[1 - winner];
  const target = losers.find(f => f.id === req.targets[winner]) ?? losers[0];
  for (const f of req.sides[winner]) {
    const need = woundNeed(f.s, target.d);
    if (!need) continue;
    const dice = Array.from({ length: f.a * (req.trapped ? 2 : 1) }, d6);
    const follow = need.then ? dice.filter(d => d >= need.target).map(d6) : undefined;
    push(`${f.name} strikes ${target.name} (${formatNeed(need)})`, dice, { target: need.target, against: target.id, ...(need.then ? { then: need.then, follow } : {}) });
  }
  const wounds = strikeWounds(rolls);
  const why = how === 'dice' ? 'higher roll' : how === 'fight' ? 'higher Fight' : 'roll-off';
  rolls[rolls.length - 1].note = `${names(req.sides[winner])} wins (${why}); ${wounds} wound${wounds === 1 ? '' : 's'} on ${target.name}`;
  return { rolls, outcome: { winner, how, target, wounds } };
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
  push(`${shooter.name} shoots ${target.name} (${shooter.weapon}, ${shooter.shoot}+)`, toHit, { target: shooter.shoot });
  let hits = toHit.filter(d => d >= shooter.shoot).length;
  for (let i = 0; i < req.obstacles && hits > 0; i++) {
    const past = Array.from({ length: hits }, d6);
    push(`In the Way ${i + 1} (4+ gets past)`, past, { target: 4 });
    hits = past.filter(d => d >= 4).length;
  }
  const need = woundNeed(shooter.s, target.d);
  if (hits > 0 && need) {
    const dice = Array.from({ length: hits }, d6);
    const follow = need.then ? dice.filter(d => d >= need.target).map(d6) : undefined;
    push(`To wound ${target.name}: S${shooter.s} vs D${target.d} (${formatNeed(need)})`, dice, { target: need.target, against: target.id, ...(need.then ? { then: need.then, follow } : {}) });
  }
  const wounds = strikeWounds(rolls);
  rolls[rolls.length - 1].note =
    hits === 0 ? `${shooter.name} misses ${target.name}` : !need ? `${shooter.weapon} can't wound ${target.name}` : `${wounds} wound${wounds === 1 ? '' : 's'} on ${target.name}`;
  return { rolls, wounds };
}
