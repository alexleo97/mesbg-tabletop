import { useEffect, useState } from 'react';
import { rename, signIn, signOut, statsFor, useAuth, type Profile, type Stats } from './auth.ts';
import { armySummaries, listMaps, updateMap, type ArmySummary, type SavedMap } from './cloud.ts';

function Avatar({ profile, size = 28 }: { profile: Profile; size?: number }) {
  return profile.avatar_url ? (
    <img className="avatar" src={profile.avatar_url} alt="" width={size} height={size} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar blank" style={{ width: size, height: size }}>
      {profile.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The home page's sign-in button, or who is signed in. Hidden when the server has no sign-in set up. */
export function AccountButton() {
  const { enabled, loading, signedIn, profile, error } = useAuth();
  if (!enabled) return null;
  const problem = error && <p className="warn small account-error">{error}</p>;
  if (loading) return <div className="account" aria-hidden />;
  if (signedIn)
    return (
      <div className="account">
        <button className="account-me" onClick={() => (location.search = '?profile')}>
          {profile && <Avatar profile={profile} />}
          <span>{profile?.username ?? 'Your profile'}</span>
        </button>
        {problem}
      </div>
    );
  return (
    <div className="account">
      <button className="discord-signin" onClick={() => void signIn()}>
        Sign in with Discord
      </button>
      {problem}
    </div>
  );
}

/** Your profile: name, record and sign-out. */
export function ProfilePage({ onHome }: { onHome: () => void }) {
  const { enabled, loading, signedIn, profile, error } = useAuth();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [armies, setArmies] = useState<ArmySummary[] | null>(null);
  const [maps, setMaps] = useState<SavedMap[] | null>(null);

  useEffect(() => {
    if (profile) setName(profile.username);
  }, [profile?.username]);
  useEffect(() => {
    if (!profile) return;
    void statsFor(profile.id).then(setStats);
    void armySummaries().then(setArmies);
    void listMaps('mine').then(setMaps);
  }, [profile?.id]);

  const share = async (m: SavedMap) => {
    await updateMap(m.id, { public: !m.public });
    setMaps(ms => ms?.map(x => (x.id === m.id ? { ...x, public: !x.public } : x)) ?? null);
  };

  const save = async () => {
    const problem = await rename(name);
    setSaved(problem ?? 'Saved.');
  };

  return (
    <div className="page-body profile">
      <h1>Your profile</h1>
      {loading && <p className="muted">Loading…</p>}
      {!loading && !enabled && <p>Accounts aren't switched on for this site yet.</p>}
      {!loading && enabled && !signedIn && (
        <>
          <p>Sign in with Discord to keep your stats, armies and maps, and to appear on the leaderboard.</p>
          <button className="discord-signin big" onClick={() => void signIn()}>
            Sign in with Discord
          </button>
        </>
      )}
      {error && <p className="warn">{error}</p>}
      {profile && (
        <>
          <div className="profile-head">
            <Avatar profile={profile} size={72} />
            <div>
              <h2>{profile.username}</h2>
              <p className="muted">Playing since {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          <section className="profile-stats" aria-label="Record">
            {(['games', 'wins', 'draws', 'losses'] as const).map(k => (
              <div key={k}>
                <b>{stats ? stats[k] : '–'}</b>
                <small>{k === 'games' ? 'Games' : k[0].toUpperCase() + k.slice(1)}</small>
              </div>
            ))}
          </section>
          <p className="muted small">Games count once both players are signed in and agree on the result.</p>
          <label className="profile-name">
            Name shown to other players
            <div className="row">
              <input value={name} maxLength={32} onChange={e => (setName(e.target.value), setSaved(null))} onKeyDown={e => e.key === 'Enter' && void save()} />
              <button onClick={() => void save()} disabled={!name.trim() || name.trim() === profile.username}>
                Save
              </button>
            </div>
          </label>
          {saved && <p className="muted small">{saved}</p>}
          <section className="profile-lists" aria-label="Your armies">
            <h3>Your armies</h3>
            {armies === null ? (
              <p className="muted small">Loading…</p>
            ) : armies.length === 0 ? (
              <p className="muted small">Build one on the Armies page and it's saved here.</p>
            ) : (
              <ul>
                {armies.map(a => (
                  <li key={a.id}>
                    <span>
                      <b>{a.name}</b> <span className="muted">{a.faction}</span>
                    </span>
                    {a.points != null && <span className="muted">{a.points} pts</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="profile-lists" aria-label="Your maps">
            <h3>Your maps</h3>
            {maps === null ? (
              <p className="muted small">Loading…</p>
            ) : maps.length === 0 ? (
              <p className="muted small">Lay out terrain in a game, then save it from the ⛰ Table tab.</p>
            ) : (
              <ul>
                {maps.map(m => (
                  <li key={m.id}>
                    <span>
                      <b>{m.name}</b> <span className="muted">{m.data.terrain?.length ?? 0} pieces</span>
                    </span>
                    <label className="check">
                      <input type="checkbox" checked={m.public} onChange={() => void share(m)} /> Shared
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {signedIn && (
        <div className="row wrap center">
          <button onClick={() => void signOut().then(onHome)}>Sign out</button>
        </div>
      )}
    </div>
  );
}
