import { DOOR_SPAN, DOORWAY, LEDGE, offLedge, TRAPDOOR_SIZE, WELL } from './balinMap.ts';
import { modelStats, type Catalog } from './catalog.ts';
import { hitModel } from './cavalry.ts';
import { activeSeat } from './flow.ts';
import { heroicNow } from './heroics.ts';
import type { Point } from './geometry.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Balin's Tomb: the scenario's own rules, in our own words. The Fellowship is trapped in the Chamber of Mazarbul. Every
// Goblin Warrior slain comes back at the end of the Evil side's move, up through the trapdoors and the well or in at
// the doorway, and from the Evil side's fourth move a Cave Troll bursts in through the doorway, trampling its own side
// on the way. The Fellowship must last ten turns with Frodo and at least five of them alive.

export const isBalin = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'balins-tomb';

export const BALIN_TURNS = 10;
/** The Cave Troll comes in from the Evil side's fourth move. */
export const TROLL_TURN = 4;

const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;
const isGoblinWarrior = (m: Pick<Model, 'cast'>) => m.cast === 'goblin';
export const isCaveTroll = (m: Pick<Model, 'cast'>) => m.cast === 'cave-troll';
/** How far a point is from the segment a-b. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const overlap = (a: { x: number; y: number }, ra: number, b: Model) => Math.hypot(a.x - b.x, a.y - b.y) < ra + radius(b) - 0.02;

// ——— "They have a Cave Troll!" ———

/** The Cave Troll bursts in this turn: it moves through its own side, and any Goblin it moves through is hurt. */
export const trollRampant = (state: GameState, m: Model) => isBalin(state) && isCaveTroll(m) && state.narrative?.troll === state.turn && state.phase === 'move';

/** Whether a model may move through `e` (and end its move on it): the Cave Troll the turn it comes in, through its own side. */
export const tramplesThrough = (state: GameState, m: Model, e: Model) => e.owner === m.owner && trollRampant(state, m);

/** As the Evil side starts its move from turn 4, the Cave Troll waiting outside comes in at the doorway. */
export function trollDue(state: GameState): boolean {
  if (!isBalin(state) || !state.flow.started || state.result || state.phase !== 'move' || state.turn < TROLL_TURN || state.narrative?.troll) return false;
  const troll = Object.values(state.models).find(isCaveTroll);
  // (Once any Heroic Moves are over, as the side's own activation begins.)
  return !!troll && !troll.dead && !!troll.waiting && !heroicNow(state) && activeSeat(state) === troll.owner;
}

/** Where the Cave Troll steps in: on the edge in the doorway, as near its middle as there's room, or right in it among the Goblins. */
export function trollSpot(state: GameState, troll: Model): Point {
  const r = radius(troll);
  const y = DOORWAY.y - r;
  const others = Object.values(state.models).filter(o => o.id !== troll.id && alive(o));
  for (let d = 0; d <= (DOOR_SPAN[1] - DOOR_SPAN[0]) / 2; d += 0.05) {
    for (const x of d ? [DOORWAY.x - d, DOORWAY.x + d] : [DOORWAY.x]) {
      if (x - r < DOOR_SPAN[0] || x + r > DOOR_SPAN[1]) continue;
      if (!others.some(o => overlap({ x, y }, r, o))) return { x, y };
    }
  }
  return { x: DOORWAY.x, y };
}

export function trollEnters(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const troll = Object.values(state.models).find(isCaveTroll)!;
  const at = trollSpot(state, troll);
  const roll: DiceRoll = { id: `n-${uid()}`, by: troll.owner, label: '"They have a Cave Troll!"', dice: [], model: troll.id, note: 'The Cave Troll bursts in through the doorway. This turn it moves through its own side, trampling them.', at: now };
  return [{ type: 'rolled', roll }, { type: 'affect', id: troll.id, patch: { waiting: false, x: at.x, y: at.y, rot: 0 } }, { type: 'narrativeNote', troll: state.turn }];
}

/** The Goblins the Cave Troll has moved through this turn and not yet hurt (not counting any it stands on now). */
export function trampledBy(state: GameState, troll: Model): Model[] {
  const path = state.flow.paths?.[troll.id];
  if (!trollRampant(state, troll) || !path || path.length < 2) return [];
  const r = radius(troll);
  const hit = new Set(state.narrative?.crushed ?? []);
  return Object.values(state.models).filter(g => {
    if (g.owner !== troll.owner || g.id === troll.id || !alive(g) || hit.has(g.id) || overlap(troll, r, g)) return false;
    const reach = r + radius(g) - 0.05;
    return path.some((p, i) => i > 0 && toSegment(g, { x: path[i - 1][0], y: path[i - 1][1] }, { x: p[0], y: p[1] }) < reach);
  });
}

export function trampleDue(state: GameState): boolean {
  if (!isBalin(state) || !state.flow.started || state.result) return false;
  const troll = Object.values(state.models).find(isCaveTroll);
  return !!troll && alive(troll) && trampledBy(state, troll).length > 0;
}

/** Each Goblin the Cave Troll has moved through takes a Strength 3 hit. */
export function trample(state: GameState, catalog: Catalog | null, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const troll = Object.values(state.models).find(isCaveTroll)!;
  const under = trampledBy(state, troll);
  const group = `tt-${uid()}`;
  const out: Action[] = [];
  for (const g of under) out.push(...hitModel(g, modelStats(catalog, g)?.D ?? 5, 3, 'Trampled by the Cave Troll', d6, troll.owner, `${group}-${uid()}`, now, group).actions);
  out.push({ type: 'narrativeNote', crushed: under.map(g => g.id) });
  return out;
}

/** The Goblins the Cave Troll has finished its move on, the turn it comes in: they are slain. */
export const crushedUnder = (state: GameState): Model[] => {
  const troll = Object.values(state.models).find(isCaveTroll);
  if (!troll || !alive(troll) || state.narrative?.troll !== state.turn) return [];
  return Object.values(state.models).filter(g => g.owner === troll.owner && g.id !== troll.id && alive(g) && overlap(troll, radius(troll), g));
};

/** Troll Rampage: +1 Fight in a turn it charged. */
export const trollRampage = (state: GameState, m: Model) => isBalin(state) && isCaveTroll(m) && !!state.flow.charges?.[m.id];

// ——— The Goblin Tide ———

/** The Goblin Warriors kept aside: slain, or still waiting to come back. */
export const keptAside = (state: GameState): Model[] => Object.values(state.models).filter(m => isGoblinWarrior(m) && !m.escaped && (m.dead || m.waiting));

/** Whether ending the Evil side's move now must wait for the Goblin Tide (see reducer endActivation). */
export function tidePending(state: GameState, seat: Seat): boolean {
  return isBalin(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'evil') && state.flow.entering?.turn !== state.turn && (keptAside(state).length > 0 || crushedUnder(state).length > 0);
}

/** The Evil side has asked to end its move: the Goblins kept aside come back first. */
export const tideDue = (state: GameState) => isBalin(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'evil') && tidePending(state, state.flow.reinforce);

/** Where the Goblins come back: up to one at each trapdoor no Good model stands on, two by the well, the rest at the doorway. */
export function tideSpots(state: GameState, coming: Model[]): { id: string; x: number; y: number; from: string }[] {
  const good = seatOf(state, 'good');
  const standing = Object.values(state.models).filter(alive);
  const taken: { x: number; y: number; r: number }[] = [];
  const clear = (p: Point, r: number) => p.x >= r && p.y >= r && p.x <= 24 - r && p.y <= 24 - r && !standing.some(o => overlap(p, r, o)) && !taken.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.r + r - 0.02);
  const queue = [...coming];
  const out: { id: string; x: number; y: number; from: string }[] = [];
  const place = (from: string, tries: Point[], limit: number) => {
    for (let n = 0; n < limit && queue.length; n++) {
      const m = queue[0];
      const r = radius(m);
      const p = tries.find(q => clear(q, r));
      if (!p) return;
      queue.shift();
      taken.push({ ...p, r });
      out.push({ id: m.id, x: p.x, y: p.y, from });
    }
  };
  for (const t of Object.values(state.terrain).filter(t => t.look === 'trapdoor' && !t.gone)) {
    // A Good model standing on the trapdoor keeps it shut.
    const half = TRAPDOOR_SIZE / 2;
    if (standing.some(o => o.owner === good && Math.abs(o.x - t.x) < half + radius(o) && Math.abs(o.y - t.y) < half + radius(o))) continue;
    const near: Point[] = [{ x: t.x, y: t.y }];
    for (let d = 0.2; d <= 1.6; d += 0.2) for (let a = 0; a < 16; a++) near.push({ x: t.x + Math.cos((a * Math.PI) / 8) * d, y: t.y + Math.sin((a * Math.PI) / 8) * d });
    // (Up on the ledge, where the trapdoor is.)
    place('a trapdoor', near.filter(p => (t.x < 12 ? p.x <= LEDGE.w - 0.45 : p.x >= 24 - LEDGE.w + 0.45)), 1);
  }
  const well = Object.values(state.terrain).find(t => t.look === 'well' && !t.gone) ?? { x: WELL.x, y: WELL.y, w: WELL.d };
  const rim: Point[] = [];
  // Climbing out over the well's rim, on the side facing the middle first.
  for (let k = 0; k < 24; k++) {
    const a = Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
    rim.push({ x: well.x + Math.cos(a) * (well.w / 2 + 0.52), y: well.y + Math.sin(a) * (well.w / 2 + 0.52) });
  }
  place('the well', rim.filter(p => offLedge(p, 0.49)), 2);
  return out;
}

/**
 * The Goblin Tide: the Goblins the Cave Troll ended its move on are slain, and every Goblin Warrior kept aside comes
 * back, at a trapdoor, by the well or in at the doorway (those that can't get in try again next turn). They then make
 * their move, and may charge.
 */
export function goblinTide(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'evil')!;
  const out: Action[] = [];
  const crushed = crushedUnder(state);
  if (crushed.length) {
    out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: 'Crushed beneath the Cave Troll', dice: [], note: `${crushed.length === 1 ? crushed[0].name : `${crushed.length} Goblins`}, under the Cave Troll as it stops, ${crushed.length === 1 ? 'is' : 'are'} slain.`, at: now } });
    out.push(...crushed.map(g => ({ type: 'affect', id: g.id, patch: { dead: true } }) as Action));
  }
  const ids = new Set(crushed.map(g => g.id));
  const coming = [...keptAside(state), ...crushed.filter(g => isGoblinWarrior(g) && !keptAside(state).includes(g))];
  if (!coming.length) return [...out, { type: 'entering', seat, ids: [], from: [DOORWAY.x, DOORWAY.y] }];
  const spots = tideSpots({ ...state, models: Object.fromEntries(Object.entries(state.models).map(([k, m]) => [k, ids.has(k) ? { ...m, dead: true } : m])) }, coming);
  const via = (from: string) => spots.filter(s => s.from === from).length;
  const door = coming.length - spots.length;
  const where = [via('a trapdoor') && `${via('a trapdoor')} up through the trapdoors`, via('the well') && `${via('the well')} out of the well`, door && `${door} in at the doorway`].filter(Boolean).join(', ');
  out.push({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label: 'The Goblin Tide', dice: [], note: `${coming.length} Goblin${coming.length === 1 ? '' : 's'} swarm back in: ${where}. They may move and charge.`, at: now } });
  for (const g of coming) out.push({ type: 'affect', id: g.id, patch: { dead: false, waiting: true, wounds: g.maxWounds, prone: false } });
  out.push({ type: 'entering', seat, ids: coming.map(g => g.id), from: [DOORWAY.x, DOORWAY.y], span: DOOR_SPAN, charge: true, spots: spots.map(s => [s.id, s.x, s.y]) });
  return out;
}

// ——— Who wins ———

/** How many of the Fellowship have been slain. */
export const fellowshipSlain = (state: GameState) => Object.values(state.models).filter(m => m.owner === seatOf(state, 'good') && m.dead).length;

/**
 * Frodo slain is an Evil win at once, as is a fifth member of the Fellowship falling. If neither has happened when
 * the tenth turn ends (as its End phase begins), the Fellowship has held out and wins.
 */
export function balinWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  if (castModel(state, 'frodo')?.dead || fellowshipSlain(state) >= 5) return evil;
  if (state.turn > BALIN_TURNS || (state.turn === BALIN_TURNS && state.phase === 'end')) return good;
  return null;
}
