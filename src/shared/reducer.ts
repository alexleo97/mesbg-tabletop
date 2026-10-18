import { bookBase, round } from './bases.ts';
import { holdInZones } from './deployment.ts';
import { heroicInfo } from './heroics.ts';
import { pendingSpell } from './magic.ts';
import { basePower, cannotAct, effectActive } from './powers.ts';
import { finishCharge, heroicCombatWon, limitMove, moveAllowance, movedAtAll, movedTooFar, moveLeft, moveStart } from './movement.ts';
import { FLOORED, floorHeight, flooredAt } from './sight.ts';
import { woundsTaken } from './fight.ts';
import { CONTACT_SLACK, pairOff } from './flow.ts';
import { crossingAhead } from './terrainTests.ts';
import { distanceBetween } from './geometry.ts';
import { canPickUp, markerUpkeep, syncCarried, touching, canEscape } from './objects.ts';
import { endPhaseUpkeep } from './scoring.ts';
import { BOT_NAME, BOT_SPEEDS, MARKER_OBJECTS, MATS, PHASES, PICK_KEYS, TERRAIN_KINDS, type Action, type Flow, type Mat, type Base, type DiceRoll, type GameState, type Model, type ModelEffect, type Phase, type Picks, type Seat, type SpellPending, type Terrain } from './types.ts';

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

const newFlow = (): Flow => ({ started: false, chooser: null, chooserTurn: 0, roll: null, done: [], resolved: [], heroics: [], passed: [], lastHeroic: null });

/** Moves to a phase (and turn), clearing who has finished; a new turn also clears fights and priority. */
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
      ...(newTurn ? { courage: {}, braved: [], shot: [], arrived: [], duels: [], farMoved: [], moved: [], cast: [], spell: undefined, held: [], stood: [], climbed: {}, compel: undefined, supported: [], strikeBonus: {} } : {}),
      ...(phase !== state.phase ? { compel: undefined, mustCharge: undefined } : {}),
      // The fights are paired off as the Fight phase begins, and stay that way until it ends.
      ...(phase !== state.phase ? { pairs: phase === 'fight' && state.flow.started ? pairOff(livingModels(state), { ...state, phase: 'move' }, state.flow.pairChoices).map(c => c.key) : undefined, pairChoices: undefined } : {}),
      passed: [],
      lastHeroic: null,
      starts: {},
      ...(phase !== state.phase ? { crossed: {}, blocked: {}, stopped: [], crawling: [], lay: [] } : {}),
      ...farMoved,
      ...upkeep,
    },
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
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
    will: int(m.will, 0, 9, base.will),
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
  const floor = 'floor' in m ? int(m.floor, 0, 9, 0) : base.floor;
  if (floor) out.floor = floor;
  return out.id ? out : null;
}

/** Powers at work on a model, from untrusted JSON. */
function cleanEffects(v: unknown): ModelEffect[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(e => e && typeof e === 'object')
    .slice(0, 12)
    .map(e => ({ power: str(e.power, 60), by: id(e.by), turn: int(e.turn, 0, 99, 0), duration: e.duration === 'Temporary' ? ('Temporary' as const) : ('Exhaustion' as const) }))
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
  const object = pick('object');
  if (out.kind !== 'objective' || !MARKER_OBJECTS.includes(object as never)) return;
  out.object = object;
  const side = pick('side');
  if (isSeat(side)) out.side = side;
  if (pick('hidden') === true) out.hidden = true;
  const carrier = pick('carrier');
  if (typeof carrier === 'string' && carrier) out.carrier = id(carrier);
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
  const height = 'height' in t ? (t.height === undefined || t.height === null ? undefined : num(t.height, 0, 12, 0)) : base.height;
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

/** Takes wounds off a model, removing it as a casualty when none are left. */
function takeWounds(m: Model, n: number): Model {
  const wounds = Math.max(0, m.wounds - n);
  // Remember who did it, for scenarios that score kills by particular models.
  const hit = m.lastHit;
  const hurtBy = hit?.ids.length && n > 0 ? [...new Set([...(m.hurtBy ?? []), ...hit.ids])] : m.hurtBy;
  const out = { ...m, ...(hurtBy ? { hurtBy } : {}) };
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
  // Carried markers go wherever their carrier goes.
  return syncCarried(step(state, action));
}

function step(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'addModels': {
      if (!Array.isArray(action.models)) return state;
      const models = { ...state.models };
      for (const raw of action.models) {
        if (Object.keys(models).length >= MAX_MODELS) break;
        const m = cleanModel(raw ?? {});
        if (m) models[m.id] = m;
      }
      return { ...state, models };
    }
    case 'moveModels': {
      if (!Array.isArray(action.moves)) return state;
      const models = { ...state.models };
      let starts = state.flow.starts;
      // Before the battle, models stay in their deployment zones (and a warband switching zones comes along whole).
      const moves = state.flow.started ? action.moves : holdInZones(state, action.moves.filter(mv => mv && models[mv.id]).map(mv => ({ id: String(mv.id), x: num(mv.x, -24, 200, models[mv.id].x), y: num(mv.y, -24, 200, models[mv.id].y), rot: mv.rot })));
      let stood = state.flow.stood;
      let blocked = state.flow.blocked;
      let climbed = state.flow.climbed;
      // Models moved together don't block each other.
      const together = new Set(moves.map(mv => mv && String(mv.id)));
      for (const mv of moves) {
        const prev = mv && models[mv.id];
        if (!prev || prev.escaped || prev.waiting) continue;
        const asked = { x: num(mv.x, -24, 200, prev.x), y: num(mv.y, -24, 200, prev.y) };
        // A model whose move has ended this phase stays where it is.
        if (state.flow.started && state.phase === 'move' && state.flow.stopped?.includes(prev.id) && (asked.x !== prev.x || asked.y !== prev.y)) continue;
        let to = asked;
        const moving = to.x !== prev.x || to.y !== prev.y;
        const compel = state.flow.compel?.model === prev.id ? state.flow.compel : undefined;
        // A Compelled model goes where the caster's player takes it, up to half its Move from where it stood.
        if (compel && moving) to = limitMove(state, { x: compel.from[0], y: compel.from[1] }, to, compel.max, prev.owner, prev, together);
        // Once the battle is under way a model goes no further than its allowance from where it began the phase:
        // its Move in the Move phase, 1" in the Fight phase, and nowhere in the others.
        const allowance = compel ? null : moveAllowance(state, prev);
        if (allowance !== null && moving) {
          const from = moveStart(state, prev);
          to = limitMove(state, from, to, allowance, prev.owner, prev, together);
          // A model that stops inside an enemy's control zone is charging it: it must reach base contact, or stay out.
          if (state.phase === 'move' || heroicCombatWon(state, prev)) to = finishCharge(state, prev, from, to, together);
          // A model that threw a weapon as it charged goes on into contact with its target, unless the throw slew it.
          const must = state.flow.mustCharge?.model === prev.id ? state.models[state.flow.mustCharge.target] : undefined;
          if (must && !must.dead && distanceBetween({ ...prev, ...to }, must) > CONTACT_SLACK) to = { x: prev.x, y: prev.y };
          if (!starts?.[prev.id]) starts = { ...starts, [prev.id]: [from.x, from.y] };
          // Stopped at terrain that needs a test: remember it, so the model's card can offer the test.
          if (state.phase === 'move') {
            const ahead = crossingAhead(state, prev, from, asked);
            const { [prev.id]: _, ...rest } = blocked ?? {};
            blocked = ahead && Math.hypot(to.x - ahead.stop.x, to.y - ahead.stop.y) < 0.05 ? { ...rest, [prev.id]: { terrain: ahead.terrain, test: ahead.test, stop: [to.x, to.y], landing: [ahead.landing.x, ahead.landing.y], drop: ahead.drop } } : rest;
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
        const crawls = state.flow.crawling?.includes(prev.id) || state.flow.lay?.includes(prev.id);
        if (prev.prone && allowance && moving && !crawls && (to.x !== prev.x || to.y !== prev.y)) {
          next = { ...next, prone: undefined };
          delete next.prone;
          stood = [...new Set([...(stood ?? []), prev.id])];
        }
        models[prev.id] = next;
      }
      const flow =
        starts !== state.flow.starts || stood !== state.flow.stood || climbed !== state.flow.climbed || blocked !== state.flow.blocked
          ? { flow: { ...state.flow, starts, ...(stood ? { stood } : {}), ...(climbed ? { climbed } : {}), ...(blocked ? { blocked } : {}) } }
          : {};
      return { ...state, models, ...flow };
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
      if (state.flow.started && m.base.h > m.base.w && to > (m.floor ?? 0)) return state;
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
      if (!m?.prone || !state.flow.started || state.phase !== 'move' || state.flow.starts?.[m.id] || state.flow.crawling?.includes(m.id)) return state;
      return { ...state, flow: { ...state.flow, crawling: [...(state.flow.crawling ?? []), m.id] } };
    }
    case 'lieDown': {
      // A standing model lies down for half its Move, and its move ends.
      const m = state.models[action.id];
      if (!m || m.dead || m.prone || !state.flow.started || state.phase !== 'move' || state.flow.stood?.includes(m.id)) return state;
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
        if (prev && !prev.dead) models[prev.id] = { ...prev, x: num(mv.x, -24, 200, prev.x), y: num(mv.y, -24, 200, prev.y) };
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
      const t = cleanTerrain(action.patch, prev);
      return t ? { ...state, terrain: { ...state.terrain, [t.id]: t } } : state;
    }
    case 'removeTerrain': {
      const terrain = { ...state.terrain };
      delete terrain[action.id];
      return { ...state, terrain };
    }
    case 'setPhase':
      if (!isPhase(action.phase)) return state;
      return goTo(state, action.phase, int(action.turn, 1, 99, state.turn));
    case 'nextPhase': {
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
      return { ...state, flow: { ...state.flow, roll, chooser: action.chooser, chooserTurn: state.turn } };
    }
    case 'choosePriority':
      if (!isSeat(action.seat)) return state;
      return { ...goTo(state, state.phase === 'priority' ? 'move' : state.phase, state.turn), priority: action.seat };
    case 'endActivation': {
      if (!isSeat(action.seat) || state.flow.done.includes(action.seat)) return state;
      const done = [...state.flow.done, action.seat];
      // Once both players have activated in the Move or Shoot phase, play moves on.
      if (done.length === 2 && (state.phase === 'move' || state.phase === 'shoot')) return goTo(state, state.phase === 'move' ? 'shoot' : 'fight', state.turn);
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
      if (!m || !m.hero || m.dead || m.might < 1 || !info || info.phase !== state.phase || cannotAct(state, m)) return state;
      if (state.flow.heroics.some(h => h.model === m.id && h.phase === state.phase)) return state;
      const other: Seat = m.owner === 'p1' ? 'p2' : 'p1';
      return {
        ...state,
        models: { ...state.models, [m.id]: { ...m, might: m.might - 1 } },
        flow: {
          ...state.flow,
          heroics: [...state.flow.heroics, { model: m.id, action: info.name, phase: state.phase }],
          // A declaration gives the other player a fresh chance to respond.
          passed: state.flow.passed.filter(s => s !== other && s !== m.owner),
          lastHeroic: m.owner,
        },
      };
    }
    case 'passHeroic':
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
      const compel = { model: t.id, caster: id(c.caster), max: num(c.max, 0, 12, 0), from: [num(c.from[0], -24, 200, t.x), num(c.from[1], -24, 200, t.y)] as [number, number] };
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
      if (!r || !m || !m.hero || m.might < 1) return state;
      // Against Heroic Defence only a natural 6 wounds, so Might can't make one.
      if (r.against && r.group?.startsWith('f-') && state.flow.heroics.some(h => h.model === r.against && h.action === 'Heroic Defence')) return state;
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
      let hero: Model = { ...m, might: m.might - 1 };
      // Might that turns a failed Fate roll into a 4+ saves the wound.
      if (hero.fateRoll === r.id && roll.dice[0] >= 4) hero = { ...hero, pending: (hero.pending ?? 1) - 1, fateRoll: undefined };
      return afterMight({ ...state, log, models: { ...state.models, [m.id]: settle(hero) } }, roll.id);
    }
    case 'wound': {
      const m = state.models[action.id];
      const n = int(action.count, 0, 30, 0);
      if (!m || m.dead || !n) return state;
      // Each fight or shot's wounds are taken once, whoever presses the button first.
      const group = action.group === undefined ? '' : str(action.group, 80);
      if (group && woundsTaken(state.flow.applied, group, m.id)) return state;
      const by = Array.isArray(action.by) ? action.by.filter(i => typeof i === 'string' && state.models[i]) : [];
      const struck = { ...m, ...(by.length ? { lastHit: cleanHit({ ids: by, how: action.how }) } : { lastHit: undefined }) };
      const hit = m.hero && m.fate > 0 ? { ...struck, pending: (m.pending ?? 0) + n } : takeWounds(struck, n);
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
      const value = typeof action.value === 'string' && (state.models[action.value] || state.terrain[action.value]) ? action.value : undefined;
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
    case 'setBotSpeed':
      return BOT_SPEEDS.includes(action.speed) ? { ...state, botSpeed: action.speed === 'normal' ? undefined : action.speed } : state;
    case 'setPriority':
      return { ...state, priority: isSeat(action.seat) ? action.seat : null };
    case 'setScenario': {
      const id = action.id === null ? null : str(action.id, 40) || null;
      return { ...state, scenario: id, vp: { p1: {}, p2: {} } };
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
      let out: GameState = { ...state, terrain: {} };
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
      let flow = shooter && !state.flow.shot?.includes(shooter) ? { ...state.flow, shot: [...(state.flow.shot ?? []), shooter].slice(-400) } : state.flow;
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
      return { ...state, result: { winner: w, by: 'game', confirmed: [], agreed: false } };
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
              .map(h => ({ model: id(h.model), action: heroicInfo(h.action)!.name, phase: h.phase }))
              .slice(-60)
          : [],
        passed: seats(f.passed),
        lastHeroic: isSeat(f.lastHeroic) ? f.lastHeroic : null,
        ...(Number.isFinite(f.startedAt) ? { startedAt: Number(f.startedAt) } : {}),
        ...(f.starts ? { starts: cleanStarts(f.starts) } : {}),
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
        ...(f.mustCharge && typeof f.mustCharge === 'object' ? { mustCharge: { model: str(f.mustCharge.model, 80), target: str(f.mustCharge.target, 80) } } : {}),
        ...(Array.isArray(f.duels) ? { duels: f.duels.slice(0, 200).map(x => String(x).slice(0, 80)) } : {}),
        ...(f.startFate && typeof f.startFate === 'object' ? { startFate: cleanCounts(f.startFate, 9) } : {}),
        ...(f.control && typeof f.control === 'object'
          ? { control: Object.fromEntries(Object.entries(f.control).slice(0, 50).map(([k, v]) => [k.slice(0, 80), isSeat(v) ? v : null])) }
          : {}),
        ...(f.fort && typeof f.fort === 'object' ? { fort: { p1: int(f.fort.p1, 0, 999, 0), p2: int(f.fort.p2, 0, 999, 0) } } : {}),
        ...(f.picks && typeof f.picks === 'object' ? { picks: { p1: cleanPicks(f.picks.p1), p2: cleanPicks(f.picks.p2) } } : {}),
        ...(Array.isArray(f.applied) ? { applied: f.applied.filter(g => typeof g === 'string').map(g => g.slice(0, 80)).slice(-60) } : {}),
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
