// Quick-reference data for the core rules. Numbers come from the published charts; the wording of
// the summaries is our own shorthand, so check the rulebook when a situation is unclear.

/** To Wound chart, rows are Strength 1-10 and columns Defence 1-10. "6/4" means a 6, then a 4+. */
const WOUND: string[][] = [
  ['4', '5', '5', '6', '6', '6/4', '6/5', '6/6', '-', '-'],
  ['4', '4', '5', '5', '6', '6', '6/4', '6/5', '6/6', '-'],
  ['3', '4', '4', '5', '5', '6', '6', '6/4', '6/5', '6/6'],
  ['3', '3', '4', '4', '5', '5', '6', '6', '6/4', '6/5'],
  ['3', '3', '3', '4', '4', '5', '5', '6', '6', '6/4'],
  ['3', '3', '3', '3', '4', '4', '5', '5', '6', '6'],
  ['3', '3', '3', '3', '3', '4', '4', '5', '5', '6'],
  ['3', '3', '3', '3', '3', '3', '4', '4', '5', '5'],
  ['3', '3', '3', '3', '3', '3', '3', '4', '4', '5'],
  ['3', '3', '3', '3', '3', '3', '3', '3', '4', '4'],
];

export interface WoundNeed {
  /** Score needed on the first die. */
  target: number;
  /** For results like 6+/4+: score needed on a second die for each first die that succeeded. */
  then?: number;
}

const clampStat = (n: number) => Math.max(1, Math.min(10, Math.round(n) || 1));

/** What a Strength `s` hit needs to wound Defence `d`, or null if it can't. */
export function woundNeed(s: number, d: number): WoundNeed | null {
  const cell = WOUND[clampStat(s) - 1][clampStat(d) - 1];
  if (cell === '-') return null;
  const [a, b] = cell.split('/').map(Number);
  return b ? { target: a, then: b } : { target: a };
}

export function formatNeed(n: WoundNeed | null) {
  return n ? `${n.target}+${n.then ? `/${n.then}+` : ''}` : 'Can’t wound';
}

export const MISSILE_WEAPONS: { name: string; range: number; s: number }[] = [
  { name: 'Blowpipe', range: 12, s: 2 },
  { name: 'Bow', range: 24, s: 2 },
  { name: 'Crossbow', range: 24, s: 4 },
  { name: 'Dwarf Bow', range: 18, s: 3 },
  { name: 'Dwarf Longbow', range: 24, s: 3 },
  { name: 'Elf Bow', range: 24, s: 3 },
  { name: 'Esgaroth Bow', range: 24, s: 3 },
  { name: 'Great Bow', range: 24, s: 4 },
  { name: 'Longbow', range: 24, s: 3 },
  { name: 'Orc Bow', range: 18, s: 2 },
  { name: 'Short Bow', range: 18, s: 2 },
  { name: 'Sling', range: 12, s: 1 },
  { name: 'Throwing Spear', range: 8, s: 3 },
  { name: 'Throwing Weapon', range: 6, s: 3 },
  { name: 'Uruk-hai Bow', range: 18, s: 3 },
];

/** D6 tables, each as [1, 2-5, 6] results. */
export const D6_TABLES: { name: string; when: string; results: [string, string, string] }[] = [
  {
    name: 'Jump',
    when: 'Crossing an obstacle taller than half the model’s height.',
    results: [
      'Stumbles: stays put and its activation ends.',
      'Over: place it in base contact on the far side. If that puts it in an enemy Control Zone it must charge the closest such enemy if it can reach; otherwise its move ends.',
      'Bounds across: place it on the far side and carry on moving.',
    ],
  },
  {
    name: 'Leap',
    when: 'Jumping across a gap.',
    results: [
      'Falls halfway between the edges, takes falling damage and is Prone. Activation ends.',
      'Across: place it at the far edge. Same charge-or-stop rule as a Jump.',
      'Bounds across: place it at the far edge and carry on moving.',
    ],
  },
  {
    name: 'Climb',
    when: 'Climbing an obstacle, up to its Move or the top.',
    results: [
      'Falls to the bottom and is Prone, with falling damage if it was above ground level. Activation ends.',
      'Climbs: up to its Move or the top. Same charge-or-stop rule as a Jump.',
      'Swift ascent: climbs and may carry on moving.',
    ],
  },
  {
    name: 'Swim',
    when: 'Moving through deep water.',
    results: ['Sinks and is removed as a casualty.', 'Swims up to half its remaining Move.', 'Swims its full remaining Move.'],
  },
  {
    name: 'Thrown Rider',
    when: 'A rider whose mount is killed or knocked down.',
    results: [
      'Knocked flying: takes a Strength 3 hit and, if alive, is Prone. Can’t act for the rest of the turn.',
      'Rises from the dust: on its feet, but can’t act for the rest of the turn.',
      'Leaps into action: on its feet and acts normally.',
    ],
  },
];

export const TURN_SUMMARY: { phase: string; points: string[] }[] = [
  {
    phase: 'Priority',
    points: [
      'Both roll a D6; the higher roller picks who has Priority (it can be the other player).',
      'Tie on turn 1: roll again. Tie later: the player who didn’t choose last turn chooses.',
    ],
  },
  {
    phase: 'Move',
    points: [
      'Heroic actions are declared first, then the Priority player moves everything, then the other player.',
      'Control Zone: 1" around each base. You can only enter an enemy’s zone to charge it.',
      'Starting in an enemy zone: stay put, charge that enemy, or move away without getting closer.',
      'Difficult terrain costs double for infantry and four times for cavalry.',
      'Obstacles up to half a model’s height are free; taller ones need a Jump or Climb test.',
      'Prone: no Control Zone, counts as half height. Standing up costs half its Move.',
    ],
  },
  {
    phase: 'Shoot',
    points: [
      'Needs range and line of sight. A model that moved more than half its Move can’t shoot.',
      'Roll to hit against Shoot value (a natural 6 always hits).',
      'Each obstruction in the way: 4+ to get past. On 1-3 it hits the obstruction (wound it if it’s a model).',
      'Then roll to wound with the weapon’s Strength against the target’s Defence.',
      'Evil models may shoot into combat or past friends: 4+ hits the target, otherwise the friend closest to the shooter.',
    ],
  },
  {
    phase: 'Fight',
    points: [
      'Pair off combats, declare heroic actions, then resolve each fight.',
      'Duel roll: each side rolls D6s equal to its Attacks; highest wins. Tie: higher Fight wins, then a D6 roll-off.',
      'Loser backs away 1". If it can’t (or is Prone) it is Trapped and the winner’s strikes are doubled.',
      'Winner makes strikes equal to its Attacks, splitting them as it likes.',
      'A friendly unengaged model can make way, moving up to 1" to let a model back away.',
      'Shielding: double your dice in the duel, but you can’t strike if you win.',
    ],
  },
  {
    phase: 'End',
    points: ['Check whether each army is Broken (half or more of its models lost). Then the next turn begins.'],
  },
];

export const HEROIC_ACTIONS: { name: string; phase: string; text: string }[] = [
  { name: 'Heroic Move', phase: 'Move', text: 'Move before everyone else. “With me!” lets friends within 6" go too. Cancelled if the hero is charged first.' },
  { name: 'Heroic March', phase: 'Move', text: '+3" Move (+5" for cavalry or flyers). “At the double” extends it to friends within 6"; none of them may charge and they must end within 6".' },
  { name: 'Heroic Channelling', phase: 'Move', text: 'The next Casting test this turn counts as a 6 (still pay the Will).' },
  { name: 'Heroic Resolve', phase: 'Move', text: 'Auto-pass Courage tests for a Broken army this turn; friends within 6" get a free extra die on Resist tests.' },
  { name: 'Heroic Shoot', phase: 'Shoot', text: 'Shoot before everyone else. “Loose!” lets friends within 6" shoot too (or lose their shot).' },
  { name: 'Heroic Accuracy', phase: 'Shoot', text: 'Gain Sharpshooter and re-roll failed In the Way tests. “Take aim” gives friends within 6" the re-rolls.' },
  { name: 'Heroic Combat', phase: 'Fight', text: 'Fight first. If every enemy in the fight dies, the hero and friends in it may move again, and fight again if they charge.' },
  { name: 'Heroic Challenge', phase: 'Fight', text: 'Pick an enemy hero of equal or higher tier within 6". +1 Attack and +1 to wound against it; slay it to regain 1 Might. If accepted, it gets the same.' },
  { name: 'Heroic Defence', phase: 'Fight', text: 'The hero is only wounded on natural 6s (both dice for 6+/X results).' },
  { name: 'Heroic Strength', phase: 'Fight', text: 'Double Strength (max 10) for strikes until the End phase.' },
  { name: 'Heroic Strike', phase: 'Fight', text: 'Add D3 to Fight value (max 10) for the Fight phase.' },
];
