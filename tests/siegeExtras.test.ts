import { describe, expect, it } from 'vitest';
import { defence, touching } from '../src/shared/barriers.ts';
import { hurlBlocked, hurlOptions } from '../src/shared/defenders.ts';
import { towerMove, towerPushers } from '../src/shared/fortress.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { supporters } from '../src/shared/support.ts';
import { courageBonus } from '../src/shared/wargear.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const R = 25 / 25.4 / 2;
const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Terrain => ({ id, kind, shape: kind === 'objective' ? 'circle' : 'rect', x, y, w, h, rot: 0, locked: false, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
/** A started game in the given phase, the attackers (p2) going first, with heroics passed. */
const begin = (models: Model[], terrain: Terrain[], phase: 'move' | 'shoot' | 'fight' = 'move') => {
  let s = run(initialState(), ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
  if (phase !== 'move') s = run(s, { type: 'setPhase', phase }, ...(phase === 'fight' ? ([{ type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }] as Action[]) : []));
  return s;
};
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, Date.now(), null);
  return out && { s: run(s, ...out.apply), out };
};
const fighter = (id: string) => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });
/** Rolls a duel and its strikes with fixed dice, applying the results as the server would. */
function fight(s: GameState, p1: string[], p2: string[], d: number[]) {
  const seq = [...d];
  const d6 = () => seq.shift() ?? 1;
  const req = { sides: [p1.map(fighter), p2.map(fighter)] as [ReturnType<typeof fighter>[], ReturnType<typeof fighter>[]], targets: [p2[0], p1[0]] as [string, string], trapped: false };
  const seat = s.priority ?? 'p1';
  const duel = resolveRequest(s, seat, { type: 'fight', fight: req }, d6, uid)!;
  s = run(s, ...duel.apply);
  const group = (duel.apply[0] as { roll: { group: string } }).roll.group;
  const out = resolveRequest(s, seat, { type: 'strikes', fight: req, group }, d6, uid)!;
  return { s: run(s, ...out.apply), out };
}
const labels = (out: { apply: Action[] }) => out.apply.flatMap(a => (a.type === 'rolled' ? [a.roll.label] : []));

// A sheer fortress wall 3" high and 0.5" thick along y = 20, the defenders (p1) to the north.
const WALL = piece('w', 'wall', 24, 20, 30, 0.5, { height: 3, sheer: true });
const north = 19.75 - R - 0.02;
const south = 20.25 + R + 0.02;
// A Siege Ladder raised against its south face, beside the attacker at x = 10.
const LADDER = piece('lad', 'objective', 10.9, 20.75, 1, 1, { object: 'ladder', side: 'p2', raised: 'w' });

describe('siege towers', () => {
  // A 4" tower 9" short of the wall, its crew of six lined up behind it.
  const tower = piece('tw', 'tower', 24, 9, 4, 4, { side: 'p2' });
  // Three at its back and three along its sides.
  const SPOTS = [[22.6, 7 - R - 0.1], [24, 7 - R - 0.1], [25.4, 7 - R - 0.1], [22 - R - 0.1, 8], [22 - R - 0.1, 9.5], [26 + R + 0.1, 8]];
  const crew = (k: number) => SPOTS.slice(0, k).map(([x, y], i) => mk(`c${i}`, 'p2', x, y));

  it('needs six to push it, and one more for each model riding in it', () => {
    const s = begin([...crew(6), mk('rider', 'p2', 24, 9), mk('d', 'p1', 24, south)], [WALL, tower]);
    expect(towerPushers(s, s.terrain.tw, 'p2', () => false)).toMatchObject({ need: 7, have: 6 });
    expect(towerMove(s, s.terrain.tw, 'p2', { x: 24, y: 19 }, () => false)).toBeNull();
    const pushed = run(s, { type: 'pushTower', id: 'tw', seat: 'p2', x: 24, y: 19 });
    expect(pushed.terrain.tw.y).toBe(9);
  });

  it('moves 6" with its riders and crew, stopping at the wall and dropping its ramp there', () => {
    let s = begin([...crew(6), mk('d', 'p1', 24, south)], [WALL, tower]);
    s = run(s, { type: 'pushTower', id: 'tw', seat: 'p2', x: 24, y: 30 });
    expect(s.terrain.tw.y).toBeCloseTo(15, 1);
    expect(s.models.c0.y).toBeCloseTo(13 - R - 0.1, 1);
    // The crew have done their moving, and the tower its push, for this turn.
    expect(s.flow.stopped).toContain('c0');
    expect(run(s, { type: 'pushTower', id: 'tw', seat: 'p2', x: 24, y: 30 }).terrain.tw.y).toBeCloseTo(15, 1);
    // Next turn it reaches the wall and stops there with its ramp down.
    const next = { ...s, flow: { ...s.flow, stopped: [], breached: [] } };
    const at = run(next, { type: 'pushTower', id: 'tw', seat: 'p2', x: 24, y: 30 });
    expect(at.terrain.tw.y).toBeLessThanOrEqual(19.75 - 2 + 0.01);
    expect(at.terrain.tw.y).toBeGreaterThan(17.4);
    expect(at.terrain.tw.raised).toBe('w');
  });

  it('can be smashed: everyone aboard falls', () => {
    const s = begin([mk('rider', 'p2', 24, 9), mk('t', 'p1', 24, 11 + R + 0.05)], [tower], 'fight');
    const broken = run(s, { type: 'updateTerrain', id: 'tw', patch: { wounds: 1 } });
    const hit = ask({ ...broken, priority: 'p1' }, 'p1', { type: 'breach', how: 'strike', model: 't', target: 'tw' }, [6, 6, 6, 6, 6, 6]);
    expect(hit?.s.terrain.tw.gone).toBe('destroyed');
    expect(labels(hit!.out).some(l => /Falling|fall/i.test(l))).toBe(true);
  });

  it('a model in the way stops it short', () => {
    const s = begin([...crew(6), mk('x', 'p1', 24, 13)], [tower]);
    const mv = towerMove(s, s.terrain.tw, 'p2', { x: 24, y: 30 }, () => false);
    expect(mv!.at.y).toBeLessThan(13 - R - 2 + 0.06);
    expect(mv!.at.y).toBeGreaterThan(13 - R - 2 - 0.1);
  });
});

describe('fighting at the top of a ladder', () => {
  it('can’t fight over a sheer wall without a ladder', () => {
    const s = begin([mk('d', 'p1', 10, north), mk('o', 'p2', 10, south)], [WALL], 'fight');
    expect(touching(s, s.models.d, s.models.o)).toBe(false);
    const up = begin([mk('d', 'p1', 10, north), mk('o', 'p2', 10, south)], [WALL, LADDER], 'fight');
    expect(touching(up, up.models.d, up.models.o)).toBe(true);
    // (Too tall to count as defending a barrier: the climber just fights from the ladder.)
    expect(defence(up, [['d'], ['o']])).toBeNull();
  });

  it('a climber that loses doesn’t back away: it falls off on a 1-3', () => {
    const s = begin([mk('d', 'p1', 10, north), mk('o', 'p2', 10, south)], [WALL, LADDER], 'fight');
    // The defender wins the duel (6 against 1), its strike misses, and the climber rolls a 2 to hold on.
    const lost = fight(s, ['d'], ['o'], [6, 1, 1, 2]);
    expect(labels(lost.out)).toContain('o keeps its footing on the ladder (4+)');
    expect(lost.s.models.o.prone).toBe(true);
    expect(lost.s.models.o.y).toBeCloseTo(south, 3);
    // On a 5 it holds on, and stays where it is.
    const held = fight(s, ['d'], ['o'], [6, 1, 1, 5]);
    expect(held.s.models.o.prone).toBeFalsy();
    expect(held.s.models.o.y).toBeCloseTo(south, 3);
  });

  it('gets no spear support from below', () => {
    const s = begin([mk('d', 'p1', 10, north), mk('o', 'p2', 10, south), mk('sp', 'p2', 10, south + 2 * R + 0.01)], [WALL, LADDER], 'fight');
    const c = { p1: ['d'], p2: ['o'] } as unknown as Parameters<typeof supporters>[2];
    expect(supporters(s, null, c).p2).toEqual([]);
  });
});

describe('barricades', () => {
  const spiked = piece('b', 'wall', 10, 20, 6, 0.5, { height: 1, barricade: 'spiked' });

  it('can be struck down: Defence 7 and 2 Wounds', () => {
    const s = begin([mk('o', 'p2', 10, south), mk('d', 'p1', 30, 30)], [spiked], 'fight');
    // S3 against D7: a 6 then a 4+ (to wound twice); a destroyed barricade is open ground.
    const hit = ask(s, 'p2', { type: 'breach', how: 'strike', model: 'o', target: 'b' }, [6, 6]);
    expect(hit?.s.terrain.b).toMatchObject({ wounds: 1 });
    const gone = ask(hit!.s, 'p2', { type: 'breach', how: 'strike', model: 'o', target: 'b' }, [6, 6]);
    expect(gone).toBeNull();
  });

  it('hurts an attacker whose strikes fail to get over its spikes', () => {
    const s0 = begin([mk('d', 'p1', 10, south), mk('o', 'p2', 10, 16)], [spiked]);
    const s = run(s0, { type: 'moveModels', moves: [{ id: 'o', x: 10, y: 22 }] }, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
    expect(defence(s, [['d'], ['o']])).toMatchObject({ defender: 'd', attacker: 'o' });
    // The orc wins the duel, but its strike doesn't get past (a 2), and the spikes wound it (a 6).
    const { out, s: after } = fight(s, ['d'], ['o'], [1, 6, 2, 6]);
    expect(labels(out)).toContain('Spikes: S3 hit on o');
    expect(after.models.o.dead).toBe(true);
  });
});

describe('rocks, boiling oil and rallying points', () => {
  const ROCKS = piece('rk', 'objective', 12, north, 1, 1, { object: 'rocks', side: 'p1' });
  const OIL = piece('oil', 'objective', 12, north, 1.6, 1.6, { object: 'oil', side: 'p1' });

  it('drops rocks from the walls on an attacker below: 4+ to hit, then Strength 6', () => {
    const s = begin([mk('d', 'p1', 12 - 0.5 - R, north), mk('o', 'p2', 14, south)], [WALL, ROCKS], 'shoot');
    const p1 = { ...s, priority: 'p1' as Seat, flow: { ...s.flow, active: 'p1' as Seat } };
    expect(hurlOptions(p1, p1.models.d)).toEqual([expect.objectContaining({ how: 'rocks', target: 'o' })]);
    const hit = ask(p1, 'p1', { type: 'hurl', how: 'rocks', model: 'd', item: 'rk', target: 'o' }, [4, 3]);
    expect(hit?.s.models.o.dead).toBe(true);
    expect(hit?.s.flow.shot).toContain('d');
    // Not at someone out in the open.
    const far: GameState = { ...p1, models: { ...p1.models, o: { ...p1.models.o, y: 25 } } };
    expect(hurlBlocked(far, 'rocks', far.models.d, far.terrain.rk, far.models.o)).toMatch(/by the walls/);
  });

  it('knocks a climber off its ladder on a 1-3', () => {
    // (The thrower stands clear of the ladder, so it isn't fighting the climber.)
    const s = begin([mk('d', 'p1', 16 - 0.5 - R, north), mk('o', 'p2', 10, south, { wounds: 3, maxWounds: 3 })], [WALL, { ...ROCKS, x: 16 }, LADDER], 'shoot');
    const p1 = { ...s, priority: 'p1' as Seat, flow: { ...s.flow, active: 'p1' as Seat } };
    const hit = ask(p1, 'p1', { type: 'hurl', how: 'rocks', model: 'd', item: 'rk', target: 'o' }, [5, 1, 2]);
    expect(labels(hit!.out)).toContain('o clings to the ladder (4+)');
    expect(hit?.s.models.o.prone).toBe(true);
  });

  it('needs two to pour the oil, which splashes those nearby and can run dry', () => {
    const models = [mk('d', 'p1', 12 - 0.8 - R, north), mk('o', 'p2', 14, south), mk('o2', 'p2', 15.5, south)];
    const s = begin(models, [WALL, OIL], 'shoot');
    const p1 = { ...s, priority: 'p1' as Seat, flow: { ...s.flow, active: 'p1' as Seat } };
    expect(hurlBlocked(p1, 'oil', p1.models.d, p1.terrain.oil, p1.models.o)).toMatch(/second model/);
    const two = run(p1, { type: 'addModels', models: [mk('h', 'p1', 12 + 0.8 + R, north)] });
    // Hits (4), S8 wounds o (3+), the splash wounds o2 (S4 vs D4: 4+) and misses the helper (friend or foe), and a
    // 1 empties the vat.
    const out = ask(two, 'p1', { type: 'hurl', how: 'oil', model: 'd', item: 'oil', target: 'o' }, [4, 3, 4, 1, 1]);
    expect(labels(out!.out)).toContain('Splashed: S4 on h (4+)');
    expect(out?.s.models.o.dead).toBe(true);
    expect(out?.s.models.o2.dead).toBe(true);
    expect(out?.s.terrain.oil.gone).toBe('destroyed');
  });

  it('gives +1 Courage within 6" of a rallying point', () => {
    const rally = piece('ral', 'objective', 30, 30, 1, 1, { object: 'rally', side: 'p1' });
    const s = begin([mk('d', 'p1', 30, 34), mk('far', 'p1', 30, 40), mk('o', 'p2', 30, 34.5 + 6)], [rally]);
    expect(courageBonus(s, null, s.models.d)).toBe(courageBonus(s, null, s.models.far) + 1);
    expect(courageBonus(s, null, s.models.o)).toBe(0);
  });
});
