import data from '../data/scenarios.json';
import type { Seat, Terrain } from './types.ts';

// Matched play scenarios as game facts (deployment, objectives, scoring) in our own words.
// Positions are inches on a 48"×48" board with the origin top-left; player 1 deploys at the bottom.

export type Zone =
  | { seat: Seat | 'either'; shape: 'rect'; x: number; y: number; w: number; h: number; label?: string }
  | { seat: Seat | 'either'; shape: 'circle' | 'semicircle' | 'quarter-circle'; cx: number; cy: number; r: number; label?: string }
  | { seat: Seat | 'either'; shape: 'polygon'; points: [number, number][]; label?: string }
  | { seat: Seat | 'either'; shape: 'edge'; edges?: string[]; edge?: string; minFromCorner?: number; label?: string; note?: string };

export interface Scenario {
  id: string;
  name: string;
  pool: number;
  deployment: { type: string; description: string; zones: Zone[] };
  objectives: { count: number; placement?: string; fixedPositions?: [number, number][]; markerKind: string; note?: string };
  specialRules: string[];
  gameEnd: string;
  scoring: { label: string; points: string; when?: string }[];
}

export const POOLS = ['', 'Hold Objective', 'Kill the Enemy', 'Maelstrom of Battle', 'Object', 'Manoeuvring', 'Unique'];

export const SCENARIOS = data.scenarios as unknown as Scenario[];
export const COMMON_RULES = data.commonRules as { id: string; name: string; summary: string }[];
export const SELECTION_RULE: string = data.selection;

export const scenarioById = (id: string | null) => SCENARIOS.find(s => s.id === id);

/**
 * Picks a scenario from server-rolled dice: the first die picks the pool, the next die of 1-4
 * picks the scenario in it (the guide re-rolls 5s and 6s, so we roll spares up front).
 */
export function scenarioFromDice(dice: number[]): Scenario | undefined {
  const pool = dice[0];
  const pick = dice.slice(1).find(d => d <= 4) ?? ((dice[dice.length - 1] - 1) % 4) + 1;
  return SCENARIOS.filter(s => s.pool === pool)[pick - 1];
}

/** Objective markers for the scenario's fixed positions, scaled to the board size. */
export function scenarioMarkers(s: Scenario, w: number, h: number, newId: (p: string) => string): Terrain[] {
  return (s.objectives.fixedPositions ?? []).map(([x, y]) => ({
    id: newId('t'),
    kind: 'objective',
    shape: 'circle',
    x: (x / 48) * w,
    y: (y / 48) * h,
    w: 1.6,
    h: 1.6,
    rot: 0,
    // Players place and nudge markers themselves, so they can be dragged.
    locked: false,
  }));
}

/** Sum of a player's victory points. */
export const vpTotal = (tally: Record<string, number>) => Object.values(tally).reduce((a, b) => a + b, 0);
