// Monsters, and what a charge does: a cavalry charge (and a Monstrous Charge) adds an Attack and knocks the foe to the
// ground, a monster's kills earn free strikes on the models backing up its victim, and a monster that wins may make a
// Brutal Power Attack instead of striking: Rend, Barge or Hurl.
import type { Catalog } from './catalog.ts';
import { modelStats, rulesFor } from './catalog.ts';
import { hitModel, mountOf, mounted } from './cavalry.ts';
import { distanceBetween, halfExtents } from './geometry.ts';
import { declared } from './heroics.ts';
import { under } from './powers.ts';
import { inDifficult, sightTo } from './sight.ts';
import { immovable, isChariot, isWarBeast } from './warBeasts.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const rules = (catalog: Catalog | null | undefined, m: Model) => rulesFor(catalog, m);

export { isChariot, isWarBeast };

// Our data has no Monster keyword. Monsters are the models with Monstrous Charge, and the great creatures that count
// as several models (Dominant 3 or more): trolls, Ents, dragons, the Balrog. Spirits and Sauron count as many, but
// aren't monsters.
const NOT_MONSTER = /sauron|necromancer|shade|wraith|dweller in the dark/i;

/** Whether a model is a Monster: by its profile, or a rider on a monstrous mount (a Fell Beast, a Great Eagle). */
export function isMonster(catalog: Catalog | null | undefined, m: Model): boolean {
  if (m.steed) return /fell beast|great eagle/i.test(m.steed);
  if (mountOf(m)?.monster) return true;
  const unit = unitOf(catalog, m);
  if (!unit || isWarBeast(catalog, m) || isChariot(catalog, m) || m.aboard || unit.type === 'Siege Engine') return false;
  if (unit.rules.includes('Monstrous Charge')) return true;
  const dominant = unit.rules.map(r => /^Dominant ?\((\d+)\)/.exec(r)).find(Boolean);
  return !!dominant && Number(dominant[1]) >= 3 && !NOT_MONSTER.test(unit.name);
}

/** An infantry model: on foot, and not a war beast or chariot (a monster on foot is still infantry). */
export const isInfantry = (catalog: Catalog | null | undefined, m: Model) => !mounted(m) && !isWarBeast(catalog, m) && !isChariot(catalog, m);

/** Whether a model carries a lance (or a war spear, which is a lance on horseback). */
export const hasLance = (catalog: Catalog | null | undefined, m: Model) => {
  const gear = [...(unitOf(catalog, m)?.wargear ?? []), ...(m.options ?? [])].map(g => g.toLowerCase());
  const lost = (m.lostGear ?? []).map(g => g.toLowerCase());
  return gear.some(g => /\blance\b|war spear/.test(g) && !lost.includes(g));
};

/**
 * The bonus a model gets for charging in this fight: 'cavalry' for a rider that charged, fighting only infantry, out
 * of difficult terrain and not Transfixed, or across a defended wall; 'monster' for one with Monstrous Charge that
 * charged. Undefined if it gets none.
 */
export function chargeBonus(state: GameState, catalog: Catalog | null | undefined, m: Model, foes: Model[], overWall: boolean): 'cavalry' | 'monster' | 'chariot' | 'beast' | undefined {
  if (!state.flow.charges?.[m.id] || overWall) return undefined;
  // A chariot that charged (+1 Attack, knocks down those it beats); a war beast that ended its Trample in the fight
  // (it knocks down the weaker foes it beats).
  if (isChariot(catalog, m)) return 'chariot';
  if (isWarBeast(catalog, m)) return state.flow.trampled?.includes(m.id) ? 'beast' : undefined;
  // Spectral Walk and the like don't count the ground as difficult, so keep their charge bonuses (Rulebook FAQ).
  if (under(state, m, 'Transfix') || inDifficult(state, m, m.owner, m.ground)) return undefined;
  if (mounted(m)) return foes.length && foes.every(f => isInfantry(catalog, f)) ? 'cavalry' : undefined;
  return rules(catalog, m).includes('Monstrous Charge') ? 'monster' : undefined;
}

/**
 * What charging gives a model in this fight: an extra Attack (and knocking foes down) for a cavalry charge or a
 * Monstrous Charge, and +1 to wound for a rider's lance (not in difficult ground, nor against a defended wall); with
 * the notes for the fight card.
 */
const CHARGE_NOTES = {
  cavalry: 'Cavalry charge: +1 Attack, knocks infantry down',
  monster: 'Monstrous Charge: +1 Attack, knocks weaker foes down',
  chariot: 'Chariot charge: +1 Attack, knocks infantry and cavalry down',
  beast: 'Irresistible Force: knocks down foes no stronger than it',
};

export function chargeEffects(state: GameState, catalog: Catalog | null | undefined, m: Model, foes: Model[], overWall: boolean): { bonus?: 'cavalry' | 'monster' | 'chariot' | 'beast'; lance: boolean; notes: string[] } {
  const bonus = chargeBonus(state, catalog, m, foes, overWall);
  const lance = mounted(m) && !isChariot(catalog, m) && !!state.flow.charges?.[m.id] && !overWall && !inDifficult(state, m, m.owner, m.ground) && hasLance(catalog, m);
  const notes = [
    ...(bonus ? [CHARGE_NOTES[bonus]] : []),
    ...(lance ? ['Lance: +1 to wound on the charge'] : []),
  ];
  return { ...(bonus ? { bonus } : {}), lance, notes };
}

/**
 * Who a charger that won knocks to the ground: a cavalry charge fells the infantry it fought, bar monsters and
 * Strength 6 or more; a Monstrous Charge fells those of lower Strength, and throws riders from their mounts.
 * Returns the ids knocked Prone and the riders knocked flying.
 */
export function knockedDown(catalog: Catalog | null | undefined, kind: 'cavalry' | 'monster' | 'chariot' | 'beast', strength: number, losers: Model[]): { prone: string[]; flying: string[] } {
  const prone: string[] = [];
  const flying: string[] = [];
  for (const l of losers) {
    // War beasts and chariots are never knocked down.
    if (l.dead || immovable(catalog, l)) continue;
    const s = modelStats(catalog, l)?.S ?? 3;
    if (kind === 'cavalry') {
      if (isInfantry(catalog, l) && !isMonster(catalog, l) && s < 6) prone.push(l.id);
    } else if (kind === 'chariot') {
      if (!isMonster(catalog, l)) (mounted(l) ? flying : prone).push(l.id);
    } else if (kind === 'beast' ? s <= strength : s < strength) (mounted(l) ? flying : prone).push(l.id);
  }
  return { prone, flying };
}

/** A Brutal Power Attack a winning monster may make instead of striking. */
export type Brutal = { by: string; kind: 'rend' | 'barge' | 'hurl'; target?: string; at?: string };

/** Whether a model may make a Brutal Power Attack this turn, and which: one a turn, and no Barge or Hurl after a Heroic Combat. */
export function brutalOptions(state: GameState, catalog: Catalog | null | undefined, m: Model): Brutal['kind'][] {
  // A Prone monster that wins its fight simply stands up (Rulebook FAQ).
  if (!isMonster(catalog, m) || m.prone || state.flow.brutal?.includes(m.id)) return [];
  return declared(state, m.id, 'Heroic Combat') ? ['rend'] : ['rend', 'barge', 'hurl'];
}

type D6 = () => number;
const radius = (m: Model) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

/** Whether a model could stand at a spot: on the table, and not on top of anyone else. */
function free(state: GameState, m: Model, p: { x: number; y: number }, skip: string[]): boolean {
  const r = radius(m);
  if (p.x - r < 0 || p.y - r < 0 || p.x + r > state.board.w || p.y + r > state.board.h) return false;
  return !Object.values(state.models).some(o => !o.dead && !o.escaped && !o.waiting && o.id !== m.id && !skip.includes(o.id) && distanceBetween({ ...m, ...p }, o) < 0.01);
}

/** A spot touching `target` for a model hurled at it, as near the monster as it can be. */
function landBeside(state: GameState, hurled: Model, target: Model, monster: Model): { x: number; y: number } | null {
  const d = radius(hurled) + radius(target) + 0.02;
  const toward = Math.atan2(monster.y - target.y, monster.x - target.x);
  for (const turn of [0, 25, -25, 50, -50, 75, -75, 100, -100, 125, -125, 150, -150, 180]) {
    const a = toward + (turn * Math.PI) / 180;
    const p = { x: target.x + Math.cos(a) * d, y: target.y + Math.sin(a) * d };
    if (free(state, hurled, p, [hurled.id])) return p;
  }
  return null;
}

/** A model that lands Prone, or a rider thrown from its mount. */
const fell = (m: Model): Action => ({ type: 'affect', id: m.id, patch: mounted(m) ? { throwPending: 'flying' } : { prone: true } });

/** Strength-S hits on a model, and on its mount too when it rides one. */
function hitsOn(m: Model, s: number, times: number, why: string, d6: D6, by: Seat, group: string, now: number, n: { k: number }, catalog: Catalog | null | undefined, credit: string[]) {
  const out: { actions: Action[]; wounds: number } = { actions: [], wounds: 0 };
  const d = modelStats(catalog, m)?.D ?? 4;
  const mount = mountOf(m);
  for (let i = 0; i < times; i++) {
    const h = hitModel(m, d, s, why, d6, by, `${group}-b${n.k++}`, now, group, false, credit);
    out.actions.push(...h.actions);
    out.wounds += h.wounds;
    if (mount) out.actions.push(...hitModel(m, mount.d, s, why, d6, by, `${group}-b${n.k++}`, now, group, true, credit).actions);
  }
  return out;
}

/**
 * A Hurl: the monster throws one enemy it beat (of lower Strength) up to D3" plus the difference in Strength. On a
 * passed Intelligence test it picks an enemy in sight and in reach to throw it at: the thrown model takes two
 * Strength 6 hits and lands Prone beside it, and the one it hits takes one and is knocked down unless Strength 6 or
 * more. Failing the test, the model just lands where the monster threw it, taking the two hits.
 */
export function hurl(state: GameState, catalog: Catalog | null | undefined, monster: Model, hurled: Model, prefer: string | undefined, d6: D6, by: Seat, group: string, now: number): { rolls: DiceRoll[]; actions: Action[]; at?: string } {
  const rolls: DiceRoll[] = [];
  const n = { k: 0 };
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) => {
    const r: DiceRoll = { id: `${group}-b${n.k++}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra };
    rolls.push(r);
    return r;
  };
  const ms = modelStats(catalog, monster);
  const hs = modelStats(catalog, hurled);
  const reach = Math.ceil(d6() / 2) + Math.max(0, (ms?.S ?? 6) - (hs?.S ?? 3));
  push(`Hurl: ${monster.name} throws ${hurled.name} ${reach}"`, [reach - Math.max(0, (ms?.S ?? 6) - (hs?.S ?? 3))]);
  // The monster's Intelligence, or its rider's if that's better.
  const need = Math.min(ms?.I ?? 7, mountOf(monster)?.i ?? 13);
  const test = [d6(), d6()];
  const passed = test[0] + test[1] >= need;
  push(`Intelligence test: ${monster.name} takes aim`, test, { sum: need });
  const taken = new Set(state.flow.hurledAt ?? []);
  const targets = passed
    ? Object.values(state.models)
        .filter(t => t.owner === hurled.owner && t.id !== hurled.id && !t.dead && !t.escaped && !t.waiting && !taken.has(t.id))
        .filter(t => distanceBetween(monster, t) <= reach + 1e-6 && sightTo(state, monster, t) !== 'hidden')
        .sort((a, b) => (b.id === prefer ? 1 : 0) - (a.id === prefer ? 1 : 0) || (b.tier ?? (b.hero ? 1 : 0)) - (a.tier ?? (a.hero ? 1 : 0)) || (b.points ?? 0) - (a.points ?? 0))
    : [];
  const target = targets[0];
  const actions: Action[] = [];
  const thrown = hitsOn(hurled, 6, 2, 'Hurled', d6, by, group, now, n, catalog, [monster.id]);
  actions.push(...thrown.actions);
  const lives = thrown.wounds < hurled.wounds || (hurled.hero && hurled.fate > 0);
  if (target) {
    if (lives) {
      const p = landBeside(state, hurled, target, monster);
      actions.push({ type: 'affect', id: hurled.id, patch: { ...(p ?? {}), ...(mounted(hurled) ? { throwPending: 'flying' } : { prone: true }) } });
    }
    actions.push(...hitsOn(target, 6, 1, `Hit by ${hurled.name}`, d6, by, group, now, n, catalog, [monster.id]).actions);
    if ((modelStats(catalog, target)?.S ?? 3) <= 5) actions.push(fell(target));
    rolls[rolls.length - 1].note = passed ? `${monster.name} hurls ${hurled.name} at ${target.name}.` : '';
  } else {
    // Nobody to throw it at: it lands straight on from the monster, as far as it was thrown.
    const a = Math.atan2(hurled.y - monster.y, hurled.x - monster.x);
    let p: { x: number; y: number } | null = null;
    for (let d = reach; d >= 0 && !p; d -= 0.5) {
      const q = { x: monster.x + Math.cos(a) * (d + radius(monster)), y: monster.y + Math.sin(a) * (d + radius(monster)) };
      if (free(state, hurled, q, [])) p = q;
    }
    if (lives) actions.push({ type: 'affect', id: hurled.id, patch: { ...(p ?? {}), ...(mounted(hurled) ? { throwPending: 'flying' } : { prone: true }) } });
    rolls[rolls.length - 1].note = passed ? `No one in reach to hit: ${hurled.name} just lands.` : `${monster.name} fails to take aim: ${hurled.name} just lands.`;
  }
  return { rolls, actions, at: target?.id };
}
