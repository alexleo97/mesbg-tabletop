import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { botStep, type BotMemo } from '../src/shared/bot.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { chargesDue } from '../src/shared/trample.ts';
import { biggerHolds, heldBy, impactHits, isChariot, isWarBeast, riders } from '../src/shared/warBeasts.ts';
import type { Action, GameState, Model, Seat, Terrain } from '../src/shared/types.ts';

const unit = (name: string, army: string, rules: string[] = [], stats = ['6"', '3', '4+', '3', '5', '1', '1', '7', '7+']) => ({ name, army, origin: army, type: 'Warrior', points: 5, stats, options: [], rules, wargear: ['hand weapon'] });
const catalog = {
  source: '',
  armies: { Harad: { side: 'Evil', units: [], rules: [] }, Gondor: { side: 'Good', units: [], rules: [] } },
  units: {
    '[harad] mumak': unit('Mûmak', 'Harad', ['Trample', 'Terror'], ['8"', '4', '-', '9', '7', '0', '10', '7', '-']),
    '[harad] warrior': unit('Haradrim Warrior', 'Harad'),
    '[harad] chariot': unit('Khandish Chariot', 'Harad', ['Chariot Charge'], ['10"', '4', '4+', '3', '7', '1', '3', '7', '7+']),
    '[gondor] warrior': unit('Warrior of Minas Tirith', 'Gondor'),
    '[gondor] troll': unit('Cave Troll', 'Gondor', [], ['6"', '6', '5+', '9', '7', '3', '3', '3', '4+']),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, profileId: string, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, ...extra,
});
const mumak = (x: number, y: number, extra: Partial<Model> = {}) => mk('mk', 'p2', x, y, '[harad] mumak', { name: 'Mûmak', beast: 'war', move: 8, wounds: 10, maxWounds: 10, base: { shape: 'rect', w: 105, h: 165 }, howdahWounds: 5, ...extra });
const chariot = (x: number, y: number, extra: Partial<Model> = {}) => mk('ch', 'p2', x, y, '[harad] chariot', { name: 'Khandish Chariot', beast: 'chariot', move: 10, wounds: 3, maxWounds: 3, base: { shape: 'rect', w: 60, h: 100 }, ...extra });
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
/** The game started, in the Move phase, with Evil (p2) to move. */
const begin = (models: Model[], terrain: Terrain[] = []) =>
  run(initialState(), { type: 'addModels', models }, ...terrain.map((t): Action => ({ type: 'addTerrain', terrain: t })), { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p2' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 6, uid, Date.now(), catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};

describe('war beasts', () => {
  it('knows a war beast and a chariot, and their Impact Hits', () => {
    const s = begin([mumak(20, 20), chariot(40, 20)]);
    expect(isWarBeast(catalog, s.models.mk)).toBe(true);
    expect(isChariot(catalog, s.models.ch)).toBe(true);
    expect(impactHits(catalog, s.models.mk)).toEqual({ n: 3, s: 9 });
    expect(impactHits(catalog, { ...s.models.mk, options: ['Tusk Weapons'] })).toEqual({ n: 4, s: 9 });
    expect(impactHits(catalog, s.models.ch)).toEqual({ n: 2, s: 4 });
  });

  it("isn't moved by a plain drag: it moves by Trampling", () => {
    const s = begin([mumak(20, 30), mk('o', 'p1', 40, 5, '[gondor] warrior')]);
    expect(run(s, { type: 'moveModels', moves: [{ id: 'mk', x: 20, y: 25 }] }).models.mk.y).toBe(30);
  });

  it('goes its whole Move straight on, running over those it slays and stopping at one that lives', () => {
    // Warriors of 1 Wound in a column ahead; sixes slay each.
    let s = begin([mumak(20, 30, { aboard: undefined }), mk('cmd', 'p2', 20, 30, '[harad] warrior', { name: 'Commander', hero: true, aboard: 'mk' }), mk('a', 'p1', 20, 25, '[gondor] warrior'), mk('far', 'p1', 50, 5, '[gondor] warrior')]);
    s = ask(s, 'p2', { type: 'trample', id: 'mk', x: 20, y: 0 }, [])!;
    expect(s.models.a.dead).toBe(true);
    // A whole 8" up the table, and its Commander came with it.
    expect(s.models.mk.y).toBeCloseTo(22, 0);
    expect(s.models.cmd).toMatchObject({ x: s.models.mk.x, y: s.models.mk.y });
    expect(s.flow.trampled).toContain('mk');
    // Done for the turn.
    expect(ask(s, 'p2', { type: 'trample', id: 'mk', x: 20, y: 0 }, [])).toBeNull();
  });

  it('stops against a model that lives through the Impact Hits, which then counts as charged', () => {
    let s = begin([mumak(20, 30), mk('cmd', 'p2', 20, 30, '[harad] warrior', { name: 'Commander', hero: true, aboard: 'mk' }), mk('t', 'p1', 20, 24, '[gondor] troll', { wounds: 3, maxWounds: 3 })]);
    s = ask(s, 'p2', { type: 'trample', id: 'mk', x: 20, y: 0 }, [1, 1, 1, 1, 1, 1])!;
    expect(s.models.t.dead).toBe(false);
    expect(s.models.mk.y).toBeGreaterThan(24);
    expect(s.flow.charges?.mk).toBe('t');
  });

  it('with no one riding it, tests its Courage first and Stampedes if it fails', () => {
    let s = begin([mumak(20, 30), mk('far', 'p1', 50, 5, '[gondor] warrior')]);
    s = ask(s, 'p2', { type: 'trample', id: 'mk', x: 20, y: 0 }, [1, 1])!;
    expect(s.models.mk.stampede).toBe(true);
    expect(s.models.mk.y).toBe(30);
    // Now the other player drives it.
    s = ask(s, 'p1', { type: 'trample', id: 'mk', x: 0, y: 30 }, [])!;
    expect(s.models.mk.x).toBeLessThan(20);
    expect(s.models.mk.stampede).toBeFalsy();
  });

  it('runs off the table edge in a Stampede, lost with everyone riding it', () => {
    let s = begin([mumak(5, 30, { stampede: true }), mk('cmd', 'p2', 5, 30, '[harad] warrior', { name: 'Commander', hero: true, aboard: 'mk' }), mk('far', 'p1', 40, 5, '[gondor] warrior')]);
    s = ask(s, 'p1', { type: 'trample', id: 'mk', x: -10, y: 30 }, [])!;
    expect(s.models.mk.dead).toBe(true);
    expect(s.models.cmd.dead).toBe(true);
  });

  it('is held fast by stronger enemies, and backs no one away between two big models by size', () => {
    const s = begin([mumak(20, 30), mk('t', 'p1', 20, 23, '[gondor] troll')]);
    expect(heldBy(catalog, s.models.mk, [s.models.t, s.models.t]).held).toBe(true);
    expect(heldBy(catalog, s.models.mk, [s.models.t]).held).toBe(false);
    expect(biggerHolds(catalog, s.models.mk, chariot(30, 30), () => 1).backs).toBe('b');
  });

  it('takes Howdah shots on the Howdah, and puts warriors in it before the battle', () => {
    let s = run(initialState(), { type: 'addModels', models: [mumak(20, 30), mk('h', 'p2', 21, 28, '[harad] warrior', { name: 'Haradrim Warrior' })] });
    s = run(s, { type: 'board', id: 'h', beast: 'mk' });
    expect(s.models.h.aboard).toBe('mk');
    expect(riders(s, s.models.mk).map(r => r.id)).toContain('h');
    s = run(s, { type: 'wound', id: 'mk', count: 2, by: ['x'], how: 'shoot', group: 'g', howdah: true });
    expect(s.models.mk).toMatchObject({ howdahWounds: 3, wounds: 10 });
  });
});

describe('chariots', () => {
  it('turns only 45° at the start of its Chariot Charge', () => {
    let s = begin([chariot(20, 30), mk('far', 'p1', 50, 5, '[gondor] warrior')]);
    s = ask(s, 'p2', { type: 'trample', id: 'ch', x: 40, y: 30 }, [])!;
    // Asked to go due right, it sets off up and to the right, and swings round as it goes.
    expect(s.models.ch.rot).toBeGreaterThan(45);
    expect(s.models.ch.y).toBeLessThan(30);
  });

  it('can turn on the spot instead, and then makes no charge', () => {
    let s = begin([chariot(20, 30), mk('far', 'p1', 50, 5, '[gondor] warrior')]);
    s = ask(s, 'p2', { type: 'trample', id: 'ch', x: 30, y: 30, pivot: true }, [])!;
    expect(s.models.ch).toMatchObject({ x: 20, y: 30 });
    expect(s.models.ch.rot).toBeCloseTo(90);
    expect(s.flow.trampled).toContain('ch');
  });
});

describe('the computer', () => {
  it('Tramples at the nearest enemy before it moves anything else', () => {
    const s = begin([mumak(20, 30), mk('cmd', 'p2', 20, 30, '[harad] warrior', { name: 'Commander', hero: true, aboard: 'mk' }), mk('o', 'p1', 30, 10, '[gondor] warrior')]);
    expect(chargesDue(s, catalog, 'p2').map(m => m.id)).toEqual(['mk']);
    const memo = { key: '', turn: 0, since: 0 } as unknown as BotMemo;
    let step = botStep(s, 'p2', catalog, memo, Date.now(), false);
    for (let i = 0; i < 5 && step && step.action?.type !== 'trample'; i++) step = botStep(s, 'p2', catalog, memo, Date.now(), false);
    expect(step?.action).toMatchObject({ type: 'trample', id: 'mk', x: 30, y: 10 });
  });
});
