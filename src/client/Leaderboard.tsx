import { useEffect, useState } from 'react';
import { Avatar } from './Account.tsx';
import { leaderboard, useAuth, type Standing } from './auth.ts';

/** Players ranked by wins in games both sides agreed on. */
export function LeaderboardPage() {
  const { enabled, loading, profile } = useAuth();
  const [rows, setRows] = useState<Standing[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (enabled) void leaderboard().then(r => (r ? setRows(r) : setFailed(true)));
  }, [enabled]);

  return (
    <div className="page-body leaderboard">
      <h1>Leaderboard</h1>
      <p className="muted">Wins from games between two signed-in players who both agreed on the result.</p>
      {!loading && !enabled && <p>The leaderboard isn't switched on for this site yet.</p>}
      {failed && <p className="warn">Couldn't load the leaderboard. Try again in a moment.</p>}
      {enabled && !rows && !failed && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p>No results yet. Finish a game against another signed-in player to get on the board.</p>}
      {!!rows?.length && (
        <table className="standings">
          <thead>
            <tr>
              <th>#</th>
              <th className="who">Player</th>
              <th title="Wins">W</th>
              <th title="Draws">D</th>
              <th title="Losses">L</th>
              <th title="Games">Games</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.id === profile?.id ? 'me' : ''}>
                <td>{i + 1}</td>
                <td className="who">
                  <span className="who-cell">
                    <Avatar profile={r} size={24} />
                    <span>{r.username}</span>
                  </span>
                </td>
                <td>{r.wins}</td>
                <td>{r.draws}</td>
                <td>{r.losses}</td>
                <td>{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
