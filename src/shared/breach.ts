import { modelStats, type Catalog } from './catalog.ts';
import { mounted } from './cavalry.ts';
import { breakable, enemyOf, gateStanding, isGate, ramCrew, ramGate } from './fortress.ts';
import { distanceToTerrain, heightOf } from './sight.ts';
import { canActivate, heroicsSettled } from './heroics.ts';
import { isMonster } from './monsters.ts';
import { engaged, foughtThisTurn } from './movement.ts';
import { touching as touchingMarker } from './objects.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { shooterBlocked, weaponFor } from './shooting.ts';
import { engineFor, firingCrew, inArc } from './siege.ts';
import { canSupport } from './support.ts';
import { fallDamage } from './terrainTests.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// Breaking into a fortress, rolled by the server: striking at a gate, swinging a ram at it, shooting it, and pushing
// a Siege Ladder off the walls.

type D6 = () => number;
export type BreachHow = 'strike' | 'ram' | 'shoot' | 'push';

const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const active = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped && !m.aboard;
/** In a fight this turn: in base contact with an enemy, or already fought. */
const busy = (state: GameState, m: Model) => engaged(state, m) || foughtThisTurn(state).has(m.id);

/** Friends with a spear or pike touching a model striking at a gate, who may lend it a strike each. */
export function gateSupport(state: GameState, catalog: Catalog | null, m: Model): Model[] {
  return Object.values(state.models).filter(f => f.owner === m.owner && f.id !== m.id && Math.abs(f.x - m.x) < 4 && Math.abs(f.y - m.y) < 4 && !state.flow.breached?.includes(f.id) && !foughtThisTurn(state).has(f.id) && canSupport(state, catalog, f) && Math.hypot(f.x - m.x, f.y - m.y) > 0 && touchingModel(f, m));
}
const touchingModel = (a: Model, b: Model) => Math.hypot(a.x - b.x, a.y - b.y) <= (Math.max(a.base.w, a.base.h) + Math.max(b.base.w, b.base.h)) / 50.8 + 0.1;

/** Why a model can't do this to that gate, ladder or ram right now; unset if it can. */
export function breachBlocked(state: GameState, catalog: Catalog | null, how: BreachHow, m: Model | undefined, t: Terrain | undefined): string | undefined {
  if (!active(m) || !t) return 'Nothing to do';
  if (!state.flow.started) return 'The battle hasn’t started';
  if (state.flow.breached?.includes(how === 'ram' ? t.id : m.id)) return how === 'ram' ? 'The ram has swung this turn' : 'Already done this turn';
  if (how === 'push') {
    if (state.phase !== 'move' || !canActivate(state, m.owner)) return 'Only in your Move phase';
    if (t.object !== 'ladder' || !t.raised || t.gone || t.side === m.owner) return 'Not an enemy ladder against the walls';
    if (!touchingMarker(m, t)) return 'Must be touching the ladder';
    if (m.prone || engaged(state, m) || state.flow.stopped?.includes(m.id) || m.siege) return 'Not free to act';
    return undefined;
  }
  if (how === 'ram') {
    if (state.phase !== 'fight' || !heroicsSettled(state)) return 'Only in the Fight phase';
    if (t.object !== 'ram' || t.gone) return 'Not a battering ram';
    const crew = ramCrew(state, t, m.owner, f => busy(state, f));
    if (crew.length < 2 || !crew.some(f => f.id === m.id)) return 'Needs two or more models on foot touching it, out of any fight';
    if (!ramGate(state, t, m.owner)) return 'Must be up against an enemy gate or door';
    return undefined;
  }
  const b = breakable(t);
  if (!b || !enemyOf(t, m.owner)) return 'Not something of the enemy’s to break';
  if (how === 'strike') {
    if (state.phase !== 'fight' || !heroicsSettled(state)) return 'Only in the Fight phase';
    if (m.siege || m.prone) return 'Can’t fight';
    if (busy(state, m)) return 'Has been in a fight this turn';
    const near = isGate(t) ? distanceToTerrain(m, t) <= 0.25 : touchingMarker(m, t);
    if (!near) return 'Must be touching it';
    return undefined;
  }
  // Shooting.
  if (state.phase !== 'shoot' || !canActivate(state, m.owner)) return 'Only in your Shoot phase';
  const w = weaponFor(catalog, m);
  if (!w) return 'Has nothing to shoot';
  const why = shooterBlocked(state, m, w);
  if (why) return `It ${why}`;
  if (isGate(t) && w.s < 5) return 'Only Strength 5 or more can hurt a gate';
  const d = m.siege ? Math.hypot(t.x - m.x, t.y - m.y) : distanceToTerrain(m, t);
  if (d > w.range) return `Out of range (${w.range}")`;
  if (m.siege) {
    const e = engineFor(unitOf(catalog, m)?.name ?? m.name);
    if (e && d < e.min) return `Too close (at least ${e.min}")`;
    if (!inArc(m, t)) return 'Not in its arc: turn it first';
  }
  return undefined;
}

/** What a model can do to the gates, ladders and rams around it, for its card. */
export function breachOptions(state: GameState, catalog: Catalog | null, m: Model): { how: BreachHow; target: string; label: string }[] {
  if (!active(m) || !state.flow.started) return [];
  const out: { how: BreachHow; target: string; label: string }[] = [];
  const near = Object.values(state.terrain).filter(t => !t.gone && Math.abs(t.x - m.x) < 100 && (isGate(t) || t.object === 'ladder' || t.object === 'ram'));
  for (const t of near) {
    const b = breakable(t);
    const name = b?.name ?? (t.object === 'ram' ? 'Battering ram' : 'Siege Ladder');
    const hows: BreachHow[] = state.phase === 'fight' ? ['strike', 'ram'] : state.phase === 'shoot' ? ['shoot'] : state.phase === 'move' ? ['push'] : [];
    for (const how of hows) {
      if (how === 'ram' && t.object !== 'ram') continue;
      if (how === 'push' && t.object !== 'ladder') continue;
      if (breachBlocked(state, catalog, how, m, t)) continue;
      const label = how === 'strike' ? `Strike at the ${name.toLowerCase()}` : how === 'ram' ? 'Swing the ram at the gate' : how === 'shoot' ? `Shoot at the ${name.toLowerCase()}` : 'Push the ladder down';
      out.push({ how, target: t.id, label });
    }
  }
  return out;
}

/** Whether anyone could still strike at a gate or swing a ram this Fight phase, so it shouldn't end by itself. */
export function breachesLeft(state: GameState): boolean {
  if (state.phase !== 'fight' || !Object.values(state.terrain).some(t => gateStanding(t))) return false;
  return Object.values(state.models).some(m => breachOptions(state, null, m).length > 0);
}

/**
 * Rolls a model's go at a gate, ladder or ram. Striking needs no Duel roll: each Attack is a strike, and a gate counts
 * as Trapped, so each strike rolls To Wound twice. A ram strikes once (twice To Wound) with the Strength of its strongest
 * carrier +1 for each other one. A shot hits on the shooter's Shoot value. Pushing a ladder needs a 4+.
 */
export function resolveBreach(state: GameState, catalog: Catalog | null, seat: Seat, how: BreachHow, modelId: string, targetId: string, d6: D6, uid: () => string, now: number): Action[] | null {
  const m = state.models[modelId];
  const t = state.terrain[targetId];
  if (!m || m.owner !== seat || breachBlocked(state, catalog, how, m, t)) return null;
  // (A shot's group starts 's-' and its first roll names the shooter, which marks it as having shot this turn.)
  const group = `${how === 'shoot' ? 's' : 'g'}-${uid()}`;
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) => {
    const r: DiceRoll = { id: `${group}-${rolls.length}`, by: seat, label: label.slice(0, 80), dice, at: now, group, ...extra };
    rolls.push(r);
    return r;
  };
  const out: Action[] = [];
  const done = () => [...rolls.map((r): Action => ({ type: 'rolled', roll: r })), ...out];

  if (how === 'push') return pushLadder(state, catalog, m, t!, d6, push, out, group, done);

  const gate = how === 'ram' ? ramGate(state, t!, seat)! : t!;
  const b = breakable(gate)!;
  let left = b.left;
  /** Rolls To Wound against it, `n` dice at Strength `s`; a failed roll is re-rolled when `again`. */
  const wound = (label: string, s: number, n: number, who: Model, again = false, extra: Partial<DiceRoll> = {}) => {
    const need = woundNeed(s, b.d);
    if (!need) {
      push(`${label}: S${s} vs D${b.d} (can’t wound)`, [], { model: who.id, ...extra });
      return;
    }
    let dice = Array.from({ length: n }, d6);
    if (again) dice = dice.map(x => (x >= need.target ? x : d6()));
    const follow = need.then ? dice.filter(x => x >= need.target).map(d6) : undefined;
    const wounds = (need.then && follow ? follow.filter(x => x >= need.then!) : dice.filter(x => x >= need.target)).length;
    const hurt = Math.min(left, wounds);
    left -= hurt;
    push(`${label}: S${s} vs D${b.d} (${formatNeed(need)})`, dice, { target: need.target, model: who.id, ...(need.then ? { then: need.then, follow } : {}), ...extra, note: hurt ? (left ? `${hurt} Wound${hurt === 1 ? '' : 's'}: ${left} left.` : `The ${b.name.toLowerCase()} is broken down!`) : 'It holds.' });
  };

  if (how === 'strike') {
    const st = modelStats(catalog, m);
    const a = st?.A ?? 1;
    const times = b.trapped ? 2 : 1;
    wound(`${m.name}: ${a} strike${a === 1 ? '' : 's'}${b.trapped ? ', twice To Wound' : ''}`, st?.S ?? 3, a * times, m);
    out.push({ type: 'breached', id: m.id });
    for (const f of gateSupport(state, catalog, m)) {
      if (!left) break;
      wound(`${f.name} supports with its spear`, modelStats(catalog, f)?.S ?? 3, times, f, false, { support: true });
      out.push({ type: 'breached', id: f.id });
    }
  } else if (how === 'ram') {
    const crew = ramCrew(state, t!, seat, f => busy(state, f));
    const strongest = Math.max(...crew.map(f => modelStats(catalog, f)?.S ?? 3));
    const raw = strongest + crew.length - 1;
    const s = Math.min(10, raw);
    wound(`Ram (${crew.length} carrying), twice To Wound${raw > 10 ? ', misses re-rolled' : ''}`, s, 2, m, raw > 10);
    out.push({ type: 'breached', id: t!.id }, ...crew.map((f): Action => ({ type: 'breached', id: f.id })));
  } else {
    const w = weaponFor(catalog, m)!;
    if (m.siege) {
      // An engine's crew aim it: a fortress gate is a Siege Target and is simply hit; a door may be missed.
      const crew = firingCrew(state, catalog, m)!;
      const need = Math.min(6, crew.sv + (state.flow.turned?.includes(m.id) ? 1 : 0));
      const hit = d6();
      const big = gate.door === 'castle' || gate.door === undefined;
      push(`${m.name} shoots at the ${b.name.toLowerCase()} (${need}+)`, [hit], { target: need, model: m.id, note: hit >= need ? 'A hit.' : 'The shot misses.' });
      if (hit >= need) {
        const rules = unitOf(catalog, m)?.rules ?? [];
        let on = true;
        if (!big) {
          const sc = d6();
          on = sc === 6;
          push(`Scatter: only a 6 lands on a door`, [sc], { model: m.id, note: on ? 'Dead on.' : 'It sails past.' });
        }
        // A Wall-breaker takes D3 Wounds off a Siege Target with each hit (and rolls twice To Wound, keeping the better).
        if (on) {
          const n = big && rules.includes('Wall-breaker') ? Math.ceil(d6() / 2) : 1;
          const before = left;
          wound(`To wound the ${b.name.toLowerCase()}`, w.s, 1, m, big && (!!m.options?.includes('Flaming Ammunition') || rules.includes('Wall-breaker')));
          // Wounded at all, a Wall-breaker's hit takes its D3, and a door hit by an engine is smashed.
          if (left < before) left = Math.max(0, before - (big ? n : b.w));
        }
      }
    } else {
      const sv = modelStats(catalog, m)?.Sv ?? 4;
      const need = Math.min(6, sv + (state.flow.moved?.includes(m.id) ? 1 : 0));
      const hit = d6();
      push(`${m.name} shoots at the ${b.name.toLowerCase()} (${need}+)`, [hit], { target: need, model: m.id, note: hit >= need ? 'A hit.' : 'A miss.' });
      if (hit >= need) wound(`To wound the ${b.name.toLowerCase()}`, w.s, 1, m);
    }
  }
  if (left !== b.left) out.push({ type: 'updateTerrain', id: gate.id, patch: left > 0 ? { wounds: left } : { wounds: 0, gone: 'destroyed', by: seat } });
  return done();
}

function pushLadder(state: GameState, catalog: Catalog | null, m: Model, ladder: Terrain, d6: D6, push: (label: string, dice: number[], extra?: Partial<DiceRoll>) => DiceRoll, out: Action[], group: string, done: () => Action[]): Action[] {
  // +1 for each friend touching the pusher out of a fight, -1 for each enemy on the ladder; a monster counts 3.
  const weight = (x: Model) => (isMonster(catalog, x) ? 3 : 1);
  const friends = Object.values(state.models).filter(f => f.owner === m.owner && f.id !== m.id && active(f) && !f.siege && touchingModel(f, m) && !engaged(state, f));
  const climbers = Object.values(state.models).filter(e => e.owner !== m.owner && active(e) && !e.siege && !mounted(e) && touchingMarker(e, ladder));
  const mod = (isMonster(catalog, m) ? 3 : 0) + friends.reduce((n, f) => n + weight(f), 0) - climbers.reduce((n, e) => n + weight(e), 0);
  const die = d6();
  const pushed = die + mod >= 4;
  push(`${m.name} pushes at the Siege Ladder (4+${mod ? `, ${mod > 0 ? '+' : ''}${mod}` : ''})`, [die], { target: 4, model: m.id, note: pushed ? `Down it goes${climbers.length ? ', and everyone on it falls' : ''}!` : 'It won’t budge.' });
  out.push({ type: 'breached', id: m.id }, { type: 'crossed', id: m.id, stop: true });
  if (!pushed) return done();
  const wall = ladder.raised ? state.terrain[ladder.raised] : undefined;
  const fall = wall ? heightOf(wall) : 2;
  // The ladder topples away from the wall, and those climbing it fall.
  out.push({ type: 'updateTerrain', id: ladder.id, patch: { raised: undefined } });
  for (const e of climbers) out.push(...fallDamage(catalog, e, fall, d6, push, group));
  return done();
}
