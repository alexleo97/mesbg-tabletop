import type { Action, GameState, Role, Seat } from '../shared/types.ts';

/** Reporting who won: one player says, the other agrees, and a game between two signed-in players goes on the leaderboard. */
export function ResultReport({ state, role, dispatch, suggest }: { state: GameState; role: Role; dispatch: (a: Action) => void; suggest?: Seat | 'draw' }) {
  const name = (s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');
  const outcome = (w: Seat | 'draw') => (w === 'draw' ? 'the game was a draw' : `${name(w)} won`);
  const r = state.result;
  const seat = role === 'p1' || role === 'p2' ? role : null;
  const missing = (['p1', 'p2'] as const).filter(s => !state.accounts?.[s]);
  const sameAccount = !missing.length && state.accounts?.p1?.id === state.accounts?.p2?.id;
  const counts = !missing.length && !sameAccount;
  const note = r?.saved ? null : (
    <p className="hint">
      {counts
        ? 'Both players are signed in, so this game counts on the leaderboard.'
        : sameAccount
          ? "Both seats are signed in to the same account, so this game won't count on the leaderboard."
          : `Only games between two signed-in players count on the leaderboard. Not signed in: ${missing.map(name).join(' and ')}.`}
    </p>
  );

  if (r?.saved) return <p className="result">✓ Result recorded: {outcome(r.winner)}. It's on the leaderboard.</p>;
  if (r?.agreed)
    return (
      <>
        <p className="result">
          Agreed: {outcome(r.winner)}.{counts ? ' Recording it…' : ''}
        </p>
        {note}
      </>
    );
  if (r) {
    const other: Seat = r.by === 'p1' ? 'p2' : 'p1';
    return (
      <div className="result-report">
        <p>
          {name(r.by)} reports that {outcome(r.winner)}.{' '}
          {seat === other ? 'Do you agree?' : `Waiting for ${name(other)} to agree.`}
        </p>
        {seat === other && (
          <div className="row">
            <button className="primary" onClick={() => dispatch({ type: 'answerResult', seat, agree: true })}>
              Agree
            </button>
            <button onClick={() => dispatch({ type: 'answerResult', seat, agree: false })}>That's not right</button>
          </div>
        )}
        {seat === r.by && <button onClick={() => dispatch({ type: 'answerResult', seat, agree: false })}>Take it back</button>}
        {note}
      </div>
    );
  }
  if (!seat) return null;
  return (
    <div className="result-report">
      <p>Who won? Your opponent will be asked to agree.</p>
      <div className="row wrap">
        {(['p1', 'p2', 'draw'] as const).map(w => (
          <button key={w} className={suggest === w ? 'primary' : ''} onClick={() => dispatch({ type: 'proposeResult', seat, winner: w })}>
            {w === 'draw' ? 'Draw' : `${name(w)} won`}
          </button>
        ))}
      </div>
      {note}
    </div>
  );
}
