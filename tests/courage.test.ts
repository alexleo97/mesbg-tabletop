import { describe, expect, it } from 'vitest';
import catalogJson from '../src/data/mesbg-data.json';
import type { Catalog } from '../src/shared/catalog.ts';
import { brokenSideToTest, brokenTests, terrorAhead, terrorTest } from '../src/shared/courage.ts';
import { moveAllowance } from '../src/shared/movement.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';

const catalog = catalogJson as unknown as Catalog;
const TROLL = '[army-of-carn-dum] hill-troll';
const CAPTAIN = '[atop-the-walls] captain-of-minas-tirith';
const WARRIOR = '[atop-the-walls] warrior-of-minas-tirith';
const R = 25 / 25.4 / 2;
const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const dice = (...seq: number[]) => () => seq.shift() ?? 1;
let n = 0;
const uid = () => `u${n++}`;

describe('Broken army Courage tests', () => {
  // Player 1 has lost 4 of its 7 models, so it is Broken.
  const broken = () =>
    run(
      initialState(),
      {
        type: 'addModels',
        models: [
          mk('cap', 'p1', 10, 10, { hero: true, profileId: CAPTAIN }),
          mk('near', 'p1', 12, 10, { profileId: WARRIOR }),
          mk('far', 'p1', 40, 40, { profileId: WARRIOR }),
          mk('d1', 'p1', 1, 1, { dead: true }),
          mk('d2', 'p1', 1, 3, { dead: true }),
          mk('d3', 'p1', 1, 5, { dead: true }),
          mk('d4', 'p1', 1, 7, { dead: true }),
          mk('e', 'p2', 30, 10),
        ],
      },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
    );

  it('are due as the Broken side starts to move, once a turn', () => {
    const s = broken();
    expect(brokenSideToTest(s)).toBe('p1');
    const after = run(s, ...brokenTests(s, 'p1', catalog, dice(6, 6, 1, 1), uid));
    expect(brokenSideToTest(after)).toBeNull();
    expect(brokenSideToTest(run(after, { type: 'setPhase', phase: 'move', turn: 2 }))).toBe('p1');
  });

  it('lets a hero who passes hold the friends near it, and the rest flee if they fail', () => {
    const s = broken();
    // The captain rolls 6+6 and passes; the far warrior rolls 1+1 and flees. The near one never rolls.
    const actions = brokenTests(s, 'p1', catalog, dice(6, 6, 1, 1), uid);
    const rolls = actions.filter(a => a.type === 'rolled' && a.roll.dice.length);
    expect(rolls.map(a => a.type === 'rolled' && a.roll.model)).toEqual(['cap', 'far']);
    const after = run(s, ...actions);
    expect(after.models.cap.dead).toBe(false);
    expect(after.models.near.dead).toBe(false);
    expect(after.models.far.dead).toBe(true);
    expect(after.flow.courage).toMatchObject({ cap: true, near: true, far: false });
  });
});

describe('charging a terrifying enemy', () => {
  const game = () =>
    run(
      initialState(),
      { type: 'addModels', models: [mk('w', 'p1', 10, 20, { profileId: WARRIOR }), mk('t', 'p2', 10, 14, { profileId: TROLL, base: { shape: 'round', w: 40, h: 40 } })] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
    );

  it('needs a Courage test when the charger makes contact, and only then', () => {
    const s = game();
    expect(terrorAhead(s, s.models.w, { x: 10, y: 18 }, catalog)).toBeNull();
    expect(terrorAhead(s, s.models.w, { x: 10, y: 14 + 40 / 25.4 / 2 + R }, catalog)?.id).toBe('t');
  });

  it('holds a model that fails still for the rest of the turn', () => {
    const s = game();
    const fail = terrorTest(s.models.w, s.models.t, catalog, dice(1, 1), uid);
    expect(fail.pass).toBe(false);
    const after = run(s, ...fail.actions);
    expect(moveAllowance(after, after.models.w)).toBe(0);
    expect(terrorAhead(after, after.models.w, { x: 10, y: 14 + 40 / 25.4 / 2 + R }, catalog)).toBeNull();
    const pass = terrorTest(s.models.w, s.models.t, catalog, dice(6, 6), uid);
    expect(moveAllowance(run(s, ...pass.actions), s.models.w)).toBe(6);
  });
});

describe('Fearful', () => {
  it('takes two Courage tests to charge a terrifying enemy, one for each rule', () => {
    const s = run(
      initialState(),
      { type: 'addModels', models: [mk('r', 'p1', 10, 20, { hero: true, profileId: '[battle-of-bywater] rosie-cotton' }), mk('t', 'p2', 10, 14, { profileId: TROLL, base: { shape: 'round', w: 40, h: 40 } }), mk('o', 'p2', 20, 14, { profileId: WARRIOR })] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'move' },
    );
    const both = terrorTest(s.models.r, s.models.t, catalog, dice(6, 6, 6, 6), uid, 0, s);
    expect(both.actions.filter(a => a.type === 'rolled').map(a => (a.type === 'rolled' ? a.roll.label : ''))).toEqual([expect.stringContaining('(Fearful)'), expect.stringContaining('(Terror)')]);
    expect(both.pass).toBe(true);
    // Failing the first, it doesn't take the second.
    const fail = terrorTest(s.models.r, s.models.t, catalog, dice(1, 1, 6, 6), uid, 0, s);
    expect(fail.actions.filter(a => a.type === 'rolled')).toHaveLength(1);
    expect(fail.pass).toBe(false);
    // Charging an enemy with no Terror, just the one.
    expect(terrorTest(s.models.r, s.models.o, catalog, dice(6, 6), uid, 0, s).actions.filter(a => a.type === 'rolled')).toHaveLength(1);
  });
});

describe('Heroic Combat', () => {
  it('lets the winners move again once every enemy in the fight is slain', () => {
    let s = run(
      initialState(),
      { type: 'addModels', models: [mk('h', 'p1', 10, 20, { hero: true, might: 1 }), mk('f', 'p1', 12, 20), mk('o', 'p2', 10, 20 - 2 * R)] },
      { type: 'startGame' },
      { type: 'setPhase', phase: 'fight' },
    );
    s = { ...s, flow: { ...s.flow, heroics: [{ model: 'h', action: 'Heroic Combat', phase: 'fight' }] } };
    expect(moveAllowance(s, s.models.h)).toBe(1);
    s = run(s, { type: 'resolveCombat', key: 'h,|,o' });
    expect(moveAllowance(s, s.models.h)).toBe(1);
    s = run(s, { type: 'wound', id: 'o', count: 1 });
    expect(s.models.o.dead).toBe(true);
    expect(moveAllowance(s, s.models.h)).toBe(6);
    // A friend who wasn't in that fight doesn't get the move.
    expect(moveAllowance(s, s.models.f)).toBe(1);
  });
});
