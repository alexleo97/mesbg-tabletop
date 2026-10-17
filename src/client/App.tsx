import { useEffect, useMemo, useState } from 'react';
import { BOT_NAME, BOT_SPEEDS, PHASES, type Terrain, type Model, type Role, type RoomSummary, type Seat } from '../shared/types.ts';
import { Board, type Tool } from './Board.tsx';
import { RoomConnection, useRoom, type Connection } from './net.ts';
import { pictureUrl } from '../shared/catalog.ts';
import { useCatalog } from './ListBuilder.tsx';
import { ArmyPanel, DicePanel, SelectionPanel, SettingsPanel, TablePanel } from './Panels.tsx';
import { RulesPanel } from './RulesPanel.tsx';
import { ScenarioPanel } from './ScenarioPanel.tsx';
import { BrokenTags } from './BrokenTags.tsx';
import { CoachBar } from './CoachBar.tsx';
import { FightPanel } from './FightPanel.tsx';
import { ModelCard, weaponOf } from './ModelCard.tsx';
import { SightHint } from './SightHint.tsx';
import { combatFromKey, combats, other } from '../shared/flow.ts';
import { waitingOnMight } from '../shared/bot.ts';
import { distanceBetween, formatInches } from '../shared/geometry.ts';
import { scenarioById } from '../shared/scenarios.ts';
import { vpTotals } from '../shared/scoring.ts';
import { useSettings, type Settings } from './settings.ts';
import { Tutorial } from './Tutorial.tsx';
import { HeroArt } from './HeroArt.tsx';
import { ProfilePage } from './Account.tsx';
import { ArmiesCard, ArmiesPage, MapIcon, MapsCard, MapsPage, randomRoom, SitePage, TopPlayersCard } from './Home.tsx';
import { getMap } from './cloud.ts';
import { MapEditor } from './MapEditor.tsx';
import { LeaderboardPage } from './Leaderboard.tsx';
import { useAuth } from './auth.ts';

const DISCORD_INVITE = 'https://discord.gg/epNRWMxGws';

const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { priority: 'Priority', move: 'Move', shoot: 'Shoot', fight: 'Fight', end: 'End' };

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

/** The community card: an invite for newcomers, a shortcut back in for members. */
function DiscordCard() {
  const { discordMember, discordGuild } = useAuth();
  // Members go straight to the server; the invite would only ask them to accept it again.
  const href = discordMember && discordGuild ? `https://discord.com/channels/${discordGuild}` : DISCORD_INVITE;
  return (
    <section className={`dash-card discord-card ${discordMember ? 'member' : ''}`}>
      <header>
        <h2>{discordMember ? "You're in our Discord" : 'Join the community'}</h2>
      </header>
      <p className="muted">
        {discordMember
          ? 'Find opponents, share your maps, and tell us what to build next.'
          : 'Our Discord is where players find opponents, share maps and suggest what we build next.'}
      </p>
      <a className="discord-link" href={href} target="_blank" rel="noreferrer">
        {discordMember ? 'Open Discord' : 'Join our Discord'}
      </a>
    </section>
  );
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
    <SitePage page="play" wide>
      <section className="home-banner">
        <HeroArt />
        <div className="home-hero">
          <h1>Play Middle-earth battles online</h1>
          <p className="lead">Bring your army, pick a table and play a friend. The game keeps track of turns, rolls and rules for you.</p>
          <div className="hero-actions">
            <button className="primary big" onClick={() => go(randomRoom())}>
              Start a new game
            </button>
            <button className="big" onClick={() => (location.search = `?room=${randomRoom()}&vs=computer`)}>
              Solo battle
            </button>
            <button className="big" onClick={() => (location.search = '?learn')}>
              Learn to play
            </button>
          </div>
          <div className="join">
            <input placeholder="Have a game code? e.g. osgiliath-1234" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && go(code)} />
            <button onClick={() => go(code)}>Join</button>
          </div>
        </div>
      </section>

      <ol className="home-steps">
        <li>
          <a href="?armies">
            <span className="step-icon" aria-hidden>🛡</span>
            <b>Build your army</b>
            <small>Every army list, with points and rules explained.</small>
          </a>
        </li>
        <li>
          <a href="?maps">
            <span className="step-icon" aria-hidden>
              <MapIcon />
            </span>
            <b>Pick a table</b>
            <small>Ready-made boards, or lay out your own.</small>
          </a>
        </li>
        <li>
          <button onClick={() => go(randomRoom())}>
            <span className="step-icon" aria-hidden>⚔</span>
            <b>Play a friend</b>
            <small>Send them the link. The turn guide does the rest.</small>
          </button>
        </li>
      </ol>

      <div className="home-grid">
        <section className="open-games dash-card">
          <header>
            <h2>Open games</h2>
            {!!games?.length && <small className="muted">{games.length} live</small>}
          </header>
          {games === null && <p className="muted">Looking for games…</p>}
          {games?.length === 0 && <p className="muted">No open games right now. Start one and share the link, or find an opponent on Discord.</p>}
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
                <span className={`game-seat ${free.length ? 'free' : ''}`}>{free.length ? 'Join' : 'Watch'}</span>
              </button>
            );
          })}
        </section>
        <DiscordCard />
      </div>

      <div className="dash-grid">
        <ArmiesCard />
        <MapsCard />
        <TopPlayersCard />
      </div>

      <footer className="home-foot">
        <button onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings}>
          ⚙ Display settings
        </button>
        <p className="fine">Unofficial fan project. Not affiliated with Games Workshop or Middle-earth Enterprises.</p>
      </footer>
      {showSettings && (
        <div className="lobby-settings">
          <SettingsPanel settings={settings} update={updateSettings} />
        </div>
      )}
    </SitePage>
  );
}

type PanelTab = 'model' | 'dice' | 'rules' | 'army' | 'table' | 'settings';
const PANEL_TITLE: Record<PanelTab, string> = { army: 'Army', table: 'Table', rules: 'Rules', dice: 'Dice log', model: 'Selected models', settings: 'Look' };

interface GameProps {
  room: string;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  /** A game that isn't a server room, such as the training; you play player 1. */
  practice?: Connection;
  /** Shown over the table, such as the current lesson. */
  overlay?: React.ReactNode;
  /** In the training, whether the setup card shows before the battle starts (only lessons that use it). */
  setupCard?: boolean;
}

export function Game({ room, settings, updateSettings, practice, overlay, setupCard }: GameProps) {
  const roleKey = `role:${room}`;
  // Arriving to play the computer: you take player 1 and it takes player 2.
  const vsComputer = useMemo(() => !practice && new URLSearchParams(location.search).get('vs') === 'computer', []);
  const [role, setRole] = useState<Role | null>(() => (practice || vsComputer ? 'p1' : ((storage.get(roleKey) as Role | null) ?? null)));
  // One connection per room; role changes are sent over it rather than reconnecting.
  const conn = useMemo<Connection>(() => practice ?? new RoomConnection(room, role ?? 'spectator'), [room, practice]);
  const { state, status, players, undoDepth, invite, refused, marks } = useRoom(conn);
  const [refusedNote, setRefusedNote] = useState<string | null>(null);
  // Asked for a seat in a private game without the invite: watch instead, and say why.
  useEffect(() => {
    if (!refused) return;
    setRefusedNote(refused);
    setRole('spectator');
  }, [refused]);
  const [tool, setTool] = useState<Tool>('move');
  const [sight, setSight] = useState(false);
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
      if (!practice) storage.set(roleKey, role);
    }
  }, [role, conn, roleKey, practice]);

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
  // Signed-in players sit down under their profile name unless they've already typed one.
  const { profile, token } = useAuth();
  useEffect(() => conn.setToken?.(token), [conn, token]);
  const seat = role === 'p1' || role === 'p2' ? role : null;
  useEffect(() => {
    if (!practice && seat && profile && players.includes(seat) && !state.names[seat]) dispatch({ type: 'setName', seat, name: profile.username });
  }, [seat, profile?.username, players.includes(seat as Seat), !state.names[seat as Seat]]);
  // Arriving from the Maps page: lay out the chosen map once you've taken a seat at an empty table.
  const mapId = useMemo(() => new URLSearchParams(location.search).get('map'), []);
  const [mapNote, setMapNote] = useState<string | null>(null);
  const tableEmpty = Object.keys(state.terrain).length === 0;
  useEffect(() => {
    if (!mapId || practice || !seat || !players.includes(seat) || status !== 'online') return;
    const url = new URL(location.href);
    url.searchParams.delete('map');
    history.replaceState(null, '', url);
    if (!tableEmpty) return;
    void getMap(mapId).then(m => {
      if (!m) return setMapNote("Couldn't load that map. Pick one from the ⛰ Table tab instead.");
      const terrain = (m.data.terrain ?? []).map((t: Terrain) => ({ ...t, id: `t-${Math.random().toString(36).slice(2, 9)}` }));
      dispatch({ type: 'setScenery', w: m.data.w, h: m.data.h, mat: m.data.mat, terrain });
    });
  }, [mapId, seat, players.includes(seat as Seat), status]);
  useEffect(() => {
    if (!vsComputer || seat !== 'p1' || !players.includes('p1') || status !== 'online') return;
    const url = new URL(location.href);
    url.searchParams.delete('vs');
    history.replaceState(null, '', url);
    if (!state.bot && !players.includes('p2')) dispatch({ type: 'setBot', seat: 'p2' });
  }, [seat, players.includes('p1'), status]);
  // When the computer holds off its strikes for you to spend Might, the fight opens so you can.
  const mightFight = waitingOnMight(state);
  useEffect(() => {
    if (mightFight && seat && seat !== state.bot) setFightKey(mightFight);
  }, [mightFight]);
  const leave = () => {
    location.search = '';
  };
  const canUndo = role !== 'spectator' && role !== null && undoDepth > 0;
  const fights = useMemo(() => combats(state), [state]);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
        {state.private && !invite ? (
          <p>🔒 This game is private. You can watch it now; ask one of the players for the invite link to take a seat.</p>
        ) : (
          <p>Pick your side.{state.private ? ' You have an invite to this private game.' : ' Anyone with this link can join.'}</p>
        )}
        <div className="seats">
          {(['p1', 'p2'] as const).map(s => (
            <button key={s} className={`seat ${s}`} disabled={(!!state.private && !invite) || state.bot === s} onClick={() => setRole(s)}>
              {state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2')}
              <small>{state.bot === s ? `played by ${BOT_NAME.replace(/^The /, 'the ')}` : taken(s) ? 'connected now' : s === 'p1' ? 'deploys from the bottom' : 'deploys from the top'}</small>
            </button>
          ))}
        </div>
        <button onClick={() => setRole('spectator')}>Watch as a spectator</button>
        <button className="link" onClick={leave}>Back to the home screen</button>
      </div>
    );
  }

  /** The game's link. In a private game, players can hand out one that lets the holder take a seat. */
  const copyLink = async (withInvite = true) => {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('room', room);
    if (withInvite && state.private && seat && invite) url.searchParams.set('invite', invite);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link:', url.href);
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
  // The fight stays open after its losers back away, so its wounds can still be applied.
  const fight = fightKey ? (fights.find(c => c.key === fightKey) ?? combatFromKey(state, fightKey)) : undefined;
  const singleCombat = single ? fights.find(c => c.p1.includes(single.id) || c.p2.includes(single.id)) : undefined;

  return (
    <div className="game">
      <header className="topbar">
        <button className="leave" onClick={leave} title="Leave this game and go back to the home screen" aria-label="Leave game">
          ⟵
        </button>
        <button className="room" onClick={() => !state.bot && void copyLink()} title={state.bot ? 'Solo battle' : state.private && !seat ? 'Copy the link to watch this game' : 'Copy invite link'}>
          {state.private && <span title="Private game: only invited players can take a seat">🔒</span>}
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
        {state.bot && seat && (
          <button
            className="bot-speed"
            onClick={() => dispatch({ type: 'setBotSpeed', speed: BOT_SPEEDS[(BOT_SPEEDS.indexOf(state.botSpeed ?? 'normal') + 1) % BOT_SPEEDS.length] })}
            title={`How fast ${BOT_NAME.replace(/^The /, 'the ')} plays its turn. Click to change.`}
          >
            {{ normal: '▶ Normal', fast: '⏩ Fast', instant: '⏭ Instant' }[state.botSpeed ?? 'normal']}
          </button>
        )}
        <BrokenTags state={state} />
        {scenarioById(state.scenario) && (
          <button className="vp-chip" onClick={() => openTab('table')} title={scenarioById(state.scenario)!.name}>
            VP <b className="p1">{vpTotals(state).p1}</b>–<b className="p2">{vpTotals(state).p2}</b>
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
          {overlay}
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
              sightFrom={sight && single ? single.id : undefined}
              sightRange={sight && single ? weaponOf(single, catalog)?.range : undefined}
              showNames={settings.names}
              marks={marks}
              animate={settings.animations && !reducedMotion}
              onMark={m => conn.mark(m)}
            />

            <div className="tool-rail" role="toolbar" aria-label="Tools">
              {(
                [
                  ['move', '✋', 'Drag'],
                  ['select', '⬚', 'Select'],
                  ['measure', '📏', 'Measure'],
                  ['mark', '📍', 'Mark'],
                ] as const
              ).map(([t, icon, label]) => (
                <button
                  key={t}
                  className={tool === t ? 'on' : ''}
                  onClick={() => setTool(t)}
                  title={t === 'mark' ? 'Click to ping a spot, drag to draw an arrow (or hold Alt with any tool)' : label}
                  aria-label={label}
                >
                  <span>{icon}</span>
                  <small>{label}</small>
                </button>
              ))}
              <button
                className={sight ? 'on' : ''}
                onClick={() => setSight(v => !v)}
                title="Show what a model can see"
                aria-label="Line of sight"
                aria-pressed={sight}
              >
                <span>👁</span>
                <small>Sight</small>
              </button>
              <button
                className={settings.names ? 'on' : ''}
                onClick={() => updateSettings({ names: !settings.names })}
                title="Show unit names under models"
                aria-label="Unit names"
                aria-pressed={settings.names}
              >
                <span>🏷</span>
                <small>Names</small>
              </button>
              {marks?.some(m => m.kind === 'arrow' && m.by === role) && (
                <button onClick={() => conn.clearMarks()} title="Take your arrows off the table" aria-label="Clear arrows">
                  <span>✕</span>
                  <small>Arrows</small>
                </button>
              )}
              <button onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo} title="Undo your last change (Ctrl+Z)" aria-label="Undo">
                <span>↶</span>
                <small>Undo</small>
              </button>
            </div>

            {refusedNote && (
              <button className="sight-hint" onClick={() => setRefusedNote(null)}>
                🔒 {refusedNote}
              </button>
            )}
            {mapNote && (
              <button className="sight-hint" onClick={() => setMapNote(null)}>
                {mapNote}
              </button>
            )}
            {sight && <SightHint state={state} viewer={single} range={single ? weaponOf(single, catalog)?.range : undefined} />}
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

          {(!practice || setupCard || state.flow.started) && <CoachBar state={state} dispatch={dispatch} role={role} combats={fights} openTab={showTab} openFight={setFightKey} />}
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
            <div className="panel-head">
              <h3>{PANEL_TITLE[tab]}</h3>
              <button className="close" onClick={() => setPanelOpen(false)} aria-label="Close panel">
                ✕
              </button>
            </div>
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
                      <option value="p1" disabled={state.bot === 'p1'}>Player 1</option>
                      <option value="p2" disabled={state.bot === 'p2'}>Player 2</option>
                      <option value="spectator">Spectator</option>
                    </select>
                  </div>
                  {seat && !state.bot && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={players.includes(other(seat))}
                        onChange={e => dispatch({ type: 'setBot', seat: e.target.checked ? other(seat) : null })}
                      />
                      Let {BOT_NAME.replace(/^The /, 'the ')} play the other side
                      {players.includes(other(seat)) ? ' (someone is sitting there now)' : ''}
                    </label>
                  )}
                  {state.bot && <p className="hint">A solo battle against {BOT_NAME.replace(/^The /, 'the ')}. Nobody else can join it.</p>}
                  <h4>Game</h4>
                  {!state.bot && (
                  <label className="check">
                    <input type="checkbox" checked={state.listed} disabled={role === 'spectator' || state.private} onChange={e => dispatch({ type: 'setListed', listed: e.target.checked })} />
                    Show this game in the open games list
                  </label>
                  )}
                  {!state.bot && (
                  <label className="check">
                    <input type="checkbox" checked={!!state.private} disabled={!seat || !conn.setPrivate} onChange={e => conn.setPrivate?.(e.target.checked)} />
                    Private game: only people you send the invite link to can take a seat. Anyone can still watch.
                  </label>
                  )}
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
                    {!state.bot && <button onClick={() => void copyLink()}>{state.private ? 'Copy invite link (to play)' : 'Copy invite link'}</button>}
                    {!state.bot && state.private && seat && <button onClick={() => void copyLink(false)}>Copy link to watch</button>}
                    <button onClick={leave}>Leave game</button>
                  </div>
                </div>
                <ScenarioPanel state={state} dispatch={dispatch} role={role} />
                <TablePanel state={state} dispatch={dispatch} role={role} selectedTerrain={selectedTerrain} setSelectedTerrain={setSelectedTerrain} />
              </>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

export function App() {
  const params = new URLSearchParams(location.search);
  const room = cleanRoom(params.get('room') ?? '');
  const [settings, updateSettings] = useSettings();
  if (params.has('armies')) return <ArmiesPage />;
  if (params.has('maps')) return <MapsPage />;
  if (params.has('mapeditor')) return <MapEditor settings={settings} />;
  if (params.has('leaderboard'))
    return (
      <SitePage page="leaderboard">
        <LeaderboardPage />
      </SitePage>
    );
  if (params.has('profile'))
    return (
      <SitePage page="profile">
        <ProfilePage onHome={() => (location.search = '')} />
      </SitePage>
    );
  if (params.has('learn'))
    return <Tutorial settings={settings} updateSettings={updateSettings} onExit={() => (location.search = '')} onPlay={() => (location.search = `?room=${randomRoom()}`)} />;
  return room.length >= 3 ? <Game room={room} settings={settings} updateSettings={updateSettings} /> : <Lobby settings={settings} updateSettings={updateSettings} />;
}
