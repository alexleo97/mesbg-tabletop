import type { FightRequest } from './fight.ts';

// All board positions and distances are in inches; base sizes are in millimetres.

export type Seat = 'p1' | 'p2';
export type Role = Seat | 'spectator';

export type BaseShape = 'round' | 'oval' | 'rect';

export interface Base {
  shape: BaseShape;
  /** Width across the model's shoulders, in mm. */
  w: number;
  /** Depth front to back, in mm. Equal to w for round bases. */
  h: number;
}

export interface Model {
  id: string;
  owner: Seat;
  name: string;
  x: number;
  y: number;
  /** Facing in degrees, 0 = towards the top of the board. */
  rot: number;
  base: Base;
  move: number;
  wounds: number;
  maxWounds: number;
  might: number;
  will: number;
  fate: number;
  hero: boolean;
  dead: boolean;
  /** Unit id in the bundled MESBG data, used for the stat card and photo. */
  profileId?: string;
  options?: string[];
}

export const TERRAIN_KINDS = ['wood', 'rock', 'building', 'water', 'hill', 'wall', 'ruin', 'cliff', 'field', 'objective'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** Battle mat surfaces. */
export const MATS = ['grass', 'plains', 'forest', 'mud', 'dirt', 'stone', 'snow', 'sand'] as const;
export type Mat = (typeof MATS)[number];

export interface Terrain {
  id: string;
  kind: TerrainKind;
  shape: 'rect' | 'circle';
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  locked: boolean;
}

export interface DiceRoll {
  id: string;
  by: Role;
  label: string;
  dice: number[];
  /** Score needed for a success, e.g. 4 for "4+". */
  target?: number;
  /** For "6+/4+" style results: score needed on the follow-up die rolled for each first success. */
  then?: number;
  /** Follow-up dice, one per first die that met `target`, in order. */
  follow?: number[];
  /** Rolls made together (one fight) share a group id. */
  group?: string;
  /** For strikes in a fight: the model they were rolled against. */
  against?: string;
  /** A one-line summary shown under the roll, such as who won a fight. */
  note?: string;
  at: number;
}

export const PHASES = ['priority', 'move', 'shoot', 'fight', 'end'] as const;
export type Phase = (typeof PHASES)[number];

export interface GameState {
  board: { w: number; h: number; mat: Mat };
  models: Record<string, Model>;
  terrain: Record<string, Terrain>;
  turn: number;
  phase: Phase;
  priority: Seat | null;
  log: DiceRoll[];
  names: Partial<Record<Seat, string>>;
  /** The matched play scenario being played, if any (an id from scenarios.ts). */
  scenario: string | null;
  /** Victory points per player, keyed by scoring line, so both players see the same tally. */
  vp: Record<Seat, Record<string, number>>;
  /** Shown in the home screen's list of open games. */
  listed: boolean;
}

export type Action =
  | { type: 'addModels'; models: Model[] }
  | { type: 'moveModels'; moves: { id: string; x: number; y: number; rot?: number }[] }
  | { type: 'updateModel'; id: string; patch: Partial<Omit<Model, 'id'>> }
  | { type: 'removeModels'; ids: string[] }
  | { type: 'addTerrain'; terrain: Terrain }
  | { type: 'updateTerrain'; id: string; patch: Partial<Omit<Terrain, 'id'>> }
  | { type: 'removeTerrain'; id: string }
  | { type: 'setPhase'; phase: Phase; turn?: number }
  | { type: 'nextPhase' }
  | { type: 'setPriority'; seat: Seat | null }
  | { type: 'setName'; seat: Seat; name: string }
  | { type: 'setScenario'; id: string | null }
  | { type: 'setVP'; seat: Seat; key: string; value: number }
  | { type: 'setListed'; listed: boolean }
  | { type: 'setBoard'; w: number; h: number; mat?: Mat }
  /** Replaces the mat and all terrain at once, e.g. when loading a starter board. Models stay. */
  | { type: 'setScenery'; w: number; h: number; mat: Mat; terrain: Terrain[] }
  /** Request from a client; the server turns it into a `rolled` action with real dice. */
  | { type: 'roll'; count: number; target?: number; then?: number; label: string }
  | { type: 'rolled'; roll: DiceRoll }
  /** Request from a client: the server rolls the duel and strikes, then sends the results as `rolled`. */
  | { type: 'fight'; fight: FightRequest }
  /** Request from a client to take back its own last change. */
  | { type: 'undo' }
  /** Sent by the server only: puts back the listed models, terrain and fields as they were. */
  | { type: 'revert'; revert: Revert }
  | { type: 'loadState'; state: GameState };

/** One game in the home screen's list, as the server reports it. */
export interface RoomSummary {
  id: string;
  names: Partial<Record<Seat, string>>;
  /** Seats someone is connected to right now. */
  seated: Seat[];
  spectators: number;
  scenario: string | null;
  turn: number;
  models: number;
}

/** What one change touched, as it was before. `null` means the thing didn't exist yet. */
export interface Revert {
  models?: Record<string, Model | null>;
  terrain?: Record<string, Terrain | null>;
  fields?: Partial<Pick<GameState, 'board' | 'turn' | 'phase' | 'priority' | 'names' | 'scenario' | 'vp' | 'listed'>>;
}

export type ClientMessage = { type: 'action'; action: Action } | { type: 'hello'; role: Role };

export type ServerMessage =
  | { type: 'snapshot'; state: GameState; players: Role[] }
  | { type: 'action'; action: Action }
  | { type: 'presence'; players: Role[] }
  /** How many of your own changes the server can take back. */
  | { type: 'undo'; count: number }
  | { type: 'error'; message: string };
