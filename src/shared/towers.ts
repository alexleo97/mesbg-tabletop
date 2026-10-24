// The special rules of the heroes and warriors at Helm's Deep (the Defenders of Helm's Deep, the Riders of Éomer and
// the Host of Isengard), worked out from their profiles so the server, the fight card and the computer agree. They
// apply wherever these profiles are fielded, not only in the narrative scenario.
import { mounted, mountOf } from './cavalry.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { woundsTaken, type Fighter } from './fight.ts';
import { CONTACT_SLACK } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { engaged } from './movement.ts';
import { isCavalry } from './powers.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { hasRule, isKind } from './wargear.ts';
import { elvenBow } from './gear.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.escaped && !m.waiting;
const friends = (state: GameState, m: Model) => Object.values(state.models).filter(o => o.owner === m.owner && alive(o));

/** How many enemies a model has slain: the casualties whose killing blow it had a hand in. */
export const kills = (state: GameState, id: string) => Object.values(state.models).filter(m => m.dead && m.killedBy?.ids.includes(id)).length;

/** The friendly model that has a rule, if one is on the table. */
const friendWith = (state: GameState, catalog: Catalog | null | undefined, m: Model, rule: string) => friends(state, m).find(o => hasRule(catalog, o, rule));
const isAragorn = (m: Model) => m.cast === 'aragorn' || /\baragorn\b|\bstrider\b/i.test(m.name);

/** Legolas and Gimli's count: who each is racing, and whether he is behind. */
function behindInCount(state: GameState, catalog: Catalog | null | undefined, m: Model, rule: string, rival: RegExp): boolean {
  if (!hasRule(catalog, m, rule)) return false;
  const other = Object.values(state.models).find(o => o.owner === m.owner && o.id !== m.id && rival.test(o.name));
  return !!other && kills(state, m.id) < kills(state, other.id);
}
/** Gimli: +1 To Wound with his strikes while Legolas has slain more. */
export const sittingPretty = (state: GameState, catalog: Catalog | null | undefined, m: Model) => behindInCount(state, catalog, m, '"I myself am sitting pretty on 43"', /\blegolas\b/i);
/** Legolas: +1 To Wound with his shots while Gimli has slain more. */
export const finalCount = (state: GameState, catalog: Catalog | null | undefined, m: Model) => behindInCount(state, catalog, m, '"Final Count, 42"', /\bgimli\b/i);

/**
 * The side's Rohan General, for Arise, Riders of Rohan!: its General if that is a hero of Rohan, otherwise Théoden
 * (the King of Rohan leads at Helm's Deep), if he is on the table.
 */
export function rohanGeneral(state: GameState, catalog: Catalog | null | undefined, seat: Seat): Model | undefined {
  const ours = Object.values(state.models).filter(o => o.owner === seat && alive(o) && o.hero);
  return ours.find(o => o.general && isKind(catalog, o, 'rohan')) ?? ours.find(o => hasRule(catalog, o, 'Herugrim'));
}

/** Haleth's Fight to the Last: he was in a fight as this Fight phase began, and is still alive. */
const fightingToTheLast = (state: GameState, haleth: Model) => state.phase === 'fight' && !!state.flow.pairs?.some(k => k.split(',').includes(haleth.id));

/** Rohan infantry: a warrior or hero of Rohan on foot. */
const rohanInfantry = (catalog: Catalog | null | undefined, m: Model) => isKind(catalog, m, 'rohan') && !isCavalry(catalog ?? null, m);

/**
 * What these rules do to a model in a fight, on top of its wargear (see wargear.fighterOf), before what its strikes
 * need against each enemy is worked out. `times` is 2 for a model Shielding (its Attacks are doubled).
 */
export function towersFight(state: GameState, catalog: Catalog | null | undefined, m: Model, out: Fighter): void {
  const notes = [...(out.notes ?? [])];
  const times = out.shielding ? 2 : 1;
  // Gimli's axes: the master-forged two-handed axe with no duel penalty, or an axe in each hand for 3 Attacks.
  if (hasRule(catalog, m, 'Axes of the Dwarves!')) {
    if (out.twoHanded) {
      if (out.duelMod) {
        out.duelMod += 1;
        if (!out.duelMod) {
          delete out.duelMod;
          delete out.sixSafe;
        }
      }
      notes.push('Axes of the Dwarves!: the master-forged axe, no duel penalty');
    } else if (!out.shielding) {
      out.a = Math.max(out.a, 3);
      notes.push('Axes of the Dwarves!: an axe in each hand, 3 Attacks');
    }
  }
  if (!out.support && !out.shielding && sittingPretty(state, catalog, m)) {
    out.woundMod = (out.woundMod ?? 0) + 1;
    notes.push('Sitting pretty on 43: behind Legolas, +1 to wound');
  }
  // Haleth: 2 Attacks within 6" of Aragorn.
  if (hasRule(catalog, m, 'There is Always Hope') && friends(state, m).some(o => isAragorn(o) && distanceBetween(o, m) <= 6)) {
    out.a = Math.max(out.a, 2 * times);
    notes.push('There is Always Hope: 2 Attacks near Aragorn');
  }
  // Haleth fights to the last: Aragorn and the Rohan infantry near him fight harder this phase while he lives.
  const haleth = friendWith(state, catalog, m, 'Fight to the Last');
  if (haleth && fightingToTheLast(state, haleth) && (isAragorn(m) || rohanInfantry(catalog, m)) && distanceBetween(haleth, m) <= 6) {
    out.f = Math.min(10, out.f + 1);
    notes.push(`Fight to the Last: +1 Fight while ${haleth.name} fights`);
  }
  // A Rider of Rohan charging near its General.
  const general = out.charged === 'cavalry' && hasRule(catalog, m, 'Arise, Riders of Rohan!') ? rohanGeneral(state, catalog, m.owner) : undefined;
  if (general && distanceBetween(general, m) <= 12) {
    out.f = Math.min(10, out.f + 1);
    notes.push(`Arise, Riders of Rohan!: charged near ${general.name}, +1 Fight`);
  }
  if (hasRule(catalog, m, 'Herugrim')) {
    out.edge = true;
    notes.push('Herugrim: wins a fight drawn at his Fight value');
  }
  if (!out.shielding && !out.support) {
    if (hasRule(catalog, m, 'Guthwine')) {
      out.sixesAgain = true;
      notes.push('Gúthwinë: each 6 to wound rolls another');
    }
    // Éomer's grief once Théoden has fallen.
    const king = Object.values(state.models).find(o => o.owner === m.owner && hasRule(catalog, o, 'Herugrim'));
    if (hasRule(catalog, m, 'The Price of Grief') && king?.dead) {
      out.reroll = true;
      notes.push('The Price of Grief: re-rolls failed rolls to wound');
    }
    if (hasRule(catalog, m, 'Glamdring')) {
      out.s = Math.min(10, out.s + 1);
      if (out.baseS !== undefined) out.baseS = Math.min(10, out.baseS + 1);
      notes.push('Glamdring: +1 Strength');
    }
    // A Berserker's blade swung two-handed can cut at every foe at once.
    if (out.twoHanded && hasRule(catalog, m, 'Berserker Blade')) out.sweep = true;
  }
  if (notes.length) out.notes = notes;
}

/** The enemies touching a model now. */
const touchingFoes = (state: GameState, m: Model) => Object.values(state.models).filter(e => e.owner !== m.owner && alive(e) && distanceBetween(e, m) <= CONTACT_SLACK);

/**
 * Haldir's One Final Blow: when he is slain in a fight, each enemy in that fight takes a Strength 4 hit. The game
 * spends what Might he has left to turn a near miss into a wound. Compares the state before and after an action.
 */
export function finalBlows(before: GameState, after: GameState, catalog: Catalog | null | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const m of Object.values(after.models)) {
    const was = before.models[m.id];
    if (!m.dead || !was || was.dead || m.killedBy?.how !== 'fight' || !hasRule(catalog, m, 'One Final Blow')) continue;
    let might = was.might;
    const group = `r-${uid()}`;
    for (const e of touchingFoes(before, was)) {
      const d = modelStats(catalog, e)?.D ?? 4;
      const need = woundNeed(4, d);
      if (!need) continue;
      const first = d6();
      let die = first;
      // (A 6/4+ style need takes two dice; Might only raises the first here.)
      const short = need.target - die;
      const spend = short > 0 && short <= might && !need.then ? short : 0;
      might -= spend;
      die += spend;
      const follow = need.then && die >= need.target ? [d6()] : undefined;
      const wounds = die >= need.target && (!follow || follow[0] >= need.then!) ? 1 : 0;
      const roll: DiceRoll = { id: `${group}-${out.length}`, by: m.owner, label: `One Final Blow: ${m.name} strikes ${e.name}, S4 (${formatNeed(need)})`.slice(0, 80), dice: [die], target: need.target, against: e.id, model: m.id, at: now, group, ...(spend ? { might: spend } : {}), ...(follow ? { then: need.then, follow } : {}), note: wounds ? `${e.name} takes a Wound.` : `${e.name} is unhurt.` };
      out.push({ type: 'rolled', roll });
      if (wounds) out.push({ type: 'wound', id: e.id, count: 1, how: 'fight', by: [m.id], group });
    }
  }
  return out;
}

/** The Royal Standard of Rohan and the heroes of Rohan near it. */
export const ROYAL_STANDARD_RANGE = 6;
const royalStandard = (state: GameState, catalog: Catalog | null | undefined, m: Model) =>
  friends(state, m).find(o => hasRule(catalog, o, 'Royal Standard of Rohan') && !o.prone && distanceBetween(o, m) <= ROYAL_STANDARD_RANGE);

/**
 * The Royal Standard of Rohan: a hero of Rohan within 6" of it that spends a Might point rolls a D6, and on a 6 gets it
 * back. Compares the state before and after an action.
 */
export function standardRefunds(before: GameState, after: GameState, catalog: Catalog | null | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const m of Object.values(after.models)) {
    const was = before.models[m.id];
    if (!was || !alive(m) || !m.hero || m.might >= was.might || !isKind(catalog, m, 'rohan')) continue;
    const flag = royalStandard(after, catalog, m);
    if (!flag) continue;
    const spent = was.might - m.might;
    const dice = Array.from({ length: spent }, d6);
    const back = dice.filter(d => d === 6).length;
    out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `Royal Standard of Rohan: ${m.name} spent ${spent} Might (6 gets it back)`.slice(0, 80), dice, target: 6, model: m.id, at: now, note: back ? `${m.name} gets ${back} Might back.` : 'No Might comes back.' } });
    if (back) out.push({ type: 'affect', id: m.id, patch: { might: m.might + back } });
  }
  return out;
}

/** What these rules make of an action once it has been applied: One Final Blow and the Royal Standard. */
export const towersAfter = (before: GameState, after: GameState, catalog: Catalog | null | undefined, d6: () => number, uid: () => string, now = Date.now()): Action[] => [
  ...finalBlows(before, after, catalog, d6, uid, now),
  ...standardRefunds(before, after, catalog, d6, uid, now),
];

/** Marks Shadowfax's own point of Fate as spent (in the rider's `used`). */
export const SHADOWFAX_FATE = 'Shadowfax: Fate';

/**
 * Wounds some models shrug off, rolled by the game before they are taken: a Berserker's Oblivious to Pain (a 6 for
 * each Wound), and a Horse Lord's mount (a 6 for each, then the rider's own Fate if the mount would fall).
 * Returns the actions to apply instead of the wound, or null if nothing changes it. The wound it hands back is
 * marked `checked`, so it isn't rolled for twice.
 */
export function shrugOff(state: GameState, catalog: Catalog | null | undefined, action: Extract<Action, { type: 'wound' }>, d6: () => number, uid: () => string, now = Date.now()): Action[] | null {
  if (action.checked) return null;
  const m = state.models[action.id];
  const n = Math.max(0, Math.min(30, Math.round(Number(action.count)) || 0));
  if (!m || m.dead || !n || !state.flow.started) return null;
  const group = action.group === undefined ? '' : String(action.group);
  const target = action.mount === true ? `${m.id}#mount` : m.id;
  if (group && woundsTaken(state.flow.applied, group, target)) return null;
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) => rolls.push({ id: `r-${uid()}`, by: m.owner, label: label.slice(0, 80), dice, model: m.id, at: now, ...extra });
  let left = n;
  const extra: Action[] = [];
  if (action.mount === true) {
    const steed = mountOf(m);
    const lord = hasRule(catalog, m, 'Horse Lord');
    // Shadowfax has a point of Fate of his own.
    const shadowfax = !!steed && /shadowfax/i.test(steed.name) && !m.used?.includes(SHADOWFAX_FATE);
    if (!steed || (!lord && !shadowfax)) return null;
    if (lord) {
      const dice = Array.from({ length: n }, d6);
      left -= dice.filter(d => d === 6).length;
      push(`Horse Lord: ${m.name}'s ${steed.name} shrugs off a Wound on a 6`, dice, { target: 6, note: left < n ? `${n - left} Wound${n - left === 1 ? '' : 's'} ignored.` : 'No Wounds ignored.' });
    }
    // Fate is spent only when the mount would otherwise fall (and Narya re-rolls Gandalf's).
    const narya = hasRule(catalog, m, 'Narya');
    const fateRoll = (whose: string) => {
      const die = d6();
      const again = die < 4 && narya ? d6() : undefined;
      const saved = (again ?? die) >= 4;
      push(`${whose} to save the ${steed.name} (4+)${again ? ', re-rolled (Narya)' : ''}`, again ? [die, again] : [die], { target: 4, note: saved ? 'A Wound is saved.' : 'The Fate roll fails.' });
      if (saved) left--;
    };
    if (shadowfax && left >= steed.left && left > 0) {
      fateRoll(`${steed.name}'s own Fate`);
      extra.push({ type: 'affect', id: m.id, patch: { used: [...(m.used ?? []), SHADOWFAX_FATE] } });
    }
    let fate = m.fate;
    while (lord && left >= steed.left && left > 0 && fate > 0) {
      fate--;
      fateRoll(`Horse Lord: ${m.name} spends Fate`);
    }
    if (fate !== m.fate) extra.push({ type: 'affect', id: m.id, patch: { fate } });
    if (!rolls.length) return null;
  } else if (hasRule(catalog, m, 'Oblivious to Pain')) {
    const dice = Array.from({ length: n }, d6);
    left -= dice.filter(d => d === 6).length;
    push(`Oblivious to Pain: ${m.name} ignores a Wound on a 6`, dice, { target: 6, note: left < n ? `${n - left} Wound${n - left === 1 ? '' : 's'} ignored.` : 'No Wounds ignored.' });
  } else if (hasRule(catalog, m, 'Blubbery Mass')) {
    // The Goblin King's Blubbery Mass: a 3+ stops each Wound, but not those of a Magical Power, nor of Elven weapons in a
    // fight; an Elven bow's need a 4+.
    if (action.how === 'other' && group.startsWith('p-')) return null;
    const elven = action.how === 'fight' ? Math.max(0, Math.min(n, Math.round(Number(action.elven)) || 0)) : 0;
    const rolled = n - elven;
    if (!rolled) return null;
    const bow = action.how === 'shoot' && (action.by ?? []).some(id => state.models[id] && elvenBow(catalog, state.models[id]));
    const need = bow ? 4 : 3;
    const dice = Array.from({ length: rolled }, d6);
    left -= dice.filter(d => d >= need).length;
    push(`Blubbery Mass: ${m.name} ignores a Wound on a ${need}+${bow ? ' (an Elven bow)' : ''}${elven ? `; ${elven} from Elven blades stand` : ''}`, dice, { target: need, note: left < n ? `${n - left} Wound${n - left === 1 ? '' : 's'} ignored.` : 'No Wounds ignored.' });
  } else return null;
  return [...rolls.map((roll): Action => ({ type: 'rolled', roll })), ...extra, { ...action, count: left, checked: true }];
}

// ——— Shooting ———

/** How many Shooting Attacks a model makes in a Shoot phase: Legolas's Deadly Shot three, Haldir's Expert Shot two. */
export const shotsPerPhase = (catalog: Catalog | null | undefined, m: Model) => (hasRule(catalog, m, 'Deadly Shot') ? 3 : hasRule(catalog, m, 'Expert Shot') ? 2 : 1);

/** Shooting Attacks a model has made this turn (a Pinpoint Shot counts as all of them). */
export const shotsTaken = (state: GameState, m: Model) => (state.flow.shot ?? []).filter(id => id === m.id).length;

/** Legolas's Deadly Shot: he shoots even in a fight, mounted or not, and on foot doesn't shoot worse for moving. */
export const deadlyShot = (catalog: Catalog | null | undefined, m: Model) => hasRule(catalog, m, 'Deadly Shot');
export const steadyOnTheMove = (catalog: Catalog | null | undefined, m: Model) => deadlyShot(catalog, m) && !mounted(m);

/** Aldor's Unsteady Nerves: he can't call a Heroic Shoot, and must shoot before the rest of his side. */
export const unsteady = (catalog: Catalog | null | undefined, m: Model) => hasRule(catalog, m, 'Unsteady nerves');
/** Aldor's Lucky Shot: he must re-roll his misses, to hit and to wound. */
export const luckyShot = (catalog: Catalog | null | undefined, m: Model) => hasRule(catalog, m, 'Lucky Shot');

/** Whether a model is in a fight with this one. */
export const fightingWith = (state: GameState, a: Model, b: Model) => a.owner !== b.owner && distanceBetween(a, b) <= CONTACT_SLACK && engaged(state, a);

