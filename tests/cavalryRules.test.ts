import { describe, expect, it } from 'vitest';
import { modelStats, type Catalog } from '../src/shared/catalog.ts';
import { riderTests } from '../src/shared/cavalry.ts';
import type { Fighter, FightRequest } from '../src/shared/fight.ts';
import { costOf, moveAllowance, moveLeft } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { armyStatus } from '../src/shared/status.ts';
import { fighterOf } from '../src/shared/wargear.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, army: string, wargear: string[], rules: string[] = [], stats = ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+'], options: unknown[] = []) => ({ name, army, origin: army, type: 'Warrior', points: 5, stats, options, rules, wargear });
const catalog = {
  source: '',
  armies: { Rohan: { side: 'Good', units: [], rules: [] }, Mordor: { side: 'Evil', units: [], rules: [] } },
  units: {
    '[rohan] rider': unit('Rider of Rohan', 'Rohan', ['Armour', 'hand weapon', 'Horse']),
    '[rohan] knight': unit('Knight', 'Rohan', ['Armour', 'hand weapon', 'lance', 'Horse']),
    '[rohan] archer': unit('Bowman', 'Rohan', ['Bow', 'hand weapon']),
    '[rohan] sharp': unit('Marksman', 'Rohan', ['Bow', 'hand weapon'], ['Sharpshooter']),
    '[rohan] eagle': unit('Great Eagle', 'Rohan', ['Claws'], ['Dominant (3)', 'Fly', 'Monstrous Charge'], ['12"', '7', '4+', '6', '8', '2', '3', '4+', '4+']),
    '[mordor] warg': unit('Warg Rider', 'Mordor', ['Armour', 'hand weapon', 'Warg'], [], ['6"', '3', '5+', '3', '4', '1', '1', '8', '8+']),
    '[mordor] orc': unit('Orc', 'Mordor', ['hand weapon']),
    '[mordor] spear': unit('Orc Spearman', 'Mordor', ['spear']),
    '[mordor] troll': unit('Troll', 'Mordor', ['hand weapon'], ['Dominant (3)', 'Terror'], ['6"', '7', '5+', '7', '7', '3', '3', '6', '4+']),
  },
} as unknown as Catalog;

const horse = { base: { shape: 'round' as const, w: 40, h: 40 }, move: 10, mount: 'Horse', mountWounds: 1 };
const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const begin = (models: Model[], terrain: Terrain[] = []) =>
  run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const toFight = (s: GameState) => run(s, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, Date.now(), catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};
const fx = (id: string): Fighter => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });
const fight = (a: string[], b: string[], extra: Partial<FightRequest> = {}) => ({ sides: [a.map(fx), b.map(fx)], targets: [b[0], a[0]], trapped: false, ...extra }) as FightRequest;
const group = (s: GameState) => s.log.at(-1)!.group!;
const wood: Terrain = { id: 'w', kind: 'wood', shape: 'rect', x: 10, y: 10, w: 6, h: 6, rot: 0, locked: true };

/** A rider that charged an enemy this turn, now in the Fight phase. */
function charged(rider: Model, foes: Model[], terrain: Terrain[] = []) {
  let s = begin([rider, ...foes], terrain);
  s = run(s, { type: 'moveModels', moves: [{ id: rider.id, x: foes[0].x, y: foes[0].y + 1.3 }] });
  expect(s.flow.charges?.[rider.id]).toBe(foes[0].id);
  return toFight(s);
}

describe('rider and mount', () => {
  it("fights with its mount's Fight, Strength and Attacks where they're better", () => {
    const s = begin([mk('w', 'p2', 10, 10, '[mordor] warg', { ...horse, mount: 'Warg' })]);
    expect(fighterOf(s, catalog, s.models.w)).toMatchObject({ f: 3, s: 4, a: 1, mount: { name: 'Warg', d: 4, s: 4 } });
  });

  it('counts difficult ground four times over for cavalry', () => {
    const s = begin([mk('r', 'p1', 10, 20, '[rohan] rider', horse), mk('o', 'p2', 30, 30, '[mordor] orc')], [wood]);
    expect(costOf(s, s.models.r, { x: 10, y: 10 }, { x: 10, y: 11 })).toBeCloseTo(4);
    expect(costOf(s, s.models.o, { x: 10, y: 10 }, { x: 10, y: 11 })).toBeCloseTo(2);
  });

  it("can't lie down or climb", () => {
    const s = begin([mk('r', 'p1', 20, 20, '[rohan] rider', horse)]);
    expect(run(s, { type: 'lieDown', id: 'r' }).models.r.prone).toBeUndefined();
  });

  it('dismounts part way through its move and walks on with what is left of its foot Move', () => {
    let s = begin([mk('r', 'p1', 20, 30, '[rohan] rider', horse), mk('o', 'p2', 40, 5, '[mordor] orc')]);
    s = run(s, { type: 'moveModels', moves: [{ id: 'r', x: 20, y: 27 }] });
    s = ask(s, 'p1', { type: 'dismount', id: 'r' }, [])!;
    expect(s.models.r).toMatchObject({ dismounted: true, move: 6, base: { w: 25 } });
    expect(moveLeft(s, s.models.r)).toBeCloseTo(3);
    // A horse doesn't fight, so it bolts rather than stay.
    expect(Object.keys(s.models)).toHaveLength(2);
  });
});

describe('shooting at cavalry', () => {
  const shootPhase = (models: Model[]) => run(begin(models), { type: 'endActivation', seat: 'p1' }, { type: 'endActivation', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  const shot = (shooter: string, target: string, extra = {}) => ({ type: 'shoot', shot: { shooter: { id: shooter, name: shooter, weapon: 'Bow', shoot: 4, s: 2, shots: 1 }, target: { id: target, name: target, d: 5 }, obstacles: 0, ...extra } }) as Action;

  it('hits the mount on a 1-3, and a rider whose mount falls is thrown', () => {
    let s = shootPhase([mk('a', 'p1', 10, 30, '[rohan] archer'), mk('w', 'p2', 10, 20, '[mordor] warg', { ...horse, mount: 'Warg' })]);
    s = ask(s, 'p1', shot('a', 'w'), [6, 2, 6])!;
    const part = s.log.find(r => r.label.startsWith('Rider or mount'));
    expect(part?.dice).toEqual([2]);
    expect(s.models.w).toMatchObject({ mountWounds: 0, throwPending: 'test', wounds: 1 });
    // The game rolls the Thrown Rider test: a 1 knocks it flying, Prone and hit at Strength 3.
    const seq = [1, 6];
    s = run(s, ...riderTests(s, catalog, () => seq.shift() ?? 1, uid));
    expect(s.models.w).toMatchObject({ dismounted: true, prone: true, stunned: s.turn });
    expect(s.models.w.throwPending).toBeUndefined();
  });

  it("lets a Sharpshooter aim at the mount, with no roll for which part it hits", () => {
    let s = shootPhase([mk('a', 'p1', 10, 30, '[rohan] sharp'), mk('w', 'p2', 10, 20, '[mordor] warg', { ...horse, mount: 'Warg' })]);
    s = ask(s, 'p1', shot('a', 'w', { atMount: true }), [6, 6])!;
    expect(s.log.some(r => r.label.startsWith('Rider or mount'))).toBe(false);
    expect(s.models.w.mountWounds).toBe(0);
  });
});

describe('separated mounts', () => {
  it('keeps a fighting mount on the table when its rider falls and it holds its nerve, without counting it', () => {
    let s = begin([mk('w', 'p2', 10, 20, '[mordor] warg', { ...horse, mount: 'Warg' }), mk('o', 'p1', 30, 30, '[mordor] orc')]);
    s = run(s, { type: 'wound', id: 'w', count: 1 });
    expect(s.models.w.dead).toBe(true);
    s = run(s, ...riderTests(s, catalog, () => 6, uid));
    const steed = s.models['w-steed'];
    expect(steed).toMatchObject({ steed: 'Warg', owner: 'p2', wounds: 1 });
    expect(modelStats(catalog, steed)).toMatchObject({ S: 4, A: 1, D: 4 });
    expect(armyStatus(s, 'p2')).toMatchObject({ start: 1, lost: 1 });
    // Only once.
    expect(riderTests(s, catalog, () => 6, uid)).toEqual([]);
  });
});

describe('the cavalry charge', () => {
  it('gives +1 Attack, knocks the infantry it beats Prone and strikes them as trapped', () => {
    let s = charged(mk('r', 'p1', 20, 30, '[rohan] rider', horse), [mk('o', 'p2', 20, 20, '[mordor] orc')]);
    s = ask(s, 'p1', { type: 'fight', fight: fight(['r'], ['o']) }, [6, 1, 2])!;
    expect(s.log.find(r => r.model === 'r' && r.side === 0)?.dice).toHaveLength(2);
    s = ask(s, 'p1', { type: 'strikes', fight: fight(['r'], ['o']), group: group(s) }, [1, 1, 1, 1])!;
    expect(s.log.find(r => r.against === 'o')?.dice).toHaveLength(4);
    expect(s.models.o.prone).toBe(true);
  });

  it('adds +1 to wound for a lance on the charge', () => {
    let s = charged(mk('k', 'p1', 20, 30, '[rohan] knight', horse), [mk('o', 'p2', 20, 20, '[mordor] orc')]);
    s = ask(s, 'p1', { type: 'fight', fight: fight(['k'], ['o']) }, [6, 1, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: fight(['k'], ['o']), group: group(s) }, [1, 1, 1, 1])!;
    expect(s.log.find(r => r.against === 'o')?.label).toContain('+1 to wound');
  });

  it('gets nothing for a charge that ends in difficult ground', () => {
    let s = charged(mk('r', 'p1', 10, 13, '[rohan] rider', horse), [mk('o', 'p2', 10, 10, '[mordor] orc')], [wood]);
    s = ask(s, 'p1', { type: 'fight', fight: fight(['r'], ['o']) }, [6, 2])!;
    expect(s.log.find(r => r.model === 'r' && r.side === 0)?.dice).toHaveLength(1);
  });

  it('lets the winner strike the mount instead of the rider', () => {
    let s = toFight(begin([mk('o', 'p1', 20, 20, '[mordor] troll', { wounds: 3, maxWounds: 3 }), mk('w', 'p2', 20, 21.3, '[mordor] warg', { ...horse, mount: 'Warg' })]));
    const req = fight(['o'], ['w'], { targets: ['w#mount', 'o'] });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [6, 6, 6])!;
    expect(s.models.w).toMatchObject({ mountWounds: 0, throwPending: 'test', dead: false });
  });
});

describe('monsters', () => {
  it('knocks weaker foes down with a Monstrous Charge', () => {
    let s = charged(mk('e', 'p1', 20, 30, '[rohan] eagle', { base: { shape: 'round', w: 40, h: 40 }, move: 12, wounds: 3, maxWounds: 3 }), [mk('o', 'p2', 20, 20, '[mordor] orc', { wounds: 3, maxWounds: 3 })]);
    s = ask(s, 'p1', { type: 'fight', fight: fight(['e'], ['o']) }, [6, 1, 1, 2])!;
    expect(s.log.filter(r => r.model === 'e' && r.side === 0)[0].dice).toHaveLength(3);
    s = ask(s, 'p1', { type: 'strikes', fight: fight(['e'], ['o']), group: group(s) }, Array(12).fill(1))!;
    expect(s.models.o.prone).toBe(true);
  });

  it('gets a free strike on a model supporting the one it slays', () => {
    let s = toFight(begin([mk('t', 'p1', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 }), mk('o', 'p2', 20, 21.3, '[mordor] orc'), mk('sp', 'p2', 20, 22.3, '[mordor] spear')]));
    const req = { ...fight(['t'], ['o']), sides: [[fx('t')], [fx('o'), { ...fx('sp'), support: true }]] } as FightRequest;
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [6, 6, 6, 6, 6])!;
    expect(s.log.some(r => r.against === 'sp' && r.label.includes('a free strike'))).toBe(true);
    expect(s.models.sp.dead).toBe(true);
  });

  it('can Rend instead of striking: To Wound against Strength', () => {
    let s = toFight(begin([mk('t', 'p1', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 }), mk('o', 'p2', 20, 21.3, '[mordor] orc', { wounds: 3, maxWounds: 3 })]));
    const req = fight(['t'], ['o'], { brutal: { by: 't', kind: 'rend', target: 'o' } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [2, 2, 2])!;
    const rend = s.log.find(r => r.label.startsWith('Rend'));
    expect(rend?.dice).toHaveLength(3);
    expect(rend?.label).toContain('vs its S3');
    expect(s.flow.brutal).toContain('t');
  });

  it('can Barge: every foe goes back 3", and the monster may move again', () => {
    let s = toFight(begin([mk('t', 'p1', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 }), mk('o', 'p2', 20, 21.3, '[mordor] orc')]));
    const req = fight(['t'], ['o'], { brutal: { by: 't', kind: 'barge' } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [4])!;
    expect(s.models.o.y).toBeCloseTo(24.3, 1);
    expect(s.log.some(r => r.against)).toBe(false);
    expect(moveAllowance(s, s.models.t)).toBe(5);
  });

  it('makes no Brutal Power Attack while Prone, and stands up instead', () => {
    let s = toFight(begin([mk('t', 'p1', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3, prone: true }), mk('o', 'p2', 20, 21.3, '[mordor] orc')]));
    const req = fight(['t'], ['o'], { brutal: { by: 't', kind: 'barge' } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [4, 1, 1])!;
    expect(s.models.o.y).not.toBeCloseTo(24.3, 1);
    expect(s.flow.brutal ?? []).not.toContain('t');
    expect(s.models.t.prone).toBeFalsy();
  });

  it('can Hurl a weaker foe at another enemy', () => {
    let s = toFight(begin([mk('t', 'p1', 20, 20, '[mordor] troll', { base: { shape: 'round', w: 40, h: 40 }, wounds: 3, maxWounds: 3 }), mk('o', 'p2', 20, 21.3, '[mordor] orc', { wounds: 3, maxWounds: 3 }), mk('x', 'p2', 24, 20, '[mordor] orc', { wounds: 3, maxWounds: 3 })]));
    const req = fight(['t'], ['o'], { brutal: { by: 't', kind: 'hurl', target: 'o' } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 2])!;
    // D3 of 1 plus 4 for the difference in Strength; Intelligence 6+6; then the hits, all failing to wound.
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [1, 6, 6, 1, 1, 1])!;
    expect(s.log.find(r => r.label.startsWith('Hurl'))?.label).toContain('5"');
    expect(s.models.x.prone).toBe(true);
    expect(s.models.o.prone).toBe(true);
    expect(Math.hypot(s.models.o.x - 24, s.models.o.y - 20)).toBeLessThan(1.1);
    expect(s.flow.hurledAt).toContain('x');
  });
});
