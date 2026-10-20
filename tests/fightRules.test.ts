import { describe, expect, it } from 'vitest';
import { fightDuel, resolveStrikes, type FightRequest } from '../src/shared/fight.ts';
import { openDuel } from '../src/shared/bot.ts';
import { fightDone } from '../src/shared/movement.ts';
import { combats, pairOff } from '../src/shared/flow.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { resolveRequest } from '../src/shared/resolve.ts';
import { supporters } from '../src/shared/support.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const mk = (id: string, owner: Seat, x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
const STEP = 0.99;
const at = (models: Model[]) => run(initialState(), { type: 'addModels', models });
const toFight = (s: GameState, priority: Seat = 'p1') =>
  run(s, { type: 'startGame' }, { type: 'setPhase', phase: 'move' }, { type: 'choosePriority', seat: priority }, { type: 'setPhase', phase: 'fight' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
let n = 0;
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const seq = [...dice];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, () => `u${n++}`, Date.now(), catalog);
  return out && run(s, ...out.apply, ...(out.record ? [out.record] : []));
};

describe('pairing off fights', () => {
  it('never puts more than one model on both sides of a fight', () => {
    // A line: a1 - b1 - a2 - b2, all touching their neighbours.
    const s = at([mk('a1', 'p1', 10, 10), mk('b1', 'p2', 10 + STEP, 10), mk('a2', 'p1', 10 + 2 * STEP, 10), mk('b2', 'p2', 10 + 3 * STEP, 10)]);
    const fights = combats(s);
    for (const c of fights) expect(c.p1.length === 1 || c.p2.length === 1).toBe(true);
    expect(fights.flatMap(c => [...c.p1, ...c.p2]).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it("lets the player with Priority choose for a model touching two fights", () => {
    // Pippin touches D, E and F; Aragorn touches F and G.
    const s = at([mk('pip', 'p1', 10, 10), mk('d', 'p2', 10, 10 - STEP), mk('e', 'p2', 10 - STEP, 10), mk('f', 'p2', 10 + STEP, 10), mk('ara', 'p1', 10 + 2 * STEP, 10), mk('g', 'p2', 10 + 3 * STEP, 10)]);
    const byDefault = pairOff(Object.values(s.models), s);
    expect(byDefault.find(c => c.p1.includes('pip'))!.p2).toEqual(['d', 'e', 'f']);
    let f = toFight(s);
    expect(run(f, { type: 'pairOff', id: 'f', with: 'ara' }).flow.pairs).toContain('ara,|,f,g');
    // Once a duel is rolled, the pairs are fixed.
    f = ask(f, 'p1', { type: 'fight', fight: { sides: [[{ id: 'ara', name: 'ara', f: 5, a: 2, s: 4, d: 6 }], [{ id: 'f', name: 'f', f: 3, a: 1, s: 3, d: 4 }, { id: 'g', name: 'g', f: 3, a: 1, s: 3, d: 4 }]], targets: ['f', 'ara'], trapped: false }, combat: undefined } as never, [6, 6, 1, 1])!;
    expect(run(f, { type: 'pairOff', id: 'f', with: 'ara' }).flow.pairs).toEqual(f.flow.pairs);
  });

  it('keeps the fights as they were paired when the phase began', () => {
    let s = toFight(at([mk('a', 'p1', 10, 10), mk('b', 'p2', 10 + STEP, 10), mk('c', 'p1', 20, 10)]));
    expect(combats(s).map(c => c.key)).toEqual(['a,|,b']);
    // b is pushed into c after its fight: no new fight starts.
    s = run(s, { type: 'resolveCombat', key: 'a,|,b' }, { type: 'updateModel', id: 'b', patch: { x: 20 - STEP } });
    expect(combats(s).filter(c => !s.flow.resolved.includes(c.key))).toEqual([]);
  });

  it('only lets the player with Priority start a fight', () => {
    const s = toFight(at([mk('a', 'p1', 10, 10), mk('b', 'p2', 10 + STEP, 10)]), 'p2');
    const fight = { sides: [[{ id: 'a', name: 'a', f: 3, a: 1, s: 3, d: 4 }], [{ id: 'b', name: 'b', f: 3, a: 1, s: 3, d: 4 }]], targets: ['b', 'a'], trapped: false, combat: 'a,|,b' } as FightRequest;
    expect(ask(s, 'p1', { type: 'fight', fight }, [6, 1])).toBeNull();
    expect(ask(s, 'p2', { type: 'fight', fight }, [6, 1])).not.toBeNull();
  });
});

describe('supporting with spears', () => {
  const spear = { profileId: '[minas-tirith] warrior-of-minas-tirith', options: ['Shield and spear'] };
  it('lets a spear behind a friend add a die and a strike, and never be struck', () => {
    let s = toFight(at([mk('front', 'p1', 10, 10, { profileId: spear.profileId }), mk('back', 'p1', 10, 10 + STEP, spear), mk('orc', 'p2', 10, 10 - STEP, { profileId: '[barad-dur] mordor-orc-warrior' })]));
    const c = combats(s)[0];
    expect(supporters(s, catalog, c).p1).toEqual(['back']);
    const fight: FightRequest = {
      sides: [[{ id: 'front', name: 'front', f: 4, a: 1, s: 3, d: 6 }, { id: 'back', name: 'back', f: 4, a: 5, s: 3, d: 6, support: true }], [{ id: 'orc', name: 'orc', f: 3, a: 1, s: 3, d: 5 }]],
      targets: ['orc', 'back'],
      trapped: false,
      combat: c.key,
    };
    s = ask(s, 'p1', { type: 'fight', fight }, [2, 5, 4])!;
    const duel = s.log.filter(r => r.side !== undefined);
    // The supporter rolled one die, whatever its Attacks were said to be.
    expect(duel.find(r => r.model === 'back')).toMatchObject({ dice: [5], support: true });
    expect(s.flow.supported).toEqual(['back']);
    const group = duel[0].group!;
    s = ask(s, 'p1', { type: 'strikes', fight, group }, [6, 6, 6, 6])!;
    const strikes = s.log.filter(r => r.against);
    expect(strikes.map(r => r.model).sort()).toEqual(['back', 'front']);
  });

  it("doesn't let a model in a fight of its own, or without a spear, support", () => {
    const s = toFight(at([mk('front', 'p1', 10, 10), mk('back', 'p1', 10, 10 + STEP, { profileId: '[minas-tirith] warrior-of-minas-tirith' }), mk('orc', 'p2', 10, 10 - STEP)]));
    expect(supporters(s, catalog, combats(s)[0]).p1).toEqual([]);
  });
});

describe('strikes and drawn fights', () => {
  const duel = (dice: [number, number], f: [number, number] = [4, 4]): DiceRoll[] => [
    { id: 'd0', by: 'p1', label: 'Duel', dice: [dice[0]], at: 0, group: 'f-x', model: 'hero', f: f[0], side: 0 },
    { id: 'd1', by: 'p2', label: 'Duel', dice: [dice[1]], at: 0, group: 'f-x', model: 'o1', f: f[1], side: 1 },
  ];
  const req: FightRequest = {
    sides: [[{ id: 'hero', name: 'Hero', f: 4, a: 3, s: 4, d: 6 }], [{ id: 'o1', name: 'Orc 1', f: 4, a: 1, s: 3, d: 4 }, { id: 'o2', name: 'Orc 2', f: 4, a: 1, s: 3, d: 4 }]],
    targets: ['o1', 'hero'],
    trapped: false,
  };
  it('lets a winner split its strikes between the models it beat', () => {
    const { outcome } = resolveStrikes({ ...req, aims: { hero: ['o1', 'o2', 'o2'] } }, duel([6, 2]), () => 6, 'p1', 'f-x');
    expect(outcome.hits.map(h => [h.target.id, h.wounds])).toEqual([
      ['o1', 1],
      ['o2', 2],
    ]);
  });
  it('settles a draw between Good and Evil with one die, Elven weapons shifting it', () => {
    const draw = (d: number, elven: [boolean, boolean] = [false, false]) => resolveStrikes({ ...req, draw: { good: 0, elven } }, duel([3, 3]), () => d, 'p1', 'f-x').outcome.winner;
    expect(draw(4)).toBe(0);
    expect(draw(3)).toBe(1);
    expect(draw(3, [true, false])).toBe(0);
    expect(draw(4, [false, true])).toBe(1);
  });
});

describe('heroics in fights', () => {
  it('keeps a Heroic Strike bonus for the whole phase, and stops Might beating Heroic Defence', () => {
    let s = toFight(at([mk('hero', 'p1', 10, 10, { hero: true, might: 3 }), mk('b', 'p2', 10 + STEP, 10, { hero: true, might: 3 })]));
    s = run(s, { type: 'rolled', roll: { id: 'f-1-0', by: 'p1', label: 'Heroic Strike: hero +2 Fight', dice: [2], at: 0, group: 'f-1', model: 'hero' } });
    expect(s.flow.strikeBonus).toEqual({ hero: 2 });
    s = run(s, { type: 'declareHeroic', model: 'b', action: 'Heroic Defence' } as Action);
    s = run(s, { type: 'rolled', roll: { id: 'f-1-3', by: 'p1', label: 'hero strikes b', dice: [5], target: 6, against: 'b', at: 0, group: 'f-1', model: 'hero' } });
    expect(run(s, { type: 'useMight', roll: 'f-1-3', die: 0 }).models.hero.might).toBe(3);
  });
});

describe('a hero fighting a second time in a turn', () => {
  it("starts a fresh duel instead of showing the last fight's dice", () => {
    let s = toFight(at([mk('h', 'p1', 10, 10, { hero: true }), mk('o', 'p2', 10 + STEP, 10), mk('w', 'p2', 10, 15)]));
    s = { ...s, flow: { ...s.flow, heroics: [{ model: 'h', action: 'Heroic Combat', phase: 'fight', turn: s.turn }] as never } };
    const fighter = (id: string) => ({ id, name: id, f: 5, a: 2, s: 4, d: 6 });
    const first: FightRequest = { sides: [[fighter('h')], [fighter('o')]], targets: ['o', 'h'], trapped: false, combat: 'h,|,o' };
    s = ask(s, 'p1', { type: 'fight', fight: first }, [6, 6, 1, 1])!;
    const group = fightDuel(s, 'h,|,o')!.group;
    s = ask(s, 'p1', { type: 'strikes', fight: first, group }, [6, 6, 6, 6])!;
    if (!s.models.o.dead) s = run(s, { type: 'wound', id: 'o', count: 1 });
    expect(s.flow.resolved).toContain('h,|,o');
    // Free to move again, the hero charges a fresh enemy: a new fight, not yet rolled.
    s = run(s, { type: 'moveModels', moves: [{ id: 'h', x: 10, y: 15 - STEP }] });
    const next = combats(s).find(c => c.key === 'h,|,w')!;
    expect(next).toBeDefined();
    expect(fightDone(s, next)).toBe(false);
    // The fight panel and the computer see no duel rolled for it yet, so it can be rolled.
    expect(fightDuel(s, next.key)).toBeNull();
    expect(openDuel(s, next)).toBeNull();
    const second: FightRequest = { sides: [[fighter('h')], [fighter('w')]], targets: ['w', 'h'], trapped: false, combat: next.key };
    s = ask(s, 'p1', { type: 'fight', fight: second }, [6, 6, 1, 1])!;
    expect(fightDuel(s, next.key)!.group).not.toBe(group);
    // The first fight still shows its own dice.
    expect(fightDuel(s, 'h,|,o')!.group).toBe(group);
  });

  it("never matches a duel in another fight to this one's models", () => {
    // a fights b; c and d are in their own fight, and the duel between a and b is open.
    let s = toFight(at([mk('a', 'p1', 10, 10), mk('b', 'p2', 10 + STEP, 10), mk('c', 'p1', 30, 10), mk('d', 'p2', 30 + STEP, 10)]));
    const fighter = (id: string) => ({ id, name: id, f: 3, a: 1, s: 3, d: 4 });
    s = ask(s, 'p1', { type: 'fight', fight: { sides: [[fighter('a')], [fighter('b')]], targets: ['b', 'a'], trapped: false, combat: 'a,|,b' } }, [6, 1])!;
    expect(fightDuel(s, 'a,|,b')).not.toBeNull();
    // A fight that shares a model with the open duel but not the rest isn't that duel.
    expect(fightDuel(s, 'a,|,d')).toBeNull();
    expect(fightDuel(s, 'c,|,d')).toBeNull();
    // A fight's slain models still count as in it, so its dice stay with it.
    s = run(s, { type: 'wound', id: 'b', count: 1 });
    expect(fightDuel(s, 'a,|,b')).not.toBeNull();
  });
});
