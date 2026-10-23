import { towersFight, unsteady } from './towers.ts';
import { beside, mounted, mountLabel, mountOf, onFoot, separatedMount } from './cavalry.ts';
import { resolveBreach } from './breach.ts';
import { onLadder, resolveHurl } from './defenders.ts';
import { brutalOptions, chargeEffects, hurl, knockedDown } from './monsters.ts';
import { bringDownTarget, flamingArrows } from './ents.ts';
import { trample } from './trample.ts';
import { biggerHolds, commanderOf, howdahFor, immovable } from './warBeasts.ts';
import { acrossCable, boltCount, fireEngine, rapidFire } from './siege.ts';
import { distanceBetween } from './geometry.ts';
import { backAway, pushBack, separate, type Retreat } from './backAway.ts';
import { defence, touchingEnemies, upLadder, wallBetween } from './barriers.ts';
import { bannerFor, cantShield, fighterOf, hasRule, strikeAgainst } from './wargear.ts';
import { canActivate, heroicNow, mayActivate, orderRoll, orderRollLabel, orderRollNeeded } from './heroics.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { missileWeapon, woundNeed } from './rules.ts';
import { isWebs, planShot, throwingPoint } from './shooting.ts';
import { fallDamage, resolveCross } from './terrainTests.ts';
import { heightOf } from './sight.ts';
import { BPA_NAMES, TROLL_BRUTALS, cleanFight, cleanShot, duelSettled, mightCouldHelp, resolveDuel, resolveShot, resolveStrikes, strikeWounds, type BrutalAttack, type DrawRule, type Fighter, type FightRequest, type ShotRequest } from './fight.ts';
import { combatFromKey, CONTACT_SLACK, other, priorityChooser } from './flow.ts';
import { hasElvenWeapon, hasPike, sideOf } from './gear.ts';
import { oneSpearEach, supporters } from './support.ts';
import { fightDone, foughtThisTurn } from './movement.ts';
import { rollCast, rollResist } from './magic.ts';
import { intelligenceWorse, noStrikes, under, witheredStrength } from './powers.ts';
import { fightsUpright } from './ambush.ts';
import { touching } from './objects.ts';
import { brandRetreats } from './fire.ts';
import { placingNow } from './placing.ts';
import { fryingPans } from './sam.ts';
import { resolveDetonate, resolveRaiseLadder, rideOut } from './helms.ts';
import { arrivalAuto, arrivalDue, mayCry, narrativeById, narrativeSetup, radius, rollArrival, skipArrival } from './narrative.ts';
import { terrorAhead, terrorTest } from './courage.ts';
import { invisibleTo, ringRequest, seekRequest } from './ring.ts';
import { skitterRequest } from './unseen.ts';
import { isTroll, spareFor } from './mutton.ts';
import { bag, roast, sneeze, steadyAgainst, trollSacks } from './trolls.ts';
import { AXE_FREED, axeMastery, axeTest, canHeadbutt, deadeye, goodSort, hasMattock, hasOakenshield, longbeard, loyalTo, mayAxeTest, mayLongbeard, maySwap, mayTend, rerollFor, spentPoints, tend, trumpet, trumpetDue } from './company.ts';
import { tierOf } from './warbands.ts';
import { MORGUL, morgulBlades } from './morgul.ts';
import { MAX_DICE } from './reducer.ts';
import { bandName, bandsOf, mayPutDown, procedureOf, rollDue, rollMeans } from './deploy.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

/** Dice requests a player sends, which only whoever holds the dice (the server, or the browser in practice games) can answer. */
export const DICE_REQUESTS = new Set<Action['type']>(['setNarrative', 'ring', 'cry', 'aragorn', 'seek', 'skitter', 'roll', 'fight', 'strikes', 'shoot', 'shotOn', 'banner', 'dismount', 'trample', 'cross', 'rollFate', 'rollPriority', 'rollDeploy', 'deployWarband', 'uncover', 'cast', 'resist', 'breach', 'hurl', 'swap', 'reroll', 'tend', 'longbeard', 'trumpet', 'axeTest', 'chronicled', 'detonate', 'rideOut', 'raiseLadder']);

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
  // (A strike may be aimed at a rider's mount.)
  const target = (id: string, side: Fighter[]) => (side.some(f => f.id === id.replace(/#mount$/, '')) ? id : side[0].id);
  return { ...req, sides, targets: [target(req.targets[0], sides[1]), target(req.targets[1], sides[0])] };
}

/**
 * What the game decides about a fight whatever the player sent: a supporting model must really be able to support
 * (once its duel is rolled, it must have rolled in it) and lends one die; a Heroic Strike keeps the bonus rolled at
 * the hero's first fight this phase; and a tie between Good and Evil is settled by the Good/Evil roll.
 */
export function prepareFight(state: GameState, catalog: Catalog | null, req: FightRequest | null, duel?: DiceRoll[]): FightRequest | null {
  const fresh = freshFighters(state, req);
  if (!fresh) return null;
  const front = fresh.sides.map(side => side.filter(f => !f.support).map(f => f.id));
  if (!front[0].length || !front[1].length) return null;
  const offered = supporters(state, catalog, { key: '', p1: front[0], p2: front[1] });
  // Shielding is all or nothing for a side: every model in the fight must be able to, and then none can be Supported.
  const shields = fresh.sides.map(side => {
    const main = side.filter(f => !f.support);
    // The players' choices are kept in the game (either player may roll the fight); a model added by hand goes by the request.
    const asked = (f: Fighter) => (state.models[f.id] && modelStats(catalog, state.models[f.id]) ? !!state.flow.choices?.[f.id]?.shielding : !!f.shielding);
    return main.some(asked) && main.every(f => !state.models[f.id] || !cantShield(catalog, state.models[f.id]));
  });
  const sides = fresh.sides.map((side, i) =>
    side
      .filter(f => {
        if (!f.support) return true;
        if (shields[i]) return false;
        const m = state.models[f.id];
        if (!m || m.owner !== (i === 0 ? 'p1' : 'p2')) return false;
        return duel ? duel.some(r => r.support && r.model === f.id && r.side === i) : offered[m.owner].includes(f.id);
      })
      .map(f => {
        // A model with a profile fights as its profile, wargear and rules say, whatever numbers were sent.
        const m = state.models[f.id];
        const built = m && modelStats(catalog, m) ? { ...fighterOf(state, catalog, m, { shielding: shields[i] && !f.support, twoHanded: state.flow.choices?.[f.id]?.twoHanded }), ...(f.support ? { support: true } : {}) } : { ...f, shielding: undefined, twoHanded: undefined };
        if (f.support) Object.assign(built, { a: 1, shielding: undefined, noStrike: undefined });
        return { ...built, ...(built.strike && state.flow.strikeBonus?.[f.id] ? { strikeBonus: state.flow.strikeBonus[f.id] } : {}) };
      }),
  ) as [Fighter[], Fighter[]];
  // One spear behind each fighter.
  if (!duel)
    sides.forEach((side, i) => {
      const kept = new Set(oneSpearEach(state, catalog, front[i], side.filter(f => f.support).map(f => f.id)));
      sides[i] = side.filter(f => !f.support || kept.has(f.id));
    });
  const sideOfFight = (i: 0 | 1) => {
    const found = new Set(front[i].map(id => state.models[id] && sideOf(catalog, state.models[id])));
    return found.size === 1 ? [...found][0] : undefined;
  };
  const [a, b] = [sideOfFight(0), sideOfFight(1)];
  // A Shielding model isn't using its weapon, Elven or not.
  const elven = [0, 1].map(i => !shields[i] && front[i].some(id => state.models[id] && hasElvenWeapon(catalog, state.models[id]))) as [boolean, boolean];
  const draw: DrawRule | undefined = a && b && a !== b ? { good: a === 'Good' ? 0 : 1, elven } : undefined;
  // A charge: cavalry and Monstrous Charge get an extra Attack (and knock down the foes they beat), and a lance
  // wounds more easily, unless the charger is in difficult ground or charged a defended wall.
  const held = defence(state, [front[0], front[1]]);
  sides.forEach((side, i) =>
    side.forEach(f => {
      const m = state.models[f.id];
      if (f.support || !m || !modelStats(catalog, m)) return;
      const foes = front[1 - i].map(id => state.models[id]).filter((x): x is Model => !!x);
      const { bonus, lance, notes: why } = chargeEffects(state, catalog, m, foes, held?.attacker === f.id);
      if (bonus) {
        f.charged = bonus;
        // (A war beast's Irresistible Force only knocks foes down.)
        if (bonus !== 'beast') f.a = Math.min(10, f.a + 1);
      }
      if (lance) f.woundMod = (f.woundMod ?? 0) + 1;
      const notes = [...(f.notes ?? []), ...why];
      if (notes.length) f.notes = notes;
    }),
  );
  // Who each supporting model backs up: the friends in the fight it touches (a monster gets a free strike at them).
  const backing: Record<string, string[]> = {};
  sides.forEach((side, i) =>
    side.filter(f => f.support && state.models[f.id]).forEach(f => {
      for (const id of front[i]) if (state.models[id] && distanceBetween(state.models[id], state.models[f.id]) <= CONTACT_SLACK) (backing[id] ??= []).push(f.id);
    }),
  );
  // A pike backing a supporting pike backs up the same friend, so it is struck too (Rulebook FAQ).
  sides.forEach(side => {
    const pikes = side.filter(f => f.support && state.models[f.id] && hasPike(catalog, state.models[f.id])).map(f => f.id);
    for (const list of Object.values(backing))
      for (let k = 0; k < list.length; k++)
        if (pikes.includes(list[k])) for (const h of pikes) if (!list.includes(h) && distanceBetween(state.models[h], state.models[list[k]]) <= CONTACT_SLACK) list.push(h);
  });
  return { ...fresh, sides, ...(draw ? { draw } : {}), ...(Object.keys(backing).length ? { backing } : {}) };
}

/**
 * What the powers on each fighter do to it, worked out here whatever the player sent: Wither and Enrage Beast change
 * its numbers, Bladewrath makes its strikes Strength 6, Enchant Blades re-rolls its misses, a Paralysed model adds
 * nothing, and a Transfixed, Prone or thrown one makes no strikes.
 */
export function adjustFight(state: GameState, req: FightRequest, catalog: Catalog | null = null): FightRequest {
  const adjust = (f: Fighter, i: number): Fighter => {
    const m = state.models[f.id];
    if (!m) return f;
    const out: Fighter = { ...f, s: witheredStrength(m, f.s) };
    if (under(state, m, 'Enrage Beast')) Object.assign(out, { f: Math.min(10, out.f + 2), s: Math.min(10, out.s + 2), a: Math.min(10, out.a + 2) });
    if (under(state, m, 'Bladewrath')) out.s = 6;
    if (under(state, m, 'Enchant Blades')) out.reroll = true;
    if (under(state, m, 'Paralyse')) out.still = true;
    const why = noStrikes(state, m);
    if (why) out.noStrike = why;
    // A Heroic Challenge: +1 Attack while fighting the rival hero (who gets the same if it took the challenge up).
    const foes = req.sides.flat().filter(x => !x.support && state.models[x.id] && state.models[x.id].owner !== m.owner).map(x => x.id);
    const rival = (state.flow.challenges ?? []).map(c => (c.by === m.id ? c.target : c.target === m.id && c.accepted ? c.by : undefined)).find(id => id && foes.includes(id));
    if (rival && !f.support) Object.assign(out, { a: Math.min(10, out.a + 1), rival });
    // Thorin's Company's own rules (see company.ts), and the Trolls' (see trolls.ts).
    if (!f.support) {
      const pick = state.flow.choices?.[m.id] ?? {};
      const theirs = req.sides[1 - i].filter(x => !x.support).map(x => x.id);
      const ours = req.sides[i].filter(x => !x.support);
      const times = out.shielding ? 2 : 1;
      if (loyalTo(state, catalog, m)) out.ones = true;
      if (goodSort(state, catalog, m)) Object.assign(out, { a: Math.max(out.a, 3 * times), duelOnes: true });
      if (axeMastery(catalog, m) && ours.length === 1 && theirs.length >= 2) out.a = Math.max(out.a, 4 * times);
      if (pick.headbutt && theirs.includes(pick.headbutt) && canHeadbutt(catalog, m)) out.headbutt = pick.headbutt;
      if (pick.knock && theirs.includes(pick.knock) && hasMattock(catalog, m)) out.knock = pick.knock;
      if (out.shielding && hasOakenshield(catalog, m)) out.oak = pick.oak && theirs.includes(pick.oak) ? pick.oak : theirs[0];
      if (isTroll(m)) out.squash = touchingEnemies(state, m).map(e => e.id).filter(id => theirs.includes(id));
      // Tom's Lingering Cold halves its Fight until the turn ends (a Heroic Strike's bonus still comes on top).
      if (m.chilled === state.turn) out.f = Math.ceil(out.f / 2);
    }
    // Roast Mutton: the Trolls may not strike Bilbo at first.
    const spare = spareFor(state, m);
    if (spare.length) out.spare = [...new Set([...(out.spare ?? []), ...spare])];
    // Fighting an Invisible model that has no friends in the fight halves its Fight (rounding up); not the Nine's.
    const others = req.sides[1 - i].filter(x => !x.support).map(x => state.models[x.id]).filter(Boolean);
    if (!f.support && others.length === 1 && invisibleTo(others[0], m)) out.f = Math.ceil(out.f / 2);
    // The rules of the heroes and warriors at Helm's Deep (see towers.ts).
    if (catalog && modelStats(catalog, m)) towersFight(state, catalog, m, out);
    // What its strikes need against each enemy it could strike (Hatred, Ancient Enemies, Blades of the Dead).
    if (catalog) out.vs = Object.fromEntries(req.sides[1 - i].filter(t => !t.support).map(t => [t.id, strikeAgainst(catalog, state, out, t)]));
    return out;
  };
  return { ...req, sides: [req.sides[0].map(f => adjust(f, 0)), req.sides[1].map(f => adjust(f, 1))] };
}

/**
 * Rolls the dice for a player's request and returns the results to apply, or null if the request isn't allowed.
 * `d6` rolls one die and `uid` makes a unique id; `catalog` gives the profiles some powers need.
 */
export function resolveRequest(state: GameState, seat: Seat, action: Action, d6: () => number, uid: () => string, now = Date.now(), catalog: Catalog | null = null): Resolved | null {
  const mine = (id: unknown) => typeof id === 'string' && state.models[id]?.owner === seat;
  switch (action.type) {
    case 'setNarrative': {
      // The casts are built from the bundled profiles, so only whoever holds them can set the scenario up.
      const n = narrativeById(String(action.id));
      if (!n || !catalog || state.flow.started || (action.good !== 'p1' && action.good !== 'p2')) return null;
      const { models } = narrativeSetup(n, action.good, catalog, p => `${p}-${uid()}`);
      return { apply: [{ type: 'startNarrative', id: n.id, good: action.good, models, ...(n.turns ? { turns: Number(action.turns) || n.turns.default } : {}) }] };
    }
    case 'ring': {
      const out = ringRequest(state, catalog, seat, String(action.id), action.on === true, d6, uid, now);
      return out && { apply: out };
    }
    case 'seek': {
      const out = seekRequest(state, catalog, seat, String(action.id), String(action.target), d6, uid, now);
      return out && { apply: out };
    }
    case 'skitter': {
      const out = skitterRequest(state, catalog, seat, String(action.id), d6, uid, now);
      return out && { apply: out };
    }
    case 'cry': {
      if (!mayCry(state, seat)) return null;
      const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: 'The Cry of the Nazgûl', dice: [], note: 'Good models take Courage tests 3 worse until the End phase.', at: now };
      return { apply: [{ type: 'rolled', roll }, { type: 'cry', seat }] };
    }
    case 'aragorn': {
      // Rolling for Aragorn is the Good player's choice, except after the Cry, when he comes anyway.
      if (!arrivalDue(state) || arrivalAuto(state) || seat !== state.narrative?.good) return null;
      return { apply: action.roll === true ? rollArrival(state, d6, uid, now) : skipArrival(state, uid, now) };
    }
    case 'roll': {
      // The roll for which side's hero goes first, once, by the player with Priority: 1-3 Evil, 4+ Good.
      if (String(action.label ?? '') === orderRollLabel(state)) {
        if (!orderRollNeeded(state) || orderRoll(state) || (state.priority && seat !== state.priority)) return null;
        const die = d6();
        const evil = (['p1', 'p2'] as const).find(s => Object.values(state.models).some(m => m.owner === s && sideOf(catalog, m) === 'Evil'));
        const good = evil ? other(evil) : undefined;
        const first = die <= 3 ? (evil ?? other(state.priority ?? 'p1')) : (good ?? state.priority ?? 'p1');
        const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: orderRollLabel(state), dice: [die], note: `${state.names[first] || (first === 'p1' ? 'Player 1' : 'Player 2')}'s hero goes first`, at: now };
        return { apply: [{ type: 'rolled', roll }, { type: 'heroicOrder', seat: first }] };
      }
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
      // Not while a model from the last fight is still being placed.
      if (state.flow.started && placingNow(state)) return null;
      const fresh = prepareFight(state, catalog, cleanFight(action.fight));
      const req = fresh && adjustFight(state, fresh, catalog);
      if (!req || (state.flow.started && req.combat && fightDone(state, combatFromKey(state, req.combat) ?? { key: req.combat, p1: [], p2: [] })) || duelOpen(state, req.sides.flat().map(f => f.id))) return null;
      const group = `f-${uid()}`;
      // Tom's Lingering Cold comes as the fight starts, before the dice.
      const cold = sneeze(state, catalog, req, d6, seat, group, now);
      for (const a of cold.actions) if (a.type === 'affect' && a.patch.chilled) for (const f of req.sides.flat()) if (f.id === a.id && !f.support) f.f = Math.ceil(f.f / 2);
      return { apply: [...cold.rolls.map((roll): Action => ({ type: 'rolled', roll })), ...cold.actions, ...resolveDuel(req, d6, seat, group, now).map((roll): Action => ({ type: 'rolled', roll }))] };
    }
    case 'strikes': {
      const group = String(action.group ?? '');
      const rolls = state.log.filter(r => r.group === group);
      const fresh = prepareFight(state, catalog, cleanFight(action.fight), rolls);
      const req = fresh && adjustFight(state, fresh, catalog);
      // Strikes follow a duel that's still in the log, once.
      if (!req || !group.startsWith('f-') || !rolls.some(r => r.side !== undefined) || rolls.some(r => duelSettled(r))) return null;
      // Supporting models aren't in the fight: they neither back away nor get up.
      const ids = (side: 0 | 1) => req.sides[side].filter(f => !f.support).map(f => f.id).filter(id => state.models[id]);
      const helpers = (side: 0 | 1) => req.sides[side].filter(f => f.support).map(f => f.id).filter(id => state.models[id]);
      // A Brutal Power Attack only by a monster in the fight that may make one, and a Hurl only of a weaker enemy.
      const b = req.brutal;
      const brute = b && req.sides.flat().find(f => f.id === b.by && !f.support && f.monster);
      const bm = brute && state.models[brute.id];
      const foeSide = brute && req.sides.findIndex(side => !side.includes(brute)) as 0 | 1;
      const hurled = b?.kind === 'hurl' && brute ? req.sides[foeSide as 0 | 1].find(f => f.id === b.target && !f.support && f.s < brute.s && !!state.models[f.id] && !immovable(catalog, state.models[f.id])) : undefined;
      // ("Bring them down!": three or more Orcs touching an Ent may pull it down instead; see ents.ts.)
      const toppling = b?.kind === 'topple' ? req.sides.findIndex(side => side.some(f => f.id === b.by && !f.support)) : -1;
      const toppled = toppling >= 0 ? bringDownTarget(state, req, toppling as 0 | 1) : undefined;
      if (toppled) req.brutal = { by: b!.by, kind: 'topple', target: toppled };
      else if (!b || !bm || !brutalOptions(state, catalog, bm).includes(b.kind) || (b.kind === 'hurl' && !hurled)) delete req.brutal;
      // Other monsters on the brute's side making theirs first: each one once, and only one it may make.
      const winSide = (x: BrutalAttack) => req.sides.findIndex(side => side.some(f => f.id === x.by && !f.support && f.monster));
      if (req.more) req.more = req.more.filter((x, k, all) => x.by !== req.brutal?.by && all.findIndex(y => y.by === x.by) === k && !!state.models[x.by] && brutalOptions(state, catalog, state.models[x.by]).includes(x.kind) && (!req.brutal || winSide(x) === winSide(req.brutal)));
      // A Troll stuffing a foe in a sack does that instead of striking, or of a Brutal Power Attack.
      const sacks = trollSacks(state, catalog, req);
      for (const x of sacks) {
        for (const f of req.sides.flat()) if (f.id === x.by) f.noStrike = `stuffs ${state.models[x.target].name} in a sack`;
        if (req.brutal?.by === x.by) delete req.brutal;
        if (req.more) req.more = req.more.filter(y => y.by !== x.by);
      }
      // Bofur's Steadfast against the Trolls' own Brutal Power Attacks: a 3+ and the foe shrugs it off.
      const bpas = [...(req.more ?? []), ...(req.brutal ? [req.brutal] : [])].filter(x => TROLL_BRUTALS.has(x.kind));
      const steadied: DiceRoll[] = [];
      for (const x of bpas) {
        const f = req.sides.flat().find(y => y.id === x.by);
        if (!f) continue;
        const hit = x.kind === 'squash' ? (f.squash ?? []) : x.target ? [x.target] : [];
        const st = steadyAgainst(state, catalog, hit, BPA_NAMES[x.kind], d6, group, now);
        steadied.push(...st.rolls);
        if (st.immune.length) f.immune = [...(f.immune ?? []), ...st.immune];
      }
      // A Morgul Blade declared before the strikes: every strike its bearer makes goes at the one enemy it picked.
      const blades = morgulBlades(state, catalog, req);
      if (blades.length) req.aims = { ...req.aims, ...Object.fromEntries(blades.map(x => [x.by, Array(10).fill(x.target)])) };
      // Sam swings his Frying Pan, if his side wins, instead of striking.
      const pans = fryingPans(state, catalog, req);
      for (const x of pans) for (const f of req.sides.flat()) if (f.id === x.by) f.noStrike = 'swings his Frying Pan';
      // A fight over a defended wall, ledge or doorway: strikes come before anyone backs away, so no one is trapped
      // (bar the Prone), the attacker's strikes must get past the defences, and only the attacker backs away.
      const held = defence(state, [ids(0), ids(1)]);
      const attackers = held ? ((ids(0).includes(held.attacker) ? 0 : 1) as 0 | 1) : undefined;
      // Otherwise the losers back away 1" by themselves; one with nowhere to go is trapped, and takes double strikes.
      // A model being hurled goes nowhere until it's thrown.
      let retreat: Retreat | undefined;
      const trapped = new Set<string>();
      // War beasts and chariots never back away: whoever beat them backs away from them instead (between two of them,
      // the smaller one gives ground; see warBeasts.ts).
      const fixed = (id: string) => !!state.models[id] && immovable(catalog, state.models[id]);
      let standoff: DiceRoll | undefined;
      // (A Hobbit and Grishnákh fighting at Ambush at Night fight as if neither were Prone.)
      const downed = (id: string) => !!state.models[id]?.prone && !fightsUpright(state, state.models[id]);
      const giving = (winner: 0 | 1): { movers: string[]; from: string[] } => {
        const losing = ids((1 - winner) as 0 | 1);
        const winning = ids(winner);
        const movers = losing.filter(id => !downed(id) && id !== hurled?.id && !fixed(id));
        const big = losing.find(fixed);
        if (!big) return { movers, from: winning };
        const rival = winning.find(fixed);
        if (rival) {
          const r = biggerHolds(catalog, state.models[big], state.models[rival], d6);
          if (r.roll) standoff = { id: `${group}-im`, by: seat, label: `Immovable Objects: 1-3 the Evil side gives way, 4-6 the Good`, dice: [r.roll], at: now, group };
          if (r.backs === 'a') return { movers: [...movers, big], from: winning };
        }
        return { movers: [...movers, ...winning.filter(id => !fixed(id))], from: [...winning, ...losing] };
      };
      const retreatFor = (winner: 0 | 1) => {
        if (retreat) return retreat;
        if (held) return (retreat = backAway(state, [held.attacker], [held.defender]));
        const g = giving(winner);
        return (retreat = backAway(state, g.movers, g.from));
      };
      // A charger that wins knocks foes to the ground before they're struck (so they're trapped).
      let knocked: { prone: string[]; flying: string[] } | undefined;
      const footing: DiceRoll[] = [];
      const knocksFor = (winner: 0 | 1) => {
        if (knocked) return knocked;
        knocked = { prone: [], flying: [] };
        const losing = ids((1 - winner) as 0 | 1).map(id => state.models[id]);
        for (const f of req.sides[winner]) {
          if (!f.charged) continue;
          const k = knockedDown(catalog, f.charged, f.s, losing);
          knocked = { prone: [...new Set([...knocked.prone, ...k.prone])], flying: [...new Set([...knocked.flying, ...k.flying])] };
        }
        // Brego, a sure-footed steed, keeps Aragorn in the saddle on a 6.
        for (const id of knocked.flying.filter(id => /\bbrego\b/i.test(state.models[id]?.mount ?? ''))) {
          const d = d6();
          footing.push({ id: `${group}-brego${footing.length}`, by: seat, label: `Sure-footed Steed: ${state.models[id].name} stays on Brego on a 6`.slice(0, 80), dice: [d], target: 6, model: id, at: now, group, note: d === 6 ? 'Brego keeps his feet.' : 'He is thrown.' });
          if (d === 6) knocked.flying = knocked.flying.filter(x => x !== id);
        }
        return knocked;
      };
      const cornered = (winner: 0 | 1, target: string) => {
        // A Prone model that loses is always trapped.
        const k = knocksFor(winner);
        // A war beast or chariot is never trapped.
        if (fixed(target)) return false;
        const stuck = downed(target) || k.prone.includes(target) || k.flying.includes(target) || (!held && retreatFor(winner).trapped.includes(target));
        if (stuck) trapped.add(target);
        return stuck;
      };
      const { rolls: strikes, outcome } = resolveStrikes(req, rolls, d6, seat, group, now, cornered, held ? { attackers: attackers!, name: held.name } : undefined);
      const loser = (1 - outcome.winner) as 0 | 1;
      const bargeOn = outcome.ended === 'barge';
      // A Barge pushes every foe (and their supporters) back 3", and any that can't go so far fall over.
      const barge = bargeOn ? pushBack(state, [...ids(loser), ...helpers(loser)].filter(id => !fixed(id)), ids(outcome.winner), 3) : undefined;
      const back = bargeOn ? { moves: barge!.moves, trapped: [], madeWay: [], falls: [] } : retreatFor(outcome.winner);
      const winners = ids(outcome.winner);
      // The Morgul Blades that struck are used up; a wound one of them does that isn't prevented slays outright.
      const bladed = bargeOn || outcome.ended ? [] : blades.filter(x => winners.includes(x.by) && req.sides[outcome.winner].some(f => f.id === x.by && !f.noStrike && !f.shielding));
      const slays = new Set(bladed.filter(x => strikeWounds(strikes.filter(r => r.model === x.by && r.against === x.target)) > 0).map(x => x.target));
      const bladeUsed = bladed.map((x): Action => ({ type: 'affect', id: x.by, patch: { used: [...(state.models[x.by].used ?? []), MORGUL] } }));
      // A Prone winner gets up instead of striking (unless Paralysed).
      const rise = winners.filter(id => downed(id) && !state.models[id].crawls && !under(state, state.models[id], 'Paralyse'));
      const slain = (id: string) => (outcome.hits.find(h => h.target.id === id)?.wounds ?? 0) >= (state.models[id]?.wounds ?? 1);
      const moves: Extract<Action, { type: 'backAway' }>['moves'] = [];
      // A defender that falls lets its attacker take its place; otherwise the attacker backs away (when it can).
      const crossing = (w: string, l: string) => moves.push({ id: w, x: state.models[l].x, y: state.models[l].y, ifSlain: l });
      for (const mv of back.moves) moves.push({ ...mv, ...(held ? { unlessSlain: held.defender } : {}) });
      if (held && attackers === outcome.winner) crossing(held.attacker, held.defender);
      // Fighting across a wall without its protection (attacked from both sides), a winner touching only that foe still crosses.
      if (!held)
        for (const w of winners)
          for (const l of ids(loser))
            if (wallBetween(state, state.models[w], state.models[l]) && touchingEnemies(state, state.models[w]).every(e => e.id === l)) crossing(w, l);
      // The winners step apart from a trapped loser that lived through the strikes.
      if (!outcome.ended) moves.push(...separate(state, [...trapped].filter(id => !slain(id)), winners));
      // Ringwraiths beaten by a flaming brand go on retreating, once they've backed away.
      const fled = bargeOn
        ? []
        : brandRetreats(
            { ...state, models: Object.fromEntries(Object.entries(state.models).map(([k, m]) => { const mv = back.moves.find(x => x.id === k); return [k, slain(k) ? { ...m, dead: true } : mv ? { ...m, x: mv.x, y: mv.y } : m]; })) },
            ids(loser).filter(id => !slain(id) && !held),
            winners,
            d6,
            seat,
            group,
            now,
          );
      // A loser pushed over the edge of a drop falls once the strikes are done, if it lived.
      const extra: DiceRoll[] = [...footing];
      if (standoff) extra.push(standoff);
      const push = (label: string, dice: number[], more: Partial<DiceRoll> = {}) => extra.push({ id: `${group}-fall${extra.length}`, by: seat, label: label.slice(0, 80), dice, at: now, group, ...more });
      const falls = back.falls.filter(f => !slain(f.id)).flatMap(f => {
        const m = state.models[f.id];
        const hurt = fallDamage(catalog, m, f.drop, d6, push, group);
        return [{ type: 'affect', id: f.id, patch: { prone: true } } as Action, ...hurt];
      });
      // A loser fighting from a Siege Ladder doesn't back away: it falls off on a 1-3, and so may each friend below it.
      const offLadder: Action[] = [];
      if (!bargeOn) {
        const climbers = ids(loser).map(id => state.models[id]).filter(l => !slain(l.id) && !l.prone && winners.some(w => { const wall = wallBetween(state, state.models[w], l) ?? upLadder(state, l, state.models[w]); return !!wall && onLadder(state, l)?.raised === wall.id; }));
        const ladders = new Set(climbers.map(l => onLadder(state, l)!.id));
        const below = Object.values(state.models).filter(f => f.owner === state.models[ids(loser)[0]]?.owner && !f.dead && !climbers.includes(f) && !ids(loser).includes(f.id) && ladders.has(onLadder(state, f)?.id ?? ''));
        for (const l of [...climbers, ...below]) {
          const i = moves.findIndex(mv => mv.id === l.id);
          if (i >= 0) moves.splice(i, 1);
          const d = d6();
          push(`${l.name} keeps its footing on the ladder (4+)`, [d], { target: 4, model: l.id, note: d <= 3 ? `${l.name} falls off the ladder.` : `${l.name} hangs on.` });
          const wall = state.terrain[onLadder(state, l)!.raised!];
          if (d <= 3) offLadder.push({ type: 'affect', id: l.id, patch: { prone: true } }, ...fallDamage(catalog, l, wall ? heightOf(wall) : 2, d6, push, group));
        }
      }
      // Fighting over a Spiked Barricade, an attacker whose strike hits it instead is hurt by the spikes.
      const spiked = held?.how === 'wall' ? wallBetween(state, state.models[held.attacker], state.models[held.defender]) : undefined;
      if (spiked?.barricade === 'spiked') {
        for (const r of strikes.filter(r => r.label.startsWith('In the Way') && r.model && state.models[r.model]))
          for (let i = 0; i < r.dice.filter(d => d < 4).length; i++) {
            const a = state.models[r.model!];
            const need = woundNeed(3, modelStats(catalog, a)?.D ?? 4);
            if (!need) continue;
            const dice = [d6()];
            const follow = need.then && dice[0] >= need.target ? [d6()] : undefined;
            const hurt = need.then ? !!follow && follow[0] >= need.then : dice[0] >= need.target;
            push(`Spikes: S3 hit on ${a.name}`, dice, { target: need.target, against: a.id, ...(need.then ? { then: need.then, follow } : {}), note: hurt ? `${a.name} is wounded.` : `${a.name} shrugs it off.` });
            if (hurt) offLadder.push({ type: 'wound', id: a.id, count: 1, how: 'other', group });
          }
      }
      if (back.madeWay.length && strikes.length) {
        const last = strikes[strikes.length - 1];
        const note = back.madeWay.map(w => `${state.models[w.id].name} makes way for ${state.models[w.for].name}`).join('. ');
        last.note = (last.note ? `${last.note}. ${note}` : note).slice(0, 200);
      }
      // Knocked down by a charge, or short of room to be barged: Prone, or a rider thrown from its mount.
      const down = (id: string, flying: boolean): Action => ({ type: 'affect', id, patch: flying && mounted(state.models[id]) ? { throwPending: 'flying' } : { prone: true } });
      const knocks = outcome.ended ? { prone: [], flying: [] } : knocksFor(outcome.winner);
      const felled = [...knocks.prone.map(id => down(id, false)), ...knocks.flying.map(id => down(id, true)), ...(barge?.short ?? []).map(id => down(id, true))].filter(a => a.type === 'affect' && !slain(a.id));
      // A Frying Pan swung by a winner: on a 4+ its target can't move next turn.
      const panned: Action[] = [];
      for (const x of outcome.ended ? [] : pans.filter(p => winners.includes(p.by))) {
        const t = state.models[x.target];
        if (slain(t.id)) continue;
        const d = d6();
        push(`Frying Pan: ${state.models[x.by].name} swings at ${t.name} (4+)`, [d], { target: 4, model: x.by, note: d >= 4 ? `${t.name} is stunned and can't move next turn.` : `${t.name} shakes it off.` });
        if (d >= 4) panned.push({ type: 'affect', id: t.id, patch: { panned: state.turn + 1 } });
      }
      // The Trolls' own: a foe in a sack, one carried to the fire, those sat on knocked down.
      const trolled: Action[] = [];
      for (const x of outcome.ended ? [] : sacks.filter(x => winners.includes(x.by))) {
        const t = state.models[x.target];
        if (slain(t.id)) continue;
        const b = bag(state, catalog, state.models[x.by], t, d6, seat, `${group}-sack-${t.id}`.slice(0, 80), now, group);
        extra.push(...b.rolls);
        trolled.push(...b.actions);
      }
      const madeBy = (x: BrutalAttack) => winners.includes(x.by) && req.sides[outcome.winner].some(f => f.id === x.by && !f.noStrike);
      const theirs = [...(req.more ?? []), ...(req.brutal ? [req.brutal] : [])].filter(madeBy);
      // (They are all on one side, so Bofur's rolls count if that side won.)
      if (theirs.some(x => TROLL_BRUTALS.has(x.kind))) extra.unshift(...steadied);
      for (const x of theirs.filter(x => x.kind === 'roast')) {
        const t = x.target ? state.models[x.target] : undefined;
        const f = req.sides[outcome.winner].find(y => y.id === x.by);
        if (!t || slain(t.id) || f?.immune?.includes(t.id)) continue;
        trolled.push(...roast(state, state.models[x.by], t));
      }
      for (const id of outcome.squashed ?? []) if (!slain(id)) trolled.push({ type: 'affect', id, patch: { prone: true } });
      // Bofur's Mattock knocked its foe down before the strikes.
      for (const id of outcome.knocked ?? []) if (!slain(id)) trolled.push({ type: 'affect', id, patch: { prone: true } });
      // Bifur's headbutt that wounds frees the axe from his head.
      for (const f of outcome.ended ? [] : req.sides[outcome.winner].filter(f => f.headbutt)) {
        const m = state.models[f.id];
        if (m && !m.used?.includes(AXE_FREED) && strikeWounds(strikes.filter(r => r.model === f.id && r.against === f.headbutt)) > 0) trolled.push({ type: 'affect', id: f.id, patch: { used: [...(m.used ?? []), AXE_FREED] } });
      }
      // The monster's Brutal Power Attack: noted for the turn, then the Barge's free move or the Hurl itself.
      const brutalDone: Action[] = theirs.filter(x => x !== req.brutal).map((x): Action => ({ type: 'brutal', id: x.by }));
      if (req.brutal && bm && req.sides[outcome.winner].some(f => f.id === bm.id)) {
        if (bargeOn) {
          const d3 = Math.ceil(d6() / 2);
          push(`Barge: ${bm.name} may now move ${3 + d3}" (D3 + 3)`, [d3], { note: `${bm.name} can move again this phase, and charge into a new fight.` });
          brutalDone.push({ type: 'brutal', id: bm.id, barge: 3 + d3 });
        } else if (outcome.ended === 'hurl' && hurled) {
          const h = hurl(state, catalog, bm, state.models[hurled.id], req.brutal.at, d6, seat, group, now);
          extra.push(...h.rolls);
          brutalDone.push({ type: 'brutal', id: bm.id, ...(h.at ? { hurledAt: h.at } : {}) }, ...h.actions);
        } else brutalDone.push({ type: 'brutal', id: bm.id });
      }
      // Wounds go first, so a loser they slay stays where it fell rather than backing away.
      return {
        apply: [
          ...strikes.map((roll): Action => ({ type: 'rolled', roll })),
          ...outcome.hits.flatMap(h => {
            const at = strikes.filter(r => r.against === h.target.id);
            const by = [...new Set(at.map(r => r.model!).filter(Boolean))];
            // Strikes at a rider's mount wound the mount.
            if (h.target.id.endsWith('#mount')) return woundAction(state, at, h.target.id.slice(0, -6), h.wounds, by, 'fight', group).map(a => ({ ...a, mount: true }) as Action);
            return woundAction(state, at, h.target.id, h.wounds, by, 'fight', group).map(a => (slays.has(h.target.id) ? ({ ...a, slay: true } as Action) : a));
          }),
          ...bladeUsed,
          ...(moves.length ? [{ type: 'backAway', moves } as Action] : []),
          ...fled,
          ...felled,
          ...extra.map((roll): Action => ({ type: 'rolled', roll })),
          ...falls,
          ...offLadder,
          ...brutalDone,
          ...panned,
          ...trolled,
          ...rise.map((id): Action => ({ type: 'affect', id, patch: { prone: false } })),
        ],
        ...(req.combat ? { record: { type: 'resolveCombat', key: req.combat } } : {}),
      };
    }
    case 'shoot': {
      const req = cleanShot(action.shot);
      const shooter = req && state.models[req.shooter.id];
      const target = req && state.models[req.target.id];
      // (Aldor, with his Unsteady Nerves, shoots first: even while one of his side's heroes makes a Heroic Shoot.)
      if (!req || !shooter || !target || shooter.owner !== seat || !(mayActivate(state, shooter) || (unsteady(catalog, shooter) && heroicNow(state)?.seat === seat))) return null;
      // The game works the shot out from the table: whether it can be taken, what it needs and what's in the way.
      const fallback = { weapon: missileWeapon([req.shooter.weapon]), shoot: req.shooter.shoot };
      const plan = planShot(state, catalog, shooter, target, { charge: req.charge, brand: req.brand, pinpoint: req.pinpoint, fallback });
      if (plan.why || !plan.weapon) return null;
      // A siege engine's shot is worked out its own way (see siege.ts); the Avenger Bolt Thrower looses a D6 bolts
      // like a bow.
      const bolts = shooter.siege && rapidFire(catalog, shooter) ? boltCount(shooter, d6) : undefined;
      // A heavy shot across an Iron Hills Ballista's line is caught by it on a 5+.
      if (plan.weapon.s >= 7 && acrossCable(state, shooter, target)) {
        const d = d6();
        const group = `s-${uid()}`;
        if (d >= 5) return { apply: [{ type: 'rolled', roll: { id: `${group}-0`, by: seat, label: `${shooter.name}'s shot crosses the line (5+ stops it)`.slice(0, 80), dice: [d], target: 5, model: shooter.id, at: now, group, note: 'The line catches the shot.' } }] };
      }
      if (shooter.siege && !bolts) {
        if (state.flow.shotPause) return null;
        return { apply: fireEngine(state, catalog, { engine: shooter, target, need: plan.need, heads: !!req.heads && !!shooter.options?.includes('Severed Heads'), might: !req.keepMight }, d6, seat, `s-${uid()}`, now, uid) };
      }
      if (bolts) plan.shots = bolts.n;
      const stats = modelStats(catalog, target);
      const dOf = (id: string) => modelStats(catalog, state.models[id])?.D ?? 4;
      req.shooter = { ...req.shooter, name: shooter.name, weapon: plan.weapon.name, shoot: plan.need, s: plan.weapon.s, shots: plan.shots };
      req.target = { id: target.id, name: target.name, d: plan.d ?? stats?.D ?? req.target.d };
      if (plan.ones) req.ones = true;
      if (plan.bane) req.bane = true;
      if (plan.woundBonus) req.woundBonus = plan.woundBonus;
      if (plan.lucky) req.lucky = true;
      if (isWebs(plan.weapon)) req.webs = true;
      if (!plan.pinpoint) delete req.pinpoint;
      // A rider can be hit, or its mount; a Sharpshooter picks which.
      const steed = mountOf(target);
      if (steed && steed.left > 0) {
        req.target.mount = { name: mountLabel(steed.name), d: steed.d, ...(steed.monster ? { monster: true } : {}), ...(steed.chariot ? { chariot: true } : {}) };
        if (hasRule(catalog, shooter, 'Sharpshooter')) req.sharp = true;
        else delete req.atMount;
      } else delete req.atMount;
      req.inWay = plan.inWay.slice(0, 6).map(o => (o.model ? { name: o.name, id: o.model, d: dOf(o.model) } : { name: o.name }));
      // A war beast's Howdah: it can be aimed at instead of the beast, and it's always in the way of those riding in it.
      const howdah = howdahFor(target.beast === 'war' ? target.name : target.aboard ? state.models[target.aboard]?.name : undefined);
      const carrier = target.aboard ? state.models[target.aboard] : target;
      if (howdah && carrier?.howdahWounds && req.atHowdah && !target.aboard) req.target = { id: `${target.id}#howdah`, name: `${target.name}'s Howdah`, d: howdah.d };
      else delete req.atHowdah;
      if (howdah && carrier?.howdahWounds && target.aboard && commanderOf(state, carrier)?.id !== target.id) req.inWay = [{ name: 'the Howdah', id: `${carrier.id}#howdah`, d: howdah.d }, ...req.inWay].slice(0, 6);
      req.obstacles = req.inWay.length;
      const stray = plan.fight?.[0];
      if (stray) req.stray = { id: stray, name: state.models[stray].name, d: dOf(stray) };
      if (plan.rerolls) req.rerolls = true;
      // Ori's Deadeye with his sling.
      if (deadeye(catalog, shooter, req.shooter.weapon)) req.deadeye = true;
      // An Orc's arrows at an Ent are lit (Last March of the Ents).
      if (flamingArrows(state, shooter, target)) req.flaming = true;
      else delete req.flaming;
      // Thrown as it charges: the model first closes to 1" of its target (unless it set off that close).
      const before: Action[] = [];
      if (req.charge) {
        if (!(state.phase === 'move' && canActivate(state, seat))) return null;
        const at = throwingPoint(state, shooter, target);
        if (!at) return null;
        // Charging something terrifying takes a Courage test as the move begins, so before the throw: a model that
        // fails can't move this turn, and so can't throw as it charges either.
        const gap = Math.hypot(shooter.x - target.x, shooter.y - target.y) || 1;
        const reach = radius(shooter) + radius(target) + 0.01;
        const contact = { x: target.x + ((shooter.x - target.x) * reach) / gap, y: target.y + ((shooter.y - target.y) * reach) / gap };
        const dread = terrorAhead(state, shooter, contact, catalog);
        if (dread) {
          const test = terrorTest(shooter, dread, catalog, d6, uid, now, state);
          if (!test.pass) return { apply: test.actions };
          before.push(...test.actions);
        }
        if (at.x !== shooter.x || at.y !== shooter.y) before.push({ type: 'moveModels', moves: [{ id: shooter.id, x: at.x, y: at.y }] });
      }
      if (state.flow.shotPause) return null;
      const group = `s-${uid()}`;
      if (bolts) before.push({ type: 'rolled', roll: { id: `${group}-bolts`, by: seat, label: `${shooter.name} looses its bolts${bolts.dice.length > 1 ? ' (Swift Reload, best of two)' : ''}`, dice: bolts.dice, model: shooter.id, at: now, group, note: `${bolts.n} shot${bolts.n === 1 ? '' : 's'}.` } });
      return { apply: [...before, ...shotActions(state, req, shooter, d6, seat, group, now, [])] };
    }
    case 'banner': {
      // A banner nearby lets a side in a fight re-roll one of its duel dice.
      const r = state.log.find(x => x.id === String(action.roll));
      const k = Math.round(Number(action.die));
      const flag = r && bannerFor(state, catalog, r, seat);
      if (!r || !flag || !(k >= 0 && k < r.dice.length)) return null;
      return { apply: [{ type: 'bannerRolled', roll: r.id, die: k, value: d6(), by: flag.name }] };
    }
    case 'dismount': {
      // A rider gets down during its move and goes on on foot; a mount that fights takes a Courage test to stay.
      const m = state.models[String(action.id)];
      if (!m || m.owner !== seat || m.dead || !mounted(m) || !state.flow.started || state.phase !== 'move' || !mayActivate(state, m) || state.flow.stopped?.includes(m.id)) return null;
      const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: `${m.name} dismounts`.slice(0, 80), dice: [], model: m.id, at: now };
      const { actions, steed } = separatedMount(m, d6, uid, now, beside(state, m));
      return {
        apply: [
          { type: 'rolled', roll },
          { type: 'affect', id: m.id, patch: onFoot(catalog, m) },
          ...actions,
          // A mount that stays can't move any further this turn.
          ...(steed ? [{ type: 'addModels', models: [steed] } as Action, { type: 'crossed', id: steed.id, stop: true } as Action] : []),
        ],
      };
    }
    case 'trample': {
      const out = trample(state, catalog, seat, action, d6, uid, now);
      return out && { apply: out };
    }
    case 'shotOn': {
      // Carrying on with a shot that stopped for its hero to spend Might.
      const p = state.flow.shotPause;
      const shooter = p && state.models[p.shot.shooter.id];
      if (!p || !shooter || p.group !== String(action.group) || shooter.owner !== seat) return null;
      return { apply: [{ type: 'shotPaused', pause: null }, ...shotActions(state, p.shot, shooter, d6, seat, p.group, now, state.log.filter(r => r.group === p.group))] };
    }
    case 'detonate': {
      const out = resolveDetonate(state, catalog, seat, String(action.model), String(action.charge), d6, uid, now);
      return out && { apply: out };
    }
    case 'raiseLadder': {
      const out = resolveRaiseLadder(state, catalog, seat, String(action.model), String(action.ladder), d6, uid, now);
      return out && { apply: out };
    }
    case 'rideOut': {
      const m = state.models[String(action.model)];
      const out = m && mine(m.id) ? rideOut(state, catalog, m, uid, now) : null;
      return out && { apply: out };
    }
    case 'hurl': {
      if (action.how !== 'rocks' && action.how !== 'oil') return null;
      const out = resolveHurl(state, catalog, seat, action.how, String(action.model), String(action.item), String(action.target), d6, uid, now);
      return out && { apply: out };
    }
    case 'breach': {
      const how = action.how;
      if (how !== 'strike' && how !== 'ram' && how !== 'shoot' && how !== 'push') return null;
      const out = resolveBreach(state, catalog, seat, how, String(action.model), String(action.target), d6, uid, now);
      return out && { apply: out };
    }
    case 'cross': {
      const out = resolveCross(state, seat, String(action.id), d6, uid, now, catalog);
      return out && { apply: out };
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
      // Narya: Gandalf rolls a failed Fate roll again.
      const first = d6();
      const narya = first < 4 && hasRule(catalog, m, 'Narya');
      const roll = { id: `r-${uid()}`, by: seat, label: `Fate roll: ${m.name} (4+ saves a wound)${narya ? ', re-rolled (Narya)' : ''}`, dice: [narya ? d6() : first], target: 4, model: m.id, at: now, ...(narya ? { note: `Narya: the first roll was a ${first}.` } : {}) };
      return { apply: [{ type: 'fateRolled', id: m.id, roll }] };
    }
    case 'uncover': {
      // One Intelligence test per side per Artefact each turn, by an infantry model touching it.
      const m = state.models[String(action.model)];
      const t = state.terrain[String(action.marker)];
      if (!m || m.owner !== seat || m.dead || m.escaped || mounted(m)) return null;
      if (!t || t.object !== 'artefact' || !t.hidden || t.gone || t.tried?.[seat] === state.turn || !touching(m, t)) return null;
      // An enemy Fog of Disarray makes the test 1 harder.
      const sum = Math.max(2, Math.min(12, (Math.round(Number(action.intelligence)) || 7) + intelligenceWorse(state, m)));
      const roll = { id: `r-${uid()}`, by: seat, label: `Uncover the Artefact: ${m.name}`.slice(0, 80), dice: [d6(), d6()], sum, at: now };
      return { apply: [{ type: 'uncovered', model: m.id, marker: t.id, roll }] };
    }
    case 'swap': {
      // Kíli and Fíli swap places as a phase starts (Combat Synergy): not a move.
      const a = state.models[String(action.a)];
      const b = state.models[String(action.b)];
      if (!a || !b || a.owner !== seat || !maySwap(state, catalog, a, b)) return null;
      const roll: DiceRoll = { id: `r-${uid()}`, by: seat, label: `Combat Synergy: ${a.name} and ${b.name} swap places`.slice(0, 80), dice: [], at: now, note: 'They may each re-roll a die in their duels this turn.' };
      return { apply: [{ type: 'rolled', roll }, { type: 'backAway', moves: [{ id: a.id, x: b.x, y: b.y }, { id: b.id, x: a.x, y: a.y }] }, { type: 'usedTurn', key: `swap-${state.phase}`, model: seat }] };
    }
    case 'reroll': {
      // Combat Synergy, or Óin's Reading the Portents (a Will point), re-rolls a die of a duel roll.
      const r = state.log.find(x => x.id === String(action.roll));
      const k = Math.round(Number(action.die));
      const why = action.why === 'portents' ? 'portents' : 'synergy';
      const by = state.models[String(action.model)];
      if (!r || !by || by.owner !== seat || !(k >= 0 && k < r.dice.length)) return null;
      // (Kíli or Fíli re-roll their own dice; Óin a friend's.)
      if (why === 'synergy' ? r.model !== by.id : !r.model || state.models[r.model]?.owner !== seat) return null;
      const name = rerollFor(state, catalog, r, why, by);
      if (!name) return null;
      return { apply: [{ type: 'dieRerolled', roll: r.id, die: k, value: d6(), by: name, why }, ...(why === 'portents' ? [{ type: 'affect', id: by.id, patch: { will: by.will - 1 } } as Action] : [])] };
    }
    case 'tend': {
      const m = state.models[String(action.model)];
      const t = state.models[String(action.target)];
      const how = action.how === 'spirits' ? 'spirits' : 'herbs';
      if (!m || m.owner !== seat || !canActivate(state, seat) || !mayActivate(state, m) || mayTend(state, catalog, how, m, t)) return null;
      return { apply: tend(how, m, t!, d6, uid, now) };
    }
    case 'longbeard': {
      const m = state.models[String(action.model)];
      if (!m || m.owner !== seat || !mayLongbeard(state, catalog, m)) return null;
      if (action.skip === true) return { apply: [{ type: 'usedTurn', key: 'longbeard', model: m.id }] };
      return { apply: longbeard(state, m, d6, uid, now) };
    }
    case 'trumpet': {
      const due = trumpetDue(state, catalog);
      if (!due || due.oin.owner !== seat) return null;
      const tierOk = (o: Model, t: Model) => tierOf(o.profileId ? catalog?.units[o.profileId] : undefined) <= tierOf(t.profileId ? catalog?.units[t.profileId] : undefined) && t.hero;
      const out = trumpet(state, catalog, action.listen === true, d6, uid, now, tierOk);
      return out && { apply: out };
    }
    case 'chronicled': {
      // Ori's Chronicler: the friend the player picks takes back a point it has spent (or the player lets it go).
      const due = state.flow.chronicles?.[0];
      if (!due || due.seat !== seat) return null;
      if (!action.point) return { apply: [{ type: 'chronicle', done: true }] };
      const m = state.models[String(action.model)];
      const point = action.point === 'will' ? 'will' : action.point === 'fate' ? 'fate' : 'might';
      if (!m || !due.ids.includes(m.id) || !spentPoints(catalog, m).includes(point)) return null;
      const name = point === 'might' ? 'Might' : point === 'will' ? 'Will' : 'Fate';
      return {
        apply: [
          { type: 'rolled', roll: { id: `r-${uid()}`, by: seat, label: `Chronicler: Ori records the deed, and ${m.name} gets back a ${name} point`.slice(0, 80), dice: [], model: m.id, at: now } },
          { type: 'affect', id: m.id, patch: { [point]: m[point] + 1 } },
          { type: 'chronicle', done: true },
        ],
      };
    }
    case 'axeTest': {
      const m = state.models[String(action.model)];
      if (!m || m.owner !== seat || !mayAxeTest(state, catalog, m)) return null;
      return { apply: axeTest(catalog, m, d6, uid, now) };
    }
    case 'rollDeploy': {
      // Whoever asks first rolls for both players: for the objective markers, or for deployment. A tie is rolled again.
      const due = rollDue(state);
      if (!due) return null;
      const apply: Action[] = [];
      let roll: [number, number];
      do {
        roll = [d6(), d6()];
        apply.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: seat, label: due === 'markers' ? 'Roll-off to place the objectives' : 'Roll-off for deployment', dice: roll, at: now } });
      } while (roll[0] === roll[1]);
      apply.push({ type: 'deployRolled', step: due, winner: roll[0] > roll[1] ? 'p1' : 'p2' });
      return { apply };
    }
    case 'deployWarband': {
      // A player puts their next warband down; where the scenario says, a D6 first decides how far forward it may go.
      const warband = typeof action.warband === 'string' ? action.warband.slice(0, 80) : '';
      if (action.seat !== seat || !mayPutDown(state, seat, warband)) return null;
      const p = procedureOf(state)!;
      const firstChampion = p.champion && !state.flow.deploy!.placed.some(k => k.startsWith(`${seat}:`));
      if (!p.d6 || firstChampion || warband === '*') return { apply: [{ type: 'warbandDown', seat, warband }] };
      const band = bandsOf(state, seat, true).find(b => (b[0].warband ?? '') === warband)!;
      const roll = d6();
      const label = `Deployment: ${bandName(state, band)}`.slice(0, 80);
      return { apply: [{ type: 'rolled', roll: { id: `r-${uid()}`, by: seat, label, dice: [roll], at: now, note: `${roll}: ${rollMeans(state, roll)}.` } }, { type: 'warbandDown', seat, warband, roll }] };
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
/**
 * Rolls a shot (or the rest of one, after `logged`) and the wounds it causes. A hero's shot stops after a roll it
 * could still save with Might, for its player to decide.
 */
function shotActions(state: GameState, req: ShotRequest, shooter: Model, d6: () => number, seat: Seat, group: string, now: number, logged: DiceRoll[]): Action[] {
  const pause = (r: DiceRoll) => shooter.hero && mightCouldHelp(r, shooter.might);
  const shot = resolveShot(req, d6, seat, group, now, logged, pause);
  const rolled = shot.rolls.map((roll): Action => ({ type: 'rolled', roll }));
  if (shot.paused) {
    const last = shot.rolls[shot.rolls.length - 1];
    last.note = `${shooter.name} can spend Might to raise a die before the shot goes on.`;
    return [...rolled, { type: 'shotPaused', pause: { group, shot: req } }];
  }
  const all = [...logged, ...shot.rolls];
  // A thrown brand Sets Ablaze whatever it hit, and is gone from the thrower's wargear, hit or miss.
  if (req.brand) return [...rolled, { type: 'affect', id: shooter.id, patch: { brand: false } }, ...(shot.ablaze ?? []).map((id): Action => ({ type: 'affect', id: id.replace(/#(mount|howdah)$/, ''), patch: { ablaze: true } }))];
  // A Spider's webs Paralyse whoever they catch, as the power does, and for as long: a hero may spend a Fate point to
  // shrug them off (the game spends it for him).
  if (req.webs) {
    const caught = [...new Set((shot.webbed ?? []).map(id => id.replace(/#(mount|howdah)$/, '')))].map(id => state.models[id]).filter(m => m && !m.dead);
    return [
      ...rolled,
      ...caught.flatMap((m): Action[] => {
        if (m.hero && m.fate > 0) return [{ type: 'rolled', roll: { id: `${group}-fate-${m.id}`.slice(0, 80), by: m.owner, label: `${m.name} spends a Fate point to shake off the webs`.slice(0, 80), dice: [], model: m.id, at: now } }, { type: 'affect', id: m.id, patch: { fate: m.fate - 1 } }];
        const web = { power: 'Paralyse', by: shooter.id, turn: state.turn, duration: 'Exhaustion' as const, web: true };
        return [{ type: 'affect', id: m.id, patch: { prone: true, effects: [...(m.effects ?? []).filter(e => !(e.web && e.power === 'Paralyse')), web] } }];
      }),
    ];
  }
  // A flaming arrow that wounds an Ent Sets it Ablaze.
  const lit = (shot.ablaze ?? []).filter(id => state.models[id] && !state.models[id].ablaze).map((id): Action => ({ type: 'affect', id, patch: { ablaze: true } }));
  return [
    ...rolled,
    ...lit,
    ...shot.hits.flatMap(h =>
      // A shot that hit a rider's mount wounds the mount.
      h.id.endsWith('#mount') ? woundAction(state, all.filter(r => r.against === h.id), h.id.slice(0, -6), h.wounds, [shooter.id], 'shoot', group).map(a => ({ ...a, mount: true }) as Action)
      : h.id.endsWith('#howdah') ? woundAction(state, all.filter(r => r.against === h.id), h.id.slice(0, -7), h.wounds, [shooter.id], 'shoot', group).map(a => ({ ...a, howdah: true }) as Action)
      : woundAction(state, all.filter(r => r.against === h.id), h.id, h.wounds, [shooter.id], 'shoot', group),
    ),
  ];
}

function woundAction(state: GameState, rolls: DiceRoll[], victim: string | undefined, count: number, by: string[], how: 'fight' | 'shoot', group: string): Action[] {
  if (!victim || count < 1 || !state.models[victim] || !autoWound(state, rolls)) return [];
  return [{ type: 'wound', id: victim, count, by, how, group }];
}
