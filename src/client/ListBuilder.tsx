import { useEffect, useMemo, useRef, useState } from 'react';
import { entriesFor, entryPoints, isHeroType, loadCatalog, pictureUrl, type Catalog, type CatalogUnit } from '../shared/catalog.ts';
import type { ListEntry } from '../shared/importList.ts';
import { useAuth } from './auth.ts';
import { cloudLists, deleteCloudList, isUuid, mergeLists, newUuid, saveCloudList } from './cloud.ts';

interface RosterEntry {
  key: string;
  unitId: string;
  count: number;
  optionIds: string[];
}

export interface Roster {
  id: string;
  name: string;
  army: string;
  entries: RosterEntry[];
  /** When it was last changed, to tell which copy is newer when syncing with your account. */
  updatedAt?: number;
}

const STORE_KEY = 'mesbg-tabletop:lists';

function loadSaved(): Roster[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveAll(lists: Roster[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(lists));
  } catch {
    // Storage unavailable (private browsing); lists just won't persist.
  }
}

const uid = newUuid;
/** A list's contents, ignoring when it was saved. */
const same = (a: Roster | undefined, b: Roster) => !!a && JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    loadCatalog().then(setCatalog, () => setError(true));
  }, []);
  return { catalog, error };
}

export function Portrait({ unit, size = 40 }: { unit: Pick<CatalogUnit, 'origin' | 'name'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="portrait fallback" style={{ width: size, height: size }} />;
  return <img className="portrait" src={pictureUrl(unit)} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}

/** Your saved lists, each ready to deploy in one tap. */
export function SavedLists({ onDeploy, onBuild }: { onDeploy: (entries: ListEntry[], name: string) => void; onBuild: () => void }) {
  const { catalog, error } = useCatalog();
  const { profile } = useAuth();
  const [lists, setLists] = useState<Roster[]>(loadSaved);
  // Signed in: pick up lists built on another device.
  useEffect(() => {
    if (!profile) return;
    void cloudLists().then(cloud => cloud && setLists(mergeLists(loadSaved(), cloud)));
  }, [profile?.id]);

  if (error) return <p className="hint">Couldn't load the unit data. Check your connection and reopen this tab.</p>;
  if (!catalog) return <p className="hint">Loading armies…</p>;
  const ready = lists.filter(r => r.entries.length);
  return (
    <div className="saved-lists">
      {ready.length === 0 ? (
        <p className="hint">You haven't built any lists yet.</p>
      ) : (
        <ul className="list-cards">
          {ready.map(r => {
            const pts = r.entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);
            const models = r.entries.reduce((a, e) => a + e.count * Math.max(1, catalog.units[e.unitId]?.mwfw?.length ?? 1), 0);
            return (
              <li key={r.id}>
                <span className="list-card-name">
                  <b>{r.name}</b>
                  <small>
                    {r.army} · {pts} pts · {models} models
                  </small>
                </span>
                <button
                  className="primary shrink"
                  onClick={() =>
                    onDeploy(
                      r.entries.flatMap(e => {
                        const unit = catalog.units[e.unitId];
                        return unit ? entriesFor(e.unitId, unit, e.optionIds, e.count) : [];
                      }),
                      r.name,
                    )
                  }
                >
                  Deploy
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row wrap">
        <button onClick={onBuild}>Build or edit a list here</button>
        <a className="button-link" href="?armies" target="_blank" rel="noreferrer">
          Open the Armies page
        </a>
      </div>
    </div>
  );
}

/** Builds an army from the bundled MESBG data and, in a game, hands the result to `onDeploy`. */
export function ListBuilder({ onDeploy, deployLabel }: { onDeploy?: (entries: ListEntry[], name: string) => void; deployLabel?: string }) {
  const { catalog, error } = useCatalog();
  const [saved, setSaved] = useState<Roster[]>(loadSaved);
  const [roster, setRoster] = useState<Roster>(() => saved[0] ?? { id: uid(), name: 'My list', army: '', entries: [] });
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const { profile } = useAuth();
  const [synced, setSynced] = useState<'off' | 'syncing' | 'saved' | 'failed'>('off');
  const upload = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointsOf = (r: Roster) => (catalog ? r.entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0) : undefined);

  // Signed in: bring this browser's lists and your account's together, then keep them in step.
  useEffect(() => {
    if (!profile) return setSynced('off');
    let alive = true;
    setSynced('syncing');
    void cloudLists().then(async cloud => {
      if (!alive) return;
      if (!cloud) return setSynced('failed');
      // Lists made before accounts existed get an id the database accepts.
      const local = loadSaved().map(r => (isUuid(r.id) ? r : { ...r, id: newUuid() }));
      const merged = mergeLists(local, cloud).slice(0, 30);
      const newer = merged.filter(r => !same(cloud.find(c => c.id === r.id), r) || (r.updatedAt ?? 0) > (cloud.find(c => c.id === r.id)?.updatedAt ?? 0));
      const ok = (await Promise.all(newer.map(r => saveCloudList(r)))).every(Boolean);
      if (!alive) return;
      saveAll(merged);
      setSaved(merged);
      setRoster(cur => merged.find(r => r.id === cur.id) ?? merged[0] ?? cur);
      setSynced(ok ? 'saved' : 'failed');
    });
    return () => {
      alive = false;
    };
  }, [profile?.id]);

  // Keep the current list saved as it's edited, in this browser and on your account.
  useEffect(() => {
    if (!roster.army && roster.entries.length === 0) return;
    if (same(saved.find(r => r.id === roster.id), roster)) return;
    const stamped = { ...roster, updatedAt: Date.now() };
    setSaved(prev => {
      const next = [stamped, ...prev.filter(r => r.id !== roster.id)].slice(0, 30);
      saveAll(next);
      return next;
    });
    if (!profile) return;
    clearTimeout(upload.current);
    upload.current = setTimeout(() => void saveCloudList(stamped, pointsOf(stamped)).then(ok => setSynced(ok ? 'saved' : 'failed')), 1200);
  }, [roster]);

  const armies = useMemo(() => {
    if (!catalog) return { Good: [], Evil: [] } as Record<string, string[]>;
    const groups: Record<string, string[]> = {};
    for (const [name, a] of Object.entries(catalog.armies)) (groups[a.side] ??= []).push(name);
    for (const g of Object.values(groups)) g.sort();
    return groups;
  }, [catalog]);

  if (error) return <p className="hint">Couldn't load the unit data. Check your connection and reopen this tab.</p>;
  if (!catalog) return <p className="hint">Loading armies…</p>;

  const unitsInArmy = roster.army
    ? catalog.armies[roster.army].units
        .map(id => [id, catalog.units[id]] as const)
        .filter(([, u]) => u.name.toLowerCase().includes(filter.toLowerCase()))
        .sort(([, a], [, b]) => Number(isHeroType(b.type)) - Number(isHeroType(a.type)) || b.points - a.points)
    : [];

  const update = (key: string, patch: Partial<RosterEntry>) =>
    setRoster(r => ({ ...r, entries: r.entries.map(e => (e.key === key ? { ...e, ...patch } : e)) }));

  const total = roster.entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);
  const models = roster.entries.reduce((a, e) => a + e.count * Math.max(1, catalog.units[e.unitId]?.mwfw?.length ?? 1), 0);
  const heroes = roster.entries.filter(e => isHeroType(catalog.units[e.unitId]?.type ?? '')).reduce((a, e) => a + e.count, 0);

  const toggleOption = (e: RosterEntry, unit: CatalogUnit, optId: string) => {
    const on = e.optionIds.includes(optId);
    const optionIds = on ? e.optionIds.filter(o => o !== optId) : unit.pickOne ? [optId] : [...e.optionIds, optId];
    update(e.key, { optionIds });
  };

  const deploy = () => {
    const entries = roster.entries.flatMap(e => {
      const unit = catalog.units[e.unitId];
      return unit ? entriesFor(e.unitId, unit, e.optionIds, e.count) : [];
    });
    onDeploy?.(entries, roster.name);
  };

  return (
    <div className="builder">
      <div className="row">
        <select
          aria-label="Saved lists"
          value={roster.id}
          onChange={e => {
            const r = saved.find(x => x.id === e.target.value);
            if (r) setRoster(r);
          }}
        >
          {!saved.some(r => r.id === roster.id) && <option value={roster.id}>{roster.name}</option>}
          {saved.map(r => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.army ? ` (${r.army})` : ''}
            </option>
          ))}
        </select>
        <button className="shrink" onClick={() => setRoster({ id: uid(), name: 'New list', army: roster.army, entries: [] })}>
          New
        </button>
        {saved.some(r => r.id === roster.id) && (
          <button
            className="shrink danger"
            aria-label="Delete list"
            onClick={() => {
              if (!confirm(`Delete "${roster.name}"?`)) return;
              const next = saved.filter(r => r.id !== roster.id);
              saveAll(next);
              if (profile) void deleteCloudList(roster.id);
              setSaved(next);
              setRoster(next[0] ?? { id: uid(), name: 'My list', army: '', entries: [] });
            }}
          >
            ✕
          </button>
        )}
      </div>
      <p className="hint sync">
        {synced === 'off' && 'Lists are kept in this browser. Sign in with Discord to keep them on every device.'}
        {synced === 'syncing' && 'Syncing with your account…'}
        {synced === 'saved' && '✓ Saved to your account'}
        {synced === 'failed' && "Couldn't reach your account, so changes are only in this browser for now."}
      </p>
      <input aria-label="List name" value={roster.name} onChange={e => setRoster(r => ({ ...r, name: e.target.value }))} />
      <select aria-label="Army" value={roster.army} onChange={e => setRoster(r => ({ ...r, army: e.target.value }))}>
        <option value="">Choose an army…</option>
        {Object.entries(armies).map(([side, names]) => (
          <optgroup key={side} label={side}>
            {names.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {roster.army && (
        <>
          <div className="roster-summary">
            <b>{total} pts</b>
            <span>
              {models} models · {heroes} hero{heroes === 1 ? '' : 'es'}
            </span>
          </div>

          <ul className="roster">
            {roster.entries.map(e => {
              const unit = catalog.units[e.unitId];
              if (!unit) return null;
              const hero = isHeroType(unit.type);
              return (
                <li key={e.key}>
                  <div className="roster-head">
                    <Portrait unit={unit} />
                    <div className="roster-name">
                      <b>{unit.name}</b>
                      <small>
                        {unit.type} · {entryPoints(unit, e.optionIds, e.count)} pts
                      </small>
                    </div>
                    <button className="shrink" aria-label={`Remove ${unit.name}`} onClick={() => setRoster(r => ({ ...r, entries: r.entries.filter(x => x.key !== e.key) }))}>
                      ✕
                    </button>
                  </div>
                  {!unit.unique && !hero && (
                    <div className="stepper">
                      <span>Models</span>
                      <button onClick={() => update(e.key, { count: Math.max(1, e.count - 1) })} aria-label="Fewer">
                        −
                      </button>
                      <b>{e.count}</b>
                      <button onClick={() => update(e.key, { count: Math.min(100, e.count + 1) })} aria-label="More">
                        +
                      </button>
                    </div>
                  )}
                  {unit.options.filter(o => !o.included).length > 0 && (
                    <div className="options">
                      {unit.options
                        .filter(o => !o.included)
                        .map(o => (
                          <label key={o.id} className="check">
                            <input type="checkbox" checked={e.optionIds.includes(o.id)} onChange={() => toggleOption(e, unit, o.id)} />
                            {o.name} <small>({o.points} pts)</small>
                          </label>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {adding ? (
            <div className="unit-picker">
              <div className="row">
                <input autoFocus placeholder="Search units" value={filter} onChange={e => setFilter(e.target.value)} />
                <button className="shrink" onClick={() => setAdding(false)}>
                  Done
                </button>
              </div>
              <ul>
                {unitsInArmy.map(([id, u]) => {
                  const taken = u.unique && roster.entries.some(e => e.unitId === id);
                  return (
                    <li key={id}>
                      <button
                        disabled={taken}
                        onClick={() =>
                          setRoster(r => ({
                            ...r,
                            entries: [...r.entries, { key: uid(), unitId: id, count: isHeroType(u.type) || u.unique ? 1 : 5, optionIds: [] }],
                          }))
                        }
                      >
                        <Portrait unit={u} size={32} />
                        <span className="unit-name">
                          {u.name}
                          <small>{u.type}</small>
                        </span>
                        <span className="pts">{u.points}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}>+ Add units</button>
          )}

          {onDeploy && (
            <button className="primary" disabled={!roster.entries.length} onClick={deploy}>
              {deployLabel}
            </button>
          )}
          <p className="fine">Points and options come from the MESBG List Builder's data. Warband sizes and bow limits aren't checked here.</p>
        </>
      )}
    </div>
  );
}
