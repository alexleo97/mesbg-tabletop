import { armyStatus } from '../shared/status.ts';
import { ResultReport } from './ResultReport.tsx';
import { MapsSection } from './Maps.tsx';
import { isDifficult } from '../shared/sight.ts';
import { useRef, useState } from 'react';
import { objectiveMarkers, STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { loadCatalog, parseBuilderExport, STAT_NAMES, statsWithOptions } from '../shared/catalog.ts';
import { deployList, guessBase, newId, parseList, type ListEntry } from '../shared/importList.ts';
import { ListBuilder, Portrait, useCatalog } from './ListBuilder.tsx';
import { MATS, type Action, type Base, type DiceRoll, type GameState, type Mat, type Model, type Role, type Seat, type Terrain } from '../shared/types.ts';
import { BODY_FONTS, HEADING_FONTS, THEMES, type Settings } from './settings.ts';

type Dispatch = (a: Action) => void;

const BASE_PRESETS: { label: string; base: Base }[] = [
  { label: '25mm round', base: { shape: 'round', w: 25, h: 25 } },
  { label: '32mm round', base: { shape: 'round', w: 32, h: 32 } },
  { label: '40mm round', base: { shape: 'round', w: 40, h: 40 } },
  { label: '50mm round', base: { shape: 'round', w: 50, h: 50 } },
  { label: '60mm round', base: { shape: 'round', w: 60, h: 60 } },
  { label: '25×50mm cavalry', base: { shape: 'rect', w: 25, h: 50 } },
  { label: '60×35mm oval', base: { shape: 'oval', w: 35, h: 60 } },
  { label: '105×165mm Mûmak', base: { shape: 'rect', w: 105, h: 165 } },
];

const baseKey = (b: Base) => `${b.shape}:${b.w}x${b.h}`;

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

export function SelectionPanel({ state, selected, dispatch, clear }: { state: GameState; selected: Set<string>; dispatch: Dispatch; clear: () => void }) {
  const ms = [...selected].map(id => state.models[id]).filter((m): m is Model => Boolean(m));
  if (ms.length === 0) return <p className="hint">Tap a model to select it. In Select mode, drag a box to pick a group.</p>;

  const rotate = (d: number) => dispatch({ type: 'moveModels', moves: ms.map(m => ({ id: m.id, x: m.x, y: m.y, rot: m.rot + d })) });
  const remove = () => {
    dispatch({ type: 'removeModels', ids: ms.map(m => m.id) });
    clear();
  };
  const kill = () => {
    for (const m of ms) dispatch({ type: 'updateModel', id: m.id, patch: { dead: true } });
    clear();
  };
  const setBase = (key: string) => {
    const preset = BASE_PRESETS.find(p => baseKey(p.base) === key);
    if (preset) for (const m of ms) dispatch({ type: 'updateModel', id: m.id, patch: { base: preset.base } });
  };

  if (ms.length > 1) {
    return (
      <div className="panel-body">
        <h3>{ms.length} models selected</h3>
        <div className="row">
          <button onClick={() => rotate(-45)}>⟲ Turn</button>
          <button onClick={() => rotate(45)}>⟳ Turn</button>
        </div>
        <label>
          Base
          <select value="" onChange={e => setBase(e.target.value)}>
            <option value="">Set base for all…</option>
            {BASE_PRESETS.map(p => (
              <option key={p.label} value={baseKey(p.base)}>{p.label}</option>
            ))}
          </select>
        </label>
        <div className="row">
          <button onClick={kill}>☠ Casualties</button>
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
    );
  }

  const m = ms[0];
  const patch = (p: Partial<Model>) => dispatch({ type: 'updateModel', id: m.id, patch: p });
  return (
    <div className="panel-body">
      <input className="name-input" value={m.name} onChange={e => patch({ name: e.target.value })} aria-label="Model name" />
      <StatCard m={m} />
      <div className="row muted">
        <span>{m.owner === 'p1' ? 'Player 1' : 'Player 2'}</span>
        <label className="check">
          <input type="checkbox" checked={m.hero} onChange={e => patch({ hero: e.target.checked })} /> Hero
        </label>
      </div>
      <Stepper label="Move" value={m.move} min={0} max={24} onChange={v => patch({ move: v })} />
      <Stepper label="Wounds" value={m.wounds} min={0} max={m.maxWounds} onChange={v => patch({ wounds: v })} />
      <Stepper label="Max wounds" value={m.maxWounds} min={1} max={30} onChange={v => patch({ maxWounds: v, wounds: m.wounds === m.maxWounds ? v : Math.min(m.wounds, v) })} />
      {m.hero && (
        <>
          <Stepper label="Might" value={m.might} min={0} max={9} onChange={v => patch({ might: v })} />
          <Stepper label="Will" value={m.will} min={0} max={9} onChange={v => patch({ will: v })} />
          <Stepper label="Fate" value={m.fate} min={0} max={9} onChange={v => patch({ fate: v })} />
        </>
      )}
      <label>
        Base
        <select value={baseKey(m.base)} onChange={e => setBase(e.target.value)}>
          {!BASE_PRESETS.some(p => baseKey(p.base) === baseKey(m.base)) && <option value={baseKey(m.base)}>{`${m.base.w}×${m.base.h}mm`}</option>}
          {BASE_PRESETS.map(p => (
            <option key={p.label} value={baseKey(p.base)}>{p.label}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <button onClick={() => rotate(-45)}>⟲ Turn</button>
        <button onClick={() => rotate(45)}>⟳ Turn</button>
      </div>
      <div className="row">
        <button onClick={kill}>☠ Casualty</button>
        <button className="danger" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

/** One roll in the shared log, including follow-up dice for 6+/4+ style wounds. */
/** One roll in the dice log. With `dispatch`, a hero's player can spend its Might to raise its own dice. */
export function RollRow({ r, state, role, dispatch }: { r: DiceRoll; state: GameState; role?: Role; dispatch?: Dispatch }) {
  const hits = r.target ? r.dice.filter(d => d >= r.target!).length : null;
  const wounds = r.then && r.follow ? r.follow.filter(d => d >= r.then!).length : null;
  const hero = r.model ? state.models[r.model] : undefined;
  const might = !!dispatch && !!hero && hero.hero && !hero.dead && hero.might > 0 && hero.owner === role;
  const die = (d: number, i: number, target: number | undefined, follow: boolean) => (
    <span key={i} className="die-wrap">
      <span className={`die ${target ? (d >= target ? 'hit' : 'miss') : ''}`}>{d}</span>
      {might && d < 6 && follow === (wounds !== null) && (
        <button className="might" onClick={() => dispatch!({ type: 'useMight', roll: r.id, die: i, ...(follow ? { follow: true } : {}) })} title={`Spend 1 of ${hero!.name}'s ${hero!.might} Might to make this a ${d + 1}`}>
          +1
        </button>
      )}
    </span>
  );
  const total = r.dice.reduce((a, b) => a + b, 0);
  return (
    <li className={r.by}>
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
    </li>
  );
}

export function DicePanel({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  const [count, setCount] = useState(1);
  const [target, setTarget] = useState<number | ''>('');
  const [label, setLabel] = useState('');
  const logRef = useRef<HTMLOListElement>(null);
  const roll = (n = count, t: number | '' = target, l = label) =>
    dispatch({ type: 'roll', count: n, target: t === '' ? undefined : t, label: l || `${n}D6${t ? ` (${t}+)` : ''}` });

  return (
    <div className="panel-body">
      {role === 'spectator' && <p className="hint">Spectators can watch rolls but not make them.</p>}
      <div className="row">
        <Stepper label="Dice" value={count} min={1} max={60} onChange={setCount} />
      </div>
      <div className="row targets">
        <span>Need</span>
        {[2, 3, 4, 5, 6].map(t => (
          <button key={t} className={target === t ? 'on' : ''} onClick={() => setTarget(target === t ? '' : t)}>{t}+</button>
        ))}
      </div>
      <input placeholder="What's this roll for? (optional)" value={label} onChange={e => setLabel(e.target.value)} />
      <button className="primary" disabled={role === 'spectator'} onClick={() => roll()}>Roll {count}D6</button>
      <div className="row quick">
        <button disabled={role === 'spectator'} onClick={() => roll(1, '', 'In the Way')}>In the Way</button>
        <button disabled={role === 'spectator'} onClick={() => roll(1, '', 'Courage')}>D6</button>
        <button disabled={role === 'spectator'} onClick={() => roll(2, '', 'Courage test')}>Courage (2D6)</button>
      </div>
      <ol className="log" ref={logRef}>
        {[...state.log].reverse().map(r => (
          <RollRow key={r.id} r={r} state={state} role={role} dispatch={dispatch} />
        ))}
      </ol>
    </div>
  );
}

export function ArmyPanel({ state, dispatch, role }: { state: GameState; dispatch: Dispatch; role: Role }) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState<Seat>(role === 'p2' ? 'p2' : 'p1');
  const [message, setMessage] = useState('');
  const [single, setSingle] = useState('');
  const [mode, setMode] = useState<'build' | 'import'>('build');
  const fileRef = useRef<HTMLInputElement>(null);

  const deploy = (entries: ListEntry[], note = '') => {
    const count = entries.reduce((a, e) => a + e.count, 0);
    dispatch({ type: 'addModels', models: deployList(entries, owner, state) });
    setMessage(`Deployed ${count} models for ${state.names[owner] || (owner === 'p1' ? 'Player 1' : 'Player 2')}.${note}`);
  };

  const importText = async (input: string) => {
    const exported = parseBuilderExport(input, await loadCatalog());
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

  const addOne = () => {
    if (!single.trim()) return;
    const models = deployList([{ name: single.trim(), count: 1, hero: false }], owner, state);
    dispatch({ type: 'addModels', models });
    setSingle('');
  };

  const casualties = Object.values(state.models).filter(m => m.dead);
  const alive = (seat: Seat) => Object.values(state.models).filter(m => m.owner === seat && !m.dead).length;
  const total = (seat: Seat) => Object.values(state.models).filter(m => m.owner === seat).length;

  return (
    <div className="panel-body">
      <div className="row seg">
        {(['p1', 'p2'] as const).map(s => (
          <button key={s} className={owner === s ? 'on' : ''} onClick={() => setOwner(s)}>
            {state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2')}
          </button>
        ))}
      </div>
      {role === 'spectator' && <p className="hint">Spectators can watch but can't deploy armies. Pick a player seat in the top bar to join in.</p>}
      <div className="row seg">
        <button className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>Build a list</button>
        <button className={mode === 'import' ? 'on' : ''} onClick={() => setMode('import')}>Import</button>
      </div>
      {message && <p className="hint">{message}</p>}
      {mode === 'build' ? (
        <ListBuilder onDeploy={entries => deploy(entries)} deployLabel={`Deploy for ${state.names[owner] || (owner === 'p1' ? 'Player 1' : 'Player 2')}`} />
      ) : (
        <>
          <p className="hint">
            In the <a href="https://v2024.mesbg-list-builder.com/" target="_blank" rel="noreferrer">MESBG List Builder</a>, export your list as a file, then upload
            it here. You can also paste a plain list.
          </p>
          <button onClick={() => fileRef.current?.click()}>Upload list file</button>
          <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={e => onFile(e.target.files?.[0])} />
          <textarea rows={5} placeholder={'Paste a list here, e.g.\nCaptain of Minas Tirith (70 pts)\n12x Warrior of Minas Tirith with shield'} value={text} onChange={e => setText(e.target.value)} />
          <button className="primary" disabled={!text.trim()} onClick={() => importText(text)}>Deploy list</button>
        </>
      )}

      <h4>Add a single model</h4>
      <div className="row">
        <input placeholder="Model name" value={single} onChange={e => setSingle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOne()} />
        <button onClick={addOne}>Add</button>
      </div>
      {single && <p className="hint">Base: {guessBase(single).w}×{guessBase(single).h}mm (change it after placing)</p>}

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
                <button onClick={() => dispatch({ type: 'updateModel', id: m.id, patch: { dead: false, wounds: m.maxWounds } })}>Return</button>
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
  { label: 'River', t: { kind: 'water', shape: 'rect', w: 3, h: 20, rot: 0 } },
  { label: 'Ruin', t: { kind: 'ruin', shape: 'rect', w: 4, h: 3, rot: 0 } },
  { label: 'Cliff', t: { kind: 'cliff', shape: 'circle', w: 6, h: 8, rot: 0 } },
  { label: 'Field', t: { kind: 'field', shape: 'rect', w: 8, h: 5, rot: 0 } },
  { label: 'Objective', t: { kind: 'objective', shape: 'circle', w: 1.6, h: 1.6, rot: 0 } },
];

export function TablePanel({
  state,
  dispatch,
  role,
  selectedTerrain,
  setSelectedTerrain,
}: {
  state: GameState;
  dispatch: Dispatch;
  role: Role;
  selectedTerrain: string | null;
  setSelectedTerrain: (id: string | null) => void;
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

  const objectives = Object.values(state.terrain).filter(o => o.kind === 'objective');

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
      <MapsSection state={state} dispatch={dispatch} onLoaded={() => setSelectedTerrain(null)} />
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
      <div className="row wrap">
        {TERRAIN_PRESETS.map(p => (
          <button
            key={p.label}
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

      {t && (
        <>
          <h4>Selected terrain</h4>
          <Stepper label="Width" value={Math.round(t.w)} min={1} max={48} onChange={v => patch({ w: v })} />
          <Stepper label="Depth" value={Math.round(t.h)} min={1} max={48} onChange={v => patch({ h: v })} />
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

      <h4>Game</h4>
      <div className="row">
        <button onClick={save}>Save game</button>
        <button onClick={() => fileRef.current?.click()}>Load game</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => load(e.target.files?.[0])} />
      </div>
      {state.flow.started && !state.result && role !== 'spectator' && (
        <details className="finish">
          <summary>Finish the game early</summary>
          <ResultReport state={state} role={role} dispatch={dispatch} />
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
    </div>
  );
}

export function SettingsPanel({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <div className="panel-body">
      <p className="hint">These only change how the game looks for you.</p>
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
