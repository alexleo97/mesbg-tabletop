import { modelStats, type Catalog } from './catalog.ts';
import { fighterOf } from './wargear.ts';
import { duelLeader, duelSettled, strikeWounds, woundsTaken, type Fighter, type FightRequest } from './fight.ts';
import { supporters } from './support.ts';
import { activeSeat, combats, CONTACT_SLACK, other, type Combat } from './flow.ts';
import { distanceBetween, halfExtents, mmToIn, type Point } from './geometry.ts';
import { canActivate, canDeclare, declared, heroicInfo, heroicTurn, heroicsSettled, mayActivate, orderRollLabel, orderRollNeeded, phaseHeroics } from './heroics.ts';
import { canCast, castTargets, pendingSpell, powersOf, untargeted, type KnownPower } from './magic.ts';
import { fightDone, limitMove, moveAllowance } from './movement.ts';
import { affected, basePower, cannotAct, effectsOn, isCavalry, isLinePower, under } from './powers.ts';
import { carriedBy, exitEdges, markerActions, onTable, sanctuary } from './objects.ts';
import { chance, fightOdds, woundChance, type Side } from './odds.ts';
import { PICKS, pickOptions } from './picks.ts';
import { scoreLines } from './scoring.ts';
import { planShot, weaponFor } from './shooting.ts';
import { atCrossing, crossBlocked, fallingHits } from './terrainTests.ts';
import { armyStatus } from './status.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// The computer player. Each call looks at the game and picks the one thing it would do next, so the server can play
// its moves out one at a time with a pause between them, and anything the other player does in the meantime is seen.

/** What the computer remembers between its steps. Kept by the server per game; losing it only costs a little time. */
export interface BotMemo {
  /** The turn and phase the rest of this describes. */
  key: string;
  turn: number;
  /** When it first saw this phase, so older dice in the log aren't mistaken for this phase's. */
  since: number;
  /** Models that have had their go this phase. */
  acted: string[];
  /** How far each model moved this turn, as only models that moved half their Move or less can shoot. */
  moved: Record<string, number>;
  /** Courage tests passed (true) or failed this turn, for a Broken army or a charge at a terrifying enemy. */
  courage: Record<string, boolean>;
  /** A step waiting on its result: a model's shot, Courage test or what it does with markers after moving. */
  pending?: { kind: 'shot' | 'courage' | 'marker'; model: string; tries?: number };
  steps: number;
  /** The last enemy it moved with a Compel. */
  compelled?: string;
  /** Heroes that have thought about casting this phase. */
  pondered?: string[];
  /** Models that have tried a Jump, Climb or Leap test this phase. */
  tested?: string[];
}

export const newMemo = (): BotMemo => ({ key: '', turn: 0, since: 0, acted: [], moved: {}, courage: {}, steps: 0 });

/** The next thing the computer does: an action to send, then how long to pause before thinking again. */
export interface BotStep {
  action?: Action;
  delay: number;
}

const MOVE_PAUSE = 450;
const DICE_PAUSE = 1100;
const THINK_PAUSE = 700;
const WAIT_PAUSE = 1500;
/** A safety net: no phase should need this many steps, so past it the computer just finishes up. */
const MAX_STEPS = 400;

interface Profile {
  mv: number;
  f: number;
  a: number;
  s: number;
  d: number;
  c: number;
  i: number;
  shoot: number;
  weapon?: { name: string; range: number; s: number };
  heroics: string[];
  terror: boolean;
  value: number;
}

interface Ctx {
  state: GameState;
  seat: Seat;
  catalog: Catalog | null;
  memo: BotMemo;
  now: number;
  profiles: Map<string, Profile>;
  /** The other side is a person, who may want to spend Might before strikes are rolled. */
  person: boolean;
}

function profile(ctx: Ctx, m: Model): Profile {
  let p = ctx.profiles.get(m.id);
  if (p) return p;
  const st = modelStats(ctx.catalog, m);
  const unit = m.profileId ? ctx.catalog?.units[m.profileId] : undefined;
  p = {
    mv: m.move,
    f: st?.Fv ?? 3,
    a: st?.A ?? 1,
    s: st?.S ?? 3,
    d: st?.D ?? 4,
    c: st?.C ?? 7,
    i: st?.I ?? 7,
    shoot: st?.Sv ?? 4,
    weapon: unit ? weaponFor(ctx.catalog, m) : undefined,
    heroics: unit?.heroics ?? [],
    terror: !!unit?.rules.some(r => /^Terror\b/.test(r)),
    value: worth(m),
  };
  ctx.profiles.set(m.id, p);
  return p;
}

/** What a model is worth, in rough warrior-sized units: its points, with the General counting for more. */
function worth(m: Model): number {
  const base = (m.points ?? (m.hero ? 50 : 8)) / 8;
  return Math.max(m.hero ? 4 : 0.5, base) * (m.general ? 1.5 : 1);
}

const isUp = (m: Model) => !m.dead && !m.escaped && !m.waiting;
const side = (state: GameState, seat: Seat) => Object.values(state.models).filter(m => m.owner === seat && isUp(m));
const engagedWith = (state: GameState, m: Model) => Object.values(state.models).filter(e => e.owner !== m.owner && isUp(e) && Math.abs(e.x - m.x) < 5 && Math.abs(e.y - m.y) < 5 && distanceBetween(m, e) <= CONTACT_SLACK);
const radius = (m: Model) => mmToIn((m.base.w + m.base.h) / 2) / 2;
const centre = (m: Point, p: Point) => Math.hypot(m.x - p.x, m.y - p.y);
const shrink = (m: Model): Model => ({ ...m, base: { ...m.base, w: m.base.w * 0.85, h: m.base.h * 0.85 } });
const facing = (from: Point, to: Point) => Math.round((Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI);

function fighterSide(ctx: Ctx, models: Model[]): Side {
  return {
    models: models.map(m => {
      const p = profile(ctx, m);
      const strong = declared(ctx.state, m.id, 'Heroic Strength');
      return { a: p.a, f: p.f, s: strong ? Math.min(10, p.s * 2) : p.s, d: p.d, w: Math.max(1, m.wounds), value: p.value };
    }),
  };
}

/** Keeps the memory in step with the game: a new phase clears what was done, a new turn clears moves and tests. */
function sync(memo: BotMemo, state: GameState, now: number) {
  const key = `${state.flow.startedAt ?? 0}:${state.turn}:${state.phase}`;
  if (memo.key === key) return;
  const newTurn = memo.turn !== state.turn || !memo.key.startsWith(`${state.flow.startedAt ?? 0}:`);
  Object.assign(memo, { key, turn: state.turn, since: now - 50, acted: [], steps: 0, pending: undefined, pondered: [] }, newTurn ? { moved: {}, courage: {} } : {});
}

/**
 * The computer's next step as `seat`, or null when it has nothing to do until the other player acts.
 * `memo` is updated in place.
 */
export function botStep(state: GameState, seat: Seat, catalog: Catalog | null, memo: BotMemo, now = Date.now(), person = true): BotStep | null {
  sync(memo, state, now);
  const ctx: Ctx = { state, seat, catalog, memo, now, profiles: new Map(), person };
  if (state.result) return resultStep(ctx);
  // A side with nothing left does nothing; one whose warbands are still waiting to arrive still takes its turns.
  if (!Object.values(state.models).some(m => m.owner === seat && !m.dead && !m.escaped)) return null;
  const picks = picksStep(ctx);
  if (picks) return picks;
  if (!state.flow.started) return null;
  const spell = spellStep(ctx) ?? compelStep(ctx);
  if (spell) return spell;
  if (++memo.steps > MAX_STEPS) return finish(ctx);
  return fateStep(ctx) ?? challengeStep(ctx) ?? (state.flow.shotPause ? pausedShot(ctx) : null) ?? phaseStep(ctx);
}

function phaseStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  switch (state.phase) {
    case 'priority':
      return priorityStep(ctx);
    case 'move':
    case 'shoot':
    case 'fight': {
      if (heroicTurn(state) === seat) return heroicStep(ctx);
      if (!heroicsSettled(state)) return null;
      if (orderRollNeeded(state) && state.priority === seat && !state.log.some(r => r.label === orderRollLabel(state))) {
        return { action: { type: 'roll', count: 1, label: orderRollLabel(state) }, delay: DICE_PAUSE };
      }
      if (state.phase === 'fight') return fightStep(ctx);
      if (activeSeat(state) !== seat) return null;
      return state.phase === 'move' ? moveStep(ctx) : shootStep(ctx);
    }
    default:
      return null;
  }
}

/** Past the step limit something has gone wrong, so the computer finishes its part of the phase instead of looping. */
function finish(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  if (heroicTurn(state) === seat) return { action: { type: 'passHeroic', seat }, delay: THINK_PAUSE };
  if (activeSeat(state) === seat) return { action: { type: 'endActivation', seat }, delay: THINK_PAUSE };
  return null;
}

// ——— The result, secret picks and Fate ———

function resultStep({ state, seat }: Ctx): BotStep | null {
  const r = state.result!;
  if (r.agreed) return null;
  if (r.by === 'game') return r.confirmed?.includes(seat) ? null : { action: { type: 'answerResult', seat, agree: true }, delay: THINK_PAUSE };
  if (r.by === seat) return null;
  // A draw offered: taken when the computer isn't ahead.
  const vp = scoreLines(state).reduce((n, l) => n + l.vp[seat] - l.vp[other(seat)], 0);
  const lost = (s: Seat) => armyStatus(state, s).lost / Math.max(1, armyStatus(state, s).start);
  const ahead = vp > 0 || (vp === 0 && lost(seat) < lost(other(seat)) - 0.1);
  return { action: { type: 'answerResult', seat, agree: !ahead }, delay: WAIT_PAUSE };
}

function picksStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  const specs = state.scenario ? PICKS[state.scenario] : undefined;
  if (!specs) return null;
  for (const p of specs) {
    if (state.flow.picks?.[seat]?.[p.key]) continue;
    const opts = pickOptions(state, seat, p);
    if (!opts.length) continue;
    let choice = opts[0].id;
    if (p.of === 'terrain') {
      // The piece easiest to reach: nearest the middle of the table.
      const mid = state.board.h / 2;
      choice = [...opts].sort((a, b) => Math.abs(state.terrain[a.id].y - mid) - Math.abs(state.terrain[b.id].y - mid))[0].id;
    } else {
      const heroes = opts.map(o => state.models[o.id]).filter(Boolean);
      const might = (m: Model) => profile(ctx, m).f * 2 + profile(ctx, m).a * 3 + m.maxWounds + m.might + m.fate;
      // Hunt the easiest hero to kill; send the deadliest; protect the hardiest.
      const sorted = [...heroes].sort((a, b) => might(a) - might(b));
      choice = (p.of === 'enemy' ? sorted[0] : sorted[sorted.length - 1]).id;
    }
    return { action: { type: 'setPick', seat, key: p.key, value: choice }, delay: THINK_PAUSE };
  }
  return null;
}

/** A hero of the computer's with wounds waiting: Fate when the wound would kill it or it has Fate to spare, Might to rescue a 3. */
function fateStep({ state, seat }: Ctx): BotStep | null {
  for (const m of side(state, seat)) {
    if (!m.pending) continue;
    const last = m.fateRoll ? state.log.find(r => r.id === m.fateRoll) : undefined;
    if (last && last.dice[0] === 3 && m.might > 0) return { action: { type: 'useMight', roll: last.id, die: 0 }, delay: DICE_PAUSE };
    const deadly = m.wounds - m.pending <= 0;
    if (m.fate > 0 && (deadly || m.fate >= 2)) return { action: { type: 'rollFate', id: m.id }, delay: DICE_PAUSE };
    return { action: { type: 'takeWound', id: m.id, all: true }, delay: THINK_PAUSE };
  }
  return null;
}

// ——— Priority and heroic actions ———

function priorityStep(ctx: Ctx): BotStep | null {
  const { state, seat, now, memo } = ctx;
  const f = state.flow;
  if (f.chooserTurn !== state.turn || !f.chooser) {
    // Give the other player a moment to roll it themselves.
    return now - memo.since < 2500 ? { delay: 2600 - (now - memo.since) } : { action: { type: 'rollPriority' }, delay: DICE_PAUSE };
  }
  if (f.chooser !== seat || state.priority) return null;
  // Moving first is worth it when the armies are close enough to charge; otherwise let the enemy show its hand.
  const ours = side(state, seat);
  const theirs = side(state, other(seat));
  const close = ours.some(m => theirs.some(e => distanceBetween(m, e) <= Math.max(m.move, e.move) * 2 + 1));
  return { action: { type: 'choosePriority', seat: close ? seat : other(seat) }, delay: THINK_PAUSE };
}

function heroicStep(ctx: Ctx): BotStep {
  const { state, seat } = ctx;
  const pass: BotStep = { action: { type: 'passHeroic', seat }, delay: THINK_PAUSE };
  if (state.phase !== 'fight') return pass;
  const fights = combats(state);
  for (const h of canDeclare(state, seat)) {
    const fight = fights.find(c => c[seat].includes(h.id));
    if (!fight) continue;
    const p = profile(ctx, h);
    const has = (name: string) => heroicInfo(name)?.universal || p.heroics.includes(name);
    const ids = (s: Seat) => fight[s].map(id => state.models[id]).filter(Boolean);
    const odds = fightOdds(fighterSide(ctx, ids(seat)), fighterSide(ctx, ids(other(seat))));
    const declare = (action: string): BotStep => ({ action: { type: 'declareHeroic', model: h.id, action }, delay: DICE_PAUSE });
    // A close duel is worth a Might point for D3 more Fight; a won duel that can't wound wants double Strength.
    if (has('Heroic Strike') && h.might >= 2 && odds.win > 0.2 && odds.win < 0.7) return declare('Heroic Strike');
    if (has('Heroic Strength') && h.might >= 2 && odds.win >= 0.6 && odds.dealt < 1) return declare('Heroic Strength');
    // Badly outmatched and hurt: only a 6 wounds it this phase.
    if (has('Heroic Defence') && h.might >= 1 && odds.win < 0.35 && h.wounds <= Math.max(1, odds.taken)) return declare('Heroic Defence');
  }
  return pass;
}

// ——— Moving ———

function moveStep(ctx: Ctx): BotStep {
  const { state, seat, memo } = ctx;
  const pend = memo.pending;
  if (pend?.kind === 'marker') {
    const m = state.models[pend.model];
    const act = m && (pend.tries ?? 0) < 3 ? markerStep(ctx, m) : null;
    if (act) {
      pend.tries = (pend.tries ?? 0) + 1;
      return act;
    }
    memo.pending = undefined;
  }
  if (pend?.kind === 'courage') {
    const r = latestRoll(ctx, pend.model, 'Courage');
    if (!r) return { delay: THINK_PAUSE };
    memo.courage[pend.model] = r.dice.reduce((a, b) => a + b, 0) >= (r.sum ?? 7);
    memo.pending = undefined;
    // A Broken army's model that fails its test flees the battle.
    const m = state.models[pend.model];
    if (!memo.courage[pend.model] && m && r.label.startsWith('Courage test')) {
      memo.acted.push(m.id);
      return { action: { type: 'updateModel', id: m.id, patch: { dead: true, wounds: 0 } }, delay: MOVE_PAUSE };
    }
  }

  // A model stopped at a wall, rock or stream takes the test to get over it.
  for (const m of side(state, seat)) {
    const at = atCrossing(state, m);
    if (!at || (memo.tested ??= []).includes(m.id)) continue;
    memo.tested.push(m.id);
    const c = { terrain: at.terrain, test: at.test, stop: { x: at.stop[0], y: at.stop[1] }, landing: { x: at.landing[0], y: at.landing[1] }, drop: at.drop };
    if (!crossBlocked(state, m, c) && !(at.test === 'Climb down' && fallingHits(m, at.drop) >= m.wounds)) return { action: { type: 'cross', id: m.id }, delay: DICE_PAUSE };
  }

  const cast = castStep(ctx);
  if (cast) return cast;

  const broken = armyStatus(state, seat).broken;
  const enemies = side(state, other(seat));
  const nearest = (m: Model) => Math.min(...enemies.map(e => centre(m, e)), 999);
  // Models that can charge go first, nearest the enemy leading, so others can join their fights; then the rest
  // from the back forward, so the line closes up rather than strings out.
  const reach = (m: Model) => nearest(m) <= m.move + 2;
  const queue = side(state, seat)
    .filter(m => !memo.acted.includes(m.id))
    .sort((a, b) => Number(reach(b)) - Number(reach(a)) || (reach(a) ? nearest(a) - nearest(b) : nearest(b) - nearest(a)));
  const goals = assignGoals(ctx);
  for (const m of queue) {
    // Not now: waiting for a hero's heroic activation to finish (or gone with one already).
    if (!mayActivate(state, m)) continue;
    // Engaged, or held where it is by a power or a Compel.
    if (engagedWith(state, m).length || moveAllowance(state, m) === 0) {
      memo.acted.push(m.id);
      continue;
    }
    // On the server the game rolls these tests itself (see courage.ts): a Broken army's as its turn to move starts,
    // and a charge at a terrifying enemy as the charger makes contact.
    const tested = state.flow.courage?.[m.id];
    if (tested !== undefined) memo.courage[m.id] ??= tested;
    if (broken && memo.courage[m.id] === undefined && !state.flow.braved?.includes(seat)) return courageTest(ctx, m, `Courage test: ${m.name}`);
    memo.acted.push(m.id);
    const to = planMove(ctx, m, goals.get(m.id));
    if (!to) {
      memo.pending = { kind: 'marker', model: m.id };
      const act = markerStep(ctx, m);
      if (act) return act;
      memo.pending = undefined;
      continue;
    }
    memo.moved[m.id] = (memo.moved[m.id] ?? 0) + centre(m, to.at);
    memo.pending = { kind: 'marker', model: m.id };
    return { action: { type: 'moveModels', moves: [{ id: m.id, x: to.at.x, y: to.at.y, rot: to.rot }] }, delay: MOVE_PAUSE };
  }
  return { action: { type: 'endActivation', seat }, delay: THINK_PAUSE };
}

function courageTest(ctx: Ctx, m: Model, label: string): BotStep {
  ctx.memo.pending = { kind: 'courage', model: m.id };
  return { action: { type: 'roll', count: 2, sum: profile(ctx, m).c, label, model: m.id }, delay: DICE_PAUSE };
}

/** The model's latest roll this phase whose label starts with `prefix`. */
function latestRoll(ctx: Ctx, model: string, prefix: string): DiceRoll | undefined {
  return [...ctx.state.log].reverse().find(r => r.model === model && r.label.startsWith(prefix) && r.at >= ctx.memo.since);
}

/** Picking up, turning over, digging up or carrying off markers once a model has moved. */
function markerStep(ctx: Ctx, m: Model): BotStep | null {
  const { state } = ctx;
  if (!isUp(m)) return null;
  for (const a of markerActions(state, m)) {
    if (a.kind === 'drop') continue;
    if (a.kind === 'escape') {
      // Leave the table with something worth carrying off, or in a scenario that scores getting models away.
      if (carriedBy(state, m).length || state.scenario === 'reconnoitre') return { action: { type: 'escape', model: m.id }, delay: MOVE_PAUSE };
      continue;
    }
    if (a.kind === 'uncover') return { action: { type: 'uncover', model: m.id, marker: a.marker!, intelligence: profile(ctx, m).i }, delay: DICE_PAUSE };
    return { action: { type: a.kind, model: m.id, marker: a.marker! }, delay: MOVE_PAUSE };
  }
  return null;
}

interface Goal {
  at: Point;
  /** How much getting closer is worth, per inch. */
  pull: number;
  /** Stop this far short (to guard a marker rather than stand on it). */
  near?: number;
}

/**
 * Sends models after what the scenario is about: objectives to hold, markers to find, pick up or destroy, enemy
 * carriers to stop, and for a model carrying something, the way off the table or to safety.
 */
function assignGoals(ctx: Ctx): Map<string, Goal> {
  const { state, seat } = ctx;
  const out = new Map<string, Goal>();
  const ours = side(state, seat).filter(m => !engagedWith(state, m).length);
  const cavalry = (m: Model) => m.base.h > m.base.w;
  const { w, h } = state.board;

  // Carriers first: off the table where that scores, to a Sanctuary with the wounded, otherwise back to safety.
  for (const m of ours) {
    const carried = carriedBy(state, m);
    if (!carried.length) continue;
    const edges = exitEdges(state, m);
    const spots: Point[] = edges.map(e => (e === 'top' ? { x: m.x, y: 0 } : e === 'bottom' ? { x: m.x, y: h } : e === 'left' ? { x: 0, y: m.y } : { x: w, y: m.y }));
    if (carried.some(t => t.object === 'ally')) spots.push(...sanctuary(state, seat).map(z => (z.shape === 'quarter-circle' ? { x: z.cx === 0 ? 3 : w - 3, y: z.cy === 0 ? 3 : h - 3 } : { x: w / 2, y: h / 2 })));
    if (!spots.length) spots.push({ x: m.x, y: seat === 'p1' ? h - 2 : 2 });
    const at = spots.sort((a, b) => centre(m, a) - centre(m, b))[0];
    out.set(m.id, { at, pull: 1.2 });
  }

  const wants: { at: Point; need: number; pull: number; near?: number; infantry?: boolean }[] = [];
  for (const t of onTable(state)) {
    if (t.carrier) {
      const c = state.models[t.carrier];
      if (c && c.owner !== seat) wants.push({ at: c, need: 2, pull: 0.9 });
      continue;
    }
    if (!t.object) wants.push({ at: t, need: 2, pull: 0.6, near: 1.5 });
    else if (t.object === 'artefact') {
      if (!t.hidden || t.tried?.[seat] !== state.turn) wants.push({ at: t, need: 1, pull: 0.8, infantry: t.hidden });
    } else if (t.object === 'heirloom' || t.object === 'decoy') {
      if (t.hidden) wants.push({ at: t, need: 1, pull: 0.8, infantry: true });
    } else if (t.object === 'relic' || t.object === 'supply') {
      // Go for the enemy's; keep a guard by our own.
      wants.push(t.side === seat ? { at: t, need: 1, pull: 0.4, near: 1.5 } : { at: t, need: 1, pull: 0.8 });
    } else if (t.object === 'ally' && t.side === seat) wants.push({ at: t, need: 1, pull: 0.8 });
  }
  const free = ours.filter(m => !out.has(m.id));
  for (const want of wants) {
    const takers = free
      .filter(m => !out.has(m.id) && (!want.infantry || !cavalry(m)))
      .sort((a, b) => centre(a, want.at) - centre(b, want.at))
      .slice(0, want.need);
    for (const m of takers) out.set(m.id, { at: { x: want.at.x, y: want.at.y }, pull: want.pull, near: want.near });
  }

  // Reconnoitre scores getting models off the far edge, so everyone else heads that way.
  if (state.scenario === 'reconnoitre') {
    for (const m of ours) if (!out.has(m.id)) out.set(m.id, { at: { x: m.x, y: seat === 'p1' ? 0 : h }, pull: 0.35 });
  }
  return out;
}

interface Plan {
  at: Point;
  rot: number;
}

/** Where a model should move this turn, or null to stay put. */
function planMove(ctx: Ctx, m: Model, goal: Goal | undefined): Plan | null {
  const { state, seat } = ctx;
  const p = profile(ctx, m);
  const from = { x: m.x, y: m.y };
  const enemies = side(state, other(seat));
  // A Prone model has half its Move left once it stands up.
  const mv = Math.min(p.mv, moveAllowance(state, m) ?? p.mv);

  const spots: { at: Point; charge?: Model }[] = [{ at: from }];
  const reach = (to: Point) => limitMove(state, from, to, mv, seat, m);
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    for (const f of [1, 0.5]) spots.push({ at: reach({ x: from.x + Math.sin(a) * mv * f, y: from.y - Math.cos(a) * mv * f }) });
  }
  if (goal) {
    const d = centre(from, goal.at);
    const stop = goal.near ?? 0;
    if (d > stop) {
      const k = Math.max(0, (d - stop) / d);
      spots.push({ at: reach({ x: from.x + (goal.at.x - from.x) * k, y: from.y + (goal.at.y - from.y) * k }) });
    }
  }
  // Charges: into base contact with each enemy in reach, from a spread of angles so others can join the fight.
  const terrorFailed = ctx.memo.courage[m.id] === false;
  for (const e of enemies) {
    if (distanceBetween(m, e) > mv + 0.5 || (terrorFailed && profile(ctx, e).terror)) continue;
    const r = radius(m) + radius(e) + 0.02;
    const base = Math.atan2(m.x - e.x, -(m.y - e.y));
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, Math.PI]) {
      const at = { x: e.x + Math.sin(base + off) * r, y: e.y - Math.cos(base + off) * r };
      const got = reach(at);
      if (centre(got, at) < 1e-3) spots.push({ at, charge: e });
    }
  }

  const before = scoreFor(ctx, m, from);
  let best: { at: Point; score: number; charge?: Model } = { at: from, score: before.score };
  const vpBefore = before.vp;
  for (const s of spots) {
    if (!fits(ctx, m, s.at, s.charge)) continue;
    const sc = scoreFor(ctx, m, s.at, goal, vpBefore);
    if (sc.score > best.score + 0.05) best = { at: s.at, score: sc.score, charge: s.charge };
  }
  if (centre(best.at, from) < 0.05) return null;
  const look = best.charge ?? [...enemies].sort((a, b) => centre(best.at, a) - centre(best.at, b))[0];
  return { at: best.at, rot: look ? facing(best.at, look) : m.rot };
}

/** Whether a model can stand at `at`: on the table, clear of other bases, and out of enemy control zones unless fighting. */
function fits(ctx: Ctx, m: Model, at: Point, charge?: Model): boolean {
  const { state } = ctx;
  const { rx, ry } = halfExtents(m.base);
  if (at.x - rx < 0 || at.y - ry < 0 || at.x + rx > state.board.w || at.y + ry > state.board.h) return false;
  const here = { ...m, ...at };
  const r = radius(m);
  for (const o of Object.values(state.models)) {
    if (o.id === m.id || !isUp(o) || Math.abs(o.x - at.x) > 6 || Math.abs(o.y - at.y) > 6) continue;
    // Bases mustn't overlap: round ones by their centres, others by their outlines pulled in a little so touching is fine.
    if (here.base.shape === 'round' && o.base.shape === 'round' ? centre(at, o) < (r + radius(o)) * 0.95 : distanceBetween(shrink(here), shrink(o)) === 0) return false;
    if (o.owner !== m.owner && o !== charge) {
      const d = distanceBetween(here, o);
      if (d > CONTACT_SLACK && d < 1) return false;
    }
  }
  return !charge || distanceBetween(here, charge) <= CONTACT_SLACK;
}

/** How good a spot is for a model, all things weighed: fights it starts, danger it stands in, shots it gets, the scenario. */
function scoreFor(ctx: Ctx, m: Model, at: Point, goal?: Goal, vpBefore?: number): { score: number; vp: number } {
  const { state, seat } = ctx;
  const p = profile(ctx, m);
  const here: Model = { ...m, ...at };
  const moved = state.models[m.id];
  const after: GameState = { ...state, models: { ...state.models, [m.id]: here } };
  const enemies = side(after, other(seat));
  const friends = side(after, seat).filter(f => f.id !== m.id);
  let score = 0;

  // A fight it starts or joins: how much better that fight goes with this model in it.
  const foes = enemies.filter(e => Math.abs(e.x - at.x) < 5 && Math.abs(e.y - at.y) < 5 && distanceBetween(here, e) <= CONTACT_SLACK);
  if (foes.length) {
    const helpers = friends.filter(f => foes.some(e => distanceBetween(f, e) <= CONTACT_SLACK));
    const their = [...new Set([...foes, ...helpers.flatMap(f => engagedWith(after, f))])];
    const withUs = fightOdds(fighterSide(ctx, [here, ...helpers]), fighterSide(ctx, their));
    const without = helpers.length ? fightOdds(fighterSide(ctx, helpers), fighterSide(ctx, their)).score : 0;
    score += (withUs.score - without) * 3 + (aggressive(ctx) ? 1.2 : 0.4);
  } else {
    // Danger: enemies that could charge it here next turn, eased by friends close enough to help.
    let danger = 0;
    for (const e of enemies) {
      const ep = profile(ctx, e);
      if (Math.abs(e.x - at.x) > ep.mv + 4 || Math.abs(e.y - at.y) > ep.mv + 4) continue;
      if (distanceBetween(e, here) > ep.mv + 1) continue;
      const o = fightOdds(fighterSide(ctx, [here]), fighterSide(ctx, [e]));
      danger += Math.min(0, o.score) * (engagedWith(after, e).length ? 0.3 : 1);
    }
    const support = friends.filter(f => centre(f, at) <= 2.5).length;
    score += danger * (support >= 2 ? 0.4 : support ? 0.7 : 1) * (p.weapon ? 1.5 : 1);

    // Archers want a target in range from a spot they can still shoot from; with none, they come closer.
    const shot = p.weapon && centre(moved, at) <= p.mv / 2 + 0.05 ? (bestShot(ctx, here, after)?.value ?? 0) : 0;
    score += shot;

    // Closing in when the army is the stronger one; holding together otherwise.
    const near = (q: Point) => Math.min(...enemies.map(e => centre(q, e)), 60);
    if (!p.weapon) score += (near(moved) - near(at)) * (aggressive(ctx) ? 0.22 : 0.06);
    else if (!shot && !bestShot(ctx, moved)) score += (near(moved) - near(at)) * 0.12;
    // Fast models and heroes don't run far ahead of the battle line on their own.
    if (!goal) {
      const ahead = front(ctx, m) - 3 - near(at);
      if (ahead > 0) score -= ahead * (m.hero ? 0.45 : 0.3);
    }
  }

  // Heroes like company; everyone likes not being alone.
  const close = friends.filter(f => centre(f, at) <= 3).length;
  score += Math.min(close, 2) * (m.hero ? 0.5 : 0.15);

  if (goal) {
    const dist = (q: Point) => Math.max(goal.near ?? 0, centre(q, goal.at));
    score += (dist(moved) - dist(at)) * goal.pull;
  }

  // What the scenario's scoring would say if the game ended with the model here.
  let vp = 0;
  if (state.scenario) {
    vp = scoreLines(after).reduce((n, l) => n + l.vp[seat] - l.vp[other(seat)], 0);
    if (vpBefore !== undefined) score += (vp - vpBefore) * 4;
  }
  return { score, vp };
}

/** How far the middle of the army is from the enemy: the battle line the rest keep to. */
function front(ctx: Ctx, m: Model): number {
  const { state, seat } = ctx;
  const enemies = side(state, other(seat));
  const gaps = side(state, seat)
    .filter(f => f.id !== m.id)
    .map(f => Math.min(...enemies.map(e => centre(f, e)), 60))
    .sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
}

/** The stronger army presses forward; the weaker one picks its fights. */
function aggressive(ctx: Ctx): boolean {
  const { state, seat } = ctx;
  const power = (s: Seat) => side(state, s).reduce((n, m) => n + profile(ctx, m).value * (1 + profile(ctx, m).f / 5), 0);
  return power(seat) >= power(other(seat)) * 0.85;
}

// ——— Shooting ———

interface Shot {
  target: Model;
  obstacles: number;
  value: number;
}

/** The shot most worth taking from where `m` stands: likely wounds times what the target is worth. */
function bestShot(ctx: Ctx, m: Model, state = ctx.state): Shot | null {
  const p = profile(ctx, m);
  if (!p.weapon) return null;
  let best: Shot | null = null;
  for (const e of side(state, other(m.owner))) {
    if (distanceBetween(m, e) > p.weapon.range) continue;
    const plan = planShot(state, ctx.catalog, m, e, { fallback: { weapon: p.weapon, shoot: p.shoot } });
    if (plan.why) continue;
    const obstacles = Math.min(5, plan.inWay.length);
    // A shot into a fight might hit a friend instead.
    const stray = plan.fight?.length ? 0.5 : 1;
    const hit = plan.shots * chance(plan.need) * Math.pow(0.5, obstacles) * stray * woundChance(p.weapon.s, profile(ctx, e).d);
    const value = (hit * profile(ctx, e).value) / Math.max(1, e.wounds) / (e.hero && e.fate ? 2 : 1);
    if (!best || value > best.value) best = { target: e, obstacles, value };
  }
  return best;
}

/** A power cast at one of the computer's models: resist it with a die of Will (two for a hero with Will to spare). */
function spellStep(ctx: Ctx): BotStep | null {
  const p = pendingSpell(ctx.state);
  if (!p) return null;
  if (!p.cast && p.caster.owner === ctx.seat) return { action: { type: 'letSpellFail' }, delay: THINK_PAUSE };
  if (!p.cast || p.target.owner !== ctx.seat || p.ready) return null;
  return { action: { type: 'resist', will: Math.min(p.target.will, p.target.will > 2 ? 2 : 1) }, delay: THINK_PAUSE };
}

/**
 * Casting, as each side starts its move: every hero with a power and Will to spare weighs each power on each target it
 * could cast it at, and casts the one worth most, if it's worth the Will. Each hero thinks about it once a turn.
 */
function castStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo, catalog } = ctx;
  memo.pondered ??= [];
  // One cast at a time: the next hero waits until this one is resisted or not.
  if (state.flow.spell) return null;
  for (const m of side(state, seat)) {
    if (!m.hero || memo.pondered.includes(m.id) || !canCast(state, m, s => canActivate(state, s))) continue;
    memo.pondered.push(m.id);
    let best: { power: KnownPower; target: Model; score: number } | null = null;
    for (const power of powersOf(catalog, m)) {
      for (const t of castTargets(state, m, power.range, power.name, catalog)) {
        const score = castWorth(ctx, m, power, t);
        if (score > (best?.score ?? 0)) best = { power, target: t, score };
      }
    }
    // Worth at least half a warrior, and the Will it costs (which also keeps its Exhaustion powers going).
    if (!best || best.score < 0.6) continue;
    const will = Math.max(1, Math.min(m.will - (m.will > 2 ? 1 : 0), best.power.cv >= 5 ? 2 : 1));
    return { action: { type: 'cast', model: m.id, target: best.target.id, power: best.power.name, cv: best.power.cv, will }, delay: DICE_PAUSE };
  }
  return null;
}

/** Rough worth of casting a power at a model, in warrior-sized units, allowing for the cast failing or being resisted. */
function castWorth(ctx: Ctx, caster: Model, power: KnownPower, t: Model): number {
  const { state, seat, catalog } = ctx;
  const name = basePower(power.name);
  const enemies = side(state, other(seat));
  const friends = side(state, seat);
  const value = profile(ctx, t).value;
  const engaged = (m: Model) => engagedWith(state, m).length > 0;
  const nearFoe = (m: Model, d: number) => enemies.some(e => distanceBetween(m, e) <= d);
  const hit = (s: number, m: Model) => woundChance(s, profile(ctx, m).d) * profile(ctx, m).value / Math.max(1, m.wounds) / (m.hero && m.fate ? 2 : 1);
  const spell = { caster: caster.id, target: t.id, power: power.name, reach: 4, aim: t.id };
  const many = untargeted(power.name, power.range) || isLinePower(power.name) ? affected(state, catalog, spell) : [t];
  const foes = many.filter(x => x.owner !== seat);
  let worth = 0;
  switch (name) {
    case 'Transfix':
    case 'Paralyse':
      // Best on a dangerous enemy about to fight or act; pointless on one already held.
      if (under(state, t, 'Transfix') || under(state, t, 'Paralyse')) break;
      worth = value * (engaged(t) || nearFoe(t, 8) ? 0.6 : 0.3) * (name === 'Paralyse' ? 1.3 : 1);
      break;
    case 'Black Dart':
    case 'Flameburst':
      worth = hit(6, t);
      break;
    case 'Sorcerous Blast':
      worth = hit(5, t) + 0.1 * value;
      break;
    case 'Collapse Rocks':
      worth = hit(7, t) + 0.1 * value;
      break;
    case 'Chill Soul':
    case 'Banishment':
      worth = value / Math.max(1, t.wounds) / (t.hero && t.fate ? 2 : 1);
      break;
    case 'Panic Steed':
      worth = isCavalry(catalog, t) ? value * 0.6 : 0;
      break;
    case 'Wither':
    case 'Drain Courage':
    case 'Curse':
      worth = value * (name === 'Curse' ? (t.fate ? 0.3 : 0) : 0.2);
      break;
    case 'Compel':
      // Pulling an enemy hero or a lone model into our lines.
      worth = friends.some(f => distanceBetween(f, t) <= t.move / 2 + 0.5) ? value * 0.4 : 0;
      break;
    case 'Your Staff is Broken':
      worth = value * 0.3;
      break;
    case 'Foil Magic':
      worth = Object.values(state.models).some(o => effectsOn(state, o).some(e => e.by === t.id && e.duration === 'Exhaustion')) ? 2 : 0;
      break;
    case 'Bladewrath':
    case 'Enchant Blades':
    case 'Enrage Beast':
      // A friend about to fight.
      worth = engaged(t) || nearFoe(t, t.move + 1) ? value * (name === 'Enrage Beast' ? 0.6 : 0.4) : 0;
      break;
    case 'Renew':
      worth = t.wounds < t.maxWounds ? value / Math.max(1, t.maxWounds) : 0;
      break;
    case 'Strengthen Will':
    case 'Blessing of the Valar':
      worth = t.hero ? 0.4 : 0;
      break;
    case 'Protection of the Valar':
    case 'Fortify Spirit':
      worth = t.hero && nearFoe(t, 12) ? 0.3 * value / 4 : 0;
      break;
    case 'Aura of Command':
    case 'Fury':
      worth = armyStatus(state, seat).broken || nearFoe(caster, 8) ? friends.filter(f => distanceBetween(f, caster) <= 6).length * 0.15 : 0;
      break;
    case 'Aura of Dismay':
    case 'Instil Fear':
    case 'Terrifying Aura':
      worth = enemies.filter(e => distanceBetween(e, caster) <= (name === 'Terrifying Aura' ? 10 : 8)).length * 0.12;
      break;
    case 'Blinding Light':
      worth = enemies.some(e => profile(ctx, e).weapon && distanceBetween(e, caster) <= 24) ? 0.7 : 0;
      break;
    case 'Writhing Vines':
    case 'Fog of Disarray':
      worth = nearFoe(caster, 6) ? 0.3 : 0;
      break;
    case "Nature's Wrath":
      worth = foes.reduce((n, e) => n + 0.25 * profile(ctx, e).value, 0);
      break;
    case 'Wrath of Bruinen':
      worth = foes.reduce((n, e) => n + hit(2, e) + 0.2 * profile(ctx, e).value, 0);
      break;
    case 'Tremor':
      // Friends on the line count against it.
      worth = many.reduce((n, e) => n + (e.owner === seat ? -1.5 : 1) * (hit(4, e) + 0.2 * profile(ctx, e).value), 0);
      break;
  }
  if (worth <= 0) return 0;
  const n = Math.min(caster.will, power.cv >= 5 ? 2 : 1);
  const works = 1 - ((power.cv - 1) / 6) ** n;
  const resisted = foes.some(e => e.will > 0) ? 0.7 : 1;
  return worth * works * resisted;
}

/**
 * A Compel the computer cast: it walks the enemy as far as it may towards the nearest of its own models (into a fight,
 * if it reaches), then lets it go.
 */
function compelStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo } = ctx;
  const c = state.flow.compel;
  if (!c || state.models[c.caster]?.owner !== seat) return null;
  if (memo.compelled === c.model) return { action: { type: 'compel', compel: null }, delay: THINK_PAUSE };
  memo.compelled = c.model;
  const t = state.models[c.model];
  const near = side(state, seat).sort((a, b) => distanceBetween(t, a) - distanceBetween(t, b))[0];
  if (!t || !near) return { action: { type: 'compel', compel: null }, delay: THINK_PAUSE };
  const d = centre(t, near);
  const k = Math.max(0, (d - radius(t) - radius(near) - 0.02) / (d || 1));
  return { action: { type: 'moveModels', moves: [{ id: t.id, x: t.x + (near.x - t.x) * k, y: t.y + (near.y - t.y) * k }] }, delay: MOVE_PAUSE };
}

function shootStep(ctx: Ctx): BotStep {
  const { state, seat, memo } = ctx;
  const paused = pausedShot(ctx);
  if (paused) return paused;
  if (memo.pending?.kind === 'shot') {
    const shooter = memo.pending.model;
    const group = [...state.log].reverse().find(r => r.group?.startsWith('s-') && r.model === shooter && r.at >= memo.since)?.group;
    if (!group) {
      // The shot never came back (refused): move on.
      if ((memo.pending.tries = (memo.pending.tries ?? 0) + 1) > 3) memo.pending = undefined;
      return { delay: THINK_PAUSE };
    }
    memo.pending = undefined;
    const apply = woundsFor(ctx, group);
    if (apply) return apply;
  }
  for (const m of side(state, seat)) {
    // Not now: waiting for a hero's heroic activation to finish (or gone with one already).
    if (memo.acted.includes(m.id) || !mayActivate(state, m)) continue;
    memo.acted.push(m.id);
    const p = profile(ctx, m);
    if (!p.weapon || engagedWith(state, m).length || m.prone || cannotAct(state, m)) continue;
    if (memo.courage[m.id] === false && armyStatus(state, seat).broken) continue;
    const shot = bestShot(ctx, m);
    if (!shot || shot.value < 0.02) continue;
    memo.pending = { kind: 'shot', model: m.id };
    const t = shot.target;
    return {
      action: {
        type: 'shoot',
        shot: { shooter: { id: m.id, name: m.name, weapon: p.weapon.name, shoot: p.shoot, s: p.weapon.s, shots: 1 }, target: { id: t.id, name: t.name, d: profile(ctx, t).d }, obstacles: shot.obstacles },
      },
      delay: DICE_PAUSE,
    };
  }
  return { action: { type: 'endActivation', seat }, delay: THINK_PAUSE };
}

/**
 * A hero's shot that stopped for Might: the computer raises a die that missed by 1 (keeping a point back unless it's
 * the last roll to wound), then carries on.
 */
function pausedShot({ state, seat }: Ctx): BotStep | null {
  const p = state.flow.shotPause;
  const hero = p && state.models[p.shot.shooter.id];
  if (!p || !hero || hero.owner !== seat) return null;
  const r = state.log.filter(x => x.group === p.group).at(-1);
  const k = r?.target !== undefined ? r.dice.findIndex(d => d === r.target! - 1) : -1;
  if (r && k >= 0 && hero.might > (r.against ? 0 : 1)) return { action: { type: 'useMight', roll: r.id, die: k }, delay: DICE_PAUSE };
  return { action: { type: 'shotOn', group: p.group }, delay: DICE_PAUSE };
}

/** A challenge to one of the computer's heroes: taken up unless the challenger is clearly the better fighter. */
function challengeStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  const c = (state.flow.challenges ?? []).find(x => x.accepted === undefined && state.models[x.target]?.owner === seat);
  if (!c) return null;
  const by = state.models[c.by];
  const me = state.models[c.target];
  const accept = !by || profile(ctx, me).f + me.wounds + me.might >= profile(ctx, by).f + by.wounds + by.might - 1;
  return { action: { type: 'answerChallenge', target: c.target, accept }, delay: THINK_PAUSE };
}

/** Takes the wounds off for a fight or shot the computer's models won, once for each model struck. */
function woundsFor(ctx: Ctx, group: string): BotStep | null {
  const { state, seat } = ctx;
  const rolls = state.log.filter(r => r.group === group);
  const strikes = rolls.filter(r => r.against && r.model && state.models[r.model]?.owner === seat);
  for (const id of [...new Set(strikes.map(r => r.against!))]) {
    const victim = state.models[id];
    const at = strikes.filter(r => r.against === id);
    const wounds = strikeWounds(at);
    if (!victim || victim.dead || wounds < 1 || woundsTaken(state.flow.applied, group, id)) continue;
    const by = [...new Set(at.map(r => r.model!))];
    return { action: { type: 'wound', id, count: wounds, by, how: group.startsWith('s-') ? 'shoot' : 'fight', group }, delay: THINK_PAUSE };
  }
  return null;
}

// ——— Fighting ———

/** A fight's duel that has been rolled but not its strikes yet. */
export function openDuel(state: GameState, c: Combat, since = 0): { group: string; rolls: DiceRoll[] } | null {
  const ids = new Set([...c.p1, ...c.p2]);
  for (let i = state.log.length - 1; i >= 0 && i >= state.log.length - 40; i--) {
    const r = state.log[i];
    if (!r.group?.startsWith('f-') || r.side === undefined || !r.model || !ids.has(r.model)) continue;
    if (r.at < since) return null;
    const rolls = state.log.filter(x => x.group === r.group);
    const struck = rolls.some(duelSettled);
    return struck ? null : { group: r.group, rolls };
  }
  return null;
}

/**
 * The fight where the computer is holding off its strikes so the other player can spend Might on their own hero's
 * duel dice. The other player rolls the strikes when they're ready.
 */
export function waitingOnMight(state: GameState): string | null {
  const bot = state.bot;
  if (!bot || state.phase !== 'fight' || !state.flow.started) return null;
  const human = other(bot);
  for (const c of combats(state)) {
    if (fightDone(state, c)) continue;
    const duel = openDuel(state, c);
    if (duel && humanCanRaise(state, human, duel.rolls)) return c.key;
  }
  return null;
}

/** The player has a hero with Might in this duel whose dice could still change who wins. */
function humanCanRaise(state: GameState, human: Seat, rolls: DiceRoll[]): boolean {
  const lead = duelLeader(rolls);
  const humanSide = human === 'p1' ? 0 : 1;
  if (lead?.winner === humanSide) return false;
  return rolls.some(r => r.side === humanSide && r.model && state.models[r.model]?.hero && (state.models[r.model]?.might ?? 0) > 0 && r.dice.some(d => d < 6));
}

function fighterFor(ctx: Ctx, m: Model): Fighter {
  const p = profile(ctx, m);
  const { state } = ctx;
  // A model with a profile fights as its wargear and rules say (two-handed if it must), as the server works it out.
  if (modelStats(ctx.catalog, m)) return fighterOf(state, ctx.catalog, m, state.flow.choices?.[m.id]);
  return {
    id: m.id,
    name: m.name,
    f: p.f,
    a: p.a,
    s: declared(state, m.id, 'Heroic Strength') ? Math.min(10, p.s * 2) : p.s,
    d: p.d,
    ...(declared(state, m.id, 'Heroic Strike') ? { strike: true } : {}),
    ...(declared(state, m.id, 'Heroic Defence') ? { defence: true } : {}),
  };
}

function fightRequest(ctx: Ctx, c: Combat, duel?: DiceRoll[]): FightRequest {
  const { state, seat } = ctx;
  const ms = (s: Seat) => c[s].map(id => state.models[id]).filter(m => m && isUp(m));
  const ours = ms(seat);
  const theirs = ms(other(seat));
  // The computer strikes where it expects to do the most; the other player's strikes go at the first model, as the fight panel does.
  const pick = [...theirs].sort((a, b) => strikeWorth(ctx, ours, b) - strikeWorth(ctx, ours, a))[0];
  const targets = { [seat]: pick.id, [other(seat)]: ours[0].id } as Record<Seat, string>;
  // Spears and pikes behind the front rank join in (once the duel is rolled, just the ones that rolled in it).
  const rolled = (s: Seat) => (duel ?? []).filter(r => r.support && r.side === (s === 'p1' ? 0 : 1)).map(r => r.model!);
  const helping: Record<Seat, string[]> = duel ? { p1: rolled('p1'), p2: rolled('p2') } : supporters(state, ctx.catalog, c);
  const side = (s: Seat) => [...ms(s).map(m => fighterFor(ctx, m)), ...helping[s].map(id => state.models[id]).filter(m => m && isUp(m)).map(m => ({ ...fighterFor(ctx, m), a: 1, support: true }))];
  // A lone model beating several spreads its strikes, finishing off whoever it can before moving on.
  const aims: Record<string, string[]> = {};
  if (ours.length === 1 && theirs.length > 1) {
    const f = fighterFor(ctx, ours[0]);
    const order = [...theirs].sort((a, b) => strikeWorth(ctx, ours, b) - strikeWorth(ctx, ours, a));
    const list: string[] = [];
    for (const t of order) {
      const need = Math.max(1, Math.ceil(t.wounds / Math.max(0.15, woundChance(f.s, profile(ctx, t).d))));
      for (let i = 0; i < need && list.length < f.a; i++) list.push(t.id);
    }
    aims[ours[0].id] = list;
  }
  return { sides: [side('p1'), side('p2')], targets: [targets.p1, targets.p2], trapped: false, combat: c.key, ...(Object.keys(aims).length ? { aims } : {}) };
}

function strikeWorth(ctx: Ctx, strikers: Model[], t: Model): number {
  const d = profile(ctx, t).d;
  const wounds = strikers.reduce((n, m) => n + fighterFor(ctx, m).a * woundChance(fighterFor(ctx, m).s, d), 0);
  return (Math.min(1, wounds / Math.max(1, t.wounds)) * profile(ctx, t).value) / (t.hero && t.fate ? 1.5 : 1);
}

function fightStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo } = ctx;
  // Wounds from fights the computer won this phase, first.
  const groups = [...new Set(state.log.filter(r => r.group?.startsWith('f-') && r.at >= memo.since).map(r => r.group!))];
  for (const g of groups) {
    const raise = mightOnStrikes(ctx, g);
    if (raise) return raise;
    const apply = woundsFor(ctx, g);
    if (apply) return apply;
  }
  const heroic = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Combat').map(h => h.model));
  const open = combats(state)
    .filter(c => !fightDone(state, c) && c[seat].length && c[other(seat)].length)
    .sort((a, b) => Number([...b.p1, ...b.p2].some(id => heroic.has(id))) - Number([...a.p1, ...a.p2].some(id => heroic.has(id))));
  // Strikes for a duel already rolled come first; new fights are started only by the side with Priority.
  const c = open.find(x => openDuel(state, x, memo.since)) ?? (state.priority === seat || !state.priority ? open[0] : undefined);
  if (!c) return null;
  const duel = openDuel(state, c, memo.since);
  if (!duel) return { action: { type: 'fight', fight: fightRequest(ctx, c) }, delay: DICE_PAUSE * 1.5 };
  const raise = mightInDuel(ctx, duel.rolls);
  if (raise) return raise;
  // Hold the strikes while the other player could still use Might; they roll the strikes themselves.
  if (ctx.person && humanCanRaise(state, other(seat), duel.rolls)) return { delay: WAIT_PAUSE };
  return { action: { type: 'strikes', fight: fightRequest(ctx, c, duel.rolls), group: duel.group }, delay: DICE_PAUSE * 1.5 };
}

/** Might on the computer's own duel dice, when a point or two turns a lost duel into a won one. */
function mightInDuel(ctx: Ctx, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  const us = seat === 'p1' ? 0 : 1;
  const lead = duelLeader(rolls);
  if (lead?.winner === us) return null;
  const duel = rolls.filter(r => r.side !== undefined && r.f !== undefined);
  const theirBest = Math.max(0, ...duel.filter(r => r.side !== us).flatMap(r => r.dice));
  const ourF = Math.max(0, ...duel.filter(r => r.side === us).map(r => r.f!));
  const theirF = Math.max(0, ...duel.filter(r => r.side !== us).map(r => r.f!));
  // Equal dice go to the higher Fight, so matching their best die is enough when we have it.
  const need = theirBest + (ourF > theirF ? 0 : 1);
  if (need > 6 && !(theirBest === 6 && ourF === theirF)) return null;
  const goal = Math.min(6, need);
  const stake = duel.filter(r => r.side !== us).length + (duel.some(r => r.side === us && r.model && state.models[r.model]?.hero) ? 2 : 0);
  for (const r of duel.filter(x => x.side === us && x.model)) {
    const hero = state.models[r.model!];
    if (!hero?.hero || hero.might < 1) continue;
    const top = Math.max(...r.dice);
    const cost = goal - top;
    if (cost < 1 || cost > hero.might || cost > (stake >= 3 ? 3 : 2)) continue;
    return { action: { type: 'useMight', roll: r.id, die: r.dice.indexOf(top) }, delay: DICE_PAUSE };
  }
  return null;
}

/** Might on a strike die one short, when that extra wound kills the target. */
function mightOnStrikes(ctx: Ctx, group: string): BotStep | null {
  const { state, seat } = ctx;
  const rolls = state.log.filter(r => r.group === group);
  const strikes = rolls.filter(r => r.against && r.target && r.then === undefined && r.model && state.models[r.model]?.owner === seat);
  if (!strikes.length) return null;
  const victim = state.models[strikes[0].against!];
  if (!victim || victim.dead || woundsTaken(state.flow.applied, group, victim.id)) return null;
  // Against Heroic Defence only natural 6s wound, so Might is no help.
  if (declared(state, victim.id, 'Heroic Defence')) return null;
  const wounds = strikeWounds(rolls);
  if (wounds >= victim.wounds || wounds + 1 < victim.wounds) return null;
  for (const r of strikes) {
    const hero = state.models[r.model!];
    if (!hero?.hero || hero.might < (victim.hero ? 1 : 2)) continue;
    const k = r.dice.findIndex(d => d === r.target! - 1);
    if (k >= 0) return { action: { type: 'useMight', roll: r.id, die: k }, delay: DICE_PAUSE };
  }
  return null;
}

