// Spears and pikes in a fight: friends behind the front rank lending a die and a strike.
import type { Catalog } from './catalog.ts';
import { CONTACT_SLACK, type Combat } from './flow.ts';
import { hasPike, hasSpear } from './gear.ts';
import { distanceBetween } from './geometry.ts';
import { engaged } from './movement.ts';
import { cannotAct, isCavalry } from './powers.ts';
import type { GameState, Model, Seat } from './types.ts';

const area = (m: Model) => m.base.w * m.base.h;
const touching = (a: Model, b: Model) => Math.abs(a.x - b.x) < 5 && Math.abs(a.y - b.y) < 5 && distanceBetween(a, b) <= CONTACT_SLACK;

/**
 * Whether a model may support at all this Fight phase: an infantry model with a spear or pike, not in a fight of its
 * own, standing (not Prone or held), that hasn't shot this turn, isn't a hero who called a heroic action this phase,
 * and hasn't supported another fight already.
 */
export function canSupport(state: GameState, catalog: Catalog | null, m: Model): boolean {
  if (m.dead || m.waiting || m.escaped || m.prone || cannotAct(state, m) || engaged(state, m)) return false;
  if (!(hasSpear(catalog, m) || hasPike(catalog, m)) || isCavalry(catalog, m)) return false;
  if (state.flow.shot?.includes(m.id) || state.flow.supported?.includes(m.id)) return false;
  if (m.hero && state.flow.heroics.some(h => h.model === m.id && h.phase === 'fight')) return false;
  return true;
}

/**
 * The models that can support each side of a fight: spear or pike models touching a friend in it whose base is no
 * bigger than their own, and pikes touching a pike that is supporting. A model that could support two fights is
 * offered to both until it has supported one of them.
 */
export function supporters(state: GameState, catalog: Catalog | null, c: Combat): Record<Seat, string[]> {
  const out: Record<Seat, string[]> = { p1: [], p2: [] };
  for (const seat of ['p1', 'p2'] as const) {
    const front = c[seat].map(id => state.models[id]).filter(m => m && !m.dead);
    const friends = Object.values(state.models).filter(m => m.owner === seat && !c[seat].includes(m.id) && front.some(f => Math.abs(f.x - m.x) < 8 && Math.abs(f.y - m.y) < 8));
    const able = friends.filter(m => canSupport(state, catalog, m));
    const first = able.filter(m => front.some(f => touching(m, f) && area(f) <= area(m)));
    // A pike can also support another pike that is supporting: two ranks behind the fighter.
    const second = able.filter(m => !first.includes(m) && hasPike(catalog, m) && first.some(s => hasPike(catalog, s) && touching(m, s)));
    out[seat] = [...first, ...second].map(m => m.id);
  }
  return out;
}
