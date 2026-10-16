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
}

export type TerrainKind = 'wood' | 'rock' | 'building' | 'water' | 'hill' | 'wall';

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
  at: number;
}

export const PHASES = ['priority', 'move', 'shoot', 'fight', 'end'] as const;
export type Phase = (typeof PHASES)[number];

export interface GameState {
  board: { w: number; h: number };
  models: Record<string, Model>;
  terrain: Record<string, Terrain>;
  turn: number;
  phase: Phase;
  priority: Seat | null;
  log: DiceRoll[];
  names: Partial<Record<Seat, string>>;
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
  | { type: 'setBoard'; w: number; h: number }
  /** Request from a client; the server turns it into a `rolled` action with real dice. */
  | { type: 'roll'; count: number; target?: number; label: string }
  | { type: 'rolled'; roll: DiceRoll }
  | { type: 'loadState'; state: GameState };

export type ClientMessage = { type: 'action'; action: Action } | { type: 'hello'; role: Role };

export type ServerMessage =
  | { type: 'snapshot'; state: GameState; players: Role[] }
  | { type: 'action'; action: Action }
  | { type: 'presence'; players: Role[] }
  | { type: 'error'; message: string };
