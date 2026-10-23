import { useEffect, useRef, useState, type ReactNode } from 'react';
import RULES from '../data/special-rules.json';
import { COMMON_RULES, POOLS } from '../shared/scenarios.ts';
import { D6_TABLES, HEROIC_ACTIONS, MISSILE_WEAPONS, TURN_SUMMARY, woundNeed } from '../shared/rules.ts';
import { BOT_NAME } from '../shared/types.ts';
import { CONTROLS, CONTROLS_NOTE } from './controls.ts';
import { MagicReference } from './MagicPanel.tsx';

const PALANTIR = BOT_NAME.replace(/^The /, 'the ');

/** Every key and gesture, grouped, for the settings. */
export function ControlsList() {
  return (
    <div className="controls-list">
      {CONTROLS.map(g => (
        <section key={g.group}>
          <b>{g.group}</b>
          <dl>
            {g.items.map(c => (
              <div key={c.how}>
                <dt>{c.how}</dt>
                <dd>{c.does}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="fine">{CONTROLS_NOTE}</p>
    </div>
  );
}

/** A card over the whole page, closed with ✕, Esc or a click outside it. */
export function HelpDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);
  return (
    <dialog ref={ref} className="help-dialog" aria-label={title} onClose={onClose} onClick={e => e.target === ref.current && onClose()}>
      <header>
        <h2>{title}</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="help-body">{children}</div>
    </dialog>
  );
}

/** The two help buttons for the settings, each opening its card. */
export function HelpButtons() {
  const [open, setOpen] = useState<'guide' | 'rules' | null>(null);
  return (
    <>
      <div className="row wrap help-buttons">
        <button onClick={() => setOpen('guide')}>📖 How the app works</button>
        <button onClick={() => setOpen('rules')}>📜 Rules reference</button>
      </div>
      {open === 'guide' && (
        <HelpDialog title="How the app works" onClose={() => setOpen(null)}>
          <AppGuide />
        </HelpDialog>
      )}
      {open === 'rules' && (
        <HelpDialog title="Rules reference" onClose={() => setOpen(null)}>
          <RulesReference />
        </HelpDialog>
      )}
    </>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="help-part">
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** Every part of the app and how to use it, in plain words. */
export function AppGuide() {
  return (
    <div className="guide">
      <p>
        MESBG VTT is a table for the Middle-earth Strategy Battle Game in your browser. You move the models; the game rolls every die, follows the turn and works out the
        rules. Open any part below.
      </p>

      <Part title="Finding your way">
        <ul>
          <li>
            <b>Play</b> is the home page: start a game, play {PALANTIR}, open a narrative scenario, Learn to play, join a game by its code, or pick one from <b>Open games</b>.
          </li>
          <li>
            <b>Armies</b> is where you build and keep your army lists.
          </li>
          <li>
            <b>Maps</b> has the Middle-earth maps from the narrative scenarios, tables made by you and by other players, and the map editor.
          </li>
          <li>
            <b>Leaderboard</b> and your <b>profile</b> appear once you sign in with Discord.
          </li>
          <li>
            <b>⚙ Settings</b> (top right, or at the table) holds the look of the app, these help cards and the controls.
          </li>
        </ul>
      </Part>

      <Part title="Starting a game with a friend">
        <ol>
          <li>Press <b>Start a new game</b>. Choose <b>A friend</b> as your opponent.</li>
          <li>
            Choose a scenario: one of the 24 matched play scenarios (in pools: {POOLS.slice(1).join(', ')}), <b>Roll for it</b>, or <b>Open play</b> with no scenario.
          </li>
          <li>Choose a table: a Middle-earth map, a community map, an empty table, or one of your own.</li>
          <li>Choose your army: one of your lists, a premade army at a points size, or pick it at the table.</li>
          <li>Press <b>Play</b>. You arrive at the table with it set up.</li>
        </ol>
        <p>
          Send your friend the link (click the game's name at the top to copy it). They take the other seat and deploy their own army. Anyone else who opens the link
          watches as a spectator.
        </p>
        <p>
          In the turn guide's <b>Table</b> view you can show the game in the <b>Open games</b> list, or make it <b>private</b> so only people with the invite link can take a
          seat. Change your name or seat there too, or leave.
        </p>
      </Part>

      <Part title={`Solo battles against ${PALANTIR}`}>
        <p>
          Press <b>Solo battle</b> on the home page, or choose {BOT_NAME} as your opponent. Pick a scenario, table and your army, then {PALANTIR}'s army: a random list from
          any army or one you name, or a premade one, at the points you choose.
        </p>
        <p>
          {BOT_NAME} plays the whole other side: it rolls for priority, moves, charges, shoots, casts, picks fights, spends Might and makes heroic actions, and plays the
          scenario. The button at the top sets how fast it plays (Normal, Fast or Instant). A solo game can't be joined by anyone else.
        </p>
      </Part>

      <Part title="Narrative scenarios">
        <p>
          Battles from the books with their own table, characters and special rules: Weathertop, Roast Mutton and Helm's Deep, grouped under The Hobbit and The Lord of
          the Rings. Choose a scenario, choose your side (Good or Evil), choose a friend or {PALANTIR}, and for some how many turns it lasts.
        </p>
        <p>The cast is fixed, so there are no lists to pick. The Scenario tab at the table has the objectives and special rules, and the game plays them for you.</p>
      </Part>

      <Part title="Learn to play">
        <p>
          Nine short chapters on a practice table: the basics, moving, shooting, fighting, heroes, Courage, magic, cavalry and monsters, and your first real game. Each step
          tells you what to try and only lets you do that, so you can't get lost. Jump to any chapter, and come back whenever you want a reminder.
        </p>
      </Part>

      <Part title="Building an army">
        <ol>
          <li>On the <b>Armies</b> page, press <b>New</b>, name the list and type the points limit you agreed. 📖 Guide shows these steps.</li>
          <li>Pick an army. Its bonuses and limits are shown, each opened with a tap.</li>
          <li>Add a hero. Every hero leads a warband; add warriors to it up to the number shown.</li>
          <li>Use the − and + to change how many, and the options for wargear and mounts.</li>
          <li>Tap ☆ to make a hero your army's leader. Fix anything marked ⚠. Tap ⓘ to see a unit's card and rules.</li>
        </ol>
        <p>
          Lists save by themselves in your browser, and to your account when you are signed in, so they are ready at every table. You can also import a list: upload the
          MESBG List Builder's .json export, paste Tabletop Admiral's TTS/JSON view, or paste a plain list such as “12x Warrior of Minas Tirith”.
        </p>
      </Part>

      <Part title="Maps and the map editor">
        <p>
          The <b>Maps</b> page shows the Middle-earth maps (the tables from the narrative scenarios), community maps and your own. <b>Play on this map</b> starts a game on it. Your own maps can be edited, shared or kept private, and deleted.
        </p>
        <p>
          <b>New map</b> opens the editor. Start from a Middle-earth or community map or add pieces: woods, hills, ruins, walls, buildings, water, gates, towers and more. Drag a piece to move it,
          and tap it to change its type, width, depth, height, floors, shape and turn, mark it difficult, sheer or locked, or delete it. Gates, barricades and towers take
          wounds and can belong to a side. Pick the board size (48"×48", 72"×48" or 24"×24"), name the map and save it. Saving needs you to be signed in.
        </p>
        <p>The Table view at the table has the same tools, and can save the table you are on as a map or load one of yours.</p>
      </Part>

      <Part title="Setting up at the table">
        <p>Before the battle the <b>Set up the battle</b> card walks you through three steps:</p>
        <ol>
          <li>
            <b>Table:</b> pick a Middle-earth or community map, or lay out terrain.
          </li>
          <li>
            <b>Scenario:</b> pick or roll one. The table draws its deployment zones and objectives, and any secret picks are made here.
          </li>
          <li>
            <b>Armies:</b> each player deploys an army from My lists, Premade, Build or Import.
          </li>
        </ol>
        <p>
          Then you set up as the scenario says, from the foot of the card. Roll off: the winner chooses their end of the table (taking the far end turns the table round) and goes
          first. You then take turns putting one warband on the table at a time. The game lays each one out by its Captain; drag its models where you want them (they stop at
          the edge of where they may go, and within 6" of their Captain), then say you're done. In Domination you first take turns placing the objective markers the same way.
          When everything is down, press the button at the foot of the card to start the battle.
        </p>
      </Part>

      <Part title="Playing the battle">
        <ul>
          <li>
            <b>The turn guide</b> (bottom right) runs the game. The phases sit along its top with the current one lit up. It says what happens now and whose go it is, and gives
            you the button for the next step: rolling for priority, declaring heroic actions, ending your move and so on. Its <b>Table</b> view holds the table tools and
            game settings; its <b>Log</b> shows every die rolled.
          </li>
          <li>
            <b>The battle card</b> (bottom left) has the tool bar and tabs for <b>Armies</b> (each side's warbands and losses), <b>Scenario</b> (objectives, victory points and
            special rules) and <b>Fight</b> while a fight is open.
          </li>
          <li>
            <b>The tool bar:</b> ✋ Drag, ⬚ Select, 📏 Measure, 📍 Mark, 👁 Sight, 🏷 model names, ⛰ terrain names, ✕ Arrows and ↶ Undo.
          </li>
          <li>
            <b>Select a model</b> to open its card: its profile, Might, Will and Fate, wargear and special rules, and what it can do now, such as going back to where it
            started, shooting, casting or dismounting.
          </li>
          <li>
            <b>Moving:</b> drag your models in your part of the Move phase. Rings show how far each can go, and it stops when its Move runs out. Jump, Climb and Leap tests and
            Terror tests are rolled as you reach them.
          </li>
          <li>
            <b>Shooting:</b> select a shooter and tap an enemy to aim; the shot card shows the range, what's in the way and the roll needed, and rolls it all.
          </li>
          <li>
            <b>Fighting:</b> tap the ⚔ marker on a fight, or press it in the turn guide. The fight card rolls the duel, offers Might, backs the loser away, and rolls the strikes and
            any Fate.
          </li>
          <li>
            <b>The score</b> sits at the top as VP. When the game ends the guide shows the result and both players confirm it. You can also concede or offer a draw under Table ›
            Finish the game early.
          </li>
          <li>
            <b>Moving on</b> in ⚙ Settings chooses whether each phase moves on by itself or waits for a click.
          </li>
          <li>
            <b>Save game</b> and <b>Load game</b> in the Table view keep a game as a file. ↶ Undo (Ctrl+Z) takes back your last change.
          </li>
          <li>On a wide screen the cards can be dragged by their headers and locked in place; ▾ folds a card away.</li>
        </ul>
      </Part>

      <Part title="Accounts, the leaderboard and Discord">
        <p>
          Sign in with Discord to keep your armies and maps on every device, set your name, see your games, wins, draws and losses on your profile, and climb the
          leaderboard. The leaderboard counts games between two signed-in players who both agreed on the result. <b>Join Discord</b> finds opponents and is where to
          report bugs.
        </p>
      </Part>

      <Part title="Settings">
        <p>
          ⚙ Settings changes only how the game looks for you: the colour theme, the heading and text fonts, unit photos on bases, names under models and on terrain,
          animations, move and control zones, deployment zones and the 1" grid. It also has the controls list and these help cards.
        </p>
      </Part>
    </div>
  );
}

/** One topic of the rules, with what the app does for it. */
function Topic({ title, app, children }: { title: string; app?: string; children: ReactNode }) {
  return (
    <details className="help-part">
      <summary>{title}</summary>
      {children}
      {app && <p className="app-does">In the app: {app}</p>}
    </details>
  );
}

const SPECIAL = Object.entries(RULES as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));

/** The rules of the game in short, for looking things up during a battle. */
export function RulesReference() {
  const [find, setFind] = useState('');
  const q = find.trim().toLowerCase();
  const special = q ? SPECIAL.filter(([name, text]) => name.toLowerCase().includes(q) || text.toLowerCase().includes(q)) : SPECIAL;
  return (
    <div className="guide rules">
      <p>
        A short reminder of how the game plays, in our own words. The app rolls the dice and applies these for you; this is here so you know what it's doing. The Rules
        Manual has the full wording. Each unit's own rules are on its card.
      </p>

      <Topic title="Profiles and dice">
        <ul>
          <li>
            <b>Mv</b> Move in inches, <b>Fv</b> Fight value, <b>Sv</b> Shoot value (the roll to hit), <b>S</b> Strength, <b>D</b> Defence, <b>A</b> Attacks, <b>W</b> Wounds,{' '}
            <b>C</b> Courage and <b>I</b> Intelligence.
          </li>
          <li>Heroes also have Might, Will and Fate points.</li>
          <li>Dice are D6. “4+” means 4, 5 or 6. A D3 is a D6 halved (1–2 is 1, 3–4 is 2, 5–6 is 3).</li>
        </ul>
      </Topic>

      <Topic title="The turn" app="the turn guide walks through each phase and rolls priority.">
        {TURN_SUMMARY.map(p => (
          <div key={p.phase}>
            <b>{p.phase}</b>
            <ul>
              {p.points.map(x => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ))}
      </Topic>

      <Topic title="Moving and terrain" app="rings show each model's Move, models stop when it runs out, and terrain tests are rolled as a model reaches the obstacle. Tap any terrain to see how it plays.">
        <ul>
          <li>Moving into base contact with an enemy is a charge. A charged model can't move away.</li>
          <li>A model that starts in an enemy's 1" control zone may stay, charge it, or move away without getting closer.</li>
          <li>Woods, ruins and water are difficult: each inch costs two (four for cavalry). Cavalry can't climb.</li>
          <li>Obstacles up to half a model's height cost nothing. Taller ones need a test:</li>
        </ul>
        {D6_TABLES.map(t => (
          <div key={t.name} className="d6-table">
            <b>{t.name}</b> <span className="muted">{t.when}</span>
            <table>
              <tbody>
                {(['1', '2–5', '6'] as const).map((k, i) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{t.results[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Topic>

      <Topic title="Shooting" app="select a shooter and tap a target: the shot card checks range and sight, counts what's in the way and rolls to hit, In the Way and to wound.">
        <ul>
          <li>Needs range and line of sight. A model that moved more than half its Move, or is in a fight, can't shoot.</li>
          <li>Roll the Shoot value to hit. Each thing in the way is passed on a 4+; otherwise the shot hits it.</li>
          <li>Then roll to wound with the weapon's Strength against the target's Defence.</li>
          <li>Good models never shoot into a fight. Evil models may: on 1–3 the shot hits their own model instead.</li>
        </ul>
        <table className="ref">
          <tbody>
            {MISSILE_WEAPONS.map(w => (
              <tr key={w.name}>
                <td>{w.name}</td>
                <td>{w.range}"</td>
                <td>S{w.s}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Topic>

      <Topic title="To wound chart" app="every wound roll is looked up for you.">
        <p className="fine">Strength down the side, Defence across the top. “6/4” means a 6, then a 4+ on a second die.</p>
        <div className="chart-scroll">
          <table className="wound-chart">
            <thead>
              <tr>
                <th>S \ D</th>
                {Array.from({ length: 10 }, (_, i) => (
                  <th key={i}>{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, si) => (
                <tr key={si}>
                  <th>{si + 1}</th>
                  {Array.from({ length: 10 }, (_, di) => {
                    const n = woundNeed(si + 1, di + 1);
                    return <td key={di}>{n ? `${n.target}${n.then ? `/${n.then}` : ''}` : '–'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Topic>

      <Topic title="Fighting" app="the fight card pairs the fights, rolls the duel, spots trapped models, backs losers away and rolls the strikes.">
        <ul>
          <li>Every group of models in base contact fights. Each side rolls a D6 per Attack; the highest single die wins.</li>
          <li>Tie: the higher Fight value wins; if those match too, roll off.</li>
          <li>The loser backs away 1". One that can't is Trapped, and the winner rolls twice the strikes against it.</li>
          <li>The winner strikes once per Attack, rolling to wound with its Strength.</li>
          <li>Spear: supports a friend in front, adding its Attacks. Pike: can support through a second friend.</li>
          <li>Shield: shielding doubles your duel dice, but you can't strike if you win.</li>
          <li>Two-handed weapon: +1 to wound, −1 on the duel roll.</li>
        </ul>
      </Topic>

      <Topic title="Might, Will and Fate" app="the cards offer Might when it could change a roll, and ask for Fate when a hero is wounded.">
        <ul>
          <li>
            <b>Might:</b> add 1 to a die the hero rolled, after seeing it. It also pays for heroic actions. It doesn't come back.
          </li>
          <li>
            <b>Will:</b> casts and resists magic, and adds 1 per point to a Courage test.
          </li>
          <li>
            <b>Fate:</b> when wounded, roll a D6 per point spent; each 4+ ignores the wound.
          </li>
          <li>A model with no Wounds left is removed as a casualty.</li>
        </ul>
      </Topic>

      <Topic title="Heroic actions" app="the turn guide asks each player in turn to declare or pass at the start of the Move, Shoot and Fight phases.">
        <p className="fine">Declared for 1 Might at the start of the phase, starting with the player without priority.</p>
        <ul className="heroics">
          {HEROIC_ACTIONS.map(h => (
            <li key={h.name}>
              <b>{h.name}</b> <span className="muted">({h.phase})</span> {h.text}
            </li>
          ))}
        </ul>
      </Topic>

      <Topic title="Courage" app="every Courage test is rolled the moment it's needed, and the turn guide warns when an army is Broken.">
        <ul>
          <li>Roll 2D6: if the total reaches the model's Courage (for example 7+), it passes.</li>
          <li>
            <b>Broken:</b> an army that has lost more than half its starting models. Each of its models tests when it activates, and flees on a fail.
          </li>
          <li>
            <b>Terror:</b> a model must pass a test to charge a terrifying enemy, or it can't charge or move that turn.
          </li>
          <li>
            <b>Stand Fast!:</b> a hero who passes lets friends within 6" who would test that phase pass too.
          </li>
        </ul>
      </Topic>

      <Topic title="Magic" app="the model card casts and the target is asked to resist; durations end by themselves.">
        <MagicReference />
      </Topic>

      <Topic title="Cavalry and monsters" app="charge bonuses, knock-downs, thrown riders and Brutal Power Attacks are offered and rolled for you.">
        <ul>
          <li>Riders move at their mount's speed. Difficult ground costs four times as much.</li>
          <li>A cavalry charge on infantry gives +1 Attack, and if it wins the foes are knocked to the ground (Trapped, double strikes).</li>
          <li>If a mount is slain or knocked down the rider is thrown and rolls on the Thrown Rider table (see Moving and terrain).</li>
          <li>Monsters with Monstrous Charge get the same charge bonus. A monster that wins may swap its strikes for a Brutal Power Attack, such as Hurl or Barge.</li>
        </ul>
      </Topic>

      <Topic title="Scenarios and winning" app="the table draws zones and objectives, keeps the VP score at the top and ends the game when the scenario says.">
        <ul>
          <li>The scenario sets deployment, objectives, when the game ends and how victory points are scored.</li>
          <li>Many games end once an army is down to a quarter of its starting models.</li>
        </ul>
        {COMMON_RULES.map(r => (
          <p key={r.id}>
            <b>{r.name}:</b> {r.summary}
          </p>
        ))}
      </Topic>

      <Topic title="Special rules A–Z" app="each unit's card lists its own rules with what they do.">
        <input className="help-find" placeholder="Find a rule, e.g. Terror" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a special rule" />
        <dl className="special-rules">
          {special.map(([name, text]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        {!special.length && <p className="fine">No rule matches.</p>}
      </Topic>
    </div>
  );
}
