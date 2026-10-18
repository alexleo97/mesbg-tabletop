import type { Catalog } from '../shared/catalog.ts';
import { crewAt, engineFor, engineOf, enemiesAt, pushers } from '../shared/siege.ts';
import type { Action, GameState, Model, Role } from '../shared/types.ts';

/** Arrows for the eight ways round, from straight up. */
const WAYS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/**
 * A siege engine's part of its card: who is beside it to shoot it, and in the Move phase who can push it and how to
 * turn it to face a target. For one of its crew, which engine it belongs to.
 */
export function SiegePanel({ state, catalog, dispatch, role, m }: { state: GameState; catalog: Catalog | null; dispatch: (a: Action) => void; role: Role; m: Model }) {
  if (!m.siege) {
    const engine = engineOf(state, m);
    return engine ? <p className="muted small">Crews {engine.name}: it stays within 6" of it, and works it from beside it.</p> : null;
  }
  const mine = role === m.owner;
  const e = engineFor(m.name);
  const need = m.siege === 'large' ? 2 : 1;
  const crew = crewAt(state, catalog, m);
  const trained = crew.filter(c => c.trained).length;
  const moving = mine && state.flow.started && state.phase === 'move' && !m.dead;
  const push = moving ? pushers(state, m) : undefined;
  const foes = enemiesAt(state, m);
  return (
    <div className="beast">
      <p className="muted small">
        {m.siege === 'large' ? 'A large engine' : 'A small engine'}: {e && e.min ? `${e.min}-${e.max}"` : `up to ${e?.max ?? '?'}"`}, only at targets within its 45° Arc of Sight (the way it faces).{' '}
        {crew.length >= need ? `${crew.length} beside it to shoot it${trained < need ? ', not all of them its own crew, so it hits only on a 6' : ''}.` : `It needs ${need === 2 ? 'two' : 'one'} crew beside it to shoot, and has ${crew.length}.`}
      </p>
      {foes.length > 0 && <p className="warn">{foes.map(f => f.name).join(' and ')} {foes.length === 1 ? 'is' : 'are'} beside it: it can't shoot or be moved, and is sabotaged if left alone with them.</p>}
      {e?.fixed && <p className="muted small">Static: it can never be moved or turned.</p>}
      {moving && !e?.fixed && (push ? (
        <>
          <p className="hint">Drag {m.name} to push it up to {push.move}" with {push.by.map(p => p.name).join(', ')}, who go along with it. It can't cross difficult ground or barriers. Moving or turning it makes its shot 1 worse this turn.</p>
          <div className="terrain-test">
            <p className="muted small">Turn it to face:</p>
            <div className="row wrap">
              {WAYS.map((w, k) => (
                <button key={w} className="small" disabled={Math.abs(((m.rot - k * 45 + 540) % 360) - 180) < 0.5} onClick={() => dispatch({ type: 'moveModels', moves: [{ id: m.id, x: m.x, y: m.y, rot: k * 45 }] })}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="hint">To push or turn {m.name} it needs {m.siege === 'large' ? 'three' : 'two'} friends beside it who haven't moved and aren't fighting (a monster counts as three).</p>
      ))}
    </div>
  );
}
