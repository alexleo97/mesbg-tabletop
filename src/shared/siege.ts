// Siege engines: catapults, trebuchets, ballistas and bolt throwers. An engine doesn't move or act by itself: friends
// beside it push it about, and its crew shoot it. A shot at a big target (a war beast, a large engine) simply hits; at
// anything else it may scatter onto another model nearby, and a model it hits and wounds is slain outright.
import { modelStats, type Catalog, type StatName } from './catalog.ts';
import { hitModel, mounted, mountOf } from './cavalry.ts';
import { CONTACT_SLACK } from './flow.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { sideOf } from './gear.ts';
import { foughtThisTurn } from './movement.ts';
import { woundNeed } from './rules.ts';
import { heightOf, insidePolygon, obstructions, outline, sightTo } from './sight.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

type D6 = () => number;
type Stats = Partial<Record<StatName, number>>;
const S = (Mv: number, Fv: number, Sv: number, St: number, D: number, A: number, W: number, C: number, I: number): Stats => ({ Mv, Fv, Sv, S: St, D, A, W, C, I });
const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const rulesOf = (catalog: Catalog | null | undefined, m: Model) => unitOf(catalog, m)?.rules ?? [];

/** An engine's size, range and crew. Our data has the engine's own profile but not these, so they're kept here. */
export interface Engine {
  size: 'large' | 'small';
  min: number;
  max: number;
  /** How many crew it comes with (one of them its Siege Veteran), their name and profile. */
  crew: number;
  crewName: string;
  crewStats: Stats;
  /** The Mordor War Catapult's Siege Troll, which loads it. */
  troll?: Stats;
  /** Piercing Shot: how far (D3 or D6") a model it hits is flung back. */
  fling?: 3 | 6;
  /** The Avenger Bolt Thrower shoots a D6 bolts like a bow, never scattering and never slaying outright. */
  rapid?: boolean;
  /** Static: it can never be moved or turned. */
  fixed?: boolean;
}

const MINAS_TIRITH = S(6, 3, 4, 3, 5, 1, 1, 7, 7);
const MORDOR_ORC = S(6, 3, 4, 3, 4, 1, 1, 8, 8);
const ENGINES: [RegExp, Engine][] = [
  [/battlecry trebuchet/i, { size: 'large', min: 12, max: 96, crew: 3, crewName: 'Minas Tirith Siege Crew', crewStats: MINAS_TIRITH, fixed: true }],
  [/avenger bolt thrower/i, { size: 'small', min: 0, max: 36, crew: 3, crewName: 'Minas Tirith Siege Crew', crewStats: MINAS_TIRITH, rapid: true }],
  [/war catapult/i, { size: 'large', min: 12, max: 96, crew: 3, crewName: 'Mordor Orc Siege Crew', crewStats: MORDOR_ORC, troll: S(6, 7, 4, 7, 6, 3, 4, 6, 7) }],
  [/siege bow/i, { size: 'small', min: 0, max: 48, crew: 3, crewName: 'Mordor Orc Siege Crew', crewStats: MORDOR_ORC, fling: 6 }],
  [/corsair ballista/i, { size: 'small', min: 0, max: 48, crew: 3, crewName: 'Corsair Siege Crew', crewStats: S(6, 4, 4, 3, 3, 1, 1, 7, 7), fling: 6 }],
  [/iron hills ballista/i, { size: 'large', min: 12, max: 60, crew: 4, crewName: 'Iron Hills Siege Crew', crewStats: S(5, 4, 4, 4, 6, 1, 1, 6, 6) }],
  [/windlance/i, { size: 'small', min: 6, max: 60, crew: 2, crewName: 'Dale Siege Crew', crewStats: S(6, 4, 4, 3, 4, 1, 1, 7, 7), fling: 3 }],
  [/assault ballista/i, { size: 'large', min: 12, max: 60, crew: 3, crewName: 'Uruk-hai Siege Crew', crewStats: S(6, 4, 4, 4, 5, 1, 1, 7, 7), fling: 6 }],
  [/dwarven ballista/i, { size: 'small', min: 0, max: 48, crew: 2, crewName: 'Dwarf Siege Crew', crewStats: S(5, 4, 4, 3, 6, 1, 1, 6, 6), fling: 6 }],
];

export const engineFor = (unitName: string | undefined): Engine | undefined => (unitName ? ENGINES.find(([re]) => re.test(unitName))?.[1] : undefined);
export const isEngine = (m: Model | undefined) => !!m?.siege;
/** The engine a model belongs to, while it stands. */
export const engineOf = (state: GameState, m: Model) => (m.crewOf && state.models[m.crewOf] && !state.models[m.crewOf].dead ? state.models[m.crewOf] : undefined);

/** A siege crew's (or the Siege Troll's) own profile, for a model deployed with an engine; undefined for anyone else. */
export function crewStats(unitName: string, modelName: string | undefined): Stats | undefined {
  const e = engineFor(unitName);
  if (!e || !modelName) return undefined;
  if (/siege troll/i.test(modelName)) return e.troll;
  return /crew|veteran/i.test(modelName) ? e.crewStats : undefined;
}

/** The models one engine of this unit comes with: its Siege Veteran, its other crew, and the Catapult's troll. */
export function crewList(unitName: string): { name: string; hero: boolean; stats: Stats; base: number }[] {
  const e = engineFor(unitName);
  if (!e) return [];
  return [
    { name: `${e.crewName} (Siege Veteran)`, hero: true, stats: e.crewStats, base: 25 },
    ...Array.from({ length: e.crew - 1 }, () => ({ name: e.crewName, hero: false, stats: e.crewStats, base: 25 })),
    ...(e.troll ? [{ name: 'Mordor Siege Troll', hero: false, stats: e.troll, base: 60 }] : []),
  ];
}

/**
 * Hands each crew member deployed with an engine to the nearest engine of the same profile still short of crew, so
 * the game knows whose crew they are.
 */
export function assignCrew(models: Record<string, Model>, added: string[]): Record<string, Model> {
  const out = { ...models };
  const engines = added.map(id => out[id]).filter(m => m?.siege);
  const taken = new Map<string, number>();
  for (const id of added) {
    const m = out[id];
    if (!m || m.siege || m.crewOf || !/siege (crew|troll)|veteran/i.test(m.name)) continue;
    const home = engines
      .filter(e => e.profileId === m.profileId && e.owner === m.owner && (taken.get(e.id) ?? 0) < (engineFor(m.name)?.crew ?? 9) + 1)
      .sort((a, b) => distanceBetween(a, m) - distanceBetween(b, m))[0];
    if (!home) continue;
    taken.set(home.id, (taken.get(home.id) ?? 0) + 1);
    out[id] = { ...m, crewOf: home.id };
  }
  return out;
}

/** A Siege Target (a war beast, a large engine, and the like): easy for trained crew to hit, so the shot never scatters. */
export const siegeTarget = (m: Model) => m.beast === 'war' || m.siege === 'large';

const touches = (_state: GameState, a: Model, b: Model) => distanceBetween(a, b) <= CONTACT_SLACK;
const busy = (state: GameState, m: Model) =>
  Object.values(state.models).some(e => e.owner !== m.owner && !e.dead && !e.siege && !e.aboard && Math.abs(e.x - m.x) < 5 && Math.abs(e.y - m.y) < 5 && touches(state, m, e));
/** Enemies in base contact with an engine: while there are any it can't shoot or be moved. */
export const enemiesAt = (state: GameState, engine: Model) => Object.values(state.models).filter(e => e.owner !== engine.owner && !e.dead && !e.waiting && !e.escaped && !e.aboard && !e.siege && touches(state, engine, e));

/**
 * The friends beside an engine who could work it, best first: its own crew (by their Shoot value), then anyone else,
 * who works it as untrained crew and always needs a 6 to hit.
 */
export function crewAt(state: GameState, catalog: Catalog | null | undefined, engine: Model): { m: Model; sv: number; trained: boolean }[] {
  return Object.values(state.models)
    .filter(m => m.owner === engine.owner && m.id !== engine.id && !m.dead && !m.waiting && !m.escaped && !m.aboard && !m.siege && !m.prone && touches(state, engine, m) && !busy(state, m))
    .map(m => {
      const trained = m.crewOf === engine.id || (!!m.crewOf === false && !!crewStats(unitOf(catalog, engine)?.name ?? engine.name, m.name) && m.profileId === engine.profileId);
      return { m, sv: trained ? (modelStats(catalog, m)?.Sv ?? 4) : 6, trained };
    })
    .sort((a, b) => a.sv - b.sv);
}

/** Who fires the engine this turn: as many as its size needs (two for a large one, one for a small), and the Shoot value they hit on. */
export function firingCrew(state: GameState, catalog: Catalog | null | undefined, engine: Model): { crew: Model[]; sv: number; troll: boolean } | undefined {
  const need = engine.siege === 'large' ? 2 : 1;
  const at = crewAt(state, catalog, engine).slice(0, need);
  if (at.length < need) return undefined;
  return { crew: at.map(c => c.m), sv: Math.max(...at.map(c => c.sv)), troll: at.some(c => /siege troll/i.test(c.m.name)) };
}

/** Whether a target lies within an engine's 45° Arc of Sight. */
export function inArc(engine: Model, p: Point): boolean {
  const heading = (Math.atan2(p.x - engine.x, -(p.y - engine.y)) * 180) / Math.PI;
  const turn = ((((heading - engine.rot) % 360) + 540) % 360) - 180;
  return Math.abs(turn) <= 22.5 + 1e-6;
}

/** The models that may push an engine this turn (three for a large one, two for a small; a monster counts as three), and how far: the Move of the slowest. */
export function pushers(state: GameState, engine: Model): { by: Model[]; move: number } | undefined {
  if (engineFor(engine.name)?.fixed || enemiesAt(state, engine).length) return undefined;
  const need = engine.siege === 'large' ? 3 : 2;
  const free = Object.values(state.models)
    .filter(m => m.owner === engine.owner && m.id !== engine.id && !m.dead && !m.aboard && !m.siege && !m.prone && touches(state, engine, m) && !busy(state, m))
    .filter(m => !state.flow.started || (!state.flow.stopped?.includes(m.id) && (!state.flow.starts?.[m.id] || pushedWith(state, engine, m))))
    .sort((a, b) => b.move - a.move);
  // (The same ones go on pushing it once it has set off.)
  const by: Model[] = [];
  let count = 0;
  for (const m of free) {
    if (count >= need) break;
    by.push(m);
    count += isBig(m) ? 3 : 1;
  }
  if (count < need) return undefined;
  return { by, move: Math.min(...by.map(m => m.move)) };
}
/** A model that has only moved this phase by pushing the engine, so may go on pushing it. */
const pushedWith = (state: GameState, engine: Model, m: Model) => {
  const a = state.flow.starts?.[engine.id];
  const b = state.flow.starts?.[m.id];
  return !!a && !!b && Math.abs(engine.x - a[0] - (m.x - b[0])) < 1e-3 && Math.abs(engine.y - a[1] - (m.y - b[1])) < 1e-3;
};
const isBig = (m: Model) => m.base.w >= 50 || /troll|\bent\b|eagle|drake|beast/i.test(m.name);

/** The engine's weapon: its name, longest range and Strength. */
export function siegeWeapon(catalog: Catalog | null | undefined, engine: Model): { name: string; range: number; s: number; min: number } | undefined {
  const e = engineFor(unitOf(catalog, engine)?.name ?? engine.name);
  if (!e) return undefined;
  return { name: unitOf(catalog, engine)?.name ?? engine.name, range: e.max, s: modelStats(catalog, engine)?.S ?? 8, min: e.min };
}

/** Why an engine can't shoot this turn at all; unset if it can. */
export function engineBlocked(state: GameState, catalog: Catalog | null | undefined, engine: Model): string | undefined {
  if (state.flow.started && state.flow.moved?.includes(engine.id)) return 'was moved this turn';
  if (enemiesAt(state, engine).length) return 'has an enemy beside it';
  if (!firingCrew(state, catalog, engine)) return `needs ${engine.siege === 'large' ? 'two' : 'one'} crew beside it, out of any fight, to shoot`;
  return undefined;
}

/** Why an engine can't shoot at this target; unset if it can. Arcing shots only need a friend to see the target. */
export function engineCantHit(state: GameState, catalog: Catalog | null | undefined, engine: Model, target: Model): string | undefined {
  const w = siegeWeapon(catalog, engine);
  if (!w) return 'has no profile';
  const d = distanceBetween(engine, target);
  if (d < w.min - 0.01) return `is too close (it can't shoot within ${w.min}")`;
  if (!inArc(engine, target)) return 'isn’t facing the target (it shoots within 45° of straight ahead)';
  const arcing = rulesOf(catalog, engine).includes('Arcing Shot');
  if (arcing ? !Object.values(state.models).some(f => f.owner === engine.owner && !f.dead && !f.waiting && sightTo(state, f, target) !== 'hidden') : sightTo(state, engine, target) === 'hidden') return arcing ? 'has no friend who can see the target' : 'can’t see the target';
  // A Good engine never shoots where its blast would catch friends.
  if (sideOf(catalog, engine) === 'Good' && rulesOf(catalog, engine).includes('Area Effect') && Object.values(state.models).some(f => f.owner === engine.owner && !f.dead && f.id !== target.id && !f.siege && distanceBetween(f, target) <= 2)) return 'is Good, and won’t shoot where the blast would catch friends';
  return undefined;
}

/** Scatter: how far off a shot can land (3" for an Accurate engine). */
const scatterRange = (catalog: Catalog | null | undefined, engine: Model) => (rulesOf(catalog, engine).some(r => /^Acc?urate$/.test(r)) ? 3 : 6);

/**
 * Where a hit on a Battlefield Target really lands. On a 6 it's dead on; on 2-5 the target's player moves it onto one
 * of their own models nearby (we pick the one they'd most like to lose); on a 1 they may put it on any model nearby,
 * so it lands on one of the shooter's own if there's one, and otherwise misses.
 */
export function scatter(state: GameState, catalog: Catalog | null | undefined, engine: Model, target: Model, roll: number): Model | undefined {
  if (roll === 6) return target;
  const r = scatterRange(catalog, engine);
  const direct = !rulesOf(catalog, engine).includes('Arcing Shot');
  const near = Object.values(state.models).filter(m => m.id !== target.id && !m.dead && !m.waiting && !m.escaped && !m.aboard && !siegeTarget(m) && distanceBetween(m, target) <= r && (!direct || sightTo(state, engine, m) !== 'hidden'));
  const cheapest = (ms: Model[]) => [...ms].sort((a, b) => Number(a.hero) - Number(b.hero) || a.wounds - b.wounds || distanceBetween(a, target) - distanceBetween(b, target))[0];
  if (roll === 1) return cheapest(near.filter(m => m.owner === engine.owner));
  return cheapest(near.filter(m => m.owner === target.owner)) ?? target;
}

/** Where a model thrown back by a Piercing Shot lands, who it passes over, and what stops it. */
function fling(state: GameState, catalog: Catalog | null | undefined, engine: Model, m: Model, inches: number): { at: Point; over: Model[]; stoppedBy?: Model; wall?: boolean } {
  const dx = m.x - engine.x;
  const dy = m.y - engine.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  const others = Object.values(state.models).filter(o => o.id !== m.id && !o.dead && !o.waiting && !o.escaped && !o.aboard);
  const walls = Object.values(state.terrain).filter(t => !t.gone && (t.kind === 'building' || t.kind === 'rock' || t.kind === 'cliff' || (t.kind === 'wall' && heightOf(t) > 1)));
  const over = new Set<Model>();
  let at: Point = { x: m.x, y: m.y };
  let free: Point = at;
  for (let d = 0.1; d <= inches + 1e-6; d += 0.1) {
    const p = { x: m.x + dir.x * d, y: m.y + dir.y * d };
    if (p.x < 0 || p.y < 0 || p.x > state.board.w || p.y > state.board.h) break;
    const body = { ...m, ...p };
    if (walls.some(t => insidePolygon(outline(t), p))) return { at: free, over: [...over], wall: true };
    const hit = others.filter(o => distanceBetween(body, o) <= 0);
    // (An engine counts as Strength 6.)
    const big = hit.find(o => o.siege || (modelStats(catalog, o)?.S ?? 3) >= 6);
    if (big) return { at: free, over: [...over], stoppedBy: big };
    for (const o of hit) over.add(o);
    at = p;
    if (!hit.length) free = p;
  }
  return { at: free, over: [...over] };
}

export interface SiegeShot {
  engine: Model;
  target: Model;
  /** To Hit, after the engine was turned this turn. */
  need: number;
  heads?: boolean;
}

/**
 * Fires an engine: the To Hit roll (a Siege Troll loading it re-rolls a miss), Scatter for a Battlefield Target, In
 * the Way rolls for a Direct Shot, then the To Wound roll and what it does: a Siege Target loses a Wound (D3 for a
 * Wall-breaker), a Battlefield Target is knocked Prone and, if wounded, slain. Area Effect hits everyone within 2", a
 * Piercing Shot flings its target back, and Severed Heads makes everyone nearby test their Courage instead.
 */
export function fireEngine(state: GameState, catalog: Catalog | null, shot: SiegeShot, d6: D6, seat: Seat, group: string, now: number, uid: () => string): Action[] {
  const { engine, target } = shot;
  const rules = rulesOf(catalog, engine);
  const e = engineFor(unitOf(catalog, engine)?.name ?? engine.name);
  const s = modelStats(catalog, engine)?.S ?? 8;
  const out: Action[] = [];
  // (Numbered from 0, so the first marks the engine as having shot this turn.)
  let n = 0;
  const log = (roll: Omit<DiceRoll, 'id' | 'at' | 'group' | 'by'>) => {
    const r = { ...roll, id: `${group}-${n++}`, at: now, group, by: seat } as DiceRoll;
    out.push({ type: 'rolled', roll: r });
    return r;
  };
  const crew = firingCrew(state, catalog, engine);
  let hit = d6();
  const label = `${engine.name} shoots ${target.name} (${shot.need}+)`.slice(0, 80);
  if (hit < shot.need && crew?.troll && rules.includes('Troll Loader')) {
    log({ label, dice: [hit], target: shot.need, model: engine.id, note: 'The Siege Troll reloads: re-rolling the miss.' });
    hit = d6();
  }
  if (hit < shot.need) {
    log({ label, dice: [hit], target: shot.need, model: engine.id, note: 'The shot veers wildly off course and misses.' });
    return out;
  }
  log({ label, dice: [hit], target: shot.need, model: engine.id, note: 'A hit.' });
  // The Old Twirly Whirlies: the bolt trails a line from the engine to where it strikes, until the turn ends.
  const cable = (m: Model) => rules.includes('The Old Twirly Whirlies') && out.push({ type: 'cable', from: [engine.x, engine.y], to: [m.x, m.y] });

  // A Battlefield Target may not be the one it lands on.
  let actual: Model | undefined = target;
  if (!siegeTarget(target)) {
    const roll = d6();
    actual = scatter(state, catalog, engine, target, roll);
    log({ label: `Scatter (${scatterRange(catalog, engine)}")`, dice: [roll], model: engine.id, note: roll === 6 ? `Dead on: it hits ${target.name}.` : actual ? `${roll === 1 ? 'Wide of the mark' : 'Slight deviation'}: it hits ${actual.name}.` : 'Wide of the mark: it misses completely.' });
    if (!actual) return out;
  }

  // In the way: a Direct Shot like any other; an Arcing Shot only of a Howdah above the beast it comes down on.
  const arcing = rules.includes('Arcing Shot');
  const landed: Model = actual;
  const inWay: { name: string; model?: string; howdah: boolean }[] = arcing
    ? landed.beast === 'war' && landed.howdahWounds
      ? [{ name: 'the Howdah', howdah: true }]
      : []
    : obstructions(state, engine, landed)
        .filter(o => !(o.model && (state.models[o.model]?.aboard || o.model === engine.id)))
        .map(o => ({ name: o.name, model: o.model, howdah: false }));
  let howdahHit = false;
  for (const o of inWay.slice(0, 6)) {
    const d = d6();
    const past = d >= 4;
    log({ label: `In the Way: ${o.name} (4+ gets past)`, dice: [d], target: 4, model: engine.id, ...(past ? {} : { note: `${o.name[0].toUpperCase()}${o.name.slice(1)} stops the shot.` }) });
    if (past) continue;
    if (o.howdah) howdahHit = true;
    else if (o.model && state.models[o.model]) actual = state.models[o.model];
    else return out;
    break;
  }

  // Severed Heads: no wound, but the target and every enemy within 3" of it test their Courage, and flee if they fail.
  if (shot.heads && rules.includes('Severed Heads')) {
    const scared = Object.values(state.models).filter(m => m.owner === actual!.owner && !m.dead && !m.waiting && !m.siege && !m.aboard && (m.id === actual!.id || distanceBetween(m, actual!) <= 3));
    for (const m of scared) {
      const c = modelStats(catalog, m)?.C ?? 7;
      const dice = [d6(), d6()];
      const pass = dice[0] + dice[1] >= c;
      log({ label: `Courage test: ${m.name} (Severed Heads)`.slice(0, 80), dice, sum: c, model: m.id, note: pass ? `${m.name} holds its nerve.` : `${m.name} flees the battle.` });
      if (!pass) out.push({ type: 'affect', id: m.id, patch: { dead: true, wounds: 0 } });
    }
    return out;
  }

  const target2: Model = actual;
  cable(target2);
  const big = siegeTarget(target2) || howdahHit;
  // To Wound, re-rolled with Flaming Ammunition against a Siege Target, and with Bladed Bolts on a 1; a Wall-breaker
  // rolls twice against a Siege Target and keeps the better.
  const woundRoll = (d: number, who: string, defence: number): number => {
    const need = woundNeed(s, defence);
    if (!need) {
      log({ label: `To wound ${who}: S${s} vs D${defence} (can't)`.slice(0, 80), dice: [], model: engine.id });
      return 0;
    }
    let dice = [d6()];
    if (big && rules.includes('Wall-breaker')) dice = [Math.max(dice[0], d6())];
    let ok = (x: number) => x >= need.target;
    if (!ok(dice[0]) && ((big && engine.options?.includes('Flaming Ammunition')) || (dice[0] === 1 && rules.includes('Bladed Bolts')))) dice = [d6()];
    let then: number[] | undefined;
    if (need.then && ok(dice[0])) {
      then = [d6()];
      ok = () => then![0] >= need.then!;
    }
    const wounded = ok(dice[0]);
    log({ label: `To wound ${who}: S${s} vs D${defence} (${need.target}+${need.then ? `/${need.then}+` : ''})`.slice(0, 80), dice, target: need.target, ...(then ? { then: need.then, follow: then } : {}), against: target2.id, model: engine.id, note: wounded ? `${who} is wounded.` : `${who} shrugs it off.` });
    return wounded ? d : 0;
  };
  const credit = [engine.id];
  if (howdahHit) {
    const n = woundRoll(rules.includes('Wall-breaker') ? Math.ceil(d6() / 2) : 1, `${target2.name}'s Howdah`, 9);
    if (n) out.push({ type: 'wound', id: target2.id, count: n, by: credit, how: 'shoot', group, howdah: true });
    return out;
  }
  const st = modelStats(catalog, target2);
  const parts: { name: string; d: number; mount?: boolean }[] = [{ name: target2.name, d: st?.D ?? 4 }];
  const steed = mounted(target2) ? mountOf(target2) : undefined;
  if (steed && steed.left > 0) parts.push({ name: `${target2.name}'s mount`, d: steed.d, mount: true });
  let slain = false;
  for (const p of parts) {
    if (big) {
      const n = woundRoll(rules.includes('Wall-breaker') ? Math.ceil(d6() / 2) : 1, p.name, p.d);
      if (n) out.push({ type: 'wound', id: target2.id, count: n, by: credit, how: 'shoot', group, ...(p.mount ? { mount: true } : {}) });
      continue;
    }
    if (!woundRoll(1, p.name, p.d)) continue;
    // Wounded, a Battlefield Target is slain outright, unless it is as tough as a Defence or Wounds of 10.
    const tough = (st?.D ?? 0) >= 10 || target2.maxWounds >= 10;
    const n = p.mount ? 9 : tough ? Math.max(1, Math.floor(target2.maxWounds / 2)) : target2.wounds;
    if (!p.mount && !tough) slain = true;
    out.push({ type: 'wound', id: target2.id, count: n, by: credit, how: 'shoot', group, ...(p.mount ? { mount: true } : {}) });
  }
  if (big) return out;
  // Knocked flat by the blow (an engine or a war beast never is).
  if (!target2.siege && !target2.beast) out.push({ type: 'affect', id: target2.id, patch: { prone: true } });

  // Everyone within 2" of where it came down takes a Strength 5 hit, and is knocked Prone.
  if (rules.includes('Area Effect')) {
    for (const m of Object.values(state.models).filter(x => x.id !== target2.id && !x.dead && !x.waiting && !x.escaped && !x.aboard && distanceBetween(x, target2) <= 2)) {
      const r = hitModel(m, modelStats(catalog, m)?.D ?? 4, 5, `Blast (${engine.name})`, d6, seat, `${group}-${uid()}`, now, group, false, credit);
      out.push(...r.actions);
      if (!m.siege && !m.beast) out.push({ type: 'affect', id: m.id, patch: { prone: true } });
    }
  }

  // Piercing Shot: a model of Strength 5 or less that lives is flung back, bowling over those it passes.
  if (e?.fling && !slain && (st?.S ?? 3) <= 5 && !target2.siege && !target2.beast) {
    const roll = d6();
    const inches = e.fling === 3 ? Math.ceil(roll / 2) : roll;
    const f = fling(state, catalog, engine, target2, inches);
    log({ label: `Piercing Shot: ${target2.name} is flung back ${inches}"`.slice(0, 80), dice: [roll], model: engine.id, ...(f.stoppedBy ? { note: `It crashes into ${f.stoppedBy.name}.` } : f.wall ? { note: 'It crashes into terrain.' } : {}) });
    out.push({ type: 'affect', id: target2.id, patch: { x: Math.round(f.at.x * 1000) / 1000, y: Math.round(f.at.y * 1000) / 1000, prone: true } });
    for (const o of f.over) {
      out.push(...hitModel(o, modelStats(catalog, o)?.D ?? 4, 5, `Piercing Shot (${target2.name} flung)`, d6, seat, `${group}-${uid()}`, now, group, false, credit).actions);
      if (!o.siege && !o.beast) out.push({ type: 'affect', id: o.id, patch: { prone: true } });
    }
    if (f.stoppedBy || f.wall) {
      out.push(...hitModel(target2, st?.D ?? 4, 6, 'Piercing Shot (crash)', d6, seat, `${group}-${uid()}`, now, group, false, credit).actions);
      if (f.stoppedBy) out.push(...hitModel(f.stoppedBy, modelStats(catalog, f.stoppedBy)?.D ?? 6, 6, 'Piercing Shot (crash)', d6, seat, `${group}-${uid()}`, now, group, false, credit).actions);
    }
  }
  return out;
}

/** Whether a shot from `a` to `b` crosses an Iron Hills Ballista's line, or aims within 3" of it. */
export function acrossCable(state: GameState, a: Point, b: Point): boolean {
  return (state.flow.cables ?? []).some(([x1, y1, x2, y2]) => segmentsCross(a, b, { x: x1, y: y1 }, { x: x2, y: y2 }) || toSegment(b, { x: x1, y: y1 }, { x: x2, y: y2 }) <= 3);
}
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
function toSegment(p: Point, a: Point, b: Point): number {
  const l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** How many bolts the Avenger Bolt Thrower looses this time: a D6, or the better of two with Swift Reload. */
export function boltCount(engine: Model, d6: D6): { n: number; dice: number[] } {
  const dice = engine.options?.includes('Swift Reload') ? [d6(), d6()] : [d6()];
  return { n: Math.max(...dice), dice };
}
export const rapidFire = (catalog: Catalog | null | undefined, engine: Model) => !!engineFor(unitOf(catalog, engine)?.name ?? engine.name)?.rapid;

/**
 * Engines put out of action as the turn ends: an enemy beside one that did nothing this turn but move (no shooting,
 * no spell, no fight, and no power on it) disables it.
 */
export function engineSabotage(state: GameState): { engine: Model; by: Model }[] {
  const out: { engine: Model; by: Model }[] = [];
  const fought = foughtThisTurn(state);
  for (const engine of Object.values(state.models).filter(m => m.siege && !m.dead)) {
    const by = enemiesAt(state, engine).find(e => !state.flow.shot?.includes(e.id) && !state.flow.cast?.includes(e.id) && !fought.has(e.id) && !(e.effects ?? []).some(x => x.turn === state.turn));
    if (by) out.push({ engine, by });
  }
  return out;
}

/** The rolls and changes for the engines disabled as the turn ends (none outside the End phase). */
export function sabotageActions(state: GameState, uid: () => string, now = Date.now()): Action[] {
  if (state.phase !== 'end' || !state.flow.started) return [];
  return engineSabotage(state).flatMap(({ engine, by }): Action[] => [
    { type: 'rolled', roll: { id: `sab-${uid()}`, by: by.owner, label: `${by.name} disables ${engine.name}`.slice(0, 80), dice: [], model: engine.id, at: now, note: `${engine.name} is put out of action.` } },
    { type: 'affect', id: engine.id, patch: { wounds: 0, dead: true } },
  ]);
}

/** The size an engine stands for, from its profile. */
export const engineSize = (unitName: string | undefined) => engineFor(unitName)?.size;
/** Half an engine's longest base side, for laying out its crew around it. */
export const engineReach = (engine: Model) => Math.max(halfExtents(engine.base).rx, halfExtents(engine.base).ry);
