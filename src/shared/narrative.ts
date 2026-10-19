import { entriesFor, type Catalog, type StatName } from './catalog.ts';
import { other } from './flow.ts';
import { halfExtents, type Point } from './geometry.ts';
import { guessBase } from './importList.ts';
import { offTable } from './maelstrom.ts';
import type { Action, DiceRoll, GameState, Mat, Model, Seat, Terrain } from './types.ts';

// Narrative scenarios: battles from the stories, each with its own table, a fixed cast on both sides and rules of its
// own, all in our own words. Positions are inches from the top-left corner of the scenario's own table.

export type Side = 'good' | 'evil';

/** Where a member of the cast starts, and where it may be moved to before the battle. */
export type Placement =
  /** Just there. */
  | { at: [number, number] }
  /** In base contact with another member of the cast, at this angle round it (0 is up the table). */
  | { touching: string; angle: number }
  /** Touching the outside of a round piece of terrain, at this angle round its centre. */
  | { rim: string; angle: number }
  /** Kept off the table until a rule brings it on. */
  | { aside: true };

export interface CastMember {
  /** Who it is, for the scenario's rules: 'frodo', 'aragorn'. */
  key: string;
  side: Side;
  /** The profile, as a unit id in the bundled data. */
  unit: string;
  /** Wargear the scenario gives it, by option name. */
  options?: string[];
  /** Characteristics the scenario sets, in place of the profile's. */
  stats?: Partial<Record<StatName, number>>;
  might?: number;
  will?: number;
  fate?: number;
  /** A flaming brand (Weathertop). */
  brand?: boolean;
  place: Placement;
}

export interface NarrativeRule {
  name: string;
  text: string;
}

export interface Narrative {
  id: string;
  name: string;
  /** The book it comes from. */
  from: string;
  board: { w: number; h: number; mat: Mat };
  /** The table's terrain; a piece's `id` is what the cast's placements refer to. */
  terrain: Terrain[];
  /** What each side is called, and a line on who is in it. */
  sides: Record<Side, { name: string; cast: string }>;
  layout: string;
  deployment: string;
  objectives: string;
  rules: NarrativeRule[];
  cast: CastMember[];
}

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

export const NARRATIVES: Narrative[] = [
  {
    id: 'weathertop',
    name: 'Weathertop',
    from: 'The Fellowship of the Ring',
    board: { w: 24, h: 24, mat: 'plains' },
    terrain: [
      piece({ id: 'amon-sul', kind: 'ruin', shape: 'circle', x: 12, y: 12, w: 12, h: 12, difficult: false, height: 1 }),
      piece({ id: 'rubble-1', kind: 'rock', x: 3, y: 4, w: 2.5, h: 1.8, rot: 20, height: 1 }),
      piece({ id: 'rubble-2', kind: 'rock', x: 21, y: 19.5, w: 2.2, h: 1.6, rot: -30, height: 1 }),
      piece({ id: 'trees-1', kind: 'wood', shape: 'circle', x: 20.5, y: 3.5, w: 4, h: 4 }),
      piece({ id: 'trees-2', kind: 'wood', shape: 'circle', x: 3.5, y: 20.5, w: 3.5, h: 3.5 }),
      piece({ id: 'hedge-1', kind: 'wall', x: 21.5, y: 11, w: 0.6, h: 4, height: 1 }),
    ],
    sides: {
      good: { name: 'The Hobbits', cast: 'Frodo, Sam, Merry and Pippin, with Aragorn on his way' },
      evil: { name: 'The Nazgûl', cast: 'The Witch-king and four Ringwraiths' },
    },
    layout: 'A 2\' by 2\' table: the ruined watchtower of Amon Sûl, 12" across, fills the middle, with a little rubble and a few trees about.',
    deployment: 'Frodo stands in the middle of the ruin with the other three Hobbits touching him. The Nazgûl start touching the edge of the ruin, wherever their player likes round it. Aragorn is kept off the table.',
    objectives: 'The Nazgûl win the moment Frodo is slain. The Hobbits win if every one of the Nazgûl is slain first.',
    rules: [
      {
        name: 'Flaming Brands',
        text: 'Aragorn, Sam, Merry and Pippin each carry a burning brand. A Ringwraith that loses a fight to one of them backs away as usual, then retreats a further D6" away from it. Once in the game Aragorn may throw his as a throwing weapon: if it hits, there is no roll To Wound, the model hit is Set Ablaze instead, and the brand is gone.',
      },
      {
        name: 'Aragorn',
        text: 'From turn 2, as the Good side finishes its move, it rolls a D6: on a 4+ Aragorn arrives touching the edge of the ruin. He can\'t move that turn but otherwise acts as normal.',
      },
      {
        name: 'Cry of the Nazgûl',
        text: 'Once in the game, as a Move phase begins, the Evil side may give the cry: until the End phase, every Good model takes Courage tests 3 worse. If Aragorn hasn\'t come yet, he arrives this turn without a roll.',
      },
    ],
    cast: [
      { key: 'frodo', side: 'good', unit: '[the-fellowship] frodo-baggins', place: { at: [12, 12] } },
      { key: 'sam', side: 'good', unit: '[the-fellowship] samwise-gamgee', brand: true, place: { touching: 'frodo', angle: 180 } },
      { key: 'merry', side: 'good', unit: '[the-fellowship] meriadoc-brandybuck', brand: true, place: { touching: 'frodo', angle: 60 } },
      { key: 'pippin', side: 'good', unit: '[the-fellowship] peregrin-took', brand: true, place: { touching: 'frodo', angle: 300 } },
      { key: 'aragorn', side: 'good', unit: '[the-fellowship] aragorn-strider', options: ['Bow'], brand: true, place: { aside: true } },
      { key: 'witch-king', side: 'evil', unit: '[army-of-the-great-eye] the-witch-king-of-angmar', options: ['Morgul Blade'], stats: { A: 1 }, might: 1, will: 10, fate: 1, place: { rim: 'amon-sul', angle: 0 } },
      { key: 'ringwraith', side: 'evil', unit: '[army-of-the-great-eye] ringwraith', stats: { A: 1 }, might: 0, will: 7, fate: 0, place: { rim: 'amon-sul', angle: 72 } },
      { key: 'ringwraith', side: 'evil', unit: '[army-of-the-great-eye] ringwraith', stats: { A: 1 }, might: 0, will: 7, fate: 0, place: { rim: 'amon-sul', angle: 144 } },
      { key: 'ringwraith', side: 'evil', unit: '[army-of-the-great-eye] ringwraith', stats: { A: 1 }, might: 0, will: 7, fate: 0, place: { rim: 'amon-sul', angle: 216 } },
      { key: 'ringwraith', side: 'evil', unit: '[army-of-the-great-eye] ringwraith', stats: { A: 1 }, might: 0, will: 7, fate: 0, place: { rim: 'amon-sul', angle: 288 } },
    ],
  },
];

export const narrativeById = (id: string | null | undefined) => NARRATIVES.find(n => n.id === id);
export const narrativeOf = (state: Pick<GameState, 'narrative'>) => narrativeById(state.narrative?.id);

/** The seat playing a side. */
export const seatOf = (state: Pick<GameState, 'narrative'>, side: Side): Seat | undefined => (state.narrative ? (side === 'good' ? state.narrative.good : other(state.narrative.good)) : undefined);
/** The model of the cast with this key (the first, where several share it). */
export const castModel = (state: GameState, key: string): Model | undefined => Object.values(state.models).find(m => m.cast === key);

const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
const along = (c: Point, angle: number, d: number): Point => ({ x: c.x + Math.sin((angle * Math.PI) / 180) * d, y: c.y - Math.cos((angle * Math.PI) / 180) * d });
const angleOf = (c: Point, p: Point) => (Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI;

/** The round piece of terrain a placement's rim refers to, by its id in the scenario. */
const rimPiece = (state: GameState, id: string) => state.terrain[`n-${id}`];

/**
 * The scenario's table and both casts, ready to put down: Good for `good`, Evil for the other seat. Profiles come from
 * the bundled data, with the scenario's own wargear and characteristics on top.
 */
export function narrativeSetup(n: Narrative, good: Seat, catalog: Catalog, newId: (p: string) => string): { terrain: Terrain[]; models: Model[] } {
  const terrain = n.terrain.map(t => ({ ...t, id: `n-${t.id}` }));
  const models: Model[] = [];
  const at = (c: CastMember, m: Model): Point => {
    const p = c.place;
    if ('at' in p) return { x: p.at[0], y: p.at[1] };
    if ('touching' in p) {
      const friend = models.find(o => o.cast === p.touching);
      const centre = friend ?? { x: n.board.w / 2, y: n.board.h / 2 };
      return along(centre, p.angle, (friend ? radius(friend) : 0) + radius(m) + 0.02);
    }
    if ('rim' in p) {
      const t = terrain.find(x => x.id === `n-${p.rim}`)!;
      return along(t, p.angle, t.w / 2 + radius(m) + 0.02);
    }
    return offTable(m.owner, n.board);
  };
  for (const c of n.cast) {
    const unit = catalog.units[c.unit];
    if (!unit) continue;
    const ids = unit.options.filter(o => c.options?.includes(o.name)).map(o => o.id);
    const e = entriesFor(c.unit, unit, ids, 1)[0];
    if (!e) continue;
    const owner = c.side === 'good' ? good : other(good);
    const base = e.base ?? guessBase(e.name);
    const wounds = Math.max(1, e.wounds ?? 1);
    const m: Model = {
      id: newId('m'),
      owner,
      name: e.name,
      x: 0,
      y: 0,
      rot: 0,
      base,
      move: e.move ?? 6,
      wounds,
      maxWounds: wounds,
      might: c.might ?? e.might ?? 0,
      will: c.will ?? e.will ?? 0,
      fate: c.fate ?? e.fate ?? 0,
      hero: e.hero,
      dead: false,
      profileId: c.unit,
      ...(e.options?.length ? { options: e.options } : {}),
      cast: c.key,
      ...(c.stats ? { stats: c.stats } : {}),
      ...(c.brand ? { brand: true } : {}),
      ...('aside' in c.place ? { waiting: true } : {}),
    };
    const p = at(c, m);
    // Facing the middle of the table.
    const mid = { x: n.board.w / 2, y: n.board.h / 2 };
    models.push({ ...m, ...p, rot: Math.hypot(p.x - mid.x, p.y - mid.y) < 0.5 ? (owner === 'p1' ? 0 : 180) : Math.round(angleOf(p, mid)) });
  }
  return { terrain, models };
}

/**
 * Before the battle, the cast can only be moved where the scenario lets it stand: a model touching a friend goes
 * round that friend, one touching a piece of terrain goes round its edge, and the rest stay put.
 */
export function holdNarrative(state: GameState, mv: { id: string; x: number; y: number; rot?: number }): { id: string; x: number; y: number; rot?: number } {
  const n = narrativeOf(state);
  const m = state.models[mv.id];
  const c = n && m?.cast ? n.cast.find(x => x.key === m.cast) : undefined;
  if (!c || !m) return mv;
  const p = c.place;
  if ('touching' in p) {
    const friend = castModel(state, p.touching);
    if (friend) return { ...mv, ...along(friend, angleOf(friend, mv), radius(friend) + radius(m) + 0.02) };
  }
  if ('rim' in p) {
    const t = rimPiece(state, p.rim);
    if (t) return { ...mv, ...along(t, angleOf(t, mv), t.w / 2 + radius(m) + 0.02) };
  }
  return { ...mv, x: m.x, y: m.y };
}

/** The winner of a narrative scenario that has been decided, or null while it goes on. */
export function narrativeWinner(state: GameState): Seat | null {
  const n = narrativeOf(state);
  if (!n || !state.flow.started) return null;
  if (n.id === 'weathertop') {
    // The Nazgûl win as soon as Frodo falls; the Hobbits when every one of them is gone.
    if (castModel(state, 'frodo')?.dead) return seatOf(state, 'evil') ?? null;
    const evil = Object.values(state.models).filter(m => m.owner === seatOf(state, 'evil'));
    if (evil.length && evil.every(m => m.dead)) return seatOf(state, 'good') ?? null;
  }
  return null;
}

/** Whether a model is one of the Nine: they ignore much of the One Ring, and flaming brands drive them back. */
export const isRingwraith = (m: Pick<Model, 'name' | 'cast'>) => /ringwraith|witch-king|khamûl|nazgûl|dark marshal|shadow lord|undying|tainted|betrayer|knight of umbar|dwimmerlaik|forsaken/i.test(m.name);

// ——— Weathertop ———

/** The Cry of the Nazgûl is ringing: Good models' Courage tests are 3 worse until the End phase. */
export const cryRinging = (state: GameState, m: Model) =>
  state.narrative?.id === 'weathertop' && state.narrative.cry === state.turn && state.phase !== 'end' && m.owner === state.narrative.good;
export const cryPenalty = (state: GameState, m: Model) => (cryRinging(state, m) ? 3 : 0);

/** Whether the Evil side may give the Cry of the Nazgûl now: once a game, as a Move phase begins, before anyone moves. */
export function mayCry(state: GameState, seat: Seat): boolean {
  if (state.narrative?.id !== 'weathertop' || state.narrative.cry || !state.flow.started || state.phase !== 'move') return false;
  if (seat === state.narrative.good || state.flow.done.length || Object.keys(state.flow.starts ?? {}).length) return false;
  return Object.values(state.models).some(m => m.owner === seat && !m.dead);
}

/**
 * Aragorn's arrival is due: from turn 2 (or straight away, after the Cry), once the Good side has finished its move
 * and once a turn.
 */
export function arrivalDue(state: GameState): boolean {
  const ns = state.narrative;
  if (ns?.id !== 'weathertop' || !state.flow.started || state.phase !== 'move' || !state.flow.done.includes(ns.good) || ns.rolled?.includes(state.turn)) return false;
  const aragorn = castModel(state, 'aragorn');
  if (!aragorn?.waiting || aragorn.dead) return false;
  return state.turn >= 2 || ns.cry === state.turn;
}

/**
 * Rolls for Aragorn (no roll after the Cry) and, on a 4+, brings him on touching the edge of the ruin where he is
 * needed most: nearest the enemy closest to Frodo, clear of the enemy.
 */
export function rollArrival(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const ns = state.narrative!;
  const aragorn = castModel(state, 'aragorn')!;
  const auto = ns.cry === state.turn;
  const die = auto ? undefined : d6();
  const comes = auto || die! >= 4;
  const roll: DiceRoll = {
    id: `n-${uid()}`,
    by: ns.good,
    label: auto ? 'Aragorn hears the Cry of the Nazgûl and arrives' : 'Aragorn arrives on a 4+',
    dice: die ? [die] : [],
    ...(die ? { target: 4 } : {}),
    note: comes ? 'He arrives touching the edge of the ruin.' : 'Not yet.',
    at: now,
  };
  const out: Action[] = [{ type: 'rolled', roll }, { type: 'narrativeNote', rolled: state.turn }];
  if (!comes) return out;
  const spot = arrivalSpot(state, aragorn);
  if (spot) out.push({ type: 'arrive', seat: ns.good, moves: [{ id: aragorn.id, ...spot }] });
  return out;
}

function arrivalSpot(state: GameState, m: Model): { x: number; y: number; rot: number } | null {
  const ruin = rimPiece(state, 'amon-sul');
  if (!ruin) return null;
  const frodo = castModel(state, 'frodo');
  const foes = Object.values(state.models).filter(o => o.owner !== m.owner && !o.dead && !o.waiting);
  const threat = frodo ? [...foes].sort((a, b) => Math.hypot(a.x - frodo.x, a.y - frodo.y) - Math.hypot(b.x - frodo.x, b.y - frodo.y))[0] : undefined;
  const want = threat ? angleOf(ruin, threat) : 180;
  const r = ruin.w / 2 + radius(m) + 0.02;
  const clear = (p: Point) => Object.values(state.models).every(o => o.id === m.id || o.dead || o.waiting || Math.hypot(o.x - p.x, o.y - p.y) >= radius(o) + radius(m) + (o.owner !== m.owner ? 1.05 : 0.05));
  for (let k = 0; k < 72; k++) {
    const turn = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5;
    const p = along(ruin, want + turn, r);
    if (p.x < radius(m) || p.y < radius(m) || p.x > state.board.w - radius(m) || p.y > state.board.h - radius(m) || !clear(p)) continue;
    return { ...p, rot: Math.round(angleOf(p, ruin)) };
  }
  return null;
}
