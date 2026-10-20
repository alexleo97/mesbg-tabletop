import { useEffect, useState } from 'react';
import { STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { entryPoints } from '../shared/catalog.ts';
import { botRoster, playableArmies } from '../shared/botList.ts';
import { newId, type ListEntry } from '../shared/importList.ts';
import { PREMADE, premadeRoster } from '../shared/premade.ts';
import { POOLS, SCENARIOS, scenarioById, scenarioFromDice } from '../shared/scenarios.ts';
import { BOT_NAME, type Mat, type Terrain } from '../shared/types.ts';
import { listEntries } from '../shared/warbands.ts';
import { useAuth } from './auth.ts';
import { cloudLists, getMap, listMaps, mergeLists, type SavedMap } from './cloud.ts';
import { MapPreview, randomRoom, SitePage } from './Home.tsx';
import { loadSaved, useCatalog, type Roster } from './ListBuilder.tsx';
import { DeployThumb } from './ScenarioZones.tsx';

/** What the menu hands to the table it opens: laid out there as soon as you sit down. */
export interface BattleSetup {
  scenario: string | null;
  table?: { w: number; h: number; mat: Mat; terrain: Terrain[] };
  army?: { name: string; entries: ListEntry[] };
  /** The computer's army, in a solo battle. */
  foe?: { name: string; entries: ListEntry[] };
}

const setupKey = (room: string) => `battle-setup:${room}`;

/** The set-up the menu left for this room, once: taking it clears it, so a reload doesn't lay it out again. */
export function takeSetup(room: string): BattleSetup | null {
  try {
    const raw = sessionStorage.getItem(setupKey(room));
    if (!raw) return null;
    sessionStorage.removeItem(setupKey(room));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEPLOY: Record<string, string> = {
  'long-edges': 'From the long edges',
  maelstrom: 'Maelstrom of Battle: warbands arrive during the game',
  corners: 'From the corners',
  'centre-edge-semicircle': 'Round the centre of each edge',
};

type ArmyMode = 'lists' | 'premade' | 'table';

/**
 * The menu for a regular game, laid out like the narrative scenarios one: the scenario, the table, your army and
 * your opponent, then one button to the table with all of it set up.
 */
export function BattleMenu() {
  const params = new URLSearchParams(location.search);
  const { catalog } = useCatalog();
  const { enabled, profile } = useAuth();
  const [scenario, setScenario] = useState<string>('roll');
  const [vs, setVs] = useState<'computer' | 'friend'>(params.get('vs') === 'computer' ? 'computer' : 'friend');
  // The table: a starter board, one of the saved maps, or an empty one to lay out yourself.
  const [table, setTable] = useState<string>(params.get('map') ? `map:${params.get('map')}` : `board:${STARTER_BOARDS[0].id}`);
  const [mapTab, setMapTab] = useState<'shared' | 'mine'>('shared');
  const [maps, setMaps] = useState<SavedMap[] | null>(null);
  const [fromLink, setFromLink] = useState<SavedMap | null>(null);
  const [lists, setLists] = useState<Roster[]>(() => loadSaved().filter(r => r.entries.length));
  const [mode, setMode] = useState<ArmyMode>(() => (loadSaved().some(r => r.entries.length) ? 'lists' : 'premade'));
  const [list, setList] = useState<string>(() => loadSaved().find(r => r.entries.length)?.id ?? '');
  const [premade, setPremade] = useState(PREMADE[0].id);
  const [points, setPoints] = useState(500);
  const [foe, setFoe] = useState('random');
  const [foePoints, setFoePoints] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in: your lists from other devices too.
  useEffect(() => {
    if (profile) void cloudLists().then(cloud => cloud && setLists(mergeLists(loadSaved(), cloud).filter(r => r.entries.length)));
  }, [profile?.id]);
  useEffect(() => {
    if (!enabled || (mapTab === 'mine' && !profile)) return setMaps([]);
    let alive = true;
    setMaps(null);
    void listMaps(mapTab).then(m => alive && setMaps(m ?? []));
    return () => {
      alive = false;
    };
  }, [enabled, profile?.id, mapTab]);
  // Arriving from the Maps page with a map picked.
  useEffect(() => {
    const id = params.get('map');
    if (id) void getMap(id).then(m => m && setFromLink(m));
  }, []);

  const solo = vs === 'computer';
  // Open play has no deployment zones or victory points, so the computer always plays a scenario.
  const shownScenario = solo && scenario === 'open' ? 'roll' : scenario;
  const roster = lists.find(r => r.id === list);
  const listPoints = (r: Roster) => (catalog ? r.entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0) : 0);
  const myPoints = mode === 'lists' && roster ? listPoints(roster) : mode === 'premade' ? points : 0;
  const theirPoints = foePoints ?? (myPoints ? Math.max(200, Math.round(myPoints / 50) * 50) : 500);
  const armyReady = mode === 'table' || (mode === 'lists' ? !!roster : true);
  const chosenMap = [...(maps ?? []), ...(fromLink ? [fromLink] : [])].find(m => `map:${m.id}` === table);

  const play = async () => {
    if (!catalog || busy) return;
    setBusy(true);
    const room = randomRoom();
    const pick = shownScenario === 'roll' ? scenarioFromDice(Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)))!.id : shownScenario === 'open' ? null : shownScenario;
    const setup: BattleSetup = { scenario: pick };
    if (table.startsWith('board:')) {
      const b = STARTER_BOARDS.find(x => `board:${x.id}` === table)!;
      setup.table = { w: b.w, h: b.h, mat: b.mat, terrain: starterTerrain(b, newId) };
    } else if (table.startsWith('map:')) {
      const m = chosenMap ?? (await getMap(table.slice(4)));
      if (m) setup.table = { w: m.data.w, h: m.data.h, mat: m.data.mat, terrain: (m.data.terrain ?? []).map((t: Terrain) => ({ ...t, id: newId('t') })) };
    }
    if (mode === 'lists' && roster) setup.army = { name: roster.name, entries: listEntries(roster, catalog).flatMap(g => g.entries) };
    if (mode === 'premade') {
      const p = PREMADE.find(x => x.id === premade)!;
      setup.army = { name: p.name, entries: listEntries(premadeRoster(catalog, p.id, points)!, catalog).flatMap(g => g.entries) };
    }
    if (solo) {
      const p = PREMADE.find(x => x.id === foe);
      const armies = playableArmies(catalog);
      const army = p?.army ?? (foe.startsWith('army:') ? foe.slice(5) : armies[Math.floor(Math.random() * armies.length)]);
      const r = p ? premadeRoster(catalog, p.id, theirPoints)! : botRoster(catalog, army, theirPoints);
      setup.foe = { name: p?.name ?? army, entries: listEntries(r, catalog).flatMap(g => g.entries) };
    }
    try {
      sessionStorage.setItem(setupKey(room), JSON.stringify(setup));
    } catch {
      // No storage: the table opens empty and is set up there instead.
    }
    location.search = `?room=${room}&setup${solo ? '&vs=computer' : ''}`;
  };

  return (
    <SitePage page="play" wide>
      <section className="narrative-menu battle-menu">
        <header>
          <h1>New battle</h1>
          <p className="lead">Choose what to play, then go straight to the table. You can still move terrain and models round there before the battle starts.</p>
        </header>

        <h2>1. Choose your opponent</h2>
        <div className="narrative-sides">
          <button className={`side-card ${vs === 'friend' ? 'on' : ''}`} aria-pressed={vs === 'friend'} onClick={() => setVs('friend')}>
            <b>A friend</b>
            <span>Send them the game's link. They pick their own army at the table.</span>
          </button>
          <button className={`side-card ${solo ? 'on' : ''}`} aria-pressed={solo} onClick={() => setVs('computer')}>
            <b>{BOT_NAME}</b>
            <span>The computer plays the other side.</span>
          </button>
        </div>

        <h2>2. Choose a scenario</h2>
        <div className="story-grid scenario-grid">
          <button className={`story-card ${shownScenario === 'roll' ? 'on' : ''}`} aria-pressed={shownScenario === 'roll'} onClick={() => setScenario('roll')}>
            <span className="die-art" aria-hidden>
              🎲
            </span>
            <span className="story-text">
              <b>Roll for it</b>
              <span>A D6 picks one of the six pools, then another picks the scenario in it.</span>
            </span>
          </button>
          {!solo && (
            <button className={`story-card ${shownScenario === 'open' ? 'on' : ''}`} aria-pressed={shownScenario === 'open'} onClick={() => setScenario('open')}>
              <span className="die-art" aria-hidden>
                ⚔
              </span>
              <span className="story-text">
                <b>Open play</b>
                <span>No scenario: set up where you agree and play it out.</span>
              </span>
            </button>
          )}
        </div>
        <p className="deploy-legend">
          <span>
            <i className="p1" />
            Player 1
          </span>
          <span>
            <i className="p2" />
            Player 2
          </span>
          <span>
            <i className="obj" />
            Objective
          </span>
          <span>Striped: the D6 1-3 zone · Bars and arrows: edges warbands arrive from</span>
        </p>
        {POOLS.slice(1).map((pool, i) => (
          <div key={pool} className="pool">
            <h3>{pool}</h3>
            <div className="story-grid scenario-grid">
              {SCENARIOS.filter(s => s.pool === i + 1).map(s => (
                <button key={s.id} className={`story-card ${shownScenario === s.id ? 'on' : ''}`} aria-pressed={shownScenario === s.id} onClick={() => setScenario(s.id)}>
                  <DeployThumb s={s} />
                  <span className="story-text">
                    <b>{s.name}</b>
                    <small className="muted">{DEPLOY[s.deployment.type] ?? s.deployment.type}</small>
                    <span>{s.scoring[0]?.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <h2>3. Choose a table</h2>
        <div className="story-grid">
          {STARTER_BOARDS.map(b => (
            <button key={b.id} className={`story-card ${table === `board:${b.id}` ? 'on' : ''}`} aria-pressed={table === `board:${b.id}`} onClick={() => setTable(`board:${b.id}`)}>
              <MapPreview w={b.w} h={b.h} terrain={starterTerrain(b, newId)} />
              <span className="story-text">
                <b>{b.name}</b>
                <span>{b.blurb}</span>
              </span>
            </button>
          ))}
          <button className={`story-card ${table === 'empty' ? 'on' : ''}`} aria-pressed={table === 'empty'} onClick={() => setTable('empty')}>
            <MapPreview w={48} h={48} terrain={[]} />
            <span className="story-text">
              <b>An empty table</b>
              <span>Lay out the terrain yourself at the table.</span>
            </span>
          </button>
          {fromLink && (
            <button className={`story-card ${table === `map:${fromLink.id}` ? 'on' : ''}`} aria-pressed={table === `map:${fromLink.id}`} onClick={() => setTable(`map:${fromLink.id}`)}>
              <MapPreview w={fromLink.data.w} h={fromLink.data.h} terrain={fromLink.data.terrain ?? []} />
              <span className="story-text">
                <b>{fromLink.name}</b>
                <span>The map you picked on the Maps page.</span>
              </span>
            </button>
          )}
        </div>
        {enabled && (
          <details className="story-brief">
            <summary>Or play on a saved map</summary>
            <div className="row seg page-tabs">
              <button className={mapTab === 'shared' ? 'on' : ''} onClick={() => setMapTab('shared')}>
                Community maps
              </button>
              <button className={mapTab === 'mine' ? 'on' : ''} onClick={() => setMapTab('mine')}>
                My maps
              </button>
            </div>
            {mapTab === 'mine' && !profile && <p className="muted">Sign in with Discord to see the maps you've saved.</p>}
            {maps === null && <p className="muted">Loading maps…</p>}
            {maps?.length === 0 && (mapTab === 'shared' || profile) && <p className="muted">No maps here yet.</p>}
            <div className="story-grid">
              {maps?.map(m => (
                <button key={m.id} className={`story-card ${table === `map:${m.id}` ? 'on' : ''}`} aria-pressed={table === `map:${m.id}`} onClick={() => setTable(`map:${m.id}`)}>
                  <MapPreview w={m.data.w} h={m.data.h} terrain={m.data.terrain ?? []} />
                  <span className="story-text">
                    <b>{m.name}</b>
                    <small className="muted">
                      {m.data.w}"×{m.data.h}"{m.author ? ` · by ${m.author}` : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}

        <h2>4. Choose your army</h2>
        <div className="row seg page-tabs">
          <button className={mode === 'lists' ? 'on' : ''} onClick={() => setMode('lists')}>
            My lists
          </button>
          <button className={mode === 'premade' ? 'on' : ''} onClick={() => setMode('premade')}>
            Premade
          </button>
          <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>
            Pick it at the table
          </button>
        </div>
        {mode === 'lists' &&
          (lists.length ? (
            <div className="story-grid army-grid">
              {lists.map(r => (
                <button key={r.id} className={`side-card ${list === r.id ? 'on' : ''}`} aria-pressed={list === r.id} onClick={() => setList(r.id)}>
                  <b>{r.name}</b>
                  <span>{r.army}</span>
                  <small>{catalog ? `${listPoints(r)} pts` : ' '}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              You haven't built any lists yet. Build one on the <a href="?armies">Armies</a> page, or take a premade army.
            </p>
          ))}
        {mode === 'premade' && (
          <>
            {(['Good', 'Evil'] as const).map(side => (
              <div key={side} className="pool">
                <h3>{side}</h3>
                <div className="story-grid army-grid">
                  {PREMADE.filter(p => (side === 'Good' ? p.seed < 20 : p.seed >= 20)).map(p => (
                    <button key={p.id} className={`side-card ${premade === p.id ? 'on' : ''}`} aria-pressed={premade === p.id} onClick={() => setPremade(p.id)}>
                      <b>{p.name}</b>
                      <span>{p.army}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <label className="mini-stat">
              Points
              <input className="points" type="number" min={100} max={2000} step={50} value={points} onChange={e => setPoints(Math.max(100, Math.min(2000, Number(e.target.value) || 500)))} />
            </label>
          </>
        )}
        {mode === 'table' && <p className="muted">Build, import or pick your army in the set-up card once you're at the table.</p>}

        {solo && (
          <>
            <h2>5. Choose {BOT_NAME}'s army</h2>
            <div className="row wrap">
              <select value={foe} onChange={e => setFoe(e.target.value)} aria-label={`${BOT_NAME}'s army`}>
                <optgroup label="A random list from">
                  <option value="random">Any army</option>
                  {catalog &&
                    playableArmies(catalog).map(a => (
                      <option key={a} value={`army:${a}`}>
                        {a}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Premade armies">
                  {PREMADE.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.army})
                    </option>
                  ))}
                </optgroup>
              </select>
              <label className="mini-stat">
                Points
                <input className="points" type="number" min={100} max={2000} step={50} value={theirPoints} onChange={e => setFoePoints(Math.max(100, Math.min(2000, Number(e.target.value) || 500)))} />
              </label>
            </div>
          </>
        )}

        <button className="primary go story-start" disabled={!catalog || !armyReady || busy || (table.startsWith('map:') && !chosenMap && maps === null)} onClick={() => void play()}>
          {busy ? 'Setting up…' : `Play ${shownScenario === 'roll' ? 'a rolled scenario' : shownScenario === 'open' ? 'open play' : scenarioById(shownScenario)?.name} →`}
        </button>
      </section>
    </SitePage>
  );
}
