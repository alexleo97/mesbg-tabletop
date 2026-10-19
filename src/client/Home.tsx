import { useEffect, useState, type ReactNode } from 'react';
import type { Terrain, TerrainKind } from '../shared/types.ts';
import { outline } from '../shared/sight.ts';
import { AccountButton } from './Account.tsx';
import { leaderboard, signIn, useAuth, type Standing } from './auth.ts';
import { deleteMap, listMaps, updateMap, type SavedMap } from './cloud.ts';
import { ListBuilder, loadSaved, type Roster } from './ListBuilder.tsx';
import { cloudLists, mergeLists } from './cloud.ts';
import { SettingsPanel } from './Panels.tsx';
import { useSettings } from './settings.ts';

const DISCORD_INVITE = 'https://discord.gg/epNRWMxGws';

/** Join the community, or for members, a shortcut straight into the server. */
function DiscordLink() {
  const { discordMember, discordGuild } = useAuth();
  // Members go straight to the server; the invite would only ask them to accept it again.
  const href = discordMember && discordGuild ? `https://discord.com/channels/${discordGuild}` : DISCORD_INVITE;
  return (
    <a className="nav-discord" href={href} target="_blank" rel="noreferrer">
      {discordMember ? 'Open Discord' : 'Join Discord'}
    </a>
  );
}

/** Display settings, from a button in the top bar. */
function SettingsMenu() {
  const [settings, update] = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <div className="nav-settings">
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Display settings" title="Display settings">
        ⚙
      </button>
      {open && (
        <div className="nav-settings-panel">
          <SettingsPanel settings={settings} update={update} />
        </div>
      )}
    </div>
  );
}

export type Page = 'play' | 'armies' | 'maps' | 'leaderboard' | 'profile';

// A folded map in the text colour, since the map emoji draws as a coloured globe on some systems.
export const MapIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" style={{ verticalAlign: '-0.125em' }}>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

const PAGES: [Page, ReactNode, string][] = [
  ['play', '⚔', 'Play'],
  ['armies', '🛡', 'Armies'],
  ['maps', <MapIcon key="maps" />, 'Maps'],
  ['leaderboard', '🏆', 'Leaderboard'],
];

export const pageUrl = (p: Page) => (p === 'play' ? location.pathname : `?${p}`);

/** The site's main menu: a bar across the top on computers, tabs along the bottom on phones. */
export function SiteNav({ page }: { page: Page }) {
  const { enabled } = useAuth();
  return (
    <header className="site-nav">
      <a className="brand" href={pageUrl('play')}>
        MESBG <span>Tabletop</span>
      </a>
      <nav aria-label="Main">
        {PAGES.filter(([p]) => enabled || p === 'play' || p === 'armies').map(([p, icon, label]) => (
          <a key={p} href={pageUrl(p)} className={page === p ? 'on' : ''} aria-current={page === p ? 'page' : undefined}>
            <span aria-hidden>{icon}</span>
            {label}
          </a>
        ))}
      </nav>
      <SettingsMenu />
      <DiscordLink />
      <AccountButton />
    </header>
  );
}

/** A page of the site outside a game. */
export function SitePage({ page, wide, children }: { page: Page; wide?: boolean; children: ReactNode }) {
  return (
    <div className="site">
      <SiteNav page={page} />
      <main className={`site-main ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}

/** Build and keep your army lists, outside any game. */
export function ArmiesPage() {
  const { enabled, signedIn } = useAuth();
  return (
    <SitePage page="armies" wide>
      <h1>Your armies</h1>
      <p className="muted">
        Build your lists here and they're ready in every game: open the ⚔ Army tab at the table, pick a list and deploy it.
        {enabled && !signedIn && ' Sign in with Discord to keep them on every device.'}
      </p>
      {enabled && !signedIn && (
        <button className="discord-signin center-self" onClick={() => void signIn()}>
          Sign in with Discord
        </button>
      )}
      <div className="armies-builder">
        <ListBuilder wide />
      </div>
    </SitePage>
  );
}

const KIND_CLASS: Record<TerrainKind, string> = {
  wood: 'wood',
  rock: 'rock',
  building: 'building',
  water: 'water',
  hill: 'hill',
  wall: 'wall',
  ruin: 'ruin',
  cliff: 'rock',
  field: 'field',
  objective: 'objective',
  bridge: 'bridge',
  road: 'road',
  gate: 'wall',
  tower: 'building',
};

/** A small top-down drawing of a map's terrain. */
export function MapPreview({ w, h, terrain }: { w: number; h: number; terrain: Terrain[] }) {
  return (
    <svg className="map-preview" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect width={w} height={h} className="mp-mat" />
      {terrain.map((t, i) => (
        <polygon key={i} className={`mp-${KIND_CLASS[t.kind] ?? 'rock'}`} points={outline(t, 16).map(p => `${p.x},${p.y}`).join(' ')} />
      ))}
    </svg>
  );
}

const PLACES = ['osgiliath', 'helms-deep', 'weathertop', 'amon-hen', 'pelennor', 'fornost', 'dale', 'erebor', 'moria', 'isengard', 'edoras', 'lothlorien'];

export function randomRoom() {
  return `${PLACES[Math.floor(Math.random() * PLACES.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Your maps and the ones other players have shared, ready to play on. */
export function MapsPage() {
  const { enabled, loading, profile } = useAuth();
  const [tab, setTab] = useState<'shared' | 'mine'>('shared');
  const [maps, setMaps] = useState<SavedMap[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled || (tab === 'mine' && !profile)) return;
    let alive = true;
    setMaps(null);
    setFailed(false);
    void listMaps(tab).then(m => {
      if (!alive) return;
      setMaps(m ?? []);
      setFailed(!m);
    });
    return () => {
      alive = false;
    };
  }, [enabled, profile?.id, tab, refresh]);

  const play = (m: SavedMap) => (location.search = `?room=${randomRoom()}&map=${m.id}`);

  return (
    <SitePage page="maps" wide>
      <h1>Maps</h1>
      <div className="page-intro">
        <p className="muted">Pick a table to play on, or make your own.</p>
        <a className="button-link primary-link" href="?mapeditor">
          + Create a map
        </a>
      </div>
      <div className="row seg page-tabs">
        <button className={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>
          Community maps
        </button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          My maps
        </button>
      </div>
      {!loading && !enabled && <p>Maps aren't switched on for this site yet.</p>}
      {enabled && tab === 'mine' && !profile && !loading && (
        <>
          <p>Sign in with Discord to save your own maps.</p>
          <button className="discord-signin center-self" onClick={() => void signIn()}>
            Sign in with Discord
          </button>
        </>
      )}
      {failed && <p className="warn">Couldn't load maps. Try again in a moment.</p>}
      {enabled && (tab === 'shared' || profile) && maps === null && <p className="muted">Loading maps…</p>}
      {maps?.length === 0 && !failed && <p className="muted">{tab === 'mine' ? 'You haven’t saved a map yet.' : 'Nobody has shared a map yet. Be the first!'}</p>}
      {!!maps?.length && (
        <ul className="map-grid">
          {maps.map(m => (
            <li key={m.id} className="map-card">
              <MapPreview w={m.data.w} h={m.data.h} terrain={m.data.terrain ?? []} />
              <div className="map-info">
                <b>{m.name}</b>
                <small className="muted">
                  {m.data.w}×{m.data.h}" · {m.data.terrain?.length ?? 0} {m.data.terrain?.length === 1 ? 'piece' : 'pieces'}
                  {m.author && tab === 'shared' ? ` · by ${m.author}` : ''}
                </small>
              </div>
              <div className="map-actions">
                <button className="primary" onClick={() => play(m)}>
                  Play on this map
                </button>
                {m.owner === profile?.id && (
                  <>
                    <a className="button-link" href={`?mapeditor=${m.id}`}>
                      Edit
                    </a>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={m.public}
                        onChange={async () => {
                          await updateMap(m.id, { public: !m.public });
                          setRefresh(n => n + 1);
                        }}
                      />{' '}
                      Shared
                    </label>
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
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SitePage>
  );
}

/** A card on the home page with a heading, a link to its full page, and a short preview. */
function DashCard({ icon, title, more, href, children }: { icon: ReactNode; title: string; more: string; href: string; children: ReactNode }) {
  return (
    <section className="dash-card">
      <header>
        <h2>
          <span aria-hidden>{icon}</span> {title}
        </h2>
        <a href={href}>{more} →</a>
      </header>
      {children}
    </section>
  );
}

/** Your lists at a glance, from this browser and your account. */
export function ArmiesCard() {
  const { profile } = useAuth();
  const [lists, setLists] = useState<Roster[]>(loadSaved);
  useEffect(() => {
    if (profile) void cloudLists().then(cloud => cloud && setLists(mergeLists(loadSaved(), cloud)));
  }, [profile?.id]);
  const ready = lists.filter(r => r.entries.length).slice(0, 4);
  return (
    <DashCard icon="🛡" title="Your armies" more={ready.length ? 'All armies' : 'Build one'} href="?armies">
      {ready.length ? (
        <ul className="dash-list">
          {ready.map(r => (
            <li key={r.id}>
              <b>{r.name}</b>
              <small>{r.army}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Build your army once and deploy it in any game with one tap.</p>
      )}
    </DashCard>
  );
}

/** The newest shared maps, as thumbnails. */
export function MapsCard() {
  const { enabled } = useAuth();
  const [maps, setMaps] = useState<SavedMap[] | null>(null);
  useEffect(() => {
    if (enabled) void listMaps('shared').then(m => setMaps(m ?? []));
  }, [enabled]);
  if (!enabled) return null;
  return (
    <DashCard icon={<MapIcon />} title="Community maps" more="All maps" href="?maps">
      {maps === null ? (
        <p className="muted">Loading…</p>
      ) : maps.length === 0 ? (
        <p className="muted">No shared maps yet. Lay out a table in a game and share it.</p>
      ) : (
        <div className="dash-maps">
          {maps.slice(0, 3).map(m => (
            <button key={m.id} className="dash-map" onClick={() => (location.search = `?room=${randomRoom()}&map=${m.id}`)} title={`Play on ${m.name}`}>
              <MapPreview w={m.data.w} h={m.data.h} terrain={m.data.terrain ?? []} />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </DashCard>
  );
}

/** The top of the leaderboard. */
export function TopPlayersCard() {
  const { enabled, profile } = useAuth();
  const [rows, setRows] = useState<Standing[] | null>(null);
  useEffect(() => {
    if (enabled) void leaderboard().then(r => setRows(r ?? []));
  }, [enabled]);
  if (!enabled) return null;
  return (
    <DashCard icon="🏆" title="Top players" more="Leaderboard" href="?leaderboard">
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No ranked games yet. Finish a game against a signed-in player to get on the board.</p>
      ) : (
        <ol className="dash-list ranked">
          {rows.slice(0, 5).map(r => (
            <li key={r.id} className={r.id === profile?.id ? 'me' : ''}>
              <b>{r.username}</b>
              <small>
                {r.wins} W · {r.games} games
              </small>
            </li>
          ))}
        </ol>
      )}
    </DashCard>
  );
}
