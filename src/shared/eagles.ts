import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { insidePolygon, outline } from './sight.ts';
import { basesOverlap, engaged, landsAt, limitMove, moveAllowance, moveStart } from './movement.ts';
import { canActivate, heroicNow } from './heroics.ts';
import { castModel, seatOf } from './narrative.ts';
import { HIDING_TREES, MARKER_SIZE } from './eaglesMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// Out of the Frying Pan... And Into the Fire (An Unexpected Journey): the scenario's own rules, in our own words.
// Thorin's Company hides in the pines from Azog's Hunters, and the Eagles fly down to carry them off: a Dwarf Marker
// beside each of five trees, then Thorin and Bilbo. Thorin, seeing the Pale Orc alive, goes for him.

export const isFire = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'and-into-the-fire';

/** The Eagles come on as the Good side's second Move phase ends. */
export const EAGLES_TURN = 2;

export const EDGES = ['north', 'south'] as const;
export type Edge = (typeof EDGES)[number];

const alive = (m: Model | undefined): m is Model => !!m && !m.dead && !m.waiting && !m.escaped;
const radius = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

export const isEagle = (m: Pick<Model, 'cast'>) => m.cast === 'eagle' || m.cast === 'gwaihir';
/** The Great Eagles, who come back after carrying a load off the table, or after being slain (Gwaihir doesn't). */
export const isGreatEagle = (m: Pick<Model, 'cast'>) => m.cast === 'eagle';
/** Who the Eagles carry besides the Dwarf Markers. */
export const isPassenger = (m: Pick<Model, 'cast'>) => m.cast === 'thorin' || m.cast === 'bilbo';

/** The trees: each pine's trunk. */
export const pines = (state: GameState) => Object.values(state.terrain).filter(t => t.look === 'pine' && !t.gone);
/** The Dwarf Markers, wherever they are now (on the table, carried, rescued or lost). */
export const dwarfMarkers = (state: GameState) => Object.values(state.terrain).filter(t => t.kind === 'objective' && t.object === 'dwarf');

/** What an Eagle carries: the Dwarf Markers it has picked up, and Thorin or Bilbo riding on it. */
export function loadOf(state: GameState, eagle: Model): { markers: Terrain[]; riders: Model[] } {
  return {
    markers: dwarfMarkers(state).filter(t => t.carrier === eagle.id && !t.gone),
    riders: Object.values(state.models).filter(m => m.aboard === eagle.id && !m.dead),
  };
}
export const carrying = (state: GameState, eagle: Model) => {
  const l = loadOf(state, eagle);
  return l.markers.length + l.riders.length > 0;
};

// ——— Hiding in the trees ———

/** Whose turn it is to nominate a tree, once both sides are set up: the Good player first, then in turn. */
export function nominationTurn(state: GameState): Seat | null {
  const d = state.flow.deploy;
  if (!isFire(state) || state.flow.started || !d || d.step !== 'sides') return null;
  const good = seatOf(state, 'good')!;
  const evil = seatOf(state, 'evil')!;
  if (!d.placed.includes(`${good}:*`) || !d.placed.includes(`${evil}:*`)) return null;
  const n = state.narrative?.hiding?.length ?? 0;
  return n >= HIDING_TREES ? null : n % 2 ? evil : good;
}

/** The woodland base (or the brush) a tree stands on. */
function standOf(state: GameState, tree: Terrain): Terrain | undefined {
  return Object.values(state.terrain).find(t => t.kind === 'wood' && Math.hypot(t.x - tree.x, t.y - tree.y) <= Math.max(t.w, t.h) / 2 && insidePolygon(outline(t), tree));
}

/**
 * Where a tree's Dwarf Marker goes: beside it, just off its woodland base on the side the tree stands nearest the
 * base's edge, where an Eagle can land touching it; clear of the other trees and markers.
 */
export function markerSpot(state: GameState, tree: Terrain): Point {
  const r = MARKER_SIZE / 2;
  const stand = standOf(state, tree);
  const away = stand && Math.hypot(tree.x - stand.x, tree.y - stand.y) > 0.3 ? Math.atan2(tree.y - stand.y, tree.x - stand.x) : Math.PI;
  const poly = stand ? outline(stand) : [];
  const others = Object.values(state.terrain).filter(t => !t.gone && ((t.look === 'pine' && t.id !== tree.id) || (t.kind === 'objective' && t.object === 'dwarf')));
  const clear = (p: Point) => p.x > r && p.y > r && p.x < state.board.w - r && p.y < state.board.h - r && others.every(t => Math.hypot(t.x - p.x, t.y - p.y) >= t.w / 2 + r + 0.05) && Math.hypot(tree.x - p.x, tree.y - p.y) >= tree.w / 2 + r;
  for (let k = 0; k < 36; k++) {
    const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
    // Out from the tree until the marker's middle is just off the base.
    for (let d = tree.w / 2 + r; d < 8; d += 0.05) {
      const p = { x: tree.x + Math.cos(a) * d, y: tree.y + Math.sin(a) * d };
      if (poly.length && insidePolygon(poly, p)) continue;
      const q = { x: +(p.x + Math.cos(a) * 0.05).toFixed(2), y: +(p.y + Math.sin(a) * 0.05).toFixed(2) };
      if (clear(q)) return q;
      break;
    }
  }
  return { x: tree.x + Math.cos(away) * (tree.w / 2 + r), y: tree.y + Math.sin(away) * (tree.w / 2 + r) };
}

/** A tree a player may nominate now: one of the pines, not already nominated. */
export const mayNominate = (state: GameState, seat: Seat, tree: string) =>
  nominationTurn(state) === seat && state.terrain[tree]?.look === 'pine' && !state.narrative?.hiding?.includes(tree);

/** The tree is nominated, and its Dwarf Marker put beside it. */
export function nominate(state: GameState, tree: string): GameState {
  const t = state.terrain[tree];
  const hiding = [...(state.narrative!.hiding ?? []), tree];
  const id = `n-dwarves-${hiding.length}`;
  const p = markerSpot(state, t);
  const marker: Terrain = { id, kind: 'objective', object: 'dwarf', shape: 'circle', x: p.x, y: p.y, w: MARKER_SIZE, h: MARKER_SIZE, rot: 0, locked: true };
  return { ...state, terrain: { ...state.terrain, [id]: marker }, narrative: { ...state.narrative!, hiding } };
}

/** A name for a tree a player can find on the table: its number, and which part of the table it is in. */
export function treeName(state: GameState, tree: Terrain): string {
  const n = tree.id.replace(/^n-pine-/, '');
  const ns = tree.y < state.board.h / 3 ? 'north' : tree.y > (state.board.h * 2) / 3 ? 'south' : 'middle';
  return `Pine ${n} (${ns}${tree.x < state.board.w / 2 ? ', in the brush' : ''})`;
}

// ——— The Eagles carrying ———

/**
 * At the end of each Good Move phase, each Eagle not in a fight and carrying nothing picks up Thorin, Bilbo or a Dwarf
 * Marker it is touching (Thorin first, then Bilbo, then the markers). Returns the state with them picked up.
 */
export function pickUps(state: GameState): GameState {
  if (!isFire(state) || !state.flow.started) return state;
  let out = state;
  const foesOf = (m: Model) => Object.values(out.models).filter(e => e.owner !== m.owner && alive(e) && !e.aboard);
  for (const eagle of Object.values(state.models).filter(m => isEagle(m) && alive(m) && m.owner === seatOf(state, 'good'))) {
    if (carrying(out, eagle) || foesOf(eagle).some(e => distanceBetween(eagle, e) <= 0.02)) continue;
    const rider = ['thorin', 'bilbo'].map(k => castModel(out, k)).find(p => alive(p) && !p.aboard && distanceBetween(eagle, p) <= 0.25);
    if (rider) {
      out = { ...out, models: { ...out.models, [rider.id]: { ...rider, x: eagle.x, y: eagle.y, aboard: eagle.id, prone: undefined } } };
      continue;
    }
    const marker = dwarfMarkers(out).find(t => !t.gone && !t.carrier && Math.hypot(t.x - eagle.x, t.y - eagle.y) - radius(eagle) - t.w / 2 <= 0.25);
    if (marker) out = { ...out, terrain: { ...out.terrain, [marker.id]: { ...marker, carrier: eagle.id } } };
  }
  return out;
}

/**
 * Keeps the Eagles' loads with them: an Eagle slain while carrying loses its load (the Dwarves, Thorin or Bilbo are
 * slain too), and one that leaves the table carrying rescues it. Notes the turn each Great Eagle left, for its return.
 */
export function eaglesSync(state: GameState): GameState {
  if (!isFire(state) || !state.flow.started) return state;
  let terrain = state.terrain;
  let models = state.models;
  let flown = state.narrative?.flown;
  for (const eagle of Object.values(state.models).filter(isEagle)) {
    if (!eagle.dead && !eagle.escaped) continue;
    for (const t of dwarfMarkers(state).filter(x => x.carrier === eagle.id && !x.gone)) terrain = { ...terrain, [t.id]: { ...t, gone: eagle.dead ? 'destroyed' : 'rescued', by: eagle.owner } };
    for (const r of Object.values(models).filter(x => x.aboard === eagle.id && !x.dead && !x.escaped)) {
      const { aboard: _, ...rest } = r;
      models = { ...models, [r.id]: eagle.dead ? { ...rest, dead: true, wounds: 0 } : { ...rest, escaped: true } };
    }
    if (isGreatEagle(eagle) && flown?.[eagle.id] === undefined) flown = { ...flown, [eagle.id]: state.turn };
  }
  if (terrain === state.terrain && models === state.models && flown === state.narrative?.flown) return state;
  return { ...state, terrain, models, narrative: { ...state.narrative!, ...(flown ? { flown } : {}) } };
}

// ——— Friends on Swift-wings ———

/** The Eagles still to come on: those waiting from the start, and Great Eagles that left (or fell) in an earlier turn. */
export function eaglesComing(state: GameState): Model[] {
  return Object.values(state.models).filter(m => {
    if (!isEagle(m)) return false;
    if (m.waiting && !m.dead && !m.escaped) return true;
    const left = state.narrative?.flown?.[m.id];
    return isGreatEagle(m) && (m.dead || m.escaped) && left !== undefined && left < state.turn;
  });
}

/** The edge the Eagles come on from: the Good player's choice, or else whichever is nearer the Dwarves still to rescue. */
export function eaglesEdge(state: GameState): Edge {
  const good = seatOf(state, 'good');
  const pick = good ? state.flow.picks?.[good]?.edge : undefined;
  if (pick && (EDGES as readonly string[]).includes(pick)) return pick as Edge;
  const left = [...dwarfMarkers(state).filter(t => !t.gone && !t.carrier), ...['thorin', 'bilbo'].map(k => castModel(state, k)).filter((m): m is Model => alive(m) && !m.aboard)];
  const y = left.length ? left.reduce((n, p) => n + p.y, 0) / left.length : state.board.h / 2;
  return y <= state.board.h / 2 ? 'north' : 'south';
}

/** Whether ending the Good side's move must wait for the Eagles to come on (see reducer endActivation). */
export function eaglesPending(state: GameState, seat: Seat): boolean {
  return isFire(state) && state.flow.started && state.phase === 'move' && seat === seatOf(state, 'good') && state.turn >= EAGLES_TURN && state.flow.entering?.turn !== state.turn && eaglesComing(state).length > 0;
}

export const eaglesDue = (state: GameState) => isFire(state) && !state.result && !!state.flow.reinforce && state.flow.reinforce === seatOf(state, 'good') && eaglesPending(state, state.flow.reinforce);

/** The Eagles fly on from the north or south edge, anywhere along it (those coming back first rise from the dead or return). */
export function eaglesArrive(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'good')!;
  const coming = eaglesComing(state);
  const edge = eaglesEdge(state);
  const back = coming.filter(m => m.dead || m.escaped);
  const names = coming.length === 1 ? coming[0].name : `${coming.length} Eagles`;
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: back.length < coming.length ? 'The Eagles fly down' : 'The Eagles return', dice: [], note: `${names} come on from the ${edge} edge.`, at: now };
  const flown = { ...state.narrative?.flown };
  for (const m of back) delete flown[m.id];
  return [
    { type: 'rolled', roll },
    ...back.map((m): Action => ({ type: 'affect', id: m.id, patch: { dead: false, escaped: false, waiting: true, wounds: m.maxWounds, prone: false, effects: [] } })),
    ...(back.length ? [{ type: 'narrativeNote', flown } as Action] : []),
    { type: 'entering', seat, ids: coming.map(m => m.id), from: edge === 'north' ? [state.board.w / 2, 0] : [state.board.w / 2, state.board.h], span: [0, state.board.w] },
  ];
}

/** What the Eagles still have to pick up: the Dwarf Markers left on the table, and Thorin and Bilbo where they stand. */
export function stillToCarry(state: GameState): (Terrain | Model)[] {
  const markers = dwarfMarkers(state).filter(t => !t.gone && !t.carrier);
  const riders = ['thorin', 'bilbo'].map(k => castModel(state, k)).filter((m): m is Model => alive(m) && !m.aboard);
  return [...riders, ...markers];
}

/**
 * Where an Eagle could land touching something it is to carry, so as to pick it up: somewhere it may land, outside
 * every enemy's control zone. The spot nearest the Eagle; undefined if there is none.
 */
export function landingBeside(state: GameState, eagle: Model, load: Terrain | Model): Point | undefined {
  const reach = radius(eagle) + ('kind' in load ? load.w / 2 : radius(load)) + 0.05;
  const foes = Object.values(state.models).filter(e => e.owner !== eagle.owner && alive(e) && !e.aboard && Math.hypot(e.x - load.x, e.y - load.y) < reach + 4);
  let best: Point | undefined;
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const p = { x: load.x + Math.cos(a) * reach, y: load.y + Math.sin(a) * reach };
    if (!landsAt(state, eagle, p, new Set([eagle.id])) || foes.some(e => distanceBetween({ ...eagle, ...p }, e) < 1.02)) continue;
    if (!best || Math.hypot(p.x - eagle.x, p.y - eagle.y) < Math.hypot(best.x - eagle.x, best.y - eagle.y)) best = p;
  }
  return best;
}

/** Which edges an Eagle carrying a load may fly off by: any of them. */
export const eagleExits = (state: GameState, m: Model) => isFire(state) && isEagle(m) && carrying(state, m);

// ——— Thorin's Wrath ———

/** Whether the game must move Thorin now: as the Good side's move gets under way, if he is free to move. */
export function wrathDue(state: GameState): boolean {
  if (!isFire(state) || !state.flow.started || state.result || state.phase !== 'move' || state.narrative?.wrath === state.turn) return false;
  const thorin = castModel(state, 'thorin');
  if (!alive(thorin) || thorin.aboard || !canActivate(state, thorin.owner) || heroicNow(state) || state.flow.done.includes(thorin.owner) || state.flow.entering?.turn === state.turn) return false;
  if (state.flow.starts?.[thorin.id] || engaged(state, thorin)) return false;
  return (moveAllowance(state, thorin) ?? 0) > 0;
}

/** The spots touching an enemy that Thorin could charge it at, nearest him first. */
function chargeSpots(state: GameState, thorin: Model, foe: Model, reach: number): Point[] {
  const out: Point[] = [];
  const from = { x: thorin.x, y: thorin.y };
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const d = radius(thorin) + radius(foe) + 0.01;
    const p = { x: foe.x + Math.cos(a) * d, y: foe.y + Math.sin(a) * d };
    if (Math.hypot(p.x - from.x, p.y - from.y) > reach + 0.5) continue;
    const end = limitMove(state, from, p, reach, thorin.owner, thorin, new Set([thorin.id]));
    if (distanceBetween({ ...thorin, ...end }, foe) <= 0.05) out.push(end);
  }
  return out.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
}

/**
 * Thorin's Wrath: he charges an enemy if he can, Azog if he can reach him; if he can't charge anyone, he goes as close
 * to Azog as he can. The game moves him, and his move is then over.
 */
export function wrathMove(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const thorin = castModel(state, 'thorin')!;
  const reach = moveAllowance(state, thorin) ?? thorin.move;
  const from = moveStart(state, thorin);
  const azog = castModel(state, 'azog');
  const foes = Object.values(state.models)
    .filter(e => e.owner !== thorin.owner && alive(e) && !e.aboard)
    .sort((a, b) => (a.cast === 'azog' ? -1 : 0) - (b.cast === 'azog' ? -1 : 0) || distanceBetween(thorin, a) - distanceBetween(thorin, b));
  let to: Point | undefined;
  for (const foe of foes) {
    if (distanceBetween(thorin, foe) > reach + 1) continue;
    to = chargeSpots(state, thorin, foe, reach)[0];
    if (to) break;
  }
  if (!to) {
    // As close to Azog as he can get (or the nearest enemy, with Azog gone).
    const mark = alive(azog) ? azog : foes[0];
    if (mark) {
      let best = from;
      for (let k = -6; k <= 6; k++) {
        const a = Math.atan2(mark.y - from.y, mark.x - from.x) + (k * Math.PI) / 24;
        const end = limitMove(state, from, { x: from.x + Math.cos(a) * reach, y: from.y + Math.sin(a) * reach }, reach, thorin.owner, thorin, new Set([thorin.id]), false);
        if (distanceBetween({ ...thorin, ...end }, mark) < distanceBetween({ ...thorin, ...best }, mark) - 0.01) best = end;
      }
      to = best;
    }
  }
  const note: DiceRoll = { id: `n-${uid()}`, by: thorin.owner, label: "Thorin's Wrath", dice: [], note: to && foes.some(f => distanceBetween({ ...thorin, ...to! }, f) <= 0.05) ? 'Thorin charges.' : 'No enemy in reach: Thorin makes for Azog.', model: thorin.id, at: now };
  const rot = to ? Math.round((Math.atan2(to.x - thorin.x, thorin.y - to.y) * 180) / Math.PI + 360) % 360 : thorin.rot;
  return [{ type: 'rolled', roll: note }, ...(to && Math.hypot(to.x - thorin.x, to.y - thorin.y) > 0.01 ? [{ type: 'moveModels', moves: [{ id: thorin.id, x: to.x, y: to.y, rot }] } as Action] : []), { type: 'narrativeNote', wrath: state.turn }];
}

// ——— Bilbo ———

/** The enemies fighting Thorin, that Bilbo may be put beside as a Fight phase begins. */
export function bilboTargets(state: GameState): Model[] {
  if (!isFire(state) || state.phase !== 'fight' || state.flow.resolved.length || state.flow.duels?.length) return [];
  const bilbo = castModel(state, 'bilbo');
  const thorin = castModel(state, 'thorin');
  if (!bilbo || !bilbo.waiting || bilbo.dead || !alive(thorin) || thorin.aboard) return [];
  return Object.values(state.models).filter(e => e.owner !== thorin.owner && alive(e) && distanceBetween(thorin, e) <= 0.02);
}

/** Where Bilbo goes beside an enemy fighting Thorin: touching it, on no one else, as near Thorin as he can. */
export function bilboSpot(state: GameState, bilbo: Model, foe: Model): Point | null {
  const thorin = castModel(state, 'thorin');
  const r = radius(bilbo);
  let best: Point | null = null;
  let score = Infinity;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    // Out from the enemy's middle until the bases just touch.
    let d = 0;
    let p = { x: foe.x, y: foe.y };
    while (distanceBetween({ ...bilbo, ...p }, foe) > 0.005 || d === 0) {
      d += 0.02;
      p = { x: foe.x + Math.cos(a) * d, y: foe.y + Math.sin(a) * d };
      if (d > 6) break;
    }
    while (distanceBetween({ ...bilbo, ...p }, foe) < 0.005 && d < 6) {
      d += 0.01;
      p = { x: foe.x + Math.cos(a) * d, y: foe.y + Math.sin(a) * d };
    }
    if (p.x < r || p.y < r || p.x > state.board.w - r || p.y > state.board.h - r) continue;
    const here = { ...bilbo, ...p };
    if (Object.values(state.models).some(o => o.id !== bilbo.id && alive(o) && !o.aboard && basesOverlap(here, o))) continue;
    if (Object.values(state.terrain).some(t => !t.gone && (t.kind === 'building' || t.sheer) && insidePolygon(outline(t), p))) continue;
    const s = thorin ? Math.hypot(thorin.x - p.x, thorin.y - p.y) : 0;
    if (s < score) [best, score] = [p, s];
  }
  return best;
}

// ——— Who wins ———

/**
 * The battle goes on until the Dwarf Markers, Thorin and Bilbo are all off the table. The Good side wins once the
 * Eagles have carried every one of them off; once any of them is slain that can't happen, so the Evil side has won.
 * Bilbo, if he never came on to help Thorin, is rescued along with the Dwarves.
 */
export function fireWinner(state: GameState): Seat | 'draw' | null {
  const markers = dwarfMarkers(state);
  if (markers.length < HIDING_TREES) return null;
  const thorin = castModel(state, 'thorin');
  const bilbo = castModel(state, 'bilbo');
  if (thorin?.dead || bilbo?.dead || markers.some(t => t.gone === 'destroyed')) return seatOf(state, 'evil') ?? null;
  const rescued = markers.every(t => t.gone === 'rescued');
  if (rescued && thorin?.escaped && (bilbo?.escaped || (bilbo?.waiting && !bilbo.dead))) return seatOf(state, 'good') ?? null;
  return null;
}
