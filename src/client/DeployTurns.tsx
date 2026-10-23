import { bandName, bandsOf, currentBand, deployProblems, mayPutDown, procedureOf, rollDue, rollMeans } from '../shared/deploy.ts';
import { narrativeOf } from '../shared/narrative.ts';
import { bundles, isUnseen } from '../shared/unseen.ts';
import { ElvesEdge } from './ElvesEdge.tsx';
import { objectivesMissing } from '../shared/scenarios.ts';
import { BOT_NAME, type Action, type GameState, type Role, type Seat } from '../shared/types.ts';

const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/** What the roll-off's winner is choosing between, in the scenario's words. */
const PICK_WORDS = {
  side: ['Keep this side', 'Take the far side'],
  corner: ['Keep this corner', 'Take the far corner'],
  corners: ['Keep these corners', 'Take the other corners'],
  edge: ['Keep this edge', 'Take the far edge'],
} as const;

/**
 * Setting up in turn, at the foot of the set-up card: the roll-offs, the winner's choice of end, and whose turn it is
 * to put down an objective marker or a warband. Says what to do next and offers it as a button; the battle can start
 * once everything is down.
 */
export function DeployTurns({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role }) {
  const name = (s: Seat) => (s === role ? 'You' : state.names[s] || (s === state.bot ? BOT_NAME : s === 'p1' ? 'Player 1' : 'Player 2'));
  const me = role === 'p1' || role === 'p2' ? role : null;
  const d = state.flow.deploy;
  const p = procedureOf(state);
  const last = (label: string) => [...state.log].reverse().find(r => r.label === label);
  const rolled = (label: string) => {
    const r = last(label);
    return r ? (
      <>
        Rolled <b className="p1">{r.dice[0]}</b>–<b className="p2">{r.dice[1]}</b>.{' '}
      </>
    ) : null;
  };
  const waitFor = (s: Seat, what: string) => <p className="hint">Waiting for <b className={s}>{name(s)}</b> to {what}.</p>;

  if (!d) {
    const due = rollDue(state);
    if (!due) return <p className="hint">{p?.armies === 'army' || p?.armies === 'warbands' ? 'Both armies must be chosen before the roll-off for deployment.' : 'Choose the scenario and both armies first.'}</p>;
    return (
      <>
        <p className="hint">{due === 'markers' ? 'Roll off: the winner places the second objective marker, then you take turns.' : `Roll off: the winner chooses their ${p?.pick === 'edge' ? 'edge' : p?.pick?.startsWith('corner') ? 'corner' : 'side'} and sets up first, then you take turns${p?.armies === 'warbands' ? ', a warband at a time' : ''}.`}</p>
        {me && (
          <button className="primary go" onClick={() => dispatch({ type: 'rollDeploy' })}>
            {due === 'markers' ? 'Roll off for the objectives' : 'Roll off for deployment'}
          </button>
        )}
      </>
    );
  }

  switch (d.step) {
    case 'markers': {
      const turn = d.turn!;
      return (
        <>
          <p className="hint">
            {rolled('Roll-off to place the objectives')}
            {d.winner && d.placed.length === 0 && !Object.values(state.terrain).some(t => t.id.startsWith('obj-')) && (
              <>
                <b className={d.winner}>{name(d.winner)}</b> won the roll-off and {d.winner === me ? 'place' : 'places'} the next marker.{' '}
              </>
            )}
            {objectivesMissing(state)} objective marker{objectivesMissing(state) === 1 ? '' : 's'} to place, each at least 12" from the others and 6" from the edges.
          </p>
          {turn !== me ? (
            waitFor(turn, 'place an objective marker')
          ) : d.marker ? (
            <>
              <p className="hint">Drag your marker where you want it, then you're done.</p>
              <button className="primary go" onClick={() => dispatch({ type: 'markerDone', seat: me })}>
                Done with this marker
              </button>
            </>
          ) : (
            <button className="primary go" onClick={() => dispatch({ type: 'placeMarker', seat: me })}>
              Place an objective marker
            </button>
          )}
        </>
      );
    }
    case 'roll':
      return (
        <>
          <p className="hint">The objectives are down. Roll off: the winner chooses their side and sets up first.</p>
          {me && (
            <button className="primary go" onClick={() => dispatch({ type: 'rollDeploy' })}>
              Roll off for deployment
            </button>
          )}
        </>
      );
    case 'side': {
      const w = d.winner!;
      const words = PICK_WORDS[p?.pick ?? 'side'];
      return (
        <>
          <p className="hint">
            {rolled('Roll-off for deployment')}
            <b className={w}>{name(w)}</b> {w === me ? 'won the roll-off: choose your end of the table' : 'won the roll-off and chooses their end of the table'}
            {p?.armies === 'none' ? '.' : w === me ? ', then set up first.' : ', then sets up first.'}
          </p>
          {w === me ? (
            <div className="row choice-pair">
              <button className="primary go" onClick={() => dispatch({ type: 'pickSide', seat: me, far: false })}>
                {words[0]}
              </button>
              <button className="go" onClick={() => dispatch({ type: 'pickSide', seat: me, far: true })} title="The table turns round, so the far end's terrain is yours">
                {words[1]}
              </button>
            </div>
          ) : (
            waitFor(w, 'choose')
          )}
        </>
      );
    }
    case 'warbands': {
      const turn = d.turn!;
      const left = (s: Seat) => bandsOf(state, s, true).length;
      const tally = (
        <p className="hint">
          Still to place: <b className="p1">{name('p1')}</b> {left('p1')}, <b className="p2">{name('p2')}</b> {left('p2')}.
          {d.noRoom?.length ? ` ${d.noRoom.length} model${d.noRoom.length === 1 ? '' : 's'} had no room near ${d.noRoom.length === 1 ? 'its' : 'their'} Captain and ${d.noRoom.length === 1 ? 'stays' : 'stay'} off the table.` : ''}
        </p>
      );
      if (turn !== me) return (
        <>
          {tally}
          {waitFor(turn, p?.armies === 'army' ? 'set up their army' : 'place a warband')}
        </>
      );
      if (d.current) {
        const problems = deployProblems(state);
        const band = currentBand(state);
        return (
          <>
            <p className="hint">
              Drag {d.current.endsWith(':*') ? 'your army' : bandName(state, band)} where you want it{d.roll ? ` (rolled ${d.roll}: ${rollMeans(state, d.roll)})` : ''}. Every model stays within 6" of its Captain{p?.enemyGap ? ` and ${p.enemyGap}" from the enemy` : ''}.
            </p>
            {problems.map(x => (
              <p key={x} className="warn">
                {x}
              </p>
            ))}
            <button className="primary go" disabled={problems.length > 0} onClick={() => dispatch({ type: 'warbandDone', seat: me })}>
              Done placing {d.current.endsWith(':*') ? 'my army' : 'this warband'}
            </button>
          </>
        );
      }
      const bands = bandsOf(state, me, true);
      if (p?.armies === 'army')
        return (
          <>
            {tally}
            <button className="primary go" onClick={() => dispatch({ type: 'deployWarband', seat: me, warband: '*' })}>
              Set up my whole army
            </button>
          </>
        );
      const champion = p?.champion && !d.placed.some(k => k.startsWith(`${me}:`));
      return (
        <>
          {tally}
          <p className="hint">{champion ? (state.flow.picks?.[me]?.champion ? 'Your turn: your Champion\'s warband goes first, the Champion within 3" of the centre.' : 'Pick your Champion in the Scenario tab first: its warband goes down first.') : 'Your turn: choose a warband to put on the table.'}</p>
          <div className="deploy-bands">
            {bands.map(b => {
              const warband = b[0].warband ?? '';
              return (
                <button key={warband} className="go" disabled={!mayPutDown(state, me, warband)} onClick={() => dispatch({ type: 'deployWarband', seat: me, warband })}>
                  {bandName(state, b)} ({b.length})
                </button>
              );
            })}
          </div>
        </>
      );
    }
    case 'sides': {
      const n = narrativeOf(state);
      const turn = d.turn!;
      const side = state.narrative?.good === turn ? 'good' : 'evil';
      // The Unseen Hero: the Spiders' player sets out the webbed bundles too, and secretly picks the decoy.
      const webs = isUnseen(state) && side === 'evil' ? bundles(state).sort((a, b) => (a.id < b.id ? -1 : 1)) : [];
      const decoy = me ? state.flow.picks?.[me]?.decoy : undefined;
      return turn === me ? (
        <>
          <p className="hint">Your turn to set up {n?.sides[side].name ?? 'your side'}: drag them where the scenario lets them stand, then you're done.</p>
          {webs.length > 0 && (
            <label className="decoy-pick">
              <span className="hint">Drag the webbed bundles where you like, 6" apart. Which one is the decoy? (Only you see this.)</span>
              <select value={decoy ?? ''} onChange={e => dispatch({ type: 'setPick', seat: me, key: 'decoy', value: e.target.value })}>
                <option value="" disabled>
                  Pick the decoy…
                </option>
                {webs.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    Bundle {i + 1} ({t.x < state.board.w / 3 ? 'west' : t.x > (state.board.w * 2) / 3 ? 'east' : 'middle'}, {t.y < state.board.h / 3 ? 'north' : t.y > (state.board.h * 2) / 3 ? 'south' : 'centre'})
                  </option>
                ))}
              </select>
            </label>
          )}
          {me && <ElvesEdge state={state} dispatch={dispatch} role={me} />}
          <button className="primary go" disabled={webs.length > 0 && !decoy} onClick={() => dispatch({ type: 'warbandDone', seat: me })}>
            Done setting up
          </button>
        </>
      ) : (
        <>
          {d.placed.length > 0 && <p className="hint"><b className={other(turn)}>{name(other(turn))}</b> {other(turn) === me ? 'have' : 'has'} set up.</p>}
          {waitFor(turn, `set up ${n?.sides[side].name ?? 'their side'}`)}
        </>
      );
    }
    default:
      return null;
  }
}
