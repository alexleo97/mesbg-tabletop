import { describe, expect, it } from 'vitest';
import { brokenTests } from '../src/shared/courage.ts';
import { combats } from '../src/shared/flow.ts';
import { shoutedFor } from '../src/shared/heroics.ts';
import { blockMove, heroicCombatWon } from '../src/shared/movement.ts';
import { freeResistDice } from '../src/shared/powers.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { adjustFight, resolveRequest } from '../src/shared/resolve.ts';
import { mayChargeAt, seekTargets } from '../src/shared/ring.ts';
import { supporters } from '../src/shared/support.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import type { FightRequest } from '../src/shared/fight.ts';
import { catalog } from './botsim.ts';

// The Invisible special rule (Rulebook): a model wearing the One Ring. None of it applies to the Nine.
const FRODO = '[the-fellowship] frodo-baggins';
const ORC = '[barad-dur] mordor-orc-warrior';
const WRAITH = '[army-of-the-great-eye] ringwraith';
const SPEAR = '[minas-tirith] warrior-of-minas-tirith';
const CAPTAIN = '[atop-the-walls] captain-of-minas-tirith';
const WARRIOR = '[atop-the-walls] warrior-of-minas-tirith';
const STEP = 0.99;
const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const frodo = (x: number, y: number, extra: Partial<Model> = {}) => mk('frodo', 'p1', x, y, { name: 'Frodo Baggins', profileId: FRODO, hero: true, might: 2, ringOn: true, ...extra });
const wraith = (id: string, x: number, y: number) => mk(id, 'p2', x, y, { name: 'Ringwraith', profileId: WRAITH, hero: true });
const moving = (models: Model[], priority: Seat = 'p1') =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: priority }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const fighting = (models: Model[]) => run(moving(models), { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
let n = 0;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, () => `u${n++}`, 1, catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : s;
};

describe('moving with an Invisible model about', () => {
  it('lets friends walk through it and it through them, but neither may stop on the other', () => {
    const s = moving([frodo(10, 12), mk('sam', 'p1', 10, 10)]);
    expect(blockMove(s, s.models.sam, { x: 10, y: 10 }, { x: 10, y: 14 })).toEqual({ x: 10, y: 14 });
    const stop = blockMove(s, s.models.sam, { x: 10, y: 10 }, { x: 10, y: 12 });
    // It stops touching Frodo, not on top of him.
    expect(stop.y).toBeLessThan(11.1);
    expect(stop.y).toBeGreaterThan(10.9);
    const seen = moving([frodo(10, 12, { ringOn: undefined }), mk('sam', 'p1', 10, 10)]);
    expect(blockMove(seen, seen.models.sam, { x: 10, y: 10 }, { x: 10, y: 14 }).y).toBeLessThan(11.1);
  });

  it('has no control zone, ignores those of foes that cannot see it, and the Nine see it all the same', () => {
    const s = moving([frodo(6, 10), mk('orc', 'p2', 10, 11.2, { profileId: ORC })]);
    expect(blockMove(s, s.models.frodo, { x: 6, y: 10 }, { x: 14, y: 10 })).toEqual({ x: 14, y: 10 });
    const nine = moving([frodo(6, 10), wraith('w', 10, 11.2)]);
    expect(blockMove(nine, nine.models.frodo, { x: 6, y: 10 }, { x: 14, y: 10 }).x).toBeLessThan(10);
  });

  it('can be charged only after passing an Intelligence test, 1 worse for every full inch away', () => {
    let s = moving([frodo(10, 10), mk('orc', 'p2', 10, 13.5, { profileId: ORC })], 'p2');
    const orc = s.models.orc;
    const [t] = seekTargets(s, catalog, orc);
    expect(t.target.id).toBe('frodo');
    // The Orc's Intelligence 8+, and 3.5" apart centre to centre is 2.5" base to base: 2 full inches, so 10+.
    expect(t.need).toBe(10);
    const to = { x: 10, y: 10 + STEP };
    expect(blockMove(s, orc, { x: 10, y: 13.5 }, to).y).toBeGreaterThan(10 + STEP + 0.01);
    // A failed test: no charging Frodo this turn, and no second try.
    const failed = ask(s, 'p2', { type: 'seek', id: 'orc', target: 'frodo' }, [1, 2]);
    expect(mayChargeAt(failed, orc, failed.models.frodo)).toBe(false);
    expect(seekTargets(failed, catalog, orc)).toEqual([]);
    expect(blockMove(failed, orc, { x: 10, y: 13.5 }, to).y).toBeGreaterThan(10 + STEP + 0.01);
    s = ask(s, 'p2', { type: 'seek', id: 'orc', target: 'frodo' }, [6, 4]);
    expect(mayChargeAt(s, orc, s.models.frodo)).toBe(true);
    expect(blockMove(s, orc, { x: 10, y: 13.5 }, to).y).toBeCloseTo(10 + STEP, 1);
    // The Nine need no test.
    const nine = moving([frodo(10, 10), wraith('w', 10, 13.5)], 'p2');
    expect(seekTargets(nine, catalog, nine.models.w)).toEqual([]);
    expect(mayChargeAt(nine, nine.models.w, nine.models.frodo)).toBe(true);
  });
});

describe('fighting an Invisible model', () => {
  const req = (s: GameState, a: string[], b: string[]): FightRequest => ({
    sides: [a.map(id => ({ id, name: id, f: 4, a: 1, s: 3, d: 4 })), b.map(id => ({ id, name: id, f: 5, a: 1, s: 3, d: 4 }))],
    targets: [b[0], a[0]],
    trapped: false,
    combat: combats(s)[0]?.key,
  });

  it('halves the Fight of foes it fights alone, rounding up, but not the Nine\'s', () => {
    const s = fighting([frodo(10, 10), mk('orc', 'p2', 10, 10 + STEP, { profileId: ORC })]);
    expect(adjustFight(s, req(s, ['frodo'], ['orc']), catalog).sides[1][0].f).toBe(3);
    const friend = fighting([frodo(10, 10), mk('sam', 'p1', 10 + STEP, 10), mk('orc', 'p2', 10, 10 + STEP, { profileId: ORC })]);
    expect(adjustFight(friend, req(friend, ['frodo', 'sam'], ['orc']), catalog).sides[1][0].f).toBe(5);
    const nine = fighting([frodo(10, 10), wraith('w', 10, 10 + STEP)]);
    expect(adjustFight(nine, req(nine, ['frodo'], ['w']), catalog).sides[1][0].f).toBe(5);
  });

  it('cannot be supported, and a foe only fighting it cannot be either', () => {
    const behind = fighting([frodo(10, 10), mk('spear', 'p1', 10, 10 - STEP, { profileId: SPEAR, options: ['Shield and spear'] }), mk('orc', 'p2', 10, 10 + STEP, { profileId: ORC })]);
    expect(supporters(behind, catalog, combats(behind)[0]).p1).toEqual([]);
    const theirs = fighting([frodo(10, 10), mk('orc', 'p2', 10, 10 + STEP, { profileId: SPEAR }), mk('spear', 'p2', 10, 10 + 2 * STEP, { profileId: SPEAR, options: ['Shield and spear'] })]);
    expect(supporters(theirs, catalog, combats(theirs)[0]).p2).toEqual([]);
    const seen = fighting([frodo(10, 10, { ringOn: undefined }), mk('orc', 'p2', 10, 10 + STEP, { profileId: SPEAR }), mk('spear', 'p2', 10, 10 + 2 * STEP, { profileId: SPEAR, options: ['Shield and spear'] })]);
    expect(supporters(seen, catalog, combats(seen)[0]).p2).toEqual(['spear']);
  });
});

describe("an Invisible hero's heroic actions", () => {
  it('shout for nobody, and its Heroic Combat frees only itself', () => {
    const s = moving([frodo(10, 10), mk('sam', 'p1', 12, 10)]);
    expect(shoutedFor(s, s.models.frodo)).toEqual([]);
    expect(shoutedFor(s, { ...s.models.frodo, ringOn: undefined }).map(m => m.id)).toEqual(['sam']);
    let f = fighting([frodo(10, 10), mk('sam', 'p1', 10 + STEP, 10), mk('orc', 'p2', 10, 10 + STEP, { profileId: ORC, dead: true })]);
    f = { ...f, flow: { ...f.flow, heroics: [{ model: 'frodo', action: 'Heroic Combat', phase: 'fight', turn: f.turn }] as never, resolved: ['frodo,sam,|,orc'] } };
    expect(heroicCombatWon(f, f.models.frodo)).toBe(true);
    expect(heroicCombatWon(f, f.models.sam)).toBe(false);
  });

  it('give no Heroic Resolve die to friends, and no Stand Fast!', () => {
    const s = moving([frodo(10, 10), mk('sam', 'p1', 12, 10)]);
    const resolve = { ...s, flow: { ...s.flow, heroics: [{ model: 'frodo', action: 'Heroic Resolve', phase: 'move', turn: s.turn }] as never } };
    expect(freeResistDice(resolve, catalog, resolve.models.sam)).toBe(0);
    const broken = run(
      initialState(),
      { type: 'addModels', models: [mk('cap', 'p1', 10, 10, { hero: true, profileId: CAPTAIN, ringOn: true }), mk('near', 'p1', 12, 10, { profileId: WARRIOR }), ...[1, 3, 5].map(y => mk(`d${y}`, 'p1', 1, y, { dead: true })), mk('e', 'p2', 30, 10)] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
    );
    const seq = [6, 6, 1, 1];
    const rolls = brokenTests(broken, 'p1', catalog, () => seq.shift() ?? 1, () => `u${n++}`).filter(a => a.type === 'rolled' && a.roll.dice.length);
    // The captain passes, but the warrior beside him still has to roll.
    expect(rolls.map(a => a.type === 'rolled' && a.roll.model)).toEqual(['cap', 'near']);
  });
});
