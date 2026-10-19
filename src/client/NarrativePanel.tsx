import { useState } from 'react';
import { other } from '../shared/flow.ts';
import { narrativeById, NARRATIVES, SAGAS, type Side } from '../shared/narrative.ts';
import { MapPreview, randomRoom, SitePage } from './Home.tsx';
import { BOT_NAME, type Action, type GameState, type Role, type Seat } from '../shared/types.ts';

type Dispatch = (a: Action) => void;

/**
 * A narrative scenario: who plays which side (you pick, and the other player or the Palantír takes the rest), then
 * the story's table, cast, objectives and special rules.
 */
export function NarrativePanel({ state, dispatch, role, id }: { state: GameState; dispatch: Dispatch; role: Role; id: string }) {
  const n = narrativeById(id);
  const [asking, setAsking] = useState(false);
  if (!n) return null;
  const set = state.narrative?.id === n.id;
  const seat: Seat | null = role === 'p1' || role === 'p2' ? role : null;
  const fixed = !seat || state.flow.started;
  const nameOf = (s: Seat) => (state.bot === s ? BOT_NAME : s === seat ? 'You' : state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2'));
  const play = (side: Side) => {
    if (!seat) return;
    if (Object.keys(state.models).length && !set && !asking) {
      setAsking(true);
      return;
    }
    setAsking(false);
    dispatch({ type: 'setNarrative', id: n.id, good: side === 'good' ? seat : other(seat) });
  };
  const sideSeat = (side: Side): Seat | undefined => (set ? (side === 'good' ? state.narrative!.good : other(state.narrative!.good)) : undefined);
  return (
    <div className="narrative">
      <h4>{n.name}</h4>
      <p className="muted small">Narrative scenario from {n.from}. The cast and the table are the story's own.</p>
      <h4>Sides</h4>
      <div className="narrative-sides">
        {(['good', 'evil'] as const).map(side => {
          const at = sideSeat(side);
          const mine = !!at && at === seat;
          return (
            <button key={side} className={`side-card ${side} ${mine ? 'on' : ''}`} disabled={fixed || mine} aria-pressed={mine} onClick={() => play(side)}>
              <b>{n.sides[side].name}</b>
              <span>{n.sides[side].cast}</span>
              <small>{at ? nameOf(at) : side === 'good' ? 'Good' : 'Evil'}</small>
            </button>
          );
        })}
      </div>
      {asking && <p className="warn">This takes the armies and terrain off the table to set up {n.name}. Pick your side again to go ahead.</p>}
      {!fixed && <p className="fine">Pick the other card to swap sides before the battle starts.</p>}

      <h4>Objectives</h4>
      <p>{n.objectives}</p>
      <h4>The table</h4>
      <p>
        {n.board.w}"×{n.board.h}". {n.layout}
      </p>
      <h4>Starting positions</h4>
      <p>{n.deployment}</p>
      <h4>Special rules</h4>
      {n.rules.map(r => (
        <p key={r.name} className="small">
          <b>{r.name}:</b> {r.text}
        </p>
      ))}
      <p className="fine">Our own shorthand of the narrative scenario; the game plays its rules for you.</p>
    </div>
  );
}

/** In the army step of a narrative scenario: the casts are fixed, so this just says who is on the table. */
export function NarrativeCast({ state }: { state: GameState }) {
  const n = narrativeById(state.narrative?.id);
  if (!n || !state.narrative) return null;
  const list = (side: Side) => {
    const s = side === 'good' ? state.narrative!.good : other(state.narrative!.good);
    const ms = Object.values(state.models).filter(m => m.owner === s);
    return (
      <div key={side} className={`army-roster ${s}`}>
        <b>{n.sides[side].name}</b>
        <ul>
          {ms.map(m => (
            <li key={m.id}>
              {m.name}
              {m.waiting ? ' (kept aside)' : ''}
              {m.brand ? ', flaming brand' : ''}
              {m.options?.filter(o => !/\//.test(o)).length ? `, ${m.options.filter(o => !/\//.test(o)).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="panel-body">
      <p className="hint">{n.name} has a fixed cast, so there are no lists to pick. Drag models round before the battle where the scenario lets them stand.</p>
      {list('good')}
      {list('evil')}
    </div>
  );
}

/** A table's size as the books give it: in feet once it's 4' or more across, otherwise in inches. */
const tableSize = (b: { w: number; h: number }) => (b.w >= 48 && b.w % 12 === 0 && b.h % 12 === 0 ? `${b.w / 12}'×${b.h / 12}'` : `${b.w}"×${b.h}"`);

/** The menu for a narrative scenario, apart from regular games: the scenario, your side and your opponent, then play. */
export function NarrativePage() {
  const [id, setId] = useState(NARRATIVES[0]?.id ?? '');
  const [side, setSide] = useState<Side>('good');
  const [vs, setVs] = useState<'computer' | 'friend'>('computer');
  const n = narrativeById(id);
  const start = () => n && (location.search = `?room=${randomRoom()}&story=${n.id}&side=${side}${vs === 'computer' ? '&vs=computer' : ''}`);
  const count = (side: Side) => n?.cast.filter(c => c.side === side).length ?? 0;
  return (
    <SitePage page="play" wide>
      <section className="narrative-menu">
        <a className="back-link" href="?">
          ← Back
        </a>
        <header>
          <h1>Narrative scenarios</h1>
          <p className="lead">Play the battles from the story. Each one sets its own table, its exact characters and its special rules, so there are no lists to build and no map to pick.</p>
        </header>
        <h2>1. Choose a scenario</h2>
        {SAGAS.map(saga => {
          const list = NARRATIVES.filter(x => x.saga === saga.id);
          if (!list.length) return null;
          return (
            <section key={saga.id} className="story-saga">
              <h3>{saga.name}</h3>
              <div className="story-grid">
                {list.map(x => (
                  <button key={x.id} className={`story-card ${x.id === id ? 'on' : ''}`} aria-pressed={x.id === id} onClick={() => setId(x.id)}>
                    <MapPreview w={x.board.w} h={x.board.h} terrain={x.terrain} />
                    <span className="story-text">
                      <b>{x.name}</b>
                      <small className="muted">
                        {x.from} · {tableSize(x.board)} table
                      </small>
                      <span>{x.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {n && (
          <>
            <h2>2. Choose your side</h2>
            <div className="narrative-sides">
              {(['good', 'evil'] as const).map(s => (
                <button key={s} className={`side-card ${s} ${side === s ? 'on' : ''}`} aria-pressed={side === s} onClick={() => setSide(s)}>
                  <b>{n.sides[s].name}</b>
                  <span>{n.sides[s].cast}</span>
                  <small>
                    {s === 'good' ? 'Good' : 'Evil'} · {count(s)} model{count(s) === 1 ? '' : 's'}
                  </small>
                </button>
              ))}
            </div>
            <h2>3. Choose your opponent</h2>
            <div className="narrative-sides">
              <button className={`side-card ${vs === 'computer' ? 'on' : ''}`} aria-pressed={vs === 'computer'} onClick={() => setVs('computer')}>
                <b>{BOT_NAME}</b>
                <span>The computer plays {n.sides[side === 'good' ? 'evil' : 'good'].name}.</span>
              </button>
              <button className={`side-card ${vs === 'friend' ? 'on' : ''}`} aria-pressed={vs === 'friend'} onClick={() => setVs('friend')}>
                <b>A friend</b>
                <span>Send them the game's link and they play {n.sides[side === 'good' ? 'evil' : 'good'].name}.</span>
              </button>
            </div>
            <details className="story-brief">
              <summary>Objectives and special rules</summary>
              <p>{n.objectives}</p>
              {n.rules.map(r => (
                <p key={r.name} className="small">
                  <b>{r.name}:</b> {r.text}
                </p>
              ))}
            </details>
            <button className="primary go story-start" onClick={start}>
              Play {n.name} →
            </button>
          </>
        )}
      </section>
    </SitePage>
  );
}
