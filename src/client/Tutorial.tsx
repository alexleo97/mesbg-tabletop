import { useMemo, useState } from 'react';
import { combats } from '../shared/flow.ts';
import { heroicsSettled } from '../shared/heroics.ts';
import { initialState, reduce } from '../shared/reducer.ts';
import type { GameState, Model, Phase, Seat, Terrain } from '../shared/types.ts';
import { Game } from './App.tsx';
import { PracticeGame } from './practice.ts';
import { useRoom } from './net.ts';
import type { Settings } from './settings.ts';

const WARRIOR = '[minas-tirith] warrior-of-minas-tirith';
const CAPTAIN = '[minas-tirith] captain-of-minas-tirith';
const RANGER = '[realms-of-men] ranger-of-gondor';
const ORC = '[legions-of-mordor] mordor-orc-warrior';

const model = (id: string, name: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name, x, y, rot: owner === 'p1' ? 0 : 180, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1,
  might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});

const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, shape: Terrain['shape'] = 'circle'): Terrain => ({
  id, kind, shape, x, y, w, h, rot: 0, locked: true,
});

/** The practice table: a Gondor patrol meeting a few Orcs. */
function table(changes: Partial<Record<string, Partial<Model>>> = {}): GameState {
  const models = [
    model('captain', 'Captain of Minas Tirith', 'p1', 10, 19, CAPTAIN, { hero: true, might: 2, will: 1, fate: 1, wounds: 2, maxWounds: 2 }),
    model('warrior', 'Warrior of Minas Tirith', 'p1', 13.5, 19.5, WARRIOR),
    model('ranger', 'Ranger of Gondor', 'p1', 5, 18, RANGER),
    model('orc1', 'Orc Warrior', 'p2', 13.5, 13.5, ORC),
    model('orc2', 'Orc Warrior', 'p2', 17, 9, ORC),
    model('orc3', 'Orc Warrior', 'p2', 7, 9, ORC),
  ].map(m => ({ ...m, ...changes[m.id] }));
  let s = reduce(initialState(), { type: 'setScenery', w: 24, h: 24, mat: 'grass', terrain: [piece('trees', 'wood', 19, 15, 5, 5), piece('rock', 'rock', 5, 13, 3, 2.5), piece('ruin', 'ruin', 11, 5, 5, 3, 'rect')] });
  s = reduce(s, { type: 'addModels', models });
  return { ...s, names: { p1: 'You', p2: 'Mordor' }, listed: false };
}

/** A table already in the given phase of turn 1, with you holding Priority and heroic actions done. */
function inPhase(phase: Phase, changes?: Parameters<typeof table>[0]): GameState {
  const s = table(changes);
  return { ...s, phase, priority: 'p1', flow: { ...s.flow, started: true, chooser: 'p1', chooserTurn: 1, passed: ['p1', 'p2'] } };
}

interface Lesson {
  title: string;
  body: React.ReactNode;
  /** What to do, shown with a tick once it's done. */
  task?: string;
  setup: () => GameState;
  /** Carry on from the last lesson's table when coming straight from it. */
  continues?: boolean;
  done?: (s: GameState, start: GameState) => boolean;
}

const moved = (s: GameState, start: GameState, id: string) => {
  const a = s.models[id];
  const b = start.models[id];
  return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) >= 2;
};

const LESSONS: Lesson[] = [
  {
    title: 'Welcome to the table',
    body: (
      <>
        <p>Two players bring an army each, and the game is played in turns. Every turn has five phases in the same order: Priority, Move, Shoot, Fight and End.</p>
        <p>You command the Gondor patrol at the bottom. The bar along the bottom of the screen is the turn guide: it always says what happens next and gives you the button for it.</p>
        <p>Drag the empty table to look around, and zoom with the mouse wheel or by pinching.</p>
      </>
    ),
    setup: () => table(),
  },
  {
    title: 'Who goes first',
    body: (
      <>
        <p>Each turn starts with both players rolling a D6. The winner chooses who has Priority, and the player with Priority acts first in every phase that turn.</p>
      </>
    ),
    task: 'Press Start the battle, then Roll for priority. If you win the roll, take Priority.',
    setup: () => table(),
    done: s => s.flow.started && s.phase !== 'priority',
  },
  {
    title: 'Heroic actions',
    body: (
      <>
        <p>Heroes carry Might points. At the start of the Move, Shoot and Fight phases they can spend one on a heroic action, such as a Heroic Move to act before anyone else.</p>
        <p>Your Captain has 2 Might. The players take turns to declare or pass, starting with the player without Priority.</p>
      </>
    ),
    task: 'Declare a heroic action for your Captain, or press Pass.',
    continues: true,
    setup: () => ({ ...inPhase('move'), flow: { ...inPhase('move').flow, passed: [] } }),
    done: s => heroicsSettled(s),
  },
  {
    title: 'Moving',
    body: (
      <>
        <p>Tap a model to select it. The faint ring shows how far it can move (6" for most infantry) and the small ring is its 1" control zone, which enemies may only enter to charge.</p>
        <p>While you drag, the line shows the distance against the model's Move. It turns red if you go too far. Woods, water and ruins count double, so going through the trees costs more.</p>
      </>
    ),
    task: 'Drag your Ranger at least 2" towards the rocks.',
    setup: () => inPhase('move'),
    done: (s, start) => moved(s, start, 'ranger'),
  },
  {
    title: 'Charging',
    body: (
      <>
        <p>Moving into base contact with an enemy is a charge. Models that touch bases fight each other in the Fight phase.</p>
      </>
    ),
    task: 'Drag your Warrior of Minas Tirith into base contact with the nearest Orc, then press Done moving.',
    setup: () => inPhase('move'),
    done: s => s.phase !== 'move' && combats(s).length > 0,
  },
  {
    title: 'Shooting',
    body: (
      <>
        <p>In the Shoot phase, models with bows that didn't move too far can shoot. Select the shooter, then tap an enemy to aim: the card shows the range, what you need to hit, and what you need to wound.</p>
        <p>Anything in the way, such as trees or other models, gives the target a chance the arrow is stopped. Try the 👁 Sight button on the left to see what your Ranger can see.</p>
      </>
    ),
    task: 'Tap your Ranger, tap an Orc, then press Shoot.',
    setup: () => inPhase('shoot'),
    done: s => s.log.some(r => r.group?.startsWith('s-')),
  },
  {
    title: 'Fighting',
    body: (
      <>
        <p>Each fight starts with a duel: both sides roll a D6 for each Attack and the highest die wins (a tie goes to the higher Fight value). The winner then rolls to wound, using its Strength against the loser's Defence.</p>
        <p>Your Captain is a hero. After the duel dice are rolled, press +1 under one of his dice to spend Might and raise it.</p>
      </>
    ),
    task: 'Tap the ⚔ marker, press Roll the duel, then Roll strikes.',
    setup: () => inPhase('fight', { captain: { x: 13.5, y: 14.48 }, warrior: { x: 16, y: 19 } }),
    done: s => s.log.some(r => r.group?.startsWith('f-') && (r.against || r.note)),
  },
  {
    title: 'Fate',
    body: (
      <>
        <p>When a hero is wounded, Fate points give it a chance to shrug the wound off: roll a D6 for each one, and on a 4+ the wound is ignored. Might can raise a Fate roll too.</p>
        <p>A model with no wounds left is removed as a casualty.</p>
      </>
    ),
    task: 'The Orc has wounded your Captain. Press Roll Fate in the turn guide (or take the wound).',
    setup: () => inPhase('fight', { captain: { x: 13.5, y: 14.48, pending: 1 }, warrior: { x: 16, y: 19 } }),
    done: s => !s.models.captain.pending,
  },
  {
    title: 'The end of the turn',
    body: (
      <>
        <p>In the End phase the guide checks the battle. An army that has lost more than half its models is Broken, and its models must test their Courage to keep fighting. Each scenario also says when the game ends and how to score.</p>
      </>
    ),
    task: 'Press Start turn 2.',
    setup: () => inPhase('end'),
    done: s => s.turn === 2,
  },
  {
    title: "You're ready",
    body: (
      <>
        <p>That's a whole turn. In a real game you build your army in the ⚔ Army tab (or import one from the MESBG List Builder), choose a scenario in the ⛰ Table tab, and send your opponent the link.</p>
        <p>The 📖 Rules tab has the charts, magic and the fight helper whenever you need them.</p>
      </>
    ),
    setup: () => table(),
  },
];

/** The training: a guided practice game against a quiet opponent, one lesson at a time. */
export function Tutorial({ settings, updateSettings, onExit, onPlay }: { settings: Settings; updateSettings: (p: Partial<Settings>) => void; onExit: () => void; onPlay: () => void }) {
  const game = useMemo(() => new PracticeGame(LESSONS[0].setup()), []);
  const { state } = useRoom(game);
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<GameState>(() => game.getSnapshot().state);
  const [small, setSmall] = useState(false);
  // On a phone the card would cover the table, so the explanation folds away behind a button.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches;
  const [more, setMore] = useState(!narrow);
  const lesson = LESSONS[step];
  const done = lesson.done ? lesson.done(state, start) : true;

  const go = (next: number, keep = false) => {
    const s = keep ? state : LESSONS[next].setup();
    if (!keep) game.load(s);
    setStart(s);
    setStep(next);
    setSmall(false);
    setMore(!narrow);
  };
  const last = step === LESSONS.length - 1;

  const card = (
    <section className={`lesson ${small ? 'small' : ''}`} aria-label="Lesson">
      <div className="lesson-head">
        <small>
          {step + 1} of {LESSONS.length}
        </small>
        <h3>{lesson.title}</h3>
        <button className="lesson-toggle" onClick={() => setSmall(v => !v)} aria-label={small ? 'Show lesson' : 'Hide lesson'}>
          {small ? '▾' : '▴'}
        </button>
        <button className="lesson-exit" onClick={onExit} aria-label="Leave the training">
          ✕
        </button>
      </div>
      {!small && (
        <>
          {(more || !lesson.task) && <div className="lesson-body">{lesson.body}</div>}
          {lesson.task && <p className={`lesson-task ${done ? 'done' : ''}`}>{done ? `✓ ${lesson.task}` : lesson.task}</p>}
          {lesson.task && !more && (
            <button className="link lesson-more" onClick={() => setMore(true)}>
              Why?
            </button>
          )}
          <div className="row wrap lesson-nav">
            {step > 0 && <button onClick={() => go(step - 1)}>Back</button>}
            {lesson.done && <button onClick={() => go(step)}>Restart</button>}
            {last ? (
              <>
                <button className="primary" onClick={onPlay}>
                  Start a real game
                </button>
                <button onClick={onExit}>Home</button>
              </>
            ) : (
              <button className={done ? 'primary' : ''} onClick={() => go(step + 1, done && !!LESSONS[step + 1].continues)}>
                {done ? 'Next' : 'Skip'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );

  // A fresh game screen per lesson clears selections and fits the table again.
  return <Game key={step} room="practice" settings={settings} updateSettings={updateSettings} practice={game} overlay={card} />;
}
