import { useEffect, useMemo, useState } from 'react';
import { PHASES, type Model, type Role, type RoomSummary, type Seat } from '../shared/types.ts';
import { Board, type Tool } from './Board.tsx';
import { RoomConnection, useRoom } from './net.ts';
import { pictureUrl } from '../shared/catalog.ts';
import { useCatalog } from './ListBuilder.tsx';
import { ArmyPanel, DicePanel, SelectionPanel, SettingsPanel, TablePanel } from './Panels.tsx';
import { RulesPanel } from './RulesPanel.tsx';
import { ScenarioPanel } from './ScenarioPanel.tsx';
import { BrokenTags } from './BrokenTags.tsx';
import { CoachBar } from './CoachBar.tsx';
import { FightPanel } from './FightPanel.tsx';
import { ModelCard, weaponOf } from './ModelCard.tsx';
import { combats } from '../shared/flow.ts';
import { distanceBetween, formatInches } from '../shared/geometry.ts';
import { scenarioById, vpTotal } from '../shared/scenarios.ts';
import { useSettings, type Settings } from './settings.ts';

const DISCORD_INVITE = 'https://discord.gg/YfCCgbKDv';

const PLACES = ['osgiliath', 'helms-deep', 'weathertop', 'amon-hen', 'pelennor', 'fornost', 'dale', 'erebor', 'moria', 'isengard', 'edoras', 'lothlorien'];
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { priority: 'Priority', move: 'Move', shoot: 'Shoot', fight: 'Fight', end: 'End' };

function randomRoom() {
  return `${PLACES[Math.floor(Math.random() * PLACES.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Private browsing: nothing to remember, that's fine.
    }
  },
};

const cleanRoom = (room: string) =>
  room.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function useOpenGames() {
  const [games, setGames] = useState<RoomSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rooms')
        .then(r => (r.ok ? r.json() : []))
        .then(g => alive && setGames(g))
        .catch(() => alive && setGames([]));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return games;
}

function Lobby({ settings, updateSettings }: { settings: Settings; updateSettings: (p: Partial<Settings>) => void }) {
  const [code, setCode] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const games = useOpenGames();
  const go = (room: string) => {
    const clean = cleanRoom(room);
    if (clean.length >= 3) location.search = `?room=${clean}`;
  };
  return (
    <div className="lobby">
      <h1>MESBG Tabletop</h1>
      <p>Play the Middle-earth Strategy Battle Game in your browser, on a computer or phone.</p>
      <button className="primary big" onClick={() => go(randomRoom())}>Start a new game</button>
      <div className="join">
        <input placeholder="Game code, e.g. osgiliath-1234" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && go(code)} />
        <button onClick={() => go(code)}>Join</button>
      </div>

      <section className="open-games">
        <h2>Open games</h2>
        {games === null && <p className="muted">Looking for games…</p>}
        {games?.length === 0 && <p className="muted">No open games right now. Start one and share the link.</p>}
        {games?.map(g => {
          const free = (['p1', 'p2'] as const).filter(s => !g.seated.includes(s));
          return (
            <button key={g.id} className="game-row" onClick={() => go(g.id)}>
              <span className="game-id">{g.id}</span>
              <span className="game-who">
                <b className="p1">{g.names.p1 || 'Player 1'}</b> vs <b className="p2">{g.names.p2 || 'Player 2'}</b>
              </span>
              <span className="muted">
                {scenarioById(g.scenario)?.name ?? 'Open play'} · turn {g.turn}
                {g.spectators ? ` · ${g.spectators} watching` : ''}
              </span>
              <span className={`game-seat ${free.length ? 'free' : ''}`}>{free.length ? 'Seat open' : 'Full, watch'}</span>
            </button>
          );
        })}
      </section>

      <a className="discord-link" href={DISCORD_INVITE} target="_blank" rel="noreferrer">
        Join our Discord to find opponents, report bugs and suggest features
      </a>
      <button onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings}>
        ⚙ Settings
      </button>
      {showSettings && (
        <div className="lobby-settings">
          <SettingsPanel settings={settings} update={updateSettings} />
        </div>
      )}
      <p className="fine">Unofficial fan project. Not affiliated with Games Workshop or Middle-earth Enterprises.</p>
    </div>
  );
}

type PanelTab = 'model' | 'dice' | 'rules' | 'army' | 'table' | 'settings';

function Game({ room, settings, updateSettings }: { room: string; settings: Settings; updateSettings: (p: Partial<Settings>) => void }) {
  const roleKey = `role:${room}`;
  const [role, setRole] = useState<Role | null>(() => (storage.get(roleKey) as Role | null) ?? null);
  // One connection per room; role changes are sent over it rather than reconnecting.
  const conn = useMemo(() => new RoomConnection(room, role ?? 'spectator'), [room]);
  const { state, status, players, undoDepth } = useRoom(conn);
  const [tool, setTool] = useState<Tool>('move');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedTerrain, setSelectedTerrain] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('army');
  const [panelOpen, setPanelOpen] = useState(false);
  const [aimAt, setAimAt] = useState<string | null>(null);
  const [fightKey, setFightKey] = useState<string | null>(null);
  const { catalog } = useCatalog();
  const [copied, setCopied] = useState(false);

  useEffect(() => () => conn.close(), [conn]);
  useEffect(() => {
    if (role) {
      conn.setRole(role);
      storage.set(roleKey, role);
    }
  }, [role, conn, roleKey]);

  // Drop selections for models that were deleted or killed elsewhere.
  useEffect(() => {
    const alive = [...selected].filter(id => state.models[id] && !state.models[id].dead);
    if (alive.length !== selected.size) setSelected(new Set(alive));
    if (selectedTerrain && !state.terrain[selectedTerrain]) setSelectedTerrain(null);
  }, [state.models, state.terrain, selected, selectedTerrain]);

  // A new shooter, or a new phase, starts without a target.
  const single = selected.size === 1 ? state.models[[...selected][0]] : undefined;
  useEffect(() => setAimAt(null), [single?.id, state.phase]);

  const dispatch = conn.dispatch.bind(conn);
  const leave = () => {
    location.search = '';
  };
  const canUndo = role !== 'spectator' && role !== null && undoDepth > 0;
  const fights = useMemo(() => combats(state), [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        conn.dispatch({ type: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conn]);

  if (!role) {
    const taken = (s: Seat) => players.includes(s);
    return (
      <div className="lobby">
        <h1>Join {room}</h1>
        <p>Pick your side. Anyone with this link can join.</p>
        <div className="seats">
          {(['p1', 'p2'] as const).map(s => (
            <button key={s} className={`seat ${s}`} onClick={() => setRole(s)}>
              {state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2')}
              <small>{taken(s) ? 'connected now' : s === 'p1' ? 'deploys from the bottom' : 'deploys from the top'}</small>
            </button>
          ))}
        </div>
        <button onClick={() => setRole('spectator')}>Watch as a spectator</button>
        <button className="link" onClick={leave}>Back to the home screen</button>
      </div>
    );
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link:', location.href);
    }
  };

  const seatName = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const openTab = (t: PanelTab) => {
    if (tab === t && panelOpen) setPanelOpen(false);
    else {
      setTab(t);
      setPanelOpen(true);
    }
  };
  const showTab = (t: PanelTab) => {
    setTab(t);
    setPanelOpen(true);
  };

  // In the Shoot phase, tapping an enemy while your archer is selected aims at it instead of selecting it.
  const shooter = single && single.owner === role && state.phase === 'shoot' && state.flow.started && weaponOf(single, catalog) ? single : undefined;
  const onModelTap = (m: Model) => {
    if (!shooter || m.owner === shooter.owner || m.dead) return false;
    setAimAt(m.id);
    return true;
  };
  const target = aimAt ? state.models[aimAt] : undefined;
  const aimLinks =
    shooter && target
      ? (() => {
          const w = weaponOf(shooter, catalog)!;
          const d = distanceBetween(shooter, target);
          return [{ from: shooter.id, to: target.id, label: `${formatInches(d)} / ${w.range}"`, ok: d <= w.range }];
        })()
      : undefined;
  const fight = fightKey ? fights.find(c => c.key === fightKey) : undefined;
  const singleCombat = single ? fights.find(c => c.p1.includes(single.id) || c.p2.includes(single.id)) : undefined;

  return (
    <div className="game">
      <header className="topbar">
        <button className="leave" onClick={leave} title="Leave this game and go back to the home screen" aria-label="Leave game">
          ⟵
        </button>
        <button className="room" onClick={copyLink} title="Copy invite link">
          <span className="room-name">{copied ? 'Link copied' : room}</span> <span className={`dot ${status}`} />
        </button>
        <div className="sides">
          {(['p1', 'p2'] as const).map(s => (
            <span key={s} className={`side ${s} ${state.priority === s ? 'has-priority' : ''}`} title={state.priority === s ? 'Has priority this turn' : undefined}>
              {state.priority === s && <span aria-label="Priority">👑</span>}
              {seatName(s)}
              {s === role && <small> (you)</small>}
            </span>
          ))}
        </div>
        <BrokenTags state={state} />
        {scenarioById(state.scenario) && (
          <button className="vp-chip" onClick={() => openTab('table')} title={scenarioById(state.scenario)!.name}>
            VP <b className="p1">{vpTotal(state.vp.p1)}</b>–<b className="p2">{vpTotal(state.vp.p2)}</b>
          </button>
        )}
        <nav className="panel-buttons" aria-label="Panels">
          {(
            [
              ['army', '⚔', 'Army'],
              ['table', '⛰', 'Table'],
              ['rules', '📖', 'Rules'],
              ['dice', '🎲', 'Log'],
              ['settings', '⚙', 'Look'],
            ] as const
          ).map(([t, icon, label]) => (
            <button key={t} className={panelOpen && tab === t ? 'on' : ''} onClick={() => openTab(t)} aria-label={label} title={label}>
              <span>{icon}</span>
              <small>{label}</small>
            </button>
          ))}
        </nav>
      </header>

      <main className={`main ${panelOpen ? 'panel-open' : ''}`}>
        <div className="table-area">
          <div className="stage">
            <Board
              state={state}
              tool={tool}
              selected={selected}
              setSelected={setSelected}
              selectedTerrain={selectedTerrain}
              setSelectedTerrain={id => {
                setSelectedTerrain(id);
                if (id) showTab('table');
              }}
              dispatch={role === 'spectator' ? () => {} : dispatch}
              showZones={settings.zones}
              showDeployment={settings.deployment}
              showGrid={settings.grid}
              photoFor={m => {
                const unit = settings.photos && m.profileId ? catalog?.units[m.profileId] : undefined;
                return unit && pictureUrl(unit);
              }}
              onModelTap={onModelTap}
              links={aimLinks}
              fights={state.flow.started && state.phase === 'fight' ? fights.map(c => ({ key: c.key, ids: [...c.p1, ...c.p2], done: state.flow.resolved.includes(c.key) })) : undefined}
              onFightTap={setFightKey}
            />

            <div className="tool-rail" role="toolbar" aria-label="Tools">
              {(
                [
                  ['move', '✋', 'Drag'],
                  ['select', '⬚', 'Select'],
                  ['measure', '📏', 'Measure'],
                ] as const
              ).map(([t, icon, label]) => (
                <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={label} aria-label={label}>
                  <span>{icon}</span>
                  <small>{label}</small>
                </button>
              ))}
              <button onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo} title="Undo your last change (Ctrl+Z)" aria-label="Undo">
                <span>↶</span>
                <small>Undo</small>
              </button>
            </div>

            {single && (
              <ModelCard
                key={single.id}
                state={state}
                dispatch={dispatch}
                role={role}
                model={single}
                catalog={catalog}
                target={target}
                clearTarget={() => setAimAt(null)}
                combat={state.flow.started ? singleCombat : undefined}
                openFight={setFightKey}
                openTab={showTab}
                close={() => setSelected(new Set())}
              />
            )}
            {selected.size > 1 && (
              <button className="selection-chip" onClick={() => showTab('model')}>
                {selected.size} models selected · Details
              </button>
            )}
          </div>

          <CoachBar state={state} dispatch={dispatch} role={role} combats={fights} openTab={showTab} openFight={setFightKey} />
        </div>

        {fight && (
          <div className="sheet-backdrop" onClick={() => setFightKey(null)}>
            <div className="sheet" role="dialog" aria-label="Fight" onClick={e => e.stopPropagation()}>
              <button className="close" onClick={() => setFightKey(null)} aria-label="Close">
                ✕
              </button>
              <FightPanel state={state} dispatch={dispatch} role={role} ids={[...fight.p1, ...fight.p2]} combat={fight.key} title="Resolve the fight" />
            </div>
          </div>
        )}

        {panelOpen && (
          <aside className="panel">
            <nav className="tabs">
              {(
                [
                  ['army', 'Army'],
                  ['table', 'Table'],
                  ['rules', 'Rules'],
                  ['dice', 'Log'],
                  ['model', selected.size ? `Selected (${selected.size})` : 'Selected'],
                  ['settings', '⚙'],
                ] as const
              ).map(([t, label]) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
              <button className="close" onClick={() => setPanelOpen(false)} aria-label="Close panel">
                ✕
              </button>
            </nav>
            {tab === 'model' && <SelectionPanel state={state} selected={selected} dispatch={dispatch} clear={() => setSelected(new Set())} />}
            {tab === 'settings' && <SettingsPanel settings={settings} update={updateSettings} />}
            {tab === 'dice' && <DicePanel state={state} dispatch={dispatch} role={role} />}
            {tab === 'rules' && <RulesPanel state={state} dispatch={dispatch} role={role} selected={selected} />}
            {tab === 'army' && <ArmyPanel state={state} dispatch={dispatch} role={role} />}
            {tab === 'table' && (
              <>
                <div className="panel-body game-panel">
                  <h4>You</h4>
                  <div className="row">
                    {role !== 'spectator' && (
                      <input
                        value={state.names[role] ?? ''}
                        placeholder={role === 'p1' ? 'Player 1' : 'Player 2'}
                        onChange={e => dispatch({ type: 'setName', seat: role, name: e.target.value })}
                        aria-label="Your name"
                      />
                    )}
                    <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Your seat">
                      <option value="p1">Player 1</option>
                      <option value="p2">Player 2</option>
                      <option value="spectator">Spectator</option>
                    </select>
                  </div>
                  <h4>Game</h4>
                  <label className="check">
                    <input type="checkbox" checked={state.listed} disabled={role === 'spectator'} onChange={e => dispatch({ type: 'setListed', listed: e.target.checked })} />
                    Show this game in the open games list
                  </label>
                  {state.flow.started && role !== 'spectator' && (
                    <label>
                      Correct the phase
                      <select value={`${state.turn}:${state.phase}`} onChange={e => {
                        const [t, p] = e.target.value.split(':');
                        dispatch({ type: 'setPhase', phase: p as (typeof PHASES)[number], turn: Number(t) });
                      }}>
                        {[state.turn - 1, state.turn].filter(t => t >= 1).flatMap(t =>
                          PHASES.map(p => (
                            <option key={`${t}:${p}`} value={`${t}:${p}`}>
                              Turn {t}, {PHASE_LABEL[p]}
                            </option>
                          )),
                        )}
                      </select>
                    </label>
                  )}
                  <div className="row wrap">
                    <button onClick={copyLink}>Copy invite link</button>
                    <button onClick={leave}>Leave game</button>
                  </div>
                </div>
                <ScenarioPanel state={state} dispatch={dispatch} role={role} />
                <TablePanel state={state} dispatch={dispatch} selectedTerrain={selectedTerrain} setSelectedTerrain={setSelectedTerrain} />
              </>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

export function App() {
  const room = cleanRoom(new URLSearchParams(location.search).get('room') ?? '');
  const [settings, updateSettings] = useSettings();
  return room.length >= 3 ? <Game room={room} settings={settings} updateSettings={updateSettings} /> : <Lobby settings={settings} updateSettings={updateSettings} />;
}
