import { useMemo } from 'react';
import type { GameState, Model } from '../shared/types.ts';
import { sightTo } from '../shared/sight.ts';

/** A one-line summary over the board of what the sight model can see, or how to pick one. */
export function SightHint({ state, viewer, range }: { state: GameState; viewer?: Model; range?: number }) {
  const counts = useMemo(() => {
    if (!viewer) return null;
    const n = { clear: 0, partial: 0, hidden: 0 };
    for (const m of Object.values(state.models)) if (!m.dead && m.owner !== viewer.owner) n[sightTo(state, viewer, m)]++;
    return n;
  }, [state, viewer]);

  if (!viewer || !counts) return <p className="sight-hint">Tap a model to see what it can see.</p>;
  const total = counts.clear + counts.partial + counts.hidden;
  if (!total) return <p className="sight-hint">No enemies on the table.</p>;
  return (
    <p className="sight-hint">
      Sees <b className="clear">{counts.clear}</b> of {total} enemies
      {counts.partial > 0 && (
        <>
          {' · '}
          <b className="partial">{counts.partial}</b> partly
        </>
      )}
      {counts.hidden > 0 && (
        <>
          {' · '}
          <b className="hidden">{counts.hidden}</b> hidden
        </>
      )}
      {range ? ` · ${range}" range` : ''}
    </p>
  );
}
