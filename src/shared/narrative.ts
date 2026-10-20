import { entriesFor, type Catalog, type StatName } from './catalog.ts';
import { arrivalDue, other } from './flow.ts';
import { halfExtents, type Point } from './geometry.ts';
import { guessBase } from './importList.ts';
import { offTable } from './maelstrom.ts';
import { muttonWinner } from './mutton.ts';
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
  | { aside: true }
  /** Starting at `at`, and kept within `within` inches of another member of the cast or a piece of terrain. */
  | { near: string; within: number; at: [number, number] }
  /** Touching the middle of a table edge. */
  | { edge: 'north' | 'east' | 'south' | 'west' };

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
  /** A line on what happens, in our own words. */
  blurb: string;
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
    blurb: 'Night on Amon Sûl: the Nine close in on Frodo and the Ring, and only burning brands and Strider stand in their way.',
    board: { w: 24, h: 24, mat: 'plains' },
    terrain: [
      piece({ id: 'amon-sul', kind: 'ruin', shape: 'circle', x: 12, y: 12, w: 12, h: 12, difficult: false, height: 1 }),
      // Trees and rubble dotted round the hill, where the scenario's map has them.
      piece({ id: 'trees-nw', kind: 'wood', shape: 'circle', x: 6, y: 2.7, w: 2.4, h: 2.4 }),
      piece({ id: 'tree-nw', kind: 'wood', shape: 'circle', x: 3.8, y: 3.4, w: 1.3, h: 1.3 }),
      piece({ id: 'tree-n', kind: 'wood', shape: 'circle', x: 18.9, y: 1.5, w: 1.3, h: 1.3 }),
      piece({ id: 'trees-ne', kind: 'wood', shape: 'circle', x: 20.1, y: 3.4, w: 2.1, h: 2.1 }),
      piece({ id: 'tree-w', kind: 'wood', shape: 'circle', x: 2.5, y: 9.3, w: 1.2, h: 1.2 }),
      piece({ id: 'trees-e', kind: 'wood', shape: 'circle', x: 21.7, y: 13.8, w: 1.9, h: 1.9 }),
      piece({ id: 'trees-sw', kind: 'wood', shape: 'circle', x: 1.5, y: 18.6, w: 1.8, h: 1.8 }),
      piece({ id: 'tree-sw', kind: 'wood', shape: 'circle', x: 3.6, y: 18.1, w: 1.2, h: 1.2 }),
      piece({ id: 'trees-se', kind: 'wood', shape: 'circle', x: 21.2, y: 20, w: 1.9, h: 1.9 }),
      piece({ id: 'tree-s', kind: 'wood', shape: 'circle', x: 14, y: 22.6, w: 1.3, h: 1.3 }),
      piece({ id: 'outcrop-w', kind: 'rock', x: 2.2, y: 15.6, w: 3.4, h: 1.1, rot: 25, height: 1 }),
      piece({ id: 'rubble-w', kind: 'rock', x: 3.9, y: 7.3, w: 1.4, h: 1, rot: 20, height: 0.5 }),
      piece({ id: 'rubble-n', kind: 'rock', x: 12.2, y: 2.3, w: 1, h: 0.7, rot: -15, height: 0.5 }),
      piece({ id: 'rubble-ne', kind: 'rock', x: 17.3, y: 5.5, w: 1.4, h: 0.7, rot: 10, height: 0.5 }),
      piece({ id: 'rubble-e', kind: 'rock', x: 20.2, y: 8.4, w: 1, h: 0.7, rot: 30, height: 0.5 }),
      piece({ id: 'rubble-s', kind: 'rock', x: 15.3, y: 20.4, w: 1, h: 0.7, rot: -20, height: 0.5 }),
      piece({ id: 'rubble-sw', kind: 'rock', x: 9.4, y: 20.6, w: 1.4, h: 1, rot: 15, height: 0.5 }),
    ],
    sides: {
      good: { name: 'The Hobbits', cast: 'Frodo, Sam, Merry and Pippin, with Aragorn on his way' },
      evil: { name: 'The Nazgûl', cast: 'The Witch-king and four Ringwraiths' },
    },
    layout: 'A 2\' by 2\' table: the ruined watchtower of Amon Sûl, 12" across, fills the middle, with trees and piles of rubble dotted round it.',
    deployment: 'Frodo stands in the middle of the ruin with the other three Hobbits touching him. The Nazgûl start touching the edge of the ruin, wherever their player likes round it. Aragorn is kept off the table.',
    objectives: 'The Nazgûl win the moment Frodo is slain. The Hobbits win if every one of the Nazgûl is slain first.',
    rules: [
      {
        name: 'Flaming Brands',
        text: 'Aragorn, Sam, Merry and Pippin each carry a burning brand. A Ringwraith that loses a fight to one of them backs away as usual, then retreats a further D6" away from it, whichever way its player chooses. Once in the game Aragorn may throw his as a throwing weapon: if it hits, there is no roll To Wound, the model hit is Set Ablaze instead, and the brand is gone.',
      },
      {
        name: 'Aragorn',
        text: 'From turn 2, each time the Good side finishes its move, the Good player may roll a D6: on a 4+ Aragorn arrives, and the Good player places him anywhere touching the edge of the ruin. That Move phase is over for him, but he shoots and fights as normal.',
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
  {
    id: 'roast-mutton',
    name: 'Roast Mutton',
    from: 'The Hobbit: An Unexpected Journey',
    blurb: 'Night in the Trollshaws: three hungry Trolls have caught Bilbo, and Thorin\'s Company charges out of the trees to get him back before they all end up in the pot.',
    board: { w: 24, h: 24, mat: 'forest' },
    terrain: [
      piece({ id: 'campfire', kind: 'objective', object: 'campfire', shape: 'circle', x: 12, y: 12, w: 2, h: 2 }),
      // The ponies' pen, and the Trolls' heap of supplies.
      piece({ id: 'pen-n', kind: 'wall', x: 18.5, y: 3.5, w: 5, h: 0.4, height: 1 }),
      piece({ id: 'pen-s', kind: 'wall', x: 18.5, y: 7.5, w: 5, h: 0.4, height: 1 }),
      piece({ id: 'pen-e', kind: 'wall', x: 21, y: 5.5, w: 0.4, h: 4, height: 1 }),
      piece({ id: 'supplies', kind: 'rock', x: 15.5, y: 16, w: 2, h: 1.4, rot: 15, height: 1 }),
      piece({ id: 'trees-nw', kind: 'wood', shape: 'circle', x: 4, y: 4, w: 6, h: 6 }),
      piece({ id: 'trees-sw', kind: 'wood', shape: 'circle', x: 4, y: 20, w: 6, h: 6 }),
      piece({ id: 'trees-se', kind: 'wood', shape: 'circle', x: 20.5, y: 20.5, w: 5, h: 5 }),
      piece({ id: 'rocks-n', kind: 'rock', x: 11, y: 2.5, w: 3, h: 2, rot: -10, height: 2 }),
      piece({ id: 'rocks-e', kind: 'rock', x: 22, y: 13, w: 2, h: 3, rot: 20, height: 2 }),
    ],
    sides: {
      good: { name: "Thorin's Company", cast: 'Bilbo, caught in the camp, Kíli coming for him, and the other twelve Dwarves close behind' },
      evil: { name: 'The Trolls', cast: 'Bill, Bert and Tom' },
    },
    layout: 'A 2\' by 2\' clearing in the Trollshaws: the Trolls\' campfire in the middle, their supplies and the captured ponies\' pen beside it, and thick woods and rocky outcrops round the edges.',
    deployment: 'The Trolls start within 3" of the campfire. Bilbo starts within 3" of Bill, and Kíli touching the middle of the west edge. The rest of the Company is kept off the table.',
    objectives: 'The Company wins by slaying all three Trolls before the sun comes up. The Trolls win if every member of the Company is slain or stuffed in a sack before then. When the sun rises with neither done, it is a draw. If Bilbo is slain, the Company can do no better than a draw.',
    rules: [
      {
        name: 'The Dawn',
        text: 'From the start of turn 7, each turn begins with a D6 roll: on a 4+ Gandalf breaks open the rocks, sunlight floods the clearing, the Trolls turn to stone and the game ends.',
      },
      {
        name: 'The Company Arrives',
        text: 'When the Good side finishes its move in turn 1, it rolls a D6 for each Dwarf still off the table: on a 3+ that Dwarf comes on, moving onto the table from the middle of the west edge as reinforcements (a full move from the edge, but no charging). The rest come on the same way when the Good side finishes its move in turn 2, without a roll.',
      },
      {
        name: 'A Burrahobbit?',
        text: 'The Trolls don\'t know what to make of Bilbo: until turn 3 begins, none of them may strike him, unless he charges one of them first.',
      },
    ],
    cast: [
      { key: 'bill', side: 'evil', unit: '[the-three-trolls] bill-the-troll', place: { near: 'campfire', within: 3, at: [12, 8.6] } },
      { key: 'bert', side: 'evil', unit: '[the-three-trolls] bert-the-troll', place: { near: 'campfire', within: 3, at: [15, 13.8] } },
      { key: 'tom', side: 'evil', unit: '[the-three-trolls] tom-the-troll', place: { near: 'campfire', within: 3, at: [9, 13.8] } },
      { key: 'bilbo', side: 'good', unit: "[thorin's-company] bilbo-baggins", place: { near: 'bill', within: 3, at: [9.4, 7.6] } },
      { key: 'kili', side: 'good', unit: "[thorin's-company] kili-the-dwarf", place: { edge: 'west' } },
      { key: 'thorin', side: 'good', unit: "[thorin's-company] thorin-oakenshield", options: ['The Oakenshield'], place: { aside: true } },
      ...(['fili', 'balin', 'dwalin', 'bifur', 'bofur', 'bombur', 'ori', 'nori', 'dori', 'oin', 'gloin'] as const).map((k): CastMember => ({ key: k, side: 'good', unit: `[thorin's-company] ${k}-the-dwarf`, place: { aside: true } })),
    ],
  },
];

export const narrativeById = (id: string | null | undefined) => NARRATIVES.find(n => n.id === id);
export const narrativeOf = (state: Pick<GameState, 'narrative'>) => narrativeById(state.narrative?.id);

/** The seat playing a side. */
export const seatOf = (state: Pick<GameState, 'narrative'>, side: Side): Seat | undefined => (state.narrative ? (side === 'good' ? state.narrative.good : other(state.narrative.good)) : undefined);
/** Where a model touching the middle of a table edge stands. */
function edgeMiddle(board: { w: number; h: number }, edge: 'north' | 'east' | 'south' | 'west', r: number): Point {
  if (edge === 'west') return { x: r, y: board.h / 2 };
  if (edge === 'east') return { x: board.w - r, y: board.h / 2 };
  return { x: board.w / 2, y: edge === 'north' ? r : board.h - r };
}

/** The model of the cast with this key (the first, where several share it). */
export const castModel = (state: GameState, key: string): Model | undefined => Object.values(state.models).find(m => m.cast === key);

export const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
export const along = (c: Point, angle: number, d: number): Point => ({ x: c.x + Math.sin((angle * Math.PI) / 180) * d, y: c.y - Math.cos((angle * Math.PI) / 180) * d });
export const angleOf = (c: Point, p: Point) => (Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI;

/** The round piece of terrain a placement's rim refers to, by its id in the scenario. */
export const rimPiece = (state: GameState, id: string) => state.terrain[`n-${id}`];

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
    if ('edge' in p) return edgeMiddle(n.board, p.edge, radius(m));
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
  if ('near' in p) {
    // Within so far of a friend, or of a marker (measured to its edge): pulled back in if dragged further.
    const friend = castModel(state, p.near);
    const t = friend ? undefined : rimPiece(state, p.near);
    const c = friend ?? t;
    if (c) {
      const reach = p.within + radius(m) + (friend ? radius(friend) : t!.w / 2);
      const d = Math.hypot(mv.x - c.x, mv.y - c.y);
      const k = d > reach ? reach / d : 1;
      const r = radius(m);
      return { ...mv, x: Math.max(r, Math.min(state.board.w - r, c.x + (mv.x - c.x) * k)), y: Math.max(r, Math.min(state.board.h - r, c.y + (mv.y - c.y) * k)) };
    }
  }
  return { ...mv, x: m.x, y: m.y };
}

/** The winner of a narrative scenario that has been decided, or null while it goes on. */
export function narrativeWinner(state: GameState): Seat | 'draw' | null {
  const n = narrativeOf(state);
  if (!n || !state.flow.started) return null;
  if (n.id === 'roast-mutton') return muttonWinner(state);
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

// Aragorn's arrival window lives with the turn's flow, which waits on it.
export { arrivalDue };

/** After the Cry Aragorn comes without a roll; otherwise rolling for him is the Good player's choice. */
export const arrivalAuto = (state: GameState) => arrivalDue(state) && state.narrative?.cry === state.turn;

/** The Good player chooses not to roll for Aragorn this turn. */
export function skipArrival(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const ns = state.narrative!;
  const roll: DiceRoll = { id: `n-${uid()}`, by: ns.good, label: 'No roll for Aragorn this turn', dice: [], note: 'He stays away for now.', at: now };
  return [{ type: 'rolled', roll }, { type: 'narrativeNote', rolled: state.turn }];
}

/**
 * Rolls for Aragorn (no roll after the Cry) and, on a 4+, brings him on touching the edge of the ruin where he is
 * needed most (nearest the enemy closest to Frodo, clear of the enemy), for the Good player to move round the edge.
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
  const out: Action[] = [{ type: 'rolled', roll }];
  const spot = comes ? arrivalSpot(state, aragorn) : null;
  // He comes on where he's needed most, and the Good player can then move him anywhere round the ruin's edge.
  if (spot) out.push({ type: 'arrive', seat: ns.good, moves: [{ id: aragorn.id, ...spot }] }, { type: 'placing', placing: { model: aragorn.id, seat: ns.good, kind: 'arrive', from: [spot.x, spot.y], rim: 'amon-sul' } });
  // Marked last, so play goes on only once he has been placed.
  out.push({ type: 'narrativeNote', rolled: state.turn });
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
