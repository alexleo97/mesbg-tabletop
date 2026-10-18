import type { FightRequest, ShotRequest } from './fight.ts';

// All board positions and distances are in inches; base sizes are in millimetres.

export type Seat = 'p1' | 'p2';
export type Role = Seat | 'spectator';

/** What the solo opponent is called. */
export const BOT_NAME = 'The Palantír';

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
  /** The army's General, marked when the list was deployed. */
  general?: boolean;
  /** The warband it was deployed in, so the warband can keep together in setup. */
  warband?: string;
  /** What the model cost in the list, and its heroic tier (5 for a Hero of Legend), for scenarios that score them. */
  points?: number;
  tier?: number;
  /** It has the Fly special rule (a Heroic March takes it 5" further rather than 3"). */
  fly?: boolean;
  /** It carries a war drum: it can call a free Heroic March for friends of its own army within 12". */
  drum?: boolean;
  /** Special rules for crossing terrain, marked as it comes onto the table (see wargear.terrainRules). */
  ground?: string[];
  /** Left the table via a board edge (still counts as on the table for Broken). */
  escaped?: boolean;
  /** Off the table, waiting to arrive (Maelstrom of Battle). */
  waiting?: boolean;
  /** Models whose attacks have taken wounds off this one, and who struck the last blow and how. */
  hurtBy?: string[];
  killedBy?: { ids: string[]; how: 'fight' | 'shoot' | 'other' };
  /** Who made the latest attack on it, until its wounds are settled. */
  lastHit?: { ids: string[]; how: 'fight' | 'shoot' | 'other' };
  /** Wounds this hero has suffered but not yet taken, while they decide on Fate rolls. */
  pending?: number;
  /** The hero's last failed Fate roll for the current wound, which Might could still turn into a save. */
  fateRoll?: string;
  /** Magical powers working on it now (see powers.ts). */
  effects?: ModelEffect[];
  /** Knocked to the ground: it must stand up (half its Move) before moving on, can't shoot and is trapped if it loses a fight. */
  prone?: boolean;
  /** The turn it was thrown from its mount (Knocked Flying), so it can do nothing more that turn. */
  stunned?: number;
  /** How many times Drain Courage has worsened its Courage, and Wither its Strength. */
  drained?: number;
  withered?: number;
  /** Wargear it has lost, such as a broken Staff of Power. */
  lostGear?: string[];
  /** Its mount has fled or it was thrown, so it fights on foot. */
  dismounted?: boolean;
  /** The mount it rides (see cavalry.ts), and the wounds the mount has left when it has taken some. */
  mount?: string;
  mountWounds?: number;
  /** Its mount just fell (or it was knocked flying): the game rolls its Thrown Rider test. */
  throwPending?: 'test' | 'flying';
  /** A mount fighting on without its rider: the mount's name, for its profile. */
  steed?: string;
  /** Which level it stands on inside a building with floors: 0 is the ground floor, the building's `floors` its roof. */
  floor?: number;
  /** A war beast (it Tramples) or a chariot (it makes a Chariot Charge), marked as it comes onto the table (see warBeasts.ts). */
  beast?: 'war' | 'chariot';
  /** The war beast it rides: its Commander, or a warrior in its Howdah. */
  aboard?: string;
  /** A war beast's Howdah: the wounds it has left (0 once it is destroyed). */
  howdahWounds?: number;
  /** Wounds a war beast has taken that it still has to test for Stampede, and whether it failed one (it Stampedes as it next moves). */
  stampedeTests?: number;
  stampede?: boolean;
  /** A siege engine, large or small (see siege.ts): it never moves or acts by itself. */
  siege?: 'large' | 'small';
  /** The siege engine whose crew it is. */
  crewOf?: string;
}

/** A power at work on a model: which one, who cast it and the turn it was cast. */
export interface ModelEffect {
  power: string;
  by: string;
  turn: number;
  duration: 'Temporary' | 'Exhaustion';
}

export const TERRAIN_KINDS = ['wood', 'rock', 'building', 'water', 'hill', 'wall', 'ruin', 'cliff', 'field', 'objective', 'bridge', 'road', 'gate', 'tower'] as const;
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
  /** How tall it is in inches, when not the usual for its kind. */
  height?: number;
  /**
   * A building or ruin with floors inside: how many storeys below its roof. Models walk in at ground level and climb
   * between floors and onto the roof. Unset, it's solid and models stand on its roof.
   */
  floors?: number;
  /** A scenario marker that means something: an artefact to dig up, a relic, a supply to guard, a wounded ally. */
  object?: MarkerObject;
  /** The side a relic, supply or wounded ally belongs to; for Writhing Vines, the side whose caster summoned them. */
  side?: Seat;
  /** Writhing Vines: difficult ground for the other side until the End phase. */
  vines?: boolean;
  /** Face down (an unrevealed heirloom marker) or still buried (an artefact not yet uncovered). */
  hidden?: boolean;
  /** The model carrying it. */
  carrier?: string;
  /** Where it started, for relics that score for being moved. */
  home?: [number, number];
  /** Off the table: carried off an edge, destroyed, rescued, or a decoy turned over. */
  gone?: 'off' | 'destroyed' | 'rescued' | 'revealed';
  /** Who carried it off, destroyed it or turned it over. */
  by?: Seat;
  /** The turn each side last tried to uncover it, as only one try per side per turn is allowed. */
  tried?: Partial<Record<Seat, number>>;
  /** A gate or door: how stout it is (see fortress.ts), and the Wounds it has left. Its `side` holds it and walks through. */
  door?: DoorType;
  wounds?: number;
  /** A purpose-built wall or rampart: too sheer to climb without a Siege Ladder (Swift Movement aside). */
  sheer?: boolean;
  /** A Siege Ladder raised against this piece of terrain, or a siege tower's ramp lowered onto it. */
  raised?: string;
  /** A wall that is a defender's Barricade (Defence 7, 2 Wounds), or a spiked one that hurts those crossing it. */
  barricade?: 'plain' | 'spiked';
}

export const DOOR_TYPES = ['castle', 'dwarven', 'heavyArmoured', 'armoured', 'heavy', 'external', 'internal'] as const;
export type DoorType = (typeof DOOR_TYPES)[number];

export const MARKER_OBJECTS = ['artefact', 'relic', 'heirloom', 'decoy', 'supply', 'ally', 'ladder', 'ram', 'rocks', 'oil', 'rally'] as const;
export type MarkerObject = (typeof MARKER_OBJECTS)[number];

/** Secret choices some scenarios ask each player to make, by model or terrain id. */
export interface Picks {
  /** Assassination: the enemy Hero you're hunting, and your own Hero sent to do it. */
  target?: string;
  assassin?: string;
  /** Contest of Champions: your Champion. */
  champion?: string;
  /** Fog of War: your Hero to protect, the enemy Hero to hunt, and the terrain piece to hold. */
  protect?: string;
  hunt?: string;
  terrain?: string;
}
export const PICK_KEYS = ['target', 'assassin', 'champion', 'protect', 'hunt', 'terrain'] as const;

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
  /** For a shot: the model it was aimed at, whether or not it hit. */
  aim?: string;
  /** A one-line summary shown under the roll, such as who won a fight. */
  note?: string;
  /** The model the roll was made for, so its hero can spend Might on it. */
  model?: string;
  /** For duel rolls: the Fight value used and which side (0 is player 1) the model fought on. */
  f?: number;
  side?: 0 | 1;
  /** For duel rolls: added to each die (a two-handed weapon's -1 and so on); with `sixSafe`, not to a natural 6. */
  mod?: number;
  sixSafe?: boolean;
  /** For strikes: wounds each success causes (Mighty Blow). */
  per?: number;
  /** A die re-rolled with a banner. */
  banner?: boolean;
  /** Might points spent raising these dice. */
  might?: number;
  /** A supporting model's duel die (a spear or pike lending a hand). */
  support?: boolean;
  /** A throwing weapon thrown in the Move phase as the model charges its target. */
  charge?: boolean;
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
  /** The seat the computer plays, in a game against it. */
  bot?: Seat;
  /** How quickly the computer plays its turn: Normal unless set. */
  botSpeed?: BotSpeed;
}

export type BotSpeed = 'normal' | 'fast' | 'instant';
export const BOT_SPEEDS: BotSpeed[] = ['normal', 'fast', 'instant'];

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
export interface SpellPending {
  /** The casting roll in the log. */
  roll: string;
  caster: string;
  target: string;
  power: string;
  cv: number;
  /** Cast, and nobody can resist it any more: the game puts its effect into play next. */
  ready?: boolean;
  /** Tremor: how long its line runs, and the model it was aimed towards (`target` is whoever resists for those it hits). */
  reach?: number;
  aim?: string;
  /** Whether an enemy it hits can resist it (decided as it is cast). */
  resistable?: boolean;
}

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
  /** Where each model that has moved this Move phase started from, so its Move is counted across drags. */
  /** Courage tests taken this turn, by model: true if it passed. A model that fails can't move this turn. */
  courage?: Record<string, boolean>;
  /** Broken sides whose models have taken their Courage tests this turn. */
  braved?: Seat[];
  /** Sides whose waiting warbands have rolled to arrive this turn. */
  arrived?: Seat[];
  /** Models that have shot this turn; each may shoot once. */
  shot?: string[];
  /** Models that moved more than half their Move this turn, so can't shoot. */
  farMoved?: string[];
  /** Models that moved at all this turn, so shoot 1 worse (and can't shoot a crossbow). */
  moved?: string[];
  /** Terrain each model has passed a Jump, Climb or Leap test for this Move phase (or waded into), so may cross. */
  crossed?: Record<string, string[]>;
  /** A model stopped at terrain it needs a test to cross: what test, where it stands and where it would land. */
  blocked?: Record<string, { terrain: string; test: 'Jump' | 'Climb' | 'Climb down' | 'Leap'; stop: [number, number]; landing: [number, number]; drop: number }>;
  /** Models whose move has ended this phase (a failed test, or a test passed on 2-5). */
  stopped?: string[];
  /** Prone models crawling this Move phase (up to 1", staying Prone) instead of standing up. */
  crawling?: string[];
  /** Models that lay down this Move phase, so can't stand up again in it. */
  lay?: string[];
  /** Heroes whose heroic activation (Heroic Move or Heroic Shoot) is over this phase, done or cancelled. */
  heroicDone?: string[];
  /** The hero whose heroic activation is under way. */
  heroicNow?: string;
  /** The side whose hero goes first when both sides declared a Heroic Move (or Shoot), from the roll. */
  heroicFirst?: Seat;
  /** Models that have had their activation this phase by going with a hero's heroic activation. */
  activated?: string[];
  /** Heroic Challenges: who called it on whom, whether it was taken up, and the most Might the caller can have. */
  challenges?: { by: string; target: string; accepted?: boolean; cap: number }[];
  /** The turn Will of Evil last took its toll. */
  willed?: number;
  /** A shot paused for its shooter's player to spend Might on the roll it just made: its roll group, and the shot. */
  shotPause?: { group: string; shot: ShotRequest };
  /** How models fight this phase, as their players chose: Shielding, or a weapon used two-handed. */
  choices?: Record<string, { shielding?: boolean; twoHanded?: boolean }>;
  /** Who charged whom this turn (charger to the enemy it reached), so a fight over a wall knows who is defending. */
  charges?: Record<string, string>;
  /** Monsters that have made their one Brutal Power Attack this turn, and the models already hurled at. */
  brutal?: string[];
  hurledAt?: string[];
  /** Models that have struck at a gate this turn, battering rams that have swung, and ladders pushed at. */
  breached?: string[];
  /** War beasts and chariots that have made their move this turn. */
  trampled?: string[];
  /** Siege engines turned this turn, which shoot 1 worse. */
  turned?: string[];
  /** The Iron Hills Ballista's grapnel lines this turn, from the engine to where each bolt struck: shots can't cross them. */
  cables?: [number, number, number, number][];
  /**
   * A monster that barged its foes aside: how far it may now move (and charge) this Fight phase, and how many fights
   * had been fought when it did (so it can fight once more).
   */
  barged?: Record<string, [number, number]>;
  /** Models that backed away after the last fight, and where from, so their player may pick another way. */
  retreat?: Record<string, [number, number]>;
  /** A model that threw a weapon as it charged: unless its target fell, it must go on and charge that target. */
  mustCharge?: { model: string; target: string };
  /** Models that have cast a power this turn; each casts at most once. */
  cast?: string[];
  /** A cast waiting on its target's player (resist or not), or on its caster (spend Might or let it fail). */
  spell?: SpellPending;
  /** Duels rolled this turn, by group, so the same one isn't rolled twice. */
  duels?: string[];
  /** A Compel that worked: the caster's player moves the target up to `max` from where it stood. */
  compel?: { model: string; caster: string; max: number; from: [number, number] };
  /** Models that can't move again this turn (moved by Compel). */
  held?: string[];
  /** Models that stood up from Prone this turn, which costs half their Move. */
  stood?: string[];
  /** Inches each model has spent climbing between floors this Move phase. */
  climbed?: Record<string, number>;
  /** The turn Paralysed models last rolled to recover. */
  recovered?: number;
  starts?: Record<string, [number, number]>;
  /** Each hero's Fate at the start of the game, so Fate spent can be counted. */
  startFate?: Record<string, number>;
  /** Who holds each objective, for scenarios where control lasts until someone else takes it. */
  control?: Record<string, Seat | null>;
  /** Fortification Points earned so far, for scenarios that keep a running total. */
  fort?: Record<Seat, number>;
  /** Each player's secret choices, shown to the other player once the game is over. */
  picks?: Record<Seat, Picks>;
  /** The fights paired off at the start of this Fight phase, by combat key. */
  pairs?: string[];
  /** The Priority player's choices of who fights whom, where a model could be paired off more than one way. */
  pairChoices?: Record<string, string>;
  /** Spear and pike models that have supported a fight this Fight phase; each supports one fight at most. */
  supported?: string[];
  /** Each hero's Heroic Strike bonus this turn, rolled at its first fight and kept for the rest of the phase. */
  strikeBonus?: Record<string, number>;
  /** Fights and shots whose wounds have been taken off already, by roll group, so they're never taken twice. */
  applied?: string[];
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
  /** Losers of a fight backing away, worked out with the strikes (never sent by a player). */
  /**
   * Models moved after a fight: losers backing away, a friend making way, winners stepping apart. `ifSlain` moves only
   * if that model died in the fight (an attacker crossing the wall), `unlessSlain` only if it didn't; `pick` lets the
   * model's player choose another way for it.
   */
  | { type: 'backAway'; moves: { id: string; x: number; y: number; ifSlain?: string; unlessSlain?: string; pick?: boolean }[] }
  /** The player of a model that backed away puts it 1" another way from where it stood. */
  | { type: 'backAwayTo'; id: string; x: number; y: number }
  | { type: 'spendWill'; id: string; count: number }
  | { type: 'spellPending'; spell: SpellPending | null }
  /** The caster's player lets a cast that fell short fail rather than spend Might on it. */
  | { type: 'letSpellFail' }
  /** A power's effect on a model, worked out by the game (never sent by a player). */
  | { type: 'affect'; id: string; patch: Partial<Omit<Model, 'id'>> }
  /** A Compel that worked (from the game), or (null) its caster's player has finished moving the model. */
  | { type: 'compel'; compel: Flow['compel'] | null }
  /** The Priority player pairs a model off against one of the enemies it touches, before the fights are rolled. */
  | { type: 'pairOff'; id: string; with: string }
  /** A model climbs to another floor of the building it is in. */
  | { type: 'climb'; id: string; floor: number }
  /** Take the Jump, Climb or Leap test for the terrain a model was stopped at. */
  | { type: 'cross'; id: string }
  /** The result of a test (the server's), or wading into a stream rather than leaping it: may cross `terrain`; `stop` ends its move. */
  | { type: 'crossed'; id: string; terrain?: string; stop?: boolean }
  /** A Prone model crawls (up to 1", staying Prone) instead of standing up. */
  | { type: 'crawl'; id: string }
  /** A standing model lies down, for half its Move. */
  | { type: 'lieDown'; id: string }
  /** Paralysed models have rolled to recover this End phase (never sent by a player). */
  | { type: 'recovered' }
  | { type: 'arrive'; seat: Seat; moves: { id: string; x: number; y: number; rot: number }[] }
  /** Courage test results, worked out with the dice (never sent by a player). Models of a Broken side that fail flee. */
  | { type: 'courageTaken'; results: Record<string, boolean>; broken?: Seat }
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
  /** A hero's heroic action; a Heroic Challenge names the enemy hero it challenges (`cap` is the most Might it may have). */
  | { type: 'declareHeroic'; model: string; action: string; target?: string; cap?: number }
  /** The challenged hero's player takes up a Heroic Challenge, or turns it down. */
  | { type: 'answerChallenge'; target: string; accept: boolean }
  /** Which side's hero goes first this phase, from the roll (never sent by a player). */
  | { type: 'heroicOrder'; seat: Seat }
  /** Will of Evil has taken its toll this turn (never sent by a player). */
  | { type: 'willOfEvil' }
  /** Carry on with a shot paused for Might (see Flow.shotPause). */
  | { type: 'shotOn'; group: string }
  /** A player's choice for how one of its models fights this phase. */
  | { type: 'fightChoice'; id: string; shielding?: boolean; twoHanded?: boolean }
  /** Asks to re-roll one duel die with a friendly banner nearby (the server rolls it). */
  | { type: 'banner'; roll: string; die: number }
  /** A rider gets down from its mount during its move (the game rolls the Courage test of a mount that fights). */
  | { type: 'dismount'; id: string }
  /** A war beast Tramples, or a chariot makes its Chariot Charge, towards a point; `pivot` turns a chariot on the spot instead. */
  | { type: 'trample'; id: string; x: number; y: number; pivot?: boolean }
  /** The game's record that a war beast or chariot has made its move this turn, and who it ended up charging. */
  | { type: 'trampled'; id: string; from: [number, number]; target?: string }
  /** Before the battle, a warrior climbs into its war beast's Howdah (or, with no beast, climbs out). */
  | { type: 'board'; id: string; beast?: string }
  | { type: 'cable'; from: [number, number]; to: [number, number] }
  /** Server only: a monster made its Brutal Power Attack this turn (and barged, with a free move, or hurled at someone). */
  | { type: 'brutal'; id: string; barge?: number; hurledAt?: string }
  | { type: 'bannerRolled'; roll: string; die: number; value: number; by: string }
  /** A shot stops for Might, or carries on (null), worked out by the game (never sent by a player). */
  | { type: 'shotPaused'; pause: { group: string; shot: ShotRequest } | null }
  /** A player has no more heroic actions to declare this phase. */
  | { type: 'passHeroic'; seat: Seat }
  /** A hero spends a Might point to raise one of its own dice by 1. `follow` picks the follow-up dice of a 6/4+ roll. */
  | { type: 'useMight'; roll: string; die: number; follow?: boolean; will?: boolean }
  /** Wounds dealt to a model. A hero with Fate holds them as pending until its player decides. */
  | { type: 'wound'; id: string; count: number; by?: string[]; how?: 'fight' | 'shoot' | 'other'; group?: string; mount?: boolean; howdah?: boolean }
  /** A model picks up a marker it is touching, turns a face-down marker over, or drops what it carries. */
  | { type: 'pickUp'; model: string; marker: string }
  | { type: 'flip'; model: string; marker: string }
  | { type: 'drop'; marker: string }
  /** Request from a client: the server rolls the Intelligence test to uncover a buried artefact. */
  | { type: 'uncover'; model: string; marker: string; intelligence: number }
  /**
   * Request from a client: strike at a gate (in the Fight phase), swing a battering ram at it (from the ram), shoot at it
   * (in the Shoot phase), or push a Siege Ladder down off the walls (in the Move phase). The server rolls it.
   */
  | { type: 'breach'; how: 'strike' | 'ram' | 'shoot' | 'push'; model: string; target: string }
  /** A side's models push their siege tower up to 6" (checked by the reducer: enough pushers, nothing in the way). */
  | { type: 'pushTower'; id: string; seat: Seat; x: number; y: number }
  /** Request from a client: a defender on the walls drops rocks or pours boiling oil on an attacker below. */
  | { type: 'hurl'; how: 'rocks' | 'oil'; model: string; item: string; target: string }
  /** Server only: a model, ram or ladder has had its go at a gate this turn. */
  | { type: 'breached'; id: string }
  /** Server result of an uncover attempt. */
  | { type: 'uncovered'; model: string; marker: string; roll: DiceRoll }
  /** A model leaves the table over a board edge. */
  | { type: 'escape'; model: string }
  | { type: 'setPick'; seat: Seat; key: (typeof PICK_KEYS)[number]; value: string | null }
  /** The computer takes this seat, or (null) leaves the game to two people again. */
  | { type: 'setBot'; seat: Seat | null }
  | { type: 'setBotSpeed'; speed: BotSpeed }
  /** Request from a client: the server rolls a Fate point for a hero's pending wound. */
  | { type: 'rollFate'; id: string }
  | { type: 'fateRolled'; id: string; roll: DiceRoll }
  /** A hero takes its next pending wound (or all of them) without more Fate rolls. */
  | { type: 'takeWound'; id: string; all?: boolean }
  /** Request from a client: the server rolls the winner's strikes for a duel already rolled in `group`. */
  | { type: 'strikes'; fight: FightRequest; group: string }
  /** Request from a client: the server rolls to hit, In the Way and to wound, then sends `rolled`. */
  | { type: 'shoot'; shot: ShotRequest }
  /** Cast a power: the server rolls one die per Will spent. */
  | { type: 'cast'; model: string; target: string; power: string; cv: number; will: number }
  /** Resist the power cast at your model with this much Will (0: let it take effect). */
  | { type: 'resist'; will: number }
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

/** A ping or a planning arrow someone put on the table. Shared live but never saved with the game. */
export interface Mark {
  id: string;
  by: Role;
  kind: 'ping' | 'arrow';
  x: number;
  y: number;
  /** Where an arrow points. */
  x2?: number;
  y2?: number;
}

export type ClientMessage =
  | { type: 'action'; action: Action }
  /** A ping or an arrow to show the other players, or `clear` to take your arrows away. */
  | { type: 'mark'; mark: Pick<Mark, 'kind' | 'x' | 'y' | 'x2' | 'y2'> }
  | { type: 'clearMarks' }
  /** `invite`: the private game's invite code, if this browser has one. `seatKey`: the key to this seat, if it has one. */
  | { type: 'hello'; role: Role; invite?: string; seatKey?: string }
  /** A seated player making the game invite-only, or open to anyone again. */
  | { type: 'privacy'; private: boolean }
  /** A player's browser offering its saved copy of a game the server has lost. */
  | { type: 'restore'; state: GameState; invite?: string }
  /** A signed-in player's sign-in token, so their seat counts towards their stats. */
  | { type: 'identify'; token: string | null }
  /** Checking the link is still alive; the server answers with `pong`. */
  | { type: 'ping' }
  /** Asking for the whole game again, after missing an action or failing to apply one. */
  | { type: 'sync' };

export type ServerMessage =
  | { type: 'mark'; mark: Mark }
  | { type: 'clearMarks'; by: Role }
  /**
   * `blank`: the server has nothing for this room yet, so a player may restore it. `seq`: the number of the last
   * action already in `state`. `build`: the browser code the server hands out now.
   */
  | { type: 'snapshot'; state: GameState; players: Role[]; blank?: boolean; seq?: number; build?: string }
  /** `seq` counts up by one with each action in a room, so a gap means one was missed. */
  | { type: 'action'; action: Action; seq?: number }
  | { type: 'pong' }
  /** The key to your seat in a battle under way, so you can come back to it after a refresh or a dropped link. */
  | { type: 'seatKey'; seat: Seat; key: string }
  | { type: 'presence'; players: Role[] }
  /** How many of your own changes the server can take back. */
  | { type: 'undo'; count: number }
  | { type: 'error'; message: string }
  /** The private game's invite code, sent only to seated players (null once it's open again). */
  | { type: 'invite'; code: string | null }
  /** The seat asked for is invite-only, so you're watching instead. */
  | { type: 'seatRefused'; message: string };
