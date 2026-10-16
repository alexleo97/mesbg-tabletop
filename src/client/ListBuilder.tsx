import { useEffect, useMemo, useState } from 'react';
import { entriesFor, entryPoints, isHeroType, loadCatalog, pictureUrl, type Catalog, type CatalogUnit } from '../shared/catalog.ts';
import type { ListEntry } from '../shared/importList.ts';

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

const uid = () => Math.random().toString(36).slice(2, 10);

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

/** Builds an army from the bundled MESBG data and hands the result to `onDeploy`. */
export function ListBuilder({ onDeploy, deployLabel }: { onDeploy: (entries: ListEntry[], name: string) => void; deployLabel: string }) {
  const { catalog, error } = useCatalog();
  const [saved, setSaved] = useState<Roster[]>(loadSaved);
  const [roster, setRoster] = useState<Roster>(() => saved[0] ?? { id: uid(), name: 'My list', army: '', entries: [] });
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  // Keep the current list saved as it's edited.
  useEffect(() => {
    if (!roster.army && roster.entries.length === 0) return;
    setSaved(prev => {
      const next = [roster, ...prev.filter(r => r.id !== roster.id)].slice(0, 30);
      saveAll(next);
      return next;
    });
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
    onDeploy(entries, roster.name);
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
              setSaved(next);
              setRoster(next[0] ?? { id: uid(), name: 'My list', army: '', entries: [] });
            }}
          >
            ✕
          </button>
        )}
      </div>
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

          <button className="primary" disabled={!roster.entries.length} onClick={deploy}>
            {deployLabel}
          </button>
          <p className="fine">Points and options come from the MESBG List Builder's data. Warband sizes and bow limits aren't checked here.</p>
        </>
      )}
    </div>
  );
}
