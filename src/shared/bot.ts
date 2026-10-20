import { mounted } from './cavalry.ts';
import { placingNow } from './placing.ts';
import { woundNeed } from './rules.ts';
import { hasFryingPan, longshanksFree, pannable } from './sam.ts';
import { breachOptions } from './breach.ts';
import { gateStanding, HEAVY, ladderable, nearestEdge, overThe, TOWER, towerMove } from './fortress.ts';
import { hurlOptions } from './defenders.ts';
import { modelStats, rulesFor, type Catalog } from './catalog.ts';
import { fighterOf } from './wargear.ts';
import { duelLeader, duelSettled, fightDuel, strikeWounds, woundsTaken, type BrutalAttack, type Fighter, type FightRequest } from './fight.ts';
import { supporters } from './support.ts';
import { activeSeat, combats, CONTACT_SLACK, other, type Combat } from './flow.ts';
import { distanceBetween, halfExtents, mmToIn, type Point } from './geometry.ts';
import { heroicBlocked, mightBlocked } from './mightUse.ts';
import { canActivate, canDeclare, declared, heroicInfo, heroicTurn, heroicsSettled, mayActivate, orderRollLabel, orderRollNeeded, phaseHeroics } from './heroics.ts';
import { canCast, castTargets, pendingSpell, powersOf, untargeted, type KnownPower } from './magic.ts';
import { brutalOptions } from './monsters.ts';
import { fightDone, limitMove, moveAllowance, moveLeft } from './movement.ts';
import { affected, basePower, cannotAct, effectsOn, isCavalry, isLinePower, under } from './powers.ts';
import { carriedBy, exitEdges, markerActions, onTable, sanctuary, touching as touchingMarker } from './objects.ts';
import { reaches as reachesFoe, touching as touchingFoe } from './barriers.ts';
import { chance, fightOdds, woundChance, type Side } from './odds.ts';
import { PICKS, pickOptions } from './picks.ts';
import { scoreLines } from './scoring.ts';
import { seekTargets } from './ring.ts';
import { climbedLevel, flooredAt, floorHeight, heightOf } from './sight.ts';
import { planShot, weaponFor } from './shooting.ts';
import { atCrossing, crossBlocked, fallingHits } from './terrainTests.ts';
import { armyStatus } from './status.ts';
import { pushers } from './siege.ts';
import { chargeAim, chargesDue, straightOn } from './trample.ts';
import { arrivalAuto, arrivalDue, castModel, mayCry } from './narrative.ts';
import { courageOf, willOfEvil } from './courage.ts';
import { hasMorgulBlade } from './morgul.ts';
import { AXE_FREED, canHeadbutt, hasMattock, longbeardFor, mayAxeTest, mayTend, rerollFor, spentPoints, swapPair, trumpetDue } from './company.ts';
import { fitsSack, keepsForLater, lingeringCold } from './trolls.ts';
import { canThrowBrand, FLAMING_BRAND } from './shooting.ts';
import { byCulvert, charges, CULVERT, culvertWall, deepingDown, detonateOptions, helmsGate, isHelms, mayChooseRelief, raiseLadderTargets, RELIEF_SPAN, RELIEF_TURN, rideOutBlocked } from './helms.ts';
import { inHornburg, onDeepingWall } from './helmsMap.ts';
import { deadlyShot, shotsPerPhase, shotsTaken, unsteady } from './towers.ts';
import { distanceToTerrain } from './sight.ts';
import { hasRule } from './wargear.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

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
  /** Every Wound left on the table as the turn began, and how many turns in a row that hasn't changed: a standoff. */
  health?: number;
  quiet?: number;
  /** Steps spent waiting for the other player to drive a Stampede this phase. */
  waits?: number;
}

export const newMemo = (): BotMemo => ({ key: '', turn: 0, since: 0, acted: [], moved: {}, courage: {}, steps: 0 });

/** The next thing the computer does: an action to send, then how long to pause before thinking again. */
export interface BotStep {
  action?: Action;
  delay: number;
}

/** The Palantír speed setting shortens every pause between the computer's steps (and its waits for the player). */
export const BOT_PACE = { normal: 1, fast: 0.35, instant: 0.05 };
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
    // In Weathertop, Frodo is the whole game.
    value: worth(m) * (m.cast === 'frodo' && ctx.state.narrative?.id === 'weathertop' ? 6 : 1),
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
  Object.assign(memo, { key, turn: state.turn, since: now - 50, acted: [], steps: 0, pending: undefined, pondered: [], tested: [], waits: 0 }, newTurn ? { moved: {}, courage: {} } : {});
  if (newTurn) {
    const health = Object.values(state.models).reduce((n, m) => n + (m.dead ? 0 : m.wounds + (m.mountWounds ?? 0)), 0);
    memo.quiet = memo.health === health ? (memo.quiet ?? 0) + 1 : 0;
    memo.health = health;
  }
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
  // A model waiting to be placed: the game already put it where the computer would, so it just says so.
  const place = placingNow(state);
  if (place) return place.seat === seat ? { action: { type: 'placed', seat }, delay: THINK_PAUSE } : null;
  // Playing the Hobbits at Weathertop, the computer always rolls for Aragorn when it may.
  if (arrivalDue(state)) return seat === state.narrative?.good && !arrivalAuto(state) ? { action: { type: 'aragorn', roll: true }, delay: DICE_PAUSE } : null;
  const spell = spellStep(ctx) ?? compelStep(ctx);
  if (spell) return spell;
  if (++memo.steps > MAX_STEPS) return finish(ctx);
  return fateStep(ctx) ?? challengeStep(ctx) ?? (state.flow.shotPause ? pausedShot(ctx) : null) ?? companyStep(ctx) ?? phaseStep(ctx);
}

function phaseStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  const relief = reliefStep(ctx);
  if (relief) return relief;
  switch (state.phase) {
    case 'priority':
      return priorityStep(ctx);
    case 'move':
    case 'shoot':
    case 'fight': {
      // The Cry of the Nazgûl comes as the Move phase begins, whichever side moves first.
      if (state.phase === 'move' && wantsCry(ctx)) return { action: { type: 'cry', seat }, delay: THINK_PAUSE };
      if (heroicTurn(state) === seat) return heroicStep(ctx);
      if (!heroicsSettled(state)) return null;
      if (orderRollNeeded(state) && state.priority === seat && !state.log.some(r => r.label === orderRollLabel(state))) {
        return { action: { type: 'roll', count: 1, label: orderRollLabel(state) }, delay: DICE_PAUSE };
      }
      if (state.phase === 'fight') return fightStep(ctx);
      if (activeSeat(state) !== seat) return state.phase === 'move' ? stampedeStep(ctx) : null;
      return state.phase === 'move' ? moveStep(ctx) : shootStep(ctx);
    }
    default:
      return null;
  }
}

/**
 * The other player's war beast Stampeding in their move: the computer drives it, off the table if it can get there
 * (it's lost with everyone riding it), or else into the thick of its own side.
 */
function stampedeStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo } = ctx;
  const beast = chargesDue(state, ctx.catalog, other(seat)).find(m => m.stampede && !memo.acted.includes(m.id));
  if (!beast) return null;
  memo.acted.push(beast.id);
  const { w, h } = state.board;
  const edges = [{ x: beast.x, y: -5 }, { x: beast.x, y: h + 5 }, { x: -5, y: beast.y }, { x: w + 5, y: beast.y }];
  const edge = edges.sort((a, b) => centre(beast, a) - centre(beast, b))[0];
  const near = Math.min(beast.x, beast.y, w - beast.x, h - beast.y);
  const own = side(state, beast.owner).filter(m => m.id !== beast.id && !m.aboard);
  const crowd = (p: Point) => own.filter(m => centre(m, p) <= 3).length;
  const target = near <= beast.move ? edge : [...own].sort((a, b) => crowd(b) - crowd(a) || centre(beast, a) - centre(beast, b))[0];
  return { action: { type: 'trample', id: beast.id, x: target?.x ?? edge.x, y: target?.y ?? edge.y }, delay: DICE_PAUSE };
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
    // Give the other player a moment to roll it themselves (none at Instant speed).
    const wait = 2500 * BOT_PACE[state.botSpeed ?? 'normal'];
    return now - memo.since < wait ? { delay: wait + 100 - (now - memo.since) } : { action: { type: 'rollPriority' }, delay: DICE_PAUSE };
  }
  if (f.chooser !== seat || state.priority) return null;
  // The other side's Balin may yet have the roll made again.
  if (longbeardFor(state, ctx.catalog, other(seat))) return { delay: WAIT_PAUSE };
  // Moving first is worth it when the armies are close enough to charge; otherwise let the enemy show its hand.
  const ours = side(state, seat);
  const theirs = side(state, other(seat));
  const close = ours.some(m => theirs.some(e => distanceBetween(m, e) <= Math.max(m.move, e.move) * 2 + 1));
  return { action: { type: 'choosePriority', seat: close ? seat : other(seat) }, delay: THINK_PAUSE };
}

/** The Cry of the Nazgûl, once Aragorn is here anyway (or late in the game): it would only bring him sooner. */
function wantsCry(ctx: Ctx): boolean {
  const { state, seat } = ctx;
  if (!mayCry(state, seat)) return false;
  const aragorn = castModel(state, 'aragorn');
  return !aragorn || !aragorn.waiting || state.turn >= 4;
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
    // (Held to what the player is: only an action it can use now.)
    const has = (name: string) => (heroicInfo(name)?.universal || p.heroics.includes(name)) && !heroicBlocked(state, ctx.catalog, h, name);
    const ids = (s: Seat) => fight[s].map(id => state.models[id]).filter(Boolean);
    const odds = fightOdds(fighterSide(ctx, ids(seat)), fighterSide(ctx, ids(other(seat))));
    const declare = (action: string): BotStep => ({ action: { type: 'declareHeroic', model: h.id, action }, delay: DICE_PAUSE });
    // Sam goes to Frodo's aid for nothing, whenever he can.
    if (longshanksFree(state, h)) return declare('Heroic Combat');
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

  // A model that could reach an Invisible foe tests to charge it first (once a turn each).
  for (const m of side(state, seat)) {
    if (memo.acted.includes(m.id)) continue;
    const t = seekTargets(state, ctx.catalog, m).find(x => x.need <= 12 && centre(m, x.target) <= (moveAllowance(state, m) ?? 6) + 1);
    if (t) return { action: { type: 'seek', id: m.id, target: t.target.id }, delay: DICE_PAUSE };
  }

  const cast = castStep(ctx);
  if (cast) return cast;
  const ride = rideOutStep(ctx);
  if (ride) return ride;

  const broken = armyStatus(state, seat).broken;
  const enemies = side(state, other(seat));
  const nearest = (m: Model) => Math.min(...enemies.map(e => centre(m, e)), 999);
  // War beasts and chariots go first, at the nearest enemy (a Stampede of its own bolts where a die sends it).
  for (const m of chargesDue(state, ctx.catalog, seat)) {
    if (memo.acted.includes(m.id)) continue;
    // A Stampede is the other player's to drive: give them a while to, before a die picks the way.
    if (m.stampede && ctx.person && (memo.waits = (memo.waits ?? 0) + 1) <= 20) return { delay: WAIT_PAUSE };
    memo.acted.push(m.id);
    const to = m.stampede ? straightOn(m) : chargeAim(state, ctx.catalog, m);
    return { action: { type: 'trample', id: m.id, ...to }, delay: DICE_PAUSE };
  }
  // Our siege tower, with enough hands on it, is pushed at the nearest wall.
  for (const t of Object.values(state.terrain).filter(t => t.kind === 'tower' && !t.gone && !t.raised && t.side === seat)) {
    if ((memo.tested ??= []).includes(`t:${t.id}`)) continue;
    memo.tested.push(`t:${t.id}`);
    const to = towerAim(state, t);
    if (to && towerMove(state, t, seat, to, x => engagedWith(state, x).length > 0)) return { action: { type: 'pushTower', id: t.id, seat, x: to.x, y: to.y }, delay: MOVE_PAUSE };
  }
  // A siege engine with nothing in its Arc of Sight turns to face the best target it could shoot instead.
  for (const m of side(state, seat).filter(x => x.siege && !memo.acted.includes(x.id))) {
    memo.acted.push(m.id);
    const turn = engineTurn(ctx, m);
    if (turn !== undefined) return { action: { type: 'moveModels', moves: [{ id: m.id, x: m.x, y: m.y, rot: turn }] }, delay: MOVE_PAUSE };
  }
  // Models that can charge go first, nearest the enemy leading, so others can join their fights; then the rest
  // from the back forward, so the line closes up rather than strings out.
  const reach = (m: Model) => nearest(m) <= m.move + 2;
  // Those hauling siege gear go last, once the ranks in front of them have moved out of the way, and those helping
  // carry it after them, to take hold of it again where it was set down.
  const heavy = onTable(state).filter(t => (t.object === 'ladder' || t.object === 'ram' || t.object === 'charge') && t.carrier && state.models[t.carrier]?.owner === seat);
  const hauling = (m: Model) => (heavy.some(t => t.carrier === m.id) ? 1 : heavy.some(t => touchingMarker(m, t)) ? 2 : 0);
  // A siege engine doesn't move itself, and its crew stay beside it to shoot it.
  const queue = side(state, seat)
    .filter(m => !memo.acted.includes(m.id) && !m.siege && !(m.crewOf && state.models[m.crewOf] && !state.models[m.crewOf].dead))
    .sort((a, b) => Number(hauling(a)) - Number(hauling(b)) || Number(reach(b)) - Number(reach(a)) || (reach(a) ? nearest(a) - nearest(b) : nearest(b) - nearest(a)));
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
    const goal = goals.get(m.id);
    if (goal?.foot && mounted(m) && centre(m, goal.at) <= 6 && !(memo.tested ??= []).includes(`d:${m.id}`)) {
      memo.tested.push(`d:${m.id}`);
      return { action: { type: 'dismount', id: m.id }, delay: DICE_PAUSE };
    }
    memo.acted.push(m.id);
    const to = planMove(ctx, m, goal);
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
  // Our Ringbearer is in Sauron's grip: the other side moves it before our move can end.
  const grip = state.flow.compel?.ring ? state.models[state.flow.compel.model] : undefined;
  if (grip?.owner === seat) return { delay: WAIT_PAUSE };
  return { action: { type: 'endActivation', seat }, delay: THINK_PAUSE };
}

function courageTest(ctx: Ctx, m: Model, label: string): BotStep {
  ctx.memo.pending = { kind: 'courage', model: m.id };
  return { action: { type: 'roll', count: 2, sum: courageOf(ctx.state, ctx.catalog, m), label, model: m.id }, delay: DICE_PAUSE };
}

/** The model's latest roll this phase whose label starts with `prefix`. */
function latestRoll(ctx: Ctx, model: string, prefix: string): DiceRoll | undefined {
  return [...ctx.state.log].reverse().find(r => r.model === model && r.label.startsWith(prefix) && r.at >= ctx.memo.since);
}

/** Picking up, turning over, digging up or carrying off markers once a model has moved. */
function markerStep(ctx: Ctx, m: Model): BotStep | null {
  const { state } = ctx;
  if (!isUp(m)) return null;
  // A defender on the walls pushes down any ladder it can reach.
  const push = breachOptions(state, ctx.catalog, m).find(b => b.how === 'push');
  if (push) return { action: { type: 'breach', how: 'push', model: m.id, target: push.target }, delay: DICE_PAUSE };
  for (const a of markerActions(state, m)) {
    if (a.kind === 'drop') continue;
    // Only its own side's ladders and rams are worth hauling about.
    const object = a.marker ? state.terrain[a.marker] : undefined;
    if (a.kind === 'pickUp' && (object?.object === 'ladder' || object?.object === 'ram') && object.side !== m.owner) continue;
    // A Demolition Team keeps to its own charge, and leaves it to the team while the team is there to carry it.
    const team = (x: Model) => !!x.torch || x.cast === 'engineer';
    if (a.kind === 'pickUp' && (object?.object === 'ladder' || object?.object === 'ram') && team(m)) continue;
    if (a.kind === 'pickUp' && object?.object === 'charge' && !team(m) && side(state, m.owner).some(x => team(x) && centre(x, object) <= 3)) continue;
    // A charge already where it is going stays put, to be lit.
    if (a.kind === 'pickUp' && object?.object === 'charge') {
      const goal = chargeGoal(state, object, m.owner);
      if (goal && centre(object, goal.at) <= 1) continue;
    }
    // Rocks and oil are thrown from where they stand.
    if (a.kind === 'pickUp' && (object?.object === 'rocks' || object?.object === 'oil')) continue;
    if (a.kind === 'escape') {
      // Leave the table with something worth carrying off, or in a scenario that scores getting models away.
      if (carriedBy(state, m).length || state.scenario === 'reconnoitre') return { action: { type: 'escape', model: m.id }, delay: MOVE_PAUSE };
      continue;
    }
    if (a.kind === 'uncover') return { action: { type: 'uncover', model: m.id, marker: a.marker!, intelligence: profile(ctx, m).i }, delay: DICE_PAUSE };
    return { action: { type: a.kind, model: m.id, marker: a.marker! }, delay: MOVE_PAUSE };
  }
  // An archer in a building with floors climbs as high as it can while still able to shoot.
  const t = profile(ctx, m).weapon && !mounted(m) && !m.prone ? flooredAt(state, m) : undefined;
  const left = t ? moveLeft(state, m) : null;
  if (t && left !== null) {
    const used = m.move - left;
    for (let to = t.floors ?? 0; to > (m.floor ?? 0); to--) {
      const cost = floorHeight(t, to) - floorHeight(t, m.floor ?? 0);
      if (cost <= left + 1e-6 && used + cost <= m.move / 2 + 1e-6) return { action: { type: 'climb', id: m.id, floor: to }, delay: MOVE_PAUSE };
    }
  }
  return null;
}

interface Goal {
  at: Point;
  /** How much getting closer is worth, per inch. */
  pull: number;
  /** Stop this far short (to guard a marker rather than stand on it). */
  near?: number;
  /** A rider sent where only those on foot can do the job, so it gets down when it's close. */
  foot?: boolean;
  /** Going in whatever the danger (Helm's Deep's Relief Force, riding to the rescue, and the Demolition Teams). */
  bold?: boolean;
  /** Never sitting still: with nothing better, it moves on as far as it can (the Relief Force). */
  ride?: boolean;
  /** Keeps this far back from the foot of these walls (where the ladders and charges need room to get in). */
  holdOff?: { from: Terrain[]; by: number; lanes: [Point, Point][] };
}

/**
 * Sends models after what the scenario is about: objectives to hold, markers to find, pick up or destroy, enemy
 * carriers to stop, and for a model carrying something, the way off the table or to safety.
 */
/** Which way an engine should turn to get a shot it hasn't got as it faces now; undefined to leave it be. */
function engineTurn(ctx: Ctx, m: Model): number | undefined {
  if (!pushers(ctx.state, m) || bestShot(ctx, m)) return undefined;
  const turned = (rot: number): GameState => ({ ...ctx.state, models: { ...ctx.state.models, [m.id]: { ...m, rot } } });
  let best: { rot: number; value: number } | undefined;
  for (const e of side(ctx.state, other(m.owner))) {
    const rot = (facing(m, e) + 360) % 360;
    const shot = bestShot(ctx, { ...m, rot }, turned(rot));
    if (shot && (!best || shot.value > best.value)) best = { rot, value: shot.value };
  }
  return best?.rot;
}

/**
 * Where a friend helping carry a ladder or ram stands: beside the carrier on the load's side, square to the way it's
 * going, so it shares the weight without standing in the carrier's path.
 */
function besideLoad(carrier: Model, load: Terrain, to: Point | undefined): Point {
  if (!to) return carrier;
  const d = Math.hypot(to.x - carrier.x, to.y - carrier.y) || 1;
  const dir = { x: (to.x - carrier.x) / d, y: (to.y - carrier.y) / d };
  const side = (load.x - carrier.x) * -dir.y + (load.y - carrier.y) * dir.x >= 0 ? 1 : -1;
  const k = radius(carrier) * 2 + 0.05;
  return { x: carrier.x - dir.y * side * k, y: carrier.y + dir.x * side * k };
}

/** Where a siege tower should be pushed: the nearest point on the nearest tall wall. */
function towerAim(state: GameState, t: Terrain): Point | undefined {
  const walls = Object.values(state.terrain).filter(w => ladderable(w) && (w.sheer || heightOf(w) > 2));
  return walls.map(w => nearestEdge(w, t)).sort((a, b) => centre(t, a) - centre(t, b))[0];
}

function assignGoals(ctx: Ctx): Map<string, Goal> {
  const { state, seat } = ctx;
  const out = new Map<string, Goal>();
  const ours = side(state, seat).filter(m => !engagedWith(state, m).length);
  const cavalry = (m: Model) => mounted(m);
  const { w, h } = state.board;

  // Carriers first: off the table where that scores, to a Sanctuary with the wounded, otherwise back to safety.
  // A Siege Ladder goes to the nearest wall before the enemy, a ram to the enemy's gate.
  const gates = Object.values(state.terrain).filter(t => gateStanding(t) && t.side && t.side !== seat);
  const walls = Object.values(state.terrain).filter(t => ladderable(t) && (t.sheer || heightOf(t) > 2));
  // (A ladder goes where the foot of the wall is clear: along it from the nearest point, past friends already there.)
  const freeEdge = (m: Model, x: Terrain): Point => {
    const a = (x.rot * Math.PI) / 180;
    const along = x.w >= x.h ? { x: Math.cos(a), y: Math.sin(a) } : { x: -Math.sin(a), y: Math.cos(a) };
    const crowd = side(state, seat).filter(f => f.id !== m.id && centre(f, m) < 10);
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const q = nearestEdge(x, { x: m.x + along.x * k * 1.2, y: m.y + along.y * k * 1.2 });
      if (!crowd.some(f => centre(f, q) < radius(f) + radius(m))) return q;
    }
    return nearestEdge(x, m);
  };
  const heavyGoal = (m: Model, t: Terrain): Goal | undefined => {
    if (t.object === 'charge') return chargeGoal(state, m, seat);
    const to = (t.object === 'ram' ? gates.map(x => nearestEdge(x, m)) : walls.map(x => freeEdge(m, x))).sort((a, b) => centre(m, a) - centre(m, b))[0];
    return to && { at: to, pull: 1.2 };
  };
  const lanes: [Point, Point][] = [];
  for (const m of ours) {
    const carried = carriedBy(state, m);
    if (!carried.length) continue;
    const gear = carried.find(t => t.object === 'ladder' || t.object === 'ram' || t.object === 'charge');
    const goal = gear && heavyGoal(m, gear);
    if (goal) {
      out.set(m.id, goal);
      if (gear.object !== 'ram') lanes.push([{ x: m.x, y: m.y }, goal.at]);
      continue;
    }
    const edges = exitEdges(state, m);
    const spots: Point[] = edges.map(e => (e === 'top' ? { x: m.x, y: 0 } : e === 'bottom' ? { x: m.x, y: h } : e === 'left' ? { x: 0, y: m.y } : { x: w, y: m.y }));
    if (carried.some(t => t.object === 'ally')) spots.push(...sanctuary(state, seat).map(z => (z.shape === 'quarter-circle' ? { x: z.cx === 0 ? 3 : w - 3, y: z.cy === 0 ? 3 : h - 3 } : { x: w / 2, y: h / 2 })));
    if (!spots.length) spots.push({ x: m.x, y: seat === 'p1' ? h - 2 : 2 });
    const at = spots.sort((a, b) => centre(m, a) - centre(m, b))[0];
    out.set(m.id, { at, pull: 1.2 });
  }

  const wants: { at: Point; need: number; pull: number; near?: number; infantry?: boolean; team?: boolean }[] = [];
  // Our siege tower: a crew behind it to push it at the walls, then climbers up its ramp.
  for (const t of Object.values(state.terrain).filter(t => t.kind === 'tower' && !t.gone && t.side === seat)) {
    const wall = t.raised ? state.terrain[t.raised] : undefined;
    if (wall) {
      wants.push({ at: overThe(wall, t), need: 4, pull: 1, infantry: true });
      continue;
    }
    const to = towerAim(state, t);
    // (Only worth it with enough on foot to push it and still fight.)
    if (!to || ours.filter(m => !cavalry(m)).length < TOWER.crew + 4) continue;
    const d = Math.hypot(to.x - t.x, to.y - t.y) || 1;
    const back = { x: t.x - ((to.x - t.x) / d) * (Math.max(t.w, t.h) / 2 + 0.5), y: t.y - ((to.y - t.y) / d) * (Math.max(t.w, t.h) / 2 + 0.5) };
    wants.push({ at: back, need: TOWER.crew + 1, pull: 1.1, infantry: true });
  }
  for (const t of onTable(state)) {
    if (t.object === 'charge') {
      // A Demolition Charge: its team carries it to the culvert (or, that blown, an enemy gate), its torch beside it.
      if (t.side !== seat || !chargeGoal(state, t, seat)) continue;
      const c = t.carrier ? state.models[t.carrier] : undefined;
      if (c) wants.push({ at: besideLoad(c, t, chargeGoal(state, c, seat)?.at), need: 1, pull: 1.1, infantry: true, team: true });
      else wants.push({ at: t, need: 2, pull: 1, infantry: true, team: true });
      continue;
    }
    if (t.object === 'ladder' || t.object === 'ram') {
      // Our own siege gear: hands to carry it (and a ram's second pair to share the load), then climbers up a raised
      // ladder, over the top.
      if (t.side !== seat) continue;
      const c = t.carrier ? state.models[t.carrier] : undefined;
      const wall = t.raised ? state.terrain[t.raised] : undefined;
      if (wall) wants.push({ at: overThe(wall, t), need: 4, pull: 1, infantry: true });
      else if (c) wants.push({ at: besideLoad(c, t, (t.object === 'ram' ? gates : walls).map(x => nearestEdge(x, c)).sort((a, b) => centre(c, a) - centre(c, b))[0]), need: t.object === 'ram' ? 2 : 1, pull: 1.1, infantry: true });
      else if (t.object === 'ram' ? gates.length : walls.length) wants.push({ at: t, need: t.object === 'ram' ? 3 : 2, pull: 0.9, infantry: true });
      continue;
    }
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
  const teamRank = (m: Model) => (m.torch ? 2 : m.cast === 'engineer' ? 1 : 0);
  for (const want of wants) {
    // (Its own team: those beside the charge, not another team's torch from down the line.)
    const rankBy = (m: Model) => (centre(m, want.at) <= 4 ? teamRank(m) : 0);
    const takers = free
      .filter(m => !out.has(m.id) && (!want.infantry || !cavalry(m)))
      // (A Demolition Team carries its own charge: the torch-bearer, so it is touching it when it's time to light it,
      // and its engineers.)
      .sort((a, b) => (want.team ? rankBy(b) - rankBy(a) : 0) || centre(a, want.at) - centre(b, want.at))
      .slice(0, want.need);
    // (A Demolition Team keeps to its charge under the defenders' arrows.)
    for (const m of takers) out.set(m.id, { at: { x: want.at.x, y: want.at.y }, pull: want.pull, near: want.near, ...(want.team ? { bold: true } : {}) });
    // With nobody on foot to spare, a rider goes and dismounts to do it.
    if (want.infantry && takers.length < want.need) {
      const riders = free.filter(m => !out.has(m.id) && cavalry(m)).sort((a, b) => centre(a, want.at) - centre(b, want.at));
      for (const m of riders.slice(0, want.need - takers.length)) out.set(m.id, { at: { x: want.at.x, y: want.at.y }, pull: want.pull, foot: true });
    }
  }

  // Weathertop: the Nazgûl hunt Frodo; the Hobbits keep by him, and Aragorn goes for whichever is closest to him.
  if (state.narrative?.id === 'weathertop') {
    const frodo = castModel(state, 'frodo');
    if (frodo && !frodo.dead) {
      const hunters = side(state, other(seat)).filter(e => e.owner !== frodo.owner);
      for (const m of ours) {
        if (out.has(m.id)) continue;
        if (m.owner !== frodo.owner) out.set(m.id, { at: { x: frodo.x, y: frodo.y }, pull: 1.2 });
        else if (m.cast === 'aragorn') {
          const foe = [...side(state, other(seat))].sort((a, b) => centre(a, frodo) - centre(b, frodo))[0];
          if (foe) out.set(m.id, { at: { x: foe.x, y: foe.y }, pull: 1 });
        } else if (m.id !== frodo.id) out.set(m.id, { at: { x: frodo.x, y: frodo.y }, pull: 0.8, near: 1.2 });
        else if (hunters.length) out.set(m.id, { at: { x: state.board.w / 2, y: state.board.h / 2 }, pull: 0.3 });
      }
    }
  }

  // Helm's Deep: the Relief Force rides for the enemy, the Demolition Teams first, and the rest of the attackers make
  // for the walls (once the Deeping Wall is breached, the gap in it).
  if (isHelms(state)) {
    const foes = side(state, other(seat));
    const good = seat === state.narrative?.good;
    const taken = new Map<string, number>();
    for (const m of ours) {
      if (out.has(m.id)) continue;
      if (good && cavalry(m)) {
        // Each its own target, so they spread along the enemy's back rather than queue behind the first: the nearest,
        // the gear carriers first, less any that others are already riding at.
        const cost = (e: Model) => centre(m, e) - (carriedBy(state, e).length ? 20 : 0) + 4 * (taken.get(e.id) ?? 0);
        const foe = [...foes].sort((a, b) => cost(a) - cost(b))[0];
        if (foe) {
          taken.set(foe.id, (taken.get(foe.id) ?? 0) + 1);
          out.set(m.id, { at: { x: foe.x, y: foe.y }, pull: 1.5, bold: true, ride: true });
        }
      } else if (!good && !m.siege && !m.crewOf && !m.torch && !cavalry(m)) {
        // (Short of the walls until a ladder is up, and clear of the culvert, where the charges are going.)
        const gap = deepingDown(state) ? { x: CULVERT.x - 4, y: CULVERT.y } : undefined;
        const to = gap ?? walls.filter(x => x.id !== culvertWall(state)?.id).map(x => nearestEdge(x, m)).sort((a, b) => centre(m, a) - centre(m, b))[0];
        if (to && (gap || Math.hypot(to.x - CULVERT.x, to.y - CULVERT.y) > 5)) out.set(m.id, { at: to, pull: 0.5, near: gap ? 0 : 3, ...(gap ? {} : { holdOff: { from: walls, by: 2.5, lanes } }) });
      }
    }
  }

  // A torch with no charge to carry goes with the nearest of ours, to set it off.
  for (const m of ours.filter(x => x.torch && !out.has(x.id))) {
    const charge = charges(state).filter(t => t.side === seat).sort((a, b) => centre(m, a) - centre(m, b))[0];
    if (charge) out.set(m.id, { at: { x: charge.x, y: charge.y }, pull: 1.1, near: 0.6 });
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
      // And round whatever is in the way: either side of the straight line to it.
      const aim = Math.atan2(goal.at.x - from.x, -(goal.at.y - from.y));
      const go = Math.min(mv, d - stop);
      for (const off of [0.5, -0.5, 1, -1]) spots.push({ at: reach({ x: from.x + Math.sin(aim + off) * go, y: from.y - Math.cos(aim + off) * go }) });
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
      // (Only where it can actually fight it: not at the foot of a wall with the enemy up on top, say.)
      if (centre(got, at) < 1e-3 && touchingFoe(state, { ...m, ...at }, e)) spots.push({ at, charge: e });
    }
  }

  // Éomer, in his grief for Théoden, charges whenever he can.
  if (grieving(ctx, m) && spots.some(s => s.charge)) spots.splice(0, spots.length, ...spots.filter(s => s.charge));
  const before = scoreFor(ctx, m, from);
  let best: { at: Point; score: number; charge?: Model } = { at: from, score: before.score };
  const vpBefore = before.vp;
  for (const s of spots) {
    if (!fits(ctx, m, s.at, s.charge)) continue;
    const sc = scoreFor(ctx, m, s.at, goal, vpBefore);
    if (sc.score > best.score + 0.05) best = { at: s.at, score: sc.score, charge: s.charge };
  }
  // Riding to the rescue, it doesn't sit where it came on: with nothing better, it rides on as far as it can.
  if (goal?.ride && centre(best.at, from) < 0.05) {
    const far = spots.filter(s => centre(s.at, from) >= mv / 2 && fits(ctx, m, s.at, s.charge)).map(s => ({ ...s, score: scoreFor(ctx, m, s.at, goal, vpBefore).score }));
    const pick = far.sort((a, b) => b.score - a.score)[0];
    if (pick) best = pick;
  }
  if (centre(best.at, from) < 0.05) return null;
  const look = best.charge ?? [...enemies].sort((a, b) => centre(best.at, a) - centre(best.at, b))[0];
  return { at: best.at, rot: look ? facing(best.at, look) : m.rot };
}

/** How far a point is from the line between two others. */
function lineGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Whether a model can stand at `at`: on the table, clear of other bases, and out of enemy control zones unless fighting. */
function fits(ctx: Ctx, m: Model, at: Point, charge?: Model): boolean {
  const { state } = ctx;
  const { rx, ry } = halfExtents(m.base);
  if (at.x - rx < 0 || at.y - ry < 0 || at.x + rx > state.board.w || at.y + ry > state.board.h) return false;
  // (A charger turns to face its target, as the move it is given does: a long base meets it end on.)
  const here = { ...m, ...at, ...(charge ? { rot: facing(at, charge) } : {}) };
  const r = radius(m);
  for (const o of Object.values(state.models)) {
    if (o.id === m.id || !isUp(o) || Math.abs(o.x - at.x) > 6 || Math.abs(o.y - at.y) > 6) continue;
    // Bases mustn't overlap: round ones by their centres, others by their outlines pulled in a little so touching is fine.
    if (here.base.shape === 'round' && o.base.shape === 'round' ? centre(at, o) < (r + radius(o)) * 0.95 : distanceBetween(shrink(here), shrink(o)) === 0) return false;
    // (Charging one enemy, it may end beside others: it's in the fight, so their control zones no longer hold it.)
    if (o.owner !== m.owner && !charge) {
      const d = distanceBetween(here, o);
      if (d > CONTACT_SLACK && d < 1 && reachesFoe(state, here, o)) return false;
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
    // Friends already fighting them, and those yet to move this turn who could still join in.
    const helpers = friends.filter(f => foes.some(e => distanceBetween(f, e) <= CONTACT_SLACK || (!ctx.memo.acted.includes(f.id) && !engagedWith(after, f).length && !f.siege && distanceBetween(f, e) <= f.move - 0.5)));
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
      // (One up on a wall's walkway won't come down to it, nor one below get up to it, without steps or a ladder.)
      if (Math.abs(climbedLevel(state, e) - climbedLevel(state, at)) > 2) continue;
      const o = fightOdds(fighterSide(ctx, [here]), fighterSide(ctx, [e]));
      danger += Math.min(0, o.score) * (engagedWith(after, e).length ? 0.3 : 1);
    }
    const support = friends.filter(f => centre(f, at) <= 2.5).length;
    score += danger * (support >= 2 ? 0.4 : support ? 0.7 : 1) * (p.weapon ? 1.5 : 1) * (standoff(ctx) ? 0.15 : 1) * (goal?.bold ? 0.2 : 1);

    // Archers want a target in range from a spot they can still shoot from; with none, they come closer.
    // (Not while hauling siege gear to the walls: that's its job this turn.)
    const hauling = carriedBy(state, m).some(t => HEAVY.has(t.object ?? ''));
    const shot = p.weapon && !hauling && centre(moved, at) <= p.mv / 2 + 0.05 ? (bestShot(ctx, here, after)?.value ?? 0) : 0;
    score += shot;

    // Closing in when the army is the stronger one; holding together otherwise.
    const near = (q: Point) => Math.min(...enemies.map(e => centre(q, e)), 60);
    // Neither side giving ground for turns on end: the stronger one goes in (and in a long one, both do).
    if (!p.weapon) score += (near(moved) - near(at)) * (standoff(ctx) ? 0.4 : aggressive(ctx) ? 0.22 : 0.06);
    else if (!shot && (hauling || !bestShot(ctx, moved))) score += (near(moved) - near(at)) * 0.12;
    // Fast models and heroes don't run far ahead of the battle line on their own.
    if (!goal && !standoff(ctx)) {
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
  if (goal?.holdOff) {
    const d = Math.min(...goal.holdOff.from.filter(t => Math.abs(t.x - at.x) < 30 && Math.abs(t.y - at.y) < 30).map(t => distanceToTerrain(here, t)), 99);
    if (d < goal.holdOff.by) score -= (goal.holdOff.by - d) * 1.5;
    // (And out of the way of the gear being carried up to them.)
    for (const [a, b] of goal.holdOff.lanes) {
      const gap = lineGap(at, a, b);
      if (gap < 1.8) score -= (1.8 - gap) * 2;
    }
  }
  // Helm's Deep: the defenders on foot hold the walls they started on.
  if (isHelms(state) && !mounted(m) && seat === state.narrative?.good) {
    const r = radius(m);
    const held = inHornburg(moved, r) ? inHornburg : onDeepingWall(moved, r) ? onDeepingWall : undefined;
    if (held && !held(at, r)) score -= 8;
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

/** No Wound lost for two turns while this side is the stronger, or for four whichever it is. */
const standoff = (ctx: Ctx) => (ctx.memo.quiet ?? 0) >= 4 || ((ctx.memo.quiet ?? 0) >= 2 && aggressive(ctx));

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
    // (A siege engine's wound slays outright.)
    const value = (hit * profile(ctx, e).value) / (m.siege ? 1 : Math.max(1, e.wounds)) / (e.hero && e.fate ? 2 : 1);
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
    // A Will of Evil caster spends its life with each point, so it casts only when it's well worth it (never on its last few).
    const dear = willOfEvil(catalog, m) ? (m.will <= 3 ? Infinity : 2) : 0;
    if (!best || best.score < 0.6 + dear) continue;
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
  // The Assault Ballista's grapnel puts up a ladder near a wall first.
  const raise = raiseStep(ctx);
  if (raise) return raise;
  // Aldor's nerves make him shoot before the rest of his side.
  for (const m of side(state, seat).sort((a, b) => Number(unsteady(ctx.catalog, b)) - Number(unsteady(ctx.catalog, a)))) {
    // Not now: waiting for a hero's heroic activation to finish (or gone with one already).
    if (memo.acted.includes(m.id) || !(mayActivate(state, m) || unsteady(ctx.catalog, m))) continue;
    // (Legolas and Haldir come back for their next Shooting Attack.)
    if (shotsTaken(state, m) + 1 >= shotsPerPhase(ctx.catalog, m)) memo.acted.push(m.id);
    const p = profile(ctx, m);
    // A defender by a pile of rocks or a vat of oil drops it on the nearest attacker below.
    const hurl = !cannotAct(state, m) && hurlOptions(state, m).sort((a, b) => Number(b.how === 'oil') - Number(a.how === 'oil'))[0];
    if (hurl) return { action: { type: 'hurl', how: hurl.how, model: m.id, item: hurl.item, target: hurl.target }, delay: DICE_PAUSE };
    // Aragorn's flaming brand, thrown at the best of the Nazgûl not already burning.
    if (canThrowBrand(m) && !engagedWith(state, m).length && !m.prone && !cannotAct(state, m)) {
      const prey = side(state, other(seat))
        .filter(e => !e.ablaze && distanceBetween(m, e) <= FLAMING_BRAND.range + 0.01)
        .map(e => ({ e, plan: planShot(state, ctx.catalog, m, e, { brand: true }) }))
        .filter(x => !x.plan.why)
        .sort((a, b) => profile(ctx, b.e).value - profile(ctx, a.e).value)[0];
      if (prey) {
        memo.pending = { kind: 'shot', model: m.id };
        return { action: { type: 'shoot', shot: { shooter: { id: m.id, name: m.name, weapon: FLAMING_BRAND.name, shoot: p.shoot, s: FLAMING_BRAND.s, shots: 1 }, target: { id: prey.e.id, name: prey.e.name, d: profile(ctx, prey.e).d }, obstacles: Math.min(5, prey.plan.inWay.length), brand: true } }, delay: DICE_PAUSE };
      }
    }
    if (!p.weapon || (engagedWith(state, m).length && !deadlyShot(ctx.catalog, m)) || m.prone || cannotAct(state, m)) {
      memo.acted.push(m.id);
      continue;
    }
    if (memo.courage[m.id] === false && armyStatus(state, seat).broken) continue;
    const shot = bestShot(ctx, m);
    // Legolas picks a foe out of a fight with a friend when he has nothing better.
    const pin = (!shot || shot.value < 0.02) && !shotsTaken(state, m) && hasRule(ctx.catalog, m, 'Pinpoint Shot') ? pinpointShot(ctx, m) : undefined;
    if (pin) {
      memo.acted.push(m.id);
      memo.pending = { kind: 'shot', model: m.id };
      return { action: { type: 'shoot', shot: { shooter: { id: m.id, name: m.name, weapon: p.weapon.name, shoot: p.shoot, s: p.weapon.s, shots: 1 }, target: { id: pin.id, name: pin.name, d: profile(ctx, pin).d }, obstacles: 0, pinpoint: true } }, delay: DICE_PAUSE };
    }
    if (!shot || shot.value < 0.02) {
      memo.acted.push(m.id);
      // With nothing better to shoot, a strong enough bow or an engine shoots at an enemy gate.
      const gate = breachOptions(state, ctx.catalog, m).find(b => b.how === 'shoot' && state.terrain[b.target]?.kind === 'gate');
      if (gate) return { action: { type: 'breach', how: 'shoot', model: m.id, target: gate.target }, delay: DICE_PAUSE };
      continue;
    }
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
  const duel = fightDuel(state, c.key, since);
  return duel && !duel.rolls.some(duelSettled) ? duel : null;
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
  // A winning monster's Brutal Power Attack, when it beats striking as normal.
  const brutal = duel ? brutalPick(ctx, ours, theirs) : undefined;
  return { sides: [side('p1'), side('p2')], targets: [targets.p1, targets.p2], trapped: false, combat: c.key, ...(Object.keys(aims).length ? { aims } : {}), ...(brutal ? { brutal } : {}) };
}

/**
 * A Brutal Power Attack for the computer's monster, if one is worth more than striking: Rend against an enemy whose
 * Strength is well below its Defence, or Hurl when the throw (two Strength 6 hits, and one more on whoever it lands on)
 * beats what the whole side's strikes would do, since a Hurl ends the fight with no strikes.
 */
function brutalPick(ctx: Ctx, ours: Model[], theirs: Model[]): BrutalAttack | undefined {
  const brute = ours.find(m => brutalOptions(ctx.state, ctx.catalog, m).length);
  if (!brute || !theirs.length) return undefined;
  const kinds = brutalOptions(ctx.state, ctx.catalog, brute);
  const f = fighterFor(ctx, brute);
  // Roughly how likely `n` tries at `p` each are to slay `t`, times what it's worth.
  const worthOf = (t: Model, n: number, p: number) => (1 - Math.pow(1 - p, n / Math.max(1, t.wounds))) * profile(ctx, t).value;
  const strikes = Math.max(...theirs.map(t => worthOf(t, f.a, woundChance(f.s, profile(ctx, t).d))));
  const miss = (t: Model) => ours.reduce((q, m) => q * (1 - worthOf(t, fighterFor(ctx, m).a, woundChance(fighterFor(ctx, m).s, profile(ctx, t).d)) / profile(ctx, t).value), 1);
  const all = Math.max(...theirs.map(t => (1 - miss(t)) * profile(ctx, t).value));
  let best: { value: number; pick: BrutalAttack } = { value: strikes * 1.15, pick: { by: brute.id, kind: 'rend' } };
  let picked = false;
  if (kinds.includes('rend'))
    for (const t of theirs) {
      const v = worthOf(t, f.a, woundChance(f.s, profile(ctx, t).s));
      if (v > best.value) [best, picked] = [{ value: v, pick: { by: brute.id, kind: 'rend', target: t.id } }, true];
    }
  if (kinds.includes('hurl')) {
    const others = side(ctx.state, other(brute.owner)).filter(e => !theirs.includes(e) && distanceBetween(brute, e) <= 3);
    for (const t of theirs.filter(x => profile(ctx, x).s < f.s)) {
      const landOn = others.length ? Math.max(...others.map(e => worthOf(e, 1, woundChance(6, profile(ctx, e).d)))) * 0.5 : 0;
      const v = worthOf(t, 2, woundChance(6, profile(ctx, t).d)) + landOn;
      if (v > Math.max(best.value, all * 1.15)) [best, picked] = [{ value: v, pick: { by: brute.id, kind: 'hurl', target: t.id, ...(others[0] ? { at: others[0].id } : {}) } }, true];
    }
  }
  // The Trolls' own: Mince 'em Fine (the Strength roll-off's difference in Wounds), Squash 'em into Jelly (a Strength 6
  // hit on every foe touching him) and Roast 'em Slowly (to the fire, Set Ablaze).
  const s0 = profile(ctx, brute).s;
  if (kinds.includes('mince'))
    for (const t of theirs) {
      let wounds = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) wounds += Math.max(0, a + s0 - (b + profile(ctx, t).s)) / 36;
      const v = Math.min(1, wounds / Math.max(1, t.wounds)) * profile(ctx, t).value;
      if (v > best.value) [best, picked] = [{ value: v, pick: { by: brute.id, kind: 'mince', target: t.id } }, true];
    }
  if (kinds.includes('squash')) {
    const v = theirs.filter(t => distanceBetween(t, brute) <= CONTACT_SLACK).reduce((n, t) => n + Math.min(1, woundChance(6, profile(ctx, t).d) / Math.max(1, t.wounds)) * profile(ctx, t).value * 1.2, 0);
    if (v > best.value) [best, picked] = [{ value: v, pick: { by: brute.id, kind: 'squash' } }, true];
  }
  if (kinds.includes('roast'))
    for (const t of theirs) {
      const v = Math.min(1, (2 * woundChance(5, profile(ctx, t).d)) / Math.max(1, t.wounds)) * profile(ctx, t).value * 0.8;
      if (v > best.value) [best, picked] = [{ value: v, pick: { by: brute.id, kind: 'roast', target: t.id } }, true];
    }
  return picked ? best.pick : undefined;
}

/**
 * The Trolls, once they've won: a foe stuffed in a sack is out of the fight until it rolls a 6 (or for good), so a
 * Troll bags the most valuable one that fits whenever it can; the rest strike, or make a Brutal Power Attack.
 */
function sackPick(ctx: Ctx, c: Combat, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  if (duelLeader(rolls)?.winner !== (seat === 'p1' ? 0 : 1)) return null;
  const taken = new Set(Object.values(state.flow.choices ?? {}).map(x => x.sack).filter(Boolean));
  for (const troll of c[seat].map(id => state.models[id]).filter(m => m && isUp(m) && keepsForLater(ctx.catalog, m))) {
    if (state.flow.choices?.[troll.id]?.sack) continue;
    // (Not one Bill would more likely than not mince to death: dead, it can't be got out of the sack.)
    const minced = (t: Model) => {
      if (!brutalOptions(state, ctx.catalog, troll).includes('mince') || declared(state, t.id, 'Heroic Defence')) return 0;
      let p = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + profile(ctx, troll).s - (b + profile(ctx, t).s) >= t.wounds) p += 1 / 36;
      return p;
    };
    const prey = c[other(seat)]
      .map(id => state.models[id])
      .filter(m => m && isUp(m) && fitsSack(m) && !taken.has(m.id) && minced(m) < 0.5)
      .sort((a, b) => profile(ctx, b).value - profile(ctx, a).value)[0];
    if (prey) return { action: { type: 'fightChoice', id: troll.id, ...state.flow.choices?.[troll.id], sack: prey.id }, delay: THINK_PAUSE };
  }
  return null;
}

/** Bofur's Mattock at a big foe others are fighting too (down, it is trapped), and Bifur's headbutt until his axe is out. */
function companyPick(ctx: Ctx, c: Combat, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  if (duelLeader(rolls)?.winner !== (seat === 'p1' ? 0 : 1)) return null;
  const foes = c[other(seat)].map(id => state.models[id]).filter(m => m && isUp(m) && !m.prone);
  for (const m of c[seat].map(id => state.models[id]).filter(m => m && isUp(m))) {
    const pick = state.flow.choices?.[m.id] ?? {};
    if (hasMattock(ctx.catalog, m) && !pick.knock && c[seat].length > 1) {
      const big = [...foes].sort((a, b) => profile(ctx, b).d - profile(ctx, a).d)[0];
      if (big && profile(ctx, big).d >= 6) return { action: { type: 'fightChoice', id: m.id, ...pick, knock: big.id }, delay: THINK_PAUSE };
    }
    if (canHeadbutt(ctx.catalog, m) && !m.used?.includes(AXE_FREED) && !pick.headbutt && foes[0]) {
      const soft = [...foes].sort((a, b) => profile(ctx, a).d - profile(ctx, b).d)[0];
      return { action: { type: 'fightChoice', id: m.id, ...pick, headbutt: soft.id }, delay: THINK_PAUSE };
    }
  }
  return null;
}

/** Tom sneezes on the strongest foe he's fighting, as each fight starts, while he has Will to spare. */
function coldPick(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  for (const c of combats(state).filter(x => !fightDone(state, x) && x[seat].length)) {
    for (const tom of c[seat].map(id => state.models[id]).filter(m => m && isUp(m) && lingeringCold(ctx.catalog, m) && m.will > 0)) {
      if (state.flow.choices?.[tom.id]?.cold) continue;
      const touching = c[other(seat)].map(id => state.models[id]).filter(m => m && isUp(m) && m.chilled !== state.turn && distanceBetween(m, tom) <= CONTACT_SLACK);
      const best = [...touching].sort((a, b) => profile(ctx, b).f - profile(ctx, a).f)[0];
      if (best) return { action: { type: 'fightChoice', id: tom.id, ...state.flow.choices?.[tom.id], cold: best.id }, delay: THINK_PAUSE };
    }
  }
  return null;
}

/** Kíli and Fíli's re-roll, or Óin's Will for a friend's, on a duel die that would turn a lost duel. */
function rerollInDuel(ctx: Ctx, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  const us = seat === 'p1' ? 0 : 1;
  if (duelLeader(rolls)?.winner === us) return null;
  const oin = side(state, seat).find(m => m.will > 0 && rulesFor(ctx.catalog, m).includes('Reading the Portents'));
  for (const r of rolls.filter(x => x.side === us && x.f !== undefined && x.model && state.models[x.model]?.owner === seat)) {
    const low = r.dice.indexOf(Math.min(...r.dice));
    if (low < 0 || r.dice[low] >= 5) continue;
    if (rerollFor(state, ctx.catalog, r, 'synergy')) return { action: { type: 'reroll', roll: r.id, die: low, why: 'synergy', model: r.model! }, delay: DICE_PAUSE };
    if (oin && rerollFor(state, ctx.catalog, r, 'portents', oin)) return { action: { type: 'reroll', roll: r.id, die: low, why: 'portents', model: oin.id }, delay: DICE_PAUSE };
  }
  return null;
}

/**
 * Thorin's Company's own abilities, as they come up: Balin's Longbeard on a lost roll for Priority, Óin listening
 * through his trumpet, Bifur testing for his free Heroic Move, Kíli and Fíli swapping as a fight begins, and Óin's
 * herbs and Bombur's cheer in the move.
 */
function companyStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  // Ori's Chronicler: the point goes to whoever it may, Might first.
  const deed = state.flow.chronicles?.[0];
  if (deed?.seat === seat) {
    const m = deed.ids.map(id => state.models[id]).find(m => m && spentPoints(ctx.catalog, m).length);
    return { action: { type: 'chronicled', ...(m ? { model: m.id, point: spentPoints(ctx.catalog, m)[0] } : {}) }, delay: THINK_PAUSE };
  }
  const balin = longbeardFor(state, ctx.catalog, seat);
  if (balin) return { action: { type: 'longbeard', model: balin.id, ...(state.flow.chooser === seat ? { skip: true } : {}) }, delay: DICE_PAUSE };
  const due = trumpetDue(state, ctx.catalog);
  if (due) return due.oin.owner === seat ? { action: { type: 'trumpet', listen: due.oin.will > 0 }, delay: DICE_PAUSE } : { delay: WAIT_PAUSE };
  const bifur = side(state, seat).find(m => mayAxeTest(state, ctx.catalog, m));
  if (bifur) return { action: { type: 'axeTest', model: bifur.id }, delay: DICE_PAUSE };
  const twins = swapPair(state, ctx.catalog, seat);
  if (twins && state.phase === 'fight' && twins.every(m => engagedWith(state, m).length)) return { action: { type: 'swap', a: twins[0].id, b: twins[1].id }, delay: THINK_PAUSE };
  if (state.phase === 'move' && canActivate(state, seat))
    for (const m of side(state, seat)) {
      if (!mayActivate(state, m) || !rulesFor(ctx.catalog, m).some(r => /^(Healing Herbs|Raising Spirits)$/.test(r))) continue;
      for (const how of ['herbs', 'spirits'] as const) {
        const t = side(state, seat).filter(f => !mayTend(state, ctx.catalog, how, m, f)).sort((a, b) => b.maxWounds - b.wounds - (a.maxWounds - a.wounds))[0];
        if (t) return { action: { type: 'tend', how, model: m.id, target: t.id }, delay: DICE_PAUSE };
      }
    }
  return null;
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
  // Tom's cold goes on as fights start, whoever starts them.
  const cold = coldPick(ctx);
  if (cold) return cold;
  // A Demolition Charge set off where it would do the most good.
  const boom = detonateStep(ctx);
  if (boom) return boom;
  // A battering ram up against a gate swings before the other fights.
  for (const m of side(state, seat)) {
    const ram = breachOptions(state, ctx.catalog, m).find(b => b.how === 'ram');
    if (ram) return { action: { type: 'breach', how: 'ram', model: m.id, target: ram.target }, delay: DICE_PAUSE };
  }
  const heroic = new Set(phaseHeroics(state).filter(h => h.action === 'Heroic Combat').map(h => h.model));
  const open = combats(state)
    .filter(c => !fightDone(state, c) && c[seat].length && c[other(seat)].length)
    .sort((a, b) => Number([...b.p1, ...b.p2].some(id => heroic.has(id))) - Number([...a.p1, ...a.p2].some(id => heroic.has(id))));
  // Strikes for a duel already rolled come first; new fights are started only by the side with Priority.
  const c = open.find(x => openDuel(state, x, memo.since)) ?? (state.priority === seat || !state.priority ? open[0] : undefined);
  if (!c) {
    // Out of the fights, models at an enemy gate strike at it.
    for (const m of side(state, seat)) {
      const hit = breachOptions(state, ctx.catalog, m).find(b => b.how === 'strike' && state.terrain[b.target]?.kind === 'gate');
      if (hit) return { action: { type: 'breach', how: 'strike', model: m.id, target: hit.target }, delay: DICE_PAUSE };
    }
    return null;
  }
  const duel = openDuel(state, c, memo.since);
  // Fights are held long enough to follow: the duel's dice, then each model's strikes, come in one line at a time.
  if (!duel) return { action: { type: 'fight', fight: fightRequest(ctx, c) }, delay: DICE_PAUSE * 3 };
  const raise = mightInDuel(ctx, duel.rolls);
  if (raise) return raise;
  // Hold the strikes while the other player could still use Might; they roll the strikes themselves.
  if (ctx.person && humanCanRaise(state, other(seat), duel.rolls)) return { delay: WAIT_PAUSE };
  const blade = morgulPick(ctx, c, duel.rolls) ?? panPick(ctx, c, duel.rolls) ?? sackPick(ctx, c, duel.rolls) ?? companyPick(ctx, c, duel.rolls) ?? rerollInDuel(ctx, duel.rolls);
  if (blade) return blade;
  return { action: { type: 'strikes', fight: fightRequest(ctx, c, duel.rolls), group: duel.group }, delay: DICE_PAUSE * 3 };
}

/** A Morgul Blade drawn once its bearer has won the duel, at the enemy hero it would most like to slay outright. */
function morgulPick(ctx: Ctx, c: Combat, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  if (duelLeader(rolls)?.winner !== (seat === 'p1' ? 0 : 1)) return null;
  const bearer = c[seat].map(id => state.models[id]).find(m => m && isUp(m) && hasMorgulBlade(ctx.catalog, m) && !state.flow.choices?.[m.id]?.morgul);
  if (!bearer) return null;
  const prey = c[other(seat)]
    .map(id => state.models[id])
    .filter(m => m && isUp(m) && (m.cast === 'frodo' || (m.hero && m.wounds >= 2)))
    .sort((a, b) => profile(ctx, b).value - profile(ctx, a).value)[0];
  if (!prey) return null;
  return { action: { type: 'fightChoice', id: bearer.id, ...state.flow.choices?.[bearer.id], morgul: prey.id }, delay: THINK_PAUSE };
}

/** Sam's Frying Pan, once he's won, at the foe his strikes would barely scratch: stunned, it can't chase Frodo next turn. */
function panPick(ctx: Ctx, c: Combat, rolls: DiceRoll[]): BotStep | null {
  const { state, seat } = ctx;
  if (duelLeader(rolls)?.winner !== (seat === 'p1' ? 0 : 1)) return null;
  const sam = c[seat].map(id => state.models[id]).find(m => m && isUp(m) && hasFryingPan(ctx.catalog, m) && !state.flow.choices?.[m.id]?.pan);
  if (!sam) return null;
  const s = modelStats(ctx.catalog, sam)?.S ?? 2;
  const prey = c[other(seat)]
    .map(id => state.models[id])
    .filter(m => m && isUp(m) && pannable(ctx.catalog, m))
    .filter(m => { const need = woundNeed(s, modelStats(ctx.catalog, m)?.D ?? 4); return !need || !!need.then || need.target >= 6; })
    .sort((a, b) => profile(ctx, b).value - profile(ctx, a).value)[0];
  if (!prey) return null;
  return { action: { type: 'fightChoice', id: sam.id, ...state.flow.choices?.[sam.id], pan: prey.id }, delay: THINK_PAUSE };
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
    if (!hero?.hero || hero.might < 1 || mightBlocked(state, r)) continue;
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
    if (!hero?.hero || hero.might < (victim.hero ? 1 : 2) || mightBlocked(state, r)) continue;
    const k = r.dice.findIndex(d => d === r.target! - 1);
    if (k >= 0) return { action: { type: 'useMight', roll: r.id, die: k }, delay: DICE_PAUSE };
  }
  return null;
}


// ——— Helm's Deep ———

/** Where a Demolition Charge should go: the culvert while that stretch of the Deeping Wall stands, else an enemy gate. */
function chargeGoal(state: GameState, from: Point, seat: Seat): Goal | undefined {
  if (!isHelms(state)) return undefined;
  const wall = culvertWall(state);
  // (Set down a little short of the wall, out of reach of its defenders, so they can't stop the team lighting it.)
  // (Bold: the defenders up on the wall shoot at it, and it goes on regardless.)
  if (wall && !deepingDown(state)) return { at: { x: CULVERT.x + 2.6, y: CULVERT.y }, pull: 1.2, bold: true };
  const gate = Object.values(state.terrain).filter(t => gateStanding(t) && t.side && t.side !== seat).sort((a, b) => centre(from, a) - centre(from, b))[0];
  return gate ? { at: nearestEdge(gate, from), pull: 1.2 } : undefined;
}

/** Good chooses where on the south edge the Relief Force rides on: where most of the enemy's back ranks are. */
function reliefStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  if (!isHelms(state) || state.turn < RELIEF_TURN - 1 || state.narrative?.relief !== undefined || !mayChooseRelief(state, seat)) return null;
  const foes = side(state, other(seat));
  let best = { x: 36, n: -1 };
  for (let x = RELIEF_SPAN[0] + 2; x <= RELIEF_SPAN[1] - 2; x += 2) {
    const n = foes.filter(e => centre(e, { x, y: state.board.h }) <= 18).reduce((k, e) => k + (e.siege ? 4 : profile(ctx, e).weapon ? 1.5 : 1), 0);
    if (n > best.n) best = { x, n };
  }
  return { action: { type: 'reliefPoint', seat, x: best.x }, delay: THINK_PAUSE };
}

/** A hero by the Hornburg's gate mounts up and rides out once the enemy is at the gate. */
function rideOutStep(ctx: Ctx): BotStep | null {
  const { state, seat } = ctx;
  const gate = isHelms(state) ? helmsGate(state) : undefined;
  if (!gate || !side(state, other(seat)).some(e => distanceToTerrain(e, gate) <= 12)) return null;
  const m = side(state, seat).find(x => !rideOutBlocked(state, x) && mayActivate(state, x));
  return m ? { action: { type: 'rideOut', model: m.id }, delay: DICE_PAUSE } : null;
}

/** Éomer once Théoden has fallen: The Price of Grief has him charge whenever he can. */
function grieving(ctx: Ctx, m: Model): boolean {
  if (!hasRule(ctx.catalog, m, 'The Price of Grief')) return false;
  return Object.values(ctx.state.models).some(o => o.owner === m.owner && o.dead && hasRule(ctx.catalog, o, 'Herugrim'));
}

/** A charge one of ours could set off now that is worth it: more enemies than friends in the blast, or the culvert. */
function detonateStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo } = ctx;
  if (!isHelms(state)) return null;
  const ours = side(state, seat).sort((a, b) => Number(!!b.torch) - Number(!!a.torch));
  for (const m of ours) {
    for (const t of detonateOptions(state, m)) {
      const key = `boom:${m.id}:${t.id}`;
      if ((memo.tested ??= []).includes(key)) continue;
      const hit = Object.values(state.models).filter(o => isUp(o) && distanceBetween(o, { ...m, x: t.x, y: t.y, base: { shape: 'round', w: 25, h: 25 } }) <= 2);
      const foes = hit.filter(o => o.owner !== seat).length;
      if (!byCulvert(state, t) && foes <= hit.length - foes) continue;
      memo.tested.push(key);
      return { action: { type: 'detonate', model: m.id, charge: t.id }, delay: DICE_PAUSE };
    }
  }
  return null;
}

/**
 * The Assault Ballista's Raise the Ladders!: a ladder lying near a wall goes up. A ladder still carried that close is
 * put down first, so the grapnel can take it.
 */
function raiseStep(ctx: Ctx): BotStep | null {
  const { state, seat, memo } = ctx;
  if (!isHelms(state)) return null;
  const tested = (memo.tested ??= []);
  for (const engine of side(state, seat).filter(m => m.siege && !tested.includes(`raise:${m.id}`))) {
    const ready = raiseLadderTargets(state, ctx.catalog, engine)[0];
    if (ready) {
      tested.push(`raise:${engine.id}`);
      return { action: { type: 'raiseLadder', model: engine.id, ladder: ready.ladder.id }, delay: DICE_PAUSE };
    }
    for (const t of onTable(state).filter(x => x.object === 'ladder' && x.side === seat && x.carrier && !x.raised)) {
      const key = `drop:${t.id}`;
      if (tested.includes(key)) continue;
      const { carrier: _c, ...down } = t;
      const dropped: GameState = { ...state, terrain: { ...state.terrain, [t.id]: down } };
      if (!raiseLadderTargets(dropped, ctx.catalog, engine).some(x => x.ladder.id === t.id)) continue;
      tested.push(key);
      return { action: { type: 'drop', marker: t.id }, delay: MOVE_PAUSE };
    }
  }
  return null;
}

/** An enemy fighting one of our models that a Pinpoint Shot could pick out, the most worth it first. */
function pinpointShot(ctx: Ctx, m: Model): Model | undefined {
  const { state } = ctx;
  return side(state, other(m.owner))
    .filter(e => !planShot(state, ctx.catalog, m, e, { pinpoint: true }).why)
    .sort((a, b) => profile(ctx, b).value - profile(ctx, a).value)[0];
}
