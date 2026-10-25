// The turn sequence as the app runs it: who acts now, who rolls for priority, and which fights are on.
import { touching } from './barriers.ts';
import { fightDone, fightsAgain } from './movement.ts';
import { heroicNow } from './heroics.ts';
import type { GameState, Model, Seat } from './types.ts';

export const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/**
 * Bases this close count as touching. Real base contact is 0", but dragging on a phone is rough,
 * so a little slack stops a fight being missed because a model stopped a hair short.
 */
export const CONTACT_SLACK = 0.2;

export interface Combat {
  /** Stable id for this group of models, so a resolved fight stays ticked off. */
  key: string;
  p1: string[];
  p2: string[];
}

/**
 * Each model's enemies in base contact with it: models on different floors of a building, or one far above the other,
 * aren't touching; two touching a wall from opposite sides are (see barriers.ts).
 */
function contacts(models: Model[], state: GameState): Map<string, string[]> {
  const near = new Map<string, string[]>();
  // A siege engine is never in a fight.
  const p1 = models.filter(m => m.owner === 'p1' && !m.siege);
  const p2 = models.filter(m => m.owner === 'p2' && !m.siege);
  for (const a of p1) {
    for (const b of p2) {
      // Cheap reject first: no base is wider than about 4".
      if (Math.abs(a.x - b.x) > 5 || Math.abs(a.y - b.y) > 5) continue;
      if (!touching(state, a, b)) continue;
      near.set(a.id, [...(near.get(a.id) ?? []), b.id]);
      near.set(b.id, [...(near.get(b.id) ?? []), a.id]);
    }
  }
  for (const list of near.values()) list.sort();
  return near;
}

/** The enemies a model is in base contact with. */
export function enemiesTouching(state: GameState, id: string): string[] {
  const m = state.models[id];
  if (!m) return [];
  const alive = Object.values(state.models).filter(x => !x.dead && !x.waiting && !x.escaped && (x.id === id || (x.owner !== m.owner && Math.abs(x.x - m.x) < 5 && Math.abs(x.y - m.y) < 5)));
  return contacts(alive, state).get(id) ?? [];
}

const keyOf = (p1: string[], p2: string[]) => [...[...p1].sort(), '|', ...[...p2].sort()].join(',');

/**
 * Pairs off models in base contact into fights, so that no fight has more than one model on both sides. Each model
 * fights only enemies it touches. `choices` are the Priority player's say where a model could go either way (model
 * id to the enemy it fights); the rest is split so as to keep fights as even as the contacts allow.
 */
export function pairOff(models: Model[], state: GameState, choices: Record<string, string> = {}): Combat[] {
  const near = contacts(models, state);
  const owner = new Map(models.map(m => [m.id, m.owner]));
  const fights: Record<Seat, Set<string>>[] = [];
  const at = new Map<string, number>();
  const add = (i: number, id: string) => {
    fights[i][owner.get(id)!].add(id);
    at.set(id, i);
  };
  const open = () => fights.push({ p1: new Set(), p2: new Set() }) - 1;
  // A model can join its side of a fight only while the other side has just the one model.
  const canJoin = (i: number, id: string) => fights[i][other(owner.get(id)!)].size <= 1;
  for (const [id, foe] of Object.entries(choices)) {
    if (!near.get(id)?.includes(foe)) continue;
    const a = at.get(id);
    const b = at.get(foe);
    if (a === undefined && b === undefined) {
      const i = open();
      add(i, id);
      add(i, foe);
    } else if (a === undefined && canJoin(b!, id)) add(b!, id);
    else if (b === undefined && canJoin(a!, foe)) add(a!, foe);
  }
  const free = (id: string) => !at.has(id);
  // The model touching the most unpaired enemies takes them all on, and so on until no one is left over.
  for (;;) {
    let best: string | null = null;
    let most = 0;
    for (const [id, list] of near) {
      if (!free(id)) continue;
      const n = list.filter(free).length;
      if (n > most || (n === most && n > 0 && best !== null && id < best)) [best, most] = [id, n];
    }
    if (!best) break;
    const i = open();
    add(i, best);
    for (const foe of near.get(best)!.filter(free)) add(i, foe);
  }
  // Anyone still unpaired touches only paired enemies: it joins one of their fights, or takes one of them on alone.
  for (const [id, list] of near) {
    if (!free(id)) continue;
    const foe = list[0];
    const i = at.get(foe)!;
    if (canJoin(i, id)) add(i, id);
    else {
      fights[i][owner.get(foe)!].delete(foe);
      const j = open();
      add(j, foe);
      add(j, id);
    }
  }
  return fights.filter(f => f.p1.size && f.p2.size).map(f => ({ key: keyOf([...f.p1], [...f.p2]), p1: [...f.p1].sort(), p2: [...f.p2].sort() }));
}

/**
 * The fights on the table. In the Fight phase they are the ones paired off when it began (see Flow.pairs), so a model
 * that backs away into another fight doesn't fight twice; models free to fight again after a Heroic Combat, or not
 * in a fight at all, are paired off afresh if they touch an enemy. Outside the Fight phase it's whoever is touching.
 */
export function combats(state: GameState): Combat[] {
  const alive = Object.values(state.models).filter(m => !m.dead && !m.waiting && !m.escaped);
  const pairs = state.phase === 'fight' ? state.flow.pairs : undefined;
  if (!pairs) return pairOff(alive, state, state.flow.pairChoices);
  const living = new Set(alive.map(m => m.id));
  const fixed: Combat[] = [];
  const busy = new Set<string>();
  for (const key of pairs) {
    const c = combatFromKey(state, key);
    if (!c) continue;
    const done = state.flow.resolved.includes(key);
    const p1 = c.p1.filter(id => living.has(id));
    const p2 = c.p2.filter(id => living.has(id));
    if (!done && (!p1.length || !p2.length)) continue;
    fixed.push({ key, p1, p2 });
    // A model whose fight is over stays out of new ones, unless a Heroic Combat lets it go again.
    for (const id of [...c.p1, ...c.p2]) if (!done || !freedByHeroicCombat(state, id)) busy.add(id);
  }
  return [...fixed, ...pairOff(alive.filter(m => !busy.has(m.id)), state)];
}

/** Whether a model won a Heroic Combat (or barged) this Fight phase and may fight again (see movement.ts fightsAgain). */
const freedByHeroicCombat = (state: GameState, id: string) => !!state.models[id] && fightsAgain(state, state.models[id]);

/** A fight rebuilt from its key, for when its models are no longer touching (the losers backed away). */
export function combatFromKey(state: GameState, key: string): Combat | undefined {
  const parts = key.split(',');
  const bar = parts.indexOf('|');
  if (bar < 0) return undefined;
  const ids = (list: string[]) => list.filter(id => state.models[id]);
  const c = { key, p1: ids(parts.slice(0, bar)), p2: ids(parts.slice(bar + 1)) };
  return c.p1.length && c.p2.length ? c : undefined;
}

/**
 * The fight the battle card shows for an opened key. Once the battle is under way fights only happen in the Fight
 * phase, so outside it nothing is shown; in it, a fight whose losers backed away is still rebuilt from its key, so its
 * wounds can be applied.
 */
export function shownFight(state: GameState, key: string | null, fights: Combat[]): Combat | undefined {
  if (!key || (state.flow.started && state.phase !== 'fight')) return undefined;
  return fights.find(c => c.key === key) ?? combatFromKey(state, key);
}

/** The fight to open when the Fight phase comes round: the first one still to be rolled. */
export const fightToOpen = (state: GameState, fights: Combat[]): Combat | undefined => fights.find(c => !fightDone(state, c));

/**
 * Who chooses priority from a roll-off. On turn 1 a tie is re-rolled (null); later a tie goes to
 * the player who didn't choose last turn.
 */
export function priorityChooser(dice: [number, number], turn: number, lastChooser: Seat | null): Seat | null {
  if (dice[0] !== dice[1]) return dice[0] > dice[1] ? 'p1' : 'p2';
  if (turn <= 1 || !lastChooser) return null;
  return other(lastChooser);
}

/**
 * Weathertop: the Good side has finished its move, from turn 2 (or in the turn of the Cry), and Aragorn hasn't come
 * yet, so its player may roll for him (once a turn) before anyone else acts.
 */
export function arrivalDue(state: GameState): boolean {
  const ns = state.narrative;
  if (ns?.id !== 'weathertop' || !state.flow.started || state.phase !== 'move' || !state.flow.done.includes(ns.good) || ns.rolled?.includes(state.turn)) return false;
  const aragorn = Object.values(state.models).find(m => m.cast === 'aragorn');
  if (!aragorn?.waiting || aragorn.dead) return false;
  return state.turn >= 2 || ns.cry === state.turn;
}

/**
 * Escape from Osgiliath's "Nazgûl!": a Move phase has begun and the Evil player has yet to pick a Good Warrior for the
 * Nazgûl to freeze with fear (or say nobody), so nobody moves until they do.
 */
export function dreadDue(state: GameState): boolean {
  const ns = state.narrative;
  if (ns?.id !== 'escape-from-osgiliath' || !state.flow.started || state.result || state.phase !== 'move' || ns.dread === state.turn) return false;
  return Object.values(state.models).some(m => m.owner === ns.good && !m.hero && !m.dead && !m.waiting && !m.escaped);
}

/** In the Move and Shoot phases, the player who should be activating models now (priority first). */
export function activeSeat(state: GameState): Seat | null {
  if (state.phase !== 'move' && state.phase !== 'shoot') return null;
  // Heroes making a Heroic Move or Heroic Shoot go before everyone else.
  const heroic = state.flow.started ? heroicNow(state) : null;
  if (heroic) return heroic.seat;
  // Nobody activates while the Good side at Weathertop decides whether to roll for Aragorn.
  if (arrivalDue(state) || dreadDue(state)) return null;
  const first = state.priority ?? 'p1';
  if (!state.flow.done.includes(first)) return first;
  const second = other(first);
  return state.flow.done.includes(second) ? null : second;
}
