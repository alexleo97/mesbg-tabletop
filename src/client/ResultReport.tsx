import type { Action, GameState, Role, Seat } from '../shared/types.ts';

/**
 * The end of a game. The game works out the winner itself and both players confirm it with a tap;
 * a player can also concede, or offer a draw. Games between two signed-in players go on the leaderboard.
 */
export function ResultReport({ state, role, dispatch, early }: { state: GameState; role: Role; dispatch: (a: Action) => void; early?: boolean }) {
  const name = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const outcome = (w: Seat | 'draw') => (w === 'draw' ? "It's a draw" : `${name(w)} wins`);
  const r = state.result;
  const seat = role === 'p1' || role === 'p2' ? role : null;
  const missing = (['p1', 'p2'] as const).filter(s => !state.accounts?.[s]);
  const sameAccount = !missing.length && state.accounts?.p1?.id === state.accounts?.p2?.id;
  const counts = !missing.length && !sameAccount;
  const note = (
    <p className="hint">
      {counts
        ? 'Both players are signed in, so this game counts on the leaderboard.'
        : sameAccount
          ? "Both seats are signed in to the same account, so this game won't count on the leaderboard."
          : `This game won't count on the leaderboard: ${missing.map(name).join(' and ')} ${missing.length > 1 ? "aren't" : "isn't"} signed in with Discord.`}
    </p>
  );

  if (r?.saved) return <p className="result">✓ {outcome(r.winner)}. It's on the leaderboard.</p>;

  if (r?.by === 'game') {
    const confirmed = r.confirmed ?? [];
    const waiting = (['p1', 'p2'] as const).filter(s => !confirmed.includes(s));
    return (
      <div className="result-report">
        <p className="result">
          {outcome(r.winner)}.{r.agreed && counts ? ' Recording it…' : ''}
        </p>
        {!r.agreed && (
          <>
            {seat && waiting.includes(seat) ? (
              <button className="primary" onClick={() => dispatch({ type: 'answerResult', seat, agree: true })}>
                Confirm result
              </button>
            ) : (
              <p>Waiting for {waiting.map(name).join(' and ')} to confirm.</p>
            )}
            <p className="hint">Not right? Fix the victory points or casualties and the result updates.</p>
          </>
        )}
        {note}
      </div>
    );
  }

  if (r?.agreed) {
    const conceded = r.winner !== 'draw' && r.by !== r.winner;
    return (
      <div className="result-report">
        <p className="result">
          {conceded ? `${name(r.by as Seat)} conceded. ` : ''}
          {outcome(r.winner)}.{counts ? ' Recording it…' : ''}
        </p>
        {note}
      </div>
    );
  }

  if (r) {
    // A draw offer.
    const by = r.by as Seat;
    const other: Seat = by === 'p1' ? 'p2' : 'p1';
    return (
      <div className="result-report">
        <p>
          {name(by)} offers a draw. {seat === other ? '' : `Waiting for ${name(other)} to answer.`}
        </p>
        {seat === other && (
          <div className="row">
            <button className="primary" onClick={() => dispatch({ type: 'answerResult', seat, agree: true })}>
              Accept the draw
            </button>
            <button onClick={() => dispatch({ type: 'answerResult', seat, agree: false })}>Keep playing</button>
          </div>
        )}
        {seat === by && <button onClick={() => dispatch({ type: 'answerResult', seat, agree: false })}>Withdraw the offer</button>}
      </div>
    );
  }

  if (!early || !seat) return null;
  return (
    <div className="result-report">
      <p className="hint">The game declares the winner itself when it ends. To stop sooner:</p>
      <div className="row">
        <button onClick={() => confirm('Concede the game? Your opponent wins.') && dispatch({ type: 'concede', seat })}>I concede</button>
        <button onClick={() => dispatch({ type: 'proposeResult', seat, winner: 'draw' })}>Offer a draw</button>
      </div>
      {note}
    </div>
  );
}
