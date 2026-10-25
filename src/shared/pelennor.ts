import { castModel, seatOf } from './narrative.ts';
import { fromMarker } from './objects.ts';
import { distanceToTerrain } from './sight.ts';
import { BOARD_H, BOARD_W, GATES_REACH, GATEWAY, MARKER_REACH, MUMAKIL } from './pelennorMap.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

// Battle of Pelennor Fields (The Return of the King): the scenario's own rules, in our own words. The Mordor force holds
// the middle of the field; the Rohirrim ride in from the east and the Dead of Dunharrow from the west. The Mûmakil come
// up from the south in the second turn, the Witch-king flies down from the walls in the fourth, and in the sixth the men
// of Gondor sally out of the broken Gate. When the battle's chosen turns are done, five objectives decide it.

export const isPelennor = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'battle-of-pelennor-fields';
const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;
/** What a model counts for where models are counted: a Mûmak is Dominant (10), a Troll Dominant (3). */
const worth = (m: Model) => Math.max(1, m.dominant ?? 1);

/** How many turns this battle lasts: the players' choice. */
export const pelennorTurns = (state: Pick<GameState, 'narrative'>) => state.narrative?.turns ?? 12;

// ——— The objectives ———

export type Holder = 'good' | 'evil' | null;
export interface PelennorObjective {
  key: string;
  name: string;
  holder: Holder;
  /** How it stands now, in a few words. */
  detail: string;
}

/** The seven Good heroes, and the seven Evil ones, whose fate is an objective each. */
export const WEST_HEROES = ['aragorn', 'legolas', 'gimli', 'gandalf', 'theoden', 'eomer', 'eowyn'];
export const DARK_SERVANTS = ['witch-king', 'gothmog', 'guritz', 'enforcer', 'war-leader', 'chieftain', 'easterling-captain'];

/** The Gates of Minas Tirith: the gateway through the wall. */
export const gates = (state: GameState) => state.terrain['n-gate'];
/** The four Objective Markers. */
export const markers = (state: GameState) => [1, 2, 3, 4].map(i => state.terrain[`n-objective-${i}`]).filter(Boolean);

/** The Mûmakil themselves (not their riders). */
export const mumakil = (state: GameState): Model[] => Object.values(state.models).filter(m => (MUMAKIL as readonly string[]).includes(m.cast ?? '') && m.beast === 'war');

/** The objectives as they stand right now. */
export function pelennorObjectives(state: GameState): PelennorObjective[] {
  const good = seatOf(state, 'good');
  const models = Object.values(state.models).filter(alive);
  const side = (m: Model): 'good' | 'evil' => (m.owner === good ? 'good' : 'evil');
  const most = (list: Model[]): { holder: Holder; g: number; e: number } => {
    const g = list.filter(m => side(m) === 'good').reduce((n, m) => n + worth(m), 0);
    const e = list.filter(m => side(m) === 'evil').reduce((n, m) => n + worth(m), 0);
    return { holder: g > e ? 'good' : e > g ? 'evil' : null, g, e };
  };
  const fate = (keys: string[]) => {
    const list = keys.map(k => castModel(state, k)).filter((m): m is Model => !!m);
    const dead = list.filter(m => m.dead).length;
    return { up: list.length - dead, dead };
  };
  const west = fate(WEST_HEROES);
  const dark = fate(DARK_SERVANTS);
  const beasts = mumakil(state);
  const slain = beasts.filter(m => m.dead).length;
  const gate = gates(state);
  const atGates = most(gate ? models.filter(m => distanceToTerrain(m, gate) <= GATES_REACH) : []);
  const held = markers(state).map(t => most(models.filter(m => fromMarker(m, t) <= MARKER_REACH)).holder);
  const g = held.filter(h => h === 'good').length;
  const e = held.filter(h => h === 'evil').length;
  return [
    { key: 'west', name: 'Heroes of the West', holder: west.up > west.dead ? 'good' : west.dead > west.up ? 'evil' : null, detail: `${west.up} alive, ${west.dead} slain` },
    { key: 'dark', name: 'Servants of the Dark Lord', holder: dark.up > dark.dead ? 'evil' : dark.dead > dark.up ? 'good' : null, detail: `${dark.up} alive, ${dark.dead} slain` },
    { key: 'mumakil', name: 'The Mûmakil', holder: beasts.length && slain === beasts.length ? 'good' : 'evil', detail: `${slain} of ${beasts.length || 3} slain` },
    { key: 'gates', name: 'Gates of Minas Tirith', holder: atGates.holder, detail: `Good ${atGates.g}, Evil ${atGates.e} within ${GATES_REACH}"` },
    { key: 'pelennor', name: 'The Pelennor', holder: g > e ? 'good' : e > g ? 'evil' : null, detail: `Markers: Good ${g}, Evil ${e}` },
  ];
}

/** Each side's tally of objectives claimed. */
export function pelennorTally(state: GameState): { good: number; evil: number } {
  const o = pelennorObjectives(state);
  return { good: o.filter(x => x.holder === 'good').length, evil: o.filter(x => x.holder === 'evil').length };
}

/**
 * Over once the chosen turns are done (as the last End phase begins), or as soon as one side has nobody left, on the
 * table or still to come. Then whoever has claimed more of the five objectives wins; the same number is a draw.
 */
export function pelennorWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const left = (s: Seat) => Object.values(state.models).some(m => m.owner === s && !m.dead && !m.escaped);
  const over = !left(good) || !left(evil) || state.turn > pelennorTurns(state) || (state.turn === pelennorTurns(state) && state.phase === 'end');
  if (!over) return null;
  const t = pelennorTally(state);
  return t.good > t.evil ? good : t.evil > t.good ? evil : 'draw';
}

// ——— War Beasts of Harad, the Witch-king, Defend the White City ———

export type Arrival = 'mumakil' | 'witch-king' | 'gondor';
/** The turn each comes on, as that side's move ends. */
export const ARRIVAL_TURN: Record<Arrival, number> = { mumakil: 2, 'witch-king': 4, gondor: 6 };
const ARRIVAL_SIDE: Record<Arrival, 'good' | 'evil'> = { mumakil: 'evil', 'witch-king': 'evil', gondor: 'good' };
export const ARRIVALS: Arrival[] = ['mumakil', 'witch-king', 'gondor'];

/** Those of one arrival still off the table (not those carried: they come with their beast or their rider). */
export function arrivalWaiting(state: GameState, which: Arrival): Model[] {
  const seat = seatOf(state, ARRIVAL_SIDE[which]);
  return Object.values(state.models).filter(m => {
    if (m.owner !== seat || !m.waiting || m.dead || m.aboard) return false;
    if (which === 'mumakil') return (MUMAKIL as readonly string[]).includes(m.cast ?? '');
    if (which === 'witch-king') return m.cast === 'witch-king';
    return true;
  });
}

/** The arrival due as this side's move ends, if any: from its turn on, until all of it is on (any held up come next turn). */
export function arrivalFor(state: GameState, seat: Seat): Arrival | null {
  if (!isPelennor(state) || !state.flow.started || state.phase !== 'move' || state.flow.entering?.turn === state.turn) return null;
  return ARRIVALS.find(a => seatOf(state, ARRIVAL_SIDE[a]) === seat && state.turn >= ARRIVAL_TURN[a] && arrivalWaiting(state, a).length > 0) ?? null;
}

/** Whether ending this side's move must wait for its arrivals to come on first (see reducer endActivation). */
export const arrivalPending = (state: GameState, seat: Seat) => !!arrivalFor(state, seat);

/** A side has asked to end its move with an arrival due: it comes on now. */
export const pelennorDue = (state: GameState) => isPelennor(state) && !state.result && !!state.flow.reinforce && arrivalPending(state, state.flow.reinforce);

/** Where along its edge an arrival comes on, inches from the west edge: the Evil player's choice, the middle unless they say. */
export const SPAN: [number, number] = [6, BOARD_W - 6];
export const arrivalPoint = (state: GameState, which: 'mumakil' | 'witch-king') =>
  Math.min(SPAN[1], Math.max(SPAN[0], (which === 'mumakil' ? state.narrative?.mumak : state.narrative?.wraith) ?? BOARD_W / 2));

/** Whether the Evil player may still choose where the Mûmakil, or the Witch-king, come on. */
export const mayChoosePoint = (state: GameState, seat: Seat, which: 'mumakil' | 'witch-king') =>
  isPelennor(state) && seat === seatOf(state, 'evil') && !state.result && arrivalWaiting(state, which).length > 0 && !(state.flow.entering?.turn === state.turn && state.flow.entering.ids.some(id => arrivalWaiting(state, which).some(m => m.id === id)));

/**
 * The arrival comes on, as reinforcements (they may not charge). The Mûmakil up from the south edge where the Evil
 * player said, each with all aboard it, and unable to trample anyone yet; the Witch-king over the walls from the north
 * edge; the men of Gondor out through the Gates, Pippin riding behind Gandalf.
 */
export function pelennorArrives(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const seat = state.flow.reinforce!;
  const which = arrivalFor(state, seat);
  if (!which) return [];
  const coming = arrivalWaiting(state, which);
  const ids = coming.map(m => m.id);
  const roll = (label: string, note: string): Action => ({ type: 'rolled', roll: { id: `n-${uid()}`, by: seat, label, dice: [], note, at: now } as DiceRoll });
  if (which === 'mumakil') {
    const x = arrivalPoint(state, 'mumakil');
    return [roll('War Beasts of Harad: the Mûmakil arrive', `They come up from the south edge, ${Math.round(x)}" from the west corner, and may trample no one this turn.`), { type: 'entering', seat, ids, from: [x, BOARD_H], span: [0, BOARD_W] }];
  }
  if (which === 'witch-king') {
    const x = arrivalPoint(state, 'witch-king');
    return [roll('The Witch-king flies down from the walls', `He comes on over the north edge, ${Math.round(x)}" from the west corner.`), { type: 'entering', seat, ids, from: [x, 0], span: [0, BOARD_W] }];
  }
  return [roll('Defend the White City: the Gondor force sallies out', 'Gandalf, Irolas and the men of Gondor come out through the Gates of Minas Tirith.'), { type: 'entering', seat, ids, from: [(GATEWAY[0] + GATEWAY[2]) / 2, 0], span: [GATEWAY[0], GATEWAY[2]] }];
}

// ——— Charge of the Rohirrim ———

/** The Rohirrim: Théoden, Gamling, Éomer, Éowyn and the Riders of Rohan. */
export const ROHIRRIM = ['theoden', 'gamling', 'eomer', 'eowyn', 'rider'];

/** A Rohan model, hero or warrior, that charged this turn may declare a Heroic Combat for nothing in the Fight phase. */
export const rohirrimCharge = (state: GameState, m: Model) =>
  isPelennor(state) && state.flow.started && state.phase === 'fight' && !m.dead && ROHIRRIM.includes(m.cast ?? '') && m.owner === seatOf(state, 'good') && !!state.flow.charges?.[m.id] && !state.flow.heroics.some(h => h.model === m.id && h.phase === 'fight');

// ——— The computer ———

/** Where the computer brings the Mûmakil on: below the thickest part of the Good side, or the middle. */
export function mumakAim(state: GameState): number {
  const good = seatOf(state, 'good');
  const men = Object.values(state.models).filter(m => m.owner === good && alive(m));
  if (!men.length) return BOARD_W / 2;
  const x = men.reduce((n, m) => n + m.x, 0) / men.length;
  return Math.min(SPAN[1], Math.max(SPAN[0], Math.round(x)));
}

/** Where the computer brings the Witch-king on: above the Good hero nearest the walls (Théoden first), or the middle. */
export function wraithAim(state: GameState): number {
  const theoden = castModel(state, 'theoden');
  if (theoden && alive(theoden)) return Math.min(SPAN[1], Math.max(SPAN[0], Math.round(theoden.x)));
  return BOARD_W / 2;
}
