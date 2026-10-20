import data from '../data/scenarios.json';
import type { GameState, Seat, Terrain } from './types.ts';

// Matched play scenarios as game facts (deployment, objectives, scoring) in our own words.
// Positions are inches on a 48"×48" board with the origin top-left; player 1 deploys at the bottom.

export type Zone =
  | { seat: Seat | 'either'; shape: 'rect'; x: number; y: number; w: number; h: number; label?: string }
  | { seat: Seat | 'either'; shape: 'circle' | 'semicircle' | 'quarter-circle'; cx: number; cy: number; r: number; /** Up and down, on a table that isn't square. */ ry?: number; label?: string }
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

/** Siege gear and other markers that aren't a scenario's objectives. */
const NOT_OBJECTIVES = new Set(['ladder', 'ram', 'rocks', 'oil', 'rally', 'campfire']);

/** How many of the scenario's objective markers still have to be put on the table before the battle can start. */
export function objectivesMissing(state: GameState): number {
  const s = scenarioById(state.scenario);
  if (!s || !s.objectives.count || !['objective', 'heirloom', 'supply', 'relic', 'artefact', 'wounded-ally'].includes(s.objectives.markerKind)) return 0;
  const have = Object.values(state.terrain).filter(t => t.kind === 'objective' && !t.vines && !NOT_OBJECTIVES.has(t.object ?? '')).length;
  return Math.max(0, s.objectives.count - have);
}

/**
 * Picks a scenario from server-rolled dice: the first die picks the pool, the next die of 1-4
 * picks the scenario in it (the guide re-rolls 5s and 6s, so we roll spares up front).
 */
export function scenarioFromDice(dice: number[]): Scenario | undefined {
  const pool = dice[0];
  const pick = dice.slice(1).find(d => d <= 4) ?? ((dice[dice.length - 1] - 1) % 4) + 1;
  return SCENARIOS.filter(s => s.pool === pool)[pick - 1];
}

/** Objective markers for the scenario's fixed positions, scaled to the board size, set up as what they stand for. */
export function scenarioMarkers(s: Scenario, w: number, h: number, newId: (p: string) => string, rand: () => number = Math.random, extras = true): Terrain[] {
  const spots = (s.objectives.fixedPositions ?? []).map(([x, y]) => [(x / 48) * w, (y / 48) * h] as [number, number]);
  // Markers the players place themselves (Domination's) are placed in turn after a roll-off (see deploy.ts); with
  // `extras` they're set out at once instead, in legal spots: 12" from each other and 6" from the edges.
  for (let tries = 0; extras && spots.length < s.objectives.count && s.objectives.markerKind === 'objective' && tries < 500; tries++) {
    const p: [number, number] = [6 + rand() * (w - 12), 6 + rand() * (h - 12)];
    if (spots.every(([x, y]) => Math.hypot(x - p[0], y - p[1]) >= 12)) spots.push(p);
  }
  const setup = markerSetup(s.id, s.objectives.markerKind, spots, h / 2, rand);
  return spots.map(([x, y], i) => ({
    id: newId('t'),
    kind: 'objective',
    shape: 'circle',
    x,
    y,
    w: 1.6,
    h: 1.6,
    rot: 0,
    // Players place and nudge markers themselves, so they can be dragged.
    locked: false,
    ...setup[i],
  }));
}

/** What each fixed marker of a scenario is, when it is more than a plain objective (positions already scaled). */
function markerSetup(scenarioId: string, kind: string, positions: [number, number][], half: number, rand: () => number): Partial<Terrain>[] {
  switch (kind) {
    case 'relic':
      // The first is player 1's.
      return positions.map((p, i) => ({ object: 'relic', side: i === 0 ? 'p1' : 'p2', home: p }));
    case 'artefact':
      return positions.map(() => ({ object: 'artefact', hidden: true }));
    case 'heirloom': {
      if (scenarioId !== 'heirloom-of-ages-past') return positions.map(() => ({ object: 'heirloom' }));
      // One real Heirloom among face-down decoys.
      const real = Math.floor(rand() * positions.length);
      return positions.map((_, i) => ({ object: i === real ? 'heirloom' : 'decoy', hidden: true }));
    }
    case 'supply':
      return positions.map(([, y]) => ({ object: 'supply', side: y > half ? 'p1' : 'p2' }));
    case 'wounded-ally':
      return positions.map(([, y]) => ({ object: 'ally', side: y > half ? 'p1' : 'p2' }));
    default:
      return positions.map(() => ({}));
  }
}

/** Sum of a player's victory points. */
export const vpTotal = (tally: Record<string, number>) => Object.values(tally).reduce((a, b) => a + b, 0);
