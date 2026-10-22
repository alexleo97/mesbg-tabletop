import { entriesFor, type Catalog, type StatName } from './catalog.ts';
import { arrivalDue, other } from './flow.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { guessBase } from './importList.ts';
import { offTable } from './maelstrom.ts';
import { muttonWinner } from './mutton.ts';
import { helmsWinner } from './helms.ts';
import { ambushWinner, isHobbit } from './ambush.ts';
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
  /** Starting at `at`, and kept wholly within an area of the table (a deployment zone). */
  | { area: Area; at: [number, number] };

/** A deployment zone: a circle round a point (x, y, radius), or a box (x0, y0, x1, y1). */
export type Area = { circle: [number, number, number] } | { box: [number, number, number, number] };

/** Whether a model this far across (from its middle) stands wholly within an area. */
export function whollyInArea(a: Area, p: Point, r: number): boolean {
  if ('circle' in a) return Math.hypot(p.x - a.circle[0], p.y - a.circle[1]) + r <= a.circle[2] + 0.01;
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
  /** Characteristics the scenario sets, in place of the profile's. */
  stats?: Partial<Record<StatName, number>>;
  might?: number;
  will?: number;
  fate?: number;
  /** A flaming brand (Weathertop). */
  brand?: boolean;
  /** A lit torch, to set off a Demolition Charge (Helm's Deep). */
  torch?: boolean;
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
      ...(e.options?.length ? { options: e.options } : {}),
      ...(e.siege ? { siege: e.siege } : {}),
      cast: c.key,
      ...(c.stats ? { stats: c.stats } : {}),
      ...(c.brand ? { brand: true } : {}),
      ...(c.torch ? { torch: true } : {}),
      ...('aside' in c.place ? { waiting: true } : {}),
      ...(c.prone ? { prone: true } : {}),
      ...(c.bound ? { bound: true } : {}),
      ...(c.crawls ? { crawls: c.crawls } : {}),
      ...(c.slips ? { slips: true } : {}),
    };
    const p = at(c, m);
    models.push({ ...m, ...p, rot: facing(c, p, owner) });
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
  if ('area' in p) {
    // The same for a deployment zone; and at Ambush at Night no foe may be set up touching Merry or Pippin.
    const onHobbit = n?.id === 'ambush-at-night' && Object.values(state.models).some(o => o.owner !== m.owner && isHobbit(o) && Math.hypot(o.x - mv.x, o.y - mv.y) < radius(o) + radius(m) + 0.25);
    return whollyInArea(p.area, mv, radius(m)) && !onHobbit ? mv : { ...mv, x: m.x, y: m.y };
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
