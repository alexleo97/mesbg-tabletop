import { entriesFor, type Catalog, type StatName } from './catalog.ts';
import { arrivalDue, other } from './flow.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { guessBase } from './importList.ts';
import { offTable } from './maelstrom.ts';
import { muttonWinner } from './mutton.ts';
import { helmsWinner } from './helms.ts';
import { ambushWinner, isHobbit } from './ambush.ts';
import { balinWinner } from './balin.ts';
import { balinCast, balinTerrain } from './balinMap.ts';
import { amonWinner } from './amon.ts';
import { amonCast, amonTerrain } from './amonMap.ts';
import { entsWinner } from './ents.ts';
import { entsCast, entsTerrain } from './entsMap.ts';
import { unseenWinner } from './unseen.ts';
import { unseenCast, unseenTerrain } from './unseenMap.ts';
import { elvesWinner } from './elves.ts';
import { elvesCast, elvesTerrain } from './elvesMap.ts';
import { lakeWinner } from './lake.ts';
import { goblinWinner, noFooting } from './goblin.ts';
import { isWeaponItem } from './wargear.ts';
import { gearOf } from './gear.ts';
import { lakeCast, lakeTerrain } from './lakeMap.ts';
import { fireWinner } from './eagles.ts';
import { eaglesCast, eaglesTerrain } from './eaglesMap.ts';
import { goblinCast, goblinTerrain } from './goblinMap.ts';
import { osgiliathCast, osgiliathTerrain } from './osgiliathMap.ts';
import { osgiliathWinner } from './osgiliath.ts';
import { insidePolygon, outline } from './sight.ts';
import { BALLISTA_BASE, deepingSlots, evilSlots, GATE_ANGLE, HELMS_TEAMS, helmsTerrain, hornburgSlots, inHelmsZone, onArc, OUTER, type HelmsZone } from './helmsMap.ts';
import type { Action, Base, DiceRoll, GameState, Mat, Model, Seat, Terrain } from './types.ts';

// Narrative scenarios: battles from the stories, each with its own table, a fixed cast on both sides and rules of its
// own, all in our own words. Positions are inches from the top-left corner of the scenario's own table.

export type Side = 'good' | 'evil';

/** The two tales the scenarios come from, in the order the menu lists them. */
export const SAGAS = [
  { id: 'hobbit', name: 'The Hobbit' },
  { id: 'lotr', name: 'The Lord of the Rings' },
] as const;
export type Saga = (typeof SAGAS)[number]['id'];

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
  | { edge: 'north' | 'east' | 'south' | 'west' }
  /** Starting at `at`, and kept within one of the scenario's own areas (Helm's Deep: the Hornburg, the Deeping Wall). */
  | { zone: HelmsZone; at: [number, number] }
  /**
   * Starting at `at`, and kept wholly within an area of the table (a deployment zone); and, where the scenario says so,
   * within so far of each of a group of friends (Amon Hen: Merry, Pippin and Boromir within 1" of each other).
   */
  | { area: Area; at: [number, number]; close?: { keys: string[]; within: number } }
  /** Starting at `at`, in base contact with the edge of a piece of terrain (Amon Hen: the Seeing Seat). */
  | { against: string; at: [number, number] }
  /** Starting at `at`, and kept at least so far from every friend (Amon Hen: Sam, 12" from the rest of the Fellowship). */
  | { apart: number; at: [number, number] }
  /** Starting at `at`, touching whichever table edge it is dragged nearest (The Unseen Hero: Bilbo). */
  | { anyEdge: true; at: [number, number] }
  /** Starting at `at`, and kept at least so far from every enemy (The Elves of Mirkwood: the Spiders, 10" from the Dwarves). */
  | { clear: number; at: [number, number] };

/**
 * A deployment zone: a circle round a point (x, y, radius), a box (x0, y0, x1, y1), a ring round a point (x, y, from,
 * to), within so far of a piece of terrain (by its id in the scenario), or between so far and so far of a member of the
 * cast (measured from its base).
 */
export type Area =
  | { circle: [number, number, number] }
  | { box: [number, number, number, number] }
  | { ring: [number, number, number, number] }
  | { piece: string; within: number }
  | { around: string; from: number; to: number }
  /** Wholly on top of one of these pieces (Last March of the Ents: any of the scaffolds). */
  | { on: string[] }
  /** Wholly within any one of these areas. */
  | { any: Area[] }
  /** Wholly within every one of these areas (Lake-town Escape: section D, and within 3" of Bard's House). */
  | { all: Area[] };

/** What an area can be measured from: the scenario's pieces (by id, as on the table) and the cast on the table. */
export interface AreaFrom {
  terrain?: Record<string, Terrain> | Terrain[];
  models?: Record<string, Model> | Model[];
}

/** How far a point is from the segment a to b. */
function segmentGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy);
}

/** How far a point is from a rectangular piece (0 on or inside it). */
export const toPiece = (t: Pick<Terrain, 'x' | 'y' | 'w' | 'h'>, p: Point) => Math.hypot(Math.max(t.x - t.w / 2 - p.x, 0, p.x - t.x - t.w / 2), Math.max(t.y - t.h / 2 - p.y, 0, p.y - t.y - t.h / 2));

/** Whether a model this far across (from its middle) stands wholly within an area. */
export function whollyInArea(a: Area, p: Point, r: number, from: AreaFrom = {}): boolean {
  if ('any' in a) return a.any.some(x => whollyInArea(x, p, r, from));
  if ('all' in a) return a.all.every(x => whollyInArea(x, p, r, from));
  if ('on' in a) {
    const all = Object.values(from.terrain ?? {});
    if (!all.length) return true;
    return a.on.some(id => {
      const t = all.find(x => x.id === `n-${id}`);
      if (!t) return false;
      const poly = outline(t);
      return insidePolygon(poly, p) && poly.every((q, j) => segmentGap(p, poly[(j || poly.length) - 1], q) >= r - 0.01);
    });
  }
  if ('circle' in a) return Math.hypot(p.x - a.circle[0], p.y - a.circle[1]) + r <= a.circle[2] + 0.01;
  if ('ring' in a) {
    const d = Math.hypot(p.x - a.ring[0], p.y - a.ring[1]);
    return d - r >= a.ring[2] - 0.01 && d + r <= a.ring[3] + 0.01;
  }
  if ('piece' in a) {
    const t = Object.values(from.terrain ?? {}).find(x => x.id === `n-${a.piece}`);
    return !t || toPiece(t, p) + r <= a.within + 0.01;
  }
  if ('around' in a) {
    const m = Object.values(from.models ?? {}).find(x => x.cast === a.around && !x.dead && !x.waiting);
    if (!m) return true;
    const d = Math.hypot(p.x - m.x, p.y - m.y) - radius(m);
    return d - r >= a.from - 0.01 && d + r <= a.to + 0.01;
  }
  const [x0, y0, x1, y1] = a.box;
  return p.x - r >= x0 - 0.01 && p.x + r <= x1 + 0.01 && p.y - r >= y0 - 0.01 && p.y + r <= y1 + 0.01;
}

export interface CastMember {
  /** Who it is, for the scenario's rules: 'frodo', 'aragorn'. */
  key: string;
  side: Side;
  /** The profile, as a unit id in the bundled data. */
  unit: string;
  /** Wargear the scenario gives it, by option name. */
  options?: string[];
  /** Wargear the scenario gives it that its profile has no option for (Amon Hen: an Elven cloak). */
  gear?: string[];
  /** Characteristics the scenario sets, in place of the profile's. */
  stats?: Partial<Record<StatName, number>>;
  might?: number;
  will?: number;
  fate?: number;
  /** A flaming brand (Weathertop). */
  brand?: boolean;
  /** A lit torch, to set off a Demolition Charge (Helm's Deep). */
  torch?: boolean;
  /** Starts the game wearing the One Ring (The Unseen Hero). */
  ring?: boolean;
  /** A name of its own, where the scenario's model uses another's profile (an Uruk-hai Engineer). */
  name?: string;
  /** Its base, where the book gives one the data doesn't. */
  base?: Base;
  /** Which way it faces at the start, in degrees (0 up the table); unset, it faces the middle of the table. */
  facing?: number;
  /** Starts Prone; bound (it can only crawl, and may roll to cut its bonds); crawls this far and can't stand up; and is underfoot (Ambush at Night). */
  prone?: boolean;
  bound?: boolean;
  crawls?: number;
  slips?: boolean;
  /** Starts the game stripped of its weapons, though not its armour (Escape from Goblin-town). */
  unarmed?: boolean;
  place: Placement;
}

/** A piece of a scenario's table; a gate or a marker can belong to one side, whichever seat plays it. */
export type NarrativeTerrain = Terrain & { held?: Side };

export interface NarrativeRule {
  name: string;
  text: string;
}

export interface Narrative {
  id: string;
  name: string;
  /** The book it comes from, and which tale that is part of (the menu lists them under it). */
  from: string;
  saga: Saga;
  /** A line on what happens, in our own words. */
  blurb: string;
  board: { w: number; h: number; mat: Mat };
  /** The table's terrain; a piece's `id` is what the cast's placements refer to. */
  terrain: NarrativeTerrain[];
  /** What each side is called, and a line on who is in it. */
  sides: Record<Side, { name: string; cast: string }>;
  layout: string;
  deployment: string;
  objectives: string;
  rules: NarrativeRule[];
  cast: CastMember[];
  /** How long the battle lasts when the players choose (Helm's Deep), in turns, and the choices offered. */
  turns?: { choices: number[]; default: number };
  /** Which side sets up first, as the book's Starting Positions order it: each side in turn arranges its cast. */
  setupOrder?: Side[];
}

const piece = (t: Partial<Terrain> & Pick<Terrain, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Terrain => ({ shape: 'rect', rot: 0, locked: true, ...t });

export const NARRATIVES: Narrative[] = [
  {
    id: 'weathertop',
    name: 'Weathertop',
    from: 'The Fellowship of the Ring',
    saga: 'lotr',
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
    setupOrder: ['good', 'evil'],
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
    saga: 'hobbit',
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
    setupOrder: ['evil', 'good'],
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
  {
    id: 'the-unseen-hero',
    name: 'The Unseen Hero',
    from: 'The Hobbit: The Desolation of Smaug',
    saga: 'hobbit',
    blurb: 'Deep in Mirkwood the Spiders have the Dwarves trussed up for supper. Only Bilbo is left, invisible with his new ring and Sting in his hand, to find them and cut them free.',
    board: { w: 48, h: 48, mat: 'forest' },
    terrain: unseenTerrain(),
    sides: {
      good: { name: 'Bilbo', cast: 'Bilbo Baggins, with the One Ring and Sting' },
      evil: { name: 'The Spiders', cast: '6 Mirkwood Giant Spiders, and three webbed bundles: two hold Dwarves, one is a decoy' },
    },
    layout:
      "A 4' by 4' stretch of Mirkwood, thick with trees: great gnarled trees on mounds of roots and stones, crooked lesser trees in tangles of undergrowth between them, and boulders.",
    setupOrder: ['evil', 'good'],
    deployment:
      'The Evil player places the three webbed bundles at least 6" apart and secretly picks which one is the decoy; then sets up the Spiders at least 6" from one another. Then Bilbo starts touching any table edge, wearing the Ring.',
    objectives:
      'The battle goes on until the end of a turn in which one side has done what it came to do. Bilbo wins if he has freed both lots of Dwarves (cut open the two right bundles), or if every Spider is slain. The Spiders win if Bilbo is slain.',
    rules: [
      {
        name: 'Brave Master Baggins',
        text: 'In a turn in which Bilbo charges, he has +1 Fight and +1 Attack until the End phase. His stones are a throwing weapon (Strength 1, 8"), rather than Throw Stones.',
      },
      {
        name: 'The Power of the Ring',
        text: 'While Bilbo wears the Ring, each Spider starts its activation with an Intelligence test. Passed, the Evil player moves it D6"; failed, the Good player does. It must go the whole way, may not leave the table, and stops only if it touches Bilbo, which counts as charging him. Once a Spider has charged Bilbo, the rest of the Spiders pass their tests that turn.',
      },
      {
        name: 'Caught in a Web',
        text: 'If Bilbo is touching a bundle in the End phase, roll a D6: on a 3+ he cuts it open, and the Evil player reveals whether it held Dwarves.',
      },
    ],
    cast: unseenCast(),
  },
  {
    id: 'the-elves-of-mirkwood',
    name: 'The Elves of Mirkwood',
    from: 'The Hobbit: The Desolation of Smaug',
    saga: 'hobbit',
    blurb: 'Freed from the webs, the Dwarves stagger about the forest floor in the choking air of Mirkwood, and the Spiders keep coming. Hold on until the Elves of the Woodland Realm arrive.',
    board: { w: 48, h: 48, mat: 'forest' },
    terrain: elvesTerrain(),
    sides: {
      good: { name: "Thorin's Company and the Elves", cast: 'Thorin Oakenshield with Orcrist, the twelve other Dwarves, and Bilbo Baggins with Sting and the One Ring; Legolas with an Elven cloak, Tauriel with an Elf bow and 10 Mirkwood Rangers, who arrive later' },
      evil: { name: 'The Spiders', cast: '10 Mirkwood Giant Spiders' },
    },
    layout: "A 4' by 4' stretch of Mirkwood's overgrown floor: great gnarled trees on mounds of roots and stones, crooked lesser trees in tangles of undergrowth, boulders, and a long rocky ridge running down from the north-east of the middle.",
    setupOrder: ['good', 'evil'],
    deployment: 'The Good player sets up the Dwarves and Bilbo within 6" of the middle of the table. Then the Evil player sets up the Spiders anywhere at least 10" from every Good model. Legolas, Tauriel and the Rangers are kept aside: they arrive later.',
    objectives: 'The battle lasts 12 turns. The Spiders win as soon as they have slain six of Thorin\'s Company. Otherwise, if ten or more of the company are alive at the end, the Good side wins; anything else is a draw.',
    rules: [
      {
        name: 'The Haze of Mirkwood',
        text: "At the start of each Dwarf's activation, roll a D6. On a 4+ it acts as normal. On a 1-3 it can't act that turn: it rolls a single die in a fight, and makes no strikes if it wins. (The game rolls for all the Dwarves at once, as each Move phase begins. Bilbo isn't affected.)",
      },
      {
        name: 'The Rangers',
        text: "As the Good side's fourth Move phase ends, Legolas, Tauriel and the Mirkwood Rangers move onto the table as reinforcements from any table edge. (The Good player picks the edge, and can change it until they arrive.)",
      },
      {
        name: "The Spider's Nest",
        text: 'Slain Spiders are set aside. At the start of each Priority phase, before Priority is rolled, the Evil player may put any of them back on the table at least 10" from every Good model, to fight on as normal.',
      },
    ],
    cast: elvesCast(),
  },
  {
    id: 'lake-town-escape',
    name: 'Lake-town Escape',
    from: 'The Hobbit: The Desolation of Smaug',
    saga: 'hobbit',
    blurb: 'Their raid on Bard’s House has failed to find Thorin, and the Orcs are creeping back through Lake-town to report to their masters. Legolas means to hunt down every one of them before they get away.',
    board: { w: 48, h: 48, mat: 'water' },
    terrain: lakeTerrain(),
    sides: {
      good: { name: 'Legolas', cast: 'Legolas Greenleaf, Prince of Mirkwood, with Orcrist' },
      evil: { name: 'Bolg’s Orcs', cast: 'Bolg, Spawn of Azog; Fimbul, Hunter Orc Captain; 24 Hunter Orc Warriors (6 with Orc bows, 6 with two-handed weapons)' },
    },
    layout:
      "A 4' by 4' corner of Lake-town on the Long Lake: wooden walkways winding between houses and towers, with boats tied up and ice floes drifting between. Bard's House stands on the east edge. Everything else is the lake: Deep Water.",
    setupOrder: ['evil', 'good'],
    deployment:
      'The table is split into four sections, A to D from west to east, each 12" wide. The Evil player sets up a group of 6 Hunter Orc Warriors in each section, not within 3" of another section; the group in section D wholly within 3" of Bard\'s House. Bolg sets up with the group in section A, and Fimbul with the group in section C. Then Legolas sets up touching Bard\'s House.',
    objectives:
      'The battle goes on until the end of a turn in which a side has done what it came to do. Legolas wins once every Evil model is slain. The Evil side wins if Legolas is slain, or if Bolg leaves by the west edge without being seriously injured. (Once Legolas or the last Orc falls, the game ends there and then.)',
    rules: [
      {
        name: 'Silent Assassins',
        text: "Only the Orcs in section D start knowing Legolas is there; the rest are Sentries until the alarm is raised in their section. A Sentry can't charge, shoot or leave its own section, and as it activates, before the rest of its side moves, it rolls on the Sentry Chart: on a 1 it searches about and doesn't move; on a 2-3 it hears a noise, and the Good player moves it up to half its Move; on a 4-5 it is suspicious, and the Evil player moves it up to half its Move; on a 6 it moves as normal. The alarm goes up in a section at once when an Orc that knows walks into base contact with one of its Sentries, or in the End phase if Legolas charged or shot at one of its Sentries that turn and it is still alive.",
      },
      {
        name: "Legolas' Fury",
        text: 'Legolas has 3 Attacks and Fight 7.',
      },
      {
        name: 'The Spawn of Azog',
        text: "Bolg has 3 Fate points. While he has all his Wounds he can't leave the table, and as he activates he must charge Legolas if he can (unless he is still a Sentry). On his last Wound he is seriously injured: if he leaves by the west edge then, the Evil side can do no better than a draw.",
      },
      {
        name: 'Deep Water',
        text: "Away from the walkways, houses, boats and floes, the lake is Deep Water. A model going into it, or starting its move in it, takes a Swim test: on a 1 it sinks and is lost; on a 2-5 it swims on with half the Move it has left; on a 6 with all of it. A gap no wider than twice a model's height can be leapt instead. Nobody shoots from the water.",
      },
    ],
    cast: lakeCast(),
  },
  {
    id: 'and-into-the-fire',
    name: 'Out of the Frying Pan... And Into the Fire',
    from: 'The Hobbit: An Unexpected Journey',
    saga: 'hobbit',
    blurb: "Out of the mountains and straight into Azog's Hunters: the Company clings to the pines at the cliff's edge while Thorin goes for the Pale Orc, and the Eagles fly down to carry everyone away.",
    board: { w: 48, h: 48, mat: 'plains' },
    terrain: eaglesTerrain(),
    sides: {
      good: { name: "Thorin's Company and the Eagles", cast: 'Thorin Oakenshield with Orcrist and the Oakenshield; Bilbo Baggins with Sting and the One Ring; Gwaihir and 4 Great Eagles, who arrive later' },
      evil: { name: "Azog's Hunters", cast: 'Azog on the White Warg; Fimbul, Hunter Orc Captain, on a Fell Warg; 12 Hunter Orc Warg Riders; 12 Fell Wargs' },
    },
    layout: "A 4' by 4' mountainside: a stand of pines runs down the east of the table, each tree on its own woodland base or sharing one, with a rocky cliff edge along the east edge beyond them. The open ground to the west has rocky outcrops and a patch of brush.",
    setupOrder: ['evil', 'good'],
    deployment: 'The Evil player sets up every model wholly within 6" of the west edge. Then the Good player sets up Thorin touching the tree nearest the middle of the open ground (the one the map marks). Bilbo and the Eagles are kept aside: they come later. Then the players take turns, the Good player first, to nominate five trees between them: the Dwarves hide in these, and a Dwarf Marker goes beside each.',
    objectives: "The battle goes on until the Dwarf Markers, Thorin and Bilbo are all off the table. The Good side wins if the Eagles carry every one of them off. The Evil side wins if it stops that: once a Dwarf Marker, Thorin or Bilbo is lost, the game ends there and then.",
    rules: [
      {
        name: 'Rescuing the Dwarves',
        text: "As each Good Move phase ends, an Eagle that isn't in a fight picks up a Dwarf Marker it is touching, as a Light Object; Thorin and Bilbo can be carried the same way. (The game picks them up for you: an Eagle carries one at a time, Thorin first, then Bilbo, then the markers.) An Eagle that leaves the table carrying one has rescued it. A carrying Eagle can't make Brutal Power Attacks, and if it is slain, whoever it carries is lost and counts as slain.",
      },
      {
        name: 'Friends on Swift-wings',
        text: "As the Good side's second Move phase ends, Gwaihir and the Great Eagles fly on as reinforcements from the north or south edge (the Good player picks which). A Great Eagle that has carried a load off the table, or been slain, comes back as the Good side's next Move phase ends, the same way.",
      },
      {
        name: "Thorin's Wrath",
        text: "When Thorin moves he must charge an enemy if he can, Azog if he can reach him; if he can't charge anyone, he must move as close to Azog as he can. (The game moves him as the Good side's move begins.) Until he is wounded, Thorin is Fearless.",
      },
      {
        name: 'Bilbo',
        text: "As any Fight phase begins, the Good player may put Bilbo in base contact with an enemy fighting Thorin. Once he comes on, the Eagles must carry him off too; if he never does, he is rescued along with the Dwarves.",
      },
      {
        name: 'Fly',
        text: "The Eagles fly: they pass over models and terrain and ignore control zones on the way, and only where they land matters. They can't land on another model, in a wood, on a tree or a building, and landing in an enemy's control zone means charging it. An Eagle may walk 4\" instead (into the woods, if it likes), and can't fly again until it has left them.",
      },
    ],
    cast: eaglesCast(),
  },
  {
    id: 'escape-from-goblin-town',
    name: 'Escape from Goblin-town',
    from: 'The Hobbit: An Unexpected Journey',
    saga: 'hobbit',
    blurb: "Gandalf's light breaks over the Goblin King's court, and the Company snatches up its weapons and runs for it along the rickety walkways, with every Goblin in the mountain on their heels and a bottomless drop on every side.",
    board: { w: 48, h: 48, mat: 'stone' },
    terrain: goblinTerrain(),
    sides: {
      good: { name: "Thorin's Company", cast: 'Thorin Oakenshield with Orcrist and the Oakenshield; Kíli, Fíli, Balin, Dwalin, Bifur, Bofur, Bombur, Ori, Nori, Dori, Óin and Glóin; Gandalf the Grey, who arrives later' },
      evil: { name: 'Goblin-town', cast: 'The Goblin King; Grinnah, Goblin Jailer; 30 Goblin Warriors' },
    },
    layout: "A 4' by 4' cavern in Goblin-town: ramshackle plank walkways and platforms over bottomless chasms, with the Goblin King's throne on the great platform in the middle under a crag, the pile of the Dwarves' weapons in front of it, and walkways running out to every table edge.",
    setupOrder: ['good', 'evil'],
    deployment: 'The Good player sets up the Dwarves wholly within 3" of the middle of the table (Gandalf comes later). The Evil player then sets up the Goblin King touching his throne, and the rest of the Goblins anywhere at least 3" from every Dwarf. Before the battle starts the Evil player nominates the table edge the Good side must escape from.',
    objectives: 'The game lasts 10 turns. The Good side wins if nine or more of its models escape off the nominated edge; if eight do, it is a draw; fewer than eight, and the Evil side wins.',
    rules: [
      {
        name: 'Take Up Arms',
        text: "The Dwarves start the game Unarmed (-1 to their Duel rolls and To Wound rolls). A Dwarf that moves into base contact with the Weapon Pile at any point in its move takes back the weapons on its profile. (Dwalin and Nori, Weapon Masters, are never Unarmed.)",
      },
      {
        name: 'A Wizard is Never Late',
        text: "As the Good side's second Move phase ends, roll a D6: on a 1-3 the Evil player places Gandalf, on a 4-6 the Good player does. He goes on a walkway, touching any table edge.",
      },
      {
        name: 'Kill Them All!',
        text: 'As each Evil Move phase ends, the Evil player rolls a D6 and may bring back up to that many slain Goblin Warriors. They move onto the table as reinforcements from a table edge of the Evil player\'s choice, along a walkway that reaches it.',
      },
      {
        name: 'Bottomless Pits',
        text: 'A model pushed off a platform or rocky outcrop, or that fails a leap from one platform to another, with nothing to land on, falls into the chasm and is removed as a casualty. Nobody can walk off into the chasm on purpose; a gap no wider than twice a model\'s height can be leapt.',
      },
      {
        name: 'I Know That Sword!',
        text: 'In the first turn the Goblin King may not move or declare Heroic Actions.',
      },
    ],
    cast: goblinCast(),
  },
  {
    id: 'ambush-at-night',
    name: 'Ambush at Night',
    from: 'The Two Towers',
    saga: 'lotr',
    blurb: "Night on the eaves of Fangorn: Éomer's riders fall on the Uruk-hai camp, while Merry and Pippin, bound by the fire, wriggle for the trees.",
    board: { w: 48, h: 48, mat: 'plains' },
    terrain: ambushTerrain(),
    sides: {
      good: { name: 'The Riders of Éomer', cast: 'Éomer on Firefoot, a Captain of Rohan and 12 Riders of Rohan, with Merry and Pippin tied up in the camp' },
      evil: { name: 'The Uruk-hai camp', cast: 'Uglúk, Grishnákh, Snaga, an Uruk-hai Scout Captain, 12 Uruk-hai Scouts and 12 Isengard Orc Warriors' },
    },
    layout:
      "A 4' by 4' stretch of grassland by Fangorn: the forest's edge lines the north of the table, with clumps of trees in front of it. The camp's fire burns in the middle, and patches of long grass and a few boulders lie about the rest.",
    setupOrder: ['evil', 'good'],
    deployment:
      'Merry and Pippin lie as close to the middle of the table as they can, just south of the fire. Grishnákh is 3" from them towards the south edge, and the rest of the Evil side stand wholly within 6" of the middle. Then Éomer and half the Riders set up wholly within 6" of the west edge, and the Captain of Rohan with the other half wholly within 6" of the east edge.',
    objectives:
      "The battle goes on until the end of a turn in which one side is down to a quarter of its models and both Hobbits are off the table. The Good side wins if the Evil side is the one down to a quarter, the Evil side if the Good side is, and both at once is a draw. If Merry or Pippin is slain, the Good side can do no better than a draw.",
    rules: [
      { name: 'Surprise Attack', text: 'The Evil side may not move in the first turn.' },
      {
        name: 'Merry and Pippin',
        text: "The Hobbits start Prone and bound. While bound they move only by crawling (1\") and may not charge. Nobody may charge them but Grishnákh. They have no control zone, ignore their foes' control zones and may move through enemy models, though not stop on one; their foes may move through them in the same way. They may leave the table by any edge.",
      },
      {
        name: '"Their bonds were cut"',
        text: 'Each time the Good side finishes its move, each bound Hobbit rolls a D6: on a 6 he cuts his bonds and stands up free. Touching the other Hobbit, already free, he adds 1 to the roll.',
      },
      {
        name: 'Grishnákh',
        text: 'Wounded, Grishnákh moves like the bound Hobbits, but crawls 3" and has no bonds to cut. Only he may charge the Hobbits, and he charges nobody else. He and a Hobbit fight each other as normal, though both lie Prone. He has 1 Attack and only 1 Might, 1 Will and 1 Fate.',
      },
    ],
    cast: ambushCast(),
  },
  {
    id: 'balins-tomb',
    name: "Balin's Tomb",
    from: 'The Fellowship of the Ring',
    saga: 'lotr',
    blurb: 'The Chamber of Mazarbul: drums in the deep, Goblins pouring in through every door, trapdoor and well, and a Cave Troll on its way. The Fellowship must hold out.',
    board: { w: 24, h: 24, mat: 'stone' },
    terrain: balinTerrain(),
    sides: {
      good: { name: 'The Fellowship', cast: 'Frodo, Sam, Merry, Pippin, Gandalf, Aragorn, Legolas, Gimli and Boromir' },
      evil: { name: 'The Goblins of Moria', cast: '2 Moria Goblin Captains, 24 Moria Goblin Warriors and a Cave Troll' },
    },
    layout:
      "A 2' by 2' chamber: Balin's tomb stands in the middle and the well 6\" in from the middle of the north edge. A ledge 3\" wide and 1\" high runs right round the walls, broken only by the passage down to the doorway in the middle of the south edge. Four pillars stand on each side of the floor, and there is a trapdoor on the ledge in the middle of the west and east edges.",
    setupOrder: ['good', 'evil'],
    deployment:
      'The Fellowship sets up wholly within 6" of the middle of the table. Then the Goblins set up wholly within 6" of the doorway, none of them within 1" of the Fellowship. The Cave Troll is kept off the table.',
    objectives:
      'The battle lasts 10 turns. The Fellowship wins if Frodo and at least four others are still alive at the end. The Goblins win as soon as five of the Fellowship are slain, or the moment Frodo is.',
    rules: [
      {
        name: 'The Goblin Tide',
        text: 'A Goblin Warrior that is slain is kept aside. Each time the Goblins finish their move, every one kept aside comes back: one up through each trapdoor no member of the Fellowship stands on, two out of the well, and the rest in at the doorway. Those that can\'t get in try again next turn. They then make their move, and may charge.',
      },
      {
        name: '"They have a Cave Troll!"',
        text: 'As the Goblins start their move in turn 4, the Cave Troll bursts in at the doorway, and moves and charges as normal. That turn it may move through its own side: each Goblin it moves through takes a Strength 3 hit, and any it ends its move on is slain.',
      },
      { name: 'Troll Rampage', text: 'The Cave Troll has +1 Fight in a turn in which it charged.' },
    ],
    cast: balinCast(),
  },
  {
    id: 'amon-hen',
    name: 'Amon Hen',
    from: 'The Fellowship of the Ring',
    saga: 'lotr',
    blurb: 'The woods below the Seeing Seat: the Fellowship is scattered, Lurtz and his Uruk-hai are hunting the Halflings, and Frodo must reach the boats on the Anduin.',
    board: { w: 48, h: 48, mat: 'forest' },
    terrain: amonTerrain(),
    sides: {
      good: { name: 'The Fellowship', cast: 'Frodo, Sam, Merry, Pippin, Aragorn, Legolas, Gimli and Boromir, every one in an Elven cloak' },
      evil: { name: 'The Uruk-hai', cast: 'Lurtz, an Uruk-hai Scout Captain and 24 Uruk-hai Scouts' },
    },
    layout:
      "A 4' by 4' table thick with trees and undergrowth. The River Anduin runs down the west edge, with the boats drawn up on its bank, and the Seeing Seat stands in the eastern half: a paved platform with steps up to the dais and the seat on it.",
    setupOrder: ['good', 'evil'],
    deployment:
      'Aragorn and Frodo set up touching the Seeing Seat, Legolas and Gimli wholly within 6" of the north-east corner, and Merry, Pippin and Boromir wholly between 6" and 12" of the middle of the west edge, within 1" of each other. Then the Scout Captain and 12 Scouts set up wholly within 6" of the Seeing Seat and Lurtz and 12 more wholly within 12" of Boromir but no closer than 6", none of them within 1" of the Fellowship. Sam sets up last, at least 12" from the rest of the Fellowship (here he is placed with them).',
    objectives:
      'The battle goes on until Frodo leaves the table. The Fellowship wins if he gets away by reaching the boats; the Uruk-hai win if they carry him off. If Frodo gets away but the Uruk-hai have carried off two of the other Hobbits, it is a draw.',
    rules: [
      {
        name: '"Find the Halflings!"',
        text: 'A Hobbit who suffers his last Wound is not slain: he keeps 1 Wound and is knocked out, as if Paralysed. The Uruk-hai can carry him as a Heavy Object (halving their Move), and capture him by carrying him off the north, south or east edge (never into the river). A Good model that ends the Fellowship\'s move touching him brings him round, and he starts his next move Prone; otherwise he comes round on a 6 in the End phase.',
      },
      {
        name: 'The Legions of Isengard',
        text: 'Each time the Uruk-hai finish their move, roll a D6 for each Scout slain: on a 4+ it comes back on as a reinforcement from the north, south or east edge, at the point nearest Frodo. It may not charge as it comes on.',
      },
    ],
    cast: amonCast(),
  },
  {
    id: 'last-march-of-the-ents',
    name: 'Last March of the Ents',
    from: 'The Two Towers',
    saga: 'lotr',
    blurb: "The Ents come down on Isengard: Treebeard and his kin must break Saruman's dam and loose the River Isen, through the Orcs swarming over the scaffolds round Orthanc.",
    board: { w: 48, h: 48, mat: 'dirt' },
    terrain: entsTerrain(),
    sides: {
      good: { name: 'The Ents', cast: 'Treebeard with Merry and Pippin, Birchseed, Beechbone and three Ents' },
      evil: { name: 'The Orcs of Isengard', cast: '4 Isengard Orc Captains and 48 Isengard Orc Warriors' },
    },
    layout:
      "A 4' by 4' table round the tower of Orthanc, which stands sheer in the middle. Timber scaffolds stand about it, two of them built two decks high, with ladders up; pits and rubble scar the ground, and the dam holding back the River Isen fills the middle of the west edge.",
    setupOrder: ['good', 'evil'],
    deployment: 'The Ents set up wholly within 6" of the east edge. Then the Orcs set up wholly within the western half of the table, or on top of any of the scaffolds.',
    objectives: 'The battle goes on until one side has done what it came to do. The Ents win if the dam is destroyed (or if every Orc is slain, with nobody left to stop them); the Orcs win if every Ent is slain.',
    rules: [
      {
        name: 'Flaming Arrows',
        text: 'An Orc shooting an Ent whose roll To Hit is a natural 6, and who then wounds it, does 2 Wounds rather than 1, and Sets the Ent Ablaze.',
      },
      {
        name: '"Bring them down!"',
        text: 'When an Ent loses a fight against three or more Orcs, the Orcs may try to pull it down instead of striking: no strikes are made, and the Evil player rolls a D6 for each Orc in base contact with the Ent. Any natural 6 knocks the Ent Prone.',
      },
      {
        name: '"Release the River!"',
        text: 'The dam has Defence 10 and 5 Wounds. It can only be harmed in combat: an Ent touching it in the Fight phase, and not in a fight, can strike at it.',
      },
    ],
    cast: entsCast(),
  },
  {
    id: 'helms-deep',
    name: "Helm's Deep",
    from: 'The Two Towers',
    saga: 'lotr',
    blurb: "Night and rain over the Hornburg: Saruman's ten thousand storm the Deeping Wall and the great gate, and the defenders hold on for the dawn and Éomer's riders.",
    board: { w: 48, h: 48, mat: 'dirt' },
    terrain: helmsTerrain(),
    sides: {
      good: { name: "The Defenders of Helm's Deep", cast: 'Théoden, Aragorn, Legolas, Gimli and Haldir with the Rohirrim and the Galadhrim, and Éomer and Gandalf riding to the rescue' },
      evil: { name: 'The Host of Isengard', cast: 'Uruk-hai Captains, warriors, Berserkers, Demolition Teams, an Assault Ballista and ten Siege Ladders' },
    },
    layout:
      'A 4\' by 4\' table. The Hornburg fills the north-west corner, behind its curved outer wall with the great gate in it and the causeway leading up to it; an inner wall and the keep stand further in. The Deeping Wall runs from the Hornburg to the middle of the south edge, the Deeping Stream passing under it through the culvert halfway along. Everything east of the Deeping Wall is open ground.',
    setupOrder: ['good', 'evil'],
    deployment:
      "The Defenders of the Hornburg (Théoden, Gamling and 25 Warriors of Rohan) start inside the Hornburg. The Defenders of the Deeping Wall (Aragorn, Legolas, Gimli, Haldir, Haleth, Aldor, 25 Warriors of Rohan and 25 Galadhrim) start on the Deeping Wall. The Relief Force (Éomer, Gandalf the White, a Captain of Rohan and 24 Riders of Rohan) is kept off the table. The Host of Isengard starts wholly within 12\" of the east edge, with its ladders and Demolition Charges.",
    objectives:
      "The battle lasts the number of turns chosen before it starts. Then seven objectives are scored, and whoever holds more of them wins (the same number is a draw): Théoden alive or slain; the Deeping Wall standing or breached; more models wholly inside the Hornburg; more models wholly on the causeway; more of the heroes of Helm's Deep (Aragorn, Legolas, Gimli, Théoden, Gamling, Haldir, Haleth and Aldor) alive than slain, or the other way round; Éomer alive or slain; and at least three of the five Uruk-hai Captains slain (Good) or alive (Evil). If one side is wiped out, the other wins at once.",
    rules: [
      {
        name: 'Ride Out',
        text: 'From the start of turn 8, a Good hero within 6" of the Hornburg\'s gate who could ride a horse may mount one there and then: Théoden on Snowmane, Aragorn on Brego, and Gamling and Legolas on horses.',
      },
      {
        name: 'The Deeping Wall',
        text: 'The stretch of the Deeping Wall within 6" of the culvert can be blown apart: a Demolition Charge that goes off within 3" of the culvert brings it down. Every model on it takes a Strength 9 hit and then falls from it. Once it is down, the Deeping Wall counts as destroyed.',
      },
      {
        name: '"Look to my coming"',
        text: 'At the end of the Good side\'s 10th Move phase the Relief Force arrives from the eastern half of the south edge, as reinforcements, except that they may charge as they come on.',
      },
      {
        name: 'A Great Siege',
        text: 'All the siege rules are in play: the gates and doors keep the Evil side out until they are broken down, the walls are too sheer to climb without a Siege Ladder, and the defenders can push ladders down.',
      },
    ],
    cast: helmsCast(),
    turns: { choices: [10, 12, 15, 20], default: 15 },
  },
  {
    id: 'escape-from-osgiliath',
    name: 'Escape from Osgiliath',
    from: 'The Return of the King',
    saga: 'lotr',
    blurb: "Gothmog's Orcs pour across the Anduin into the ruined city, and Faramir's garrison, caught in the middle, must fight its way out to the west before it is cut down.",
    board: { w: 48, h: 48, mat: 'ruin' },
    terrain: osgiliathTerrain(),
    sides: {
      good: { name: 'The Garrison of Osgiliath', cast: 'Faramir, Captain of Gondor; Madril, Captain of Ithilien; Damrod, Ranger of Ithilien; 12 Warriors of Minas Tirith (4 with shields, 4 with shields and spears, 4 with bows); 12 Rangers of Gondor (4 with spears)' },
      evil: { name: 'The Army of Gothmog', cast: "Gothmog, Lieutenant of Sauron; Gothmog's Enforcer; Guritz, Master of Reserves; 24 Morannon Orc Warriors (6 with shields, 6 with spears, 6 with shields and spears, 6 with neither); a Mordor Troll" },
    },
    layout:
      "A 4' by 4' corner of the ruined city: broken walls run every which way between the streets, some wide enough for a whole warband, others narrow alleys. Three great ruined buildings with stepped roofs stand to the north, south-west and south-east, two stretches of wall still stand to full height, and the stumps of round towers, fallen masonry and rubble lie everywhere.",
    setupOrder: ['good', 'evil'],
    deployment:
      "The Good side sets up wholly within 6\" of the middle of the table. Then the Evil side sets up Gothmog, his Enforcer and half the Orcs wholly within 12\" of the east edge, and the rest (Guritz, the other Orcs and the Troll) wholly within 12\" of the west edge.",
    objectives:
      'The battle goes on until the end of a turn with no Good model left on the table. The Good side wins if 9 or more of its models (a third of them) escape off the west edge; otherwise the Evil side wins. If Faramir escapes off the west edge, the Evil side can do no better than a draw; if he is slain, the Good side can do no better than a draw.',
    rules: [
      {
        name: 'Faramir',
        text: 'Faramir matters to Gondor far beyond this fight. If he escapes off the west edge, the best the Evil side can get is a draw. If he is slain, the best the Good side can get is a draw.',
      },
      {
        name: 'Hordes Without End',
        text: "As the Evil side starts its move each turn, it rolls a D6 for every Morannon Orc slain so far (never the Troll): each 4+ comes back, moving on as reinforcements from one of the two Reinforcement Points, in the middle of the north and south edges. (The Evil player picks which; the game rolls as the Evil side's move ends, when reinforcements come on.)",
      },
      {
        name: '"Nazgûl!"',
        text: "As each Move phase begins, the Evil player may pick one Good Warrior and roll a D6. On a 3+ it is frozen with fear: it can't move, shoot or act this turn, and if it ends up in a fight it fights with a Fight value of 1.",
      },
    ],
    cast: osgiliathCast(),
  },
];

/** Helm's Deep: the book's cast for both sides, set out where the scenario starts them. */
function helmsCast(): CastMember[] {
  const out: CastMember[] = [];
  const H = "[defenders-of-helm's-deep]";
  const E = '[riders-of-eomer]';
  const U = "[assault-upon-helm's-deep]";
  type Member = Omit<CastMember, 'place'>;
  const times = (n: number, f: (i: number) => Member): Member[] => Array.from({ length: n }, (_, i) => f(i));
  // The defenders of the Deeping Wall, front rank first: fighters on the wall, spears and bows behind them.
  const wall: Member[] = [
    { key: 'aragorn', side: 'good', unit: `${H} aragorn-strider` },
    { key: 'gimli', side: 'good', unit: `${H} gimli` },
    { key: 'haleth', side: 'good', unit: `${H} haleth-son-of-hama` },
    ...times(8, () => ({ key: 'wall-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Shield'] })),
    ...times(8, () => ({ key: 'wall-galadhrim', side: 'good', unit: `${H} galadhrim-warrior`, options: ['Shield'] })),
    { key: 'wall-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Banner'] },
    { key: 'wall-galadhrim', side: 'good', unit: `${H} galadhrim-warrior`, options: ['Banner'] },
    ...times(8, () => ({ key: 'wall-galadhrim', side: 'good', unit: `${H} galadhrim-warrior`, options: ['Shield and Elven spear'] })),
    ...times(8, () => ({ key: 'wall-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Shield and throwing spears'] })),
    { key: 'legolas', side: 'good', unit: `${H} legolas`, options: ['Armour'] },
    { key: 'haldir', side: 'good', unit: `${H} haldir-galadhrim-captain` },
    { key: 'aldor', side: 'good', unit: `${H} aldor` },
    ...times(8, () => ({ key: 'wall-galadhrim', side: 'good', unit: `${H} galadhrim-warrior`, options: ['Elf bow'] })),
    ...times(8, () => ({ key: 'wall-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Bow'] })),
  ];
  const ws = deepingSlots();
  wall.forEach((c, i) => out.push({ ...c, facing: 90, place: { zone: 'deeping', at: [ws[i].x, ws[i].y] } }));
  // The defenders of the Hornburg along its outer wall, facing out, Théoden and Gamling behind the gate.
  const keep: Member[] = [
    ...times(8, () => ({ key: 'hornburg-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Shield'] })),
    ...times(8, () => ({ key: 'hornburg-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Shield and throwing spears'] })),
    { key: 'hornburg-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Banner'] },
    ...times(8, () => ({ key: 'hornburg-rohan', side: 'good', unit: `${H} warrior-of-rohan`, options: ['Bow'] })),
  ];
  const hs = hornburgSlots();
  keep.forEach((c, i) => out.push({ ...c, facing: Math.round(GATE_ANGLE + 90), place: { zone: 'hornburg', at: [hs[i].x, hs[i].y] } }));
  const behind = (k: number) => onArc(OUTER.r - 5.5, GATE_ANGLE + k);
  out.push(
    { key: 'theoden', side: 'good', unit: `${H} theoden`, options: ['Shield'], facing: GATE_ANGLE + 90, place: { zone: 'hornburg', at: [behind(-2.6).x, behind(-2.6).y] } },
    { key: 'gamling', side: 'good', unit: `${H} gamling`, options: ['Royal Standard of Rohan'], facing: GATE_ANGLE + 90, place: { zone: 'hornburg', at: [behind(2.6).x, behind(2.6).y] } },
  );
  // The Relief Force, kept off the table until the end of the Good side's 10th move.
  out.push(
    { key: 'eomer', side: 'good', unit: '[kingdom-of-rohan] eomer', options: ['Firefoot with armour'], place: { aside: true } },
    { key: 'gandalf', side: 'good', unit: `${E} gandalf-the-white`, place: { aside: true } },
    { key: 'captain-rohan', side: 'good', unit: `${E} captain-of-rohan`, options: ['Shield'], place: { aside: true } },
    ...times(8, () => ({ key: 'rider', side: 'good', unit: `${E} rider-of-rohan`, options: ['Throwing spears'] })).map((c): CastMember => ({ ...c, place: { aside: true } })),
    ...times(16, () => ({ key: 'rider', side: 'good', unit: `${E} rider-of-rohan` })).map((c): CastMember => ({ ...c, place: { aside: true } })),
  );
  // The Host of Isengard: the ballista (with its crew of three) at the back, the Demolition Teams with their torches
  // beside their charges, and the rest in ranks along the front of the zone.
  const ballista = { x: 45.2, y: 24 };
  out.push({ key: 'ballista', side: 'evil', unit: `${U} isengard-assault-ballista`, base: BALLISTA_BASE, facing: 270, place: { zone: 'evil', at: [ballista.x, ballista.y] } });
  const teams = HELMS_TEAMS.map(y => ({ x: 41.6, y }));
  const nearTeam = (p: Point) => teams.some(t => Math.abs(p.x - t.x) < 1.9 && Math.abs(p.y - t.y) < 1.6);
  const nearBallista = (p: Point) => Math.abs(p.x - ballista.x) < 3.6 && Math.abs(p.y - ballista.y) < 3.6;
  for (const t of teams)
    out.push(
      { key: 'engineer', side: 'evil', unit: `${U} uruk-hai-warrior`, name: 'Uruk-hai Engineer', stats: { C: 6 }, facing: 270, place: { zone: 'evil', at: [t.x - 1.05, t.y - 0.52] } },
      { key: 'engineer', side: 'evil', unit: `${U} uruk-hai-warrior`, name: 'Uruk-hai Engineer', stats: { C: 6 }, facing: 270, place: { zone: 'evil', at: [t.x - 1.05, t.y + 0.52] } },
      { key: 'torch', side: 'evil', unit: `${U} uruk-hai-berserker`, torch: true, facing: 270, place: { zone: 'evil', at: [t.x + 1.05, t.y] } },
    );
  // Each group spread evenly through the ranks (crossbows at the back), so every stretch of the line has its share.
  const groups: Member[][] = [
    times(35, () => ({ key: 'uruk', side: 'evil', unit: `${U} uruk-hai-warrior`, options: ['Shield'] })),
    times(35, () => ({ key: 'uruk', side: 'evil', unit: `${U} uruk-hai-warrior`, options: ['Pike'] })),
    times(16, () => ({ key: 'berserker', side: 'evil', unit: `${U} uruk-hai-berserker` })),
    times(5, () => ({ key: 'uruk-captain', side: 'evil', unit: `${U} uruk-hai-captain` })),
    times(3, () => ({ key: 'uruk', side: 'evil', unit: `${U} uruk-hai-warrior`, options: ['Banner'] })),
  ];
  const line = groups.flatMap(g => g.map((c, i) => ({ c, k: (i + 0.5) / g.length }))).sort((a, b) => a.k - b.k).map(x => x.c);
  line.push(...times(12, () => ({ key: 'uruk', side: 'evil', unit: `${U} uruk-hai-warrior`, options: ['Crossbow'] })));
  const es = evilSlots(p => nearTeam(p) || nearBallista(p));
  line.forEach((c, i) => out.push({ ...c, facing: 270, place: { zone: 'evil', at: [es[i].x, es[i].y] } }));
  return out;
}

/**
 * Ambush at Night: the book's map, measured off it at 1" to the grid. The eaves of Fangorn run along the north edge, a
 * band of trees with a ragged southern edge; two clumps of trees stand out in front of them and a third in the north-east
 * corner. Two patches of long grass, a few boulders, and the camp's fire in the middle. (Heights and where they come
 * from are in plans/ambush-at-night-audit.md.)
 */
function ambushTerrain(): NarrativeTerrain[] {
  const tree = (id: string, x: number, y: number, w: number, h = w) => piece({ id, kind: 'wood', shape: 'circle', x, y, w, h, height: 5 });
  return [
    piece({ id: 'campfire', kind: 'objective', object: 'campfire', shape: 'circle', x: 24, y: 24, w: 1.6, h: 1.6 }),
    // Fangorn's eaves: a solid band of trees along the edge, bulging further out in places.
    piece({ id: 'fangorn', kind: 'wood', x: 24, y: 1.75, w: 48, h: 3.5, height: 6 }),
    tree('eaves-1', 3.5, 3.6, 4.4, 2.6),
    tree('eaves-2', 9.5, 3.8, 4.6, 2.8),
    tree('eaves-3', 15, 4.4, 4.6, 3.2),
    tree('eaves-4', 20.5, 5, 3.6),
    tree('eaves-5', 27.3, 5.6, 4.4, 3.6),
    tree('eaves-6', 33, 4.6, 3.8, 2.8),
    tree('eaves-7', 38.6, 5.4, 4.2, 3.4),
    tree('eaves-8', 44.5, 3.4, 4.4, 2.4),
    // The clumps in front: west of the middle, north of the middle, and in the north-east corner.
    tree('clump-w', 11.6, 9.4, 7, 5.6),
    tree('clump-w2', 16.6, 11, 2.6),
    tree('clump-n', 29.8, 10.3, 5, 4.6),
    tree('clump-n2', 33.8, 7.9, 2.2),
    tree('clump-ne', 46.4, 9.4, 3.6, 5),
    // Long grass: tall enough to get in the way of a shot, not enough to slow anyone down.
    piece({ id: 'grass-e', kind: 'field', look: 'grass', shape: 'circle', x: 40.2, y: 22.9, w: 10.6, h: 8.6, rot: -8, height: 0.5, difficult: false }),
    piece({ id: 'grass-sw', kind: 'field', look: 'grass', shape: 'circle', x: 14.8, y: 37.1, w: 11, h: 8.8, rot: -12, height: 0.5, difficult: false }),
    // Boulders, knee to waist high to a man.
    piece({ id: 'boulder-w', kind: 'rock', shape: 'circle', x: 8.4, y: 23.6, w: 1.6, h: 1.1, rot: 15, height: 1 }),
    piece({ id: 'boulder-ne', kind: 'rock', shape: 'circle', x: 40, y: 13.8, w: 2.2, h: 1.2, rot: 20, height: 1 }),
    piece({ id: 'boulder-se', kind: 'rock', shape: 'circle', x: 36.3, y: 35.7, w: 2, h: 1.3, rot: -10, height: 1 }),
    piece({ id: 'boulder-se2', kind: 'rock', shape: 'circle', x: 40.1, y: 35.1, w: 1.3, h: 1.4, rot: 10, height: 1 }),
    piece({ id: 'boulder-s', kind: 'rock', shape: 'circle', x: 20.9, y: 40.1, w: 1.1, h: 1.4, rot: -5, height: 1 }),
  ];
}

/** Ambush at Night: the book's cast, set out where the scenario starts them. */
function ambushCast(): CastMember[] {
  const R = '[kingdom-of-rohan]';
  const U = "[ugluk's-scouts]";
  const C = 24;
  const out: CastMember[] = [
    // Merry and Pippin, side by side just south of the fire, and Grishnákh 3" south of them.
    { key: 'merry', side: 'good', unit: '[the-fellowship] meriadoc-brandybuck', prone: true, bound: true, crawls: 1, slips: true, facing: 180, place: { at: [C - 0.52, C + 1.36] } },
    { key: 'pippin', side: 'good', unit: '[the-fellowship] peregrin-took', prone: true, bound: true, crawls: 1, slips: true, facing: 180, place: { at: [C + 0.52, C + 1.36] } },
    { key: 'grishnakh', side: 'evil', unit: `${U} grishnakh`, stats: { A: 1 }, might: 1, will: 1, fate: 1, prone: true, crawls: 3, slips: true, facing: 0, place: { at: [C, C + 1.36 + 0.49 + 3 + 0.49] } },
  ];
  // The rest of the camp, in rings round the fire: the Uruk-hai heroes and Scouts nearest, the Orcs further out.
  const camp: Omit<CastMember, 'place'>[] = [
    { key: 'ugluk', side: 'evil', unit: `${U} ugluk` },
    { key: 'snaga', side: 'evil', unit: `${U} snaga` },
    { key: 'scout-captain', side: 'evil', unit: `${U} uruk-hai-scout-captain` },
    ...[...Array(4).fill(['Shield']), ...Array(4).fill(['Uruk-hai bow']), ...Array(4).fill([])].map((options: string[]) => ({ key: 'scout', side: 'evil' as const, unit: `${U} uruk-hai-scout`, ...(options.length ? { options } : {}) })),
    ...[...Array(4).fill(['Shield']), ...Array(4).fill(['Spear']), ...Array(2).fill(['Two-handed weapon']), ...Array(2).fill(['Orc bow'])].map(options => ({ key: 'orc', side: 'evil' as const, unit: `${U} isengard-orc-warrior`, options })),
  ];
  const slots = campSlots(C, C, out.map(c => ('at' in c.place ? { x: c.place.at[0], y: c.place.at[1] } : { x: C, y: C })));
  camp.forEach((c, i) => {
    const p = slots[i];
    // Facing whichever flank is nearer, where the riders are coming from.
    out.push({ ...c, facing: p.x < C ? 270 : 90, place: { area: { circle: [C, C, 6] }, at: [p.x, p.y] } });
  });
  // The riders: Éomer and half of them by the west edge, the Captain and the other half by the east, in a line facing in.
  const riders = (n: number, spears: number): Omit<CastMember, 'place'>[] =>
    Array.from({ length: n }, (_, i) => ({ key: 'rider', side: 'good' as const, unit: `${R} rider-of-rohan`, ...(i < spears ? { options: ['Throwing spears'] } : {}) }));
  const line = (leader: Omit<CastMember, 'place'>, rest: Omit<CastMember, 'place'>[], x: number, box: Area, facing: number) =>
    [leader, ...rest].forEach((c, i) => {
      const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      out.push({ ...c, facing, place: { area: box, at: [x, C + k * 1.5] } });
    });
  line({ key: 'eomer', side: 'good', unit: `${R} eomer`, options: ['Firefoot'] }, riders(6, 2), 3, { box: [0, 0, 6, 48] }, 90);
  line({ key: 'captain-rohan', side: 'good', unit: `${R} captain-of-rohan`, options: ['Horse', 'Shield'] }, riders(6, 2), 45, { box: [42, 0, 48, 48] }, 270);
  return out;
}

/** Spots for 25mm bases round the fire, wholly within 6" of the middle and clear of the fire, the Hobbits and Grishnákh. */
function campSlots(cx: number, cy: number, taken: Point[]): Point[] {
  const r = 25 / 25.4 / 2;
  const out: Point[] = [];
  for (const ring of [2.2, 3.4, 4.6]) {
    const n = Math.floor((2 * Math.PI * ring) / 1.08);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI + ring;
      const p = { x: cx + Math.sin(a) * ring, y: cy - Math.cos(a) * ring };
      // (Not touching Merry or Pippin, whom nobody but Grishnákh may come at.)
      if (taken.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 2 * r + 0.6)) continue;
      if (out.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 2 * r + 0.06)) continue;
      out.push(p);
    }
  }
  return out;
}

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
  const terrain = narrativeTerrain(n, good);
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
  const mid = { x: n.board.w / 2, y: n.board.h / 2 };
  const facing = (c: CastMember, p: Point, owner: Seat) => c.facing ?? (Math.hypot(p.x - mid.x, p.y - mid.y) < 0.5 ? (owner === 'p1' ? 0 : 180) : Math.round(angleOf(p, mid)));
  for (const c of n.cast) {
    const unit = catalog.units[c.unit];
    if (!unit) continue;
    const ids = unit.options.filter(o => c.options?.includes(o.name)).map(o => o.id);
    const [e, ...crew] = entriesFor(c.unit, unit, ids, 1);
    if (!e) continue;
    const owner = c.side === 'good' ? good : other(good);
    const base = c.base ?? e.base ?? guessBase(e.name);
    const wounds = Math.max(1, e.wounds ?? 1);
    const m: Model = {
      id: newId('m'),
      owner,
      name: c.name ?? e.name,
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
      ...(e.options?.length || c.gear?.length ? { options: [...(e.options ?? []), ...(c.gear ?? [])] } : {}),
      ...(e.siege ? { siege: e.siege } : {}),
      cast: c.key,
      ...(c.stats ? { stats: c.stats } : {}),
      ...(c.brand ? { brand: true } : {}),
      ...(c.torch ? { torch: true } : {}),
      ...(c.ring ? { ringOn: true } : {}),
      ...('aside' in c.place ? { waiting: true } : {}),
      ...(c.prone ? { prone: true } : {}),
      ...(c.bound ? { bound: true } : {}),
      ...(c.crawls ? { crawls: c.crawls } : {}),
      ...(c.slips ? { slips: true } : {}),
    };
    const p = at(c, m);
    const lost = c.unarmed ? gearOf(catalog, m).filter(isWeaponItem) : [];
    models.push({ ...m, ...p, rot: facing(c, p, owner), ...(lost.length ? { lostGear: lost } : {}) });
    // A siege engine's crew stand in base contact with it, behind or beside it, as close to the back as there is room.
    const hands = e.siege ? crew.flatMap(x => Array.from({ length: x.count }, () => x)) : [];
    const engine = models[models.length - 1];
    for (const x of hands) {
      const base: Base = x.base ?? { shape: 'round', w: 25, h: 25 };
      const r = Math.max(base.w, base.h) / 50.8;
      const hand: Model = { id: newId('m'), owner, name: x.name, x: 0, y: 0, rot: engine.rot, base, move: x.move ?? 6, wounds: x.wounds ?? 1, maxWounds: x.wounds ?? 1, might: x.might ?? 0, will: x.will ?? 0, fate: x.fate ?? 0, hero: x.hero, dead: false, profileId: c.unit, crewOf: m.id, cast: `${c.key}-crew` };
      let spot: Point | undefined;
      for (const turn of [180, 150, 210, 120, 240, 90, 270, 60, 300]) {
        // Out from the engine's middle until the bases just touch.
        let d = 0;
        let p = along(engine, engine.rot + turn, d);
        while (distanceBetween({ ...hand, ...p }, engine) < 0.02 && d < 10) p = along(engine, engine.rot + turn, (d += 0.02));
        const inside = p.x >= r && p.y >= r && p.x <= n.board.w - r && p.y <= n.board.h - r && (!('zone' in c.place) || inHelmsZone(c.place.zone, p, r)) && (!('area' in c.place) || whollyInArea(c.place.area, p, r));
        if (inside && models.every(o => o.id === engine.id || Math.hypot(o.x - p.x, o.y - p.y) >= radius(o) + r)) {
          spot = p;
          break;
        }
      }
      if (spot) models.push({ ...hand, ...spot });
    }
  }
  return { terrain, models };
}

/** The scenario's table for this game: pieces held by a side go to whichever seat plays it. */
export function narrativeTerrain(n: Narrative, good: Seat): Terrain[] {
  return n.terrain.map(({ held, ...t }) => ({ ...t, id: `n-${t.id}`, ...(held ? { side: held === 'good' ? good : other(good) } : {}) }));
}

/**
 * Before the battle, the cast can only be moved where the scenario lets it stand: a model touching a friend goes
 * round that friend, one touching a piece of terrain goes round its edge, and the rest stay put.
 */
export function holdNarrative(state: GameState, mv: { id: string; x: number; y: number; rot?: number }): { id: string; x: number; y: number; rot?: number } {
  const out = holdCast(state, mv);
  // (Escape from Goblin-town: nobody sets up over the chasm.)
  const m = state.models[mv.id];
  if (m && state.narrative?.id === 'escape-from-goblin-town' && noFooting(state, out)) return { ...mv, x: m.x, y: m.y };
  return out;
}

function holdCast(state: GameState, mv: { id: string; x: number; y: number; rot?: number }): { id: string; x: number; y: number; rot?: number } {
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
  if ('zone' in p) {
    // Anywhere in its area: a model dragged out of it stays where it was.
    return inHelmsZone(p.zone, mv, radius(m)) ? mv : { ...mv, x: m.x, y: m.y };
  }
  const here = { ...m, ...mv };
  const onTable = Object.values(state.models).filter(o => o.id !== m.id && !o.dead && !o.waiting);
  if ('area' in p) {
    // The same for a deployment zone; and at Ambush at Night no foe may be set up touching Merry or Pippin.
    const onHobbit = n?.id === 'ambush-at-night' && Object.values(state.models).some(o => o.owner !== m.owner && isHobbit(o) && Math.hypot(o.x - mv.x, o.y - mv.y) < radius(o) + radius(m) + 0.25);
    // At Balin's Tomb and Amon Hen no Evil model may be set up within 1" of a Good one (in its control zone).
    const zoned = (n?.id === 'balins-tomb' || n?.id === 'amon-hen') && c.side === 'evil' && onTable.some(o => o.owner !== m.owner && distanceBetween(here, o) < 1);
    // Kept within so far of each of its group.
    const apart = p.close && onTable.some(o => o.cast && p.close!.keys.includes(o.cast) && distanceBetween(here, o) > p.close!.within + 0.01);
    return whollyInArea(p.area, mv, radius(m), state) && !onHobbit && !zoned && !apart ? mv : { ...mv, x: m.x, y: m.y };
  }
  if ('against' in p) {
    // Slid round the piece's edge, touching it, to the point nearest where it was dragged.
    const t = rimPiece(state, p.against);
    if (t) {
      const d = toPiece(t, mv) - radius(m);
      const r = radius(m) + 0.02;
      const x0 = t.x - t.w / 2 - r;
      const x1 = t.x + t.w / 2 + r;
      const y0 = t.y - t.h / 2 - r;
      const y1 = t.y + t.h / 2 + r;
      let x = Math.max(x0, Math.min(x1, mv.x));
      let y = Math.max(y0, Math.min(y1, mv.y));
      if (x > x0 && x < x1 && y > y0 && y < y1) {
        // (Dragged onto the piece: out to its nearest side.)
        const k = [x - x0, x1 - x, y - y0, y1 - y];
        const i = k.indexOf(Math.min(...k));
        if (i === 0) x = x0;
        else if (i === 1) x = x1;
        else if (i === 2) y = y0;
        else y = y1;
      }
      // (Already touching it, near enough, it stays where it was put.)
      const spot = d >= 0 && d <= 0.06 ? mv : { ...mv, x, y };
      ({ x, y } = spot);
      return onTable.some(o => Math.hypot(o.x - x, o.y - y) < radius(o) + radius(m) - 0.02) ? { ...mv, x: m.x, y: m.y } : spot;
    }
  }
  if ('anyEdge' in p) {
    // Touching the nearest edge, wherever along it.
    const r = radius(m);
    const { w, h } = state.board;
    const x = Math.max(r, Math.min(w - r, mv.x));
    const y = Math.max(r, Math.min(h - r, mv.y));
    const gaps = [x - r, w - r - x, y - r, h - r - y];
    const k = gaps.indexOf(Math.min(...gaps));
    const spot = { x: k === 0 ? r : k === 1 ? w - r : x, y: k === 2 ? r : k === 3 ? h - r : y };
    return onTable.some(o => Math.hypot(o.x - spot.x, o.y - spot.y) < radius(o) + r - 0.02) ? { ...mv, x: m.x, y: m.y } : { ...mv, ...spot };
  }
  if ('clear' in p) {
    // Anywhere at least so far from every enemy, and on no one else.
    const r = radius(m);
    const near = onTable.some(o => (o.owner !== m.owner ? distanceBetween(here, o) < p.clear - 0.01 : Math.hypot(o.x - mv.x, o.y - mv.y) < radius(o) + r - 0.02));
    const inside = mv.x >= r && mv.y >= r && mv.x <= state.board.w - r && mv.y <= state.board.h - r;
    return !near && inside ? mv : { ...mv, x: m.x, y: m.y };
  }
  if ('apart' in p) {
    // Anywhere at least so far from every friend.
    const near = onTable.some(o => o.owner === m.owner && distanceBetween(here, o) < p.apart - 0.01);
    const r = radius(m);
    const inside = mv.x >= r && mv.y >= r && mv.x <= state.board.w - r && mv.y <= state.board.h - r;
    return !near && inside ? mv : { ...mv, x: m.x, y: m.y };
  }
  return { ...mv, x: m.x, y: m.y };
}

/** The winner of a narrative scenario that has been decided, or null while it goes on. */
export function narrativeWinner(state: GameState): Seat | 'draw' | null {
  const n = narrativeOf(state);
  if (!n || !state.flow.started) return null;
  if (n.id === 'roast-mutton') return muttonWinner(state);
  if (n.id === 'helms-deep') return helmsWinner(state);
  if (n.id === 'ambush-at-night') return ambushWinner(state);
  if (n.id === 'balins-tomb') return balinWinner(state);
  if (n.id === 'amon-hen') return amonWinner(state);
  if (n.id === 'last-march-of-the-ents') return entsWinner(state);
  if (n.id === 'the-unseen-hero') return unseenWinner(state);
  if (n.id === 'the-elves-of-mirkwood') return elvesWinner(state);
  if (n.id === 'lake-town-escape') return lakeWinner(state);
  if (n.id === 'escape-from-goblin-town') return goblinWinner(state);
  if (n.id === 'and-into-the-fire') return fireWinner(state);
  if (n.id === 'escape-from-osgiliath') return osgiliathWinner(state);
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
