import { PHASES, type Action, type Base, type DiceRoll, type GameState, type Model, type Phase, type Seat, type Terrain } from './types.ts';

export const MAX_MODELS = 600;
export const MAX_TERRAIN = 200;
export const MAX_LOG = 200;
export const MAX_DICE = 60;

export function initialState(): GameState {
  return {
    board: { w: 48, h: 48 },
    models: {},
    terrain: {},
    turn: 1,
    phase: 'priority',
    priority: null,
    log: [],
    names: {},
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const isSeat = (v: unknown): v is Seat => v === 'p1' || v === 'p2';
const isPhase = (v: unknown): v is Phase => PHASES.includes(v as Phase);
const id = (v: unknown) => str(v, 64);

function cleanBase(b: unknown, fallback: Base): Base {
  if (!b || typeof b !== 'object') return fallback;
  const o = b as Record<string, unknown>;
  const shape = o.shape === 'oval' || o.shape === 'rect' || o.shape === 'round' ? o.shape : fallback.shape;
  const w = num(o.w, 10, 200, fallback.w);
  return { shape, w, h: shape === 'round' ? w : num(o.h, 10, 200, fallback.h) };
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
    base: m.base !== undefined ? cleanBase(m.base, base.base) : base.base,
    move: num(m.move, 0, 24, base.move),
    maxWounds: int(m.maxWounds, 1, 30, base.maxWounds),
    wounds: 0,
    might: int(m.might, 0, 9, base.might),
    will: int(m.will, 0, 9, base.will),
    fate: int(m.fate, 0, 9, base.fate),
    hero: typeof m.hero === 'boolean' ? m.hero : base.hero,
    dead: typeof m.dead === 'boolean' ? m.dead : base.dead,
  };
  out.wounds = int(m.wounds, 0, out.maxWounds, Math.min(base.wounds, out.maxWounds));
  return out.id ? out : null;
}

function cleanTerrain(t: Partial<Terrain>, prev?: Terrain): Terrain | null {
  const base: Terrain = prev ?? { id: '', kind: 'rock', shape: 'circle', x: 24, y: 24, w: 4, h: 4, rot: 0, locked: false };
  const kinds = ['wood', 'rock', 'building', 'water', 'hill', 'wall'];
  const out: Terrain = {
    id: prev ? prev.id : id(t.id),
    kind: kinds.includes(t.kind as string) ? (t.kind as Terrain['kind']) : base.kind,
    shape: t.shape === 'rect' || t.shape === 'circle' ? t.shape : base.shape,
    x: num(t.x, -24, 200, base.x),
    y: num(t.y, -24, 200, base.y),
    w: num(t.w, 0.25, 48, base.w),
    h: num(t.h, 0.25, 48, base.h),
    rot: num(t.rot, -360, 720, base.rot) % 360,
    locked: typeof t.locked === 'boolean' ? t.locked : base.locked,
  };
  return out.id ? out : null;
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
    at: num(o.at, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/**
 * Applies one action to the game state and returns the new state.
 * Runs on both server and clients, so it must be deterministic and must tolerate hostile input.
 * `roll` is a request only; the server replaces it with `rolled`, so here it is a no-op.
 */
export function reduce(state: GameState, action: Action): GameState {
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
      for (const mv of action.moves) {
        const prev = mv && models[mv.id];
        if (!prev) continue;
        models[prev.id] = {
          ...prev,
          x: num(mv.x, -24, 200, prev.x),
          y: num(mv.y, -24, 200, prev.y),
          rot: mv.rot === undefined ? prev.rot : num(mv.rot, -360, 720, prev.rot) % 360,
        };
      }
      return { ...state, models };
    }
    case 'updateModel': {
      const prev = state.models[action.id];
      if (!prev || !action.patch || typeof action.patch !== 'object') return state;
      const m = cleanModel(action.patch, prev);
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
      return { ...state, phase: action.phase, turn: int(action.turn, 1, 99, state.turn) };
    case 'nextPhase': {
      const i = PHASES.indexOf(state.phase);
      return i === PHASES.length - 1
        ? { ...state, phase: PHASES[0], turn: Math.min(99, state.turn + 1) }
        : { ...state, phase: PHASES[i + 1] };
    }
    case 'setPriority':
      return { ...state, priority: isSeat(action.seat) ? action.seat : null };
    case 'setName':
      if (!isSeat(action.seat)) return state;
      return { ...state, names: { ...state.names, [action.seat]: str(action.name, 40) } };
    case 'setBoard':
      return { ...state, board: { w: int(action.w, 12, 96, state.board.w), h: int(action.h, 12, 96, state.board.h) } };
    case 'rolled': {
      const r = cleanRoll(action.roll);
      if (!r) return state;
      const log = [...state.log, r];
      return { ...state, log: log.slice(-MAX_LOG) };
    }
    case 'loadState':
      return loadState(action.state);
    case 'roll':
    default:
      return state;
  }
}

/** Rebuilds a full state from untrusted JSON (a saved game or a server snapshot). */
export function loadState(raw: unknown): GameState {
  const s = initialState();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Partial<GameState>;
  let out: GameState = reduce(s, { type: 'setBoard', w: o.board?.w ?? 48, h: o.board?.h ?? 48 });
  out = reduce(out, { type: 'addModels', models: Object.values(o.models ?? {}) });
  for (const t of Object.values(o.terrain ?? {})) out = reduce(out, { type: 'addTerrain', terrain: t });
  if (isPhase(o.phase)) out = reduce(out, { type: 'setPhase', phase: o.phase, turn: o.turn });
  out = reduce(out, { type: 'setPriority', seat: o.priority ?? null });
  for (const seat of ['p1', 'p2'] as const) {
    const n = o.names?.[seat];
    if (n) out = reduce(out, { type: 'setName', seat, name: n });
  }
  if (Array.isArray(o.log)) out = { ...out, log: o.log.map(cleanRoll).filter(r => r !== null).slice(-MAX_LOG) };
  return out;
}
