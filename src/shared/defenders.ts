import { modelStats, type Catalog } from './catalog.ts';
import { distanceBetween } from './geometry.ts';
import { canActivate } from './heroics.ts';
import { ladderable } from './fortress.ts';
import { engaged } from './movement.ts';
import { onTable, touching as touchingMarker } from './objects.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { distanceToTerrain, heightOf } from './sight.ts';
import { fallDamage } from './terrainTests.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// A fortress's defenders drop rocks and pour boiling oil on attackers at the foot of the walls or on a ladder. Both
// are thrown in the Shoot phase from the battlements, reach 8", and hit on a 4+ whoever throws them.

type D6 = () => number;
export type HurlHow = 'rocks' | 'oil';

const RANGE = 8;
const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;

/** The raised Siege Ladder a model is on, if any. */
export const onLadder = (state: GameState, m: Model) => onTable(state).find(t => t.object === 'ladder' && t.raised && touchingMarker(m, t));

/** Whether a model stands on the battlements: touching a wall or anything else with height to defend from. */
const onWalls = (state: GameState, m: Model) => Object.values(state.terrain).some(t => ladderable(t) && distanceToTerrain(m, t) <= 0.25);

/** Whether an enemy can be reached from the walls: within 1" of them, or climbing a ladder. */
const belowWalls = (state: GameState, e: Model) => !!onLadder(state, e) || Object.values(state.terrain).some(t => ladderable(t) && distanceToTerrain(e, t) <= 1);

/** The other defender helping pour a vat of oil: a friend touching it, out of any fight. */
const oilHelper = (state: GameState, m: Model, oil: Terrain) => Object.values(state.models).find(f => f.id !== m.id && f.owner === m.owner && alive(f) && touchingMarker(f, oil) && !engaged(state, f));

/** Why a model can't throw this at that enemy; unset if it can. */
export function hurlBlocked(state: GameState, how: HurlHow, m: Model | undefined, item: Terrain | undefined, target: Model | undefined): string | undefined {
  if (!m || !alive(m) || !item || !target || !alive(target) || target.owner === m.owner) return 'Nothing to do';
  if (!state.flow.started || state.phase !== 'shoot' || !canActivate(state, m.owner)) return 'Only in your Shoot phase';
  if (item.gone || item.object !== how || (item.side && item.side !== m.owner)) return 'Not yours to use';
  if (item.carrier !== m.id && !touchingMarker(m, item)) return `Must be touching the ${how === 'oil' ? 'oil' : 'rocks'}`;
  if (state.flow.shot?.includes(m.id) || m.prone || engaged(state, m)) return 'Not free to throw';
  if (!onWalls(state, m)) return 'Must be on the walls';
  if (how === 'oil' && !oilHelper(state, m, item)) return 'Needs a second model at the vat';
  if (distanceBetween(m, target) > RANGE) return `Out of range (${RANGE}")`;
  if (!belowWalls(state, target)) return 'Only at enemies by the walls or on a ladder';
  return undefined;
}

/** What a defender could throw at whom right now, for its card: the closest few targets. */
export function hurlOptions(state: GameState, m: Model): { how: HurlHow; item: string; target: string; label: string }[] {
  if (!state.flow.started || state.phase !== 'shoot') return [];
  const out: { how: HurlHow; item: string; target: string; label: string }[] = [];
  const items = onTable(state).filter(t => (t.object === 'rocks' || t.object === 'oil') && (t.carrier === m.id || touchingMarker(m, t)));
  const foes = Object.values(state.models).filter(e => e.owner !== m.owner && alive(e) && distanceBetween(m, e) <= RANGE).sort((a, b) => distanceBetween(m, a) - distanceBetween(m, b));
  for (const t of items) {
    const how = t.object as HurlHow;
    for (const e of foes) {
      if (hurlBlocked(state, how, m, t, e)) continue;
      out.push({ how, item: t.id, target: e.id, label: `${how === 'oil' ? 'Pour oil on' : 'Drop rocks on'} ${e.name}` });
      if (out.filter(o => o.item === t.id).length >= 3) break;
    }
  }
  return out;
}

/**
 * Rolls a throw: 4+ to hit, then a Strength 6 hit for rocks or Strength 8 for oil (which also splashes everyone within
 * 2" at Strength 4). Someone hit on a ladder falls off on 1-3 (1-4 for oil). A vat runs dry on a 1 after pouring.
 */
export function resolveHurl(state: GameState, catalog: Catalog | null, seat: Seat, how: HurlHow, modelId: string, itemId: string, targetId: string, d6: D6, uid: () => string, now: number): Action[] | null {
  const m = state.models[modelId];
  const item = state.terrain[itemId];
  const target = state.models[targetId];
  if (!m || m.owner !== seat || hurlBlocked(state, how, m, item, target)) return null;
  // (A shot's group: its first roll names the thrower, marking it as having shot this turn.)
  const group = `s-${uid()}`;
  const rolls: DiceRoll[] = [];
  const push = (label: string, dice: number[], extra: Partial<DiceRoll> = {}) => {
    rolls.push({ id: `${group}-${rolls.length}`, by: seat, label: label.slice(0, 80), dice, at: now, group, ...extra });
  };
  const out: Action[] = [];
  const hit = d6();
  push(`${m.name} ${how === 'oil' ? 'pours boiling oil on' : 'drops rocks on'} ${target!.name} (4+)`, [hit], { target: 4, model: m.id, note: hit >= 4 ? 'A hit.' : 'It misses.' });
  const strike = (v: Model, s: number, label: string) => {
    const need = woundNeed(s, modelStats(catalog, v)?.D ?? 4);
    if (!need) return push(`${label}: S${s} on ${v.name} (can’t wound)`, []);
    const dice = [d6()];
    const follow = need.then && dice[0] >= need.target ? [d6()] : undefined;
    const wounded = need.then ? !!follow && follow[0] >= need.then : dice[0] >= need.target;
    push(`${label}: S${s} on ${v.name} (${formatNeed(need)})`, dice, { target: need.target, against: v.id, ...(need.then ? { then: need.then, follow } : {}), note: wounded ? `${v.name} is wounded.` : `${v.name} shrugs it off.` });
    if (wounded) out.push({ type: 'wound', id: v.id, count: 1, by: [m.id], how: 'shoot', group });
  };
  if (hit >= 4) {
    strike(target!, how === 'oil' ? 8 : 6, how === 'oil' ? 'Boiling oil' : 'Rocks');
    if (how === 'oil') for (const v of Object.values(state.models).filter(v => v.id !== target!.id && alive(v) && !v.siege && distanceBetween(v, target!) <= 2)) strike(v, 4, 'Splashed');
    // Knocked off a ladder: a fall from the top of the wall.
    const ladder = onLadder(state, target!);
    if (ladder) {
      const d = d6();
      const off = d <= (how === 'oil' ? 4 : 3);
      push(`${target!.name} clings to the ladder (${how === 'oil' ? '5' : '4'}+)`, [d], { target: how === 'oil' ? 5 : 4, model: target!.id, note: off ? `${target!.name} falls off.` : `${target!.name} holds on.` });
      if (off) {
        const wall = ladder.raised ? state.terrain[ladder.raised] : undefined;
        out.push({ type: 'affect', id: target!.id, patch: { prone: true } }, ...fallDamage(catalog, target!, wall ? heightOf(wall) : 2, d6, push, group));
      }
    }
  }
  if (how === 'oil') {
    const dry = d6();
    push(`Is there oil left? (1 runs dry)`, [dry], { note: dry === 1 ? 'The vat is empty.' : 'Plenty left.' });
    if (dry === 1) out.push({ type: 'updateTerrain', id: item!.id, patch: { gone: 'destroyed', by: seat } });
  }
  return [...rolls.map((r): Action => ({ type: 'rolled', roll: r })), ...out];
}
