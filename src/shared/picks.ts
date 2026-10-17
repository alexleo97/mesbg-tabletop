import { generalOf } from './scoring.ts';
import type { GameState, Model, Picks, Seat } from './types.ts';

export interface PickSpec {
  key: keyof Picks;
  label: string;
  /** Whose models it names: your own or the enemy's. A terrain pick names a piece in the enemy half. */
  of: 'own' | 'enemy' | 'terrain';
  /** The General can't be picked unless it's that side's only Hero. */
  notGeneral?: boolean;
}

/** The secret choices each scenario asks for. */
export const PICKS: Record<string, PickSpec[]> = {
  assassination: [
    { key: 'target', label: 'Your Target (an enemy Hero)', of: 'enemy', notGeneral: true },
    { key: 'assassin', label: 'Your Assassin', of: 'own', notGeneral: true },
  ],
  'contest-of-champions': [{ key: 'champion', label: 'Your Champion', of: 'own' }],
  'fog-of-war': [
    { key: 'protect', label: 'Your Hero to protect', of: 'own', notGeneral: true },
    { key: 'hunt', label: 'The enemy Hero to hunt', of: 'enemy', notGeneral: true },
    { key: 'terrain', label: 'Terrain to hold (in the enemy half)', of: 'terrain' },
  ],
};

/** Heroes a side may pick: not its General, unless the General is its only Hero. */
export function pickableHeroes(state: GameState, seat: Seat, notGeneral?: boolean): Model[] {
  const side = Object.values(state.models).filter(m => m.owner === seat);
  const heroes = side.filter(m => m.hero);
  const general = generalOf(side);
  return notGeneral && heroes.length > 1 ? heroes.filter(m => m !== general) : heroes;
}

/** What a seat can choose for one pick: heroes by name, or terrain pieces wholly in the opponent's half. */
export function pickOptions(state: GameState, seat: Seat, p: PickSpec): { id: string; name: string }[] {
  if (p.of === 'terrain') {
    const half = state.board.h / 2;
    // Wholly in the opponent's half: the top half for player 1.
    return Object.values(state.terrain)
      .filter(t => t.kind !== 'objective' && t.kind !== 'road' && (seat === 'p1' ? t.y + t.h / 2 <= half : t.y - t.h / 2 >= half))
      .map((t, i) => ({ id: t.id, name: `${t.kind[0].toUpperCase()}${t.kind.slice(1)} ${i + 1} (${Math.round(t.x)}", ${Math.round(t.y)}")` }));
  }
  return pickableHeroes(state, p.of === 'own' ? seat : seat === 'p1' ? 'p2' : 'p1', p.notGeneral).map(m => ({ id: m.id, name: m.name }));
}
