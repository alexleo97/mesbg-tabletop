import { useEffect, useState } from 'react';
import type { GameState, Terrain } from '../shared/types.ts';
import { useAuth } from './auth.ts';
import { deleteMap, listMaps, saveMap, type SavedMap } from './cloud.ts';

type Dispatch = (a: import('../shared/types.ts').Action) => void;

/** Save the table as a map on your account, and load your own or other players' shared maps. */
export function MapsSection({ state, dispatch, onLoaded }: { state: GameState; dispatch: Dispatch; onLoaded: () => void }) {
  const { enabled, profile } = useAuth();
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [maps, setMaps] = useState<SavedMap[] | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(true);
  const [note, setNote] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled || (tab === 'mine' && !profile)) return;
    let alive = true;
    setMaps(null);
    void listMaps(tab).then(m => alive && setMaps(m ?? []));
    return () => {
      alive = false;
    };
  }, [enabled, profile?.id, tab, refresh]);

  if (!enabled) return null;
  const terrain = Object.values(state.terrain).filter(t => t.kind !== 'objective');

  const save = async () => {
    if (!terrain.length) return setNote('Add some terrain first.');
    const problem = await saveMap(name, { w: state.board.w, h: state.board.h, mat: state.board.mat, terrain: terrain.map(t => ({ ...t, locked: true })) }, shared);
    setNote(problem ?? `Saved "${name.trim() || 'Untitled map'}".`);
    if (!problem) {
      setName('');
      setTab('mine');
      setRefresh(n => n + 1);
    }
  };

  const load = (m: SavedMap) => {
    if (Object.keys(state.terrain).length && !confirm(`Replace the current terrain with ${m.name}? Models stay where they are.`)) return;
    const terrain = (m.data.terrain ?? []).map((t: Terrain) => ({ ...t, id: `t-${Math.random().toString(36).slice(2, 9)}` }));
    dispatch({ type: 'setScenery', w: m.data.w, h: m.data.h, mat: m.data.mat, terrain });
    onLoaded();
    setNote(`Loaded "${m.name}".`);
  };

  return (
    <section className="maps">
      <h4>Maps</h4>
      {profile ? (
        <div className="map-save">
          <div className="row">
            <input placeholder="Name this table, e.g. Ruins of Osgiliath" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
            <button className="shrink" onClick={() => void save()}>
              Save map
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Share it with other players
          </label>
        </div>
      ) : (
        <p className="hint">Sign in with Discord on the home page to save this table as a map.</p>
      )}
      {note && <p className="hint">{note}</p>}
      <div className="row seg">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          My maps
        </button>
        <button className={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>
          Shared maps
        </button>
      </div>
      {tab === 'mine' && !profile ? null : maps === null ? (
        <p className="hint">Loading maps…</p>
      ) : maps.length === 0 ? (
        <p className="hint">{tab === 'mine' ? 'No saved maps yet.' : 'Nobody has shared a map yet. Be the first!'}</p>
      ) : (
        <ul className="map-list">
          {maps.map(m => (
            <li key={m.id}>
              <button className="map-load" onClick={() => load(m)}>
                <b>{m.name}</b>
                <small>
                  {m.data.w}×{m.data.h}" · {m.data.terrain?.length ?? 0} pieces
                  {tab === 'shared' && m.author ? ` · by ${m.author}` : ''}
                  {tab === 'mine' && !m.public ? ' · private' : ''}
                </small>
              </button>
              {m.owner === profile?.id && (
                <button
                  className="shrink danger"
                  aria-label={`Delete ${m.name}`}
                  onClick={async () => {
                    if (!confirm(`Delete "${m.name}"?`)) return;
                    await deleteMap(m.id);
                    setRefresh(n => n + 1);
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
