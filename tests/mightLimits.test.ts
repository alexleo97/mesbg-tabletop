import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { botStep, newMemo } from '../src/shared/bot.ts';
import { heroicBlocked, mightBlocked } from '../src/shared/mightUse.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from '../src/shared/types.ts';

// Might goes only on what a hero can actually use: a heroic action in range of something, a power at a target it
// can reach, and a roll whose result is still to be used.

const unit = (name: string, army: string, type: string, extra: object = {}) => ({ name, army, origin: army, type, points: 50, stats: ['6"', '5', '4+', '4', '5', '2', '2', '6+', '4+'], options: [], rules: [], wargear: [], ...extra });
const catalog = {
  source: '',
  armies: { Gondor: { side: 'Good', units: [], rules: [] }, Mordor: { side: 'Evil', units: [], rules: [] } },
  units: {
    captain: unit('Captain', 'Gondor', 'Hero of Fortitude', { wargear: ['Bow'], heroics: ['Heroic Accuracy', 'Heroic Strike'] }),
    archer: unit('Archer', 'Gondor', 'Warrior', { wargear: ['Bow'] }),
    shaman: unit('Shaman', 'Mordor', 'Hero of Fortitude', { powers: [{ name: 'Transfix', range: '12"', cast: '5+' }], heroics: ['Heroic Channelling'] }),
    orc: unit('Orc', 'Mordor', 'Warrior'),
    boss: unit('Boss', 'Mordor', 'Hero of Valour'),
  },
} as unknown as Catalog;

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, catalog);
  return out && run(s, ...out.apply);
};
const battle = (models: Model[], phase: 'move' | 'shoot' | 'fight' = 'move') =>
  run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: 'p1' }, ...(phase === 'move' ? [] : [{ type: 'setPhase', phase } as Action]));

describe('casting at a target out of range', () => {
  const shaman = (x: number) => battle([mk('shaman', 'p2', 10, 10, { hero: true, will: 3, might: 2, profileId: 'shaman' }), mk('cap', 'p1', x, 10, { hero: true, will: 1, profileId: 'captain' })]);
  const cast = (cv = 5): Action => ({ type: 'cast', model: 'shaman', target: 'cap', power: 'Transfix', cv, will: 1 });

  it('is refused, so no Will (and no Might after it) goes on it', () => {
    expect(ask(shaman(30), 'p2', cast(), [4])).toBeNull();
    // In range the cast goes ahead, and a die one short waits on the shaman's Might.
    const s = ask(shaman(18), 'p2', cast(), [4])!;
    expect(s.flow.spell?.caster).toBe('shaman');
    expect(mightBlocked(s, s.log.at(-1)!)).toBeNull();
  });

  it("uses the profile's casting value, not the one sent", () => {
    const s = ask(shaman(18), 'p2', cast(2), [3])!;
    expect(s.log.at(-1)).toMatchObject({ target: 5, note: expect.stringMatching(/^Short by 2/) });
    expect(ask(shaman(18), 'p2', { ...cast(), power: 'Sorcerous Blast' } as Action, [6])).toBeNull();
  });
});

describe('heroic actions it can’t use now', () => {
  it('blocks a Heroic Challenge with no enemy hero of its tier or higher within 6"', () => {
    const near = (boss: number) => battle([mk('cap', 'p1', 10, 10, { hero: true, might: 2, profileId: 'captain' }), mk('o', 'p2', 10.99, 10, { profileId: 'orc' }), mk('boss', 'p2', boss, 10, { hero: true, might: 1, profileId: 'boss' })], 'fight');
    expect(heroicBlocked(near(25), catalog, near(25).models.cap, 'Heroic Challenge')).toMatch(/No enemy hero within 6"/);
    expect(heroicBlocked(near(15), catalog, near(15).models.cap, 'Heroic Challenge')).toBeNull();
  });

  it('blocks the Fight phase ones for a hero not in a fight', () => {
    const s = (orc: number) => battle([mk('cap', 'p1', 10, 10, { hero: true, might: 2, profileId: 'captain' }), mk('o', 'p2', orc, 10, { profileId: 'orc' })], 'fight');
    for (const a of ['Heroic Strike', 'Heroic Combat', 'Heroic Defence']) expect(heroicBlocked(s(30), catalog, s(30).models.cap, a)).toMatch(/isn't in a fight/);
    expect(heroicBlocked(s(10.99), catalog, s(10.99).models.cap, 'Heroic Strike')).toBeNull();
  });

  it('blocks a Heroic Shoot or Accuracy when neither the hero nor a friend within 6" has an enemy in range', () => {
    const s = (orc: number, archer = 14) => battle([mk('cap', 'p1', 10, 10, { hero: true, might: 2, profileId: 'captain' }), mk('a', 'p1', archer, 10, { profileId: 'archer' }), mk('o', 'p2', orc, 10, { profileId: 'orc' })], 'shoot');
    expect(heroicBlocked(s(70), catalog, s(70).models.cap, 'Heroic Shoot')).toMatch(/No enemy in range and sight/);
    expect(heroicBlocked(s(70), catalog, s(70).models.cap, 'Heroic Accuracy')).toMatch(/No enemy in range and sight/);
    expect(heroicBlocked(s(30), catalog, s(30).models.cap, 'Heroic Shoot')).toBeNull();
    // A friend in range it could shout Loose for is enough.
    const far = battle([mk('cap', 'p1', 10, 10, { hero: true, might: 2 }), mk('a', 'p1', 15, 10, { profileId: 'archer' }), mk('o', 'p2', 36, 10, { profileId: 'orc' })], 'shoot');
    expect(heroicBlocked(far, catalog, far.models.cap, 'Heroic Shoot')).toBeNull();
  });

  it('blocks Heroic Channelling for a hero with no power or no Will', () => {
    const s = battle([mk('shaman', 'p2', 10, 10, { hero: true, will: 0, might: 1, profileId: 'shaman' }), mk('cap', 'p1', 30, 10, { hero: true, might: 1, profileId: 'captain' })]);
    expect(heroicBlocked(s, catalog, s.models.shaman, 'Heroic Channelling')).toMatch(/no Will/);
    expect(heroicBlocked(s, catalog, s.models.cap, 'Heroic Channelling')).toMatch(/no magical powers/);
  });

  it("keeps the computer's casters to the same", () => {
    const game = (x: number) => ({
      ...run(
        initialState(),
        { type: 'addModels', models: [mk('shaman', 'p2', 10, 10, { hero: true, will: 3, profileId: 'shaman' }), mk('cap', 'p1', x, 10, { hero: true, will: 0, profileId: 'captain' })] },
        { type: 'startGame' },
        { type: 'setPhase', phase: 'move' },
        { type: 'choosePriority', seat: 'p2' },
      ),
      bot: 'p2' as Seat,
    });
    const steps = (s: GameState) => {
      const out: Action[] = [];
      for (let i = 0; i < 5; i++) {
        const a = botStep(s, 'p2', catalog, newMemo(), Date.now(), true)?.action;
        if (a) out.push(a);

      }
      return out;
    };
    expect(steps(game(16)).some(a => a.type === 'cast')).toBe(true);
    expect(steps(game(40)).some(a => a.type === 'cast')).toBe(false);
  });
});

describe('Might on a roll whose result has been used', () => {
  const duel = (id: string, side: 0 | 1, model: string, dice: number[]): DiceRoll => ({ id, by: 'p1', label: `Duel: ${model}`, dice, side, f: 4, model, group: 'f-1', at: 0 });
  const fight = () => battle([mk('hero', 'p1', 10, 10, { hero: true, might: 3 }), mk('orc', 'p2', 10.99, 10)], 'fight');

  it('lets Might change a duel until the strikes are rolled, and strikes until the wounds are taken', () => {
    let s = run(fight(), { type: 'rolled', roll: duel('d1', 0, 'hero', [4]) }, { type: 'rolled', roll: duel('d2', 1, 'orc', [5]) });
    expect(mightBlocked(s, s.log.find(r => r.id === 'd1')!)).toBeNull();
    s = run(s, { type: 'rolled', roll: { id: 's1', by: 'p1', label: 'hero strikes orc', dice: [3], target: 4, against: 'orc', model: 'hero', group: 'f-1', at: 0 } });
    expect(mightBlocked(s, s.log.find(r => r.id === 'd1')!)).toMatch(/Too late/);
    expect(run(s, { type: 'useMight', roll: 'd1', die: 0 }).models.hero.might).toBe(3);
    expect(mightBlocked(s, s.log.find(r => r.id === 's1')!)).toBeNull();
    s = run(s, { type: 'wound', id: 'orc', count: 0, group: 'f-1', checked: true });
    s = { ...s, flow: { ...s.flow, applied: [...(s.flow.applied ?? []), 'f-1>orc'] } };
    expect(run(s, { type: 'useMight', roll: 's1', die: 0 }).models.hero.might).toBe(3);
  });

  it('refuses a settled Fate roll, a resist and the Royal Standard’s refund', () => {
    const s = run(
      battle([mk('hero', 'p1', 10, 10, { hero: true, might: 3 })]),
      { type: 'rolled', roll: { id: 'f1', by: 'p1', label: 'Fate roll: hero (4+ saves a wound)', dice: [3], target: 4, model: 'hero', at: 0 } },
      { type: 'rolled', roll: { id: 'r1', by: 'p1', label: 'Resist Transfix (5+) by hero', dice: [4], target: 5, model: 'hero', at: 0 } },
      { type: 'rolled', roll: { id: 'k1', by: 'p1', label: 'Royal Standard of Rohan: hero spent 1 Might (6 gets it back)', dice: [5], target: 6, model: 'hero', at: 0 } },
    );
    for (const id of ['f1', 'r1', 'k1']) expect(run(s, { type: 'useMight', roll: id, die: 0 }).models.hero.might).toBe(3);
  });
});
