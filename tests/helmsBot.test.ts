import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { CULVERT } from '../src/shared/helms.ts';
import { DEEPING } from '../src/shared/helmsMap.ts';
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
    // Every ladder and charge has been picked up and brought on towards the Deeping Wall.
    for (const t of [...gear(out.state, 'ladder'), ...gear(out.state, 'charge')]) expect(t.carrier || t.raised, t.id).toBeTruthy();
    const ladders = gear(out.state, 'ladder');
    expect(ladders.filter(t => t.x < 37).length).toBeGreaterThanOrEqual(ladders.length / 2);
    const charges = gear(out.state, 'charge');
    const before = gear(s, 'charge');
    const closer = charges.filter(t => Math.hypot(t.x - CULVERT.x, t.y - CULVERT.y) < Math.hypot(before.find(b => b.id === t.id)!.x - CULVERT.x, before.find(b => b.id === t.id)!.y - CULVERT.y) - 3);
    expect(closer.length).toBeGreaterThanOrEqual(3);
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

  it('as the Defenders, brings the whole Relief Force on in turn 10 and rides at the enemy', () => {
    // Ten turns on, the host of Isengard has gone in at the walls.
    const b = battle('p2');
    const s: GameState = { ...b, turn: 10, models: Object.fromEntries(Object.entries(b.models).map(([k, m]) => [k, m.owner === 'p1' && !m.siege && !m.crewOf ? { ...m, x: m.x - 10 } : m])) };
    const out = play(s, seeded(2), 3000, x => x.phase === 'shoot');
    const relief = Object.values(out.state.models).filter(m => m.owner === 'p2' && (m.cast === 'eomer' || m.cast === 'gandalf' || m.cast === 'captain-rohan' || m.cast === 'rider'));
    expect(relief).toHaveLength(27);
    expect(relief.filter(m => m.waiting)).toHaveLength(0);
    // Off the edge and away into the attackers' backs, not left standing where they came on.
    const fighting = (m: Model) => Object.values(out.state.models).some(e => e.owner === 'p1' && !e.dead && distanceBetween(m, e) <= 0.05);
    expect(relief.filter(m => m.y < 45 || fighting(m)).length).toBeGreaterThanOrEqual(20);
    // And the defenders on foot have kept to their walls.
    const wall = Object.values(out.state.models).filter(m => m.owner === 'p2' && !m.dead && ['aragorn', 'gimli', 'haldir', 'aldor', 'haleth'].includes(m.cast ?? ''));
    for (const m of wall) expect(m.x, m.name).toBeLessThan(DEEPING.corner.x + 3);
  }, 240_000);
});

