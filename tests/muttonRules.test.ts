import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, radius } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { strikeWounds, type Fighter, type FightRequest } from '../src/shared/fight.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `r${n++}`;
const ask = (s: GameState, seat: Seat, a: Action, rolls: number[] = []) => {
  const seq = [...rolls];
  const out = resolveRequest(s, seat, a, () => seq.shift() ?? 1, uid, 1, catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : null;
};
const who = (s: GameState, key: string) => castModel(s, key)!;
const group = (s: GameState) => s.log.at(-1)!.group!;

/**
 * Roast Mutton on turn 3 with every Dwarf on the table, out of the way along the south edge, and the Trolls away from
 * each other; then `spots` puts the named models where they're wanted.
 */
function scene(spots: Record<string, [number, number]>, touching: Record<string, string> = {}, phase: 'priority' | 'move-start' | 'move' | 'shoot' | 'fight-start' | 'fight' = 'fight'): GameState {
  let s = ask(initialState(), 'p1', { type: 'setNarrative', id: 'roast-mutton', good: 'p1' })!;
  s = run(s, { type: 'startGame', at: 1 });
  let k = 0;
  const models = Object.fromEntries(
    Object.values(s.models).map(m => {
      const at = spots[m.cast!] ?? (m.owner === 'p1' ? [1 + 1.5 * k++, 23] : [3 + 7 * k++, 2]);
      return [m.id, { ...m, waiting: undefined, x: at[0], y: at[1] }];
    }),
  );
  s = { ...s, turn: 3, models };
  // Then each model in `touching` goes beside the one named, stacked down its west side.
  const stack: Record<string, number> = {};
  for (const [key, to] of Object.entries(touching)) {
    const m = who(s, key);
    const t = who(s, to);
    const k = (stack[to] = (stack[to] ?? -1) + 1);
    const dy = [0, 1, -1, 2, -2][k] * (radius(m) * 2 + 0.02);
    s = { ...s, models: { ...s.models, [m.id]: { ...m, ...xy(beside(t, m, dy)) } } };
  }
  if (phase === 'priority') return s;
  s = run(s, { type: 'choosePriority', seat: 'p1' });
  if (phase === 'move-start') return s;
  const pass = (st: GameState) => run(st, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  s = pass(s);
  if (phase === 'move') return s;
  s = run(s, { type: 'setPhase', phase: phase === 'shoot' ? 'shoot' : 'fight' });
  return phase === 'fight-start' ? s : pass(s);
}
const xy = ([x, y]: [number, number]) => ({ x, y });
/** Where to stand `m` so it touches `t`, to the west of it. */
const beside = (t: Model, m: Model, dy = 0): [number, number] => {
  const gap = radius(t) + radius(m);
  return [t.x - Math.sqrt(Math.max(0, gap * gap - dy * dy)), t.y + dy];
};
const fx = (m: Model): Fighter => ({ id: m.id, name: m.name, f: 3, a: 1, s: 3, d: 4 });
const fight = (a: Model[], b: Model[], extra: Partial<FightRequest> = {}): FightRequest => ({ sides: [a.map(fx), b.map(fx)], targets: [b[0].id, a[0].id], trapped: false, ...extra });

describe('Roast Mutton: the Trolls', () => {
  it("lets Bill mince a foe: D6 + Strength each, the difference in Wounds", () => {
    let s = scene({ bill: [12, 12] }, { dwalin: 'bill' });
    const [bill, dwalin] = [who(s, 'bill'), who(s, 'dwalin')];
    const req = fight([dwalin], [bill], { brutal: { by: bill.id, kind: 'mince', target: dwalin.id } });
    // Dwalin's dice, then Bill's: Bill wins.
    s = ask(s, 'p1', { type: 'fight', fight: req }, [1, 1, 1, 6, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [6, 2])!;
    const mince = s.log.find(r => r.label.startsWith("Mince 'em Fine"))!;
    expect(mince.dice).toEqual([6, 2]);
    // Bill is S7 and Dwalin S5: 13 v 7.
    expect(mince.label).toContain('13 v Dwalin the Dwarf 7');
    expect(strikeWounds([mince])).toBe(6);
    expect(s.log.some(r => r.model === bill.id && r.label.includes('strikes'))).toBe(false);
  });
});

describe('Roast Mutton: more of the Trolls', () => {
  it("lets Heroic Defence turn Bill's knife unless his die is a natural 6", () => {
    let s = scene({ bill: [12, 12] }, { balin: 'bill' });
    const [bill, balin] = [who(s, 'bill'), who(s, 'balin')];
    s = { ...s, flow: { ...s.flow, heroics: [...s.flow.heroics, { model: balin.id, action: 'Heroic Defence', phase: 'fight' }] } };
    const req = fight([balin], [bill], { brutal: { by: bill.id, kind: 'mince', target: balin.id } });
    const duel = ask(s, 'p1', { type: 'fight', fight: req }, [1, 6, 1, 1])!;
    const held = ask(duel, 'p1', { type: 'strikes', fight: req, group: group(duel) }, [5, 1])!;
    expect(strikeWounds(held.log.filter(r => r.label.startsWith('Mince')))).toBe(0);
    const cut = ask(duel, 'p1', { type: 'strikes', fight: req, group: group(duel) }, [6, 1])!;
    expect(strikeWounds(cut.log.filter(r => r.label.startsWith('Mince')))).toBe(8);
  });

  it('lets Tom squash every foe touching him: a Strength 6 hit each, and the survivors go down', () => {
    let s = scene({ tom: [12, 12] }, { bombur: 'tom', bifur: 'tom' });
    const [tom, bombur, bifur] = [who(s, 'tom'), who(s, 'bombur'), who(s, 'bifur')];
    const req = fight([bombur, bifur], [tom], { brutal: { by: tom.id, kind: 'squash' } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [1, 1, 1, 1, 6, 1, 1])!;
    // Neither is wounded.
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [1, 1])!;
    const hits = s.log.filter(r => r.label.startsWith("Squash 'em"));
    expect(hits.map(r => r.against).sort()).toEqual([bombur.id, bifur.id].sort());
    expect(hits.every(r => r.dice.length === 1)).toBe(true);
    expect(s.models[bombur.id].prone).toBe(true);
    expect(s.models[bifur.id].prone).toBe(true);
    expect(s.log.some(r => r.model === tom.id && r.label.includes(' strikes '))).toBe(false);
  });

  it('lets Bert, by the fire, carry a foe to it and set it ablaze', () => {
    const fire = Object.values(scene({}).terrain).find(t => t.object === 'campfire')!;
    let s = scene({ bert: [fire.x + fire.w / 2 + 3, fire.y] }, { ori: 'bert' });
    const [bert, ori] = [who(s, 'bert'), who(s, 'ori')];
    const req = fight([ori], [bert], { brutal: { by: bert.id, kind: 'roast', target: ori.id } });
    s = ask(s, 'p1', { type: 'fight', fight: req }, [1, 6, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [])!;
    const o = s.models[ori.id];
    expect(o.ablaze).toBe(true);
    expect(Math.hypot(o.x - fire.x, o.y - fire.y) - fire.w / 2 - radius(o)).toBeLessThan(0.1);
  });

  it('lets a Troll stuff a foe in a sack instead of striking: Paralysed, until a 6 in the End phase', async () => {
    const { recoveryRolls } = await import('../src/shared/powers.ts');
    let s = scene({ bill: [12, 12] }, { ori: 'bill' });
    const [bill, ori] = [who(s, 'bill'), who(s, 'ori')];
    s = run(s, { type: 'fightChoice', id: bill.id, sack: ori.id });
    const req = fight([ori], [bill]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [1, 6, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [])!;
    expect(s.models[ori.id].prone).toBe(true);
    expect(s.models[ori.id].effects?.some(e => e.sack && e.power === 'Paralyse')).toBe(true);
    expect(s.log.some(r => r.model === bill.id && r.label.includes(' strikes '))).toBe(false);
    // Bill falling doesn't let him out.
    s = { ...s, models: { ...s.models, [bill.id]: { ...s.models[bill.id], dead: true, will: 0 } } };
    const { under } = await import('../src/shared/powers.ts');
    expect(under(s, s.models[ori.id], 'Paralyse')).toBe(true);
    // A 6 in the End phase lets him out.
    const end = { ...s, phase: 'end' as const };
    const out = run(end, ...recoveryRolls(end, () => 6, uid));
    expect(out.models[ori.id].effects?.some(e => e.sack)).toBeFalsy();
  });

  it('only bags a model on a 25mm base', async () => {
    const { fitsSack } = await import('../src/shared/trolls.ts');
    const s = scene({});
    expect(fitsSack(who(s, 'bombur'))).toBe(true);
    expect(fitsSack(who(s, 'tom'))).toBe(false);
  });

  it("lets Bofur's Steadfast shrug off the sack on a 3+", () => {
    let s = scene({ bill: [12, 12] }, { ori: 'bill', bofur: 'bill' });
    const [bill, ori, bofur] = [who(s, 'bill'), who(s, 'ori'), who(s, 'bofur')];
    s = run(s, { type: 'fightChoice', id: bill.id, sack: ori.id });
    const req = fight([ori, bofur], [bill]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [1, 1, 1, 6, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [3])!;
    expect(s.log.find(r => r.label.startsWith('Steadfast'))?.dice).toEqual([3]);
    expect(s.models[ori.id].effects?.some(e => e.sack)).toBeFalsy();
  });

  it("lets Tom sneeze on a foe as the fight starts: a Will point, and its Fight is halved (rounding up) for the turn", () => {
    let s = scene({ tom: [12, 12] }, { dwalin: 'tom' });
    const [tom, dwalin] = [who(s, 'tom'), who(s, 'dwalin')];
    s = run(s, { type: 'fightChoice', id: tom.id, cold: dwalin.id });
    const req = fight([dwalin], [tom]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 6, 6, 6, 6])!;
    expect(s.models[tom.id].will).toBe(who(scene({}), 'tom').will - 1);
    expect(s.models[dwalin.id].chilled).toBe(3);
    // Dwalin's F6 is now 3.
    expect(s.log.find(r => r.side === 0)?.f).toBe(3);
  });
});

describe('Roast Mutton: the Company in a fight', () => {
  const adjusted = async (s: GameState, a: Model[], b: Model[]) => {
    const { adjustFight, prepareFight } = await import('../src/shared/resolve.ts');
    const req = prepareFight(s, catalog, fight(a, b), []) ?? fight(a, b);
    return adjustFight(s, req, catalog);
  };

  it("re-rolls 1s to wound for Thorin and the Company within 6\" of him", async () => {
    const s = scene({ thorin: [12, 18], dwalin: [12, 12], bill: [12, 10.5], fili: [20, 18], bert: [20, 16.5] }, {});
    expect((await adjusted(s, [who(s, 'dwalin')], [who(s, 'bill')])).sides[0][0].ones).toBe(true);
    const far = { ...s, models: { ...s.models, [who(s, 'thorin').id]: { ...who(s, 'thorin'), x: 2, y: 18 } } };
    expect((await adjusted(far, [who(far, 'dwalin')], [who(far, 'bill')])).sides[0][0].ones).toBeFalsy();
    expect((await adjusted(s, [who(s, 'thorin')], [who(s, 'bill')])).sides[0][0].ones).toBe(true);
  });

  it('gives Dori 3 Attacks and re-rolled 1s in the duel with Ori or Nori within 3"', async () => {
    const s = scene({ bill: [12, 12], ori: [8, 12] }, { dori: 'bill' });
    const f = (await adjusted(s, [who(s, 'dori')], [who(s, 'bill')])).sides[0][0];
    expect(f).toMatchObject({ a: 3, duelOnes: true });
    const alone = scene({ bill: [12, 12] }, { dori: 'bill' });
    expect((await adjusted(alone, [who(alone, 'dori')], [who(alone, 'bill')])).sides[0][0].a).toBe(2);
  });

  it('gives Glóin 4 Attacks when he fights two or more on his own', async () => {
    const s = scene({ bill: [12, 10], bert: [12, 14.5] }, { gloin: 'bill' });
    const g = who(s, 'gloin');
    expect((await adjusted(s, [g], [who(s, 'bill')])).sides[0][0].a).toBe(3);
    expect((await adjusted(s, [g], [who(s, 'bill'), who(s, 'bert')])).sides[0][0].a).toBe(4);
    expect((await adjusted(s, [g, who(s, 'dori')], [who(s, 'bill'), who(s, 'bert')])).sides[0][0].a).toBe(3);
  });

  it("gives Dwalin with Grasper & Keeper +1 Attack and 6s that do 2 Wounds, but not swinging the two-handed weapon", async () => {
    const { fighterOf } = await import('../src/shared/wargear.ts');
    const s = scene({});
    const d = who(s, 'dwalin');
    expect(fighterOf(s, catalog, d)).toMatchObject({ a: 3, sixes: true });
    const two = fighterOf(s, catalog, d, { twoHanded: true });
    expect(two.a).toBe(2);
    expect(two.sixes).toBeFalsy();
  });

  it('never leaves Dwalin or Nori Unarmed', async () => {
    const { isUnarmed } = await import('../src/shared/wargear.ts');
    const s = scene({});
    for (const k of ['dwalin', 'nori']) expect(isUnarmed(catalog, { ...who(s, k), lostGear: ['hand weapon', 'two-handed weapon', 'Grasper & Keeper'] })).toBe(false);
    expect(isUnarmed(catalog, { ...who(s, 'bombur'), lostGear: ['hand weapon'] })).toBe(true);
  });
});

describe("Roast Mutton: the Company's wargear", () => {
  it('lets Thorin, Shielding with the Oakenshield and winning, hit one foe at Strength 4', () => {
    let s = scene({ bill: [12, 12] }, { thorin: 'bill' });
    const [bill, thorin] = [who(s, 'bill'), who(s, 'thorin')];
    s = run(s, { type: 'fightChoice', id: thorin.id, shielding: true });
    const req = fight([thorin], [bill]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 1, 1, 1, 1, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [6])!;
    const oak = s.log.find(r => r.label.startsWith('The Oakenshield'))!;
    expect(oak).toMatchObject({ against: bill.id, dice: [6] });
    expect(s.log.filter(r => r.model === thorin.id && r.against && r !== oak)).toHaveLength(0);
  });

  it("lets Bofur's Mattock knock a foe down instead of striking: D6 + Strength each, and it's then trapped", () => {
    let s = scene({ bert: [12, 12] }, { bofur: 'bert', dwalin: 'bert' });
    const [bert, bofur, dwalin] = [who(s, 'bert'), who(s, 'bofur'), who(s, 'dwalin')];
    s = run(s, { type: 'fightChoice', id: bofur.id, knock: bert.id });
    const req = fight([bofur, dwalin], [bert]);
    // Bofur's two dice, Dwalin's three, then Bert's three.
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 1, 1, 1, 1, 1])!;
    // Bofur 6 + 4 against Bert 3 + 7; then Dwalin's three strikes, doubled for a trapped foe.
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [6, 3, 1, 1, 1, 1, 1, 1])!;
    expect(s.log.find(r => r.label.startsWith('Mattock'))?.label).toContain('10 v 10');
    expect(s.models[bert.id].prone).toBe(true);
    expect(s.log.find(r => r.model === dwalin.id && r.against === bert.id)?.dice).toHaveLength(6);
    expect(s.log.some(r => r.model === bofur.id && r.against)).toBe(false);
  });

  it("lets Bifur headbutt a foe (one Strength 4 Strike); a wound frees the axe, and then he may test for a free Heroic Move", () => {
    let s = scene({ tom: [12, 12] }, { bifur: 'tom' });
    const [tom, bifur] = [who(s, 'tom'), who(s, 'bifur')];
    s = run(s, { type: 'fightChoice', id: bifur.id, headbutt: tom.id });
    const req = fight([bifur], [tom]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [5])!;
    const butt = s.log.find(r => r.label.includes('headbutts'))!;
    expect(butt.dice).toEqual([5]);
    expect(s.models[bifur.id].used).toContain('Embedded Axe');
    // Next turn, as the Move phase starts: 2D6 against his Intelligence of 7.
    let next: GameState = { ...s, turn: 4, phase: 'move', flow: { ...s.flow, heroics: [], passed: [], done: [], resolved: [], duels: [], starts: {}, usedTurn: [], freeMove: [] } };
    expect(ask(next, 'p1', { type: 'axeTest', model: bifur.id }, [3, 3])!.flow.freeMove ?? []).not.toContain(bifur.id);
    next = ask(next, 'p1', { type: 'axeTest', model: bifur.id }, [3, 4])!;
    expect(next.flow.freeMove).toContain(bifur.id);
    expect(ask(next, 'p1', { type: 'axeTest', model: bifur.id }, [6, 6])).toBeNull();
    next = run(next, { type: 'declareHeroic', model: bifur.id, action: 'Heroic Move' });
    expect(next.flow.heroics.find(h => h.model === bifur.id)).toMatchObject({ action: 'Heroic Move', free: true });
    expect(next.models[bifur.id].might).toBe(s.models[bifur.id].might);
  });

  it("doesn't free the axe if the headbutt doesn't wound", () => {
    let s = scene({ tom: [12, 12] }, { bifur: 'tom' });
    const [tom, bifur] = [who(s, 'tom'), who(s, 'bifur')];
    s = run(s, { type: 'fightChoice', id: bifur.id, headbutt: tom.id });
    const req = fight([bifur], [tom]);
    s = ask(s, 'p1', { type: 'fight', fight: req }, [6, 1, 1, 1, 1])!;
    s = ask(s, 'p1', { type: 'strikes', fight: req, group: group(s) }, [4])!;
    expect(s.models[bifur.id].used ?? []).not.toContain('Embedded Axe');
  });
});

describe("Roast Mutton: the Company's once-a-turn abilities", () => {
  it("lets Balin spend a Will point to have his side's roll for Priority made again", async () => {
    const { longbeardFor } = await import('../src/shared/company.ts');
    let s = scene({}, {}, 'priority');
    s = ask(s, 'p2', { type: 'rollPriority' }, [2, 5])!;
    expect(s.flow.chooser).toBe('p2');
    const balin = who(s, 'balin');
    expect(longbeardFor(s, catalog, 'p1')?.id).toBe(balin.id);
    expect(ask(s, 'p2', { type: 'longbeard', model: balin.id }, [6])).toBeNull();
    s = ask(s, 'p1', { type: 'longbeard', model: balin.id }, [6])!;
    expect(s.flow.chooser).toBe('p1');
    expect(s.models[balin.id].will).toBe(balin.will - 1);
    expect(longbeardFor(s, catalog, 'p1')).toBeUndefined();
  });

  it('lets Kíli and Fíli swap places as a phase starts, and then each re-roll a die in his duels that turn', () => {
    let s = scene({ kili: [12, 12], fili: [12, 13] }, {}, 'fight-start');
    const [kili, fili] = [who(s, 'kili'), who(s, 'fili')];
    s = ask(s, 'p1', { type: 'swap', a: kili.id, b: fili.id })!;
    expect(s.models[kili.id]).toMatchObject({ x: 12, y: 13 });
    expect(s.models[fili.id]).toMatchObject({ x: 12, y: 12 });
    expect(s.flow.synergy).toBe(3);
    expect(ask(s, 'p1', { type: 'swap', a: kili.id, b: fili.id })).toBeNull();
    // Into a fight with Bill.
    const bill = who(s, 'bill');
    s = { ...s, models: { ...s.models, [bill.id]: { ...bill, ...xy(beside(s.models[kili.id], bill)) } } };
    s = run(s, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    s = ask(s, 'p1', { type: 'fight', fight: fight([s.models[kili.id]], [bill]) }, [1, 1, 6, 1, 1])!;
    const mine = s.log.find(r => r.side === 0)!;
    s = ask(s, 'p1', { type: 'reroll', roll: mine.id, die: 0, why: 'synergy', model: kili.id }, [6])!;
    expect(s.log.find(r => r.id === mine.id)?.dice).toEqual([6, 1]);
    expect(ask(s, 'p1', { type: 'reroll', roll: mine.id, die: 1, why: 'synergy', model: kili.id }, [6])).toBeNull();
  });

  it("lets Óin spend Will to re-roll a die of a friend's duel within 6\"", () => {
    let s = scene({ bill: [12, 12], oin: [8, 14] }, { dwalin: 'bill' });
    const [bill, dwalin, oin] = [who(s, 'bill'), who(s, 'dwalin'), who(s, 'oin')];
    s = ask(s, 'p1', { type: 'fight', fight: fight([dwalin], [bill]) }, [1, 1, 1, 6, 1, 1])!;
    const mine = s.log.find(r => r.side === 0)!;
    s = ask(s, 'p1', { type: 'reroll', roll: mine.id, die: 2, why: 'portents', model: oin.id }, [6])!;
    expect(s.log.find(r => r.id === mine.id)?.dice).toEqual([1, 1, 6]);
    expect(s.models[oin.id].will).toBe(oin.will - 1);
    const far = { ...s, models: { ...s.models, [oin.id]: { ...s.models[oin.id], x: 2, y: 22 } } };
    expect(ask(far, 'p1', { type: 'reroll', roll: mine.id, die: 0, why: 'portents', model: oin.id }, [6])).toBeNull();
  });

  it("lets Óin's herbs heal a Wound of a friend touching him on a 4+, once a turn in his activation", () => {
    let s = scene({ dwalin: [12, 12] }, { oin: 'dwalin' }, 'move');
    const [dwalin, oin] = [who(s, 'dwalin'), who(s, 'oin')];
    s = { ...s, models: { ...s.models, [dwalin.id]: { ...dwalin, wounds: 1 } } };
    s = ask(s, 'p1', { type: 'tend', how: 'herbs', model: oin.id, target: dwalin.id }, [4])!;
    expect(s.models[dwalin.id].wounds).toBe(2);
    s = { ...s, models: { ...s.models, [dwalin.id]: { ...s.models[dwalin.id], wounds: 1 } } };
    expect(ask(s, 'p1', { type: 'tend', how: 'herbs', model: oin.id, target: dwalin.id }, [6])).toBeNull();
    // Not in the Fight phase.
    const later = scene({ dwalin: [12, 12] }, { oin: 'dwalin' }, 'fight');
    const hurt = { ...later, models: { ...later.models, [who(later, 'dwalin').id]: { ...who(later, 'dwalin'), wounds: 1 } } };
    expect(ask(hurt, 'p1', { type: 'tend', how: 'herbs', model: who(hurt, 'oin').id, target: who(hurt, 'dwalin').id }, [6])).toBeNull();
  });

  it('lets Bombur give a friend within 3" (or himself) back a spent Will point on a 4+', () => {
    let s = scene({ bombur: [12, 12], dori: [14, 12] }, {}, 'move');
    const [bombur, dori] = [who(s, 'bombur'), who(s, 'dori')];
    s = { ...s, models: { ...s.models, [dori.id]: { ...dori, will: 0 }, [bombur.id]: { ...bombur, will: 0 } } };
    expect(ask(s, 'p1', { type: 'tend', how: 'spirits', model: bombur.id, target: dori.id }, [3])!.models[dori.id].will).toBe(0);
    expect(ask(s, 'p1', { type: 'tend', how: 'spirits', model: bombur.id, target: dori.id }, [4])!.models[dori.id].will).toBe(1);
    expect(ask(s, 'p1', { type: 'tend', how: 'spirits', model: bombur.id, target: bombur.id }, [4])!.models[bombur.id].will).toBe(1);
    // Not on a friend who has spent none.
    expect(ask(s, 'p1', { type: 'tend', how: 'spirits', model: bombur.id, target: who(s, 'thorin').id }, [4])).toBeNull();
  });

  it("lets Óin hear an enemy hero's heroic action within 6\": a 5+ calls it too for nothing, a 1 costs a Will point", async () => {
    const { trumpetDue } = await import('../src/shared/company.ts');
    const { heroicsSettled } = await import('../src/shared/heroics.ts');
    let s = scene({ bill: [12, 12], oin: [8, 12] }, {}, 'fight-start');
    const [bill, oin] = [who(s, 'bill'), who(s, 'oin')];
    s = { ...s, models: { ...s.models, [bill.id]: { ...bill, might: 1 } } };
    s = run(s, { type: 'declareHeroic', model: bill.id, action: 'Heroic Strike' }, { type: 'passHeroic', seat: 'p2' }, { type: 'passHeroic', seat: 'p1' });
    expect(trumpetDue(s, catalog)?.oin.id).toBe(oin.id);
    s = run(s, { type: 'listen', key: trumpetDue(s, catalog)!.key });
    expect(heroicsSettled(s)).toBe(false);
    const heard = ask(s, 'p1', { type: 'trumpet', listen: true }, [5])!;
    expect(heard.flow.heroics.find(h => h.model === oin.id)).toMatchObject({ action: 'Heroic Strike', free: true });
    expect(trumpetDue(heard, catalog)).toBeNull();
    const fumbled = ask(s, 'p1', { type: 'trumpet', listen: true }, [1])!;
    expect(fumbled.models[oin.id].will).toBe(oin.will - 1);
    const deaf = { ...s, models: { ...s.models, [oin.id]: { ...oin, will: 0 } } };
    expect(ask(deaf, 'p1', { type: 'trumpet', listen: true }, [1])!.models[oin.id].noMove).toBe(3);
    // Too far away to hear it.
    const far = { ...s, models: { ...s.models, [oin.id]: { ...oin, x: 2, y: 2 } } };
    expect(trumpetDue(far, catalog)).toBeNull();
  });
});

describe('Roast Mutton: Ori, Bombur and Thorin', () => {
  it("lets a friend near Ori who slays a Troll take back a point it has spent, its player's pick", async () => {
    const { chronicled } = await import('../src/shared/company.ts');
    const { isMonster } = await import('../src/shared/monsters.ts');
    const before = scene({ bill: [12, 12], ori: [8, 16] }, { dwalin: 'bill' });
    const [bill, dwalin, ori] = [who(before, 'bill'), who(before, 'dwalin'), who(before, 'ori')];
    const big = (m: Model) => isMonster(catalog, m);
    const spent = { ...before, models: { ...before.models, [dwalin.id]: { ...dwalin, might: 0, will: 0 } } };
    const slay = (st: GameState) => ({ ...st, models: { ...st.models, [bill.id]: { ...bill, dead: true, wounds: 0, killedBy: { ids: [dwalin.id], how: 'fight' as const } } } });
    expect(chronicled(spent, slay(spent), catalog, big)).toEqual([{ seat: 'p1', ids: [dwalin.id] }]);
    // His player picks the Will point, or lets it go.
    let s = run(slay(spent), { type: 'chronicle', add: chronicled(spent, slay(spent), catalog, big) });
    expect(ask(s, 'p2', { type: 'chronicled', model: dwalin.id, point: 'will' })).toBeNull();
    expect(ask(s, 'p1', { type: 'chronicled', model: dwalin.id, point: 'fate' })).toBeNull();
    s = ask(s, 'p1', { type: 'chronicled', model: dwalin.id, point: 'will' })!;
    expect(s.models[dwalin.id]).toMatchObject({ will: 1, might: 0 });
    expect(s.flow.chronicles).toBeUndefined();
    expect(ask(s, 'p1', { type: 'chronicled', model: dwalin.id, point: 'might' })).toBeNull();
    // With nothing spent, another friend near Ori may have it.
    const tired = { ...before, models: { ...before.models, [ori.id]: { ...ori, will: 0 } } };
    expect(chronicled(tired, slay(tired), catalog, big)).toEqual([{ seat: 'p1', ids: [ori.id] }]);
    // Too far from Ori, nothing.
    const far = (st: GameState) => ({ ...st, models: { ...st.models, [ori.id]: { ...st.models[ori.id], x: 2, y: 22 } } });
    expect(chronicled(far(spent), far(slay(spent)), catalog, big)).toEqual([]);
  });

  it('lets a natural 6 from Ori\'s sling wound without an In the Way test or a roll To Wound', () => {
    let s = scene({ ori: [6, 12], tom: [12, 12] }, {}, 'shoot');
    const [ori, tom] = [who(s, 'ori'), who(s, 'tom')];
    const shot = { type: 'shoot', shot: { shooter: { id: ori.id, name: ori.name, weapon: 'Sling', shoot: 3, s: 1, shots: 1 }, target: { id: tom.id, name: tom.name, d: 6 }, obstacles: 0 } } as Action;
    s = ask(s, 'p1', shot, [6])!;
    expect(strikeWounds(s.log.filter(r => r.against === tom.id))).toBe(1);
    expect(s.log.filter(r => r.label.startsWith('In the Way'))).toHaveLength(0);
  });

  it('lets a shot at a Troll (a Large Target) see over the models in the way, but not over another monster', async () => {
    const { planShot } = await import('../src/shared/shooting.ts');
    const s = scene({ kili: [4, 12], dori: [8, 12], tom: [16, 12] }, {}, 'shoot');
    expect(planShot(s, catalog, who(s, 'kili'), who(s, 'tom')).inWay.filter(o => o.model)).toHaveLength(0);
    const t = scene({ kili: [4, 12], bert: [9, 12], tom: [16, 12] }, {}, 'shoot');
    expect(planShot(t, catalog, who(t, 'kili'), who(t, 'tom')).inWay.map(o => o.model)).toContain(who(t, 'bert').id);
  });

  it('keeps Bombur from Heroic Moves, and has him roll a 6 to jump or climb again', async () => {
    const { mayDeclare } = await import('../src/shared/heroics.ts');
    const { rulesFor } = await import('../src/shared/catalog.ts');
    const { terrainRules } = await import('../src/shared/wargear.ts');
    const s = scene({}, {}, 'move-start');
    const bombur = who(s, 'bombur');
    expect(terrainRules(catalog, bombur)).toContain('lumbering');
    expect(mayDeclare(s, { ...bombur, might: 1 }, 'Heroic Move', undefined, rulesFor(catalog, bombur))).toBe(false);
    expect(mayDeclare(s, { ...who(s, 'dori'), might: 1 }, 'Heroic Move', undefined, rulesFor(catalog, who(s, 'dori')))).toBe(true);
  });

  it("lets Thorin's Stand Fast! steady the heroes of the Company too", async () => {
    const { brokenTests } = await import('../src/shared/courage.ts');
    const s = scene({ thorin: [12, 12], balin: [14, 12], dori: [16, 12] }, {}, 'move');
    const out = brokenTests(s, 'p1', catalog, () => 6, uid);
    const taken = out.flatMap(a => (a.type === 'rolled' && a.roll.label.startsWith('Courage test') ? [a.roll.model ?? a.roll.label] : []));
    const results = (out.find(a => a.type === 'courageTaken') as Extract<Action, { type: 'courageTaken' }>).results;
    expect(results[who(s, 'balin').id]).toBe(true);
    expect(results[who(s, 'dori').id]).toBe(true);
    expect(taken.some(x => x.includes?.('Balin') || x === who(s, 'balin').id)).toBe(false);
  });
});

describe('Roast Mutton: the profiles in play', () => {
  it('throws the right stones, and keeps Thorin and Bilbo without the gear the scenario takes away', async () => {
    const { stones } = await import('../src/shared/wargear.ts');
    const { rulesFor } = await import('../src/shared/catalog.ts');
    const { isMonster } = await import('../src/shared/monsters.ts');
    const s = scene({});
    for (const k of ['bill', 'bert', 'tom']) {
      expect(stones(catalog, who(s, k))).toMatchObject({ range: 12, s: 8 });
      expect(isMonster(catalog, who(s, k))).toBe(true);
    }
    expect(stones(catalog, who(s, 'bifur'))).toMatchObject({ range: 8, s: 2 });
    expect(isMonster(catalog, who(s, 'bombur'))).toBe(false);
    expect(rulesFor(catalog, who(s, 'thorin'))).not.toContain('Orcrist');
    expect(rulesFor(catalog, who(s, 'thorin'))).toContain('The Oakenshield');
    expect(rulesFor(catalog, who(s, 'bilbo')).some(r => /sting|one ring/i.test(r))).toBe(false);
    expect(rulesFor(catalog, who(s, 'bifur'))).toContain('Embedded Axe');
  });
});
