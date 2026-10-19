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
  /** The enemy hero of its Heroic Challenge, when that hero is in this fight: +1 to wound it (the extra Attack is already in `a`). */
  rival?: string;
  /** Its Heroic Strike bonus, when already rolled at an earlier fight this phase. */
  strikeBonus?: number;
  /**
   * Supporting with a spear or pike: not in the fight itself, so it can't be struck, but it adds one die to the duel
   * at its own Fight and makes one strike if its side wins.
   */
  support?: boolean;
  // Worked out by the game from the model's wargear and special rules (see wargear.fighterOf), bar the two choices:
  /** Chosen: Shielding, so twice the Attacks and no strikes. */
  shielding?: boolean;
  /** Chosen (or forced): fighting with a two-handed weapon. */
  twoHanded?: boolean;
  /** Added to each of its duel dice (two-handed weapons, banners, unarmed); with `sixSafe` a natural 6 stays a 6. */
  duelMod?: number;
  sixSafe?: boolean;
  /** Added to its To Wound rolls (two-handed weapons, unarmed). */
  woundMod?: number;
  /** Re-rolls natural 1s to wound (Poisoned Attacks). */
  ones?: boolean;
  /** Never needs worse than this To Wound on its strikes, before other bonuses (Andúril: 4+). */
  woundCap?: number;
  /** Each strike that wounds does 2 (Mighty Blow). */
  mighty?: boolean;
  /** Each natural 6 that wounds does 2 (Grasper & Keeper). */
  sixes?: boolean;
  /** Re-rolls its 1s in the duel (Dori's A Good Sort). */
  duelOnes?: boolean;
  /** Enemies it may not strike (the Trolls and Bilbo, early in Roast Mutton): its strikes go at another enemy. */
  spare?: string[];
  /** Instead of striking, if its side wins: a headbutt at this enemy (Bifur's Embedded Axe), a single Strength 4
   * strike that isn't doubled for a trapped foe. */
  headbutt?: string;
  /** Instead of striking, if its side wins: tries to knock this enemy down before anyone strikes (a Mattock). */
  knock?: string;
  /** Shielding with the Oakenshield: if its side wins, a Strength 4 hit on this enemy. */
  oak?: string;
  /** +1 to wound a trapped enemy (Backstabbers). */
  backstab?: boolean;
  /** Its strikes treat Defence as 10 minus the target's Courage (Blades of the Dead). */
  blades?: boolean;
  /** Kinds it hates (+1 to wound) and its ancient enemies (re-roll 1s to wound). */
  hates?: string[];
  ancient?: string[];
  /** Its Courage, for an enemy with Blades of the Dead. */
  c?: number;
  /** Per enemy: the Defence its strikes roll against, the bonus to wound and whether 1s are re-rolled (see resolve.adjustFight). */
  vs?: Record<string, { d: number; wound: number; ones: boolean }>;
  /** What its wargear and rules do, for the fight card. */
  notes?: string[];
  // Cavalry and monsters (see cavalry.ts and monsters.ts):
  /** A rider's mount, which an enemy that wins may strike instead of the rider (aiming at `<id>#mount`). */
  mount?: { name: string; d: number; s: number; chariot?: boolean };
  /** It charged, and gets the bonus for it: +1 Attack, and the foes it beats are knocked down. */
  charged?: 'cavalry' | 'monster' | 'chariot' | 'beast';
  /** A monster: each enemy its strikes slay earns a free strike on every model that was supporting it. */
  monster?: boolean;
  /** Wounds it has left, so a monster can tell when a strike slays it. */
  left?: number;
}

/** A Brutal Power Attack a winning monster makes instead of its strikes (see monsters.ts). */
export interface BrutalAttack {
  by: string;
  /** The usual three, and the Trolls' own (see trolls.ts): Mince 'em Fine, Roast 'em Slowly, Squash 'em into Jelly. */
  kind: BrutalKind;
  /** The enemy it rends or hurls; for a hurl, `at` is the enemy it would like to throw it at. */
  target?: string;
  at?: string;
}

export const BRUTAL_KINDS = ['rend', 'barge', 'hurl', 'mince', 'roast', 'squash'] as const;
export type BrutalKind = (typeof BRUTAL_KINDS)[number];
/** The Trolls' own Brutal Power Attacks, worked out once the strikes are done (see trolls.ts). */
export const TROLL_BRUTALS = new Set<BrutalKind>(['mince', 'roast', 'squash']);

/** How a fight tied on dice and Fight is settled: which side is Good, and which sides fight with Elven weapons. */
export interface DrawRule {
  good: 0 | 1;
  elven: [boolean, boolean];
}

export interface FightRequest {
  sides: [Fighter[], Fighter[]];
  /** Who each side strikes if it wins: the id of a model on the other side. */
  targets: [string, string];
  /** The losing side can't back away, so the winner's strikes are doubled. */
  trapped: boolean;
  /** The combat this resolves, so the turn tracker can tick it off. */
  combat?: string;
  /** Where each striking model puts its strikes, one target id per strike; any left over go at `targets`. */
  aims?: Record<string, string[]>;
  /** Set by the game when the two sides are Good and Evil (never taken from a player's request). */
  draw?: DrawRule;
  /** A winning monster's Brutal Power Attack, chosen by its player before the strikes. */
  brutal?: BrutalAttack;
  /** Set by the game: who supports whom on each side, for a monster's free strikes. */
  backing?: Record<string, string[]>;
}

export interface ShotRequest {
  shooter: { id: string; name: string; weapon: string; shoot: number; s: number; shots: number };
  target: { id: string; name: string; d: number; mount?: { name: string; d: number; monster?: boolean; chariot?: boolean } };
  /** Sharpshooter: hits go to the part of a rider and mount aimed at (`atMount`), with no roll for which is hit. */
  sharp?: boolean;
  atMount?: boolean;
  /** Aimed at a war beast's Howdah rather than the beast. */
  atHowdah?: boolean;
  /** A Mordor War Catapult loosing Severed Heads instead of rocks. */
  heads?: boolean;
  /** An engine's Siege Veteran keeps its Might rather than spending it on the shot. */
  keepMight?: boolean;
  /** Things in the way (models or terrain): each needs a 4+ for the shot to get past. */
  obstacles: number;
  /** A throwing weapon thrown in the Move phase as the shooter charges its target. */
  charge?: boolean;
  /** A flaming brand thrown (Weathertop): a model it hits is Set Ablaze rather than wounded. */
  brand?: boolean;
  /** What's in the way, nearest first, worked out by the game from the table; a model in the way that stops the shot is hit. */
  inWay?: { name: string; id?: string; d?: number }[];
  /** Shooting into a fight: the shooter's friend a stray shot hits instead (on a 1-3). */
  stray?: { id: string; name: string; d: number };
  /** Heroic Accuracy: failed In the Way tests are re-rolled. */
  rerolls?: boolean;
  /** To wound, re-roll 1s (Poisoned Attacks) or every miss (Bane of Kings). */
  ones?: boolean;
  bane?: boolean;
}

export interface FightOutcome {
  winner: 0 | 1;
  /** Why the winner won: higher die, higher Fight, or a roll-off. */
  how: 'dice' | 'fight' | 'roll-off';
  /** The first model struck, and the wounds caused to it. */
  target: Fighter | undefined;
  wounds: number;
  /** Every model struck and the wounds each takes (a rider's mount as `<id>#mount`). */
  hits: { target: Fighter; wounds: number }[];
  /** The winning monster barged or hurled, so the fight ended without strikes. */
  ended?: 'barge' | 'hurl';
  /** Enemies a Mattock knocked down before the strikes. */
  knocked?: string[];
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
      ...(f?.support === true ? { support: true } : {}),
      ...(f?.shielding === true ? { shielding: true } : {}),
      ...(f?.twoHanded === true ? { twoHanded: true } : {}),
    }));
  const sides: [Fighter[], Fighter[]] = [side(o.sides[0]), side(o.sides[1])];
  if (!sides[0].length || !sides[1].length) return null;
  const t = Array.isArray(o.targets) ? o.targets : [];
  const combat = typeof o.combat === 'string' ? o.combat.slice(0, 2000) : undefined;
  const aims: Record<string, string[]> = {};
  if (o.aims && typeof o.aims === 'object')
    for (const [k, v] of Object.entries(o.aims).slice(0, 20)) if (Array.isArray(v)) aims[String(k).slice(0, 64)] = v.slice(0, 10).map(x => String(x).slice(0, 72));
  const b = o.brutal;
  const brutal = b && typeof b === 'object' && (BRUTAL_KINDS as readonly string[]).includes(String(b.kind)) ? { by: String(b.by ?? '').slice(0, 64), kind: b.kind, ...(b.target ? { target: String(b.target).slice(0, 72) } : {}), ...(b.at ? { at: String(b.at).slice(0, 64) } : {}) } : undefined;
  return { sides, targets: [String(t[0] ?? ''), String(t[1] ?? '')], trapped: o.trapped === true, ...(combat ? { combat } : {}), ...(Object.keys(aims).length ? { aims } : {}), ...(brutal ? { brutal } : {}) };
}

const names = (side: Fighter[]) => {
  const main = side.filter(f => !f.support);
  const list = main.length ? main : side;
  return list.length === 1 ? list[0].name : `${list[0].name} +${list.length - 1}`;
};

/** A roll that shows a duel has been settled: a strike, the winner's note, or the roll that broke a tie. */
export const duelSettled = (r: DiceRoll) => !!r.against || !!r.note || r.label.startsWith('Roll-off') || r.label.startsWith('Drawn fight');

/** Whose wounds from a fight or shot have been taken off already: the whole group (older games) or this model's share. */
export const woundsTaken = (applied: string[] | undefined, group: string, victim?: string) => !!applied?.includes(group) || (!!victim && !!applied?.includes(`${group}>${victim}`));

/** Wounds caused by a group of rolls: successes on strikes, counting only follow-up dice for 6/4 results. */
export function strikeWounds(rolls: DiceRoll[]): number {
  return rolls
    .filter(r => r.against && r.target)
    .reduce((n, r) => {
      const hits = r.then && r.follow ? r.follow.filter(d => d >= r.then!) : r.dice.filter(d => d >= r.target!);
      // (Grasper & Keeper: a natural 6 does 2.)
      return n + hits.length * (r.per ?? 1) + (r.sixes ? hits.filter(d => d === 6).length : 0);
    }, 0);
}

/** A die in a duel as it counts: with its model's modifier, though some keep a natural 6 a 6. */
export const duelScore = (r: DiceRoll, d: number) => (r.mod && !(r.sixSafe && d === 6) ? Math.max(1, Math.min(6, d + r.mod)) : d);

/** A To Wound need made easier (a positive bonus) or harder, on both dice of a 6/4+ need; never better than 2+ or worse than 6+. */
export function shiftNeed(need: { target: number; then?: number }, bonus: number): { target: number; then?: number } {
  if (!bonus) return need;
  const at = (n: number) => Math.max(2, Math.min(6, n - bonus));
  return need.then ? { target: at(need.target), then: at(need.then) } : { target: at(need.target) };
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
        // The D3 is rolled once, at the hero's first fight, and lasts the whole phase.
        const bonus = f.strikeBonus ?? Math.ceil(d6() / 2);
        fv = Math.min(10, fv + bonus);
        if (f.strikeBonus === undefined) push(`Heroic Strike: ${f.name} +${bonus} Fight`, [bonus], { model: f.id });
      }
      const mod = f.duelMod ? `, ${f.duelMod > 0 ? '+' : ''}${f.duelMod}${f.sixSafe ? ' bar 6s' : ''}` : '';
      // Dori re-rolls his 1s.
      const dice = Array.from({ length: f.support ? 1 : f.a }, d6).map(d => (f.duelOnes && d === 1 ? d6() : d));
      push(`${f.support ? 'Supporting' : f.shielding ? 'Shielding' : 'Duel'}: ${f.name} (F${fv}${mod}${f.duelOnes ? ', 1s re-rolled' : ''})`, dice, {
        model: f.id,
        f: fv,
        side: i as 0 | 1,
        ...(f.support ? { support: true } : {}),
        ...(f.duelMod ? { mod: f.duelMod, ...(f.sixSafe ? { sixSafe: true } : {}) } : {}),
      });
    }
  });
  return rolls;
}

/** Who is winning a duel from its rolls (after any Might): the highest die, then the highest Fight; null if it needs a roll-off. */
export function duelLeader(rolls: DiceRoll[]): { winner: 0 | 1; how: 'dice' | 'fight' } | null {
  const duel = rolls.filter(r => r.side !== undefined && r.f !== undefined);
  const best = [0, 1].map(s => Math.max(0, ...duel.filter(r => r.side === s).flatMap(r => r.dice.map(d => duelScore(r, d)))));
  const fight = [0, 1].map(s => Math.max(0, ...duel.filter(r => r.side === s).map(r => r.f!)));
  if (best[0] !== best[1]) return { winner: best[0] > best[1] ? 0 : 1, how: 'dice' };
  if (fight[0] !== fight[1]) return { winner: fight[0] > fight[1] ? 0 : 1, how: 'fight' };
  return null;
}

/**
 * Rolls the winner's strikes for a duel already rolled. `duel` is that duel's rolls, as the log now has them.
 * `cornered` says whether the model being struck can't back away, which doubles the strikes as `trapped` does.
 * `defended` is set when the fight is over a defended wall, ledge or doorway: if the attackers' side wins, each of its
 * strikes needs an In the Way roll (4+) before it can wound.
 */
export function resolveStrikes(req: FightRequest, duel: DiceRoll[], d6: D6, by: Role, group: string, now = Date.now(), cornered?: (winner: 0 | 1, target: string) => boolean, defended?: { attackers: 0 | 1; name: string }): { rolls: DiceRoll[]; outcome: FightOutcome } {
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) =>
    rolls.push({ id: `${group}-${duel.length + rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  const lead = duelLeader(duel);
  let winner: 0 | 1;
  let how: FightOutcome['how'];
  if (lead) ({ winner, how } = lead);
  else if (req.draw) {
    // A drawn fight between Good and Evil: one die decides, 4+ for Good. An Elven weapon on one side only shifts it by one.
    how = 'roll-off';
    const { good, elven } = req.draw;
    const need = elven[good] && !elven[1 - good] ? 3 : elven[1 - good] && !elven[good] ? 5 : 4;
    const r = d6();
    push(`Drawn fight: ${need}+ for ${names(req.sides[good])}, Good`, [r], { target: need });
    winner = r >= need ? good : ((1 - good) as 0 | 1);
  } else {
    how = 'roll-off';
    let r: number[];
    do r = [d6(), d6()];
    while (r[0] === r[1]);
    push(`Roll-off: ${names(req.sides[0])} vs ${names(req.sides[1])}`, r);
    winner = r[0] > r[1] ? 0 : 1;
  }

  // Supporting models aren't in the fight, so they can't be struck; a rider's mount can be, instead of the rider (and
  // a hero's chariot must be: the hero can't be struck apart from it).
  const losers = req.sides[1 - winner].filter(f => !f.support);
  const pool = losers.flatMap(l => {
    if (!l.mount) return [l];
    const steed = { id: `${l.id}#mount`, name: `${l.name}'s ${l.mount.name}`, f: 1, a: 1, s: l.mount.s, d: l.mount.d };
    return l.mount.chariot ? [steed] : [l, steed];
  });
  const main = pool.find(f => f.id === req.targets[winner]) ?? pool[0];
  const trappedFor = new Map<string, boolean>();
  const isTrapped = (t: Fighter) => {
    const id = t.id.replace(/#mount$/, '');
    if (!trappedFor.has(id)) trappedFor.set(id, req.trapped || !!cornered?.(winner, id));
    return trappedFor.get(id)!;
  };
  const idle: string[] = [];
  // A winning monster's Barge or Hurl ends the fight there: nobody strikes.
  const brute = req.brutal && req.sides[winner].find(f => f.id === req.brutal!.by && f.monster && !f.support);
  const ended = brute && (req.brutal!.kind === 'barge' || req.brutal!.kind === 'hurl') ? req.brutal!.kind : undefined;
  /** One batch of strikes by `f` at `target`, rolled and logged; the wounds they do. */
  const strike = (f: Fighter, target: Fighter, n: number, free = false, opt: { s?: number; single?: boolean; label?: string } = {}) => {
    const trapped = !opt.single && isTrapped(target);
    // Its wargear and rules against this enemy (two-handed weapons, Hatred and so on), a Heroic Challenge's rival,
    // and Backstabbers against a trapped enemy.
    const vs = f.vs?.[target.id] ?? { d: target.d, wound: f.woundMod ?? 0, ones: !!f.ones };
    const printed = woundNeed(opt.s ?? f.s, vs.d);
    const plain = f.woundCap && !opt.s && (!printed || printed.then || printed.target > f.woundCap) ? { target: f.woundCap } : printed;
    const bonus = opt.s ? 0 : vs.wound + (f.rival === target.id ? 1 : 0) + (f.backstab && trapped ? 1 : 0);
    const base = plain && shiftNeed(plain, bonus);
    // Heroic Defence: only natural 6s wound (both dice for 6/4+ style results).
    const need = base && target.defence ? { target: 6, ...(base.then ? { then: 6 } : {}) } : base;
    if (!need) return 0;
    let strikes = n * (trapped ? 2 : 1);
    if (defended && defended.attackers === winner) {
      // Striking over the defences: only those that get past them can wound.
      const past = Array.from({ length: strikes }, d6);
      const through = past.filter(d => d >= 4).length;
      push(`In the Way: ${f.name} strikes over ${defended.name} (4+ gets past)`, past, { target: 4, model: f.id, ...(through ? {} : { note: `${defended.name[0].toUpperCase()}${defended.name.slice(1)} stops ${f.name}'s strikes` }) });
      strikes = through;
      if (!strikes) return 0;
    }
    // Misses are re-rolled (Enchant Blades, Bane of Kings), or else just 1s (Poisoned Attacks, Ancient Enemies).
    const again = (d: number, at: number) => (f.reroll && !opt.s ? (d >= at ? d : d6()) : vs.ones && !opt.s && d === 1 ? d6() : d);
    const dice = Array.from({ length: strikes }, d6).map(d => again(d, need.target));
    const follow = need.then ? dice.filter(d => d >= need.target).map(d6).map(d => again(d, need.then!)) : undefined;
    const plain2 = !opt.s;
    const sixes = plain2 && f.sixes;
    const what = [free && 'a free strike', trapped && 'trapped', plain2 && (f.reroll ? 're-rolling misses' : vs.ones && 're-rolling 1s'), bonus > 0 && `+${bonus} to wound`, bonus < 0 && `${bonus} to wound`, plain2 && f.mighty && '2 wounds each', sixes && '6s do 2 wounds'].filter(Boolean).join(', ');
    const label = opt.label ? `${opt.label} (${formatNeed(need)})` : `${f.name} strikes ${target.name}${what ? `, ${what},` : ''} (${formatNeed(need)})`;
    push(label, dice, { target: need.target, against: target.id, model: f.id, ...(need.then ? { then: need.then, follow } : {}), ...(plain2 && f.mighty ? { per: 2 } : {}), ...(sixes ? { sixes: true } : {}) });
    return strikeWounds([rolls[rolls.length - 1]]);
  };
  // A Mattock swung to knock a foe down comes before anyone strikes: each rolls a D6 and adds its Strength, and the
  // wielder knocks the foe down if it scores as high. (A foe knocked down is then trapped.)
  const knocked: string[] = [];
  for (const f of ended ? [] : req.sides[winner]) {
    const foe = f.knock && !f.noStrike && !f.support ? pool.find(t => t.id === f.knock && !t.id.endsWith('#mount')) : undefined;
    if (!foe) continue;
    const dice = [d6(), d6()];
    const down = dice[0] + f.s >= dice[1] + foe.s;
    push(`Mattock: ${f.name} tries to knock ${foe.name} down, ${dice[0] + f.s} v ${dice[1] + foe.s} (D6 + Strength)`, dice, { model: f.id });
    if (down) {
      knocked.push(foe.id);
      trappedFor.set(foe.id, true);
    }
  }
  for (const f of ended ? [] : req.sides[winner]) {
    if (f.noStrike) {
      idle.push(`${f.name} (${f.noStrike})`);
      continue;
    }
    if (f.knock && pool.some(t => t.id === f.knock)) {
      idle.push(`${f.name} (${knocked.includes(f.knock) ? 'knocked a foe down' : 'tried to knock a foe down'})`);
      continue;
    }
    // A Troll's own Brutal Power Attack comes after the strikes (see trolls.ts).
    if (f === brute && TROLL_BRUTALS.has(req.brutal!.kind)) continue;
    // Bifur's headbutt: one Strength 4 strike, never doubled.
    const butt = f.headbutt ? pool.find(t => t.id === f.headbutt) : undefined;
    if (butt) {
      strike(f, butt, 1, false, { s: 4, single: true, label: `${f.name} headbutts ${butt.name}, S4` });
      continue;
    }
    if (f === brute) {
      // Rend: as many To Wound rolls as it has Attacks, against the victim's Strength rather than its Defence.
      const victim = pool.find(t => t.id === req.brutal!.target) ?? main;
      const need = woundNeed(f.s, victim.s);
      if (need) {
        const dice = Array.from({ length: f.a }, d6);
        const follow = need.then ? dice.filter(d => d >= need.target).map(d6) : undefined;
        push(`Rend: ${f.name} tears at ${victim.name}, S${f.s} vs its S${victim.s} (${formatNeed(need)})`, dice, { target: need.target, against: victim.id, model: f.id, ...(need.then ? { then: need.then, follow } : {}) });
      }
      continue;
    }
    // Its strikes, each at the model it chose (any not aimed go at the main target).
    const count = f.support ? 1 : f.a;
    // (Not at an enemy it may not strike: they go at another, if there is one.)
    const open = pool.filter(t => !f.spare?.includes(t.id.replace(/#mount$/, '')));
    if (!open.length) {
      idle.push(`${f.name} (won't strike ${pool[0]?.name ?? 'it'})`);
      continue;
    }
    const aimed = (req.aims?.[f.id] ?? []).map(id => open.find(l => l.id === id)).filter((t): t is Fighter => !!t);
    const first = open.includes(main) ? main : open[0];
    const at = Array.from({ length: count }, (_, i) => aimed[i] ?? first);
    for (const target of [...new Set(at)]) {
      const wounds = strike(f, target, at.filter(t => t === target).length);
      // A monster that slays a model gets a free strike on each model that was supporting it.
      if (f.monster && target.left !== undefined && wounds >= target.left)
        for (const id of req.backing?.[target.id] ?? []) {
          const helper = req.sides[1 - winner].find(x => x.id === id && x.support);
          if (helper) strike(f, helper, 1, true);
        }
    }
  }
  // The Oakenshield: Thorin, Shielding and winning, hits one foe with it.
  for (const f of ended ? [] : req.sides[winner]) {
    const foe = f.oak && f.shielding ? pool.find(t => t.id === f.oak) ?? main : undefined;
    if (foe) strike(f, foe, 1, false, { s: 4, single: true, label: `The Oakenshield: ${f.name} hits ${foe.name}, S4` });
  }
  if (ended && brute) push(`${brute.name} ${ended === 'barge' ? 'barges its foes aside' : 'hurls one of its foes'}: no strikes this fight`, []);
  const struckAt = [...pool, ...req.sides[1 - winner].filter(f => f.support)];
  const hits = struckAt.map(t => ({ target: t, wounds: strikeWounds(rolls.filter(r => r.against === t.id)) })).filter(h => rolls.some(r => r.against === h.target.id));
  const why = how === 'dice' ? 'higher roll' : how === 'fight' ? 'higher Fight' : req.draw ? 'drawn fight' : 'roll-off';
  const note = `${names(req.sides[winner])} wins the duel (${why})${idle.length ? `. No strikes from ${idle.join(', ')}` : ''}`;
  if (rolls.some(r => r.against || r.label.startsWith('In the Way')) || ended) {
    const last = rolls[rolls.length - 1];
    last.note = (last.note ? `${note}. ${last.note}` : note).slice(0, 200);
  }
  else push(idle.length ? `${names(req.sides[winner])} makes no strikes` : `${names(req.sides[winner])} can't wound ${main.name}`, [], { note });
  const lead1 = hits[0];
  return { rolls, outcome: { winner, how, target: lead1?.target ?? main, wounds: lead1?.wounds ?? 0, hits, ...(ended ? { ended } : {}), ...(knocked.length ? { knocked } : {}) } };
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
    ...(o.charge === true ? { charge: true } : {}),
    ...(o.brand === true ? { brand: true } : {}),
    ...(o.atMount === true ? { atMount: true } : {}),
    ...(o.atHowdah === true ? { atHowdah: true } : {}),
    ...(o.heads === true ? { heads: true } : {}),
    ...(o.keepMight === true ? { keepMight: true } : {}),
  };
}

/** Thrown to stop a shot part way, for its player to spend Might (see resolveShot). */
const PAUSE = Symbol('pause');

/** A shot request kept while it waits on Might, including what the game worked out (what's in the way and so on). */
export function cleanPausedShot(raw: unknown): ShotRequest | null {
  const base = cleanShot(raw);
  const o = raw as Partial<ShotRequest>;
  if (!base) return null;
  const str = (v: unknown, n: number) => String(v ?? '').slice(0, n);
  const inWay = Array.isArray(o.inWay) ? o.inWay.slice(0, 6).map(w => ({ name: str(w?.name, 40), ...(w?.id ? { id: str(w.id, 64), d: clamp(w.d, 1, 10, 4) } : {}) })) : undefined;
  return {
    ...base,
    ...(inWay ? { inWay, obstacles: inWay.length } : {}),
    ...(o.stray?.id ? { stray: { id: str(o.stray.id, 64), name: str(o.stray.name, 40), d: clamp(o.stray.d, 1, 10, 4) } } : {}),
    ...(o.rerolls === true ? { rerolls: true } : {}),
    ...(o.ones === true ? { ones: true } : {}),
    ...(o.bane === true ? { bane: true } : {}),
    ...(o.sharp === true ? { sharp: true } : {}),
    ...(o.target?.mount && typeof o.target.mount === 'object' ? { target: { ...base.target, mount: { name: str(o.target.mount.name, 40), d: clamp(o.target.mount.d, 1, 10, 4), ...(o.target.mount.monster === true ? { monster: true } : {}), ...(o.target.mount.chariot === true ? { chariot: true } : {}) } } } : {}),
  };
}

/**
 * Whether a shooting roll is worth stopping on for its hero to spend Might: a roll to hit, to get past something or
 * to wound, with a die that missed by no more than the Might the hero has.
 */
export const mightCouldHelp = (r: DiceRoll, might: number) => r.target !== undefined && r.then === undefined && might > 0 && r.dice.some(d => d < r.target! && r.target! - d <= might);

/**
 * Resolves a shooting attack: to hit, an In the Way test for each thing in the way (a model that stops the shot is
 * hit instead), the test for which model in a fight is hit, then to wound each model hit.
 * A shot can stop after any roll that `pause` picks out, so a hero can spend Might on it; it then carries on from
 * `logged` (its rolls so far, as the log has them now), rolling only what comes after. `paused` says it stopped.
 */
export function resolveShot(req: ShotRequest, d6: D6, by: Role, group: string, now = Date.now(), logged: DiceRoll[] = [], pause?: (r: DiceRoll) => boolean): { rolls: DiceRoll[]; wounds: number; hits: { id: string; wounds: number }[]; paused?: boolean; ablaze?: string[] } {
  const rolls: DiceRoll[] = [];
  let k = 0;
  /** The next roll of the shot: the one already in the log, or a fresh one. */
  const take = (label: string, count: number, extra: Partial<DiceRoll> = {}, then?: number): DiceRoll => {
    if (k < logged.length) return logged[k++];
    const dice = Array.from({ length: count }, d6);
    const follow = then !== undefined && extra.target !== undefined ? dice.filter(d => d >= extra.target!).map(d6) : undefined;
    const r: DiceRoll = { id: `${group}-${k}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra, ...(follow ? { then, follow } : {}) };
    k++;
    rolls.push(r);
    if (pause?.(r)) throw PAUSE;
    return r;
  };
  try {
    return finishShot(req, take);
  } catch (e) {
    if (e !== PAUSE) throw e;
    return { rolls, wounds: 0, hits: [], paused: true };
  }

  function finishShot(req: ShotRequest, take: (label: string, count: number, extra?: Partial<DiceRoll>, then?: number) => DiceRoll) {
  const { shooter, target } = req;
  const toHit = take(`${shooter.name} ${req.charge ? 'throws at' : 'shoots'} ${target.name} (${shooter.weapon}, ${shooter.shoot}+)`, shooter.shots, {
    target: shooter.shoot,
    model: shooter.id,
    aim: target.id,
    ...(req.charge ? { charge: true } : {}),
  }).dice;
  // A natural 6 always hits.
  let flying = toHit.filter(d => d >= Math.min(6, shooter.shoot)).length;
  const struck: { id: string; name: string; d: number; count: number }[] = [];
  const strike = (id: string, name: string, d: number, count: number) => {
    const at = struck.find(x => x.id === id);
    if (at) at.count += count;
    else if (count > 0) struck.push({ id, name, d, count });
  };
  // Each test lets 4+ through; Heroic Accuracy re-rolls the ones that fail.
  const test = (label: string) => {
    const dice = take(label, flying, { target: 4, model: shooter.id }).dice;
    let past = dice.filter(d => d >= 4).length;
    if (req.rerolls && past < dice.length) {
      const again = take(`${label.replace(/ \(.*$/, '')} re-rolled (Heroic Accuracy)`, dice.length - past, { target: 4, model: shooter.id }).dice;
      past += again.filter(d => d >= 4).length;
    }
    return past;
  };
  const inWay = req.inWay ?? Array.from({ length: req.obstacles }, (_, i) => ({ name: `obstacle ${i + 1}` }) as { name: string; id?: string; d?: number });
  let stoppedBy = '';
  for (const o of inWay) {
    if (flying < 1) break;
    const past = test(`In the Way: ${o.name} (4+ gets past)`);
    if (past < flying && !stoppedBy) stoppedBy = o.name;
    if (o.id) strike(o.id, o.name, o.d ?? 4, flying - past);
    flying = past;
  }
  if (req.stray && flying > 0) {
    const past = test(`Into the fight: 4+ hits ${target.name}, else ${req.stray.name}`);
    strike(req.stray.id, req.stray.name, req.stray.d, flying - past);
    flying = past;
  }
  // A hit on a rider may strike its mount instead: 1-3 hits the mount (1-4 for a monster), unless a Sharpshooter
  // picked which to hit.
  const mount = target.mount;
  if (mount && flying > 0) {
    const steed = { id: `${target.id}#mount`, name: `${target.name}'s ${mount.name}` };
    // A hero's chariot takes every hit: the hero can't be shot apart from it.
    if (mount.chariot) {
      strike(steed.id, steed.name, mount.d, flying);
      flying = 0;
    } else if (req.sharp) {
      if (req.atMount) {
        strike(steed.id, steed.name, mount.d, flying);
        flying = 0;
      }
    } else {
      const need = mount.monster ? 5 : 4;
      const part = take(`Rider or mount: ${need}+ hits ${target.name}, else the ${mount.name}`, flying, { target: need, model: shooter.id }).dice;
      const rider = part.filter(d => d >= need).length;
      strike(steed.id, steed.name, mount.d, flying - rider);
      flying = rider;
    }
  }
  strike(target.id, target.name, target.d, flying);
  // A flaming brand doesn't wound: whatever it hits is Set Ablaze.
  if (req.brand) {
    if (!rolls.length) rolls.push({ id: `${group}-${k}`, by, label: `${shooter.name}'s throw`, dice: [], at: now, group });
    rolls[rolls.length - 1].note = struck.length ? `${struck.map(v => v.name).join(', ')} ${struck.length > 1 ? 'are' : 'is'} Set Ablaze` : stoppedBy ? `The brand hits the ${stoppedBy}` : `${shooter.name} misses ${target.name}`;
    return { rolls, wounds: 0, hits: [], ablaze: struck.map(v => v.id) };
  }
  const hits: { id: string; wounds: number }[] = [];
  for (const v of struck) {
    const need = woundNeed(shooter.s, v.d);
    if (!need) continue;
    const r = take(`To wound ${v.name}: S${shooter.s} vs D${v.d} (${formatNeed(need)})`, v.count, { target: need.target, against: v.id, model: shooter.id }, need.then);
    let wounds = strikeWounds([r]);
    // Poisoned shots re-roll their 1s, Bane of Kings every die that didn't wound (the first die of a 6/4+ need).
    const again = req.bane ? r.dice.filter(d => d < need.target).length : req.ones ? r.dice.filter(d => d === 1).length : 0;
    if (again) wounds += strikeWounds([take(`To wound ${v.name} again: ${req.bane ? 'misses' : '1s'} re-rolled (${formatNeed(need)})`, again, { target: need.target, against: v.id, model: shooter.id }, need.then)]);
    hits.push({ id: v.id, wounds });
  }
  const onTarget = hits.find(h => h.id === target.id)?.wounds ?? 0;
  const others = struck.filter(v => v.id !== target.id).map(v => v.name);
  // A shot carried on after a pause may have nothing left to roll: its outcome goes on a line of its own.
  if (!rolls.length) rolls.push({ id: `${group}-${k}`, by, label: `${shooter.name}'s shot`, dice: [], at: now, group });
  rolls[rolls.length - 1].note = struck.length
    ? struck.some(v => v.id === target.id)
      ? !woundNeed(shooter.s, target.d)
        ? `${shooter.weapon} can't wound ${target.name}`
        : `${shooter.name} hits ${target.name}${others.length ? ` and ${others.join(', ')}` : ''}`
      : `${shooter.name} hits ${others.join(', ')} instead`
    : stoppedBy
      ? `The shot hits the ${stoppedBy}`
      : `${shooter.name} misses ${target.name}`;
  return { rolls, wounds: onTarget, hits };
  }
}
