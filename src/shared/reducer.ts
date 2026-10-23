import { bookBase, round } from './bases.ts';
import { mounted, mountProfile } from './cavalry.ts';
import { boardCommanders, carried, howdahFor, howdahSpot } from './warBeasts.ts';
import { assignCrew, pushers } from './siege.ts';
import { holdInZones, nearEdge } from './deployment.ts';
import { bandKey, bandsOf, deployProblems, inCurrent, layBand, markerSpot, misplaced, markerStart, mayPutDown, newMarker, nextTurn, procedureOf, swapEnds } from './deploy.ts';
import { objectivesMissing } from './scenarios.ts';
import { canActivate, heroicInfo, heroicNow, heroicQueue, mayActivate, shoutedFor } from './heroics.ts';
import { pendingSpell } from './magic.ts';
import { basePower, cannotAct, effectActive } from './powers.ts';
import { basesOverlap, costOf, crowded, engaged as engagedNow, finishCharge, fightsAgain, frontFirst, leashed, limitMove, dropMove, moveAllowance, movedAtAll, movedTooFar, moveLeft, moveStart, retrace, RETRACE, spent, testsTerrain } from './movement.ts';
import { FLOORED, floorHeight, flooredAt, insidePolygon, isDifficult, outline } from './sight.ts';
import { cleanPausedShot, woundsTaken } from './fight.ts';
import { pairOff } from './flow.ts';
import { crossingAhead } from './terrainTests.ts';
import { distanceBetween, halfExtents } from './geometry.ts';
import { touching as inContact, touchingEnemies } from './barriers.ts';
import { canPickUp, markerUpkeep, syncCarried, touching, canEscape } from './objects.ts';
import { aboard, raiseLadders, towerMove } from './fortress.ts';
import { endPhaseUpkeep } from './scoring.ts';
import { arrivalDue, mayCry, narrativeById, narrativeTerrain, radius } from './narrative.ts';
import { bondsPending } from './ambush.ts';
import { isCaveTroll, tidePending } from './balin.ts';
import { findTheHalflings, isAmon, legionsPending, reviveHobbits } from './amon.ts';
import { EDGES, elvesPending, elvesWaiting, isElves } from './elves.ts';
import { entering, enteringNoCharge, entryEdge, isMutton, isTroll, nextEntering, onEdge, reinforcementsPending, stillEntering } from './mutton.ts';
import { isHelms, mayChooseRelief, reliefPending, RELIEF_SPAN } from './helms.ts';
import { putOut } from './fire.ts';
import { ringAfterMight } from './ring.ts';
import { mightBlocked } from './mightUse.ts';
import { placeSpot, placingNow } from './placing.ts';
import { longshanksFree } from './sam.ts';
import { bundleFits, isUnseen, keepOnTable, skitterDone, spidersDue } from './unseen.ts';
import { BOT_NAME, BOT_SPEEDS, type Deploying, DOOR_TYPES, FIGHT_TARGETS, MARKER_OBJECTS, MATS, PHASES, PICK_KEYS, TERRAIN_KINDS, type Action, type FightPicks, type Flow, type Mat, type Base, type DiceRoll, type GameState, type Model, type ModelEffect, type Phase, type Picks, type Placing, type Seat, type SpellPending, type Terrain } from './types.ts';

export const MAX_MODELS = 600;
export const MAX_TERRAIN = 200;
export const MAX_LOG = 200;
export const MAX_DICE = 60;

export function initialState(): GameState {
  return {
    board: { w: 48, h: 48, mat: 'grass' },
    models: {},
    terrain: {},
    turn: 1,
    phase: 'priority',
    priority: null,
    log: [],
    names: {},
    scenario: null,
    vp: { p1: {}, p2: {} },
    listed: true,
    flow: newFlow(),
  };
}

/** The terrain rules a model can carry (see wargear.terrainRules). */
const GROUND = ['wood', 'rock', 'cave', 'spectral', 'swift', 'burly'];
const newFlow = (): Flow => ({ started: false, chooser: null, chooserTurn: 0, roll: null, done: [], resolved: [], heroics: [], passed: [], lastHeroic: null });

/** Moves to a phase (and turn), clearing who has finished; a new turn also clears fights and priority. */
/** In Roast Mutton, a move by Bilbo into contact with a Troll is a charge: from then on the Trolls may strike him. */
function bilboCharged(before: GameState, after: GameState): GameState {
  if (!isMutton(after) || after.narrative?.bilbo || after.flow.charges === before.flow.charges) return after;
  const bilbo = Object.values(after.models).find(m => m.cast === 'bilbo');
  const foe = bilbo && after.flow.charges?.[bilbo.id] ? after.models[after.flow.charges[bilbo.id]] : undefined;
  return foe && isTroll(foe) ? { ...after, narrative: { ...after.narrative!, bilbo: true } } : after;
}

/**
 * Reinforcements step onto the table one at a time, where their side comes on, once the way in is clear: the Move
 * they have already used to get their base onto the table is counted from just off the edge.
 */
function comeOn(state: GameState): GameState {
  const next = nextEntering(state);
  if (!next) return state;
  const { model, at } = next;
  const { waiting: _, ...rest } = model;
  const { edge, facing } = entryEdge(state);
  const r = radius(model);
  const off: [number, number] = edge === 'west' ? [-r, at.y] : edge === 'east' ? [state.board.w + r, at.y] : edge === 'north' ? [at.x, -r] : [at.x, state.board.h + r];
  return {
    ...state,
    models: { ...state.models, [model.id]: { ...rest, ...at, rot: facing } },
    flow: { ...state.flow, entering: { ...state.flow.entering!, on: model.id, at: [at.x, at.y] }, starts: { ...state.flow.starts, [model.id]: off }, walked: { ...state.flow.walked, [model.id]: 2 * r }, paths: { ...state.flow.paths, [model.id]: [off, [at.x, at.y]] } },
  };
}

/** Play is held for a model being placed, or for the Good player at Weathertop to say whether they roll for Aragorn. */
const waitingOn = (state: GameState) => !!placingNow(state) || arrivalDue(state);

/** Once nothing holds it, a Move phase both sides have finished goes on to shooting (unless the players move it on). */
function moveOn(state: GameState): GameState {
  if (!state.flow.started || state.phase !== 'move' || state.flow.done.length < 2 || state.advance === 'click' || waitingOn(state)) return state;
  return goTo(state, 'shoot', state.turn);
}

function goTo(state: GameState, phase: Phase, turn: number): GameState {
  const newTurn = turn !== state.turn;
  // Scenario bookkeeping happens as the End phase begins.
  const ending = phase === 'end' && state.phase !== 'end' && state.flow.started;
  const upkeep = ending ? endPhaseUpkeep(state) : {};
  // Leaving the Move phase, note who went too far to shoot.
  const farMoved = state.phase === 'move' && phase !== 'move' && !newTurn && state.flow.started ? { farMoved: movedTooFar(state), moved: movedAtAll(state) } : {};
  // Enrage Beast wears off in the End phase, and takes a Wound from the beast as it does.
  const enraged = ending ? Object.values(state.models).filter(m => !m.dead && m.effects?.some(e => basePower(e.power) === 'Enrage Beast' && effectActive(state, e))) : [];
  const next = goToPhase(state, phase, turn, newTurn, ending, upkeep, farMoved);
  return enraged.reduce((s, m) => reduce(s, { type: 'wound', id: m.id, count: 1, how: 'other' }), next);
}

const livingModels = (state: GameState) => Object.values(state.models).filter(m => !m.dead && !m.waiting && !m.escaped);

function goToPhase(state: GameState, phase: Phase, turn: number, newTurn: boolean, ending: boolean, upkeep: Partial<Flow>, farMoved: Partial<Flow>): GameState {
  // Writhing Vines are pulled up in the End phase.
  const terrain = ending ? Object.fromEntries(Object.entries(markerUpkeep(state)).filter(([, t]) => !t.vines)) : state.terrain;
  const after = { ...state, phase, turn };
  // A new turn drops effects that have worn off, so they don't pile up.
  const models = newTurn
    ? Object.fromEntries(Object.entries(state.models).map(([k, m]) => [k, m.effects ? { ...m, effects: m.effects.filter(e => effectActive(after, e)) } : m]))
    : state.models;
  return {
    ...state,
    terrain,
    models,
    phase,
    turn,
    priority: newTurn && state.flow.started ? null : state.priority,
    flow: {
      ...state.flow,
      done: [],
      resolved: newTurn ? [] : state.flow.resolved,
      heroics: newTurn ? [] : state.flow.heroics,
      ...(newTurn ? { courage: {}, braved: [], shot: [], arrived: [], duels: [], farMoved: [], moved: [], cast: [], spell: undefined, held: [], stood: [], climbed: {}, compel: undefined, supported: [], strikeBonus: {}, charges: {}, brutal: [], hurledAt: [], breached: [], trampled: [], turned: [], cables: [], sauron: [], ringTried: [], sought: [], reinforce: undefined, bonds: undefined, usedTurn: [], heard: [], freeMove: [], chronicles: undefined, placing: [], joined: [], skittered: [] } : {}),
      ...(phase !== state.phase ? { compel: undefined, mustCharge: undefined, skitter: undefined } : {}),
      // The fights are paired off as the Fight phase begins, and stay that way until it ends.
      ...(phase !== state.phase ? { pairs: phase === 'fight' && state.flow.started ? pairOff(livingModels(state), { ...state, phase: 'move' }, state.flow.pairChoices).map(c => c.key) : undefined, pairChoices: undefined } : {}),
      passed: [],
      listen: undefined,
      lastHeroic: null,
      starts: {},
      walked: {},
      paths: {},
      ...(phase !== state.phase ? { crossed: {}, blocked: {}, stopped: [], crawling: [], lay: [], heroicDone: [], heroicNow: undefined, heroicFirst: undefined, activated: [], shotPause: undefined, choices: undefined, barged: undefined } : {}),
      ...farMoved,
      ...upkeep,
    },
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
/** A model waiting to be placed, kept to sensible values (null if its model is gone). */
function cleanPlacing(p: Partial<Placing> | undefined, state: Pick<GameState, 'models'>): Placing | null {
  if (!p || typeof p !== 'object' || typeof p.model !== 'string' || !state.models[p.model] || !isSeat(p.seat) || (p.kind !== 'arrive' && p.kind !== 'retreat' && p.kind !== 'join' && p.kind !== 'nest') || !Array.isArray(p.from)) return null;
  const m = state.models[p.model];
  return {
    model: p.model,
    seat: p.seat,
    kind: p.kind,
    from: [num(p.from[0], -24, 200, m.x), num(p.from[1], -24, 200, m.y)],
    ...(typeof p.rim === 'string' ? { rim: p.rim.slice(0, 80) } : {}),
    ...(p.dist !== undefined ? { dist: num(p.dist, 0, 12, 0) } : {}),
    ...(Array.isArray(p.away) ? { away: p.away.filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 80)) } : {}),
    ...(p.stay === true ? { stay: true } : {}),
  };
}

const isSeat = (v: unknown): v is Seat => v === 'p1' || v === 'p2';
const isPhase = (v: unknown): v is Phase => PHASES.includes(v as Phase);
const id = (v: unknown) => str(v, 64);
const isMat = (v: unknown): v is Mat => MATS.includes(v as Mat);

function cleanBase(b: unknown, fallback: Base, name = ''): Base {
  if (!b || typeof b !== 'object') return fallback;
  const o = b as Record<string, unknown>;
  const w = num(o.w, 10, 250, fallback.w);
  const h = num(o.h, 10, 250, fallback.h);
  // Square-cornered bases came from older saves: riders (25×50mm) go on their 40mm mount's base, anything else on
  // its size from the books.
  if (o.shape === 'rect') return w <= 25 && h <= 50 ? round(40) : (bookBase(name) ?? round(Math.max(w, h) > 100 ? 100 : 60));
  if (o.shape === 'oval' && w !== h) return { shape: 'oval', w, h };
  return round(w);
}

/** Normalises an untrusted model, filling anything missing or out of range. */
export function cleanModel(m: Partial<Model>, prev?: Model): Model | null {
  const base: Model = prev ?? {
    id: '',
    owner: 'p1',
    name: 'Model',
    x: 0,
    y: 0,
    rot: 0,
    base: { shape: 'round', w: 25, h: 25 },
    move: 6,
    wounds: 1,
    maxWounds: 1,
    might: 0,
    will: 0,
    fate: 0,
    hero: false,
    dead: false,
  };
  const out: Model = {
    id: prev ? prev.id : id(m.id),
    owner: isSeat(m.owner) ? m.owner : base.owner,
    name: m.name !== undefined ? str(m.name, 80, base.name) : base.name,
    x: num(m.x, -24, 200, base.x),
    y: num(m.y, -24, 200, base.y),
    rot: num(m.rot, -360, 720, base.rot) % 360,
    base: m.base !== undefined ? cleanBase(m.base, base.base, typeof m.name === 'string' ? m.name : base.name) : base.base,
    move: num(m.move, 0, 24, base.move),
    maxWounds: int(m.maxWounds, 1, 30, base.maxWounds),
    wounds: 0,
    might: int(m.might, 0, 9, base.might),
    // (The Witch-king has 10 Will at Weathertop.)
    will: int(m.will, 0, 20, base.will),
    fate: int(m.fate, 0, 9, base.fate),
    hero: typeof m.hero === 'boolean' ? m.hero : base.hero,
    dead: typeof m.dead === 'boolean' ? m.dead : base.dead,
  };
  const profileId = m.profileId !== undefined ? str(m.profileId, 120) : base.profileId;
  if (profileId) out.profileId = profileId;
  const options = Array.isArray(m.options) ? m.options.slice(0, 12).map(o => str(o, 60)) : base.options;
  if (options?.length) out.options = options;
  if (typeof m.general === 'boolean' ? m.general : base.general) out.general = true;
  const warband = m.warband !== undefined ? str(m.warband, 60) : base.warband;
  if (warband) out.warband = warband;
  const points = m.points !== undefined ? int(m.points, 0, 9999, 0) : base.points;
  if (points) out.points = points;
  const tier = m.tier !== undefined ? int(m.tier, 0, 9, 0) : base.tier;
  if (tier) out.tier = tier;
  const dominant = m.dominant !== undefined ? int(m.dominant, 0, 9, 0) : base.dominant;
  if (dominant && dominant > 1) out.dominant = dominant;
  if ('fly' in m ? m.fly === true : base.fly) out.fly = true;
  if ('drum' in m ? m.drum === true : base.drum) out.drum = true;
  const ground = 'ground' in m ? (Array.isArray(m.ground) ? m.ground.filter(g => GROUND.includes(g)) : undefined) : base.ground;
  if (ground?.length) out.ground = ground;
  out.wounds = int(m.wounds, 0, out.maxWounds, Math.min(base.wounds, out.maxWounds));
  if ('escaped' in m ? m.escaped === true : base.escaped) out.escaped = true;
  if ('waiting' in m ? m.waiting === true : base.waiting) out.waiting = true;
  const hurtBy = 'hurtBy' in m ? (Array.isArray(m.hurtBy) ? [...new Set(m.hurtBy.slice(0, 40).map(id))] : undefined) : base.hurtBy;
  if (hurtBy?.length) out.hurtBy = hurtBy;
  const killedBy = 'killedBy' in m ? cleanHit(m.killedBy) : base.killedBy;
  if (killedBy && out.dead) out.killedBy = killedBy;
  const lastHit = 'lastHit' in m ? cleanHit(m.lastHit) : base.lastHit;
  if (lastHit) out.lastHit = lastHit;
  const pending = 'pending' in m ? int(m.pending, 0, 30, 0) : (base.pending ?? 0);
  if (pending && out.hero && !out.dead) out.pending = pending;
  const fateRoll = 'fateRoll' in m ? (m.fateRoll ? id(m.fateRoll) : undefined) : base.fateRoll;
  if (fateRoll && out.pending) out.fateRoll = fateRoll;
  const effects = 'effects' in m ? cleanEffects(m.effects) : base.effects;
  if (effects?.length && !out.dead) out.effects = effects;
  if (('prone' in m ? m.prone === true : base.prone) && !out.dead) out.prone = true;
  const stunned = 'stunned' in m ? int(m.stunned, 0, 99, 0) : base.stunned;
  if (stunned) out.stunned = stunned;
  for (const k of ['drained', 'withered'] as const) {
    const v = k in m ? int(m[k], 0, 9, 0) : base[k];
    if (v) out[k] = v;
  }
  const lostGear = 'lostGear' in m ? (Array.isArray(m.lostGear) ? [...new Set(m.lostGear.slice(0, 8).map(g => str(g, 60)))] : undefined) : base.lostGear;
  if (lostGear?.length) out.lostGear = lostGear;
  if ('dismounted' in m ? m.dismounted === true : base.dismounted) out.dismounted = true;
  const mount = 'mount' in m ? (m.mount ? str(m.mount, 60) : undefined) : base.mount;
  if (mount) out.mount = mount;
  const mountWounds = 'mountWounds' in m ? (m.mountWounds === undefined ? undefined : int(m.mountWounds, 0, 9, 1)) : base.mountWounds;
  if (mount && mountWounds !== undefined) out.mountWounds = mountWounds;
  const throwPending = 'throwPending' in m ? (m.throwPending === 'test' || m.throwPending === 'flying' ? m.throwPending : undefined) : base.throwPending;
  if (throwPending && !out.dismounted) out.throwPending = throwPending;
  const steed = 'steed' in m ? (m.steed ? str(m.steed, 60) : undefined) : base.steed;
  if (steed) out.steed = steed;
  const floor = 'floor' in m ? int(m.floor, 0, 9, 0) : base.floor;
  if (floor) out.floor = floor;
  const beast = 'beast' in m ? (m.beast === 'war' || m.beast === 'chariot' ? m.beast : undefined) : base.beast;
  if (beast) out.beast = beast;
  const aboard = 'aboard' in m ? (m.aboard ? id(m.aboard) : undefined) : base.aboard;
  if (aboard && !out.dead) out.aboard = aboard;
  const howdahWounds = 'howdahWounds' in m ? (m.howdahWounds === undefined ? undefined : int(m.howdahWounds, 0, 20, 0)) : base.howdahWounds;
  if (beast === 'war' && howdahWounds !== undefined) out.howdahWounds = howdahWounds;
  const stampedeTests = 'stampedeTests' in m ? int(m.stampedeTests, 0, 30, 0) : base.stampedeTests;
  if (beast === 'war' && stampedeTests) out.stampedeTests = stampedeTests;
  if (beast === 'war' && ('stampede' in m ? m.stampede === true : base.stampede)) out.stampede = true;
  const siege = 'siege' in m ? (m.siege === 'large' || m.siege === 'small' ? m.siege : undefined) : base.siege;
  if (siege) out.siege = siege;
  const crewOf = 'crewOf' in m ? (m.crewOf ? id(m.crewOf) : undefined) : base.crewOf;
  if (crewOf) out.crewOf = crewOf;
  const stats = 'stats' in m ? cleanStats(m.stats) : base.stats;
  if (stats) out.stats = stats;
  const cast = 'cast' in m ? (m.cast ? str(m.cast, 40) : undefined) : base.cast;
  if (cast) out.cast = cast;
  if ('brand' in m ? m.brand === true : base.brand) out.brand = true;
  if ('torch' in m ? m.torch === true : base.torch) out.torch = true;
  for (const k of ['ablaze', 'ringOn', 'slay'] as const) if ((k in m ? m[k] === true : base[k]) && !out.dead) out[k] = true;
  const used = 'used' in m ? (Array.isArray(m.used) ? [...new Set(m.used.slice(0, 8).map(u => str(u, 40)))] : undefined) : base.used;
  if (used?.length) out.used = used;
  for (const k of ['panned', 'noMove', 'chilled', 'hazed'] as const) {
    const turn = k in m ? (m[k] === undefined ? undefined : int(m[k], 0, 99, 0)) : base[k];
    if (turn) out[k] = turn;
  }
  for (const k of ['bound', 'slips'] as const) if ((k in m ? m[k] === true : base[k]) && !out.dead) out[k] = true;
  const crawls = 'crawls' in m ? (m.crawls === undefined ? undefined : num(m.crawls, 0, 6, 0)) : base.crawls;
  if (crawls && out.prone) out.crawls = crawls;
  return out.id ? out : null;
}

/** Characteristics a narrative scenario sets for a model, from untrusted JSON. */
function cleanStats(v: unknown): Model['stats'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: NonNullable<Model['stats']> = {};
  for (const k of ['Mv', 'Fv', 'Sv', 'S', 'D', 'A', 'W', 'C', 'I'] as const) {
    const n = (v as Record<string, unknown>)[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = int(n, 0, 20, 0);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Powers at work on a model, from untrusted JSON. */
function cleanEffects(v: unknown): ModelEffect[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(e => e && typeof e === 'object')
    .slice(0, 12)
    .map(e => ({ power: str(e.power, 60), by: id(e.by), turn: int(e.turn, 0, 99, 0), duration: e.duration === 'Temporary' ? ('Temporary' as const) : ('Exhaustion' as const), ...(Array.isArray(e.spared) ? { spared: e.spared.slice(0, 10).map(id) } : {}), ...(e.sack === true ? { sack: true } : {}), ...(e.web === true ? { web: true } : {}) }))
    .filter(e => e.power && e.by);
}

/** A cast waiting on someone, from untrusted JSON. */
function cleanSpell(s: Partial<SpellPending>): SpellPending {
  return {
    roll: id(s.roll),
    caster: id(s.caster),
    target: id(s.target),
    power: str(s.power, 60),
    cv: int(s.cv, 1, 6, 4),
    ...(s.ready === true ? { ready: true } : {}),
    ...(s.reach !== undefined ? { reach: int(s.reach, 1, 9, 4) } : {}),
    ...(s.aim ? { aim: id(s.aim) } : {}),
    ...(typeof s.resistable === 'boolean' ? { resistable: s.resistable } : {}),
  };
}

/** Who struck a model, from untrusted JSON. */
function cleanHit(v: unknown): Model['lastHit'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { ids?: unknown; how?: unknown };
  const ids = Array.isArray(o.ids) ? [...new Set(o.ids.slice(0, 20).map(id))].filter(Boolean) : [];
  return { ids, how: o.how === 'fight' || o.how === 'shoot' ? o.how : 'other' };
}

/** The marker fields of a terrain piece: what it is and what has happened to it. */
function cleanObject(t: Partial<Terrain>, base: Terrain, out: Terrain) {
  const pick = <K extends keyof Terrain>(k: K) => (k in t ? t[k] : base[k]);
  if (out.kind === 'gate') {
    // A gate or door: its kind, the side holding it, the Wounds it has left, and whether it's been broken down.
    const door = pick('door');
    out.door = DOOR_TYPES.includes(door as never) ? door : 'castle';
    const side = pick('side');
    if (isSeat(side)) out.side = side;
    const wounds = pick('wounds');
    if (wounds !== undefined && wounds !== null) out.wounds = int(wounds, 0, 20, 0);
    const gone = pick('gone');
    if (gone === 'destroyed') out.gone = gone;
    const by = pick('by');
    if (isSeat(by)) out.by = by;
    return;
  }
  if (out.kind === 'tower' || (out.kind === 'wall' && (pick('barricade') === 'plain' || pick('barricade') === 'spiked'))) {
    // A siege tower or a barricade: whose it is, the Wounds it has left, and (a tower) the wall its ramp is down on.
    if (out.kind === 'wall') out.barricade = pick('barricade');
    const side = pick('side');
    if (isSeat(side)) out.side = side;
    const wounds = pick('wounds');
    if (wounds !== undefined && wounds !== null) out.wounds = int(wounds, 0, 20, 0);
    const raised = pick('raised');
    if (out.kind === 'tower' && typeof raised === 'string' && raised) out.raised = id(raised);
    if (pick('gone') === 'destroyed') out.gone = 'destroyed';
    const by = pick('by');
    if (isSeat(by)) out.by = by;
    return;
  }
  if (pick('sheer') === true && (out.kind === 'wall' || out.kind === 'building' || out.kind === 'rock' || out.kind === 'cliff')) out.sheer = true;
  const object = pick('object');
  if (out.kind !== 'objective' || !MARKER_OBJECTS.includes(object as never)) return;
  // A ladder or ram can be broken, and a ladder raised against a piece of terrain.
  const wounds = pick('wounds');
  if ((object === 'ladder' || object === 'ram' || object === 'charge') && wounds !== undefined && wounds !== null) out.wounds = int(wounds, 0, 20, 0);
  const raised = pick('raised');
  if (object === 'ladder' && typeof raised === 'string' && raised) out.raised = id(raised);
  out.object = object;
  const side = pick('side');
  if (isSeat(side)) out.side = side;
  if (pick('hidden') === true) out.hidden = true;
  const carrier = pick('carrier');
  if (typeof carrier === 'string' && carrier) out.carrier = id(carrier);
  const who = pick('who');
  if (object === 'hobbit' && typeof who === 'string' && who) out.who = id(who);
  const home = pick('home');
  if (Array.isArray(home) && home.length === 2) out.home = [num(home[0], -24, 200, out.x), num(home[1], -24, 200, out.y)];
  const gone = pick('gone');
  if (gone === 'off' || gone === 'destroyed' || gone === 'rescued' || gone === 'revealed') out.gone = gone;
  const by = pick('by');
  if (isSeat(by)) out.by = by;
  const tried = pick('tried');
  if (tried && typeof tried === 'object') {
    const clean: Partial<Record<Seat, number>> = {};
    for (const x of ['p1', 'p2'] as const) if (tried[x] !== undefined) clean[x] = int(tried[x], 0, 99, 0);
    out.tried = clean;
  }
}

function cleanTerrain(t: Partial<Terrain>, prev?: Terrain): Terrain | null {
  const base: Terrain = prev ?? { id: '', kind: 'rock', shape: 'circle', x: 24, y: 24, w: 4, h: 4, rot: 0, locked: false };
  const out: Terrain = {
    id: prev ? prev.id : id(t.id),
    kind: TERRAIN_KINDS.includes(t.kind as Terrain['kind']) ? (t.kind as Terrain['kind']) : base.kind,
    shape: t.shape === 'rect' || t.shape === 'circle' ? t.shape : base.shape,
    x: num(t.x, -24, 200, base.x),
    y: num(t.y, -24, 200, base.y),
    w: num(t.w, 0.25, 48, base.w),
    h: num(t.h, 0.25, 48, base.h),
    rot: num(t.rot, -360, 720, base.rot) % 360,
    locked: typeof t.locked === 'boolean' ? t.locked : base.locked,
  };
  const height = 'height' in t ? (t.height === undefined || t.height === null ? undefined : num(t.height, 0, 20, 0)) : base.height;
  if (height !== undefined) out.height = height;
  const floors = 'floors' in t ? int(t.floors, 0, 6, 0) : base.floors;
  if (floors && FLOORED.has(out.kind)) out.floors = floors;
  const difficult = 'difficult' in t ? t.difficult : base.difficult;
  if (typeof difficult === 'boolean') out.difficult = difficult;
  const path = cleanPath(t.path) ?? (base.path && prev && (out.w !== prev.w || out.h !== prev.h)
    ? // Resizing a river stretches its course; the water keeps its width.
      base.path.map(([x, y, hw]) => [(x * out.w) / prev.w, (y * out.h) / prev.h, hw] as [number, number, number])
    : base.path);
  if (path) out.path = path;
  if (('walk' in t ? t.walk : base.walk) === true && out.kind === 'wall') out.walk = true;
  if (('stairs' in t ? t.stairs : base.stairs) === true && out.kind === 'road') out.stairs = true;
  const look = 'look' in t ? t.look : base.look;
  if (look === 'stone' || look === 'culvert' || look === 'grass' || look === 'pillar' || look === 'tomb' || look === 'well' || look === 'trapdoor' || look === 'doorway' || look === 'brush' || look === 'orthanc' || look === 'scaffold' || look === 'ladder' || look === 'pit' || look === 'roots' || look === 'trunk' || look === 'gnarled') out.look = look;
  cleanObject(t, base, out);
  if ('vines' in t ? t.vines === true : base.vines) {
    const side = 'side' in t ? t.side : base.side;
    if (isSeat(side)) Object.assign(out, { vines: true, side });
  }
  return out.id ? out : null;
}

function cleanPath(p: unknown): [number, number, number][] | undefined {
  if (!Array.isArray(p) || p.length < 2) return undefined;
  const out = p.slice(0, 120).filter(v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n)));
  if (out.length < 2) return undefined;
  return out.map(([x, y, hw]) => [num(x, -60, 60, 0), num(y, -60, 60, 0), num(hw, 0.2, 8, 1)]);
}

/** Numbers by id from untrusted JSON. */
function cleanCounts(v: object, max: number): Record<string, number> {
  return Object.fromEntries(Object.entries(v).slice(0, 500).map(([k, n]) => [k.slice(0, 80), int(n, 0, max, 0)]));
}

/** A player's secret picks from untrusted JSON. */
function cleanPicks(v: unknown): Picks {
  const out: Picks = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of PICK_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'string' && x) out[k] = id(x);
  }
  return out;
}

/** Move phase starting points from untrusted JSON. */
function cleanStarts(v: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, p] of Object.entries(v).slice(0, 500)) {
    if (Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n))) out[k.slice(0, 80)] = [p[0], p[1]];
  }
  return out;
}

function cleanRoll(r: unknown): DiceRoll | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Partial<DiceRoll>;
  if (!Array.isArray(o.dice)) return null;
  return {
    id: id(o.id) || 'roll',
    by: o.by === 'p1' || o.by === 'p2' ? o.by : 'spectator',
    label: str(o.label, 80),
    dice: o.dice.slice(0, MAX_DICE).map(d => int(d, 1, 6, 1)),
    target: o.target === undefined ? undefined : int(o.target, 1, 7, 4),
    ...(o.then !== undefined && Array.isArray(o.follow)
      ? { then: int(o.then, 1, 6, 4), follow: o.follow.slice(0, MAX_DICE).map(d => int(d, 1, 6, 1)) }
      : {}),
    ...(o.sum !== undefined ? { sum: int(o.sum, 2, 12, 7) } : {}),
    ...(o.group ? { group: id(o.group) } : {}),
    ...(o.note ? { note: str(o.note, 140) } : {}),
    ...(o.against ? { against: id(o.against) } : {}),
    ...(o.aim ? { aim: id(o.aim) } : {}),
    ...(o.model ? { model: id(o.model) } : {}),
    ...(o.f !== undefined ? { f: int(o.f, 1, 10, 3) } : {}),
    ...(o.side === 0 || o.side === 1 ? { side: o.side } : {}),
    ...(o.might ? { might: int(o.might, 0, 60, 0) } : {}),
    ...(o.support === true ? { support: true } : {}),
    ...(o.charge === true ? { charge: true } : {}),
    ...(o.edge === true ? { edge: true } : {}),
    ...(o.pinpoint === true ? { pinpoint: true } : {}),
    ...(o.mod ? { mod: int(o.mod, -3, 3, 0) } : {}),
    ...(o.sixSafe === true ? { sixSafe: true } : {}),
    ...(o.per && o.per > 1 ? { per: int(o.per, 1, 3, 1) } : {}),
    ...(o.banner === true ? { banner: true } : {}),
    ...(o.sixes === true ? { sixes: true } : {}),
    ...(o.fixed !== undefined ? { fixed: int(o.fixed, 0, 20, 0) } : {}),
    ...(o.frees ? { frees: id(o.frees) } : {}),
    ...(Array.isArray(o.rerolled) ? { rerolled: o.rerolled.filter(x => x === 'synergy' || x === 'portents').slice(0, 4) } : {}),
    at: num(o.at, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** A cast that Might has just lifted to its casting value now waits on its target, or takes effect if it can't be resisted. */
function afterMight(state: GameState, rollId: string): GameState {
  const p = pendingSpell(state);
  if (!p || p.roll !== rollId || !p.cast) return state;
  const resistable = state.flow.spell!.resistable ?? (p.target.owner !== p.caster.owner && p.target.will > 0);
  const note = resistable ? `Cast on a ${p.best}. ${p.target.name} may resist, needing a ${p.best} or more.` : 'The power takes effect.';
  // One nobody can resist waits for the game (which holds the dice its effect may need) to put it into play.
  return { ...state, log: state.log.map(r => (r.id === rollId ? { ...r, note } : r)), flow: { ...state.flow, spell: { ...state.flow.spell!, ...(resistable ? {} : { ready: true }) } } };
}

function cleanPause(p: { group?: unknown; shot?: unknown }): Flow['shotPause'] {
  const shot = cleanPausedShot(p.shot);
  return shot && typeof p.group === 'string' ? { group: p.group.slice(0, 80), shot } : undefined;
}

/**
 * Pushes (or turns) a siege engine in the Move phase, with the friends beside it: up to the Move of the slowest of
 * them, and never into difficult ground or over a barrier. Those pushing it go along with it.
 */
function pushEngine(state: GameState, engine: Model, mv: { x?: unknown; y?: unknown; rot?: unknown }): { models: Record<string, Model>; starts: Record<string, [number, number]>; turned: boolean } | null {
  if (state.phase !== 'move') return null;
  const asked = { x: num(mv.x, -24, 200, engine.x), y: num(mv.y, -24, 200, engine.y) };
  const rot = mv.rot === undefined ? engine.rot : num(mv.rot, -360, 720, engine.rot) % 360;
  const turned = Math.abs(rot - engine.rot) > 0.5;
  if (!turned && asked.x === engine.x && asked.y === engine.y) return null;
  const crew = pushers(state, engine);
  if (!crew || !crew.by.every(m => mayActivate(state, m))) return null;
  const from = state.flow.starts?.[engine.id] ? { x: state.flow.starts[engine.id][0], y: state.flow.starts[engine.id][1] } : { x: engine.x, y: engine.y };
  const d = Math.hypot(asked.x - from.x, asked.y - from.y);
  const k = d > crew.move ? crew.move / d : 1;
  const want = { x: from.x + (asked.x - from.x) * k, y: from.y + (asked.y - from.y) * k };
  // Step along from where it is now, stopping short of difficult ground, a barrier or another model.
  const rough = Object.values(state.terrain).filter(t => !t.gone && (isDifficult(t) || t.kind === 'wall' || t.kind === 'building' || t.kind === 'rock' || t.kind === 'cliff' || t.kind === 'water')).map(t => outline(t));
  const along = new Set(crew.by.map(m => m.id));
  const others = Object.values(state.models).filter(o => o.id !== engine.id && !along.has(o.id) && !o.dead && !o.waiting && !o.escaped && !o.aboard);
  const steps = Math.max(1, Math.ceil(Math.hypot(want.x - engine.x, want.y - engine.y) / 0.05));
  let at = { x: engine.x, y: engine.y };
  for (let i = 1; i <= steps; i++) {
    const p = { x: engine.x + ((want.x - engine.x) * i) / steps, y: engine.y + ((want.y - engine.y) * i) / steps };
    const body = { ...engine, ...p, rot };
    if (rough.some(poly => insidePolygon(poly, p) && !insidePolygon(poly, engine)) || others.some(o => basesOverlap(body, o))) break;
    at = p;
  }
  const dx = at.x - engine.x;
  const dy = at.y - engine.y;
  const models: Record<string, Model> = { [engine.id]: { ...engine, ...at, rot } };
  const starts: Record<string, [number, number]> = {};
  if (!state.flow.starts?.[engine.id]) starts[engine.id] = [engine.x, engine.y];
  for (const m of crew.by) {
    models[m.id] = { ...m, x: m.x + dx, y: m.y + dy };
    if (!state.flow.starts?.[m.id]) starts[m.id] = [m.x, m.y];
  }
  return { models, starts, turned };
}

/** The most turns a model's trail this phase keeps: its first point (where it began), then the latest ones. */
const TRAIL_POINTS = 200;
const capTrail = (t: [number, number][]) => (t.length > TRAIL_POINTS ? [t[0], ...t.slice(1 - TRAIL_POINTS)] : t);

/** Takes wounds off a model, removing it as a casualty when none are left. */
function takeWounds(m: Model, n: number): Model {
  // A Morgul Blade's wound that gets through slays outright.
  const wounds = m.slay && n > 0 ? 0 : Math.max(0, m.wounds - n);
  // Remember who did it, for scenarios that score kills by particular models.
  const hit = m.lastHit;
  const hurtBy = hit?.ids.length && n > 0 ? [...new Set([...(m.hurtBy ?? []), ...hit.ids])] : m.hurtBy;
  const out = { ...m, ...(hurtBy ? { hurtBy } : {}) };
  delete out.slay;
  return wounds > 0 ? { ...out, wounds } : { ...out, wounds: 0, dead: true, pending: undefined, fateRoll: undefined, ...(hit ? { killedBy: hit } : {}) };
}

/**
 * Once a hero has no Fate left to roll and no failed Fate roll that Might could still save,
 * its remaining pending wounds are taken.
 */
function settle(m: Model): Model {
  const out = { ...m };
  if (!out.pending) {
    delete out.pending;
    delete out.fateRoll;
    // Fate saved every wound, the Morgul Blade's included.
    delete out.slay;
    return out;
  }
  if (out.fate > 0 || (out.fateRoll && out.might > 0)) return out;
  return takeWounds({ ...out, pending: undefined, fateRoll: undefined }, m.pending!);
}

/**
 * Applies one action to the game state and returns the new state.
 * Runs on both server and clients, so it must be deterministic and must tolerate hostile input.
 * `roll` is a request only; the server replaces it with `rolled`, so here it is a no-op.
 */
export function reduce(state: GameState, action: Action): GameState {
  // Carried markers go wherever their carrier goes, and a Siege Ladder carried to a wall is raised against it.
  // (And at Amon Hen a Hobbit brought down is knocked out instead, and friends bring him round: see amon.ts.)
  return raiseLadders(syncCarried(findTheHalflings(state, challengesSettled(state, step(state, action)))));
}

/**
 * Heroic Challenges end when either hero falls. The one that slew the other gains 1 Might (up to what it started
 * with): the challenger always, the challenged hero only if it took the challenge up.
 */
function challengesSettled(before: GameState, state: GameState): GameState {
  const list = state.flow.challenges;
  if (!list?.length) return state;
  const fallen = (id: string) => !!state.models[id]?.dead && !before.models[id]?.dead;
  const ended = list.filter(c => fallen(c.by) || fallen(c.target) || !state.models[c.by] || !state.models[c.target]);
  if (!ended.length) return state;
  const models = { ...state.models };
  for (const c of ended) {
    for (const [winner, loser, earns] of [[c.by, c.target, true], [c.target, c.by, !!c.accepted]] as const) {
      const w = models[winner];
      if (!earns || !w || w.dead || !fallen(loser) || !models[loser].killedBy?.ids.includes(winner)) continue;
      models[winner] = { ...w, might: Math.max(w.might, Math.min(c.by === winner ? c.cap : 9, w.might + 1)) };
    }
  }
  return { ...state, models, flow: { ...state.flow, challenges: list.filter(c => !ended.includes(c)) } };
}

function step(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'addModels': {
      if (!Array.isArray(action.models)) return state;
      const models = { ...state.models };
      // Once the armies are being set up in turn, models added to one wait off the table for their turn.
      const d = state.flow.deploy;
      const later = !state.flow.started && !!d && ['side', 'warbands', 'done'].includes(d.step) && procedureOf(state)?.armies !== 'none';
      for (const raw of action.models) {
        if (Object.keys(models).length >= MAX_MODELS) break;
        const m = cleanModel(raw ?? {});
        // A siege engine is set up wholly within 6" of a table edge.
        if (m) models[m.id] = later ? { ...m, waiting: true } : m.siege && !m.waiting && !state.flow.started ? { ...m, ...nearEdge(state, m, m) } : m;
      }
      // A war beast's Commander rides on it.
      const added = action.models.map(raw => (raw && typeof raw === 'object' ? String(raw.id) : '')).filter(i => models[i]);
      const out = { ...state, models: assignCrew(boardCommanders(models, added), added, state.board) };
      // Everything was down: the side with new models has more to place.
      const owner = added.length ? models[added[0]].owner : null;
      return later && d!.step === 'done' && owner ? { ...out, flow: { ...out.flow, deploy: { ...d!, step: 'warbands', turn: owner } } } : out;
    }
    case 'moveModels': {
      if (!Array.isArray(action.moves)) return state;
      const models = { ...state.models };
      let starts = state.flow.starts;
      let walked = state.flow.walked;
      let paths = state.flow.paths;
      // Before the battle, models stay in their deployment zones (and a warband switching zones comes along whole).
      const moves = state.flow.started ? frontFirst(state, action.moves) : holdInZones(state, action.moves.filter(mv => mv && models[mv.id]).map(mv => ({ id: String(mv.id), x: num(mv.x, -24, 200, models[mv.id].x), y: num(mv.y, -24, 200, models[mv.id].y), rot: mv.rot })));
      let stood = state.flow.stood;
      let blocked = state.flow.blocked;
      let climbed = state.flow.climbed;
      let charges = state.flow.charges;
      let heroicStarted = state.flow.heroicNow;
      let turned = state.flow.turned;
      // The models moved in this one drag.
      const together = new Set(moves.map(mv => mv && String(mv.id)));
      // While a model waits to be placed, only it moves, and only where its placing allows.
      const placing = state.flow.started ? placingNow(state) : undefined;
      // Nothing moves while the Good player decides whether to roll for Aragorn.
      if (state.flow.started && !placing && arrivalDue(state)) return state;
      for (const mv of moves) {
        const prev = mv && models[mv.id];
        if (!prev || prev.escaped || prev.waiting) continue;
        // Sam, once the game has put him in Frodo's fight, and a model stunned by his Frying Pan, stay put.
        if (state.flow.started && !placing && ((state.phase === 'fight' && state.flow.joined?.includes(prev.id)) || (state.phase === 'move' && (prev.panned === state.turn || prev.noMove === state.turn)))) continue;
        if (placing) {
          if (prev.id !== placing.model || prev.dead) continue;
          const spot = placeSpot(state, placing, prev, { x: num(mv.x, -24, 200, prev.x), y: num(mv.y, -24, 200, prev.y) });
          if (spot) models[prev.id] = { ...prev, ...spot, rot: mv.rot === undefined ? prev.rot : num(mv.rot, -360, 720, prev.rot) % 360 };
          continue;
        }
        // Riders go where their war beast takes them.
        if (prev.aboard && models[prev.aboard] && !models[prev.aboard].dead) continue;
        // A siege engine is pushed by the friends beside it, and goes with them (see siege.ts).
        if (prev.siege && state.flow.started) {
          const pushed = pushEngine({ ...state, models }, prev, mv);
          if (!pushed) continue;
          Object.assign(models, pushed.models);
          starts = { ...starts, ...pushed.starts };
          if (pushed.turned) turned = [...new Set([...(turned ?? []), prev.id])];
          continue;
        }
        // In the Move phase a war beast only Tramples, and a chariot only makes its Chariot Charge (see warBeasts.ts),
        // and a side with a war beast about to Stampede must let it go first.
        if (state.flow.started && state.phase === 'move' && (prev.beast || (mounted(prev) && mountProfile(prev.mount)?.chariot) || Object.values(models).some(b => b.owner === prev.owner && b.stampede && !b.dead && !state.flow.trampled?.includes(b.id)))) continue;
        const asked = { x: num(mv.x, -24, 200, prev.x), y: num(mv.y, -24, 200, prev.y) };
        // A model whose move has ended this phase stays where it is.
        if (state.flow.started && state.phase === 'move' && state.flow.stopped?.includes(prev.id) && (asked.x !== prev.x || asked.y !== prev.y)) continue;
        // Only the models whose activation it is may move (a hero's heroic activation goes first; see heroics.ts).
        const askedToMove = asked.x !== prev.x || asked.y !== prev.y;
        // While reinforcements come on, the rest of their side has had its activation.
        if (state.flow.started && state.phase === 'move' && askedToMove && state.flow.entering?.turn === state.turn && state.flow.entering.seat === prev.owner && !entering(state, prev)) continue;
        if (state.flow.started && state.phase === 'move' && askedToMove && !state.flow.compel && !mayActivate(state, prev)) continue;
        if (state.flow.started && state.phase === 'move' && askedToMove && !heroicStarted && heroicQueue(state).some(h => h.id === prev.id) && heroicNow(state)?.seat === prev.owner) heroicStarted = prev.id;
        let to = asked;
        const moving = to.x !== prev.x || to.y !== prev.y;
        const compel = state.flow.compel?.model === prev.id ? state.flow.compel : undefined;
        // A Compelled model in a fight can't be moved out of it.
        if (compel && moving && engagedNow(state, prev)) continue;
        // A Compelled model goes where the caster's player takes it, up to half its Move from where it stood.
        // (Each model moved keeps clear of where the others have got to: see frontFirst.)
        const now = { ...state, models };
        if (compel && moving) to = limitMove(now, { x: compel.from[0], y: compel.from[1] }, to, compel.max, prev.owner, prev);
        // A Spider moving its D6" under the Power of the Ring can't be walked off the table either.
        if (moving && state.flow.skitter?.model === prev.id) to = keepOnTable(state, prev, to);
        // In Sauron's grip a Ringbearer can't be walked off the table.
        if (compel?.ring && moving) {
          const r = Math.max(halfExtents(prev.base).rx, halfExtents(prev.base).ry);
          to = { x: Math.min(state.board.w - r, Math.max(r, to.x)), y: Math.min(state.board.h - r, Math.max(r, to.y)) };
        }
        // Once the battle is under way a model goes no further than its allowance from where it began the phase:
        // its Move in the Move phase, 1" in the Fight phase, and nowhere in the others.
        const allowance = compel ? null : moveAllowance(state, prev);
        if (allowance !== null && moving) {
          const from = moveStart(state, prev);
          // Each move goes on from where the model is now, so it can go round things: what it may still spend is its
          // allowance less what it has walked so far.
          const here = { x: prev.x, y: prev.y };
          // (Putting it back where it began the phase is always allowed, and gives its whole Move back; so is stepping
          // back along the way it came, which gives back what it spent beyond that point.)
          let back = Math.hypot(to.x - from.x, to.y - from.y) < RETRACE / 2;
          let undone = back ? null : retrace(paths?.[prev.id], to);
          // (Not if another model has since moved onto that spot.)
          if ((back || undone) && crowded(now, prev, back ? from : undone!.at)) {
            [back, undone, to] = [false, null, here];
          }
          // (Reinforcements coming on may not charge.)
          const arriving = state.phase === 'move' && enteringNoCharge(state, prev);
          to = back ? from : undone ? undone.at : dropMove(now, here, to, Math.max(0, allowance - spent(state, prev)), prev.owner, prev, undefined, !arriving);
          // A model that stops inside an enemy's control zone is charging it: it must reach base contact, or stay out.
          if ((state.phase === 'move' || fightsAgain(state, prev)) && !arriving) to = finishCharge(now, prev, here, to);
          // A friend going with a hero (With Me, or At the Double) must end within 6" of it, and a siege crew within 6"
          // of its engine while it stands. (Going back the way it came, or back where it began, always is allowed: the
          // hero may have gone on since.)
          if (!back && !undone) to = leashed(state, prev, here, to, together, heroicStarted, models);
          // A model that threw a weapon as it charged goes on into contact with its target, unless the throw slew it.
          const must = state.flow.mustCharge?.model === prev.id ? state.models[state.flow.mustCharge.target] : undefined;
          if (must && !must.dead && !inContact(state, { ...prev, ...to }, must)) to = { x: prev.x, y: prev.y };
          if (!starts?.[prev.id]) starts = { ...starts, [prev.id]: [from.x, from.y] };
          walked = { ...walked, [prev.id]: back ? 0 : undone ? undone.trail.slice(1).reduce((n, p, i) => n + costOf(state, prev, { x: undone.trail[i][0], y: undone.trail[i][1] }, { x: p[0], y: p[1] }), 0) : spent(state, prev) + costOf(state, prev, here, to) };
          // Its trail keeps a point where it turned (a straight run just stretches the last leg), and always where it began.
          const trail: [number, number][] = back ? [] : undone ? undone.trail.slice(0, -1) : (paths?.[prev.id] ?? [[from.x, from.y]]);
          const [a, b] = [trail.at(-2), trail.at(-1)];
          const straight = a && b && Math.abs((b[0] - a[0]) * (to.y - b[1]) - (b[1] - a[1]) * (to.x - b[0])) < 0.05 * Math.hypot(b[0] - a[0], b[1] - a[1]);
          paths = { ...paths, [prev.id]: back ? [] : capTrail([...(straight ? trail.slice(0, -1) : trail), [to.x, to.y] as [number, number]]) };
          // Stopped at terrain that needs a test: remember it, so the model's card can offer the test.
          if (testsTerrain(state, prev)) {
            // (Looking from where this drag set off, not where the phase began: a move is often made in several drags.)
            const ahead = crossingAhead(state, prev, here, asked);
            const { [prev.id]: _, ...rest } = blocked ?? {};
            // (Not if it stopped there to fight an enemy across it.)
            const fighting = ahead && touchingEnemies({ ...state, models }, { ...prev, ...to }).length > 0;
            blocked = ahead && !fighting && Math.hypot(to.x - ahead.stop.x, to.y - ahead.stop.y) < 0.05 ? { ...rest, [prev.id]: { terrain: ahead.terrain, test: ahead.test, stop: [to.x, to.y], landing: [ahead.landing.x, ahead.landing.y], drop: ahead.drop } } : rest;
          }
        }
        let next: Model = { ...prev, ...to, rot: mv.rot === undefined ? prev.rot : num(mv.rot, -360, 720, prev.rot) % 360 };
        // Inside a building a model keeps to its floor; leaving it (or walking into another) takes it back to the
        // ground, and climbing down from an upper floor costs the drop from its Move.
        if (next.floor && moving) {
          const was = flooredAt(state, prev);
          if (!was || flooredAt(state, next) !== was) {
            delete next.floor;
            if (was && state.flow.started && state.phase === 'move') climbed = { ...climbed, [prev.id]: (climbed?.[prev.id] ?? 0) + floorHeight(was, prev.floor!) };
          }
        }
        // A Prone model that moves stands up first, which costs it half its Move this turn.
        const crawls = state.flow.crawling?.includes(prev.id) || state.flow.lay?.includes(prev.id) || !!prev.crawls;
        if (prev.prone && allowance && moving && !crawls && (to.x !== prev.x || to.y !== prev.y)) {
          next = { ...next, prone: undefined };
          delete next.prone;
          stood = [...new Set([...(stood ?? []), prev.id])];
        }
        // A move into contact with an enemy is a charge on it: remember who, for fights over a wall.
        if (state.flow.started && allowance && moving && (state.phase === 'move' || fightsAgain(state, prev))) {
          const was = new Set(touchingEnemies(state, prev).map(e => e.id));
          const foe = touchingEnemies({ ...state, models }, next).find(e => !was.has(e.id));
          if (foe) charges = { ...charges, [prev.id]: foe.id };
        }
        // Crawling 1" while Prone, or getting into water, puts out the flames.
        if (next.ablaze && state.flow.started && putOut({ ...state, flow: { ...state.flow, walked } }, next)) {
          next = { ...next };
          delete next.ablaze;
        }
        models[prev.id] = next;
        // Its Commander and any in its Howdah ride along.
        if (prev.beast === 'war' && (next.x !== prev.x || next.y !== prev.y || next.rot !== prev.rot))
          for (const r of Object.values(models)) if (r.aboard === prev.id && !r.dead) models[r.id] = { ...r, ...carried(prev, next, r) };
      }
      const flow =
        starts !== state.flow.starts || walked !== state.flow.walked || paths !== state.flow.paths || stood !== state.flow.stood || climbed !== state.flow.climbed || blocked !== state.flow.blocked || charges !== state.flow.charges || heroicStarted !== state.flow.heroicNow || turned !== state.flow.turned
          ? { flow: { ...state.flow, starts, ...(walked ? { walked } : {}), ...(paths ? { paths } : {}), ...(stood ? { stood } : {}), ...(climbed ? { climbed } : {}), ...(blocked ? { blocked } : {}), ...(charges ? { charges } : {}), ...(heroicStarted ? { heroicNow: heroicStarted } : {}), ...(turned ? { turned } : {}) } }
          : {};
      return comeOn(bilboCharged(state, { ...state, models, ...flow }));
    }
    case 'trampled': {
      // A war beast or chariot has made its move (the game drove it; see warBeasts.ts): it moves no more this phase.
      const m = state.models[action.id];
      if (!m || !Array.isArray(action.from)) return state;
      const from: [number, number] = [num(action.from[0], -24, 200, m.x), num(action.from[1], -24, 200, m.y)];
      const target = action.target && state.models[action.target] ? action.target : undefined;
      const flow = {
        ...state.flow,
        starts: state.flow.starts?.[m.id] ? state.flow.starts : { ...state.flow.starts, [m.id]: from },
        trampled: [...new Set([...(state.flow.trampled ?? []), m.id])],
        stopped: [...new Set([...(state.flow.stopped ?? []), m.id])],
        ...(target ? { charges: { ...state.flow.charges, [m.id]: target } } : {}),
      };
      // A Stampede is over once it has run.
      if (!m.stampede) return { ...state, flow };
      const { stampede: _, ...calm } = m;
      return { ...state, flow, models: { ...state.models, [m.id]: calm } };
    }
    case 'cable': {
      // An Iron Hills Ballista's bolt trails its line across the battlefield until the turn ends.
      if (!Array.isArray(action.from) || !Array.isArray(action.to)) return state;
      const c: [number, number, number, number] = [num(action.from[0], -24, 200, 0), num(action.from[1], -24, 200, 0), num(action.to[0], -24, 200, 0), num(action.to[1], -24, 200, 0)];
      return { ...state, flow: { ...state.flow, cables: [...(state.flow.cables ?? []), c].slice(-20) } };
    }
    case 'board': {
      // Before the battle, a warrior climbs into a war beast's Howdah, or climbs out again beside it.
      const m = state.models[action.id];
      if (!m || m.dead || state.flow.started) return state;
      if (!action.beast) {
        const beast = m.aboard ? state.models[m.aboard] : undefined;
        if (!beast || /commander/i.test(m.name)) return state;
        const out = { ...m, x: beast.x, y: beast.y + (beast.owner === 'p1' ? 1 : -1) * (beast.base.h / 50.8 + 0.6) };
        delete out.aboard;
        return { ...state, models: { ...state.models, [m.id]: out } };
      }
      const beast = state.models[action.beast];
      if (!beast || beast.beast !== 'war' || beast.owner !== m.owner || m.aboard || m.beast) return state;
      const howdah = howdahFor(beast.name);
      const spot = howdahSpot(state, beast);
      if (!spot || !howdah?.capacity || !howdah.who?.test(m.name) || Object.values(state.models).filter(r => r.aboard === beast.id && !/commander/i.test(r.name)).length >= howdah.capacity) return state;
      return { ...state, models: { ...state.models, [m.id]: { ...m, ...spot, rot: beast.rot, aboard: beast.id } } };
    }
    case 'climb': {
      // A model climbs between the floors of the building it's in, spending the height from its Move once the battle's on.
      const m = state.models[action.id];
      const t = m && !m.dead ? flooredAt(state, m) : undefined;
      if (!t) return state;
      const to = int(action.floor, 0, t.floors ?? 0, 0);
      const cost = Math.abs(floorHeight(t, to) - floorHeight(t, m.floor ?? 0));
      if (to === (m.floor ?? 0)) return state;
      // Cavalry can't climb (a rider's base is longer than it is wide).
      if (state.flow.started && mounted(m) && to > (m.floor ?? 0)) return state;
      let flow = state.flow;
      if (state.flow.started) {
        const left = moveLeft(state, m);
        if (state.phase !== 'move' || left === null || left + 1e-6 < cost || m.prone || state.flow.compel?.model === m.id) return state;
        flow = { ...flow, climbed: { ...flow.climbed, [m.id]: (flow.climbed?.[m.id] ?? 0) + cost } };
      }
      const next: Model = { ...m, floor: to };
      if (!to) delete next.floor;
      return { ...state, models: { ...state.models, [m.id]: next }, flow };
    }
    case 'crossed': {
      // A model may now cross a piece of terrain (it passed its test, or waded in), and its move may have ended.
      const m = state.models[action.id];
      if (!m) return state;
      const terrain = action.terrain && state.terrain[action.terrain] ? action.terrain : undefined;
      const crossed = terrain ? { ...state.flow.crossed, [m.id]: [...new Set([...(state.flow.crossed?.[m.id] ?? []), terrain])] } : state.flow.crossed;
      const stopped = action.stop ? [...new Set([...(state.flow.stopped ?? []), m.id])] : state.flow.stopped;
      const { [m.id]: _, ...blocked } = state.flow.blocked ?? {};
      return { ...state, flow: { ...state.flow, ...(crossed ? { crossed } : {}), ...(stopped ? { stopped } : {}), blocked } };
    }
    case 'crawl': {
      // A Prone model crawls up to 1" and stays Prone, instead of standing up.
      const m = state.models[action.id];
      if (!m?.prone || mounted(m) || !state.flow.started || state.phase !== 'move' || state.flow.starts?.[m.id] || state.flow.crawling?.includes(m.id)) return state;
      return { ...state, flow: { ...state.flow, crawling: [...(state.flow.crawling ?? []), m.id] } };
    }
    case 'lieDown': {
      // A standing model lies down for half its Move, and its move ends.
      const m = state.models[action.id];
      // Cavalry can't lie down.
      if (!m || m.dead || m.prone || m.siege || mounted(m) || !state.flow.started || state.phase !== 'move' || state.flow.stood?.includes(m.id)) return state;
      const left = moveLeft(state, m);
      if (left === null || left + 1e-6 < m.move / 2) return state;
      return {
        ...state,
        models: { ...state.models, [m.id]: { ...m, prone: true } },
        flow: {
          ...state.flow,
          climbed: { ...state.flow.climbed, [m.id]: (state.flow.climbed?.[m.id] ?? 0) + m.move / 2 },
          lay: [...new Set([...(state.flow.lay ?? []), m.id])],
          stopped: [...new Set([...(state.flow.stopped ?? []), m.id])],
        },
      };
    }
    case 'arrive': {
      // Waiting models come onto the table; the side has rolled for its arrivals this turn either way.
      if (!isSeat(action.seat) || !Array.isArray(action.moves)) return state;
      const models = { ...state.models };
      for (const mv of action.moves) {
        const m = mv && models[mv.id];
        if (m?.waiting && m.owner === action.seat) {
          const { waiting: _, ...rest } = m;
          models[m.id] = { ...rest, x: num(mv.x, 0, state.board.w, m.x), y: num(mv.y, 0, state.board.h, m.y), rot: num(mv.rot, -360, 720, 0) % 360 };
        }
      }
      return { ...state, models, flow: { ...state.flow, arrived: [...new Set([...(state.flow.arrived ?? []), action.seat])] } };
    }
    case 'backAway': {
      if (!Array.isArray(action.moves)) return state;
      const models = { ...state.models };
      for (const mv of action.moves) {
        const prev = mv && models[mv.id];
        if (!prev || prev.dead) continue;
        if (mv.ifSlain && !models[mv.ifSlain]?.dead) continue;
        if (mv.unlessSlain && models[mv.unlessSlain]?.dead) continue;
        models[prev.id] = { ...prev, x: num(mv.x, -24, 200, prev.x), y: num(mv.y, -24, 200, prev.y) };
      }
      return { ...state, models };
    }
    case 'courageTaken': {
      if (!action.results || typeof action.results !== 'object') return state;
      const models = { ...state.models };
      const courage = { ...state.flow.courage };
      for (const [id, pass] of Object.entries(action.results)) {
        if (!models[id]) continue;
        courage[id] = pass === true;
        // A model of a Broken army that fails flees the battle.
        if (!pass && action.broken) models[id] = { ...models[id], dead: true, wounds: 0 };
      }
      const braved = action.broken && isSeat(action.broken) ? [...new Set([...(state.flow.braved ?? []), action.broken])] : state.flow.braved;
      return { ...state, models, flow: { ...state.flow, courage, ...(braved ? { braved } : {}) } };
    }
    case 'updateModel': {
      const prev = state.models[action.id];
      if (!prev || !action.patch || typeof action.patch !== 'object') return state;
      // Models only change place through moveModels, which holds them to their allowance.
      const { x: _x, y: _y, ...patch } = action.patch;
      const m = cleanModel(patch, prev);
      return m ? { ...state, models: { ...state.models, [m.id]: m } } : state;
    }
    case 'removeModels': {
      if (!Array.isArray(action.ids)) return state;
      const models = { ...state.models };
      for (const i of action.ids) delete models[i];
      return { ...state, models };
    }
    case 'addTerrain': {
      if (Object.keys(state.terrain).length >= MAX_TERRAIN) return state;
      const t = cleanTerrain(action.terrain ?? {});
      return t ? { ...state, terrain: { ...state.terrain, [t.id]: t } } : state;
    }
    case 'updateTerrain': {
      const prev = state.terrain[action.id];
      if (!prev || !action.patch || typeof action.patch !== 'object') return state;
      // While markers are placed in turn, only the one being placed moves, and only where it may go.
      const d = state.flow.deploy;
      // The Unseen Hero: the Evil player sets out the webbed bundles as their side sets up, 6" apart.
      if (!state.flow.started && isUnseen(state) && prev.object === 'cocoon' && ('x' in action.patch || 'y' in action.patch)) {
        const evil = state.narrative!.good === 'p1' ? 'p2' : 'p1';
        const p = { x: num(action.patch.x, -24, 200, prev.x), y: num(action.patch.y, -24, 200, prev.y) };
        if (d?.step !== 'sides' || d.turn !== evil || !bundleFits(state, prev, p)) return state;
        return { ...state, terrain: { ...state.terrain, [prev.id]: { ...prev, x: p.x, y: p.y } } };
      }
      if (d && !state.flow.started && prev.kind === 'objective' && ('x' in action.patch || 'y' in action.patch)) {
        if (d.marker !== prev.id) return state;
        const spot = markerSpot(state, { x: num(action.patch.x, -24, 200, prev.x), y: num(action.patch.y, -24, 200, prev.y) }, prev.id, 6);
        if (!spot) return state;
        return { ...state, terrain: { ...state.terrain, [prev.id]: { ...prev, x: spot.x, y: spot.y } } };
      }
      const t = cleanTerrain(action.patch, prev);
      return t ? { ...state, terrain: { ...state.terrain, [t.id]: t } } : state;
    }
    case 'removeTerrain': {
      const terrain = { ...state.terrain };
      delete terrain[action.id];
      return { ...state, terrain };
    }
    case 'setPhase':
      if (!isPhase(action.phase) || (state.flow.started && waitingOn(state))) return state;
      return goTo(state, action.phase, int(action.turn, 1, 99, state.turn));
    case 'nextPhase': {
      // Play waits for a model to be placed, or for the Good player to say whether they roll for Aragorn.
      if (state.flow.started && waitingOn(state)) return state;
      const i = PHASES.indexOf(state.phase);
      return i === PHASES.length - 1 ? goTo(state, PHASES[0], Math.min(99, state.turn + 1)) : goTo(state, PHASES[i + 1], state.turn);
    }
    case 'startGame':
      // A new game in the same room starts with no result.
      return {
        ...goTo(state, 'priority', 1),
        turn: 1,
        priority: null,
        result: undefined,
        flow: {
          ...newFlow(),
          started: true,
          ...(Number.isFinite(action.at) ? { startedAt: Number(action.at) } : {}),
          startFate: Object.fromEntries(Object.values(state.models).filter(m => m.hero).map(m => [m.id, m.fate])),
          // Secret picks are made before the first turn.
          ...(state.flow.picks ? { picks: state.flow.picks } : {}),
        },
      };
    case 'priorityRolled': {
      if (!isSeat(action.chooser) || !Array.isArray(action.roll)) return state;
      const roll: [number, number] = [int(action.roll[0], 1, 6, 1), int(action.roll[1], 1, 6, 1)];
      // (The last turn's chooser is kept, for a tie if Balin's Longbeard has the roll made again.)
      const lastChooser = state.flow.chooserTurn === state.turn ? state.flow.lastChooser : state.flow.chooser;
      return { ...state, flow: { ...state.flow, roll, chooser: action.chooser, chooserTurn: state.turn, ...(lastChooser ? { lastChooser } : {}) } };
    }
    case 'deployRolled': {
      const d = state.flow.deploy;
      if (state.flow.started || !isSeat(action.winner) || !procedureOf(state)) return state;
      if (action.step === 'markers') {
        if (d) return state;
        return { ...state, flow: { ...state.flow, deploy: { step: 'markers', winner: action.winner, turn: action.winner, placed: [] } } };
      }
      if (action.step !== 'side' || (d && d.step !== 'roll')) return state;
      // The armies come off the table, to go back on warband by warband.
      const off = procedureOf(state)!.armies !== 'none';
      const models = off ? Object.fromEntries(Object.entries(state.models).map(([k, m]) => [k, m.dead ? m : { ...m, waiting: true }])) : state.models;
      return { ...state, models, flow: { ...state.flow, deploy: { step: 'side', winner: action.winner, turn: action.winner, placed: [] } } };
    }
    case 'pickSide': {
      const d = state.flow.deploy;
      const p = procedureOf(state);
      if (state.flow.started || !p || d?.step !== 'side' || d.winner !== action.seat) return state;
      let out = state;
      if (action.far === true) {
        // The table turns round under the armies. Terrain picked in the enemy half is picked again.
        const unpick = ({ terrain: _, ...rest }: Picks = {}) => rest;
        const picks = state.flow.picks ? { p1: unpick(state.flow.picks.p1), p2: unpick(state.flow.picks.p2) } : undefined;
        out = { ...state, terrain: swapEnds(state, p.swap ?? 'round'), flow: { ...state.flow, ...(picks ? { picks } : {}) } };
      }
      const deploy: Deploying = p.armies === 'none' ? { ...d, step: 'done', turn: undefined } : { ...d, step: 'warbands', turn: d.winner };
      return { ...out, flow: { ...out.flow, deploy } };
    }
    case 'placeMarker': {
      const d = state.flow.deploy;
      if (state.flow.started || d?.step !== 'markers' || d.turn !== action.seat || d.marker || !objectivesMissing(state)) return state;
      const want = Number.isFinite(action.x) && Number.isFinite(action.y) ? { x: num(action.x, 0, 200, 0), y: num(action.y, 0, 200, 0) } : markerStart(state, action.seat);
      const spot = markerSpot(state, want);
      if (!spot) return state;
      const t = newMarker(state, spot);
      return { ...state, terrain: { ...state.terrain, [t.id]: t }, flow: { ...state.flow, deploy: { ...d, marker: t.id } } };
    }
    case 'markerDone': {
      const d = state.flow.deploy;
      if (state.flow.started || d?.step !== 'markers' || d.turn !== action.seat || !d.marker) return state;
      const { marker: _, ...rest } = d;
      const deploy: Deploying = objectivesMissing(state) ? { ...rest, turn: action.seat === 'p1' ? 'p2' : 'p1' } : { ...rest, step: 'roll', turn: undefined };
      return { ...state, flow: { ...state.flow, deploy } };
    }
    case 'warbandDown': {
      const d = state.flow.deploy;
      const warband = typeof action.warband === 'string' ? action.warband.slice(0, 80) : '';
      if (!isSeat(action.seat) || !d || !mayPutDown(state, action.seat, warband)) return state;
      const roll = Number.isFinite(action.roll) ? int(action.roll, 1, 6, 1) : undefined;
      const current = `${action.seat}:${warband}`;
      const bands = bandsOf(state, action.seat, true).filter(b => warband === '*' || bandKey(b[0]) === current);
      const total = bandsOf(state, action.seat).length;
      let out: GameState = { ...state, flow: { ...state.flow, deploy: { ...d, current, ...(roll ? { roll } : {}) } } };
      // Each warband comes on (its models off the table until now) in the next free lane of its zone.
      for (const band of bands) {
        const lane = d.placed.filter(k => k.startsWith(`${action.seat}:`)).length + bands.indexOf(band);
        const models = { ...out.models };
        for (const { waiting: _, ...m } of band) models[m.id] = m;
        out = { ...out, models };
        const p = procedureOf(state);
        const lanes = p?.alternateZones ? Math.ceil(total / 2) : total;
        const moves = layBand(out, band.map(m => out.models[m.id]), p?.alternateZones ? Math.floor(lane / 2) : lane, lanes);
        // Any that found no room anywhere wait still (and are left off the table).
        const room = new Set(moves.map(mv => mv.id));
        for (const m of band) if (!room.has(m.id) && !m.aboard) out.models[m.id] = { ...out.models[m.id], waiting: true };
        out = step(out, { type: 'moveModels', moves });
      }
      // So do any the table kept from where they were laid out (in their zone, near their Captain, clear of the enemy):
      // left off for good, so that the set-up can go on without them.
      // (Taking one off can change who its warband's Captain is, so look again until none is out of place.)
      const gone: string[] = [];
      for (let more = true; more; ) {
        const off = bands.flat().filter(m => !m.aboard && !gone.includes(m.id) && (out.models[m.id].waiting || misplaced(out, out.models[m.id]))).map(m => m.id);
        more = off.some(i => !out.models[i].waiting);
        gone.push(...off);
        const models = { ...out.models };
        for (const i of off) models[i] = { ...models[i], waiting: true };
        out = { ...out, models };
      }
      if (gone.length) out = { ...out, flow: { ...out.flow, deploy: { ...out.flow.deploy!, noRoom: [...(d.noRoom ?? []), ...gone] } } };
      return out;
    }
    case 'warbandDone': {
      const d = state.flow.deploy;
      if (state.flow.started || !d || d.turn !== action.seat) return state;
      let placed: string[];
      // (The Unseen Hero: the Spiders' player picks the decoy bundle before they're done.)
      if (d.step === 'sides' && isUnseen(state) && action.seat !== state.narrative!.good && !state.flow.picks?.[action.seat]?.decoy) return state;
      if (d.step === 'sides') placed = [...d.placed, `${action.seat}:*`];
      else if (d.step === 'warbands' && d.current && !deployProblems(state).length) {
        const keys = d.current.endsWith(':*') ? [...new Set(Object.values(state.models).filter(m => !m.dead && inCurrent(d, m) && !m.waiting).map(bandKey))] : [d.current];
        placed = [...d.placed, ...keys];
      } else return state;
      const { current: _c, roll: _r, ...rest } = d;
      const after = { ...state, flow: { ...state.flow, deploy: { ...rest, placed } } };
      const turn = nextTurn(after, { ...rest, placed }, action.seat);
      const deploy: Deploying = turn ? { ...rest, placed, turn } : { ...rest, placed, step: 'done', turn: undefined };
      return { ...state, flow: { ...state.flow, deploy } };
    }
    case 'choosePriority':
      if (!isSeat(action.seat) || (state.flow.started && waitingOn(state))) return state;
      return { ...goTo(state, state.phase === 'priority' ? 'move' : state.phase, state.turn), priority: action.seat };
    case 'endActivation': {
      if (!isSeat(action.seat) || state.flow.done.includes(action.seat) || state.flow.shotPause || (state.flow.started && waitingOn(state))) return state;
      // A Ringbearer in Sauron's grip is moved by its foes in its own side's activation, which waits for them.
      const grip = state.flow.compel?.ring ? state.models[state.flow.compel.model] : undefined;
      if (grip && grip.owner === action.seat && state.flow.started) return state;
      // The Unseen Hero: every Spider takes its test and moves its D6" (by whichever player won it) before its side is done.
      if (state.flow.started && isUnseen(state) && (state.flow.skitter || spidersDue(state, action.seat).length)) return state;
      // Ending a hero's Heroic Move or Heroic Shoot: it and the friends it shouted for have had their activation.
      const heroic = state.flow.started ? heroicNow(state) : null;
      if (heroic) {
        if (heroic.seat !== action.seat) return state;
        const hero = state.models[heroic.hero ?? heroicQueue(state).find(m => m.owner === action.seat)!.id];
        const went = [hero.id, ...shoutedFor(state, hero).map(f => f.id)];
        return { ...state, flow: { ...state.flow, heroicDone: [...(state.flow.heroicDone ?? []), hero.id], heroicNow: undefined, activated: [...new Set([...(state.flow.activated ?? []), ...went])] } };
      }
      // Roast Mutton: the Company still to come rolls (or comes) first, and moves on before the side is done (and the
      // same for Helm's Deep's Relief Force and Balin's Tomb's Goblin Tide).
      if (state.flow.started && (reinforcementsPending(state, action.seat) || reliefPending(state, action.seat) || tidePending(state, action.seat) || legionsPending(state, action.seat) || elvesPending(state, action.seat))) return state.flow.reinforce === action.seat ? state : { ...state, flow: { ...state.flow, reinforce: action.seat } };
      // Ambush at Night: the bound Hobbits roll to cut their bonds as the Good side finishes its move.
      if (bondsPending(state, action.seat)) return state.flow.bonds === action.seat ? state : { ...state, flow: { ...state.flow, bonds: action.seat } };
      // Ending it with a newcomer still at the edge lets it stay there, and the next one comes on.
      if (state.flow.started && state.flow.entering?.seat === action.seat && stillEntering(state)) {
        const waved = onEdge(state) ? comeOn({ ...state, flow: { ...state.flow, entering: { ...state.flow.entering, on: undefined, at: undefined } } }) : state;
        if (onEdge(waved) || nextEntering(waved)) return waved;
      }
      const done = [...state.flow.done, action.seat];
      // Once both players have activated in the Move or Shoot phase, play moves on (unless they move on themselves),
      // after the Good side at Weathertop has had its chance to roll for Aragorn.
      if (done.length === 2 && (state.phase === 'move' || state.phase === 'shoot') && state.advance !== 'click' && !arrivalDue({ ...state, flow: { ...state.flow, done } })) return goTo(state, state.phase === 'move' ? 'shoot' : 'fight', state.turn);
      // A Compel ends with its caster's side's move.
      const compel = state.flow.compel && state.models[state.flow.compel.caster]?.owner === action.seat ? undefined : state.flow.compel;
      return { ...state, flow: { ...state.flow, done, compel } };
    }
    case 'pairOff': {
      // The Priority player says who a model fights, where it touches more than one enemy, before any fight is rolled.
      const m = state.models[action.id];
      const foe = state.models[action.with];
      if (!m || !foe || m.owner === foe.owner || state.phase !== 'fight' || state.flow.resolved.length || state.flow.duels?.length) return state;
      const pairChoices = { ...state.flow.pairChoices, [m.id]: foe.id };
      const pairs = pairOff(livingModels(state), { ...state, phase: 'move' }, pairChoices).map(c => c.key);
      return { ...state, flow: { ...state.flow, pairChoices, pairs } };
    }
    case 'resolveCombat': {
      const key = str(action.key, 2000);
      if (!key || state.flow.resolved.includes(key)) return state;
      return { ...state, flow: { ...state.flow, resolved: [...state.flow.resolved, key].slice(-100) } };
    }
    case 'declareHeroic': {
      const m = state.models[action.model];
      const info = heroicInfo(str(action.action, 40));
      // A war drum calls a Heroic March for free, hero or not.
      const drum = !!m?.drum && info?.name === 'Heroic March';
      // Sam's Heroic Combat to get to Frodo costs nothing.
      // (So is Bifur's Heroic Move, once his axe is out and he has passed the test for it this turn.)
      const free = !!m && ((info?.name === 'Heroic Combat' && longshanksFree(state, m)) || (info?.name === 'Heroic Move' && !!state.flow.freeMove?.includes(m.id)));
      if (!m || (!m.hero && !drum) || m.dead || (m.might < 1 && !drum && !free) || !info || info.phase !== state.phase || cannotAct(state, m)) return state;
      if (state.flow.heroics.some(h => h.model === m.id && h.phase === state.phase)) return state;
      if ((info.name === 'Heroic Shoot' || info.name === 'Heroic Accuracy') && state.flow.started && engagedNow(state, m)) return state;
      const other: Seat = m.owner === 'p1' ? 'p2' : 'p1';
      // A Heroic Challenge names an enemy hero within 6", and a hero can have only one challenge going at a time.
      let challenges = state.flow.challenges;
      if (info.name === 'Heroic Challenge') {
        const t = state.models[str(action.target, 80)];
        const open = challenges ?? [];
        if (!t || t.dead || !t.hero || t.owner === m.owner || distanceBetween(m, t) > 6) return state;
        if (open.some(c => c.by === m.id || (c.accepted && (c.target === m.id || c.by === t.id || c.target === t.id)) || (c.accepted === false && c.target === m.id && c.by === t.id))) return state;
        challenges = [...open, { by: m.id, target: t.id, cap: int(action.cap, 0, 9, m.might) }];
      }
      return {
        ...state,
        models: drum || free ? state.models : { ...state.models, [m.id]: { ...m, might: m.might - 1 } },
        flow: {
          ...state.flow,
          heroics: [...state.flow.heroics, { model: m.id, action: info.name, phase: state.phase, ...(free ? { free: true } : {}) }],
          ...(challenges !== state.flow.challenges ? { challenges } : {}),
          // A declaration gives the other player a fresh chance to respond.
          passed: state.flow.passed.filter(s => s !== other && s !== m.owner),
          lastHeroic: m.owner,
        },
      };
    }
    case 'answerChallenge': {
      const i = (state.flow.challenges ?? []).findIndex(c => c.target === action.target && c.accepted === undefined);
      if (i < 0) return state;
      const challenges = [...state.flow.challenges!];
      challenges[i] = { ...challenges[i], accepted: action.accept === true };
      return { ...state, flow: { ...state.flow, challenges } };
    }
    case 'bannerRolled': {
      const i = state.log.findIndex(r => r.id === action.roll);
      const r = state.log[i];
      const k = int(action.die, 0, MAX_DICE, -1);
      if (!r || r.banner || k < 0 || k >= r.dice.length) return state;
      const dice = [...r.dice];
      const was = dice[k];
      dice[k] = int(action.value, 1, 6, was);
      const log = [...state.log];
      // (Not a note: a note on a duel roll marks the duel settled.)
      log[i] = { ...r, dice, banner: true, label: `${r.label.replace(/ \(F.*$/, '')}: ${str(action.by, 30)}'s banner re-rolled a ${was}`.slice(0, 80) };
      return { ...state, log };
    }
    case 'pushTower': {
      // Its pushers and those aboard go with it; the pushers' move ends, and those aboard haven't moved themselves.
      const t = state.terrain[action.id];
      if (!t || t.kind !== 'tower' || !isSeat(action.seat) || !canActivate(state, action.seat)) return state;
      const go = towerMove(state, t, action.seat, { x: num(action.x, -24, 200, t.x), y: num(action.y, -24, 200, t.y) }, m => engagedNow(state, m));
      if (!go) return state;
      const dx = go.at.x - t.x;
      const dy = go.at.y - t.y;
      const riders = new Set(aboard(state, t).map(m => m.id));
      const models = { ...state.models };
      const starts = { ...state.flow.starts };
      for (const mid of go.carry) {
        const m = models[mid];
        models[mid] = { ...m, x: m.x + dx, y: m.y + dy };
        if (riders.has(mid) && starts[mid]) starts[mid] = [starts[mid][0] + dx, starts[mid][1] + dy];
        else if (!riders.has(mid) && !starts[mid]) starts[mid] = [m.x, m.y];
      }
      const pushers = go.carry.filter(mid => !riders.has(mid));
      const flow = { ...state.flow, starts, stopped: [...new Set([...(state.flow.stopped ?? []), ...pushers])], breached: [...(state.flow.breached ?? []), t.id].slice(-200) };
      const moved: Terrain = { ...t, x: go.at.x, y: go.at.y, ...(go.onto ? { raised: go.onto } : {}) };
      return { ...state, models, flow, terrain: { ...state.terrain, [t.id]: moved } };
    }
    case 'breached': {
      if (!action.id || state.flow.breached?.includes(String(action.id))) return state;
      return { ...state, flow: { ...state.flow, breached: [...(state.flow.breached ?? []), String(action.id).slice(0, 80)].slice(-200) } };
    }
    case 'brutal': {
      // A monster's one Brutal Power Attack of the turn; a Barge lets it move again (and fight once more) this phase.
      const m = state.models[action.id];
      if (!m) return state;
      const flow = { ...state.flow, brutal: [...new Set([...(state.flow.brutal ?? []), m.id])] };
      if (action.hurledAt && state.models[action.hurledAt]) flow.hurledAt = [...new Set([...(state.flow.hurledAt ?? []), action.hurledAt])];
      if (action.barge) flow.barged = { ...state.flow.barged, [m.id]: [num(action.barge, 0, 12, 4), state.flow.resolved.length + 1] };
      return { ...state, flow };
    }
    case 'fightChoice': {
      const m = state.models[action.id];
      if (!m) return state;
      // Each special attack names an enemy (see FightPicks).
      const foe = (id: unknown) => typeof id === 'string' && !!state.models[id] && state.models[id].owner !== m.owner;
      const pick: FightPicks = { ...(action.shielding === true ? { shielding: true } : {}), ...(action.twoHanded === true ? { twoHanded: true } : {}) };
      for (const k of FIGHT_TARGETS) if (foe(action[k])) pick[k] = action[k] as string;
      const { [m.id]: _, ...rest } = state.flow.choices ?? {};
      return { ...state, flow: { ...state.flow, choices: Object.keys(pick).length ? { ...rest, [m.id]: pick } : rest } };
    }
    case 'shotPaused':
      return { ...state, flow: { ...state.flow, shotPause: action.pause ? cleanPause(action.pause) : undefined } };
    case 'heroicOrder':
      return isSeat(action.seat) ? { ...state, flow: { ...state.flow, heroicFirst: action.seat } } : state;
    case 'willOfEvil':
      return { ...state, flow: { ...state.flow, willed: state.turn } };
    case 'passHeroic':
      // (Not while Óin's player decides whether to listen through his trumpet.)
      if (state.flow.listen) return state;
      if (!isSeat(action.seat) || state.flow.passed.includes(action.seat)) return state;
      return { ...state, flow: { ...state.flow, passed: [...state.flow.passed, action.seat], lastHeroic: action.seat } };
    case 'spendWill': {
      const m = state.models[action.id];
      const n = int(action.count, 0, 9, 0);
      return m && n ? { ...state, models: { ...state.models, [m.id]: { ...m, will: Math.max(0, m.will - n) } } } : state;
    }
    case 'spellPending': {
      const s = action.spell;
      if (!s) return { ...state, flow: { ...state.flow, spell: undefined } };
      if (!state.models[s.caster] || !state.models[s.target]) return state;
      return { ...state, flow: { ...state.flow, spell: cleanSpell(s) } };
    }
    case 'startNarrative': {
      // A narrative scenario's own table and casts replace whatever was set up.
      const n = narrativeById(action.id);
      if (!n || state.flow.started || !isSeat(action.good) || !Array.isArray(action.models)) return state;
      const models: Record<string, Model> = {};
      for (const raw of action.models.slice(0, MAX_MODELS)) {
        const m = raw && typeof raw === 'object' ? cleanModel(raw) : null;
        if (m) models[m.id] = m;
      }
      const terrain: Record<string, Terrain> = {};
      for (const raw of narrativeTerrain(n, action.good)) {
        const t = cleanTerrain(raw);
        if (t) terrain[t.id] = t;
      }
      const turns = n.turns ? (n.turns.choices.includes(Number(action.turns)) ? Number(action.turns) : n.turns.default) : undefined;
      // Each side arranges its cast in the order the book sets them up.
      const first = n.setupOrder?.[0];
      const { deploy: _, ...flow } = state.flow;
      const deploy: Deploying | undefined = first ? { step: 'sides', turn: first === 'good' ? action.good : action.good === 'p1' ? 'p2' : 'p1', placed: [] } : undefined;
      return { ...state, board: { ...n.board }, models, terrain, scenario: null, vp: { p1: {}, p2: {} }, narrative: { id: n.id, good: action.good, ...(turns ? { turns } : {}) }, flow: { ...flow, ...(deploy ? { deploy } : {}) } };
    }
    case 'cry': {
      if (!isSeat(action.seat) || !mayCry(state, action.seat) || !state.narrative) return state;
      return { ...state, narrative: { ...state.narrative, cry: state.turn } };
    }
    case 'narrativeNote': {
      if (!state.narrative) return state;
      const rolled = action.rolled === undefined ? state.narrative.rolled : [...new Set([...(state.narrative.rolled ?? []), int(action.rolled, 0, 99, 0)])];
      const dawn = action.dawn === undefined ? state.narrative.dawn : int(action.dawn, 1, 99, 1);
      const breach = action.breach === undefined ? state.narrative.breach : int(action.breach, 0, 99, 0);
      const crushed = Array.isArray(action.crushed) ? [...new Set([...(state.narrative.crushed ?? []), ...action.crushed.slice(0, 60).map(x => str(x, 80))])].slice(-60) : state.narrative.crushed;
      const woke = action.woke === undefined ? state.narrative.woke : int(action.woke, 0, 99, 0);
      const webbed = action.webbed === undefined ? state.narrative.webbed : int(action.webbed, 0, 99, 0);
      const hazed = action.hazed === undefined ? state.narrative.hazed : int(action.hazed, 0, 99, 0);
      const nested = action.nested === undefined ? state.narrative.nested : int(action.nested, 0, 99, 0);
      const next = { ...state, narrative: { ...state.narrative, ...(rolled ? { rolled } : {}), ...(dawn ? { dawn } : {}), ...(breach ? { breach } : {}), ...(crushed ? { crushed } : {}), ...(woke ? { woke } : {}), ...(webbed ? { webbed } : {}), ...(hazed ? { hazed } : {}), ...(nested ? { nested } : {}) } };
      // Balin's Tomb: the Cave Troll has stepped in at the doorway, its move counted from just outside it.
      if (action.troll !== undefined && !state.narrative.troll) {
        const troll = Object.values(state.models).find(isCaveTroll);
        if (troll && !troll.waiting) {
          const off: [number, number] = [troll.x, state.board.h + radius(troll)];
          next.narrative.troll = int(action.troll, 1, 99, state.turn);
          next.flow = { ...state.flow, starts: { ...state.flow.starts, [troll.id]: off }, walked: { ...state.flow.walked, [troll.id]: 2 * radius(troll) }, paths: { ...state.flow.paths, [troll.id]: [off, [troll.x, troll.y]] } };
        }
      }
      // Amon Hen: knocked-out Hobbits who rolled a 6 come round.
      if (Array.isArray(action.revive) && isAmon(state)) return moveOn(reviveHobbits(next, action.revive.slice(0, 4).map(x => str(x, 80))));
      return moveOn(next);
    }
    case 'reliefPoint': {
      // Helm's Deep: where on the eastern half of the south edge the Relief Force rides on.
      if (!isSeat(action.seat) || !isHelms(state) || !mayChooseRelief(state, action.seat)) return state;
      return { ...state, narrative: { ...state.narrative!, relief: num(action.x, RELIEF_SPAN[0], RELIEF_SPAN[1], 36) } };
    }
    case 'entering': {
      // Reinforcements have come on (see mutton.ts): they step onto the table one by one, and then the side is done.
      if (!isSeat(action.seat) || !Array.isArray(action.ids) || state.flow.entering?.turn === state.turn) return state;
      const ids = action.ids.filter(i => state.models[i]?.waiting && state.models[i].owner === action.seat).slice(0, 40);
      const from: [number, number] = Array.isArray(action.from) ? [num(action.from[0], -24, 200, 0), num(action.from[1], -24, 200, 0)] : [0, state.board.h / 2];
      const span: [number, number] | undefined = Array.isArray(action.span) ? [num(action.span[0], 0, 200, 0), num(action.span[1], 0, 200, 200)] : undefined;
      // Balin's Tomb: those coming up through a trapdoor or out of the well are put there at once, their move counted from there.
      let models = state.models;
      let starts = state.flow.starts;
      for (const sp of Array.isArray(action.spots) ? action.spots.slice(0, 40) : []) {
        const m = Array.isArray(sp) ? models[str(sp[0], 80)] : undefined;
        if (!m || !ids.includes(m.id) || !m.waiting) continue;
        const { waiting: _, ...rest } = m;
        const at = { x: num(sp[1], 0, state.board.w, m.x), y: num(sp[2], 0, state.board.h, m.y) };
        models = { ...models, [m.id]: { ...rest, ...at, rot: Math.round((Math.atan2(state.board.w / 2 - at.x, at.y - state.board.h / 2) * 180) / Math.PI + 360) % 360 } };
        starts = { ...starts, [m.id]: [at.x, at.y] };
      }
      // (Back from the dead, they have their move to make whatever they did before they fell.)
      const fresh = (list?: string[]) => list?.filter(i => !ids.includes(i));
      const flow = { ...state.flow, starts, stopped: fresh(state.flow.stopped), activated: fresh(state.flow.activated) };
      const next = comeOn({ ...state, models, flow: { ...flow, entering: { seat: action.seat, ids, from, turn: state.turn, ...(span ? { span } : {}), ...(action.charge === true ? { charge: true } : {}) } } });
      // Nobody came: the side's move is over.
      return ids.length ? next : step(next, { type: 'endActivation', seat: action.seat });
    }
    case 'burned':
      return { ...state, flow: { ...state.flow, burned: state.turn } };
    case 'usedTurn': {
      // A once-a-turn ability has been used (Kíli and Fíli's swap is once a phase, and lets them re-roll in the fights).
      const key = `${str(action.key, 40)}:${str(action.model, 80)}`;
      if (state.flow.usedTurn?.includes(key)) return state;
      return { ...state, flow: { ...state.flow, usedTurn: [...(state.flow.usedTurn ?? []), key].slice(-60), ...(key.startsWith('swap-') ? { synergy: state.turn } : {}) } };
    }
    case 'freeMove':
      return state.models[action.model] ? { ...state, flow: { ...state.flow, freeMove: [...new Set([...(state.flow.freeMove ?? []), action.model])] } } : state;
    case 'heard': {
      const key = str(action.key, 120);
      return { ...state, flow: { ...state.flow, heard: [...(state.flow.heard ?? []), key].slice(-40), listen: state.flow.listen === key ? undefined : state.flow.listen } };
    }
    case 'chronicle': {
      const add = (action.add ?? []).filter(c => isSeat(c.seat) && Array.isArray(c.ids)).map(c => ({ seat: c.seat, ids: c.ids.filter(id => state.models[id]).slice(0, 20) })).filter(c => c.ids.length);
      const left = [...(state.flow.chronicles ?? []).slice(action.done ? 1 : 0), ...add].slice(0, 10);
      return { ...state, flow: { ...state.flow, chronicles: left.length ? left : undefined } };
    }
    case 'listen':
      return { ...state, flow: { ...state.flow, listen: str(action.key, 120) } };
    case 'freeHeroic': {
      // Óin, hearing an enemy hero's heroic action, calls the same one for nothing.
      const m = state.models[action.model];
      const info = heroicInfo(str(action.action, 40));
      if (!m || m.dead || !m.hero || !info || info.phase !== state.phase || state.flow.heroics.some(h => h.model === m.id && h.phase === state.phase)) return state;
      const other: Seat = m.owner === 'p1' ? 'p2' : 'p1';
      // A Heroic Challenge he copies goes at the hero who issued it (the game checked he may challenge it).
      const t = info.name === 'Heroic Challenge' ? state.models[str(action.target, 80)] : undefined;
      if (info.name === 'Heroic Challenge' && (!t || t.dead || t.owner === m.owner || (state.flow.challenges ?? []).some(c => c.by === m.id))) return state;
      const challenges = t ? [...(state.flow.challenges ?? []), { by: m.id, target: t.id, cap: m.might }] : state.flow.challenges;
      return { ...state, flow: { ...state.flow, heroics: [...state.flow.heroics, { model: m.id, action: info.name, phase: state.phase, free: true }], ...(t ? { challenges } : {}), passed: state.flow.passed.filter(x => x !== other && x !== m.owner), lastHeroic: m.owner } };
    }
    case 'dieRerolled': {
      // Combat Synergy, or Óin reading the portents: one die of a duel roll rolled again.
      const i = state.log.findIndex(r => r.id === action.roll);
      const r = state.log[i];
      const k = int(action.die, 0, MAX_DICE, -1);
      const why = action.why === 'synergy' || action.why === 'portents' ? action.why : null;
      if (!r || !why || r.rerolled?.includes(why) || k < 0 || k >= r.dice.length) return state;
      const dice = [...r.dice];
      const was = dice[k];
      dice[k] = int(action.value, 1, 6, was);
      const log = [...state.log];
      // (Not a note: a note on a duel roll marks the duel settled.)
      log[i] = { ...r, dice, rerolled: [...(r.rerolled ?? []), why], label: `${r.label.replace(/ \(F.*$/, '')}: ${str(action.by, 40)} re-rolled a ${was}`.slice(0, 80) };
      return { ...state, log };
    }
    case 'placing': {
      const p = cleanPlacing(action.placing, state);
      if (!p) return state;
      // A follow-up move the game placed is the model's last move this phase.
      const joined = p.kind === 'join' ? { joined: [...new Set([...(state.flow.joined ?? []), p.model])] } : {};
      return { ...state, flow: { ...state.flow, placing: [...(state.flow.placing ?? []), p], ...joined } };
    }
    case 'mightyHero':
      if (!action.base || typeof action.base !== 'object') return state;
      return { ...state, flow: { ...state.flow, mighty: { turn: state.turn, base: cleanCounts(action.base, 9) } } };
    case 'placed': {
      const p = placingNow(state);
      if (!p || p.seat !== action.seat) return state;
      return moveOn({ ...state, flow: { ...state.flow, placing: state.flow.placing!.slice(1) } });
    }
    case 'skittering': {
      const sk = action.skitter;
      const m = sk && state.models[id(sk.model)];
      if (!m || !isSeat(sk.by) || state.flow.skitter) return state;
      const skitter = { model: m.id, by: sk.by, dist: int(sk.dist, 1, 6, 1) };
      return { ...state, flow: { ...state.flow, skitter, skittered: [...new Set([...(state.flow.skittered ?? []), m.id])] } };
    }
    case 'skitterDone': {
      const sk = state.flow.skitter;
      if (!sk || action.seat !== sk.by || !skitterDone(state)) return state;
      return { ...state, flow: { ...state.flow, skitter: undefined, stopped: [...new Set([...(state.flow.stopped ?? []), sk.model])] } };
    }
    case 'ringMark': {
      if (action.key !== 'sauron' && action.key !== 'ringTried' && action.key !== 'sought') return state;
      return { ...state, flow: { ...state.flow, [action.key]: [...new Set([...(state.flow[action.key] ?? []), id(action.id)])] } };
    }
    case 'affect': {
      const prev = state.models[action.id];
      if (!prev || !action.patch || typeof action.patch !== 'object') return state;
      const m = cleanModel(action.patch, prev);
      return m ? { ...state, models: { ...state.models, [m.id]: m } } : state;
    }
    case 'compel': {
      const c = action.compel;
      if (!c) {
        if (!state.flow.compel) return state;
        return { ...state, flow: { ...state.flow, compel: undefined } };
      }
      const t = state.models[id(c.model)];
      if (!t || !state.models[id(c.caster)] || !Array.isArray(c.from)) return state;
      const compel = { model: t.id, caster: id(c.caster), max: num(c.max, 0, 12, 0), from: [num(c.from[0], -24, 200, t.x), num(c.from[1], -24, 200, t.y)] as [number, number], ...(c.ring === true ? { ring: true } : {}) };
      // Once Compelled it can't move again this turn, whatever happens.
      return { ...state, flow: { ...state.flow, compel, held: [...new Set([...(state.flow.held ?? []), t.id])] } };
    }
    case 'recovered':
      return { ...state, flow: { ...state.flow, recovered: state.turn } };
    case 'letSpellFail': {
      const p = pendingSpell(state);
      if (!p || p.cast) return state;
      return { ...state, flow: { ...state.flow, spell: undefined }, log: state.log.map(r => (r.id === p.roll ? { ...r, note: 'The power fails.' } : r)) };
    }
    case 'useMight': {
      const i = state.log.findIndex(r => r.id === action.roll);
      const r = state.log[i];
      const m = r?.model ? state.models[r.model] : undefined;
      const will = action.will === true;
      if (!r || !m || !m.hero || (will ? m.will < 1 : m.might < 1)) return state;
      // Will can only help with a Courage test.
      const courage = r.sum !== undefined && /^Courage/.test(r.label);
      if (will && !courage) return state;
      // Only while the roll's result is still to be used (see mightUse.ts).
      if (mightBlocked(state, r)) return state;
      const k = int(action.die, 0, MAX_DICE, -1);
      // Raising a first die of a 6/4+ roll would need a new follow-up die, so only the follow-ups can be raised there.
      const follow = r.then !== undefined && r.follow !== undefined;
      if (follow !== (action.follow === true)) return state;
      const dice = follow ? [...r.follow!] : [...r.dice];
      if (k < 0 || k >= dice.length || dice[k] >= 6) return state;
      dice[k]++;
      const roll: DiceRoll = { ...r, ...(follow ? { follow: dice } : { dice }), might: (r.might ?? 0) + 1 };
      const log = [...state.log];
      log[i] = roll;
      let hero: Model = will ? { ...m, will: m.will - 1 } : { ...m, might: m.might - 1 };
      // Might that turns a failed Fate roll into a 4+ saves the wound.
      if (hero.fateRoll === r.id && roll.dice[0] >= 4) hero = { ...hero, pending: (hero.pending ?? 1) - 1, fateRoll: undefined };
      // A Courage test that now passes counts as passed (a charge at a terrifying enemy can go ahead).
      const flow = courage && roll.dice[0] + roll.dice[1] >= roll.sum! && state.flow.courage?.[m.id] === false ? { ...state.flow, courage: { ...state.flow.courage, [m.id]: true } } : state.flow;
      let models = { ...state.models, [m.id]: settle(hero) };
      // Might that makes a recovery roll a 6 frees the Paralysed model (from a Troll's sack too).
      const held = roll.frees ? models[roll.frees] : undefined;
      if (held && roll.target === 6 && roll.dice[0] === 6 && held.effects?.some(e => basePower(e.power) === 'Paralyse')) models = { ...models, [held.id]: { ...held, effects: held.effects.filter(e => basePower(e.power) !== 'Paralyse') } };
      return ringAfterMight(afterMight({ ...state, log, flow, models }, roll.id), roll);
    }
    case 'wound': {
      const m = state.models[action.id];
      const n = int(action.count, 0, 30, 0);
      // Each fight or shot's wounds are taken once, whoever presses the button first.
      const group = action.group === undefined ? '' : str(action.group, 80);
      // (Wounds the model shrugged off all of are still ticked off, so they aren't taken again.)
      if (m && !m.dead && !n && action.checked === true && group) {
        const key = `${group}>${m.id}${action.mount === true ? '#mount' : ''}`;
        return state.flow.applied?.includes(key) ? state : { ...state, flow: { ...state.flow, applied: [...(state.flow.applied ?? []), key].slice(-80) } };
      }
      if (!m || m.dead || !n) return state;
      // A rider's mount takes its own wounds; when it falls, the rider is thrown (the game rolls the test).
      if (action.mount === true) {
        if (!mounted(m) || !m.mount || (group && woundsTaken(state.flow.applied, group, `${m.id}#mount`))) return state;
        const left = Math.max(0, (m.mountWounds ?? mountProfile(m.mount)?.w ?? 1) - n);
        // A hero whose chariot is wrecked is knocked flying from it.
        const rider: Model = { ...m, mountWounds: left, ...(left ? {} : { throwPending: mountProfile(m.mount)?.chariot ? ('flying' as const) : ('test' as const) }) };
        const flow = group ? { ...state.flow, applied: [...(state.flow.applied ?? []), `${group}>${m.id}#mount`].slice(-80) } : state.flow;
        return { ...state, flow, models: { ...state.models, [m.id]: rider } };
      }
      // A war beast's Howdah takes its own wounds; when it's destroyed, those in it fall (the game rolls it).
      if (action.howdah === true) {
        if (m.beast !== 'war' || !m.howdahWounds || (group && woundsTaken(state.flow.applied, group, `${m.id}#howdah`))) return state;
        const flow = group ? { ...state.flow, applied: [...(state.flow.applied ?? []), `${group}>${m.id}#howdah`].slice(-80) } : state.flow;
        return { ...state, flow, models: { ...state.models, [m.id]: { ...m, howdahWounds: Math.max(0, m.howdahWounds - n) } } };
      }
      if (group && woundsTaken(state.flow.applied, group, m.id)) return state;
      // Plenty of Orcs: a Great Beast's Commander that would fall is replaced from the Howdah, which takes the wound.
      const ridden = m.aboard ? state.models[m.aboard] : undefined;
      if (ridden && /great beast/i.test(ridden.name) && /commander/i.test(m.name) && n >= m.wounds && ridden.howdahWounds) {
        const flow = group ? { ...state.flow, applied: [...(state.flow.applied ?? []), `${group}>${m.id}`].slice(-80) } : state.flow;
        const keep = Math.max(1, m.wounds - n + 1);
        return { ...state, flow, models: { ...state.models, [m.id]: { ...m, wounds: keep }, [ridden.id]: { ...ridden, howdahWounds: Math.max(0, ridden.howdahWounds - (n - m.wounds + 1)) } } };
      }
      const by = Array.isArray(action.by) ? action.by.filter(i => typeof i === 'string' && state.models[i]) : [];
      const struck = { ...m, ...(by.length ? { lastHit: cleanHit({ ids: by, how: action.how }) } : { lastHit: undefined }), ...(action.slay === true ? { slay: true } : {}) };
      const taken = m.hero && m.fate > 0 ? { ...struck, pending: (m.pending ?? 0) + n } : takeWounds(struck, n);
      // A war beast tests for Stampede for every wound it takes (the game rolls it).
      const hit = m.beast === 'war' ? { ...taken, stampedeTests: (m.stampedeTests ?? 0) + Math.min(n, m.wounds) } : taken;
      // A fight's strikes can wound several models, so each one's share is ticked off separately.
      const flow = group ? { ...state.flow, applied: [...(state.flow.applied ?? []), `${group}>${m.id}`].slice(-80) } : state.flow;
      return { ...state, flow, models: { ...state.models, [m.id]: hit } };
    }
    case 'fateRolled': {
      const m = state.models[action.id];
      const r = cleanRoll(action.roll);
      if (!m || !r || !m.pending || m.fate < 1) return state;
      const saved = r.dice[0] >= 4;
      const hero: Model = { ...m, fate: m.fate - 1, pending: saved ? m.pending - 1 : m.pending, fateRoll: saved ? undefined : r.id };
      return { ...state, log: [...state.log, r].slice(-MAX_LOG), models: { ...state.models, [m.id]: settle(hero) } };
    }
    case 'takeWound': {
      const m = state.models[action.id];
      if (!m || !m.pending) return state;
      const n = action.all ? m.pending : 1;
      const hit = takeWounds({ ...m, pending: m.pending - n, fateRoll: undefined }, n);
      return { ...state, models: { ...state.models, [m.id]: settle(hit) } };
    }
    case 'pickUp': {
      const m = state.models[action.model];
      const t = state.terrain[action.marker];
      if (!m || !t || !canPickUp(state, m, t)) return state;
      return { ...state, terrain: { ...state.terrain, [t.id]: { ...t, carrier: m.id } } };
    }
    case 'drop': {
      const t = state.terrain[action.marker];
      // Heirlooms can't be put down.
      if (!t?.carrier || t.object === 'heirloom') return state;
      const { carrier: _c, ...rest } = t;
      return { ...state, terrain: { ...state.terrain, [t.id]: rest } };
    }
    case 'flip': {
      const m = state.models[action.model];
      const t = state.terrain[action.marker];
      if (!m || m.dead || m.escaped || !t?.hidden || (t.object !== 'heirloom' && t.object !== 'decoy') || !touching(m, t)) return state;
      // A decoy is taken away; the real Heirloom goes straight to whoever found it.
      const next: Terrain = t.object === 'decoy' ? { ...t, hidden: undefined, gone: 'revealed', by: m.owner } : { ...t, hidden: undefined, carrier: m.id };
      return { ...state, terrain: { ...state.terrain, [t.id]: cleanTerrain(next, t)! } };
    }
    case 'uncovered': {
      const m = state.models[action.model];
      const t = state.terrain[action.marker];
      const r = cleanRoll(action.roll);
      if (!m || !t || !r || t.object !== 'artefact' || !t.hidden) return state;
      const passed = r.dice.reduce((a, b) => a + b, 0) >= (r.sum ?? 7);
      const next: Terrain = { ...t, tried: { ...t.tried, [m.owner]: state.turn }, ...(passed ? { hidden: undefined, carrier: m.id } : {}) };
      return { ...state, log: [...state.log, r].slice(-MAX_LOG), terrain: { ...state.terrain, [t.id]: cleanTerrain(next, t)! } };
    }
    case 'escape': {
      const m = state.models[action.model];
      if (!m || !canEscape(state, m)) return state;
      return { ...state, models: { ...state.models, [m.id]: { ...m, escaped: true } } };
    }
    case 'setPick': {
      if (!isSeat(action.seat) || !PICK_KEYS.includes(action.key)) return state;
      // The decoy is a webbed bundle, chosen by the Spiders' player before the battle and kept to.
      if (action.key === 'decoy' && (state.flow.started || !isUnseen(state) || action.seat === state.narrative!.good || state.terrain[String(action.value)]?.object !== 'cocoon')) return state;
      // The Elves of Mirkwood: the Good player chooses the edge the Elves come on from, any time before they do.
      if (action.key === 'edge' && (!isElves(state) || action.seat !== state.narrative!.good || !(EDGES as readonly unknown[]).includes(action.value) || elvesWaiting(state).length === 0)) return state;
      const value = typeof action.value === 'string' && (state.models[action.value] || state.terrain[action.value] || action.key === 'edge') ? action.value : undefined;
      const mine: Picks = { ...state.flow.picks?.[action.seat] };
      if (value) mine[action.key] = value;
      else delete mine[action.key];
      const picks = { p1: {}, p2: {}, ...state.flow.picks, [action.seat]: mine };
      return { ...state, flow: { ...state.flow, picks } };
    }
    case 'setBot': {
      if (action.seat === null) return { ...state, bot: undefined };
      if (!isSeat(action.seat)) return state;
      // Nobody else can join a solo game, so it leaves the open games list.
      return { ...state, bot: action.seat, listed: false, names: { ...state.names, [action.seat]: state.names[action.seat] || BOT_NAME } };
    }
    case 'setAdvance': {
      const { advance: _, ...rest } = state;
      return action.click ? { ...rest, advance: 'click' } : rest;
    }
    case 'setBotSpeed':
      return BOT_SPEEDS.includes(action.speed) ? { ...state, botSpeed: action.speed === 'normal' ? undefined : action.speed } : state;
    case 'setBotInstantMoves': {
      const { botInstantMoves: _, ...rest } = state;
      return action.on === true ? { ...rest, botInstantMoves: true } : rest;
    }
    case 'setPriority':
      return { ...state, priority: isSeat(action.seat) ? action.seat : null };
    case 'setScenario': {
      const id = action.id === null ? null : str(action.id, 40) || null;
      // Choosing a matched play scenario (or open play) leaves any narrative one behind, and starts setting up afresh.
      const { narrative: _, ...rest } = unDeploy(state);
      return { ...rest, scenario: id, vp: { p1: {}, p2: {} } };
    }
    case 'setVP': {
      if (!isSeat(action.seat)) return state;
      const key = str(action.key, 40);
      if (!key) return state;
      const tally = { ...state.vp[action.seat] };
      const value = int(action.value, 0, 99, 0);
      if (value) tally[key] = value;
      else delete tally[key];
      if (Object.keys(tally).length > 40) return state;
      return { ...state, vp: { ...state.vp, [action.seat]: tally } };
    }
    case 'setListed':
      return { ...state, listed: action.listed !== false && !state.private };
    case 'setPrivate':
      return action.private ? { ...state, private: true, listed: false } : { ...state, private: undefined };
    case 'setName':
      if (!isSeat(action.seat)) return state;
      return { ...state, names: { ...state.names, [action.seat]: str(action.name, 40) } };
    case 'setBoard':
      return {
        ...state,
        board: { w: int(action.w, 12, 96, state.board.w), h: int(action.h, 12, 96, state.board.h), mat: isMat(action.mat) ? action.mat : state.board.mat },
      };
    case 'setScenery': {
      if (!Array.isArray(action.terrain)) return state;
      let out: GameState = { ...unDeploy(state), terrain: {} };
      out = reduce(out, { type: 'setBoard', w: action.w, h: action.h, mat: action.mat });
      for (const t of action.terrain.slice(0, MAX_TERRAIN)) out = reduce(out, { type: 'addTerrain', terrain: t });
      return out;
    }
    case 'rolled': {
      const r = cleanRoll(action.roll);
      if (!r) return state;
      const log = [...state.log, r];
      // A shot's first roll marks its shooter as having shot this turn.
      const shooter = r.group?.startsWith('s-') && r.id === `${r.group}-0` ? r.model : undefined;
      // (Once for each Shooting Attack, for models that make more than one: a Pinpoint Shot counts as all three.)
      let flow = shooter ? { ...state.flow, shot: [...(state.flow.shot ?? []), ...Array(r.pinpoint ? 3 : 1).fill(shooter)].slice(-400) } : state.flow;
      // A weapon thrown as a model charges commits it to charging that target.
      if (shooter && r.charge && r.aim) flow = { ...flow, mustCharge: { model: shooter, target: r.aim } };
      if (r.id.startsWith('w-') && r.model && !flow.cast?.includes(r.model)) flow = { ...flow, cast: [...(flow.cast ?? []), r.model].slice(-200) };
      // So does a duel's first roll, for its fight (after any Heroic Strike roll).
      if (r.group?.startsWith('f-') && r.side !== undefined && !flow.duels?.includes(r.group)) flow = { ...flow, duels: [...(flow.duels ?? []), r.group].slice(-200) };
      // A spear or pike that supports a fight can't support another this phase.
      if (r.support && r.model && !flow.supported?.includes(r.model)) flow = { ...flow, supported: [...(flow.supported ?? []), r.model].slice(-400) };
      // A hero's Heroic Strike bonus lasts the whole phase.
      if (r.group?.startsWith('f-') && r.label.startsWith('Heroic Strike') && r.model) flow = { ...flow, strikeBonus: { ...flow.strikeBonus, [r.model]: r.dice[0] } };
      return { ...state, flow, log: log.slice(-MAX_LOG) };
    }
    case 'loadState':
      return loadState(action.state);
    case 'seatAccount': {
      if (!isSeat(action.seat)) return state;
      const a = action.account;
      const accounts = { ...state.accounts };
      if (a && typeof a.id === 'string' && typeof a.name === 'string') accounts[action.seat] = { id: a.id.slice(0, 64), name: a.name.slice(0, 32) };
      else delete accounts[action.seat];
      return { ...state, accounts };
    }
    case 'proposeResult': {
      // Wins come from the game itself or a concession; players can only offer each other a draw.
      if (!isSeat(action.seat) || action.winner !== 'draw' || state.result) return state;
      return { ...state, result: { winner: action.winner, by: action.seat, agreed: false } };
    }
    case 'answerResult': {
      const r = state.result;
      if (!r || r.saved || r.agreed || !isSeat(action.seat)) return state;
      if (r.by === 'game') {
        if (!action.agree) return state;
        const confirmed = [...new Set([...(r.confirmed ?? []), action.seat])];
        return { ...state, result: { ...r, confirmed, agreed: confirmed.length === 2 } };
      }
      if (!action.agree) return { ...state, result: undefined };
      return action.seat === r.by ? state : { ...state, result: { ...r, agreed: true } };
    }
    case 'concede': {
      if (!isSeat(action.seat) || state.result?.agreed) return state;
      return { ...state, result: { winner: action.seat === 'p1' ? 'p2' : 'p1', by: action.seat, agreed: true } };
    }
    case 'gameOver': {
      const w = action.winner;
      if (!(isSeat(w) || w === 'draw') || state.result?.agreed || (state.result && state.result.by !== 'game')) return state;
      if (state.result?.winner === w) return state;
      // A model still in a Troll's sack when the game ends counts as slain.
      const bagged = Object.values(state.models).filter(m => !m.dead && m.effects?.some(e => e.sack));
      const models = bagged.length ? { ...state.models, ...Object.fromEntries(bagged.map(m => [m.id, { ...m, dead: true, wounds: 0 }])) } : state.models;
      return { ...state, models, result: { winner: w, by: 'game', confirmed: [], agreed: false } };
    }
    case 'resultSaved':
      return state.result?.agreed ? { ...state, result: { ...state.result, saved: true } } : state;
    case 'revert': {
      const r = action.revert;
      if (!r || typeof r !== 'object') return state;
      let out = state;
      if (r.models) {
        const models = { ...out.models };
        for (const [mid, m] of Object.entries(r.models)) {
          const clean = m && cleanModel(m);
          if (clean) models[mid] = clean;
          else delete models[mid];
        }
        out = { ...out, models };
      }
      if (r.terrain) {
        const terrain = { ...out.terrain };
        for (const [tid, t] of Object.entries(r.terrain)) {
          const clean = t && cleanTerrain(t);
          if (clean) terrain[tid] = clean;
          else delete terrain[tid];
        }
        out = { ...out, terrain };
      }
      const f = r.fields;
      if (f) {
        // Rebuild the fields through the same cleaning a saved game gets.
        const fixed = loadState({ ...out, ...f, log: [] });
        out = { ...out, ...Object.fromEntries(Object.keys(f).map(k => [k, fixed[k as keyof GameState]])) };
      }
      return out;
    }
    case 'undo':
    case 'fight':
    case 'strikes':
    case 'rollFate':
    case 'shoot':
    case 'rollPriority':
    case 'rollDeploy':
    case 'deployWarband':
    case 'roll':
    default:
      return state;
  }
}

const TESTS = ['Jump', 'Climb', 'Climb down', 'Leap'] as const;
/** Where models were stopped to take a terrain test, from untrusted JSON. */
function cleanBlocked(raw: object): NonNullable<Flow['blocked']> {
  const out: NonNullable<Flow['blocked']> = {};
  for (const [k, v] of Object.entries(raw).slice(0, 400)) {
    const b = v as Record<string, unknown>;
    const pt = (p: unknown): [number, number] => (Array.isArray(p) ? [num(p[0], -24, 200, 0), num(p[1], -24, 200, 0)] : [0, 0]);
    if (!b || !TESTS.includes(b.test as (typeof TESTS)[number])) continue;
    out[str(k, 80)] = { terrain: str(b.terrain, 80), test: b.test as (typeof TESTS)[number], stop: pt(b.stop), landing: pt(b.landing), drop: num(b.drop, 0, 50, 0) };
  }
  return out;
}

/** Setting up starts afresh (a new scenario or table): the armies that were waiting for their turn come back where they were. */
function unDeploy(state: GameState): GameState {
  if (!state.flow.deploy || state.flow.started) return state;
  const { deploy: _, ...flow } = state.flow;
  const { w, h } = state.board;
  const models = Object.fromEntries(Object.entries(state.models).map(([k, m]) => [k, m.waiting && m.x >= 0 && m.y >= 0 && m.x <= w && m.y <= h ? (({ waiting: _w, ...rest }) => rest)(m) : m]));
  return { ...state, models, flow };
}

const DEPLOY_STEPS = ['markers', 'roll', 'side', 'warbands', 'sides', 'done'] as const;
/** Where setting up in turn is up to, from untrusted JSON. */
function cleanDeploy(raw: unknown): Deploying | null {
  const d = raw as Partial<Deploying> | null;
  if (!d || typeof d !== 'object' || !DEPLOY_STEPS.includes(d.step as (typeof DEPLOY_STEPS)[number])) return null;
  return {
    step: d.step!,
    placed: Array.isArray(d.placed) ? d.placed.slice(0, 200).map(k => str(k, 120)) : [],
    ...(isSeat(d.winner) ? { winner: d.winner } : {}),
    ...(isSeat(d.turn) ? { turn: d.turn } : {}),
    ...(typeof d.current === 'string' ? { current: str(d.current, 120) } : {}),
    ...(Number.isFinite(d.roll) ? { roll: int(d.roll, 1, 6, 1) } : {}),
    ...(typeof d.marker === 'string' ? { marker: str(d.marker, 80) } : {}),
    ...(Array.isArray(d.noRoom) ? { noRoom: d.noRoom.slice(0, MAX_MODELS).map(k => str(k, 80)) } : {}),
  };
}

/** Rebuilds a full state from untrusted JSON (a saved game or a server snapshot). */
export function loadState(raw: unknown): GameState {
  const s = initialState();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Partial<GameState>;
  let out: GameState = reduce(s, { type: 'setBoard', w: o.board?.w ?? 48, h: o.board?.h ?? 48, mat: o.board?.mat });
  out = reduce(out, { type: 'addModels', models: Object.values(o.models ?? {}) });
  for (const t of Object.values(o.terrain ?? {})) out = reduce(out, { type: 'addTerrain', terrain: t });
  if (isPhase(o.phase)) out = reduce(out, { type: 'setPhase', phase: o.phase, turn: o.turn });
  out = reduce(out, { type: 'setPriority', seat: o.priority ?? null });
  for (const seat of ['p1', 'p2'] as const) {
    const n = o.names?.[seat];
    if (n) out = reduce(out, { type: 'setName', seat, name: n });
  }
  if (typeof o.scenario === 'string') out = reduce(out, { type: 'setScenario', id: o.scenario });
  for (const seat of ['p1', 'p2'] as const) {
    for (const [key, value] of Object.entries(o.vp?.[seat] ?? {}).slice(0, 40)) out = reduce(out, { type: 'setVP', seat, key, value: value as number });
  }
  if (o.listed === false) out = { ...out, listed: false };
  if (o.private === true) out = { ...out, private: true, listed: false };
  if (isSeat(o.bot)) out = { ...out, bot: o.bot };
  if (o.botSpeed) out = reduce(out, { type: 'setBotSpeed', speed: o.botSpeed });
  if (o.botInstantMoves === true) out = { ...out, botInstantMoves: true };
  if (o.advance === 'click') out = { ...out, advance: 'click' };
  const n = o.narrative;
  if (n && typeof n === 'object' && narrativeById(n.id) && isSeat(n.good))
    out = { ...out, narrative: { id: n.id, good: n.good, ...(Number.isFinite(n.cry) ? { cry: int(n.cry, 0, 99, 0) } : {}), ...(Array.isArray(n.rolled) ? { rolled: n.rolled.slice(0, 40).map(t => int(t, 0, 99, 0)) } : {}), ...(Number.isFinite(n.dawn) ? { dawn: int(n.dawn, 1, 99, 1) } : {}), ...(n.bilbo === true ? { bilbo: true } : {}), ...(Number.isFinite(n.turns) ? { turns: int(n.turns, 1, 40, 15) } : {}), ...(Number.isFinite(n.relief) ? { relief: num(n.relief, 0, 200, 36) } : {}), ...(Number.isFinite(n.breach) ? { breach: int(n.breach, 0, 99, 0) } : {}), ...(Number.isFinite(n.troll) ? { troll: int(n.troll, 1, 99, 1) } : {}), ...(Array.isArray(n.crushed) ? { crushed: n.crushed.slice(0, 60).map(x => str(x, 80)) } : {}), ...(Number.isFinite(n.woke) ? { woke: int(n.woke, 0, 99, 0) } : {}), ...(Number.isFinite(n.webbed) ? { webbed: int(n.webbed, 0, 99, 0) } : {}), ...(Number.isFinite(n.hazed) ? { hazed: int(n.hazed, 0, 99, 0) } : {}), ...(Number.isFinite(n.nested) ? { nested: int(n.nested, 0, 99, 0) } : {}) } };
  if (o.flow && typeof o.flow === 'object') {
    const f = o.flow as Partial<Flow>;
    const seats = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isSeat))] : []);
    out = {
      ...out,
      flow: {
        started: f.started === true,
        chooser: isSeat(f.chooser) ? f.chooser : null,
        chooserTurn: int(f.chooserTurn, 0, 99, 0),
        roll: Array.isArray(f.roll) && f.roll.length === 2 ? [int(f.roll[0], 1, 6, 1), int(f.roll[1], 1, 6, 1)] : null,
        done: seats(f.done),
        resolved: Array.isArray(f.resolved) ? f.resolved.filter(k => typeof k === 'string').map(k => k.slice(0, 2000)).slice(-100) : [],
        heroics: Array.isArray(f.heroics)
          ? f.heroics
              .filter(h => h && typeof h === 'object' && heroicInfo(h.action) && isPhase(h.phase))
              .map(h => ({ model: id(h.model), action: heroicInfo(h.action)!.name, phase: h.phase, ...(h.free === true ? { free: true } : {}) }))
              .slice(-60)
          : [],
        passed: seats(f.passed),
        lastHeroic: isSeat(f.lastHeroic) ? f.lastHeroic : null,
        ...(Number.isFinite(f.startedAt) ? { startedAt: Number(f.startedAt) } : {}),
        ...(f.starts ? { starts: cleanStarts(f.starts) } : {}),
        ...(f.paths && typeof f.paths === 'object' ? { paths: Object.fromEntries(Object.entries(f.paths).slice(0, 400).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k.slice(0, 80), capTrail((v as unknown[]).filter(Array.isArray).map(q => [num((q as unknown[])[0], -24, 200, 0), num((q as unknown[])[1], -24, 200, 0)] as [number, number]))])) } : {}),
        ...(f.walked && typeof f.walked === 'object' ? { walked: Object.fromEntries(Object.entries(f.walked).slice(0, 400).map(([k, v]) => [k.slice(0, 80), num(v, 0, 100, 0)])) } : {}),
        ...(f.courage && typeof f.courage === 'object' ? { courage: Object.fromEntries(Object.entries(f.courage).slice(0, 400).map(([k, v]) => [k.slice(0, 80), v === true])) } : {}),
        ...(f.braved ? { braved: seats(f.braved) } : {}),
        ...(f.arrived ? { arrived: seats(f.arrived) } : {}),
        ...(Array.isArray(f.shot) ? { shot: f.shot.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.cast) ? { cast: f.cast.slice(0, 200).map(x => String(x).slice(0, 80)) } : {}),
        ...(f.spell && typeof f.spell === 'object' ? { spell: cleanSpell(f.spell) } : {}),
        ...(Array.isArray(f.held) ? { held: f.held.slice(0, 200).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.stood) ? { stood: f.stood.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.pairs) ? { pairs: f.pairs.slice(0, 200).map(x => String(x).slice(0, 2000)) } : {}),
        ...(f.pairChoices && typeof f.pairChoices === 'object' ? { pairChoices: Object.fromEntries(Object.entries(f.pairChoices).slice(0, 200).map(([k, v]) => [k.slice(0, 80), String(v).slice(0, 80)])) } : {}),
        ...(Array.isArray(f.supported) ? { supported: f.supported.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(f.strikeBonus && typeof f.strikeBonus === 'object' ? { strikeBonus: Object.fromEntries(Object.entries(f.strikeBonus).slice(0, 100).map(([k, v]) => [k.slice(0, 80), int(v, 1, 3, 1)])) } : {}),
        ...(f.climbed && typeof f.climbed === 'object' ? { climbed: Object.fromEntries(Object.entries(f.climbed).slice(0, 400).map(([k, v]) => [k.slice(0, 80), num(v, 0, 99, 0)])) } : {}),
        ...(Number.isFinite(f.recovered) ? { recovered: int(f.recovered, 0, 99, 0) } : {}),
        ...(Array.isArray(f.farMoved) ? { farMoved: f.farMoved.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.moved) ? { moved: f.moved.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.stopped) ? { stopped: f.stopped.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.crawling) ? { crawling: f.crawling.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(Array.isArray(f.lay) ? { lay: f.lay.slice(0, 400).map(x => String(x).slice(0, 80)) } : {}),
        ...(f.crossed && typeof f.crossed === 'object' ? { crossed: Object.fromEntries(Object.entries(f.crossed).slice(0, 400).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [str(k, 80), (v as unknown[]).slice(0, 20).map(x => str(x, 80))])) } : {}),
        ...(f.blocked && typeof f.blocked === 'object' ? { blocked: cleanBlocked(f.blocked) } : {}),
        ...(Array.isArray(f.heroicDone) ? { heroicDone: f.heroicDone.slice(0, 40).map(x => str(x, 80)) } : {}),
        ...(typeof f.heroicNow === 'string' ? { heroicNow: str(f.heroicNow, 80) } : {}),
        ...(isSeat(f.heroicFirst) ? { heroicFirst: f.heroicFirst } : {}),
        ...(Array.isArray(f.activated) ? { activated: f.activated.slice(0, 400).map(x => str(x, 80)) } : {}),
        ...(Number.isFinite(f.willed) ? { willed: int(f.willed, 0, 99, 0) } : {}),
        ...(Array.isArray(f.usedTurn) ? { usedTurn: f.usedTurn.slice(0, 60).map(x => str(x, 130)) } : {}),
        ...(Array.isArray(f.heard) ? { heard: f.heard.slice(0, 40).map(x => str(x, 120)) } : {}),
        ...(typeof f.listen === 'string' ? { listen: str(f.listen, 120) } : {}),
        ...(Array.isArray(f.freeMove) ? { freeMove: f.freeMove.slice(0, 20).map(x => str(x, 80)) } : {}),
        ...(Number.isFinite(f.synergy) ? { synergy: int(f.synergy, 0, 99, 0) } : {}),
        ...(isSeat(f.lastChooser) ? { lastChooser: f.lastChooser } : {}),
        ...(Array.isArray(f.chronicles) ? { chronicles: f.chronicles.slice(0, 10).filter(c => c && isSeat(c.seat) && Array.isArray(c.ids)).map(c => ({ seat: c.seat, ids: c.ids.slice(0, 20).map(x => str(x, 80)) })) } : {}),
        ...(f.shotPause && typeof f.shotPause === 'object' && cleanPause(f.shotPause) ? { shotPause: cleanPause(f.shotPause) } : {}),
        ...(f.choices && typeof f.choices === 'object'
          ? { choices: Object.fromEntries(Object.entries(f.choices as Record<string, Record<string, unknown>>).slice(0, 200).map(([k, v]) => [str(k, 80), { ...(v?.shielding === true ? { shielding: true } : {}), ...(v?.twoHanded === true ? { twoHanded: true } : {}), ...Object.fromEntries(FIGHT_TARGETS.filter(t => typeof v?.[t] === 'string').map(t => [t, str(v[t], 80)])) }])) }
          : {}),
        ...(Array.isArray(f.challenges) ? { challenges: f.challenges.slice(0, 20).filter(c => c && typeof c === 'object').map(c => ({ by: str(c.by, 80), target: str(c.target, 80), cap: int(c.cap, 0, 9, 3), ...(typeof c.accepted === 'boolean' ? { accepted: c.accepted } : {}) })) } : {}),
        ...(f.charges && typeof f.charges === 'object' ? { charges: Object.fromEntries(Object.entries(f.charges).slice(0, 400).map(([k, v]) => [str(k, 80), str(v, 80)])) } : {}),
        ...(Array.isArray(f.brutal) ? { brutal: f.brutal.slice(0, 100).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.breached) ? { breached: f.breached.slice(0, 200).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.hurledAt) ? { hurledAt: f.hurledAt.slice(0, 100).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.trampled) ? { trampled: f.trampled.slice(0, 100).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.turned) ? { turned: f.turned.slice(0, 100).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.cables) ? { cables: f.cables.slice(0, 20).filter(Array.isArray).map(c => [0, 1, 2, 3].map(i => num((c as unknown[])[i], -24, 200, 0)) as [number, number, number, number]) } : {}),
        ...(f.barged && typeof f.barged === 'object' ? { barged: Object.fromEntries(Object.entries(f.barged).slice(0, 20).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [str(k, 80), [num((v as unknown[])[0], 0, 12, 0), int((v as unknown[])[1], 0, 999, 0)] as [number, number]])) } : {}),
        ...(f.mustCharge && typeof f.mustCharge === 'object' ? { mustCharge: { model: str(f.mustCharge.model, 80), target: str(f.mustCharge.target, 80) } } : {}),
        ...(Array.isArray(f.duels) ? { duels: f.duels.slice(0, 200).map(x => String(x).slice(0, 80)) } : {}),
        ...(f.startFate && typeof f.startFate === 'object' ? { startFate: cleanCounts(f.startFate, 9) } : {}),
        ...(f.control && typeof f.control === 'object'
          ? { control: Object.fromEntries(Object.entries(f.control).slice(0, 50).map(([k, v]) => [k.slice(0, 80), isSeat(v) ? v : null])) }
          : {}),
        ...(f.fort && typeof f.fort === 'object' ? { fort: { p1: int(f.fort.p1, 0, 999, 0), p2: int(f.fort.p2, 0, 999, 0) } } : {}),
        ...(f.picks && typeof f.picks === 'object' ? { picks: { p1: cleanPicks(f.picks.p1), p2: cleanPicks(f.picks.p2) } } : {}),
        ...(cleanDeploy(f.deploy) ? { deploy: cleanDeploy(f.deploy)! } : {}),
        ...(Array.isArray(f.applied) ? { applied: f.applied.filter(g => typeof g === 'string').map(g => g.slice(0, 80)).slice(-60) } : {}),
        ...(Number.isFinite(f.burned) ? { burned: int(f.burned, 0, 99, 0) } : {}),
        ...(Array.isArray(f.sauron) ? { sauron: f.sauron.slice(0, 20).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.ringTried) ? { ringTried: f.ringTried.slice(0, 20).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.sought) ? { sought: f.sought.slice(0, 40).map(x => str(x, 80)) } : {}),
        ...(Array.isArray(f.skittered) ? { skittered: f.skittered.slice(0, 40).map(x => str(x, 80)) } : {}),
        ...(f.skitter && typeof f.skitter === 'object' && isSeat(f.skitter.by) ? { skitter: { model: str(f.skitter.model, 80), by: f.skitter.by, dist: int(f.skitter.dist, 1, 6, 1) } } : {}),
        ...(f.mighty && typeof f.mighty === 'object' && f.mighty.base && typeof f.mighty.base === 'object' ? { mighty: { turn: int(f.mighty.turn, 0, 99, 0), base: cleanCounts(f.mighty.base, 9) } } : {}),
        ...(Array.isArray(f.joined) ? { joined: f.joined.slice(0, 20).map(x => str(x, 80)) } : {}),
        ...(f.entering && typeof f.entering === 'object' && isSeat(f.entering.seat) && Array.isArray(f.entering.ids) ? { entering: { seat: f.entering.seat, ids: f.entering.ids.slice(0, 40).map(x => str(x, 80)), from: [num(f.entering.from?.[0], -24, 200, 0), num(f.entering.from?.[1], -24, 200, 0)] as [number, number], turn: int(f.entering.turn, 0, 99, 0), ...(Array.isArray(f.entering.span) ? { span: [num(f.entering.span[0], 0, 200, 0), num(f.entering.span[1], 0, 200, 200)] as [number, number] } : {}), ...(f.entering.charge === true ? { charge: true } : {}), ...(typeof f.entering.on === 'string' && Array.isArray(f.entering.at) ? { on: str(f.entering.on, 80), at: [num(f.entering.at[0], -24, 200, 0), num(f.entering.at[1], -24, 200, 0)] as [number, number] } : {}) } } : {}),
        ...(isSeat(f.reinforce) ? { reinforce: f.reinforce } : {}),
        ...(isSeat(f.bonds) ? { bonds: f.bonds } : {}),
        ...(Array.isArray(f.placing) ? { placing: f.placing.map(p => cleanPlacing(p, out)).filter((p): p is Placing => !!p).slice(0, 20) } : {}),
      },
    };
  }
  if (Array.isArray(o.log)) out = { ...out, log: o.log.map(cleanRoll).filter(r => r !== null).slice(-MAX_LOG) };
  for (const seat of ['p1', 'p2'] as const) {
    const a = o.accounts?.[seat];
    if (a) out = reduce(out, { type: 'seatAccount', seat, account: a });
  }
  const r = o.result;
  if (r && (isSeat(r.by) || r.by === 'game') && (isSeat(r.winner) || r.winner === 'draw'))
    out = {
      ...out,
      result: {
        winner: r.winner,
        by: r.by,
        agreed: r.agreed === true,
        ...(r.by === 'game' ? { confirmed: Array.isArray(r.confirmed) ? [...new Set(r.confirmed.filter(isSeat))] : [] } : {}),
        ...(r.saved === true ? { saved: true } : {}),
      },
    };
  return out;
}
