import { scenarioById } from '../shared/scenarios.ts';
import { armyStatus } from '../shared/status.ts';
import { bannerFor } from '../shared/wargear.ts';
import { ResultReport } from './ResultReport.tsx';
import { MapsSection } from './Maps.tsx';
import { DEFAULT_HEIGHT, FLOORED, heightOf, isDifficult } from '../shared/sight.ts';
import { TERRAIN_GROUPS, TERRAIN_INFO, terrainRules } from '../shared/terrain.ts';
import { markerNotes } from '../shared/objects.ts';
import { breakable, DOORS } from '../shared/fortress.ts';
import { useRef, useState } from 'react';
import { objectiveMarkers, river, STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { loadCatalog, parseBuilderExport, STAT_NAMES, statsWithOptions } from '../shared/catalog.ts';
import { deployList, newId, parseList, type ListEntry } from '../shared/importList.ts';
import { addSavedList, ListBuilder, loadSaved, SavedLists, Portrait, useCatalog } from './ListBuilder.tsx';
import { PREMADE, premadeRoster } from '../shared/premade.ts';
import { listEntries } from '../shared/warbands.ts';
import { botRoster, playableArmies } from '../shared/botList.ts';
import { parseAdmiral } from '../shared/admiral.ts';
import { BOT_NAME, DOOR_TYPES, MATS, TERRAIN_KINDS, type Action, type DiceRoll, type DoorType, type GameState, type Mat, type Model, type Role, type Seat, type Terrain, type TerrainKind } from '../shared/types.ts';
import { BODY_FONTS, HEADING_FONTS, THEMES, type Settings } from './settings.ts';

type Dispatch = (a: Action) => void;

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="stepper">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} down`}>−</button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} up`}>+</button>
    </label>
  );
}

function StatCard({ m }: { m: Model }) {
  const { catalog } = useCatalog();
  const unit = m.profileId ? catalog?.units[m.profileId] : undefined;
  if (!unit) return null;
  const optionIds = unit.options.filter(o => m.options?.includes(o.name)).map(o => o.id);
  const stats = statsWithOptions(unit, optionIds);
  return (
    <div className="stat-card">
      <div className="stat-head">
        <Portrait unit={unit} size={64} />
        <div>
          <small>{unit.type}</small>
          {m.options?.length ? <small>{m.options.join(', ')}</small> : null}
        </div>
      </div>
      {stats && (
        <table className="stats">
          <thead>
            <tr>{STAT_NAMES.map(n => <th key={n}>{n}</th>)}</tr>
          </thead>
          <tbody>
            <tr>{stats.map((v, i) => <td key={i}>{v}</td>)}</tr>
          </tbody>
        </table>
      )}
      {unit.wargear.length > 0 && <p className="muted"><b>Wargear:</b> {unit.wargear.join(', ')}</p>}
      {unit.rules.length > 0 && <p className="muted"><b>Rules:</b> {unit.rules.join(', ')}</p>}
    </div>
  );
}

export function SelectionPanel({ state, selected, dispatch }: { state: GameState; selected: Set<string>; dispatch: Dispatch; clear: () => void }) {
  const { catalog } = useCatalog();
  const ms = [...selected].map(id => state.models[id]).filter((m): m is Model => Boolean(m));
  if (ms.length === 0) return <p className="hint">Tap a model to select it. In Select mode, drag a box to pick a group.</p>;

  // The game keeps wounds, Might, Will and Fate, casualties and bases right, so this only shows what models are.
  if (ms.length > 1) {
    return (
      <div className="panel-body">
        <h3>{ms.length} models selected</h3>
        {ms.map(m => (
          <StatCard key={m.id} m={m} />
        ))}
      </div>
    );
  }

  const m = ms[0];
  const patch = (p: Partial<Model>) => dispatch({ type: 'updateModel', id: m.id, patch: p });
  const fromList = !!(m.profileId && catalog?.units[m.profileId]);
  // A model from a pasted text list has no profile: its owner fills in its stats before the battle.
  const editable = !fromList && !state.flow.started;
  return (
    <div className="panel-body">
      {editable ? <input className="name-input" value={m.name} onChange={e => patch({ name: e.target.value })} aria-label="Model name" /> : <h3>{m.name}</h3>}
      <StatCard m={m} />
      {editable && (
        <>
          <div className="row muted">
            <label className="check">
              <input type="checkbox" checked={m.hero} onChange={e => patch({ hero: e.target.checked })} /> Hero
            </label>
          </div>
          <Stepper label="Move" value={m.move} min={0} max={24} onChange={v => patch({ move: v })} />
          <Stepper label="Wounds" value={m.maxWounds} min={1} max={30} onChange={v => patch({ maxWounds: v, wounds: v })} />
          {m.hero && (
            <>
              <Stepper label="Might" value={m.might} min={0} max={9} onChange={v => patch({ might: v })} />
              <Stepper label="Will" value={m.will} min={0} max={9} onChange={v => patch({ will: v })} />
              <Stepper label="Fate" value={m.fate} min={0} max={9} onChange={v => patch({ fate: v })} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One roll in the shared log, including follow-up dice for 6+/4+ style wounds. */
/** One roll in the dice log. With `dispatch`, a hero's player can spend its Might to raise its own dice. */
/** `delay` holds a fresh roll back that long (ms) before it shows, when it comes in with others. */
export function RollRow({ r, state, role, dispatch, delay = 0 }: { r: DiceRoll; state: GameState; role?: Role; dispatch?: Dispatch; delay?: number }) {
  const hits = r.target ? r.dice.filter(d => d >= r.target!).length : null;
  const wounds = r.then && r.follow ? r.follow.filter(d => d >= r.then!).length : null;
  const hero = r.model ? state.models[r.model] : undefined;
  const pause = state.flow.shotPause;
  const shot = r.group?.startsWith('s-');
  // A shot's dice can be raised only while the shot waits on them: the last roll of the shot that stopped.
  const paused = !!pause && pause.group === r.group && state.log.filter(x => x.group === r.group).at(-1)?.id === r.id;
  const mine = !!dispatch && !!hero && hero.hero && !hero.dead && hero.owner === role && (!shot || paused);
  const might = mine && hero!.might > 0;
  // A friendly banner nearby lets a side re-roll one die of a duel it isn't winning.
  const { catalog } = useCatalog();
  const flag = !!dispatch && role !== undefined && role !== 'spectator' ? bannerFor(state, catalog, r, role) : undefined;
  // A Courage test can be raised with Will as well as Might.
  const will = mine && hero!.will > 0 && r.sum !== undefined && /^Courage/.test(r.label);
  // Dice from a roll made in the last moment tumble before they land.
  const [fresh] = useState(() => Date.now() - r.at < 2500 + delay);
  const die = (d: number, i: number, target: number | undefined, follow: boolean) => (
    <span key={i} className="die-wrap">
      <span className={`die ${target ? (d >= target ? 'hit' : 'miss') : ''} ${fresh ? 'tumble' : ''}`} style={fresh ? { animationDelay: `${delay + (follow ? r.dice.length + i : i) * 45}ms` } : undefined}>
        {d}
      </span>
      {might && d < 6 && follow === (wounds !== null) && (
        <button className="might" onClick={() => dispatch!({ type: 'useMight', roll: r.id, die: i, ...(follow ? { follow: true } : {}) })} title={`Spend 1 of ${hero!.name}'s ${hero!.might} Might to make this a ${d + 1}`}>
          +1
        </button>
      )}
      {flag && !follow && (
        <button className="might banner" onClick={() => dispatch!({ type: 'banner', roll: r.id, die: i })} title={`Re-roll this die with ${flag.name}'s banner (once per side in this fight)`}>
          ↻
        </button>
      )}
      {will && d < 6 && !follow && (
        <button className="might will" onClick={() => dispatch!({ type: 'useMight', roll: r.id, die: i, will: true })} title={`Spend 1 of ${hero!.name}'s ${hero!.will} Will to make this a ${d + 1}`}>
          +1 W
        </button>
      )}
    </span>
  );
  const total = r.dice.reduce((a, b) => a + b, 0);
  return (
    <li className={`${r.by} ${fresh && delay ? 'reveal' : ''}`} style={fresh && delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className="log-head">
        <b>{r.by === 'spectator' ? 'Spectator' : state.names[r.by] || (r.by === 'p1' ? 'Player 1' : 'Player 2')}</b>
        <span>{r.label}</span>
        {r.might ? <span className="might-tag">+{r.might} Might</span> : null}
      </div>
      {r.dice.length > 0 && (
        <div className="dice">
          {r.dice.map((d, i) => die(d, i, r.target, false))}
          {wounds === null && hits !== null && <span className="hits">{hits} success{hits === 1 ? '' : 'es'}</span>}
          {r.dice.length > 1 && hits === null && <span className="hits">{r.group ? `best ${Math.max(...r.dice)}` : `total ${total}`}</span>}
          {r.sum !== undefined && <b className={total >= r.sum ? 'pass' : 'fail'}>{total >= r.sum ? `passed (${r.sum}+)` : `failed (${r.sum}+)`}</b>}
        </div>
      )}
      {wounds !== null && (
        <div className="dice follow">
          <span className="muted">then {r.then}+:</span>
          {r.follow!.map((d, i) => die(d, i, r.then, true))}
          <span className="hits">{wounds} success{wounds === 1 ? '' : 'es'}</span>
        </div>
      )}
      {r.note && <div className="roll-note">{r.note}</div>}
      {paused && dispatch && hero?.owner === role && (
        <button className="primary small" onClick={() => dispatch({ type: 'shotOn', group: r.group! })}>
          Carry on with the shot
        </button>
      )}
    </li>
  );
}

/** Every roll made this game, newest first. The game makes the rolls itself, so there is nothing to roll here. */
export function DicePanel({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  return (
    <div className="panel-body">
      <p className="hint">The game rolls every fight, shot, test and Fate roll for you, and they all appear here.</p>
      {!state.log.length && <p className="muted">No rolls yet.</p>}
      <ol className="log">
        {[...state.log].reverse().map(r => (
          <RollRow key={r.id} r={r} state={state} role={role} dispatch={dispatch} />
        ))}
      </ol>
    </div>
  );
}

/** In a solo game: the opponent's army, a ready-made one, a random one from any army, or one of your own lists. Once. */
function OpponentArmy({ state, dispatch, seat }: { state: GameState; dispatch: Dispatch; seat: Seat }) {
  const { catalog } = useCatalog();
  const [pick, setPick] = useState(PREMADE[6].id);
  const mine = Object.values(state.models).filter(m => m.owner !== seat).reduce((n, m) => n + (m.points ?? 0), 0);
  const [points, setPoints] = useState(() => (mine > 0 ? Math.max(200, Math.round(mine / 50) * 50) : 500));
  const theirs = Object.values(state.models).filter(m => m.owner === seat);
  if (!catalog) return <p className="hint">Loading armies…</p>;
  const armies = playableArmies(catalog);
  const lists = loadSaved().filter(r => r.entries.length);
  const fromList = pick.startsWith('list:');
  const deploy = () => {
    let entries: ListEntry[];
    let name: string;
    if (fromList) {
      const roster = lists.find(r => `list:${r.id}` === pick);
      if (!roster) return;
      entries = listEntries(roster, catalog).flatMap(g => g.entries);
      name = roster.name;
    } else {
      const premade = PREMADE.find(p => p.id === pick);
      const army = premade?.army ?? (pick.startsWith('army:') ? pick.slice(5) : armies[Math.floor(Math.random() * armies.length)]);
      const roster = premade ? premadeRoster(catalog, premade.id, points)! : botRoster(catalog, army, points);
      entries = listEntries(roster, catalog).flatMap(g => g.entries);
      name = premade?.name ?? army;
    }
    dispatch({ type: 'addModels', models: deployList(entries, seat, state, scenarioById(state.scenario)) });
    dispatch({ type: 'setName', seat, name: `${BOT_NAME} (${name})` });
  };
  if (theirs.length)
    return (
      <div className="computer-army">
        <h4>{BOT_NAME}'s army</h4>
        <p>
          {state.names[seat]}: {theirs.length} models, {theirs.reduce((n, m) => n + (m.points ?? 0), 0)} pts, deployed.
        </p>
        {!state.flow.started && <button onClick={() => dispatch({ type: 'removeModels', ids: theirs.map(m => m.id) })}>Pick a different army</button>}
      </div>
    );
  return (
    <div className="computer-army">
      <h4>{BOT_NAME}'s army</h4>
      <div className="row wrap">
        <select value={pick} onChange={e => setPick(e.target.value)} aria-label={`${BOT_NAME}'s army`}>
          <optgroup label="Ready-made armies">
            {PREMADE.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.army})
              </option>
            ))}
          </optgroup>
          {lists.length > 0 && (
            <optgroup label="Your lists">
              {lists.map(r => (
                <option key={r.id} value={`list:${r.id}`}>
                  {r.name} ({r.army})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="A random list from">
            <option value="random">Any army</option>
            {armies.map(a => (
              <option key={a} value={`army:${a}`}>
                {a}
              </option>
            ))}
          </optgroup>
        </select>
        {!fromList && (
          <label className="mini-stat">
            Points
            <input className="points" type="number" min={100} max={2000} step={50} value={points} onChange={e => setPoints(Math.max(100, Math.min(2000, Number(e.target.value) || 500)))} />
          </label>
        )}
        <button className="primary" disabled={state.flow.started} onClick={deploy}>
          Deploy its army
        </button>
      </div>
    </div>
  );
}

/** One of the ready-made armies, at the points the player picks: the same list every time for a given size. */
function ReadyMade({ state, owner, onDeploy }: { state: GameState; owner: Seat; onDeploy: (entries: ListEntry[], note: string) => void }) {
  const { catalog } = useCatalog();
  const [pick, setPick] = useState(PREMADE[0].id);
  // Match the other side's army if it's already on the table.
  const theirs = Object.values(state.models).filter(m => m.owner !== owner).reduce((n, m) => n + (m.points ?? 0), 0);
  const [points, setPoints] = useState(() => (theirs > 0 ? Math.max(200, Math.round(theirs / 50) * 50) : 500));
  if (!catalog) return <p className="hint">Loading armies…</p>;
  const premade = PREMADE.find(p => p.id === pick)!;
  const deploy = () => {
    const roster = premadeRoster(catalog, premade.id, points);
    if (roster) onDeploy(listEntries(roster, catalog).flatMap(g => g.entries), ` ${premade.name} (${premade.army}), about ${points} pts.`);
  };
  return (
    <>
      <p className="hint">No list to hand? Pick a premade army and how many points to play, and it goes straight on the table.</p>
      <select className="ready-made" value={pick} onChange={e => setPick(e.target.value)} aria-label="Premade army">
          <optgroup label="Good">
            {PREMADE.filter(p => p.seed < 20).map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.army})
              </option>
            ))}
          </optgroup>
          <optgroup label="Evil">
            {PREMADE.filter(p => p.seed >= 20).map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.army})
              </option>
            ))}
          </optgroup>
      </select>
      <div className="row wrap">
        <label className="mini-stat">
          Points
          <input className="points" type="number" min={100} max={2000} step={50} value={points} onChange={e => setPoints(Math.max(100, Math.min(2000, Number(e.target.value) || 500)))} />
        </label>
        <button className="primary" onClick={deploy}>
          Deploy for {state.names[owner] || (owner === 'p1' ? 'Player 1' : 'Player 2')}
        </button>
      </div>
    </>
  );
}

export function ArmyPanel({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  const [text, setText] = useState('');
  // Each player deploys only their own army (in a solo game, the opponent's is picked above).
  const owner: Seat = role === 'p2' ? 'p2' : 'p1';
  /** Seats deploying one warband at a time, who can keep adding warbands. */
  const [byWarband, setByWarband] = useState<Set<Seat>>(new Set());
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'lists' | 'ready' | 'build' | 'import'>('lists');
  const fileRef = useRef<HTMLInputElement>(null);

  const deploy = (entries: ListEntry[], note = '', warband = false) => {
    if (onTable(owner) && !(warband && byWarband.has(owner))) return;
    if (warband) setByWarband(prev => new Set(prev).add(owner));
    const count = entries.reduce((a, e) => a + e.count, 0);
    dispatch({ type: 'addModels', models: deployList(entries, owner, state, scenarioById(state.scenario)) });
    setMessage(`Deployed ${count === 1 ? '1 model' : `${count} models`} for ${state.names[owner] || (owner === 'p1' ? 'Player 1' : 'Player 2')}.${note}`);
  };

  const importText = async (input: string) => {
    const catalog = await loadCatalog();
    // Tabletop Admiral's TTS view: becomes one of your saved lists, then goes on the table.
    const admiral = parseAdmiral(input, catalog, () => newId('e'));
    if (admiral) {
      if (!admiral.entries.length) {
        setMessage("That looks like a Tabletop Admiral list, but I couldn't match any of its profiles.");
        return;
      }
      const roster = addSavedList({ name: `${admiral.army} (Tabletop Admiral)`, army: admiral.army, entries: admiral.entries });
      const note = admiral.missing.length ? ` Skipped what I couldn't match: ${admiral.missing.join(', ')}.` : '';
      deploy(listEntries(roster, catalog).flatMap(g => g.entries), ` It's saved in My lists as ${admiral.army}.${note}`);
      setText('');
      return;
    }
    const exported = parseBuilderExport(input, catalog);
    if (exported) {
      if (!exported.entries.length) {
        setMessage("That export didn't contain any units I recognise.");
        return;
      }
      const note = exported.missing.length ? ` ${exported.missing.length} unit(s) weren't recognised and were skipped.` : '';
      deploy(exported.entries, note);
      setText('');
      return;
    }
    const entries = parseList(input);
    if (!entries.reduce((a, e) => a + e.count, 0)) {
      setMessage("Couldn't find any models in that list. Upload the list builder's .json export, or paste lines like \"12x Warrior of Minas Tirith\".");
      return;
    }
    deploy(entries, ' Check bases and stats: a pasted text list has no profile data.');
    setText('');
  };

  const onFile = async (f: File | undefined) => {
    if (f) importText(await f.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  const casualties = Object.values(state.models).filter(m => m.dead);
  const alive = (seat: Seat) => Object.values(state.models).filter(m => m.owner === seat && !m.dead).length;
  const total = (seat: Seat) => Object.values(state.models).filter(m => m.owner === seat).length;
  const onTable = (seat: Seat) => total(seat) > 0;
  const seatName = (seat: Seat) => state.names[seat] || (seat === 'p1' ? 'Player 1' : 'Player 2');
  // Each army goes on the table once; clearing it before the battle lets you pick another.
  const locked = onTable(owner) && !byWarband.has(owner);

  return (
    <div className="panel-body">
      {role === 'spectator' && <p className="hint">Spectators can watch but can't deploy armies. Pick a player seat in the top bar to join in.</p>}
      {state.bot && role !== 'spectator' && <OpponentArmy state={state} dispatch={dispatch} seat={state.bot} />}
      {role !== 'spectator' && locked ? (
        <div className="deployed">
          {state.bot && <h4>Your army</h4>}
          <p>
            {seatName(owner)}'s army is on the table: {total(owner)} models, {Object.values(state.models).filter(m => m.owner === owner).reduce((n, m) => n + (m.points ?? 0), 0)} pts.
          </p>
          {!state.flow.started && (
            <button onClick={() => dispatch({ type: 'removeModels', ids: Object.values(state.models).filter(m => m.owner === owner).map(m => m.id) })}>
              Take it off to deploy a different army
            </button>
          )}
        </div>
      ) : (
        <>
          {state.bot && role !== 'spectator' && <h4>Your army</h4>}
        <div className="row seg">
          <button className={mode === 'lists' ? 'on' : ''} onClick={() => setMode('lists')}>My lists</button>
          <button className={mode === 'ready' ? 'on' : ''} onClick={() => setMode('ready')}>Premade</button>
          <button className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>Build</button>
          <button className={mode === 'import' ? 'on' : ''} onClick={() => setMode('import')}>Import</button>
        </div>
        {message && <p className="hint">{message}</p>}
        {mode === 'lists' ? (
          <SavedLists onDeploy={(entries, _name, warband) => deploy(entries, '', warband)} onBuild={() => setMode('build')} />
        ) : mode === 'ready' ? (
          <ReadyMade key={owner} state={state} owner={owner} onDeploy={(entries, note) => deploy(entries, note)} />
        ) : mode === 'build' ? (
          <ListBuilder onDeploy={entries => deploy(entries)} deployLabel={`Deploy for ${state.names[owner] || (owner === 'p1' ? 'Player 1' : 'Player 2')}`} />
        ) : (
          <>
            <p className="hint">
              In the <a href="https://v2024.mesbg-list-builder.com/" target="_blank" rel="noreferrer">MESBG List Builder</a>, export your list as a file, then upload
              it here. From <a href="https://modular.tabletopadmiral.com/mesbg" target="_blank" rel="noreferrer">Tabletop Admiral</a>, open Tools, then TTS/JSON View, and paste
              what it shows. You can also paste a plain list.
            </p>
            <button onClick={() => fileRef.current?.click()}>Upload list file</button>
            <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={e => onFile(e.target.files?.[0])} />
            <textarea rows={5} placeholder={'Paste a list here, e.g.\nCaptain of Minas Tirith (70 pts)\n12x Warrior of Minas Tirith with shield'} value={text} onChange={e => setText(e.target.value)} />
            <button className="primary" disabled={!text.trim()} onClick={() => importText(text)}>Deploy list</button>
          </>
        )}
        </>
      )}

      <h4>Forces</h4>
      <p className="muted">
        {(['p1', 'p2'] as const).map(s => `${state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2')}: ${alive(s)}/${total(s)}`).join(' · ')}
        {(['p1', 'p2'] as const).some(s => armyStatus(state, s).broken) && <b className="broken"> · an army is Broken</b>}
      </p>

      {casualties.length > 0 && (
        <>
          <h4>Casualties</h4>
          <ul className="casualties">
            {casualties.map(m => (
              <li key={m.id} className={m.owner}>
                <span>{m.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const MAT_NAMES: Record<Mat, string> = {
  grass: 'Grassland',
  plains: 'Dry plains',
  forest: 'Forest floor',
  mud: 'Mud',
  dirt: 'Rocky wasteland',
  stone: 'Flagstones',
  snow: 'Snow',
  sand: 'Sand',
};

const TERRAIN_PRESETS: { label: string; t: Omit<Terrain, 'id' | 'x' | 'y' | 'locked'> }[] = [
  { label: 'Wood', t: { kind: 'wood', shape: 'circle', w: 8, h: 6, rot: 0 } },
  { label: 'Rocks', t: { kind: 'rock', shape: 'circle', w: 4, h: 3, rot: 0 } },
  { label: 'Hill', t: { kind: 'hill', shape: 'circle', w: 10, h: 7, rot: 0 } },
  { label: 'Building', t: { kind: 'building', shape: 'rect', w: 5, h: 4, rot: 0 } },
  { label: 'Wall', t: { kind: 'wall', shape: 'rect', w: 6, h: 0.5, rot: 0 } },
  { label: 'Water', t: { kind: 'water', shape: 'circle', w: 9, h: 4, rot: 0 } },
  { label: 'River', t: { ...river([[0, 0], [2.5, 6], [-1.5, 12], [1, 18], [0, 24]], 3.4), rot: 0 } },
  { label: 'Bridge', t: { kind: 'bridge', shape: 'rect', w: 7, h: 2.6, rot: 0 } },
  { label: 'Ruin', t: { kind: 'ruin', shape: 'rect', w: 4, h: 3, rot: 0 } },
  { label: 'Cliff', t: { kind: 'cliff', shape: 'circle', w: 6, h: 8, rot: 0 } },
  { label: 'Field', t: { kind: 'field', shape: 'rect', w: 8, h: 5, rot: 0 } },
  { label: 'Objective', t: { kind: 'objective', shape: 'circle', w: 1.6, h: 1.6, rot: 0 } },
  { label: 'Fortress wall', t: { kind: 'wall', shape: 'rect', w: 10, h: 1, rot: 0, height: 3, sheer: true } },
  { label: 'Fortress gate', t: { kind: 'gate', shape: 'rect', w: 4, h: 1, rot: 0, door: 'castle' } },
  { label: 'Door', t: { kind: 'gate', shape: 'rect', w: 1.5, h: 0.5, rot: 0, door: 'heavy', height: 2 } },
  { label: 'Siege Ladder', t: { kind: 'objective', shape: 'circle', w: 1, h: 1, rot: 0, object: 'ladder' } },
  { label: 'Battering ram', t: { kind: 'objective', shape: 'circle', w: 1, h: 1, rot: 0, object: 'ram' } },
  { label: 'Siege tower', t: { kind: 'tower', shape: 'rect', w: 4, h: 4, rot: 0 } },
  { label: 'Barricade', t: { kind: 'wall', shape: 'rect', w: 3, h: 0.8, rot: 0, height: 1, barricade: 'plain' } },
  { label: 'Spiked barricade', t: { kind: 'wall', shape: 'rect', w: 3, h: 0.8, rot: 0, height: 1, barricade: 'spiked' } },
  { label: 'Pile of rocks', t: { kind: 'objective', shape: 'circle', w: 1, h: 1, rot: 0, object: 'rocks' } },
  { label: 'Boiling oil', t: { kind: 'objective', shape: 'circle', w: 1.6, h: 1.6, rot: 0, object: 'oil' } },
  { label: 'Rallying point', t: { kind: 'objective', shape: 'circle', w: 1, h: 1, rot: 0, object: 'rally' } },
];

/** Markers that are siege gear rather than scenario objectives. */
const SIEGE_GEAR = new Set(['ladder', 'ram', 'rocks', 'oil', 'rally']);

/** Who holds a gate, or owns a ladder or ram: either player, or (for a gate) no one. */
function SidePicker({ state, value, onChange, none }: { state: GameState; value?: Seat; onChange: (s: Seat | undefined) => void; none?: string }) {
  return (
    <select value={value ?? ''} onChange={e => onChange((e.target.value || undefined) as Seat | undefined)}>
      {none && <option value="">{none}</option>}
      {(['p1', 'p2'] as const).map(seat => (
        <option key={seat} value={seat}>
          {state.names[seat] || (seat === 'p1' ? 'Player 1' : 'Player 2')}
        </option>
      ))}
    </select>
  );
}

export function TablePanel({
  state,
  dispatch,
  role,
  selectedTerrain,
  setSelectedTerrain,
  editor,
}: {
  state: GameState;
  dispatch: Dispatch;
  role: Role;
  selectedTerrain: string | null;
  setSelectedTerrain: (id: string | null) => void;
  /** In the map editor: just the terrain tools, without the game's save, load and finish options. */
  editor?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const t = selectedTerrain ? state.terrain[selectedTerrain] : undefined;
  const patch = (p: Partial<Terrain>) => t && dispatch({ type: 'updateTerrain', id: t.id, patch: p });

  const save = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mesbg-game-turn-${state.turn}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      dispatch({ type: 'loadState', state: JSON.parse(await f.text()) });
    } catch {
      alert("That file isn't a saved game.");
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const objectives = Object.values(state.terrain).filter(o => o.kind === 'objective' && !SIEGE_GEAR.has(o.object ?? ''));

  // Once the battle starts (and always for spectators) the table is fixed: it only shows what the pieces are.
  if (!editor && (state.flow.started || role === 'spectator'))
    return (
      <div className="panel-body">
        <p className="hint">{state.flow.started ? "The table is set: it can't change once the battle has started." : 'Only the players set up the table.'} Tap a piece of terrain to see how it plays.</p>
        {t && (
          <>
            <h4>{TERRAIN_INFO[t.kind].name}</h4>
            <ul className="terrain-rules">
              {(t.object ? markerNotes(t) : terrainRules(t)).map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
        <h4>Game</h4>
        <div className="row">
          <button onClick={save}>Save game</button>
        </div>
        {state.flow.started && !state.result && role !== 'spectator' && (
          <details className="finish">
            <summary>Finish the game early</summary>
            <ResultReport state={state} role={role} dispatch={dispatch} early />
          </details>
        )}
      </div>
    );

  return (
    <div className="panel-body">
      <h4>Starter boards</h4>
      <div className="boards">
        {STARTER_BOARDS.map(b => (
          <button
            key={b.id}
            onClick={() => {
              if (Object.keys(state.terrain).length && !confirm(`Replace the current terrain with ${b.name}? Models stay where they are.`)) return;
              dispatch({ type: 'setScenery', w: b.w, h: b.h, mat: b.mat, terrain: starterTerrain(b, newId) });
              setSelectedTerrain(null);
            }}
          >
            <b>{b.name}</b>
            <small>{b.blurb}</small>
          </button>
        ))}
      </div>
      {!editor && <MapsSection state={state} dispatch={dispatch} onLoaded={() => setSelectedTerrain(null)} />}
      <label>
        Ground
        <select value={state.board.mat} onChange={e => dispatch({ type: 'setBoard', w: state.board.w, h: state.board.h, mat: e.target.value as Mat })}>
          {MATS.map(m => (
            <option key={m} value={m}>
              {MAT_NAMES[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        {objectives.length ? (
          <button onClick={() => objectives.forEach(o => dispatch({ type: 'removeTerrain', id: o.id }))}>Remove objective markers</button>
        ) : (
          <button onClick={() => objectiveMarkers(state.board.w, state.board.h, newId).forEach(o => dispatch({ type: 'addTerrain', terrain: o }))}>
            Place 5 objectives
          </button>
        )}
      </div>

      <h4>Add terrain</h4>
      {TERRAIN_GROUPS.map(g => {
        const presets = TERRAIN_PRESETS.filter(p => TERRAIN_INFO[p.t.kind].type === g);
        if (!presets.length) return null;
        return (
          <div key={g} className="terrain-group">
            <small>{g}</small>
            <div className="row wrap">
              {presets.map(p => (
                <button
                  key={p.label}
                  title={TERRAIN_INFO[p.t.kind].note}
                  onClick={() => {
                    const id = newId('t');
                    dispatch({ type: 'addTerrain', terrain: { ...p.t, id, x: state.board.w / 2, y: state.board.h / 2, locked: false } });
                    setSelectedTerrain(id);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {t && (
        <>
          <h4>Selected terrain</h4>
          <label>
            Type
            <select value={t.kind} onChange={e => patch({ kind: e.target.value as TerrainKind, difficult: undefined })}>
              {TERRAIN_GROUPS.map(g => (
                <optgroup key={g} label={g}>
                  {TERRAIN_KINDS.filter(k => TERRAIN_INFO[k].type === g).map(k => (
                    <option key={k} value={k}>
                      {TERRAIN_INFO[k].name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <ul className="terrain-rules">
            {terrainRules(t).map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Stepper label="Width" value={Math.round(t.w)} min={1} max={48} onChange={v => patch({ w: v })} />
          <Stepper label="Depth" value={Math.round(t.h)} min={1} max={48} onChange={v => patch({ h: v })} />
          {DEFAULT_HEIGHT[t.kind] !== undefined && <Stepper label="Height" value={Math.round(heightOf(t))} min={0} max={12} onChange={v => patch({ height: v })} />}
          {FLOORED.has(t.kind) && <Stepper label="Floors inside" value={t.floors ?? 0} min={0} max={6} onChange={v => patch({ floors: v })} />}
          {t.kind === 'gate' && (
            <>
              <label>
                Kind
                <select value={t.door ?? 'castle'} onChange={e => patch({ door: e.target.value as DoorType, wounds: undefined })}>
                  {DOOR_TYPES.map(k => (
                    <option key={k} value={k}>
                      {DOORS[k].name} (Defence {DOORS[k].d}, {DOORS[k].w} Wound{DOORS[k].w === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Held by
                <SidePicker state={state} value={t.side} onChange={side => patch({ side })} none="No one (shut to both sides)" />
              </label>
              {t.gone ? (
                <button onClick={() => patch({ gone: undefined, wounds: undefined, by: undefined })}>Put the gate back up</button>
              ) : (
                <Stepper label="Wounds left" value={t.wounds ?? DOORS[t.door ?? 'castle'].w} min={1} max={DOORS[t.door ?? 'castle'].w} onChange={v => patch({ wounds: v })} />
              )}
            </>
          )}
          {t.kind === 'wall' && (
            <label>
              Barricade
              <select value={t.barricade ?? ''} onChange={e => patch({ barricade: (e.target.value || undefined) as Terrain['barricade'], wounds: undefined, gone: undefined })}>
                <option value="">No, a wall</option>
                <option value="plain">Barricade (Defence 7, 2 Wounds)</option>
                <option value="spiked">Spiked barricade</option>
              </select>
            </label>
          )}
          {(t.kind === 'tower' || t.barricade) && (
            <>
              {t.kind === 'tower' && (
                <label>
                  Belongs to
                  <SidePicker state={state} value={t.side} onChange={side => patch({ side })} none="Either side" />
                </label>
              )}
              {t.gone ? (
                <button onClick={() => patch({ gone: undefined, wounds: undefined, by: undefined })}>Repair it</button>
              ) : (
                <Stepper label="Wounds left" value={breakable(t)?.left ?? 1} min={1} max={breakable(t)?.w ?? 1} onChange={v => patch({ wounds: v })} />
              )}
            </>
          )}
          {(t.object === 'ladder' || t.object === 'ram' || t.object === 'rocks' || t.object === 'oil' || t.object === 'rally') && (
            <label>
              Belongs to
              <SidePicker state={state} value={t.side} onChange={side => patch({ side })} none="Either side" />
            </label>
          )}
          {(t.kind === 'wall' || t.kind === 'building' || t.kind === 'rock' || t.kind === 'cliff') && (
            <label className="check">
              <input type="checkbox" checked={!!t.sheer} onChange={e => patch({ sheer: e.target.checked })} /> Sheer (needs a Siege Ladder to climb)
            </label>
          )}
          <div className="row">
            <button onClick={() => patch({ rot: t.rot - 15 })}>⟲ 15°</button>
            <button onClick={() => patch({ rot: t.rot + 15 })}>⟳ 15°</button>
            <button onClick={() => patch({ shape: t.shape === 'rect' ? 'circle' : 'rect' })}>{t.shape === 'rect' ? 'Make round' : 'Make square'}</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={isDifficult(t)} onChange={e => patch({ difficult: e.target.checked })} /> Difficult terrain (moving through it costs double)
          </label>
          <div className="row">
            <button onClick={() => patch({ locked: !t.locked })}>{t.locked ? 'Unlock' : 'Lock in place'}</button>
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: 'removeTerrain', id: t.id });
                setSelectedTerrain(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
      {Object.values(state.terrain).some(x => x.locked) && (
        <button onClick={() => Object.values(state.terrain).forEach(x => x.locked && dispatch({ type: 'updateTerrain', id: x.id, patch: { locked: false } }))}>
          Unlock all terrain
        </button>
      )}

      <h4>Board</h4>
      <div className="row wrap">
        {[
          [48, 48],
          [72, 48],
          [24, 24],
        ].map(([w, h]) => (
          <button key={`${w}x${h}`} className={state.board.w === w && state.board.h === h ? 'on' : ''} onClick={() => dispatch({ type: 'setBoard', w, h })}>
            {w}"×{h}"
          </button>
        ))}
      </div>

      {!editor && (
        <>
          <h4>Game</h4>
          <div className="row">
            <button onClick={save}>Save game</button>
            <button onClick={() => fileRef.current?.click()}>Load game</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => load(e.target.files?.[0])} />
          </div>
          {state.flow.started && !state.result && role !== 'spectator' && (
            <details className="finish">
              <summary>Finish the game early</summary>
              <ResultReport state={state} role={role} dispatch={dispatch} early />
            </details>
          )}
          <button
            className="danger"
            onClick={() => {
              if (confirm('Clear the whole table for both players?')) dispatch({ type: 'loadState', state: { ...state, models: {}, terrain: {}, turn: 1, phase: 'priority', priority: null } });
            }}
          >
            Clear table
          </button>
        </>
      )}
      {editor && Object.keys(state.terrain).length > 0 && (
        <button className="danger" onClick={() => confirm('Remove all the terrain?') && dispatch({ type: 'setScenery', w: state.board.w, h: state.board.h, mat: state.board.mat, terrain: [] })}>
          Clear all terrain
        </button>
      )}
    </div>
  );
}

export function SettingsPanel({ settings, update, game }: { settings: Settings; update: (p: Partial<Settings>) => void; game?: { state: GameState; dispatch: Dispatch; role: Role } }) {
  const click = game?.state.advance === 'click';
  return (
    <div className="panel-body">
      {game && (
        <>
          <h4>Moving on</h4>
          <div className="row" role="radiogroup" aria-label="Moving on to the next phase">
            {([false, true] as const).map(c => (
              <button key={String(c)} className={click === c ? 'on' : ''} aria-pressed={click === c} disabled={game.role === 'spectator'} onClick={() => game.dispatch({ type: 'setAdvance', click: c })}>
                {c ? 'When I click' : 'By itself'}
              </button>
            ))}
          </div>
          <p className="fine">
            {click ? 'Each phase waits until a player moves on, so the last move or fight can be looked over.' : 'A phase moves on as soon as both sides have finished it.'} This is for both players.
          </p>
        </>
      )}
      <p className="hint">{game ? 'The rest only changes' : 'These only change'} how the game looks for you.</p>
      <h4>Colour theme</h4>
      <div className="theme-swatches">
        {THEMES.map(t => (
          <button key={t.id} className={settings.theme === t.id ? 'on' : ''} onClick={() => update({ theme: t.id })} aria-pressed={settings.theme === t.id}>
            <span className="swatch">
              {[t.vars.bg, t.vars.panel, t.vars.gold, t.vars.p1, t.vars.p2].map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            {t.name}
          </button>
        ))}
      </div>

      <h4>Heading font</h4>
      <select value={settings.headingFont} onChange={e => update({ headingFont: e.target.value })} aria-label="Heading font">
        {HEADING_FONTS.map(f => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <p className="font-preview" style={{ fontFamily: HEADING_FONTS.find(f => f.id === settings.headingFont)?.css }}>
        The Battle of the Pelennor Fields
      </p>

      <h4>Text font</h4>
      <select value={settings.bodyFont} onChange={e => update({ bodyFont: e.target.value })} aria-label="Text font">
        {BODY_FONTS.map(f => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <p className="font-preview" style={{ fontFamily: BODY_FONTS.find(f => f.id === settings.bodyFont)?.css }}>
        Twelve warriors advance 6" towards the ford.
      </p>

      <h4>Table</h4>
      <label className="check">
        <input type="checkbox" checked={settings.photos} onChange={e => update({ photos: e.target.checked })} /> Unit photos on bases
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.names} onChange={e => update({ names: e.target.checked })} /> Unit names under models
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.terrainNames} onChange={e => update({ terrainNames: e.target.checked })} /> Terrain names on the table
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.animations} onChange={e => update({ animations: e.target.checked })} /> Animations (gliding moves, dice, hits and shots)
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.zones} onChange={e => update({ zones: e.target.checked })} /> Move and 1" control zones
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.deployment} onChange={e => update({ deployment: e.target.checked })} /> Scenario deployment zones
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.grid} onChange={e => update({ grid: e.target.checked })} /> 1" grid
      </label>
      <p className="fine">Fonts are open-licence (SIL OFL). Ground textures are from the open-source game <a href="https://play0ad.com/" target="_blank" rel="noreferrer">0 A.D.</a> by Wildfire Games (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>).</p>
    </div>
  );
}
