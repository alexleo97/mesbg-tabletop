import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, holdNarrative, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { limitMove, moveAllowance } from '../src/shared/movement.ts';
import { crossingAhead, crossBlocked } from '../src/shared/terrainTests.ts';
import { hasRule, isUnarmed } from '../src/shared/wargear.ts';
import { canEscape, exitEdges } from '../src/shared/objects.ts';
import { canDeclare } from '../src/shared/heroics.ts';
import { supporters } from '../src/shared/support.ts';
import { shrugOff } from '../src/shared/towers.ts';
import { planShot } from '../src/shared/shooting.ts';
import { walkDistance } from '../src/shared/lakeNav.ts';
import { inChasm } from '../src/shared/sight.ts';
import {
  edgeSpot,
  escapeEdge,
  fallen,
  gandalfArrives,
  gandalfDue,
  goblinWinner,
  hordeArrives,
  hordeDue,
  isDwarf,
  maySwapWith,
  mouths,
  noFooting,
  relentlessDue,
  relentlessHits,
  slainWarriors,
  swapCandidates,
  weaponPile,
} from '../src/shared/goblin.ts';
import { BOARD, GOBLIN_GAP, MIDDLE, WEAPON_PILE } from '../src/shared/goblinMap.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const dwarves = (s: GameState) => Object.values(s.models).filter(isDwarf);
const goblins = (s: GameState) => Object.values(s.models).filter(m => m.cast === 'goblin');
const evil = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p2');
const piece = (s: GameState, id: string) => s.terrain[`n-${id}`];

/** Escape from Goblin-town set up as the server would, with the Good side on `good`. */
function setup(good: Seat = 'p1'): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'escape-from-goblin-town', good } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Both sides set up (the Good side first), the escape edge `exit`, the battle started. */
function begun(exit = 'west'): GameState {
  const s = run(setup(), { type: 'warbandDone', seat: 'p1' }, { type: 'setPick', seat: 'p2', key: 'exit', value: exit }, { type: 'warbandDone', seat: 'p2' });
  return run(s, { type: 'startGame', at: 1 });
}

/** A side's Move phase in `turn`, `seat` having Priority. */
const moveFor = (s: GameState, turn = 1, seat: Seat = 'p1'): GameState => {
  const out = run({ ...s, turn: 1, phase: 'priority', flow: { ...s.flow, done: [] } }, { type: 'choosePriority', seat }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  return { ...out, turn };
};

describe('Escape from Goblin-town: the table and the cast', () => {
  it("a 4' by 4' cavern: walkways over a chasm, crags, cavern walls, the throne and the weapon pile", () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: BOARD, h: BOARD });
    expect(piece(s, 'chasm')).toMatchObject({ kind: 'water', deep: true, look: 'chasm' });
    expect(Object.values(s.terrain).filter(t => t.look === 'gobplanks').length).toBeGreaterThan(50);
    expect(Object.values(s.terrain).filter(t => t.look === 'rungs').length).toBe(3);
    expect(Object.values(s.terrain).filter(t => t.look === 'crag').length).toBe(11);
    expect(Object.values(s.terrain).filter(t => t.look === 'cavewall').every(t => t.sheer && t.kind === 'cliff')).toBe(true);
    expect(piece(s, 'throne')).toMatchObject({ kind: 'building', sheer: true });
    expect(weaponPile(s)).toMatchObject({ x: WEAPON_PILE.x, y: WEAPON_PILE.y });
  });

  it('the cast: Thorin and twelve Dwarves, Gandalf kept aside; the Goblin King, Grinnah and 30 Goblin Warriors', () => {
    const s = setup();
    expect(dwarves(s).length).toBe(13);
    expect(castModel(s, 'thorin')?.options).toEqual(expect.arrayContaining(['Orcrist', 'The Oakenshield']));
    expect(castModel(s, 'gandalf')?.waiting).toBe(true);
    expect(castModel(s, 'goblin-king')).toBeTruthy();
    expect(castModel(s, 'grinnah')).toBeTruthy();
    expect(goblins(s).length).toBe(30);
  });

  it('the Dwarves start wholly within 3" of the middle, every Goblin at least 3" from them, everyone on the planks', () => {
    const s = setup();
    for (const d of dwarves(s)) expect(Math.hypot(d.x - MIDDLE.x, d.y - MIDDLE.y) + 0.5).toBeLessThanOrEqual(3.01);
    for (const g of evil(s)) {
      expect(noFooting(s, g), g.name).toBe(false);
      if (g.cast !== 'goblin-king') for (const d of dwarves(s)) expect(distanceBetween(g, d)).toBeGreaterThanOrEqual(GOBLIN_GAP - 0.01);
    }
  });

  it('the walkways join up: from the middle there is a way to every edge but the north-east wall', () => {
    const s = setup();
    for (const edge of ['north', 'east', 'south', 'west'] as const) {
      const ways = mouths(s, edge);
      expect(ways.length, edge).toBeGreaterThan(0);
      const [a, b] = ways[0];
      const t = (a + b) / 2;
      const p = edge === 'north' ? { x: t, y: 0.5 } : edge === 'south' ? { x: t, y: BOARD - 0.5 } : edge === 'west' ? { x: 0.5, y: t } : { x: BOARD - 0.5, y: t };
      expect(walkDistance(s, MIDDLE, p), edge).toBeLessThan(Infinity);
    }
  });

  it('the Dwarves start without their weapons (Dwalin and Nori, Weapon Masters, keep theirs); armour and shields stay', () => {
    const s = setup();
    const thorin = castModel(s, 'thorin')!;
    expect(thorin.lostGear).toEqual(expect.arrayContaining(['orcrist']));
    expect(thorin.lostGear).not.toContain('the oakenshield');
    expect(isUnarmed(catalog, thorin)).toBe(true);
    expect(castModel(s, 'kili')!.lostGear).toEqual(expect.arrayContaining(['dwarf bow']));
    expect(castModel(s, 'dwalin')!.lostGear).toBeUndefined();
    expect(castModel(s, 'nori')!.lostGear).toBeUndefined();
  });

  it('nobody sets up over the chasm', () => {
    const s = setup();
    const g = goblins(s)[0];
    const out = holdNarrative(s, { id: g.id, x: 30, y: 46 });
    expect(inChasm(s, { x: 30, y: 46 })).toBe(true);
    expect(out).toMatchObject({ x: g.x, y: g.y });
  });
});

describe('Escape from Goblin-town: the escape edge', () => {
  it('the Evil player names it before finishing their set-up', () => {
    let s = run(setup(), { type: 'warbandDone', seat: 'p1' }, { type: 'warbandDone', seat: 'p2' });
    expect(s.flow.deploy?.placed).not.toContain('p2:*');
    s = run(s, { type: 'setPick', seat: 'p1', key: 'exit', value: 'east' });
    expect(escapeEdge(s)).toBeUndefined();
    s = run(s, { type: 'setPick', seat: 'p2', key: 'exit', value: 'east' }, { type: 'warbandDone', seat: 'p2' });
    expect(escapeEdge(s)).toBe('east');
    expect(s.flow.deploy?.placed).toContain('p2:*');
  });

  it('only Good models leave the table, and only by it', () => {
    const s = begun('west');
    const balin = castModel(s, 'balin')!;
    expect(exitEdges(s, balin)).toEqual(['left']);
    expect(exitEdges(s, goblins(s)[0])).toEqual([]);
    const at = put(s, balin, { x: 0.5, y: 15 });
    expect(canEscape(at, at.models[balin.id])).toBe(true);
    const out = run(at, { type: 'escape', model: balin.id });
    expect(out.models[balin.id].escaped).toBe(true);
  });
});

describe('Escape from Goblin-town: the chasm', () => {
  it('a gap no wider than twice a model\'s height is leapt; a wider one can\'t be crossed at all', () => {
    const s = moveFor(begun());
    const ori = castModel(s, 'ori')!;
    // Off the south end of the great platform (y 33.4), towards the gatehouse platform (from y 33.6).
    const near = put(s, ori, { x: 26, y: 32.9 });
    const leap = crossingAhead(near, near.models[ori.id], { x: 26, y: 32.9 }, { x: 26, y: 35 });
    expect(leap?.test ?? 'none').not.toBe('Swim');
    // West off the great platform (x 20.8), to stop out over the gap.
    const edge = put(s, ori, { x: 21.3, y: 26 });
    const c = crossingAhead(edge, edge.models[ori.id], { x: 21.3, y: 26 }, { x: 20.3, y: 26 });
    expect(c?.test).toBe('Swim');
    expect(crossBlocked(edge, edge.models[ori.id], c!)).toMatch(/chasm/);
  });

  it('a model over the chasm falls in and is lost', () => {
    const s = begun();
    const ori = castModel(s, 'ori')!;
    const out = run(put(s, ori, { x: 30, y: 46 }), { type: 'affect', id: ori.id, patch: { prone: true } });
    expect(out.models[ori.id].dead).toBe(true);
    expect(out.log.some(r => r.label === 'Bottomless Pits')).toBe(true);
    expect(fallen(out)).toEqual([]);
  });
});

describe('Escape from Goblin-town: Take Up Arms', () => {
  it('a Dwarf whose move takes him into base contact with the weapon pile takes his weapons back', () => {
    let s = moveFor(begun());
    const balin = castModel(s, 'balin')!;
    s = put(s, balin, { x: 24.2, y: 18.5 });
    s = run(s, { type: 'moveModels', moves: [{ id: balin.id, x: 24.2, y: 16.3 }] });
    expect(s.models[balin.id].lostGear).toBeUndefined();
    expect(isUnarmed(catalog, s.models[balin.id])).toBe(false);
    expect(s.log.some(r => r.label === 'Take Up Arms')).toBe(true);
  });
});

describe("Escape from Goblin-town: A Wizard is Never Late", () => {
  it('as the Good side\'s second move ends, a roll says who puts Gandalf on a walkway at the edge', () => {
    let s = moveFor(begun(), 2);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(gandalfDue(s)).toBe(true);
    const out = gandalfArrives(s, () => 5, uid, 1);
    s = run(s, ...out);
    const g = castModel(s, 'gandalf')!;
    expect(g.waiting).toBeFalsy();
    expect(s.flow.placing?.[0]).toMatchObject({ model: g.id, seat: 'p1', kind: 'edge' });
    expect(noFooting(s, g)).toBe(false);
    expect(Math.min(g.x, g.y, BOARD - g.x, BOARD - g.y)).toBeLessThan(0.6);
    // Dragged out over the chasm, he stays put; along the edge to another walkway, he goes.
    expect(edgeSpot(s, g, { x: 30, y: 47 })).toBeNull();
    s = run(s, { type: 'placed', seat: 'p1' });
    expect(gandalfDue(s)).toBe(false);
  });

  it('on a 1-3 the Evil player places him, away from the Dwarves', () => {
    let s = moveFor(begun(), 2);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    s = run(s, ...gandalfArrives(s, () => 2, uid, 1));
    expect(s.flow.placing?.[0]?.seat).toBe('p2');
  });
});

describe('Escape from Goblin-town: Kill Them All!', () => {
  it('as the Evil move ends, up to a D6 slain Goblin Warriors come back along a walkway from the chosen edge', () => {
    let s = begun('west');
    const slain = goblins(s).slice(0, 4);
    for (const g of slain) s = put(s, g, { dead: true, wounds: 0 });
    s = moveFor(s, 2, 'p2');
    s = run(s, { type: 'endActivation', seat: 'p2' }, { type: 'endActivation', seat: 'p2' });
    expect(slainWarriors(s).length).toBe(4);
    expect(hordeDue(s)).toBe(true);
    s = run(s, ...hordeArrives(s, () => 3, uid, 1));
    expect(s.flow.entering?.ids.length).toBe(3);
    // (The first steps on at once; the other two follow it.)
    expect(slainWarriors(s).length).toBe(3);
    const first = s.flow.entering?.on ? s.models[s.flow.entering.on] : undefined;
    expect(first).toBeTruthy();
    expect(first!.x).toBeLessThan(1);
    expect(noFooting(s, first!)).toBe(false);
  });
});

describe('Escape from Goblin-town: the Goblin King', () => {
  it("I Know That Sword!: in the first turn he neither moves nor declares a heroic action", () => {
    const s = moveFor(begun(), 1, 'p2');
    const king = castModel(s, 'goblin-king')!;
    expect(moveAllowance(s, king)).toBe(0);
    const pre = { ...s, phase: 'move' as const, flow: { ...s.flow, passed: [] } };
    expect(canDeclare(pre, 'p2').map(m => m.id)).not.toContain(king.id);
    expect(moveAllowance({ ...s, turn: 2 }, king)).toBeGreaterThan(0);
  });

  it('Blubbery Mass: a 3+ stops each Wound, but not those from Elven blades in a fight, nor Magical Powers', () => {
    const s = begun();
    const king = castModel(s, 'goblin-king')!;
    const dice = [3, 2, 6];
    let k = 0;
    const out = shrugOff(s, catalog, { type: 'wound', id: king.id, count: 3, how: 'fight', group: 'g1' }, () => dice[k++], uid, 1)!;
    expect(out.find(a => a.type === 'wound')).toMatchObject({ count: 1, checked: true });
    const elven = shrugOff(s, catalog, { type: 'wound', id: king.id, count: 2, how: 'fight', group: 'g2', elven: 2 }, () => 6, uid, 1);
    expect(elven).toBeNull();
    const power = shrugOff(s, catalog, { type: 'wound', id: king.id, count: 1, how: 'other', group: 'p-1' }, () => 6, uid, 1);
    expect(power).toBeNull();
  });

  it('Goblin Projectile: touching a Goblin in the Shoot phase, he hurls it 12" at Strength 8', () => {
    let s = begun();
    const king = castModel(s, 'goblin-king')!;
    const g = goblins(s)[0];
    const ori = castModel(s, 'ori')!;
    s = put(s, g, { x: king.x + 1.3, y: king.y });
    s = put(s, ori, { x: king.x, y: king.y + 6 });
    s = { ...s, turn: 2, phase: 'shoot' };
    const plan = planShot(s, catalog, s.models[king.id], s.models[ori.id]);
    expect(plan.why).toBeUndefined();
    expect(plan.weapon).toMatchObject({ range: 12, s: 8 });
    expect(planShot({ ...s, phase: 'move' }, catalog, s.models[king.id], s.models[ori.id]).weapon?.s).not.toBe(8);
  });

  it('Relentless Advance: charging, he goes through his own Goblins, each taking a Strength 3 hit', () => {
    let s = moveFor(begun(), 2, 'p2');
    const king = castModel(s, 'goblin-king')!;
    const [g, h] = goblins(s);
    const ori = castModel(s, 'ori')!;
    // (Out on the north-east walkway, with nobody else about.)
    for (const m of Object.values(s.models)) if (![king.id, g.id, h.id, ori.id].includes(m.id)) s = put(s, m, { dead: true });
    s = put(s, king, { x: 40.6, y: 8.6 });
    s = put(s, g, { x: 40.6, y: 10.2 });
    s = put(s, ori, { x: 40.6, y: 13.5 });
    s = put(s, h, { x: 39.2, y: 8.2 });
    const contact = 13.5 - 0.79 - 0.49 - 0.01;
    expect(limitMove(s, { x: 40.6, y: 8.6 }, { x: 40.6, y: contact }, 6, 'p2', s.models[king.id]).y).toBeCloseTo(contact, 1);
    // (Not when he isn't charging.)
    expect(limitMove(s, { x: 40.6, y: 8.6 }, { x: 40.6, y: 11.2 }, 6, 'p2', s.models[king.id]).y).toBeLessThan(9.5);
    s = run(s, { type: 'moveModels', moves: [{ id: king.id, x: 40.6, y: contact }] });
    expect(s.models[king.id].y).toBeCloseTo(contact, 1);
    expect(relentlessDue(s)).toBe(true);
    s = run(s, ...relentlessHits(s, catalog, () => 6, uid, 1));
    expect(s.models[g.id].dead).toBe(true);
    expect(s.models[h.id].dead).toBeFalsy();
    expect(relentlessDue(s)).toBe(false);
  });
});

describe('Escape from Goblin-town: Grinnah and the Goblins', () => {
  it('Chittering Hordes: a Goblin supports a Goblin in a fight as if it had a spear', () => {
    let s = begun();
    const [a, b] = goblins(s);
    const ori = castModel(s, 'ori')!;
    s = put(s, ori, { x: 30, y: 24 });
    s = put(s, a, { x: 31, y: 24 });
    s = put(s, b, { x: 32, y: 24 });
    s = { ...s, phase: 'fight' };
    expect(supporters(s, catalog, { key: '', p1: [ori.id], p2: [a.id] }).p2).toContain(b.id);
  });

  it('Swap with Me: as the Fight phase starts, Grinnah swaps places with a Goblin within 3"', () => {
    let s = begun();
    const grinnah = castModel(s, 'grinnah')!;
    const g = goblins(s)[0];
    s = put(s, grinnah, { x: 26, y: 20 });
    s = put(s, g, { x: 28, y: 20 });
    s = { ...s, turn: 2, phase: 'fight', flow: { ...s.flow, passed: [], heroics: [] } };
    expect(maySwapWith(s, catalog, s.models[grinnah.id], s.models[g.id])).toBe(true);
    expect(swapCandidates(s, catalog, 'p2').map(x => x.b.id)).toContain(g.id);
    const out = resolveRequest(s, 'p2', { type: 'swap', a: grinnah.id, b: g.id }, () => 3, uid, 1, catalog)!;
    s = run(s, ...out.apply);
    expect(s.models[grinnah.id]).toMatchObject({ x: 28, y: 20 });
    expect(maySwapWith(s, catalog, s.models[grinnah.id], s.models[g.id])).toBe(false);
  });
});

describe('Escape from Goblin-town: who wins', () => {
  it('nine off the escape edge is a Good win, eight at the end a draw, fewer an Evil win', () => {
    const s = begun();
    const good = Object.values(s.models).filter(m => m.owner === 'p1');
    const off = (k: number, st = s) => good.slice(0, k).reduce((x, m) => put(x, m, { escaped: true }), st);
    expect(goblinWinner(off(9))).toBe('p1');
    expect(goblinWinner(off(8))).toBeNull();
    expect(goblinWinner({ ...off(8), turn: 10, phase: 'end' })).toBe('draw');
    expect(goblinWinner({ ...off(7), turn: 10, phase: 'end' })).toBe('p2');
    // With too many slain for eight to get away, it's over.
    const slain = good.slice(0, 7).reduce((x, m) => put(x, m, { dead: true }), s);
    expect(goblinWinner(slain)).toBe('p2');
    expect(narrativeWinner(off(9))).toBe('p1');
  });

  it('a saved game keeps Gandalf\'s roll and the Goblins coming back', () => {
    const s = begun();
    const saved = { ...s, narrative: { ...s.narrative!, gandalf: 2, horde: 3 } };
    expect(loadState(JSON.parse(JSON.stringify(saved))).narrative).toMatchObject({ gandalf: 2, horde: 3 });
  });
});

describe('Escape from Goblin-town: computer against computer', () => {
  it('plays a whole game to a result without a refused action', () => {
    let s = setup();
    s = play({ ...s, bot: 'p1' }, seeded(1), 4000);
    expect(s.flow.deploy?.step).toBe('done');
  }, 120000);
});
