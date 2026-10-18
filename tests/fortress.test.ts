import { describe, expect, it } from 'vitest';
import { phaseFinished } from '../src/shared/autoPhase.ts';
import { breachBlocked, breachOptions } from '../src/shared/breach.ts';
import type { Catalog } from '../src/shared/catalog.ts';
import { limitMove, moveAllowance } from '../src/shared/movement.ts';
import { markerActions } from '../src/shared/objects.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { sightTo } from '../src/shared/sight.ts';
import { crossBlocked, crossingAhead } from '../src/shared/terrainTests.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, stats: string[], wargear = ['hand weapon'], type = 'Warrior') => ({ name, army: 'Isengard', origin: 'Isengard', type, points: 5, stats, options: [], rules: [], wargear });
const catalog = {
  source: '',
  armies: { Isengard: { side: 'Evil', units: [], rules: [] }, Rohan: { side: 'Good', units: [], rules: [] } },
  units: {
    '[isengard] uruk': unit('Uruk-hai Warrior', ['6"', '4', '4+', '4', '5', '1', '1', '7', '7+']),
    '[isengard] troll': unit('Cave Troll', ['6"', '6', '5+', '6', '6', '3', '3', '4', '7+']),
    '[isengard] crossbow': unit('Uruk-hai Crossbowman', ['6"', '4', '4+', '4', '5', '1', '1', '7', '7+'], ['Crossbow', 'hand weapon']),
    '[isengard] spear': unit('Uruk-hai Spearman', ['6"', '4', '4+', '4', '5', '1', '1', '7', '7+'], ['spear', 'hand weapon']),
    '[rohan] warrior': unit('Warrior of Rohan', ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+']),
  },
} as unknown as Catalog;

let n = 0;
const mk = (id: string, owner: Seat, x: number, y: number, profileId = '[isengard] uruk', extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const piece = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number, extra: Partial<Terrain> = {}): Action => ({ type: 'addTerrain', terrain: { id, kind, shape: kind === 'objective' ? 'circle' : 'rect', x, y, w, h, rot: 0, locked: false, ...extra } });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
/** A started game in the given phase, Evil (p2, the attackers) moving first, with heroics passed. */
const begin = (models: Model[], terrain: Action[], phase: 'move' | 'shoot' | 'fight' = 'move') => {
  let s = run(initialState(), ...terrain, { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
  if (phase !== 'move') s = run(s, { type: 'setPhase', phase }, ...(phase === 'fight' ? ([{ type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' }] as Action[]) : []));
  return s;
};
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, Date.now(), catalog);
  return out && run(s, ...out.apply);
};
const breach = (s: GameState, how: 'strike' | 'ram' | 'shoot' | 'push', model: string, target: string, dice: number[], seat: Seat = 'p2') => ask(s, seat, { type: 'breach', how, model, target }, dice);

// A Fortress gate 4" wide across the middle of the table, held by Rohan (p1), with a sheer wall either side.
const GATE = piece('gate', 'gate', 24, 24, 4, 1, { door: 'castle', side: 'p1' });
const WALLS = [piece('wl', 'wall', 15, 24, 14, 1, { height: 3, sheer: true }), piece('wr', 'wall', 33, 24, 14, 1, { height: 3, sheer: true })];
// Just touching the gate from the attackers’ side (below it).
const BELOW = 24 + 0.5 + 0.49;

describe('gates and doors', () => {
  it('keeps the enemy out but lets its own side through', () => {
    const s = begin([mk('u', 'p2', 24, 27), mk('r', 'p1', 21, 21, '[rohan] warrior')], [GATE]);
    const away = { ...s, models: { ...s.models, u: { ...s.models.u, x: 40 } } };
    const stop = limitMove(s, s.models.u, { x: 24, y: 21.5 }, 6, 'p2', s.models.u);
    expect(stop.y).toBeGreaterThan(24.9);
    expect(stop.y).toBeLessThan(25.1);
    const r = { ...away, priority: 'p1' as Seat };
    const through = limitMove(r, s.models.r, { x: 23, y: 26 }, 6, 'p1', s.models.r);
    expect(through).toEqual({ x: 23, y: 26 });
  });

  it('hides what is behind it, until it is broken down', () => {
    const s = begin([mk('u', 'p2', 24, 28), mk('r', 'p1', 24, 20, '[rohan] warrior')], [GATE]);
    expect(sightTo(s, s.models.u, s.models.r)).toBe('hidden');
    const broken = run(s, { type: 'updateTerrain', id: 'gate', patch: { gone: 'destroyed', wounds: 0 } });
    expect(sightTo(broken, broken.models.u, broken.models.r)).toBe('clear');
    expect(limitMove(broken, broken.models.u, { x: 24, y: 22 }, 6, 'p2', broken.models.u)).toEqual({ x: 24, y: 22 });
  });

  it('is struck at in the Fight phase with no Duel roll, rolling To Wound twice a strike', () => {
    // A Cave Troll (S6, A3) against an Outer door (D6, 2 Wounds): six dice, 4+ to wound.
    const door = piece('gate', 'gate', 24, 24, 4, 1, { door: 'external', side: 'p1' });
    let s = begin([mk('t', 'p2', 24, 24.5 + 0.98, '[isengard] troll', { base: { shape: 'round', w: 50, h: 50 } }), mk('r', 'p1', 10, 10, '[rohan] warrior')], [door], 'fight');
    expect(breachOptions(s, catalog, s.models.t).map(o => o.how)).toEqual(['strike']);
    s = breach(s, 'strike', 't', 'gate', [1, 2, 4, 1, 1, 1])!;
    expect(s.log.at(-1)).toMatchObject({ dice: [1, 2, 4, 1, 1, 1], target: 4, note: '1 Wound: 1 left.' });
    expect(s.terrain.gate).toMatchObject({ wounds: 1 });
    expect(s.terrain.gate.gone).toBeUndefined();
    // Once a turn.
    expect(breachBlocked(s, catalog, 'strike', s.models.t, s.terrain.gate)).toBe('Already done this turn');
    s = run(s, { type: 'setPhase', phase: 'move', turn: 2 }, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
    s = breach(s, 'strike', 't', 'gate', [5])!;
    expect(s.terrain.gate).toMatchObject({ gone: 'destroyed', wounds: 0, by: 'p2' });
  });

  it('lets spears support a model striking at a gate', () => {
    const door = piece('gate', 'gate', 24, 24, 4, 1, { door: 'internal', side: 'p1' });
    let s = begin([mk('u', 'p2', 24, BELOW), mk('sp', 'p2', 24, BELOW + 0.98, '[isengard] spear'), mk('r', 'p1', 10, 10, '[rohan] warrior')], [door], 'fight');
    // S4 vs D5: 5+. The Uruk misses twice; the spear behind it breaks the door.
    s = breach(s, 'strike', 'u', 'gate', [1, 1, 5, 1])!;
    expect(s.terrain.gate.gone).toBe('destroyed');
    expect(s.log.at(-1)).toMatchObject({ model: 'sp', support: true });
  });

  it("can't be struck by a model in a fight", () => {
    const s = begin([mk('u', 'p2', 24, BELOW), mk('r', 'p1', 24 + 0.98, BELOW, '[rohan] warrior')], [GATE], 'fight');
    expect(breachBlocked(s, catalog, 'strike', s.models.u, s.terrain.gate)).toBe('Has been in a fight this turn');
  });

  it('holds the Fight phase open while someone could still strike at a gate', () => {
    const s = begin([mk('u', 'p2', 24, BELOW), mk('r', 'p1', 10, 10, '[rohan] warrior')], [GATE], 'fight');
    expect(phaseFinished(s)).toBe(false);
    const after = breach(s, 'strike', 'u', 'gate', [1, 1])!;
    expect(phaseFinished(after)).toBe(true);
  });

  it('only takes damage from shots of Strength 5 or more', () => {
    const s = begin([mk('x', 'p2', 24, 30, '[isengard] crossbow'), mk('r', 'p1', 10, 10, '[rohan] warrior')], [GATE], 'shoot');
    expect(breachBlocked(s, catalog, 'shoot', s.models.x, s.terrain.gate)).toBe('Only Strength 5 or more can hurt a gate');
  });
});

describe('battering rams', () => {
  it('strikes with its strongest carrier’s Strength +1 for each other, rolling twice To Wound', () => {
    // Three Uruk-hai (S4) on a ram against the gate: S6 vs D10 needs a 6.
    const ram = piece('ram', 'objective', 24, 25, 1, 1, { object: 'ram', side: 'p2' });
    let s = begin([mk('a', 'p2', 23.01, 25), mk('b', 'p2', 24.99, 25), mk('c', 'p2', 24, 25.99), mk('r', 'p1', 10, 10, '[rohan] warrior')], [GATE, ram], 'fight');
    expect(breachOptions(s, catalog, s.models.a).map(o => o.how)).toContain('ram');
    s = breach(s, 'ram', 'a', 'ram', [6, 3])!;
    expect(s.log.at(-1)).toMatchObject({ label: expect.stringMatching(/S6 vs D10 \(6\+\)/), dice: [6, 3] });
    expect(s.terrain.gate.wounds).toBe(2);
    expect(breachBlocked(s, catalog, 'ram', s.models.b, s.terrain.ram)).toBe('The ram has swung this turn');
  });

  it('takes two to lift, and cavalry can’t carry it', () => {
    const ram = piece('ram', 'objective', 24, 30, 1, 1, { object: 'ram', side: 'p2' });
    let s = begin([mk('a', 'p2', 24, 30.99), mk('r', 'p1', 10, 10, '[rohan] warrior')], [ram]);
    expect(markerActions(s, s.models.a).some(a => a.kind === 'pickUp')).toBe(false);
    s = run(s, { type: 'addModels', models: [mk('b', 'p2', 24, 29.01)] });
    expect(markerActions(s, s.models.a).some(a => a.kind === 'pickUp')).toBe(true);
  });
});

describe('siege ladders', () => {
  it('halves the Move of a model carrying it alone, not with a friend helping', () => {
    const ladder = piece('lad', 'objective', 20, 40, 1, 1, { object: 'ladder', side: 'p2' });
    let s = begin([mk('a', 'p2', 20, 40.99), mk('r', 'p1', 10, 10, '[rohan] warrior')], [ladder]);
    s = run(s, { type: 'pickUp', model: 'a', marker: 'lad' });
    expect(s.terrain.lad.carrier).toBe('a');
    expect(moveAllowance(s, s.models.a)).toBe(3);
    s = run(s, { type: 'addModels', models: [mk('b', 'p2', 21.2, 40)] });
    expect(moveAllowance(s, s.models.a)).toBe(6);
  });

  it('is raised against a wall its carrier reaches, and lets models climb a sheer wall there without a test', () => {
    const ladder = piece('lad', 'objective', 15, 28, 1, 1, { object: 'ladder', side: 'p2' });
    let s = begin([mk('a', 'p2', 15, 28.99), mk('b', 'p2', 15.98, 28.99), mk('r', 'p1', 40, 10, '[rohan] warrior')], [...WALLS, GATE, ladder]);
    // Without a ladder the sheer wall can't be climbed.
    const far = s.models.b;
    const c = crossingAhead(s, { ...far, x: 10 }, { x: 10, y: 28 }, { x: 10, y: 20 })!;
    expect(c.test).toBe('Climb');
    expect(crossBlocked(s, { ...far, x: 10, y: c.stop.y }, c)).toBe('Too sheer to climb: it needs a Siege Ladder');
    s = run(s, { type: 'pickUp', model: 'a', marker: 'lad' }, { type: 'moveModels', moves: [{ id: 'a', x: 15, y: BELOW }, { id: 'b', x: 15.98, y: BELOW }] });
    expect(s.terrain.lad).toMatchObject({ raised: 'wl', side: 'p2' });
    expect(s.terrain.lad.carrier).toBeUndefined();
    expect(s.terrain.lad.y).toBeCloseTo(24.5, 1);
    expect(crossingAhead(s, s.models.a, s.models.a, { x: 15, y: 21 })).toBeNull();
  });

  it('can be pushed down by a defender on the walls, and those on it fall', () => {
    const ladder = piece('lad', 'objective', 15, 24.5, 1, 1, { object: 'ladder', side: 'p2', raised: 'wl' });
    let s = begin([mk('a', 'p2', 15, 25.49), mk('d', 'p1', 15, 23.01, '[rohan] warrior'), mk('d2', 'p1', 15.98, 23.01, '[rohan] warrior')], [...WALLS, ladder]);
    s = { ...s, priority: 'p1' };
    expect(breachOptions(s, catalog, s.models.d).map(o => o.how)).toEqual(['push']);
    // A 3, +1 for the friend beside it, -1 for the Uruk on the ladder: 3, not enough.
    expect(breach(s, 'push', 'd', 'lad', [3], 'p1')!.terrain.lad.raised).toBe('wl');
    s = breach(s, 'push', 'd', 'lad', [4, 6], 'p1')!;
    expect(s.terrain.lad.raised).toBeUndefined();
    expect(s.log.some(r => /Falling/.test(r.label) && r.against === 'a')).toBe(true);
    expect(s.flow.stopped).toContain('d');
  });
});
