import type { FightRequest, ShotRequest } from './fight.ts';

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
  /** Wounds this hero has suffered but not yet taken, while they decide on Fate rolls. */
  pending?: number;
  /** The hero's last failed Fate roll for the current wound, which Might could still turn into a save. */
  fateRoll?: string;
}

export const TERRAIN_KINDS = ['wood', 'rock', 'building', 'water', 'hill', 'wall', 'ruin', 'cliff', 'field', 'objective', 'bridge', 'road'] as const;
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
  /** Halves movement inside it. Unset means the kind's default (woods, water and ruins are difficult). */
  difficult?: boolean;
  /**
   * A river or stream drawn along a winding centreline instead of the plain shape: each point is x, y
   * (in inches from the piece's centre, before rotation) and the half-width of the water there.
   */
  path?: [number, number, number][];
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
  /** For Courage and Intelligence tests: the 2D6 total needed to pass. */
  sum?: number;
  /** Rolls made together (one fight) share a group id. */
  group?: string;
  /** For strikes in a fight: the model they were rolled against. */
  against?: string;
  /** A one-line summary shown under the roll, such as who won a fight. */
  note?: string;
  /** The model the roll was made for, so its hero can spend Might on it. */
  model?: string;
  /** For duel rolls: the Fight value used and which side (0 is player 1) the model fought on. */
  f?: number;
  side?: 0 | 1;
  /** Might points spent raising these dice. */
  might?: number;
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
  /** Only players with the invite link may take a seat; anyone can still watch. */
  private?: boolean;
  flow: Flow;
  /** Signed-in players in each seat, set by the server once it has checked their sign-in. */
  accounts?: Partial<Record<Seat, Account>>;
  /** The result one player has reported, waiting for the other to agree. */
  result?: GameResult;
}

export interface Account {
  id: string;
  name: string;
}

export interface GameResult {
  winner: Seat | 'draw';
  /** Worked out by the game, a player conceding, or a player offering a draw. */
  by: Seat | 'game';
  /** Players who have confirmed a result the game worked out. */
  confirmed?: Seat[];
  agreed: boolean;
  /** Recorded for the leaderboard. */
  saved?: boolean;
}

/** Where the guided turn sequence is up to. */
export interface Flow {
  /** Setup is over and turns are being played. */
  started: boolean;
  /** Who won the priority roll-off and chose; kept for the next turn's tie-break. */
  chooser: Seat | null;
  /** The turn `chooser` was decided in. */
  chooserTurn: number;
  /** The last priority roll-off as [player 1, player 2]. */
  roll: [number, number] | null;
  /** Players who have finished activating their models this phase. */
  done: Seat[];
  /** Fights resolved this turn, by combat key. */
  resolved: string[];
  /** Heroic actions declared this turn. */
  heroics: Heroic[];
  /** Players who have finished declaring heroic actions this phase. */
  passed: Seat[];
  /** Who last declared or passed this phase, so the other player goes next. */
  lastHeroic: Seat | null;
  /** When this game started (server time), so each game's result is recorded once. */
  startedAt?: number;
}

export interface Heroic {
  model: string;
  /** The heroic action's name, from heroics.ts. */
  action: string;
  phase: Phase;
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
  /** Sent by the server only, when a player makes the game private or open again. */
  | { type: 'setPrivate'; private: boolean }
  /** `at`: when the server started it, which tells one game in a room from the next. */
  | { type: 'startGame'; at?: number }
  /** Request from a client; the server rolls off and sends `priorityRolled`. */
  | { type: 'rollPriority' }
  | { type: 'priorityRolled'; roll: [number, number]; chooser: Seat }
  | { type: 'choosePriority'; seat: Seat }
  /** A player has finished activating their models for this phase. */
  | { type: 'endActivation'; seat: Seat }
  | { type: 'resolveCombat'; key: string }
  /** A hero spends a Might point to declare a heroic action this phase. */
  | { type: 'declareHeroic'; model: string; action: string }
  /** A player has no more heroic actions to declare this phase. */
  | { type: 'passHeroic'; seat: Seat }
  /** A hero spends a Might point to raise one of its own dice by 1. `follow` picks the follow-up dice of a 6/4+ roll. */
  | { type: 'useMight'; roll: string; die: number; follow?: boolean }
  /** Wounds dealt to a model. A hero with Fate holds them as pending until its player decides. */
  | { type: 'wound'; id: string; count: number }
  /** Request from a client: the server rolls a Fate point for a hero's pending wound. */
  | { type: 'rollFate'; id: string }
  | { type: 'fateRolled'; id: string; roll: DiceRoll }
  /** A hero takes its next pending wound (or all of them) without more Fate rolls. */
  | { type: 'takeWound'; id: string; all?: boolean }
  /** Request from a client: the server rolls the winner's strikes for a duel already rolled in `group`. */
  | { type: 'strikes'; fight: FightRequest; group: string }
  /** Request from a client: the server rolls to hit, In the Way and to wound, then sends `rolled`. */
  | { type: 'shoot'; shot: ShotRequest }
  | { type: 'setBoard'; w: number; h: number; mat?: Mat }
  /** Replaces the mat and all terrain at once, e.g. when loading a starter board. Models stay. */
  | { type: 'setScenery'; w: number; h: number; mat: Mat; terrain: Terrain[] }
  /** Server only: who is signed in at a seat. */
  | { type: 'seatAccount'; seat: Seat; account: Account | null }
  /** A player offers a draw. */
  | { type: 'proposeResult'; seat: Seat; winner: Seat | 'draw' }
  /** A player confirms the game's result or accepts a draw offer; `agree: false` turns down or withdraws an offer. */
  | { type: 'answerResult'; seat: Seat; agree: boolean }
  /** A player gives the game to their opponent. */
  | { type: 'concede'; seat: Seat }
  /** Server only: the game has ended with this winner. */
  | { type: 'gameOver'; winner: Seat | 'draw' }
  /** Server only: the agreed result is on the leaderboard. */
  | { type: 'resultSaved' }
  /** Request from a client; the server turns it into a `rolled` action with real dice. */
  | { type: 'roll'; count: number; target?: number; then?: number; sum?: number; label: string; model?: string }
  | { type: 'rolled'; roll: DiceRoll }
  /** Request from a client: the server rolls the duel (and any Heroic Strike), then sends the results as `rolled`. */
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
  fields?: Partial<Pick<GameState, 'board' | 'turn' | 'phase' | 'priority' | 'names' | 'scenario' | 'vp' | 'listed' | 'flow'>>;
}

export type ClientMessage =
  | { type: 'action'; action: Action }
  /** `invite`: the private game's invite code, if this browser has one. */
  | { type: 'hello'; role: Role; invite?: string }
  /** A seated player making the game invite-only, or open to anyone again. */
  | { type: 'privacy'; private: boolean }
  /** A player's browser offering its saved copy of a game the server has lost. */
  | { type: 'restore'; state: GameState; invite?: string }
  /** A signed-in player's sign-in token, so their seat counts towards their stats. */
  | { type: 'identify'; token: string | null };

export type ServerMessage =
  /** `blank`: the server has nothing for this room yet, so a player may restore it. */
  | { type: 'snapshot'; state: GameState; players: Role[]; blank?: boolean }
  | { type: 'action'; action: Action }
  | { type: 'presence'; players: Role[] }
  /** How many of your own changes the server can take back. */
  | { type: 'undo'; count: number }
  | { type: 'error'; message: string }
  /** The private game's invite code, sent only to seated players (null once it's open again). */
  | { type: 'invite'; code: string | null }
  /** The seat asked for is invite-only, so you're watching instead. */
  | { type: 'seatRefused'; message: string };
