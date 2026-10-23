import { EDGES, elvesEdge, elvesWaiting, isElves } from '../shared/elves.ts';
import type { Action, GameState, Role } from '../shared/types.ts';

/**
 * The Elves of Mirkwood: the Good player chooses the table edge Legolas, Tauriel and the Rangers come on from. It can
 * be changed any time before they arrive (as the Good side's fourth Move phase ends).
 */
export function ElvesEdge({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role }) {
  const good = state.narrative?.good;
  if (!isElves(state) || role !== good || !elvesWaiting(state).length) return null;
  const edge = elvesEdge(state);
  return (
    <label className="decoy-pick">
      <span className="hint">The Elves arrive as your fourth Move phase ends. They come on from the</span>
      <select value={edge} onChange={e => dispatch({ type: 'setPick', seat: good, key: 'edge', value: e.target.value })}>
        {EDGES.map(x => (
          <option key={x} value={x}>
            {x} edge
          </option>
        ))}
      </select>
    </label>
  );
}
