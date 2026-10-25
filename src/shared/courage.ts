// Courage tests the app rolls by itself: every model of a Broken army as its side starts to move, and a model
// charging a terrifying enemy as it moves into contact.
import { inCompany, steadfast, thorinsCall } from './company.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { activeSeat, CONTACT_SLACK } from './flow.ts';
import { distanceBetween } from './geometry.ts';
import { heroicsSettled, phaseHeroics } from './heroics.ts';
import { cannotAct, courageAuto, courageWorse, madeFearful, terrifying } from './powers.ts';
import { engaged } from './movement.ts';
import { sightTo } from './sight.ts';
import { armyStatus } from './status.ts';
import { courageBonus, hasOrcrist, hasRule, isKind } from './wargear.ts';
import { isChariot } from './warBeasts.ts';
import { mounted } from './cavalry.ts';
import { cryPenalty } from './narrative.ts';
import { dunharrow, highKingFor } from './pelennorRules.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

/** How close a hero's friends must be to share its Stand Fast! or Heroic Resolve. */
export const STAND_FAST_RANGE = 6;

/** Théoden's "Forth, and Fear no Darkness!" carries his Stand Fast! twice as far. */
export const standFastRange = (catalog: Catalog | null, h: Model) => (h.profileId && catalog?.units[h.profileId]?.rules.some(r => r === 'Forth, and Fear no Darkness' || r === 'General of the North') ? 12 : STAND_FAST_RANGE);

/** Whose Stand Fast! a model may take: Gwaihir's (The Windlord) only reaches Eagles and Wizards, the King of the Dead's only those of Dunharrow. */
const heeds = (catalog: Catalog | null, h: Model, m: Model) => (!hasRule(catalog, h, 'The Windlord') || /eagle|gwaihir|gandalf|saruman|radagast|wizard/i.test(m.name)) && (!hasRule(catalog, h, 'The Dead and the Living') || dunharrow(m));

/** Azog's Stand Fast! (General of the North) steadies friendly Orc heroes too, out to 12". */
const generalOfTheNorth = (catalog: Catalog | null, h: Model, m: Model) => hasRule(catalog, h, 'General of the North') && isKind(catalog, m, 'Orc');

/** The 2D6 total a model needs to pass a Courage test, after powers such as Drain Courage and Aura of Dismay, war horns and Harbingers of Evil. */
export const courageOf = (state: GameState, catalog: Catalog | null, m: Model) => Math.max(2, Math.min(13, (modelStats(catalog, m)?.C ?? 7) + courageWorse(state, m) + cryPenalty(state, m) - courageBonus(state, catalog, m)));
const isHero = (m: Model) => m.hero;
export const causesTerror = (catalog: Catalog | null, m: Model, state?: GameState) =>
  !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Terror\b(?! \()/.test(r))) || (!!state && terrifying(state, m));
/**
 * Whether a model must test its Courage to charge this enemy for Terror: the enemy has Terror, or Terror over its
 * kind (Terror (Orc)), as Orcrist gives its wielder over Orcs, Goblins and Uruk-hai.
 */
export function terrifies(catalog: Catalog | null, e: Model, m: Model, state?: GameState): boolean {
  if (causesTerror(catalog, e, state)) return true;
  const kinds = [...(e.profileId ? (catalog?.units[e.profileId]?.rules ?? []) : []).flatMap(r => r.match(/^Terror \((.+)\)$/)?.[1].split(/,\s*/) ?? []), ...(hasOrcrist(catalog, e) ? ['Orc', 'Goblin', 'Uruk-hai'] : [])];
  return kinds.some(k => isKind(catalog, m, k));
}
/** Fearful models test their Courage to charge any enemy. */
const isFearful = (state: GameState, catalog: Catalog | null, m: Model) =>
  !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Fearful\b/.test(r))) || madeFearful(state, m);

type Roller = { d6: () => number; uid: () => string; now: number; by: Seat };

function roll(m: Model, c: number, label: string, r: Roller): DiceRoll {
  return { id: `c-${r.uid()}`, by: r.by, label: label.slice(0, 80), dice: [r.d6(), r.d6()], sum: c, model: m.id, at: r.now };
}
const passed = (d: DiceRoll) => d.dice[0] + d.dice[1] >= (d.sum ?? 7);

/** The side that should take its Broken army Courage tests now, if any: a Broken side as its Move activation starts. */
export function brokenSideToTest(state: GameState): Seat | null {
  if (!state.flow.started || state.phase !== 'move' || !heroicsSettled(state)) return null;
  const seat = activeSeat(state);
  if (!seat || state.flow.braved?.includes(seat) || !armyStatus(state, seat).broken) return null;
  return seat;
}

/**
 * A hero that fails a Courage test spends what Might and Will it needs to pass, if it has enough: Will first unless
 * it casts powers (it needs its Will for those), Might otherwise. Returns the roll as raised and the points spent.
 */
function rescue(catalog: Catalog | null, m: Model, d: DiceRoll): { roll: DiceRoll; might: number; will: number } | null {
  const short = (d.sum ?? 7) - d.dice[0] - d.dice[1];
  if (!m.hero || short <= 0 || short > m.might + m.will || 12 - d.dice[0] - d.dice[1] < short) return null;
  const caster = !!(m.profileId && catalog?.units[m.profileId]?.powers?.length);
  const firstWill = caster ? 0 : Math.min(m.will, short);
  const might = Math.min(m.might, short - firstWill);
  const will = short - might;
  if (will > m.will) return null;
  const dice = [...d.dice];
  for (let left = short; left > 0; left--) dice[dice[0] < 6 ? 0 : 1]++;
  const paid = [might ? `${might} Might` : '', will ? `${will} Will` : ''].filter(Boolean).join(' and ');
  return { roll: { ...d, dice, ...(might ? { might } : {}), note: `${m.name} spends ${paid} to pass.` }, might, will };
}

/**
 * Courage tests for a Broken side's models as it starts to move: those that can activate (not in a fight, nor held
 * by a power). Heroes go first; a hero that passes calls Stand Fast!, so warriors within 6" that can see it pass
 * without rolling. A hero with a Heroic Resolve passes, and calls Stand Fast! even from a fight. A hero that fails
 * spends Might or Will to pass if it can.
 */
export function brokenTests(state: GameState, seat: Seat, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const r: Roller = { d6, uid, now, by: seat };
  const resolute = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Resolve').map(h => h.model));
  // War beasts, those riding them and chariots stand firm in a Broken army without a test.
  const models = Object.values(state.models).filter(m => m.owner === seat && !m.dead && !m.escaped && !m.waiting && !m.beast && !m.aboard && !isChariot(catalog, m) && !cannotAct(state, m) && (!engaged(state, m) || resolute.has(m.id)));
  const rolls: DiceRoll[] = [];
  const spent: Action[] = [];
  const results: Record<string, boolean> = {};
  const anchors: Model[] = [];
  // (Thorin goes first: his Stand Fast! reaches the heroes of his Company too.)
  const heroes = models.filter(isHero).sort((a, b) => Number(thorinsCall(catalog, b)) - Number(thorinsCall(catalog, a)) || courageOf(state, catalog, b) - courageOf(state, catalog, a));
  for (const h of heroes) {
    const thorin = inCompany(catalog, h) && anchors.find(a => a.id !== h.id && !a.ringOn && thorinsCall(catalog, a) && distanceBetween(a, h) <= STAND_FAST_RANGE && sightTo(state, h, a) !== 'hidden');
    const azog = anchors.find(a => a.id !== h.id && generalOfTheNorth(catalog, a, h) && distanceBetween(a, h) <= standFastRange(catalog, a) && sightTo(state, h, a) !== 'hidden');
    if (thorin || azog) {
      results[h.id] = true;
      continue;
    }
    // A Heroic Resolve, or a power such as Aura of Command, passes it without a roll.
    if (resolute.has(h.id) || courageAuto(state, catalog, h)) {
      results[h.id] = true;
      anchors.push(h);
      continue;
    }
    let d = roll(h, courageOf(state, catalog, h), `Courage test (Broken): ${h.name}`, r);
    const saved = !passed(d) && rescue(catalog, h, d);
    if (saved) {
      d = saved.roll;
      if (saved.might) spent.push({ type: 'affect', id: h.id, patch: { might: h.might - saved.might } });
      if (saved.will) spent.push({ type: 'spendWill', id: h.id, count: saved.will });
    }
    rolls.push(d);
    results[h.id] = passed(d);
    if (results[h.id]) anchors.push(h);
  }
  for (const m of models) {
    if (m.id in results) continue;
    // An Invisible hero can't give a Stand Fast!.
    // (The Mûmak War Leader's reaches 12" from his Royal War Mûmak, which stands firm without a test: High King of the South.)
    if (anchors.some(h => !h.ringOn && heeds(catalog, h, m) && distanceBetween(h, m) <= standFastRange(catalog, h) && sightTo(state, m, h) !== 'hidden') || highKingFor(state, catalog, m) || courageAuto(state, catalog, m)) {
      results[m.id] = true;
      continue;
    }
    const d = roll(m, courageOf(state, catalog, m), `Courage test (Broken): ${m.name}`, r);
    rolls.push(d);
    results[m.id] = passed(d);
  }
  const fled = models.filter(m => !results[m.id]).length;
  const held = models.length - fled;
  const summary: DiceRoll = {
    id: `c-${uid()}`,
    by: seat,
    label: `Broken army: ${held} stand${held === 1 ? 's' : ''} firm, ${fled} flee${fled === 1 ? 's' : ''}${anchors.length ? ' (Stand Fast! from heroes who passed)' : ''}`.slice(0, 80),
    dice: [],
    at: now,
  };
  return [...rolls.map((roll): Action => ({ type: 'rolled', roll })), ...spent, { type: 'rolled', roll: summary }, { type: 'courageTaken', results, broken: seat }];
}

/**
 * The enemy this move would put the model in contact with that it must test its Courage to charge, if it hasn't
 * tested this turn: a terrifying one, or any enemy for a Fearful model. A Compelled model never tests.
 */
export function terrorAhead(state: GameState, m: Model, to: { x: number; y: number }, catalog: Catalog | null): Model | null {
  if (!state.flow.started || state.phase !== 'move' || state.flow.courage?.[m.id] !== undefined || state.flow.compel?.model === m.id) return null;
  const fearful = isFearful(state, catalog, m);
  if (!fearful && causesTerror(catalog, m, state)) return null;
  const here = { ...m, ...to };
  return Object.values(state.models).find(e => e.owner !== m.owner && !e.dead && distanceBetween(here, e) <= CONTACT_SLACK && (fearful || terrifies(catalog, e, m, state))) ?? null;
}

/** The Courage test to charge a terrifying enemy (or any, when Fearful). A model that fails stays where it is for the rest of the turn. */
export function terrorTest(m: Model, enemy: Model, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now(), state?: GameState): { actions: Action[]; pass: boolean } {
  const fearful = !!state && isFearful(state, catalog, m);
  // A Fearful model charging a terrifying one tests once for each rule (Rulebook FAQ).
  const whys = fearful && state && !causesTerror(catalog, m, state) && terrifies(catalog, enemy, m, state) ? ['Fearful', 'Terror'] : [fearful ? 'Fearful' : 'Terror'];
  const auto = state && courageAuto(state, catalog, m, enemy);
  if (auto) {
    const note: DiceRoll = { id: `c-${uid()}`, by: m.owner, label: `Courage to charge ${enemy.name} (${whys.join(' and ')}): ${m.name}`.slice(0, 80), dice: [], note: `Passes without a roll (${auto}).`, model: m.id, at: now };
    return { actions: [{ type: 'rolled', roll: note }, { type: 'courageTaken', results: { [m.id]: true } }], pass: true };
  }
  const need = state ? courageOf(state, catalog, m) : (modelStats(catalog, m)?.C ?? 7);
  const actions: Action[] = [];
  // Bofur's Steadfast: a 3+ and a friend of the Company near him pays the enemy's Terror no heed.
  if (state && whys.length === 1 && whys[0] === 'Terror') {
    const steady = steadfast(state, catalog, m, `${enemy.name}'s Terror`, d6, m.owner, `c-${uid()}`, now);
    if (steady.roll) actions.push({ type: 'rolled', roll: steady.roll });
    if (steady.saved) return { actions: [...actions, { type: 'courageTaken', results: { [m.id]: true } }], pass: true };
  }
  let pass = true;
  // The second test is only taken if the first is passed.
  for (const why of whys) {
    if (!pass) break;
    const d = roll(m, need, `Courage to charge ${enemy.name} (${why}): ${m.name}`, { d6, uid, now, by: m.owner });
    pass = passed(d);
    actions.push({ type: 'rolled', roll: d });
    // Snowmane, a Faithful Servant, carries Théoden at a terrifying foe: he tests again if he fails.
    if (!pass && why === 'Terror' && mounted(m) && /snowmane/i.test(m.mount ?? '')) {
      const again = roll(m, need, `Courage to charge ${enemy.name} again (Snowmane): ${m.name}`, { d6, uid, now, by: m.owner });
      pass = passed(again);
      actions.push({ type: 'rolled', roll: again });
    }
  }
  return { actions: [...actions, { type: 'courageTaken', results: { [m.id]: pass } }], pass };
}

/** Will of Evil: the model fades away when it runs out of Will. */
export const willOfEvil = (catalog: Catalog | null, m: Model) => !!(m.profileId && catalog?.units[m.profileId]?.rules.some(r => /^Will of Evil\b/.test(r)));

/** Whether Will of Evil is still to take its toll this End phase. */
export const willOfEvilDue = (state: GameState) => state.flow.started && state.phase === 'end' && !state.result && state.flow.willed !== state.turn;

/**
 * In the End phase each model with Will of Evil that fought this turn (any model touching an enemy fights) gives up
 * 1 Will, and is banished when it has none left.
 */
export function willOfEvilToll(state: GameState, catalog: Catalog | null, uid: () => string, now = Date.now()): Action[] {
  const fought = new Set(state.flow.resolved.flatMap(k => k.split(',')));
  // A fight that had a model wearing the One Ring in it costs no Will, whoever else was in it.
  const foes = new Map<string, string[]>();
  for (const k of state.flow.resolved) {
    const [a, b] = k.split('|').map(x => x.split(',').filter(Boolean));
    for (const id of a ?? []) foes.set(id, [...(foes.get(id) ?? []), ...(b ?? [])]);
    for (const id of b ?? []) foes.set(id, [...(foes.get(id) ?? []), ...(a ?? [])]);
  }
  const out: Action[] = [];
  for (const m of Object.values(state.models)) {
    const against = foes.get(m.id);
    if (m.dead || m.escaped || !willOfEvil(catalog, m) || !fought.has(m.id) || against?.some(id => state.models[id]?.ringOn)) continue;
    const will = Math.max(0, m.will - 1);
    out.push({ type: 'rolled', roll: { id: `c-${uid()}`, by: m.owner, label: `Will of Evil: ${m.name} gives up 1 Will`.slice(0, 80), dice: [], model: m.id, note: will ? `${will} Will left.` : `${m.name} has no Will left and is banished.`, at: now } });
    out.push({ type: 'affect', id: m.id, patch: will ? { will } : { will: 0, wounds: 0, dead: true } });
  }
  out.push({ type: 'willOfEvil' });
  return out;
}
