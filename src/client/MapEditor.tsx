import { useEffect, useMemo, useState } from 'react';
import { initialState, reduce } from '../shared/reducer.ts';
import type { Terrain } from '../shared/types.ts';
import { Board, type Tool } from './Board.tsx';
import { signIn, useAuth } from './auth.ts';
import { createMap, getMap, updateMap } from './cloud.ts';
import { SiteNav } from './Home.tsx';
import { TablePanel } from './Panels.tsx';
import { PracticeGame } from './practice.ts';
import { useRoom } from './net.ts';
import type { Settings } from './settings.ts';

const DRAFT_KEY = 'mesbg-tabletop:map-draft';

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (d?.board && d?.terrain) return reduce(initialState(), { type: 'setScenery', w: d.board.w, h: d.board.h, mat: d.board.mat, terrain: d.terrain });
  } catch {
    // No draft, or storage blocked: start from an empty table.
  }
  return initialState();
}

/** Lay out a table and save it as a map, without starting a game. `?mapeditor=<id>` edits one of your maps. */
export function MapEditor({ settings }: { settings: Settings }) {
  const editId = useMemo(() => new URLSearchParams(location.search).get('mapeditor') || null, []);
  const game = useMemo(() => new PracticeGame(editId ? initialState() : loadDraft()), []);
  const { state } = useRoom(game);
  const { enabled, profile } = useAuth();
  const [tool, setTool] = useState<Tool>('move');
  const [selectedTerrain, setSelectedTerrain] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(true);
  const [note, setNote] = useState('');
  const [mapId, setMapId] = useState<string | null>(editId);
  const dispatch = game.dispatch.bind(game);

  // Editing a saved map: lay it out once it's loaded.
  useEffect(() => {
    if (!editId) return;
    void getMap(editId).then(m => {
      if (!m) return setNote("Couldn't load that map, so you're starting from an empty table.");
      setName(m.name);
      setShared(m.public);
      dispatch({ type: 'setScenery', w: m.data.w, h: m.data.h, mat: m.data.mat, terrain: m.data.terrain ?? [] });
    });
  }, [editId]);

  // Keep a new map's work in this browser in case the page is closed before saving.
  useEffect(() => {
    if (mapId) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ board: state.board, terrain: Object.values(state.terrain) }));
    } catch {
      // Storage blocked: the draft just isn't kept.
    }
  }, [state.terrain, state.board, mapId]);

  const terrain = Object.values(state.terrain);
  const save = async () => {
    if (!terrain.length) return setNote('Add some terrain first.');
    const data = { w: state.board.w, h: state.board.h, mat: state.board.mat, terrain: terrain.map((t: Terrain) => ({ ...t, locked: true })) };
    const title = name.trim() || 'Untitled map';
    if (mapId) {
      await updateMap(mapId, { name: title, public: shared, data });
      setNote(`Saved changes to "${title}".`);
      return;
    }
    const id = await createMap(title, data, shared);
    if (!id) return setNote("Couldn't save the map. Try again in a moment.");
    setMapId(id);
    setNote(`Saved "${title}". Find it under Maps › My maps.`);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
  };

  return (
    <div className="site editor-page">
      <SiteNav page="maps" />
      <div className="editor">
        <div className="editor-stage">
          <Board
            state={state}
            tool={tool}
            selected={new Set()}
            setSelected={() => {}}
            selectedTerrain={selectedTerrain}
            setSelectedTerrain={setSelectedTerrain}
            dispatch={dispatch}
            showZones={false}
            showDeployment={settings.deployment}
            showGrid={settings.grid}
            photoFor={() => undefined}
          />
          <div className="tool-rail" role="toolbar" aria-label="Tools">
            {(
              [
                ['move', '✋', 'Drag'],
                ['measure', '📏', 'Measure'],
              ] as const
            ).map(([t, icon, label]) => (
              <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={label} aria-label={label}>
                <span>{icon}</span>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </div>
        <aside className="editor-side">
          <div className="panel-body editor-save">
            <h3>{mapId ? 'Edit map' : 'New map'}</h3>
            <p className="hint">Pick a starter board or add pieces below, then drag them into place. Tap a piece to resize, rotate or delete it.</p>
            {enabled && profile ? (
              <>
                <input placeholder="Name this map, e.g. Ruins of Osgiliath" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
                <label className="check">
                  <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Share it with the community
                </label>
                <button className="primary" onClick={() => void save()}>
                  {mapId ? 'Save changes' : 'Save map'}
                </button>
              </>
            ) : enabled ? (
              <button className="discord-signin" onClick={() => void signIn()}>
                Sign in with Discord to save
              </button>
            ) : (
              <p className="hint">Saving maps isn't switched on for this site.</p>
            )}
            {note && <p className="hint">{note}</p>}
          </div>
          <TablePanel state={state} dispatch={dispatch} role="p1" selectedTerrain={selectedTerrain} setSelectedTerrain={setSelectedTerrain} editor />
        </aside>
      </div>
    </div>
  );
}
