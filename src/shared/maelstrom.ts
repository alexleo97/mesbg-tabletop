import { placeNear } from './deployment.ts';
import { activeSeat } from './flow.ts';
import { heroicsSettled } from './heroics.ts';
import { scenarioById } from './scenarios.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Maelstrom of Battle: nobody deploys at the start. As each side starts to move, the game rolls a D6 for each of its
// warbands still off the table: on a 1 it doesn't come this turn; otherwise it arrives on a table edge (2 or 4 the
// side's own edge or the far one, 3 or 5 a short edge, 6 any edge), at least 6" from a corner, and moves on from there.

export type Edge = 'north' | 'south' | 'east' | 'west';
const CORNER = 6;
const ENTRY_RADIUS = 12;

export const isMaelstrom = (state: Pick<GameState, 'scenario'>) => scenarioById(state.scenario)?.deployment.type === 'maelstrom';

/** Where waiting models are kept: well off the table, a side apart, so nothing on the table reaches them. */
export const offTable = (seat: Seat, board: { w: number; h: number }) => ({ x: -30, y: seat === 'p1' ? board.h + 30 : -30 });

/** The side that should roll for its waiting warbands now, if any: as its Move activation starts, once a turn. */
export function arrivalsDue(state: GameState): Seat | null {
  if (!state.flow.started || state.phase !== 'move' || !heroicsSettled(state) || !isMaelstrom(state)) return null;
  const seat = activeSeat(state);
  if (!seat || state.flow.arrived?.includes(seat)) return null;
  return Object.values(state.models).some(m => m.owner === seat && m.waiting && !m.dead) ? seat : null;
}

/** A side's waiting models, warband by warband (models with no warband go together). */
export function waitingWarbands(state: GameState, seat: Seat): Model[][] {
  const groups = new Map<string, Model[]>();
  for (const m of Object.values(state.models)) if (m.owner === seat && m.waiting && !m.dead) groups.set(m.warband ?? '', [...(groups.get(m.warband ?? '') ?? []), m]);
  return [...groups.values()];
}

/** What a warband is called in the log: after its leader. */
export function warbandName(models: Model[]): string {
  const leader = models.find(m => m.hero);
  return leader ? `${leader.name}'s warband` : models.length === 1 ? models[0].name : `${models.length} ${models[0].name}s`;
}

/** Which edge a roll brings a warband on by: the side's own edge where there's a choice of long edges, a short one by a second roll. */
function edgeFor(roll: number, seat: Seat, d6: () => number): { edge: Edge; side?: number } | null {
  const home: Edge = seat === 'p1' ? 'south' : 'north';
  if (roll === 1) return null;
  if (roll === 3 || roll === 5) {
    const side = d6();
    return { edge: side <= 3 ? 'west' : 'east', side };
  }
  return { edge: home };
}

/** A point on the edge at least 6" from either corner. */
function entryPoint(edge: Edge, board: { w: number; h: number }, rand: () => number) {
  const along = (len: number) => CORNER + rand() * Math.max(0, len - 2 * CORNER);
  if (edge === 'north') return { x: along(board.w), y: 0 };
  if (edge === 'south') return { x: along(board.w), y: board.h };
  if (edge === 'west') return { x: 0, y: along(board.h) };
  return { x: board.w, y: along(board.h) };
}

/** Rolls for each of a side's waiting warbands and brings on those that arrive, facing into the table. */
export function rollArrivals(state: GameState, seat: Seat, d6: () => number, uid: () => string, rand: () => number = Math.random, now = Date.now()): Action[] {
  const rolls: DiceRoll[] = [];
  const moves: { id: string; x: number; y: number; rot: number }[] = [];
  const taken: Model[] = Object.values(state.models).filter(m => !m.dead && !m.waiting && !m.escaped);
  for (const band of waitingWarbands(state, seat)) {
    const name = warbandName(band);
    const roll = d6();
    const where = edgeFor(roll, seat, d6);
    const dice = [roll];
    if (!where) {
      rolls.push({ id: `a-${uid()}`, by: seat, label: `Maelstrom: ${name} doesn't arrive this turn`.slice(0, 80), dice, at: now, note: 'A 1: it rolls again next turn.' });
      continue;
    }
    const at = entryPoint(where.edge, state.board, rand);
    // Arrivals come on outside enemy control zones (1"), so nobody starts a fight just by turning up.
    const placed = placeNear(state, band, { seat, shape: 'circle', cx: at.x, cy: at.y, r: ENTRY_RADIUS }, at, taken, o => (o.owner === seat ? 0.1 : 1.05));
    const rot = (p: { x: number; y: number }) => Math.round((Math.atan2(state.board.w / 2 - p.x, -(state.board.h / 2 - p.y)) * 180) / Math.PI / 15) * 15;
    for (const p of placed) {
      moves.push({ id: p.id, x: p.x, y: p.y, rot: rot(p) });
      taken.push({ ...state.models[p.id], x: p.x, y: p.y });
    }
    const short = placed.length < band.length ? ` (${band.length - placed.length} had no room)` : '';
    const note = where.side ? `A short edge, rolled for: ${where.side} (1-3 west, 4-6 east).` : undefined;
    rolls.push({ id: `a-${uid()}`, by: seat, label: `Maelstrom: ${name} arrives on the ${where.edge} edge${short}`.slice(0, 80), dice, at: now, ...(note ? { note } : {}) });
  }
  return [...rolls.map((roll): Action => ({ type: 'rolled', roll })), { type: 'arrive', seat, moves }];
}
