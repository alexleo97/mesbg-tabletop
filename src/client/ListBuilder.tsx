import { useEffect, useMemo, useRef, useState } from 'react';
import { entriesFor, entryPoints, isHeroType, loadCatalog, loadRulesText, pictureUrl, STAT_NAMES, statsWithOptions, type Catalog, type CatalogArmy, type CatalogUnit } from '../shared/catalog.ts';
import { armyLeader, checkList, isWarrior, leadsWarband, modelCount, organise, tierOf, type WarbandEntry } from '../shared/warbands.ts';
import RULES from '../data/special-rules.json';
import type { ListEntry } from '../shared/importList.ts';
import { useAuth } from './auth.ts';
import { cloudLists, deleteCloudList, isUuid, mergeLists, newUuid, saveCloudList } from './cloud.ts';

type RosterEntry = WarbandEntry;

export interface Roster {
  id: string;
  name: string;
  army: string;
  entries: RosterEntry[];
  /** Key of the hero picked to lead the army; otherwise the highest tier hero leads. */
  leader?: string;
  /** The game size you're building for, if you've set one. */
  points?: number;
  /** When it was last changed, to tell which copy is newer when syncing with your account. */
  updatedAt?: number;
}

const STORE_KEY = 'mesbg-tabletop:lists';

export function loadSaved(): Roster[] {
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

/** The plain-words explanation of every rule, once it has loaded. */
export function useRulesText() {
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    loadRulesText().then(setText, () => {});
  }, []);
  return text;
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
export function ListBuilder({ onDeploy, deployLabel, wide: page }: { onDeploy?: (entries: ListEntry[], name: string) => void; deployLabel?: string; wide?: boolean }) {
  // On the Armies page with room to spare, the unit picker and guide sit beside the list.
  const [roomy, setRoomy] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(min-width: 900px)');
    const on = () => setRoomy(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const wide = !!page && roomy;
  const { catalog, error } = useCatalog();
  const [saved, setSaved] = useState<Roster[]>(loadSaved);
  const [roster, setRoster] = useState<Roster>(() => saved[0] ?? { id: uid(), name: 'My list', army: '', entries: [] });
  const [filter, setFilter] = useState('');
  /** What the unit picker is adding: a hero (new warband), or warriors for the warband `lead` heads. */
  const [picking, setPicking] = useState<{ lead?: string } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

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

  const update = (key: string, patch: Partial<RosterEntry>) =>
    setRoster(r => ({ ...r, entries: r.entries.map(e => (e.key === key ? { ...e, ...patch } : e)) }));
  const remove = (key: string) => setRoster(r => ({ ...r, entries: r.entries.filter(x => x.key !== key) }));

  const total = roster.entries.reduce((a, e) => a + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);
  const models = roster.entries.reduce((a, e) => a + modelCount(catalog.units[e.unitId], e.count), 0);
  const { warbands, independents, loose } = organise(roster.entries, catalog);
  const leader = armyLeader(roster.entries, catalog, roster.leader);
  const army = catalog.armies[roster.army] as CatalogArmy | undefined;
  const checks = checkList(roster.entries, catalog, roster.points, army?.bowLimit);

  const toggleOption = (e: RosterEntry, unit: CatalogUnit, optId: string) => {
    const on = e.optionIds.includes(optId);
    const optionIds = on ? e.optionIds.filter(o => o !== optId) : unit.pickOne ? [optId] : [...e.optionIds, optId];
    update(e.key, { optionIds });
  };

  const add = (id: string, u: CatalogUnit) => {
    const lead = picking?.lead;
    const w = warbands.find(x => x.leader.key === lead);
    const room = w ? w.max - w.size : 5;
    // Big models like trolls start at one; rank-and-file start at five, or what the warband has room for.
    const big = Number(u.stats?.[6] ?? 1) > 1;
    const count = isHeroType(u.type) || u.unique || u.type === 'Siege Engine' || big ? 1 : Math.max(1, Math.min(5, room));
    const key = uid();
    setRoster(r => ({ ...r, entries: [...r.entries, { key, unitId: id, count, optionIds: [], lead }] }));
    // A new hero is usually followed by their warriors, so go straight to picking those.
    if (leadsWarband(u)) setPicking({ lead: key });
  };

  const deploy = () => {
    const entries = roster.entries.flatMap(e => {
      const unit = catalog.units[e.unitId];
      return unit ? entriesFor(e.unitId, unit, e.optionIds, e.count) : [];
    });
    onDeploy?.(entries, roster.name);
  };

  // The one thing to do next, so a new player always knows where they are.
  const empty = warbands.find(w => w.size === 0);
  const next = !roster.army
    ? 'Start by choosing an army. Each one has its own heroes, warriors and bonuses.'
    : !warbands.length
      ? 'Add a hero first: every warband is led by one.'
      : empty
        ? `Add warriors to ${empty.unit.name}'s warband (up to ${empty.max}).`
        : roster.points && total < roster.points
          ? `You have ${roster.points - total} pts left: add warriors, or another hero with a warband of their own.`
          : null;

  const item = (e: RosterEntry, opts: { lead?: boolean } = {}) => {
    const unit = catalog.units[e.unitId];
    if (!unit) return null;
    const hero = isHeroType(unit.type);
    const open = openCard === e.key;
    return (
      <li key={e.key} className={opts.lead ? 'warband-lead' : ''}>
        <div className="roster-head">
          <Portrait unit={unit} />
          <div className="roster-name">
            <b>
              {unit.name}
              {leader?.key === e.key && <span className="leader-badge">★ Leader</span>}
            </b>
            <small>
              {unit.type} · {entryPoints(unit, e.optionIds, e.count)} pts
            </small>
          </div>
          {hero && leader?.key !== e.key && (
            <button className="shrink icon-btn" title="Make this hero your army's leader" onClick={() => setRoster(r => ({ ...r, leader: e.key }))}>
              ☆
            </button>
          )}
          <button className={`shrink icon-btn ${open ? 'on' : ''}`} aria-expanded={open} title="Show the unit card" onClick={() => setOpenCard(open ? null : e.key)}>
            ⓘ
          </button>
          <button className="shrink icon-btn" aria-label={`Remove ${unit.name}`} onClick={() => remove(e.key)}>
            ✕
          </button>
        </div>
        {!unit.unique && !hero && unit.type !== 'Siege Engine' && (
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
        {!hero && warbands.length > 1 && (
          <label className="move-to">
            <small>Warband</small>
            <select value={warbands.find(w => w.members.includes(e))?.leader.key ?? ''} onChange={ev => update(e.key, { lead: ev.target.value })}>
              {warbands.map(w => (
                <option key={w.leader.key} value={w.leader.key}>
                  {w.unit.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {open && <UnitCard unit={unit} optionIds={e.optionIds} />}
      </li>
    );
  };

  const pickFor = picking?.lead ? warbands.find(w => w.leader.key === picking.lead) : undefined;
  const pickList = picking
    ? catalog.armies[roster.army].units
        .map(id => [id, catalog.units[id]] as const)
        .filter(([id, u]) => (picking.lead ? isWarrior(u) && (!pickFor?.unit.followers?.length || pickFor.unit.followers.includes(id)) : !isWarrior(u)))
        .filter(([, u]) => u.name.toLowerCase().includes(filter.toLowerCase()))
        .sort(([, a], [, b]) => tierOf(b) - tierOf(a) || b.points - a.points)
    : [];

  const picker = picking && (
    <div className="unit-picker">
      <div className="picker-head">
        <b>{pickFor ? `Add warriors to ${pickFor.unit.name}'s warband` : 'Add a hero'}</b>
        {pickFor && (
          <small>
            {pickFor.size} of {pickFor.max} models
          </small>
        )}
        <button className="shrink" onClick={() => setPicking(null)}>
          Done
        </button>
      </div>
      <input placeholder="Search units" value={filter} onChange={e => setFilter(e.target.value)} />
      <ul>
        {pickList.map(([id, u]) => {
          const taken = u.unique && roster.entries.some(e => e.unitId === id);
          const open = openCard === id;
          return (
            <li key={id}>
              <div className="pick-row">
                <button className="pick-main" disabled={taken} onClick={() => add(id, u)} title={taken ? 'Already in your list' : `Add ${u.name}`}>
                  <Portrait unit={u} size={32} />
                  <span className="unit-name">
                    {u.name}
                    <small>
                      {u.type}
                      {u.warbandSize ? ` · leads ${u.warbandSize}` : ''}
                      {taken ? ' · in your list' : ''}
                    </small>
                  </span>
                  <span className="pts">{u.points}</span>
                </button>
                <button className={`shrink icon-btn ${open ? 'on' : ''}`} aria-expanded={open} title="Show the unit card" onClick={() => setOpenCard(open ? null : id)}>
                  ⓘ
                </button>
              </div>
              {open && <UnitCard unit={u} showOptions />}
            </li>
          );
        })}
        {!pickList.length && <li className="hint">No units match.</li>}
      </ul>
    </div>
  );

  return (
    <div className={`builder ${wide ? 'wide' : ''}`}>
      <div className="row">
        <select
          aria-label="Saved lists"
          value={roster.id}
          onChange={e => {
            const r = saved.find(x => x.id === e.target.value);
            if (r) {
              setRoster(r);
              setPicking(null);
            }
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
        <button
          className="shrink"
          onClick={() => {
            setRoster({ id: uid(), name: 'New list', army: roster.army, entries: [], points: roster.points });
            setPicking(null);
          }}
        >
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
        <button className={`shrink ${showGuide ? 'on' : ''}`} onClick={() => setShowGuide(v => !v)} aria-expanded={showGuide}>
          📖 Guide
        </button>
      </div>
      <p className="hint sync">
        {synced === 'off' && 'Lists are kept in this browser. Sign in with Discord to keep them on every device.'}
        {synced === 'syncing' && 'Syncing with your account…'}
        {synced === 'saved' && '✓ Saved to your account'}
        {synced === 'failed' && "Couldn't reach your account, so changes are only in this browser for now."}
      </p>
      {showGuide && <ArmyGuide close={() => setShowGuide(false)} />}
      <div className="builder-setup">
        <input aria-label="List name" value={roster.name} onChange={e => setRoster(r => ({ ...r, name: e.target.value }))} />
        <select aria-label="Army" value={roster.army} onChange={e => setRoster(r => ({ ...r, army: e.target.value, leader: undefined }))}>
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
        <label className="points-input" title="Type any size, like 750. Leave it empty for no limit.">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            list="points-sizes"
            placeholder="Points limit"
            aria-label="Points limit"
            value={roster.points ?? ''}
            onChange={e => setRoster(r => ({ ...r, points: Math.max(0, Math.round(Number(e.target.value))) || undefined }))}
          />
          <span>pts</span>
        </label>
        <datalist id="points-sizes">
          {POINTS.map(p => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      {next && <p className="next-step">👉 {next}</p>}

      {roster.army && (
        <div className="builder-cols">
          <div className="builder-list">
            <div className="roster-summary">
              <b>
                {total}
                {roster.points ? ` / ${roster.points}` : ''} pts
              </b>
              <span>
                {models} models · {warbands.length} warband{warbands.length === 1 ? '' : 's'}
              </span>
            </div>
            {roster.points ? (
              <div className={`points-bar ${total > roster.points ? 'over' : ''}`} aria-hidden>
                <span style={{ width: `${Math.min(100, (total / roster.points) * 100)}%` }} />
              </div>
            ) : null}
            {roster.entries.length > 0 && (
              <ul className="checks">
                {checks.map((c, i) => (
                  <li key={i} className={c.ok ? 'ok' : 'bad'}>
                    {c.ok ? '✓' : '⚠'} {c.text}
                  </li>
                ))}
              </ul>
            )}

            {warbands.map(w => (
              <section key={w.leader.key} className={`warband ${w.size > w.max ? 'over' : ''}`}>
                <header>
                  <span>Warband</span>
                  <small>
                    {w.size} / {w.max} models
                  </small>
                </header>
                <ul className="roster">
                  {item(w.leader, { lead: true })}
                  {w.members.map(e => item(e))}
                </ul>
                <button className={`add-warriors ${picking?.lead === w.leader.key ? 'on' : ''}`} onClick={() => setPicking({ lead: w.leader.key })}>
                  + Add warriors
                </button>
                {!wide && picking?.lead === w.leader.key && picker}
              </section>
            ))}
            {independents.length > 0 && (
              <section className="warband">
                <header>
                  <span>Independent heroes</span>
                  <small>no warband of their own</small>
                </header>
                <ul className="roster">{independents.map(e => item(e))}</ul>
              </section>
            )}
            {loose.length > 0 && (
              <section className="warband over">
                <header>
                  <span>Not in a warband</span>
                  <small>add a hero to lead them</small>
                </header>
                <ul className="roster">{loose.map(e => item(e))}</ul>
              </section>
            )}

            <button className={`add-hero ${picking && !picking.lead ? 'on' : ''}`} onClick={() => setPicking({})}>
              + Add a hero{warbands.length ? ' (new warband)' : ''}
            </button>
            {!wide && picking && !picking.lead && picker}

            {onDeploy && (
              <button className="primary" disabled={!roster.entries.length} onClick={deploy}>
                {deployLabel}
              </button>
            )}
            {!wide && army && <ArmyInfo name={roster.army} army={army} />}
            <p className="fine">Points, profiles and options come from the MESBG List Builder's data. Rule explanations are in our own words.</p>
          </div>
          {wide && <div className="builder-pick">{picker || (army && <ArmyInfo name={roster.army} army={army} />)}</div>}
        </div>
      )}
    </div>
  );
}

const POINTS = [200, 300, 400, 500, 600, 700, 750, 800, 1000];
const SUMMARIES = RULES as Record<string, string>;

/** A unit's full profile: characteristics, Might/Will/Fate, wargear, options and special rules. */
export function UnitCard({ unit, optionIds = [], showOptions }: { unit: CatalogUnit; optionIds?: string[]; showOptions?: boolean }) {
  const [rule, setRule] = useState<string | null>(null);
  const text = useRulesText();
  const explain = (name: string) => text[unit.ruleRefs?.[name] ?? ''] ?? SUMMARIES[name] ?? SUMMARIES[name.replace(/\s*\(.*$/, '').trim()];
  const chips = (names: string[], label = (n: string) => n) => (
    <div className="row wrap">
      {names.map(n => (
        <button key={n} className={`rule-chip ${rule === n ? 'on' : ''}`} aria-expanded={rule === n} onClick={() => setRule(rule === n ? null : n)}>
          {label(n)}
        </button>
      ))}
    </div>
  );
  const shown = (names: string[]) => rule && names.includes(rule) && <p className="uc-rule">{explain(rule) ?? (Object.keys(text).length ? 'We have no explanation for this rule yet.' : 'Loading…')}</p>;
  const powers = unit.powers ?? [];
  const stats = statsWithOptions(unit, optionIds) ?? unit.stats;
  const hero = isHeroType(unit.type);
  return (
    <div className="unit-card">
      <p className="uc-meta">
        {unit.type}
        {unit.warbandSize ? ` · leads up to ${unit.warbandSize} models` : ''}
        {unit.unique ? ' · unique' : ''} · {unit.points} pts
      </p>
      {stats && (
        <table className="uc-stats">
          <thead>
            <tr>
              {STAT_NAMES.map(n => (
                <th key={n} title={STAT_TITLES[n]}>
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {stats.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {hero &&
        unit.mwfw?.map(([name, v], i) => {
          const [m, w, f] = v.split(':');
          return (
            <p key={i} className="uc-mwf">
              {name && <b>{name}: </b>}
              Might <b>{m}</b> · Will <b>{w}</b> · Fate <b>{f}</b>
            </p>
          );
        })}
      <p className="uc-line">
        <small>Wargear</small> {unit.wargear.join(', ') || 'None'}
      </p>
      {showOptions && unit.options.some(o => !o.included) && (
        <p className="uc-line">
          <small>Options</small>{' '}
          {unit.options
            .filter(o => !o.included)
            .map(o => `${o.name} (${o.points} pts)`)
            .join(', ')}
        </p>
      )}
      {unit.rules.length > 0 && (
        <div className="uc-rules">
          <small>Special rules</small>
          {chips(unit.rules)}
          {shown(unit.rules)}
        </div>
      )}
      {!!unit.heroics?.length && (
        <div className="uc-rules">
          <small>Heroic actions</small>
          {chips(unit.heroics)}
          {shown(unit.heroics)}
        </div>
      )}
      {powers.length > 0 && (
        <div className="uc-rules">
          <small>Magical powers</small>
          {chips(
            powers.map(p => p.name),
            n => {
              const p = powers.find(x => x.name === n)!;
              return `${n} · ${p.range} · ${p.cast}`;
            },
          )}
          {shown(powers.map(p => p.name))}
        </div>
      )}
    </div>
  );
}

const STAT_TITLES: Record<string, string> = {
  Mv: 'Move: how far it moves, in inches',
  Fv: 'Fight value: higher wins drawn fights',
  Sv: 'Shoot value: the roll needed to hit when shooting',
  S: 'Strength: how hard it hits',
  D: 'Defence: how hard it is to wound',
  A: 'Attacks: dice rolled in a fight',
  W: 'Wounds: how many it can lose before it falls',
  C: 'Courage: the roll needed to stay brave',
  I: 'Intelligence: the roll needed to resist some magic and tests',
};

/** Six short steps for building an army, shown only when asked for. */
export function ArmyGuide({ close }: { close?: () => void }) {
  return (
    <section className="army-guide">
      <header>
        <h3>Building an army</h3>
        {close && (
          <button className="shrink icon-btn" onClick={close} aria-label="Close guide">
            ✕
          </button>
        )}
      </header>
      <ol>
        <li>Agree a points limit with your opponent and type it in.</li>
        <li>Pick an army.</li>
        <li>Add a hero. Each hero leads a warband.</li>
        <li>Fill the warband with warriors, up to the number shown.</li>
        <li>Add more heroes and warbands until you hit your points.</li>
        <li>Tap ☆ to pick your leader. Fix anything marked ⚠.</li>
      </ol>
    </section>
  );
}

/** The army's own bonuses and limits, each opened with a tap. */
function ArmyInfo({ name, army }: { name: string; army: CatalogArmy }) {
  const text = useRulesText();
  const [open, setOpen] = useState<string | null>(null);
  const bonuses = army.bonuses ?? [];
  const limits = (army.restrictions ?? []).map(id => text[id]).filter(Boolean);
  const share = (f = 1 / 3) => (Math.abs(f - 1 / 3) < 0.01 ? 'a third' : f === 0.5 ? 'half' : `${Math.round(f * 100)}%`);
  return (
    <section className="army-info">
      <h3>{name}</h3>
      {bonuses.length > 0 && (
        <>
          <small>Army bonuses</small>
          <ul>
            {bonuses.map(b => (
              <li key={b.id}>
                <button className={`army-rule ${open === b.id ? 'on' : ''}`} aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                  {b.name.replace(/^"|"$/g, '')}
                </button>
                {open === b.id && <p>{text[b.id] ?? 'Loading…'}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <small>Limits</small>
      <ul className="army-limits">
        <li>Up to {share(army.bowLimit)} of your warriors (rounded up) may carry bows.</li>
        <li>Up to {share(army.throwLimit)} may carry throwing weapons.</li>
        {limits.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
