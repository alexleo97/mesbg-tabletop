// Spears and pikes in a fight: friends behind the front rank lending a die and a strike.
import type { Catalog } from './catalog.ts';
import { CONTACT_SLACK, type Combat } from './flow.ts';
import { hasGear, hasPike, hasSpear as plainSpear } from './gear.ts';
import { hasRule } from './wargear.ts';
import { distanceBetween } from './geometry.ts';
import { onLadder } from './defenders.ts';
import { engaged } from './movement.ts';
import { cannotAct, isCavalry } from './powers.ts';
import { invisibleTo } from './ring.ts';
import type { GameState, Model, Seat } from './types.ts';

const area = (m: Model) => m.base.w * m.base.h;
/**
 * A spear to support with. Spear Mastery (the Rohirrim) makes throwing spears one in the Fight phase, unless they were
 * thrown this turn: a model that shot can't support anyway.
 */
const hasSpear = (catalog: Catalog | null | undefined, m: Model) => plainSpear(catalog, m) || (hasRule(catalog, m, 'Spear Mastery') && hasGear(catalog, m, /throwing spears?/));
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
    // Nobody can lend a spear to a model fighting from the top of a Siege Ladder.
    // Nor to an Invisible friend, nor to a model only fighting foes it can't see.
    const foes = c[seat === 'p1' ? 'p2' : 'p1'].map(id => state.models[id]).filter(m => m && !m.dead);
    const front = c[seat].map(id => state.models[id]).filter(m => m && !m.dead && !onLadder(state, m) && !m.ringOn && !(foes.length && foes.every(o => invisibleTo(o, m))));
    const friends = Object.values(state.models).filter(m => m.owner === seat && !c[seat].includes(m.id) && front.some(f => Math.abs(f.x - m.x) < 8 && Math.abs(f.y - m.y) < 8));
    const able = friends.filter(m => canSupport(state, catalog, m));
    const first = able.filter(m => front.some(f => touching(m, f) && area(f) <= area(m)));
    // A pike can also support another pike that is supporting: two ranks behind the fighter.
    const second = able.filter(m => !first.includes(m) && hasPike(catalog, m) && first.some(s => hasPike(catalog, s) && touching(m, s)));
    out[seat] = [...first, ...second].map(m => m.id);
  }
  return out;
}

/**
 * A model can only gain Support from one spear at a time: of these supporters, the spears that can each be matched to
 * a different fighter they back up, earlier ones first (pikes aren't limited).
 */
export function oneSpearEach(state: GameState, catalog: Catalog | null, front: string[], ids: string[]): string[] {
  const fighters = front.map(id => state.models[id]).filter((m): m is Model => !!m);
  const backs = (s: Model) => fighters.filter(f => touching(s, f) && area(f) <= area(s));
  const by: Record<string, string> = {};
  // Hands the spear a fighter, moving an earlier spear on to another fighter if it has to.
  const place = (s: Model, seen: Set<string>): boolean =>
    backs(s).some(f => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      if (by[f.id] && !place(state.models[by[f.id]], seen)) return false;
      by[f.id] = s.id;
      return true;
    });
  return ids.filter(id => {
    const m = state.models[id];
    return !m || hasPike(catalog, m) || !hasSpear(catalog, m) || place(m, new Set());
  });
}
