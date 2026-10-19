import type { Catalog } from './catalog.ts';
import type { Action, GameState, Model } from './types.ts';

// Mighty Hero: at the start of every turn the hero gains a bonus Might point, even with its store full. One left
// unspent when the turn ends is lost (it is spent before the hero's own Might).

export const mightyHero = (catalog: Catalog | null | undefined, m: Model) => !!(m.profileId && catalog?.units[m.profileId]?.rules.includes('Mighty Hero'));

/** Whether this turn's bonus Might is still to be handed out. */
export const mightyDue = (state: GameState, catalog: Catalog | null | undefined) =>
  state.flow.started && !state.result && state.flow.mighty?.turn !== state.turn && Object.values(state.models).some(m => !m.dead && !m.waiting && mightyHero(catalog, m));

/** Takes back last turn's unspent bonus point and gives this turn's. */
export function mightyBonus(state: GameState, catalog: Catalog | null | undefined, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  const base: Record<string, number> = {};
  for (const m of Object.values(state.models)) {
    if (m.dead || m.waiting || !mightyHero(catalog, m)) continue;
    const before = state.flow.mighty?.base[m.id];
    const own = before === undefined ? m.might : Math.min(m.might, before);
    base[m.id] = own;
    out.push({ type: 'affect', id: m.id, patch: { might: own + 1 } });
    out.push({ type: 'rolled', roll: { id: `r-${uid()}`, by: m.owner, label: `Mighty Hero: ${m.name} gains a bonus Might point`.slice(0, 80), dice: [], model: m.id, note: before !== undefined && m.might > before ? 'Last turn’s unspent bonus point is lost.' : 'Lost if not spent this turn.', at: now } });
  }
  out.push({ type: 'mightyHero', base });
  return out;
}
