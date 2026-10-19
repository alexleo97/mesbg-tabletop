import type { ReactNode } from 'react';
import { combats } from '../shared/flow.ts';
import { heroicsSettled } from '../shared/heroics.ts';
import { initialState, reduce } from '../shared/reducer.ts';
import type { DiceRoll, GameState, Model, Phase, Seat, Terrain } from '../shared/types.ts';

// The Learn to play course: chapters of short lessons, each on its own practice table.
// Every explanation here is written in our own words.

const WARRIOR = '[minas-tirith] warrior-of-minas-tirith';
const CAPTAIN = '[minas-tirith] captain-of-minas-tirith';
const KNIGHT = '[minas-tirith] knight-of-minas-tirith';
const RANGER = '[realms-of-men] ranger-of-gondor';
const GANDALF = '[men-of-the-west] gandalf-the-white';
const ORC = '[legions-of-mordor] mordor-orc-warrior';
const SHAMAN = '[legions-of-mordor] mordor-orc-shaman';
const TROLL = '[legions-of-mordor] mordor-troll';

const model = (id: string, name: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name, x, y, rot: owner === 'p1' ? 0 : 180, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1,
  might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});

const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, shape: Terrain['shape'] = 'circle', rot = 0): Terrain => ({
  id, kind, shape, x, y, w, h, rot, locked: true,
});

const PATROL = () => [
  model('captain', 'Captain of Minas Tirith', 'p1', 10, 19, CAPTAIN, { hero: true, might: 2, will: 1, fate: 1, wounds: 2, maxWounds: 2 }),
  model('warrior', 'Warrior of Minas Tirith', 'p1', 13.5, 19.5, WARRIOR),
  model('ranger', 'Ranger of Gondor', 'p1', 5, 18, RANGER),
  model('orc1', 'Orc Warrior', 'p2', 13.5, 13.5, ORC),
  model('orc2', 'Orc Warrior', 'p2', 17, 9, ORC),
  model('orc3', 'Orc Warrior', 'p2', 7, 9, ORC),
];
const SCENERY = () => [piece('trees', 'wood', 19, 15, 5, 5), piece('rock', 'rock', 5, 13, 3, 2.5), piece('ruin', 'ruin', 11, 5, 5, 3, 'rect')];

interface TableOptions {
  /** Changes to the usual patrol and Orcs, by model id. */
  changes?: Partial<Record<string, Partial<Model>>>;
  /** Other models to put on the table. */
  add?: Model[];
  /** Usual models to leave off. */
  drop?: string[];
  terrain?: Terrain[];
}

/** The practice table: a Gondor patrol meeting a few Orcs, changed to suit the lesson. */
function table({ changes = {}, add = [], drop = [], terrain = SCENERY() }: TableOptions = {}): GameState {
  const models = [...PATROL().filter(m => !drop.includes(m.id)), ...add].map(m => ({ ...m, ...changes[m.id] }));
  let s = reduce(initialState(), { type: 'setScenery', w: 24, h: 24, mat: 'grass', terrain });
  s = reduce(s, { type: 'addModels', models });
  return { ...s, names: { p1: 'You', p2: 'Mordor' }, listed: false };
}

/** A table already in the given phase of turn 1, with you holding Priority and heroic actions done. */
function inPhase(phase: Phase, opts?: TableOptions, turn = 1): GameState {
  const s = table(opts);
  return { ...s, phase, turn, priority: 'p1', flow: { ...s.flow, started: true, chooser: 'p1', chooserTurn: turn, passed: ['p1', 'p2'] } };
}

export interface Lesson {
  title: string;
  body: ReactNode;
  /** What to do, shown with a tick once it's done. Lessons without one are read and moved on from. */
  task?: string;
  setup: () => GameState;
  /** Carry on from the last lesson's table when coming straight from it. */
  continues?: boolean;
  /** Shows the setup card (with Start the battle), for a lesson that starts the battle. */
  setupCard?: boolean;
  done?: (s: GameState, start: GameState) => boolean;
}

export interface Chapter {
  id: string;
  title: string;
  /** One line on what the chapter teaches, for the chapter list. */
  blurb: string;
  lessons: Lesson[];
}

const moved = (s: GameState, start: GameState, id: string) => {
  const a = s.models[id];
  const b = start.models[id];
  return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) >= 2;
};
/** Rolls made since the lesson started. */
const newRolls = (s: GameState, start: GameState): DiceRoll[] => s.log.filter(r => !start.log.some(o => o.id === r.id));
const rolled = (prefix: string) => (s: GameState, start: GameState) => newRolls(s, start).some(r => r.label.startsWith(prefix));
const rolledWith = (text: string) => (s: GameState, start: GameState) => newRolls(s, start).some(r => r.label.includes(text));
const fought = (s: GameState, start: GameState) => newRolls(s, start).some(r => r.group?.startsWith('f-') && (r.against || r.note));
const shot = (s: GameState, start: GameState) => newRolls(s, start).some(r => r.group?.startsWith('s-'));

/** The two Gondor models already locked in combat with the nearest Orc. */
const IN_COMBAT = { captain: { x: 13.5, y: 14.48 }, warrior: { x: 16, y: 19 } };

export const CHAPTERS: Chapter[] = [
  {
    id: 'basics',
    title: 'The basics',
    blurb: 'The table, the dice, reading a profile and how a turn runs.',
    lessons: [
      {
        title: 'Welcome to the table',
        body: (
          <>
            <p>Two players each bring an army of miniatures and take turns to move, shoot and fight. Distances are measured in inches.</p>
            <p>You command the Gondor patrol at the bottom; the Orcs at the top are your enemy. Drag the empty table to look around, and zoom with the mouse wheel or by pinching.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: 'Reading a profile',
        body: (
          <>
            <p>Every model has a profile. Mv is how far it moves, Fv how well it fights, Sv what it needs to hit when shooting, S how hard it hits, D how tough it is, A how many dice it rolls in a fight, W how many wounds it can take, C its Courage and I its Intelligence.</p>
            <p>Heroes also have Might, Will and Fate points, which you'll meet in the Heroes chapter. Hover or press a stat on the card to see what it means.</p>
          </>
        ),
        task: 'Tap your Captain to open his card and look at his profile.',
        setup: () => table(),
      },
      {
        title: 'Dice',
        body: (
          <>
            <p>The game uses ordinary six-sided dice, called D6. When a roll says 4+, you need a 4, 5 or 6. A D3 is a D6 halved: 1-2 is 1, 3-4 is 2, 5-6 is 3.</p>
            <p>The table rolls every die for you and shows the result in the Log on the turn guide card, so both players see the same thing. Fights, shots, Courage, Fate and every other test are rolled as they happen.</p>
          </>
        ),
        task: 'Tap your Captain and press Courage on his card to roll a Courage test.',
        setup: () => table(),
        done: rolled('Courage test'),
      },
      {
        title: 'How a turn runs',
        body: (
          <>
            <p>Every turn has five phases, always in the same order: Priority, Move, Shoot, Fight and End. Both players act in each phase before the game moves on.</p>
            <p>The bar along the bottom of the screen is the turn guide. It always says what happens next and gives you the button for it.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: 'Who goes first',
        body: (
          <>
            <p>Each turn starts with both players rolling a D6. The higher roller chooses who has Priority, and the player with Priority acts first in every phase of that turn.</p>
            <p>On the first turn a tie is rolled again. Later, a tie goes to the player who didn't choose last turn.</p>
          </>
        ),
        task: 'Press Start the battle, then Roll for priority. If you win, take Priority.',
        setupCard: true,
        setup: () => table(),
        done: s => s.flow.started && s.phase !== 'priority',
      },
    ],
  },
  {
    id: 'moving',
    title: 'Moving',
    blurb: 'Control zones, terrain, jumping and climbing, and charging.',
    lessons: [
      {
        title: 'Moving a model',
        body: (
          <>
            <p>In the Move phase the player with Priority moves their models first, then the other player. Each model may move up to its Mv in inches, in any direction, turning as it goes.</p>
            <p>Tap a model to select it: the faint ring shows how far it can go. While you drag, a line shows the distance, and the model stops when it runs out of Move. Short drags add up, so a model can't creep further by moving twice.</p>
          </>
        ),
        task: 'Drag your Ranger at least 2" towards the rocks.',
        setup: () => inPhase('move'),
        done: (s, start) => moved(s, start, 'ranger'),
      },
      {
        title: 'Control zones',
        body: (
          <>
            <p>Every model has a control zone: the 1" around its base. You may only step into an enemy's control zone to charge it.</p>
            <p>A model that starts its move inside an enemy's zone can stay put, charge that enemy, or move away without getting any closer to it.</p>
          </>
        ),
        task: 'Select the Warrior and look at the small ring around the nearest Orc: that is its control zone.',
        setup: () => inPhase('move'),
      },
      {
        title: 'Difficult terrain',
        body: (
          <>
            <p>Woods, ruins and water are difficult terrain: every inch moved through them costs two. Cavalry pay four.</p>
            <p>Tap any piece of terrain to see what kind it is and how it plays. Hills and open ground cost nothing extra.</p>
          </>
        ),
        task: 'Move your Warrior into the edge of the woods on the right. Watch the distance count double inside.',
        setup: () => inPhase('move', { changes: { warrior: { x: 15, y: 19.5 } } }),
        done: s => Math.hypot(s.models.warrior.x - 19, s.models.warrior.y - 15) < 2.5,
      },
      {
        title: 'Jumping and climbing',
        body: (
          <>
            <p>Low obstacles, up to half a model's height, can be stepped over for free. Taller ones need a test: roll a D6 to Jump. On a 1 the model stumbles and stops. On 2-5 it gets over and stops on the far side. On a 6 it bounds over and keeps moving.</p>
            <p>Climbing a wall or cliff and leaping a gap work the same way, and the game rolls each one as the model reaches it.</p>
          </>
        ),
        task: 'Move your Warrior up to the wall, then press Jump on his card.',
        setup: () => inPhase('move', { terrain: [...SCENERY(), piece('wall', 'wall', 13.5, 17, 8, 0.6, 'rect')] }),
        done: rolledWith(': Jump test'),
      },
      {
        title: 'Charging',
        body: (
          <>
            <p>Moving into base contact with an enemy is a charge. Models touching bases will fight each other in the Fight phase, and a charged model can't move away.</p>
            <p>Charging first lets you pick your fights. Several of your models can gang up on one enemy. Drop a model just short of an enemy and it finishes the charge into contact for you.</p>
          </>
        ),
        task: 'Drag your Warrior into base contact with the nearest Orc, then press Done moving.',
        setup: () => inPhase('move'),
        done: s => s.phase !== 'move' && combats(s).length > 0,
      },
    ],
  },
  {
    id: 'shooting',
    title: 'Shooting',
    blurb: 'Range, rolling to hit, In the Way and rolling to wound.',
    lessons: [
      {
        title: 'Who can shoot',
        body: (
          <>
            <p>In the Shoot phase, a model with a bow or throwing weapon can shoot once if its target is in range and it can see it. A model that moved more than half its Mv this turn can't shoot, and neither can one in a fight.</p>
            <p>Try the 👁 Sight button on the left to see what your Ranger can see.</p>
          </>
        ),
        task: 'Tap your Ranger, tap an Orc, then press Shoot.',
        setup: () => inPhase('shoot'),
        done: shot,
      },
      {
        title: 'In the Way',
        body: (
          <>
            <p>Each thing between the shooter and the target, such as trees, a wall or another model, may stop the shot. For each one, roll a D6: on a 4+ the shot gets past, otherwise it hits the obstacle.</p>
            <p>The shot card counts these for you and rolls them with the shot.</p>
          </>
        ),
        task: 'Shoot at the Orc behind the crops and watch the In the Way roll.',
        setup: () => inPhase('shoot', { terrain: [piece('crops', 'field', 11, 13, 5, 4, 'rect')], changes: { orc2: { x: 15, y: 9 } } }),
        done: shot,
      },
      {
        title: 'Rolling to wound',
        body: (
          <>
            <p>A hit has to wound before it hurts. Compare the weapon's Strength with the target's Defence on the wound chart: the stronger the hit and the weaker the armour, the lower the roll you need.</p>
            <p>Some results read like 6/4: roll a 6, then a 4+ on a second die. When you shoot or fight from the model card, the game works this out for you.</p>
          </>
        ),
        task: 'Shoot at an Orc and watch the second row of dice: that is the roll to wound.',
        setup: () => inPhase('shoot'),
        done: shot,
      },
      {
        title: 'Shooting into a fight',
        body: (
          <>
            <p>Good models never shoot at an enemy that is fighting a friend. Evil models may, but on a roll of 1-3 the shot hits the friend instead.</p>
            <p>Either side can shoot past their own models, but those friends count as In the Way.</p>
          </>
        ),
        setup: () => inPhase('shoot'),
      },
    ],
  },
  {
    id: 'fighting',
    title: 'Fighting',
    blurb: 'Duels, ties, trapped models, weapons and shields.',
    lessons: [
      {
        title: 'The duel',
        body: (
          <>
            <p>In the Fight phase, every group of models in base contact fights. Each side rolls a D6 for every Attack it has, and the side with the highest single die wins the duel.</p>
            <p>The winner then strikes: one roll to wound per Attack, using its Strength against the loser's Defence.</p>
          </>
        ),
        task: 'Tap the ⚔ marker, press Roll the duel, then Roll strikes.',
        setup: () => inPhase('fight', { changes: IN_COMBAT }),
        done: fought,
      },
      {
        title: 'Ties and backing away',
        body: (
          <>
            <p>If both sides roll the same highest score, the model with the higher Fight value wins. If those match too, roll a D6 each to settle it.</p>
            <p>The loser backs away 1" before the winner strikes. A friend who isn't fighting can shuffle up to 1" to make room.</p>
          </>
        ),
        setup: () => inPhase('fight', { changes: IN_COMBAT }),
      },
      {
        title: 'Trapped',
        body: (
          <>
            <p>A loser that can't back away, because enemies, terrain or the table edge block it, is trapped. The winner rolls twice as many strikes against a trapped model.</p>
            <p>Surrounding an enemy is the surest way to finish it. The game spots a trapped loser for you and doubles the strikes.</p>
          </>
        ),
        task: 'Fight the Orc you have surrounded.',
        setup: () =>
          inPhase('fight', {
            changes: { captain: { x: 13.5, y: 14.48 }, warrior: { x: 13.5, y: 12.52 } },
            add: [model('ally', 'Warrior of Minas Tirith', 'p1', 14.48, 13.5, WARRIOR)],
          }),
        done: fought,
      },
      {
        title: 'Spears and pikes',
        body: (
          <>
            <p>A model with a spear standing right behind a friend in a fight can support it: it adds its Attacks to the friend's duel and strikes if they win, even though it isn't touching the enemy.</p>
            <p>A pike reaches further and can support through a second friend. A supporting model can't be in a fight of its own.</p>
          </>
        ),
        setup: () => inPhase('fight', { changes: IN_COMBAT }),
      },
      {
        title: 'Shields and big weapons',
        body: (
          <>
            <p>A model with a shield can choose to shield in a fight: it rolls twice as many duel dice, but can't strike even if it wins. It's a good way to hold on until help arrives.</p>
            <p>A two-handed weapon hits harder, adding 1 to each roll to wound, but its wielder takes 1 off its duel roll.</p>
          </>
        ),
        setup: () => inPhase('fight', { changes: IN_COMBAT }),
      },
    ],
  },
  {
    id: 'heroes',
    title: 'Heroes',
    blurb: 'Might, Will and Fate, every heroic action and Stand Fast.',
    lessons: [
      {
        title: 'Might',
        body: (
          <>
            <p>Might is a hero's will to change fate. Spend a point to add 1 to a die the hero rolled, after seeing it: a duel die, a roll to wound, a shot, a Fate roll and more. You can spend several on the same die.</p>
            <p>Might is also what pays for heroic actions. It doesn't come back, so use it when it counts.</p>
          </>
        ),
        task: 'Fight the Orc, and after the duel dice land press +1 under one of the Captain’s dice.',
        setup: () => inPhase('fight', { changes: IN_COMBAT }),
        done: (s, start) => s.models.captain.might < start.models.captain.might,
      },
      {
        title: 'Heroic actions',
        body: (
          <>
            <p>At the start of the Move, Shoot and Fight phases, heroes can spend a Might point on a heroic action. A Heroic Move lets the hero, and friends near it, move before anyone else. A Heroic Combat makes its fight go first.</p>
            <p>The players take turns to declare or pass, starting with the player without Priority. Hover any heroic action to see what it does.</p>
          </>
        ),
        task: 'Declare a heroic action for your Captain, or press Pass.',
        setup: () => ({ ...inPhase('move'), flow: { ...inPhase('move').flow, passed: [] } }),
        done: s => heroicsSettled(s),
      },
      {
        title: 'Fate',
        body: (
          <>
            <p>When a hero is wounded, it can spend Fate points to shrug the wound off. Roll a D6 for each point spent: on a 4+ the wound is ignored. Might can raise a failed Fate roll.</p>
            <p>A model with no wounds left is removed as a casualty.</p>
          </>
        ),
        task: 'The Orc has wounded your Captain. Press Roll Fate in the turn guide, or take the wound.',
        setup: () => inPhase('fight', { changes: { ...IN_COMBAT, captain: { ...IN_COMBAT.captain, pending: 1 } } }),
        done: s => !s.models.captain.pending,
      },
      {
        title: 'Will',
        body: (
          <>
            <p>Will points power magic, and they also steady nerves: a hero can spend Will to add 1 per point to a Courage test.</p>
            <p>Magic users cast with Will, and anyone with Will can use it to resist a spell. You'll try both in the Magic chapter.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: 'Stand Fast!',
        body: (
          <>
            <p>When a hero passes a Courage test, friends within 6" who would have to test that phase can count as passing too. A brave hero keeps an army in the fight.</p>
            <p>Some heroes are leaders with longer reach. Their special rules on the unit card say so.</p>
          </>
        ),
        setup: () => table(),
      },
    ],
  },
  {
    id: 'courage',
    title: 'Courage',
    blurb: 'Broken armies, Courage tests and Terror.',
    lessons: [
      {
        title: 'Courage tests',
        body: (
          <>
            <p>A Courage test is a 2D6 roll: add the dice, and if the total reaches the model's Courage value it passes. A Courage of 7+ needs a total of 7 or more.</p>
            <p>Tests come up when an army is Broken, when charging something terrifying, and from some spells.</p>
          </>
        ),
        task: 'Tap your Warrior and press Courage on its card.',
        setup: () => inPhase('move'),
        done: rolled('Courage test'),
      },
      {
        title: 'Broken',
        body: (
          <>
            <p>An army that has lost more than half the models it started with is Broken. From then on, each of its models must pass a Courage test when it activates, or flee the battle.</p>
            <p>The turn guide tracks every army's losses and warns you when one breaks.</p>
          </>
        ),
        task: 'Your patrol has lost four warriors and is Broken. Test Courage for your Ranger.',
        setup: () =>
          inPhase(
            'move',
            {
              add: [0, 1, 2, 3].map(i => model(`lost${i}`, 'Warrior of Minas Tirith', 'p1', 2 + i * 2, 22.5, WARRIOR, { dead: true })),
            },
            2,
          ),
        done: rolled('Courage test'),
      },
      {
        title: 'Terror',
        body: (
          <>
            <p>Some creatures cause Terror. A model that wants to charge one must pass a Courage test first, and if it fails it can't charge or move that turn.</p>
            <p>Select a model near the Troll: its card offers the test when the Troll is within reach.</p>
          </>
        ),
        task: 'Try to charge the Troll: tap your Warrior and roll its Courage test against Terror.',
        setup: () => inPhase('move', { drop: ['orc1'], add: [model('troll', 'Mordor Troll', 'p2', 13.5, 13, TROLL, { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 })] }),
        done: rolled('Courage'),
      },
    ],
  },
  {
    id: 'magic',
    title: 'Magic',
    blurb: 'Casting with Will, resisting, and what powers do.',
    lessons: [
      {
        title: 'Casting a power',
        body: (
          <>
            <p>Magic users cast during their move. Choose a power and how many Will points to spend, then roll a D6 per point. If any die reaches the power's casting value, it works. The Will is spent either way.</p>
            <p>Each power on a unit card shows its range and casting value.</p>
          </>
        ),
        task: 'Select Gandalf and cast any power from his card.',
        setup: () =>
          inPhase('move', {
            drop: ['captain'],
            add: [model('gandalf', 'Gandalf the White', 'p1', 10, 19, GANDALF, { hero: true, might: 3, will: 6, fate: 3, wounds: 3, maxWounds: 3 })],
          }),
        done: rolled('Cast '),
      },
      {
        title: 'Resisting',
        body: (
          <>
            <p>The target can fight a spell off with its own Will. It rolls a D6 per point it spends, and if any die equals or beats the caster's best die, the power fails.</p>
            <p>A hero who rolls a 6 when resisting gets that Will point back.</p>
          </>
        ),
        task: 'The Shaman has cast Transfix at your Captain. Resist it in the turn guide.',
        setup: () => {
          const s = inPhase('move', { add: [model('shaman', 'Orc Shaman', 'p2', 10, 12, SHAMAN, { hero: true, might: 1, will: 5, fate: 1, wounds: 2, maxWounds: 2 })] });
          const roll = { id: 'w-lesson-0', by: 'p2' as const, label: 'Cast Transfix (5+) by Orc Shaman at Captain of Minas Tirith', dice: [5, 2], target: 5, model: 'shaman', aim: 'captain', note: 'Cast on a 5. Captain of Minas Tirith may resist with Will, needing a 5 or more.', at: 0 };
          return { ...s, log: [roll], flow: { ...s.flow, spell: { roll: roll.id, caster: 'shaman', target: 'captain', power: 'Transfix', cv: 5 } } };
        },
        done: rolled('Resist '),
      },
      {
        title: 'How long powers last',
        body: (
          <>
            <p>Instant powers happen and are over, like a blast that knocks enemies down. Temporary ones last until the End phase. Exhaustion powers keep going until the caster runs out of Will.</p>
            <p>Every active power ends at once if its caster is slain. A caster's card lists each of its powers and what it does.</p>
          </>
        ),
        setup: () => table(),
      },
    ],
  },
  {
    id: 'cavalry',
    title: 'Cavalry and monsters',
    blurb: 'Riders, thrown riders, and great beasts.',
    lessons: [
      {
        title: 'Cavalry',
        body: (
          <>
            <p>Riders move at their mount's speed, usually 10" for a horse, but terrain hurts them: difficult ground costs four times as much, and they can't climb.</p>
            <p>A cavalry model that charges infantry and wins the duel knocks its foes to the ground, so they count as trapped and take double strikes.</p>
          </>
        ),
        task: 'Charge the Orc with your Knight, then press Done moving.',
        setup: () =>
          inPhase('move', {
            drop: ['warrior'],
            add: [model('knight', 'Knight of Minas Tirith', 'p1', 15, 21, KNIGHT, { move: 10, base: { shape: 'round', w: 40, h: 40 } })],
          }),
        done: s => s.phase !== 'move' && combats(s).some(c => [...c.p1, ...c.p2].includes('knight')),
      },
      {
        title: 'Thrown riders',
        body: (
          <>
            <p>If a mount is slain or knocked down, its rider is thrown, and the game rolls on the Thrown Rider table for you: a 1 means it takes a hit and lands on the ground, 2-5 means it stands up but loses the rest of the turn, and a 6 means it lands ready to fight.</p>
          </>
        ),
        setup: () => inPhase('fight'),
      },
      {
        title: 'Monsters',
        body: (
          <>
            <p>Trolls and other monsters are big, strong and hard to wound, with several Attacks and Wounds. Many cause Terror.</p>
            <p>A monster that wins a fight can swap its strikes for a brutal attack, such as hurling a foe across the table or barging through a crowd. Its special rules are on its unit card.</p>
          </>
        ),
        task: 'Tap the Troll and read its card.',
        setup: () => inPhase('move', { drop: ['orc1'], add: [model('troll', 'Mordor Troll', 'p2', 13.5, 12, TROLL, { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 })] }),
      },
    ],
  },
  {
    id: 'first-game',
    title: 'Your first real game',
    blurb: 'Building a list, picking a scenario and winning.',
    lessons: [
      {
        title: 'Building an army',
        body: (
          <>
            <p>Agree a points limit with your opponent, then build an army on the Armies page. Every warband is led by a hero, and the hero's rank decides how many warriors can follow.</p>
            <p>One hero leads the whole army. Your lists save themselves and can be deployed at any table in one tap from the Armies tab of the battle card on the left.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: 'Scenarios',
        body: (
          <>
            <p>Every game is played as a scenario. It sets where each army deploys, what you're fighting over, when the game ends and how to score. Pick one in the Scenario tab of the battle card on the left, or roll for one.</p>
            <p>The table draws the deployment zones and objectives for you.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: 'Winning',
        body: (
          <>
            <p>You score victory points for the scenario's goals, often holding objectives, breaking the enemy army or slaying its leader. Many games end once an army is reduced to a quarter of its models.</p>
            <p>The score sits at the top of the table, and when the game ends both players confirm the result.</p>
          </>
        ),
        setup: () => table(),
      },
      {
        title: "You're ready",
        body: (
          <>
            <p>That's the whole game. Start a game, send your opponent the link, deploy your armies and play. The turn guide walks you through every phase.</p>
            <p>The game rolls every test and works out every chart for you, and you can come back to any chapter here whenever you need a reminder.</p>
          </>
        ),
        setup: () => table(),
      },
    ],
  },
];
