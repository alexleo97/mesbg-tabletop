// Cavalry: a rider and its mount, each with its own numbers. The mount carries the rider at its own Move, lends its
// Fight, Strength and Attacks when they're better, can be shot or struck instead of the rider, and throws its rider
// when it falls. A rider that dismounts, or loses its mount, fights on as an infantry model.
import { mountBase, round } from './bases.ts';
import { modelStats, type Catalog, type CatalogUnit, type StatName } from './catalog.ts';
import { formatNeed, woundNeed } from './rules.ts';
import type { Action, Base, DiceRoll, GameState, Model, Seat } from './types.ts';

/** A mount's profile: its Move and the numbers it lends in a fight, its wounds and Courage. */
export interface MountProfile {
  mv: number;
  f: number;
  s: number;
  d: number;
  a: number;
  w: number;
  /** Courage and Intelligence, as the score two dice need. */
  c: number;
  i: number;
  /** A monster ridden into battle (a Fell Beast or Great Eagle): shots at it hit the mount on 1-4. */
  monster?: boolean;
  /** A chariot a hero rides (see warBeasts.ts): it adds its Attacks to the hero's, and only it can be shot or struck. */
  chariot?: boolean;
}

const P = (mv: number, f: number, s: number, d: number, a: number, w: number, c: number, i: number, monster = false): MountProfile => ({ mv, f, s, d, a, w, c, i, ...(monster ? { monster } : {}) });
const CHARIOT = (mv: number, f: number, s: number, d: number, a: number, w: number, c: number, i: number): MountProfile => ({ ...P(mv, f, s, d, a, w, c, i), chariot: true });

/** The mounts in the army lists, from their profiles; any other steed is a horse. */
const PROFILES: [RegExp, MountProfile][] = [
  [/khandish chariot/i, CHARIOT(10, 4, 3, 7, 1, 3, 7, 7)],
  [/iron hills chariot/i, CHARIOT(8, 4, 4, 8, 2, 4, 6, 6)],
  [/armoured fell beast/i, P(12, 5, 6, 7, 2, 3, 7, 8, true)],
  [/fell beast/i, P(12, 5, 6, 6, 2, 3, 7, 8, true)],
  [/great eagle/i, P(12, 7, 6, 8, 2, 3, 4, 4, true)],
  [/white warg/i, P(10, 5, 5, 5, 2, 2, 6, 6)],
  [/fell warg/i, P(10, 3, 4, 4, 1, 1, 8, 7)],
  [/warg/i, P(10, 3, 4, 4, 1, 1, 8, 8)],
  [/shadowfax/i, P(12, 3, 4, 5, 0, 1, 5, 5)],
  [/asfaloth/i, P(12, 3, 3, 4, 0, 1, 6, 6)],
  [/fela/i, P(12, 2, 3, 5, 0, 1, 7, 7)],
  [/brego/i, P(10, 2, 3, 4, 0, 1, 6, 6)],
  [/firefoot/i, P(12, 2, 3, 4, 0, 1, 7, 7)],
  [/armoured horse/i, P(10, 2, 3, 5, 0, 1, 7, 7)],
  [/pony/i, P(8, 2, 3, 3, 0, 1, 8, 8)],
  [/goat/i, P(8, 2, 4, 5, 0, 1, 7, 7)],
  [/boar/i, P(8, 4, 4, 6, 0, 2, 7, 9)],
  [/elk/i, P(10, 4, 4, 5, 0, 2, 6, 7)],
  [/camel/i, P(10, 2, 4, 4, 0, 1, 8, 8)],
  [/horse|steed|snowmane|ashere/i, P(10, 2, 3, 4, 0, 1, 7, 7)],
];
/** Carts, sleighs and war beasts are one model, not a rider on a mount (a hero's chariot is ridden; see CHARIOT). */
const NOT_A_MOUNT = /\bcart\b|sleigh|troll brute/i;
const MOUNT_WARGEAR = /^(armoured )?(horse|steed|warg|pony|goat|war goat|camel|elk|boar|horses)$/i;
/** The parts of an option that are the mount (an option can carry more, as in "Armoured horse and lance"). */
export const MOUNT_OPTION = /\b(horse|steed|warg|pony|goat|camel|elk|boar|fell beast|great eagle|shadowfax|asfaloth|brego|snowmane|firefoot|ashere|fela)/i;

/** A mount's profile from its name; undefined for a cart or anything else that isn't ridden. */
export function mountProfile(name: string | undefined): MountProfile | undefined {
  if (!name || NOT_A_MOUNT.test(name)) return undefined;
  const hit = PROFILES.find(([re]) => re.test(name));
  if (!hit) return undefined;
  // Snowmane and Firefoot can be given armour.
  return /with armour/i.test(name) ? { ...hit[1], d: hit[1].d + 1 } : hit[1];
}

/** The mount a unit rides with the options chosen: the one picked from its options, or the one in its wargear. */
export function mountName(unit: CatalogUnit, chosen: string[]): string | undefined {
  const option = unit.options.find(o => o.mount && (chosen.includes(o.name) || o.included));
  const name = option?.name ?? unit.wargear.find(w => MOUNT_WARGEAR.test(w.trim()));
  return name && mountProfile(name) ? name : undefined;
}

/**
 * Whether a model is a rider on its mount. Models saved before mounts were recorded are told by their old
 * rider-shaped bases.
 */
export const mounted = (m: Model) => !m.dismounted && !m.steed && m.beast !== 'war' && !m.aboard && (!!m.mount || (m.base.h > m.base.w && m.base.h < 100));

/** A rider's mount as it is now, with the wounds it has left; undefined on foot, or for a mount we have no profile for. */
export function mountOf(m: Model): (MountProfile & { name: string; left: number }) | undefined {
  if (!mounted(m) || !m.mount) return undefined;
  const p = mountProfile(m.mount);
  return p && { ...p, name: m.mount, left: m.mountWounds ?? p.w };
}

/** A short name for a mount, for the fight card and the log: "Horse", "Warg". */
export const mountLabel = (name: string) => {
  const head = name.split(/,| and | with /i)[0].trim();
  return head.charAt(0).toUpperCase() + head.slice(1);
};

/** How much difficult ground costs: four times for cavalry (Shadowfax just twice), twice for anyone else. */
export const difficultTimes = (m: Model) => (mounted(m) && !/shadowfax/i.test(m.mount ?? '') && !mountOf(m)?.chariot ? 4 : 2);

/** The numbers of a mount that has lost its rider and fights on by itself. */
export function steedStats(name: string): Partial<Record<StatName, number>> | null {
  const p = mountProfile(name);
  return p ? { Mv: p.mv, Fv: p.f, Sv: 6, S: p.s, D: p.d, A: p.a, W: p.w, C: p.c, I: p.i } : null;
}

/** A rider's numbers on foot: its profile without the mount's options. */
export function footStats(catalog: Catalog | null | undefined, m: Model) {
  return modelStats(catalog, { ...m, options: (m.options ?? []).filter(o => !MOUNT_OPTION.test(o)) });
}

/** Mordor and Isengard Warg Riders become Orc Warriors on foot, and swap their gear as the FAQ lays out. */
const WARG_RIDER = /\b(mordor|isengard)-warg-rider$/;
const WARG_RIDER_ON_FOOT: Record<string, string> = { 'shield and throwing spears': 'Shield', 'throwing spears': 'Spear' };

/** How a rider gets down, or is thrown: what changes on the model, which then fights on foot. */
export function onFoot(catalog: Catalog | null | undefined, m: Model): Partial<Model> {
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  // A lance is no use on foot (a war spear is still a spear).
  const lances = (unit?.wargear ?? []).filter(w => /\blance\b/i.test(w)).map(w => w.toLowerCase());
  const footBase: Base = round(25);
  return {
    dismounted: true,
    base: footBase,
    move: footStats(catalog, m)?.Mv ?? 6,
    options: (m.options ?? []).filter(o => !MOUNT_OPTION.test(o)).map(o => (WARG_RIDER.test(m.profileId ?? '') ? (WARG_RIDER_ON_FOOT[o.toLowerCase()] ?? o) : o)),
    mountWounds: undefined,
    throwPending: undefined,
    ...(lances.length ? { lostGear: [...new Set([...(m.lostGear ?? []), ...lances])] } : {}),
  };
}

// ——— Rider and mount parted ———

type D6 = () => number;

/** One Strength-S hit on a model (its rider's Defence, or its mount's with `mount`), rolled and taken; `credit` is who caused it. */
export function hitModel(m: Model, defence: number, s: number, why: string, d6: D6, by: Seat, id: string, now: number, group: string, mount = false, credit: string[] = []): { rolls: DiceRoll[]; actions: Action[]; wounds: number } {
  const need = woundNeed(s, defence);
  const who = mount ? `${m.name}'s ${mountLabel(m.mount ?? 'mount')}` : m.name;
  if (!need) return { rolls: [], actions: [], wounds: 0 };
  const dice = [d6()];
  const follow = need.then ? dice.filter(x => x >= need.target).map(d6) : undefined;
  const wounds = need.then ? (follow ?? []).filter(x => x >= need.then!).length : dice.filter(x => x >= need.target).length;
  const roll: DiceRoll = { id, by, label: `${why}: S${s} hit on ${who} (${formatNeed(need)})`.slice(0, 80), dice, target: need.target, against: m.id, ...(need.then ? { then: need.then, follow } : {}), at: now, group, note: wounds ? `${who} takes a wound.` : `${who} shrugs it off.` };
  return { rolls: [roll], actions: [{ type: 'rolled', roll }, ...(wounds ? [{ type: 'wound', id: m.id, count: wounds, by: credit, how: credit.length ? 'fight' : 'other', group: id, ...(mount ? { mount: true } : {}) } as Action] : [])], wounds };
}

/**
 * The Thrown Rider test for a rider whose mount fell: on a 1 it's knocked flying (a Strength 3 hit, then Prone),
 * on 2-5 it gets up, and either way it does nothing more this turn; on a 6 it leaps clear and carries on. Knocked
 * flying by a charge or a power skips the roll. Expert Riders roll again if they don't like the first result.
 */
export function thrownRider(state: GameState, catalog: Catalog | null | undefined, m: Model, d6: D6, uid: () => string, now: number, flying = false): Action[] {
  const group = `t-${uid()}`;
  const by = m.owner;
  const out: Action[] = [];
  let result = 1;
  if (!flying) {
    const expert = !!(m.profileId && catalog?.units[m.profileId]?.rules.includes('Expert Rider'));
    const first = d6();
    result = expert && first < 6 ? Math.max(first, d6()) : first;
    const what = result === 1 ? 'knocked flying' : result < 6 ? 'rises from the dust, and does nothing more this turn' : 'leaps clear, ready to fight';
    out.push({ type: 'rolled', roll: { id: `${group}-0`, by, label: `Thrown Rider: ${m.name}${expert && first < 6 ? ' (Expert Rider, best of two)' : ''}`.slice(0, 80), dice: [result], model: m.id, at: now, group, note: `${m.name} ${what}.` } });
  }
  const foot = footStats(catalog, m);
  out.push({ type: 'affect', id: m.id, patch: { ...onFoot(catalog, m), ...(result < 6 ? { stunned: state.turn } : {}), ...(result === 1 ? { prone: true } : {}) } });
  if (result === 1) out.push(...hitModel(m, foot?.D ?? 4, 3, 'Knocked flying', d6, by, `${group}-1`, now, group).actions);
  return out;
}

/**
 * A mount left without its rider: a mount that doesn't fight (Attacks 0) bolts; any other takes a Courage test and
 * stays to fight on by itself if it passes. Returns the new model for a mount that stays, placed next to `at`.
 */
export function separatedMount(m: Model, d6: D6, uid: () => string, now: number, at: { x: number; y: number }): { actions: Action[]; steed?: Model } {
  const p = mountOf({ ...m, dismounted: false });
  // (A chariot doesn't drive on without its hero.)
  if (!p || !m.mount || p.a < 1 || p.chariot || (m.mountWounds ?? p.w) < 1) return { actions: [] };
  const dice = [d6(), d6()];
  const stays = dice[0] + dice[1] >= p.c;
  const name = mountLabel(m.mount);
  const roll: DiceRoll = { id: `r-${uid()}`, by: m.owner, label: `Courage test: ${m.name}'s ${name}, without its rider`.slice(0, 80), dice, sum: p.c, at: now, note: stays ? `The ${name} stays and fights on.` : `The ${name} flees the field.` };
  if (!stays) return { actions: [{ type: 'rolled', roll }] };
  const base = mountBase(m.mount);
  const steed: Model = { id: `${m.id}-steed`, owner: m.owner, name, x: at.x, y: at.y, rot: m.rot, base, move: p.mv, wounds: m.mountWounds ?? p.w, maxWounds: p.w, might: 0, will: 0, fate: 0, hero: false, dead: false, steed: m.mount };
  return { actions: [{ type: 'rolled', roll }], steed };
}

/**
 * What the game rolls by itself once rider and mount have parted: the Thrown Rider test for each rider whose mount
 * just fell, and a Courage test for a fighting mount whose rider was slain.
 */
export function riderTests(state: GameState, catalog: Catalog | null | undefined, d6: D6, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const m of Object.values(state.models)) {
    if (m.throwPending && !m.dead) {
      // A mount that bolts or stays as its rider is thrown: one that fights takes its Courage test first.
      out.push(...thrownRider(state, catalog, m, d6, uid, now, m.throwPending === 'flying'));
      if (m.throwPending === 'flying' && (m.mountWounds ?? 1) > 0) {
        const { actions, steed } = separatedMount(m, d6, uid, now, beside(state, m));
        out.push(...actions, ...(steed ? [{ type: 'addModels', models: [steed] } as Action] : []));
      }
    } else if (m.dead && m.mount && !m.dismounted && !m.steed && !state.models[`${m.id}-steed`]) {
      const { actions, steed } = separatedMount(m, d6, uid, now, m);
      out.push(...actions, ...(steed ? [{ type: 'addModels', models: [steed] } as Action] : []), { type: 'affect', id: m.id, patch: { dismounted: true } });
    }
  }
  return out;
}

/** Whether any rider or mount is waiting on a test the game rolls (see riderTests). */
export const riderTestsDue = (state: GameState) => Object.values(state.models).some(m => (m.throwPending && !m.dead) || (m.dead && m.mount && !m.dismounted && !m.steed && !state.models[`${m.id}-steed`]));

/** A free spot beside a model for its mount (behind it first, then further round); the model's own spot if none. */
export function beside(state: GameState, m: Model): { x: number; y: number } {
  const r = 20.5 / 25.4 + 12.5 / 25.4 + 0.05;
  const back = ((m.rot + 90) * Math.PI) / 180;
  for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) {
    const a = back + (turn * Math.PI) / 180;
    const p = { x: m.x + Math.cos(a) * r, y: m.y + Math.sin(a) * r };
    if (p.x < 1 || p.y < 1 || p.x > state.board.w - 1 || p.y > state.board.h - 1) continue;
    if (Object.values(state.models).some(o => o.id !== m.id && !o.dead && !o.escaped && !o.waiting && Math.hypot(o.x - p.x, o.y - p.y) < 0.8 + o.base.w / 50.8)) continue;
    return p;
  }
  return { x: m.x, y: m.y };
}
