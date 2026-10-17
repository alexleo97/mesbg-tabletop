import { armyStatus } from '../shared/status.ts';
import type { GameState } from '../shared/types.ts';

const SEATS = ['p1', 'p2'] as const;

/** Small top-bar tags for armies that are currently Broken. */
export function BrokenTags({ state }: { state: GameState }) {
  return (
    <>
      {SEATS.filter(s => armyStatus(state, s).broken).map(s => (
        <span key={s} className={`broken-tag ${s}`} title="More than half the army is lost">
          {state.names[s] || (s === 'p1' ? 'P1' : 'P2')} broken
        </span>
      ))}
    </>
  );
}
