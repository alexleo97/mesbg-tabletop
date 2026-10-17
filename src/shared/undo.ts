import type { Action, GameState, Revert } from './types.ts';

const FIELDS = ['board', 'turn', 'phase', 'priority', 'names', 'scenario', 'vp', 'listed'] as const;

/** Actions a player can take back. Dice, saves and undo itself can't be. */
export const UNDOABLE = new Set<Action['type']>([
  'addModels', 'moveModels', 'updateModel', 'removeModels',
  'addTerrain', 'updateTerrain', 'removeTerrain',
  'setPhase', 'nextPhase', 'setPriority', 'setScenario', 'setVP', 'setBoard', 'setScenery',
]);

/**
 * Records what changed between two states, as it was before, so the change can be put back
 * without touching anything else (such as the other player's later moves).
 * Relies on the reducer leaving untouched models and terrain as the same objects.
 */
export function diffForUndo(before: GameState, after: GameState): Revert | null {
  const out: Revert = {};
  for (const key of ['models', 'terrain'] as const) {
    if (before[key] === after[key]) continue;
    const changed: Record<string, unknown> = {};
    const prev = before[key] as Record<string, unknown>;
    const next = after[key] as Record<string, unknown>;
    for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (prev[id] !== next[id]) changed[id] = prev[id] ?? null;
    }
    if (Object.keys(changed).length) (out as Record<string, unknown>)[key] = changed;
  }
  const fields: Record<string, unknown> = {};
  for (const f of FIELDS) if (before[f] !== after[f]) fields[f] = before[f];
  if (Object.keys(fields).length) out.fields = fields as Revert['fields'];
  return out.models || out.terrain || out.fields ? out : null;
}

/**
 * Folds a newer change into an older one, keeping the oldest "before" for each thing.
 * Used so one drag, sent as many small moves, undoes in one step.
 */
export function mergeReverts(older: Revert, newer: Revert): Revert {
  return {
    models: older.models || newer.models ? { ...newer.models, ...older.models } : undefined,
    terrain: older.terrain || newer.terrain ? { ...newer.terrain, ...older.terrain } : undefined,
    fields: older.fields || newer.fields ? { ...newer.fields, ...older.fields } : undefined,
  };
}
