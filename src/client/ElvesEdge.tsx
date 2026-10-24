import { EDGES, elvesEdge, elvesWaiting, isElves } from '../shared/elves.ts';
import { EDGES as EAGLE_EDGES, EAGLES_TURN, eaglesComing, eaglesEdge, isFire } from '../shared/eagles.ts';
import { EDGES as GOBLIN_EDGES, hordeEdge, isGoblin } from '../shared/goblin.ts';
import { hordePoint, isOsgiliath, POINT_NAMES } from '../shared/osgiliath.ts';
import type { Action, GameState, Role } from '../shared/types.ts';

/**
 * The Elves of Mirkwood (and And Into the Fire's Eagles): the Good player chooses the table edge Legolas, Tauriel and the Rangers come on from. It can
 * be changed any time before they arrive (as the Good side's fourth Move phase ends).
 */
export function ElvesEdge({ state, dispatch, role }: { state: GameState; dispatch: (a: Action) => void; role: Role }) {
  const good = state.narrative?.good;
  // Escape from Goblin-town: the Evil player chooses the edge the slain Goblins come back from (and can change it).
  if (isGoblin(state) && role !== good && (role === 'p1' || role === 'p2') && state.flow.picks?.[role]?.exit) {
    return (
      <label className="decoy-pick">
        <span className="hint">Slain Goblins come back as your Move phase ends, from the</span>
        <select value={hordeEdge(state)} onChange={e => dispatch({ type: 'setPick', seat: role, key: 'edge', value: e.target.value })}>
          {GOBLIN_EDGES.map(x => (
            <option key={x} value={x}>
              {x} edge
            </option>
          ))}
        </select>
      </label>
    );
  }
  // Escape from Osgiliath: the Evil player chooses the Reinforcement Point the slain Orcs come back from (and can change it).
  if (isOsgiliath(state) && role !== good && (role === 'p1' || role === 'p2')) {
    return (
      <label className="decoy-pick">
        <span className="hint">Slain Orcs that come back move on as your Move phase ends, from the</span>
        <select value={hordePoint(state)} onChange={e => dispatch({ type: 'setPick', seat: role, key: 'edge', value: e.target.value })}>
          {POINT_NAMES.map(x => (
            <option key={x} value={x}>
              {x} Reinforcement Point
            </option>
          ))}
        </select>
      </label>
    );
  }
  // And Into the Fire: the Eagles (and those coming back) fly on from the north or the south edge.
  if (isFire(state) && role === good && (eaglesComing(state).length || state.turn < EAGLES_TURN)) {
    const edge = eaglesEdge(state);
    return (
      <label className="decoy-pick">
        <span className="hint">{state.turn < EAGLES_TURN ? 'The Eagles arrive as your second Move phase ends.' : 'The Eagles come on as your Move phase ends.'} They fly in from the</span>
        <select value={edge} onChange={e => dispatch({ type: 'setPick', seat: good, key: 'edge', value: e.target.value })}>
          {EAGLE_EDGES.map(x => (
            <option key={x} value={x}>
              {x} edge
            </option>
          ))}
        </select>
      </label>
    );
  }
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
