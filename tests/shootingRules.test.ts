import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { planShot } from '../src/shared/shooting.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, army: string, wargear: string[]) => ({ name, army, origin: army, type: 'Warrior', points: 5, stats: ['6"', '3', '4+', '3', '4', '1', '1', '6+', '7+'], options: [], rules: [], wargear });
const catalog = {
  source: '',
  armies: { Gondor: { side: 'Good', units: [], rules: [] }, Mordor: { side: 'Evil', units: [], rules: [] } },
  units: {
    archer: unit('Archer', 'Gondor', ['Bow']),
    man: unit('Warrior', 'Gondor', ['Shield']),
    orcArcher: unit('Orc Archer', 'Mordor', ['Orc bow']),
    orc: unit('Orc', 'Mordor', ['Shield']),
    crossbow: unit('Crossbowman', 'Gondor', ['Crossbow']),
    slinger: unit('Slinger', 'Mordor', ['Sling']),
    thrower: unit('Thrower', 'Mordor', ['Throwing spears']),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const wall = (id: string, x: number, y: number): Terrain => ({ id, kind: 'wall', shape: 'rect', x, y, w: 6, h: 0.5, rot: 0, locked: false });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, catalog);
  return out && run(s, ...out.apply);
};
/** A battle in its Move phase with heroics settled; `moves` are made (by the side with priority) before going on to Shoot. */
const battle = (models: Model[], terrain: Terrain[] = [], moves: [string, number, number][] = []) => {
  let s = run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: models.find(m => m.id === moves[0]?.[0])?.owner ?? 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  for (const [id, x, y] of moves) s = run(s, { type: 'moveModels', moves: [{ id, x, y }] });
  return s;
};
const toShoot = (s: GameState) => run(s, { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const shot = (shooter: string, target: string, extra: object = {}): Action => ({ type: 'shoot', shot: { shooter: { id: shooter, name: shooter, weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: target, name: target, d: 4 }, obstacles: 0, ...extra } }) as Action;

describe('shooting rules', () => {
  it('shoots 1 worse after moving, but a natural 6 still hits', () => {
    const s = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 10, 'orc')], [], [['a', 10, 29]]));
    expect(s.phase).toBe('shoot');
    expect(planShot(s, catalog, s.models.a, s.models.o)).toMatchObject({ moved: true, need: 5 });
    const out = ask(s, 'p1', shot('a', 'o'), [4])!;
    expect(out.log.find(r => r.group?.startsWith('s-'))).toMatchObject({ target: 5, note: 'a misses o' });
    const six = ask(s, 'p1', shot('a', 'o'), [6, 6])!;
    expect(six.models.o.dead).toBe(true);
  });

  it('refuses shots from a model in a fight, out of range or out of sight', () => {
    const s = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 29, 'orc'), mk('far', 'p2', 10, 2, 'orc')]));
    expect(planShot(s, catalog, s.models.a, s.models.far).why).toBe('is in a fight');
    expect(ask(s, 'p1', shot('a', 'far'), [6, 6])).toBeNull();
    const t = toShoot(battle([mk('a', 'p1', 10, 40, 'archer'), mk('far', 'p2', 10, 2, 'orc')]));
    expect(planShot(t, catalog, t.models.a, t.models.far).why).toMatch(/out of range/);
    expect(ask(t, 'p1', shot('a', 'far'), [6, 6])).toBeNull();
    const house: Terrain = { id: 'h', kind: 'building', shape: 'rect', x: 10, y: 20, w: 6, h: 6, rot: 0, locked: false };
    const u = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 10, 'orc')], [house]));
    expect(ask(u, 'p1', shot('a', 'o'), [6, 6])).toBeNull();
  });

  it('keeps Good models from shooting past friends or into fights; Evil models may, and can hit their own', () => {
    // Good: a friend in the way, then an enemy in a fight with a friend.
    const g = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('m', 'p1', 10, 20, 'man'), mk('o', 'p2', 10, 10, 'orc')]));
    expect(planShot(g, catalog, g.models.a, g.models.o).why).toMatch(/Good.*friend in the way/);
    const f = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('m', 'p1', 20, 11, 'man'), mk('o', 'p2', 20, 10, 'orc')]));
    expect(planShot(f, catalog, f.models.a, f.models.o).why).toMatch(/into a fight/);
    // Evil: the archer shoots into its friend's fight; a 1-3 on the special test hits the friend.
    const e = toShoot(battle([mk('oa', 'p2', 10, 30, 'orcArcher'), mk('ally', 'p2', 20, 21, 'orc'), mk('man', 'p1', 20, 20, 'man')]));
    const plan = planShot(e, catalog, e.models.oa, e.models.man);
    expect(plan.why).toBeUndefined();
    expect(plan.fight).toEqual(['ally']);
    const out = ask(e, 'p2', shot('oa', 'man'), [6, 2, 6])!;
    expect(out.log.some(r => r.label.startsWith('Into the fight'))).toBe(true);
    expect(out.models.ally.dead).toBe(true);
    expect(out.models.man.dead).toBe(false);
  });

  it('hits a model in the way that stops the shot', () => {
    const s = toShoot(battle([mk('oa', 'p2', 10, 30, 'orcArcher'), mk('ally', 'p2', 10, 22, 'orc'), mk('man', 'p1', 10, 14, 'man')]));
    const out = ask(s, 'p2', shot('oa', 'man'), [6, 2, 6])!;
    expect(out.models.ally.dead).toBe(true);
    expect(out.log.at(-1)?.note).toBe('oa hits ally instead');
  });

  it('ignores a wall the shooter touches, and a friend it shoots over', () => {
    const s = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 10, 'orc')], [wall('w', 10, 29.2)]));
    expect(planShot(s, catalog, s.models.a, s.models.o).inWay).toEqual([]);
    const far = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 10, 'orc')], [wall('w', 10, 20)]));
    expect(planShot(far, catalog, far.models.a, far.models.o).inWay.map(o => o.name)).toEqual(['wall']);
    const friend = toShoot(battle([mk('a', 'p1', 10, 30, 'archer'), mk('m', 'p1', 10, 29, 'man'), mk('o', 'p2', 10, 10, 'orc')]));
    expect(planShot(friend, catalog, friend.models.a, friend.models.o).why).toBeUndefined();
    expect(planShot(friend, catalog, friend.models.a, friend.models.o).inWay).toEqual([]);
  });

  it('handles crossbows, slings and throwing weapons after moving', () => {
    const c = toShoot(battle([mk('x', 'p1', 10, 30, 'crossbow'), mk('o', 'p2', 10, 10, 'orc')], [], [['x', 10, 29]]));
    expect(planShot(c, catalog, c.models.x, c.models.o).why).toMatch(/crossbow/);
    const still = toShoot(battle([mk('sl', 'p2', 10, 20, 'slinger'), mk('m', 'p1', 10, 10, 'man')]));
    expect(planShot(still, catalog, still.models.sl, still.models.m).shots).toBe(2);
    const moved = toShoot(battle([mk('sl', 'p2', 10, 20, 'slinger'), mk('m', 'p1', 10, 10, 'man')], [], [['sl', 10, 19]]));
    expect(planShot(moved, catalog, moved.models.sl, moved.models.m).shots).toBe(1);
    const ran = toShoot(battle([mk('t', 'p2', 10, 22, 'thrower'), mk('m', 'p1', 10, 10, 'man')], [], [['t', 10, 16.5]]));
    expect(ran.flow.farMoved).toContain('t');
    expect(planShot(ran, catalog, ran.models.t, ran.models.m).why).toBeUndefined();
    expect(planShot(ran, catalog, ran.models.t, ran.models.m).need).toBe(5);
  });

  it('re-rolls failed In the Way tests for a hero with Heroic Accuracy and friends near it', () => {
    let s = toShoot(battle([mk('h', 'p1', 14, 30, 'archer', { hero: true, might: 2 }), mk('a', 'p1', 10, 30, 'archer'), mk('o', 'p2', 10, 10, 'orc')], [wall('w', 10, 20)]));
    s = run(s, { type: 'declareHeroic', model: 'h', action: 'Heroic Accuracy' });
    const out = ask(s, 'p1', shot('a', 'o'), [5, 2, 5, 6])!;
    expect(out.log.some(r => /re-rolled \(Heroic Accuracy\)/.test(r.label))).toBe(true);
    expect(out.models.o.dead).toBe(true);
  });

  it('throws a weapon as a model charges, then makes it finish the charge', () => {
    const s = battle([mk('m', 'p1', 10, 10, 'man'), mk('t', 'p2', 10, 16, 'thrower')]);
    // p2 moves second: hand over the Move phase.
    const p2 = run(s, { type: 'endActivation', seat: 'p1' });
    const out = ask(p2, 'p2', shot('t', 'm', { charge: true }), [1])!;
    expect(out).not.toBeNull();
    expect(out.models.t.y).toBeLessThan(13);
    expect(out.flow.mustCharge).toEqual({ model: 't', target: 'm' });
    // Wandering off is refused; going on into contact is fine.
    const away = run(out, { type: 'moveModels', moves: [{ id: 't', x: 14, y: out.models.t.y }] });
    expect(away.models.t.x).toBe(10);
    const charged = run(out, { type: 'moveModels', moves: [{ id: 't', x: 10, y: 11 }] });
    expect(Math.abs(charged.models.t.y - 11)).toBeLessThan(0.05);
    // It has thrown this turn, so it can't shoot again in the Shoot phase.
    expect(out.flow.shot).toContain('t');
  });
});
