import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { CULVERT } from '../src/shared/helms.ts';
import { catalog, play, seeded } from './botsim.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

/** Helm's Deep set up and started as the server would, with the Good side on `good`. */
function battle(good: Seat): GameState {
  let n = 0;
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'helms-deep', good, turns: 10 } as Action, () => 3, () => `u${n++}`, 1, catalog)!;
  const s = out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
  return reduce(s, { type: 'startGame', at: 1 });
}
const gear = (s: GameState, kind: string) => Object.values(s.terrain).filter(t => t.object === kind && !t.gone);

describe('the computer plays Helm’s Deep', () => {
  it('as Isengard, carries its ladders and Demolition Charges at the walls', () => {
    const s = battle('p1');
    const out = play(s, seeded(1), 3000, x => x.turn > 2);
    expect(out.state.turn).toBe(3);
    // Nothing the computer asked for was refused.
    expect(Object.keys(out.counts).filter(k => k.includes('refused'))).toEqual([]);
    const was = (id: string) => s.terrain[id];
    // The ladders are picked up and on their way to the walls (they start 16" out)...
    const ladders = gear(out.state, 'ladder');
    expect(ladders.filter(t => t.carrier).length).toBeGreaterThanOrEqual(7);
    expect(ladders.filter(t => was(t.id).x - t.x >= 5).length).toBeGreaterThanOrEqual(3);
    // ...and every charge is being carried (by its own team while it lives), the closest well on its way to the culvert.
    const charges = gear(out.state, 'charge');
    expect(charges.every(t => t.carrier)).toBe(true);
    expect(charges.filter(t => ['engineer', 'torch'].includes(out.state.models[t.carrier!].cast ?? '')).length).toBeGreaterThanOrEqual(3);
    const gap = (t: { x: number; y: number }) => Math.hypot(t.x - CULVERT.x, t.y - CULVERT.y);
    expect(charges.some(t => gap(was(t.id)) - gap(t) >= 5)).toBe(true);
  }, 240_000);

  it('as Isengard, sets off a Demolition Charge its team has brought to the culvert', () => {
    const b = battle('p2');
    const charge = Object.values(b.terrain).find(t => t.object === 'charge' && Math.abs(t.y - 33) < 1)!;
    const team = Object.values(b.models).filter(m => (m.cast === 'engineer' || m.cast === 'torch') && Math.abs(m.y - 33) < 1.5);
    expect(team).toHaveLength(3);
    // Brought up short of the wall by the culvert, the team round it.
    const at = { x: CULVERT.x + 2.8, y: CULVERT.y };
    const spots = [{ x: at.x + 1.05, y: at.y - 0.6 }, { x: at.x + 1.05, y: at.y + 0.6 }, { x: at.x, y: at.y + 1.05 }];
    let s: GameState = { ...b, turn: 5, terrain: { ...b.terrain, [charge.id]: { ...charge, ...at } }, models: { ...b.models, ...Object.fromEntries(team.map((m, i) => [m.id, { ...m, ...spots[i] }])) } };
    const out = play(s, seeded(4), 3000, x => x.turn > 5);
    s = out.state;
    expect(s.log.some(r => /tries to set off the Demolition Charge/.test(r.label))).toBe(true);
  }, 240_000);

  it('as the Defenders, brings the whole Relief Force on in turn 10 and rides into the attackers', () => {
    // A game the computer played against itself, as the Defenders' 10th move begins: the host of Isengard is at the
    // walls with its rear ranks along the south edge, where the Relief Force comes on.
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/helms-turn10.json', import.meta.url), 'utf8'));
    const good = s.narrative!.good;
    const out = play(s, seeded(5), 3000, x => x.phase === 'shoot');
    const relief = Object.values(out.state.models).filter(m => ['eomer', 'gandalf', 'captain-rohan', 'rider'].includes(m.cast ?? ''));
    expect(relief).toHaveLength(27);
    expect(relief.filter(m => m.waiting)).toHaveLength(0);
    // Éomer charges, and most ride off the edge or into a fight rather than wait where they came on.
    const fighting = (m: Model) => Object.values(out.state.models).some(e => e.owner !== good && !e.dead && distanceBetween(m, e) <= 0.05);
    expect(fighting(relief.find(m => m.cast === 'eomer')!)).toBe(true);
    expect(relief.filter(m => m.y < 46.4 || fighting(m)).length).toBeGreaterThanOrEqual(15);
  }, 240_000);
});

