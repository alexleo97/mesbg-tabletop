import { useEffect, useMemo, useState } from 'react';
import { PHASES, type Role, type Seat } from '../shared/types.ts';
import { Board, type Tool } from './Board.tsx';
import { RoomConnection, useRoom } from './net.ts';
import { pictureUrl } from '../shared/catalog.ts';
import { useCatalog } from './ListBuilder.tsx';
import { ArmyPanel, DicePanel, SelectionPanel, SettingsPanel, TablePanel } from './Panels.tsx';
import { RulesPanel } from './RulesPanel.tsx';
import { useSettings, type Settings } from './settings.ts';

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

function Lobby() {
  const [code, setCode] = useState('');
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
  const { state, status, players } = useRoom(conn);
  const [tool, setTool] = useState<Tool>('move');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedTerrain, setSelectedTerrain] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('army');
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 800);
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

  useEffect(() => {
    if (selected.size) setTab('model');
  }, [selected.size]);

  const dispatch = conn.dispatch.bind(conn);

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

  return (
    <div className="game">
      <header className="topbar">
        <button className="room" onClick={copyLink} title="Copy invite link">
          {copied ? 'Link copied' : room} <span className={`dot ${status}`} />
        </button>
        <div className="phases" role="group" aria-label="Turn phases">
          <span className="turn">T{state.turn}</span>
          {PHASES.map(p => (
            <button key={p} className={state.phase === p ? 'on' : ''} onClick={() => dispatch({ type: 'setPhase', phase: p })} disabled={role === 'spectator'}>
              {PHASE_LABEL[p]}
            </button>
          ))}
          <button className="next" onClick={() => dispatch({ type: 'nextPhase' })} disabled={role === 'spectator'} aria-label="Next phase">
            ▶
          </button>
        </div>
        <div className="priority">
          <span>Priority:</span>
          {(['p1', 'p2'] as const).map(s => (
            <button key={s} className={`${s} ${state.priority === s ? 'on' : ''}`} onClick={() => dispatch({ type: 'setPriority', seat: s })} disabled={role === 'spectator'}>
              {seatName(s)}
            </button>
          ))}
          <button
            onClick={() => {
              dispatch({ type: 'roll', count: 2, label: `Priority roll: ${seatName('p1')} vs ${seatName('p2')}` });
              setTab('dice');
              setPanelOpen(true);
            }}
            disabled={role === 'spectator'}
          >
            Roll
          </button>
        </div>
        <div className="me desktop-only">
          {role !== 'spectator' ? (
            <input
              className={`name ${role}`}
              value={state.names[role] ?? ''}
              placeholder={role === 'p1' ? 'Player 1' : 'Player 2'}
              onChange={e => dispatch({ type: 'setName', seat: role, name: e.target.value })}
              aria-label="Your name"
            />
          ) : (
            <span className="muted">Spectating</span>
          )}
          <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Your seat">
            <option value="p1">Player 1</option>
            <option value="p2">Player 2</option>
            <option value="spectator">Spectator</option>
          </select>
        </div>
      </header>

      <main className={`main ${panelOpen ? 'panel-open' : ''}`}>
        <Board
          state={state}
          tool={tool}
          selected={selected}
          setSelected={setSelected}
          selectedTerrain={selectedTerrain}
          setSelectedTerrain={id => {
            setSelectedTerrain(id);
            if (id) {
              setTab('table');
            }
          }}
          dispatch={role === 'spectator' ? () => {} : dispatch}
          showZones={settings.zones}
          showGrid={settings.grid}
          photoFor={m => {
            const unit = settings.photos && m.profileId ? catalog?.units[m.profileId] : undefined;
            return unit && pictureUrl(unit);
          }}
        />
        {panelOpen && (
          <aside className="panel">
            <nav className="tabs">
              {(
                [
                  ['model', selected.size ? `Selected (${selected.size})` : 'Selected'],
                  ['dice', 'Dice'],
                  ['rules', 'Rules'],
                  ['army', 'Army'],
                  ['table', 'Table'],
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
                <div className="panel-body me-panel mobile-only">
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
                </div>
              <TablePanel
                state={state}
                dispatch={dispatch}
                selectedTerrain={selectedTerrain}
                setSelectedTerrain={setSelectedTerrain}
              />
              </>
            )}
          </aside>
        )}
      </main>

      {!panelOpen && selected.size > 0 && (
        <button className="selection-chip" onClick={() => openTab('model')}>
          {selected.size === 1 ? state.models[[...selected][0]]?.name : `${selected.size} models`} · Details
        </button>
      )}
      {!panelOpen && selectedTerrain && selected.size === 0 && (
        <button className="selection-chip" onClick={() => openTab('table')}>
          Terrain · Edit
        </button>
      )}

      <footer className="toolbar">
        {(
          [
            ['move', '✋', 'Drag'],
            ['select', '⬚', 'Select'],
            ['measure', '📏', 'Measure'],
          ] as const
        ).map(([t, icon, label]) => (
          <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
        <span className="sep" />
        <button className={panelOpen && tab === 'dice' ? 'on' : ''} onClick={() => openTab('dice')}>
          <span>🎲</span>Dice
        </button>
        <button className={panelOpen && tab === 'rules' ? 'on' : ''} onClick={() => openTab('rules')}>
          <span>📖</span>Rules
        </button>
        <button className={panelOpen && tab === 'army' ? 'on' : ''} onClick={() => openTab('army')}>
          <span>⚔</span>Army
        </button>
        <button className={panelOpen && tab === 'table' ? 'on' : ''} onClick={() => openTab('table')}>
          <span>⛰</span>Table
        </button>
        <button className={panelOpen && tab === 'settings' ? 'on' : ''} onClick={() => openTab('settings')} aria-label="Settings">
          <span>⚙</span>Look
        </button>
      </footer>
    </div>
  );
}

export function App() {
  const room = cleanRoom(new URLSearchParams(location.search).get('room') ?? '');
  const [settings, updateSettings] = useSettings();
  return room.length >= 3 ? <Game room={room} settings={settings} updateSettings={updateSettings} /> : <Lobby />;
}
