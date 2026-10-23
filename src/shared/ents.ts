import type { FightRequest } from './fight.ts';
import { seatOf } from './narrative.ts';
import type { GameState, Model, Seat } from './types.ts';

// Last March of the Ents: the scenario's own rules, in our own words. The Ents must break the dam on the west edge to
// loose the River Isen on Saruman's works; the Orcs shoot fire at them, and drag them down with ropes and numbers.

export const isEnts = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'last-march-of-the-ents';

/** Treebeard, Birchseed, Beechbone and the Ents: all of the Good side here. */
const ENTS = ['treebeard', 'birchseed', 'beechbone', 'ent'];
export const isEnt = (m: Pick<Model, 'cast'>) => !!m.cast && ENTS.includes(m.cast);
/** An Orc of Isengard: a Captain or a Warrior. */
export const isOrc = (m: Pick<Model, 'cast'>) => m.cast === 'orc' || m.cast === 'captain';

const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;

/** The dam, while it stands. */
export const dam = (state: GameState) => {
  const t = state.terrain['n-dam'];
  return t && !t.gone ? t : undefined;
};

/**
 * Flaming Arrows: an Orc shooting at an Ent. A natural 6 To Hit that goes on to wound does 2 Wounds instead of 1, and
 * Sets the Ent Ablaze (see resolveShot).
 */
export const flamingArrows = (state: GameState, shooter: Model, target: Model) => isEnts(state) && state.flow.started && isOrc(shooter) && isEnt(target);

/**
 * "Bring them down!": the Ent the Orcs on one side of a fight could pull down, if they win it. It takes three or more
 * Orcs in base contact (not just supporting) and an Ent among their foes; the one struck first is the one they go for.
 */
export function bringDownTarget(state: GameState, req: Pick<FightRequest, 'sides' | 'targets'>, side: 0 | 1): string | undefined {
  if (!isEnts(state) || !state.flow.started) return undefined;
  const evil = seatOf(state, 'evil');
  const orcs = req.sides[side].filter(f => !f.support && state.models[f.id]?.owner === evil && alive(state.models[f.id]));
  if (orcs.length < 3) return undefined;
  const ents = req.sides[1 - side].filter(f => !f.support && state.models[f.id] && isEnt(state.models[f.id]) && alive(state.models[f.id]));
  return (ents.find(f => f.id === req.targets[side]) ?? ents[0])?.id;
}

/**
 * The Ents win as the dam is destroyed; the Orcs win once every Ent is slain. With every Orc gone, nothing is left to
 * stop the Ents breaking the dam, so they win then too.
 */
export function entsWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const t = state.terrain['n-dam'];
  if (t?.gone || !Object.values(state.models).some(m => m.owner === evil && alive(m))) return good;
  if (!Object.values(state.models).some(m => m.owner === good && alive(m))) return evil;
  return null;
}
