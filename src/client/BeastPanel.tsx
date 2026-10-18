import type { Catalog } from '../shared/catalog.ts';
import { modelStats } from '../shared/catalog.ts';
import { mountOf } from '../shared/cavalry.ts';
import { touchingEnemies } from '../shared/barriers.ts';
import { mayActivate } from '../shared/heroics.ts';
import { commanderOf, heldBy, howdahFor, impactHits, isChariot, isWarBeast, mayBoard, riders } from '../shared/warBeasts.ts';
import type { Action, GameState, Model, Role } from '../shared/types.ts';

/** Arrows for the eight ways round, from straight up, and where each points from a model. */
const WAYS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const pointFrom = (m: Model, k: number) => ({ x: m.x + Math.sin((k * 45 * Math.PI) / 180) * 10, y: m.y - Math.cos((k * 45 * Math.PI) / 180) * 10 });

/**
 * A war beast's or chariot's part of its card: who rides it and how its Howdah stands, and in the Move phase how to
 * Trample or Chariot Charge (dragging it points the way), a chariot's turn on the spot, and a Stampede. For a warrior,
 * before the battle, climbing into or out of a Howdah.
 */
export function BeastPanel({ state, catalog, dispatch, role, m }: { state: GameState; catalog: Catalog | null; dispatch: (a: Action) => void; role: Role; m: Model }) {
  const mine = role === m.owner;
  const moving = state.flow.started && state.phase === 'move' && !state.flow.trampled?.includes(m.id) && !m.dead;
  // Riding a war beast: it goes where the beast goes, and is never in a fight.
  if (m.aboard) {
    const beast = state.models[m.aboard];
    if (!beast) return null;
    const commands = commanderOf(state, beast)?.id === m.id;
    return (
      <div className="beast">
        <p className="muted small">
          {commands ? `Commands ${beast.name}: it can't shoot, and the beast's Stampede tests use its Courage.` : `In ${beast.name}'s Howdah: it never fights, shoots however far the beast moved, and the Howdah is in the way of shots at it.`}
        </p>
        {mine && !state.flow.started && !/commander/i.test(m.name) && (
          <button className="small" onClick={() => dispatch({ type: 'board', id: m.id })}>
            Climb out
          </button>
        )}
      </div>
    );
  }
  // Before the battle, a warrior beside its war beast can climb into the Howdah.
  if (!isWarBeast(catalog, m) && !isChariot(catalog, m)) {
    const beast = mine && !state.flow.started ? Object.values(state.models).find(b => b.beast === 'war' && mayBoard(state, catalog, m, b)) : undefined;
    return beast ? (
      <button className="small" onClick={() => dispatch({ type: 'board', id: m.id, beast: beast.id })}>
        Climb into {beast.name}'s Howdah
      </button>
    ) : null;
  }
  const war = isWarBeast(catalog, m);
  const hits = impactHits(catalog, m);
  const howdah = war ? howdahFor(m.name) : undefined;
  const aboard = war ? riders(state, m) : [];
  const cmd = war ? commanderOf(state, m) : undefined;
  const holding = moving ? touchingEnemies(state, m) : [];
  const held = war && holding.length > 0 && heldBy(catalog, m, holding).held;
  const steer = moving && mayActivate(state, m) && (m.stampede ? !mine : mine);
  return (
    <div className="beast">
      {war && (
        <p className="muted small">
          {cmd ? `Commanded by ${cmd.name}` : 'No one is riding it: it tests its own Courage before it moves'}
          {howdah && m.howdahWounds !== undefined ? `. Howdah: ${m.howdahWounds} of ${howdah.w} wounds left${aboard.length > 1 ? `, ${aboard.length - 1} warrior${aboard.length === 2 ? '' : 's'} in it` : ''}` : ''}.
        </p>
      )}
      {m.stampede && <p className="warn">{m.name} is Stampeding: {mine ? 'your opponent drives it this move, and it must go before anything else of yours moves.' : 'you drive it this move. Drag it where it runs.'}</p>}
      {steer && !m.stampede && (
        <p className="hint">
          {held
            ? `The enemies fighting ${m.name} are stronger than it, so it can't Trample this turn: drag it anywhere to let it stand.`
            : war
              ? `Drag ${m.name} to point its Trample: it turns to face that way and goes its whole ${m.move}" straight on, ignoring control zones. Everyone in its path takes ${hits.n} Strength ${hits.s} hits; it stops against anyone left standing, and at woods, anything over 2" tall and the table edge.`
              : `Drag ${m.name} towards where it should charge: it turns up to 45° now and after every 4", up to ${m.move}". Everyone in its path takes ${hits.n} Strength ${hits.s} hits; it stops against anyone left standing. Difficult ground halves its pace (a 1 on the dice there wounds it), and obstacles stop it with three Strength 6 hits.`}
        </p>
      )}
      {steer && m.stampede && <p className="hint">Drag {m.name} where it Stampedes: it goes its whole Move straight that way, hitting everyone in its path. Off the table edge, it's lost with everyone riding it.</p>}
      {moving && mine && m.stampede && mayActivate(state, m) && (
        <button className="small" title="If your opponent isn't here to drive it, a die picks which way it bolts." onClick={() => dispatch({ type: 'trample', id: m.id, x: m.x, y: m.y })}>
          Roll which way it bolts
        </button>
      )}
      {steer && !war && !holding.length && (
        <div className="terrain-test">
          <p className="muted small">Or turn it on the spot to face any way (then it makes no Chariot Charge this turn):</p>
          <div className="row wrap">
            {WAYS.map((w, k) => (
              <button key={w} className="small" onClick={() => dispatch({ type: 'trample', id: m.id, ...pointFrom(m, k), pivot: true })}>
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      {!war && mountOf(m)?.chariot && <p className="muted small">The chariot takes every shot and strike aimed at {m.name}: if it's wrecked, {m.name} is thrown clear. Its Attacks add to {m.name}'s.</p>}
      {war && modelStats(catalog, m) && !moving && state.phase === 'move' && state.flow.trampled?.includes(m.id) && <p className="hint">{m.name} has made its move this turn.</p>}
    </div>
  );
}
