import type { Catalog } from './catalog.ts';
import type { FightRequest } from './fight.ts';
import { hasGear } from './gear.ts';
import type { GameState, Model } from './types.ts';

// The Morgul Blade: once a game, before the strikes of a fight, its bearer may strike with it instead of its usual
// weapon. All its strikes go at one enemy, and a wound from them that isn't prevented slays that enemy outright.

export const MORGUL = 'Morgul Blade';

/** Whether a model still has its Morgul Blade to use. */
export const hasMorgulBlade = (catalog: Catalog | null | undefined, m: Model) => !m.used?.includes(MORGUL) && hasGear(catalog, m, /morgul blade/i);

/** The Morgul Blades declared for this fight, each with the enemy its strikes go at. */
export function morgulBlades(state: GameState, catalog: Catalog | null | undefined, req: FightRequest): { by: string; target: string }[] {
  const out: { by: string; target: string }[] = [];
  for (const side of [0, 1] as const) {
    const foes = req.sides[1 - side].filter(f => !f.support).map(f => f.id);
    for (const f of req.sides[side]) {
      const m = state.models[f.id];
      const target = state.flow.choices?.[f.id]?.morgul;
      if (f.support || !m || !target || !foes.includes(target) || !hasMorgulBlade(catalog, m)) continue;
      out.push({ by: f.id, target });
    }
  }
  return out;
}
