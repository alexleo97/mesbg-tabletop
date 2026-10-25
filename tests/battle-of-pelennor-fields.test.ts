import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, narrativeWinner } from '../src/shared/narrative.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { markModel } from '../src/shared/marking.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { onOutlines, outline } from '../src/shared/sight.ts';
import { fighterOf, twoHandedChoice } from '../src/shared/wargear.ts';
import { courageAuto } from '../src/shared/powers.ts';
import { ARRIVAL_TURN, arrivalFor, arrivalPoint, arrivalWaiting, mayChoosePoint, pelennorArrives, pelennorObjectives, pelennorTally, pelennorWinner, rohirrimCharge } from '../src/shared/pelennor.ts';
import { alightBlocked, carrierOf, passengerBoon, passengerOf, unseat, unseated } from '../src/shared/passengers.ts';
import { bladeAlight, crownedNear, eowynFearless, eowynsFoe, highKingFor, imposingDue, imposingRoll, mayLightBlade, pelennorFight, royalMumak } from '../src/shared/pelennorRules.ts';
import { BOARD_H, BOARD_W, DEAD_ZONE, GATEWAY, MARKERS, MORDOR_ZONE, ROHAN_ZONE, TOWER_HEIGHT, WALL_HEIGHT } from '../src/shared/pelennorMap.ts';
import type { Action, GameState, Model, Seat } from '../src/shared/types.ts';
import { catalog, play, seeded } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const put = (s: GameState, m: Model, patch: Partial<Model>): GameState => ({ ...s, models: { ...s.models, [m.id]: { ...s.models[m.id], ...patch } } });
const good = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p1');
const evil = (s: GameState) => Object.values(s.models).filter(m => m.owner === 'p2');
const all = (s: GameState, key: string) => Object.values(s.models).filter(m => m.cast === key);
const ask = (s: GameState, seat: Seat, a: Action, dice: number[]) => {
  const d = [...dice];
  return resolveRequest(s, seat, a, () => d.shift() ?? 3, uid, 1, catalog);
};
const apply = (s: GameState, seat: Seat, a: Action, dice: number[]) => run(s, ...ask(s, seat, a, dice)!.apply);
/** Half across a model's base, in inches. */
const half = (m: Model) => Math.max(m.base.w, m.base.h) / 25.4 / 2;
const inBox = (m: Model, [x0, y0, x1, y1]: readonly number[]) => m.x - half(m) >= x0 - 0.01 && m.x + half(m) <= x1 + 0.01 && m.y - half(m) >= y0 - 0.01 && m.y + half(m) <= y1 + 0.01;

/** Battle of Pelennor Fields set up as the server would, with the Good side on `side`. */
function setup(side: Seat = 'p1', turns?: number): GameState {
  const out = resolveRequest(initialState(), 'p1', { type: 'setNarrative', id: 'battle-of-pelennor-fields', good: side, ...(turns ? { turns } : {}) } as Action, () => 3, uid, 1, catalog)!;
  return out.apply.map(a => (a.type === 'startNarrative' ? { ...a, models: a.models.map(m => markModel(catalog, m)) } : a)).reduce(reduce, initialState());
}

/** Both sides set up (Evil first), the battle started. */
const begun = (): GameState => run(setup(), { type: 'warbandDone', seat: 'p2' }, { type: 'warbandDone', seat: 'p1' }, { type: 'startGame', at: 1 });

/** The Move phase of `turn`, `seat` having Priority. */
const moveFor = (s: GameState, turn = 1, seat: Seat = 'p1'): GameState => {
  const out = run({ ...s, turn: 1, phase: 'priority', flow: { ...s.flow, done: [] } }, { type: 'choosePriority', seat }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
  return { ...out, turn };
};

describe('Battle of Pelennor Fields: the table and the cast', () => {
  it("an 8' by 6' Pelennor under the walls of Minas Tirith: the wall, two towers and the broken Gate between them", () => {
    const s = setup();
    expect(s.board).toMatchObject({ w: BOARD_W, h: BOARD_H });
    expect([BOARD_W, BOARD_H]).toEqual([96, 72]);
    const t = Object.values(s.terrain);
    const walls = t.filter(x => x.look === 'mtwall');
    const towers = t.filter(x => x.look === 'mttower');
    expect(walls.length).toBe(2);
    expect(towers.length).toBe(2);
    expect([...walls, ...towers].every(x => x.sheer)).toBe(true);
    expect(walls.every(x => x.height === WALL_HEIGHT)).toBe(true);
    expect(towers.every(x => x.height === TOWER_HEIGHT && (x.poly?.length ?? 0) === 8)).toBe(true);
    // The whole field is one piece, as big as the table (not cut down to the usual largest piece).
    const field = s.terrain['n-fields'];
    expect([field.w, field.h]).toEqual([BOARD_W, BOARD_H]);
    // The Gate is open ground, not a wall or a gate to break.
    expect(s.terrain['n-gate']).toMatchObject({ kind: 'road', look: 'mtgate' });
    expect(t.filter(x => x.kind === 'objective').length).toBe(4);
    expect(MARKERS).toEqual([
      [MORDOR_ZONE[0], MORDOR_ZONE[1]],
      [MORDOR_ZONE[2], MORDOR_ZONE[1]],
      [MORDOR_ZONE[0], MORDOR_ZONE[3]],
      [MORDOR_ZONE[2], MORDOR_ZONE[3]],
    ]);
  });

  it('a 25mm base can get from the Gate to every part of the field (round each rock, never over the wall)', () => {
    const s = setup();
    const r = 0.49;
    const step = 0.5;
    const solid = Object.values(s.terrain)
      .filter(t => t.kind === 'wall' || t.kind === 'building' || t.kind === 'rock')
      .map(t => outline(t));
    const ok = (i: number, j: number) => {
      const p = { x: i * step, y: j * step };
      return p.x - r >= 0 && p.x + r <= BOARD_W && p.y - r >= 0 && p.y + r <= BOARD_H && !onOutlines(solid, p, r);
    };
    const key = (i: number, j: number) => `${i},${j}`;
    const start = [Math.round((GATEWAY[0] + GATEWAY[2]) / 2 / step), Math.round(1 / step)];
    expect(ok(start[0], start[1])).toBe(true);
    const seen = new Set([key(start[0], start[1])]);
    const queue = [start];
    while (queue.length) {
      const [i, j] = queue.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(i + di, j + dj);
        if (seen.has(k) || !ok(i + di, j + dj)) continue;
        seen.add(k);
        queue.push([i + di, j + dj]);
      }
    }
    // Every spot a base fits is reachable: no pocket shut in between the rocks.
    let free = 0;
    for (let i = 0; i <= BOARD_W / step; i++) for (let j = 0; j <= BOARD_H / step; j++) if (ok(i, j)) free++;
    expect(seen.size).toBe(free);
    for (const [x, y] of MARKERS) expect(seen.has(key(Math.round(x / step), Math.round(y / step)))).toBe(true);
    // And the wall itself is nowhere to be stood on.
    expect(ok(Math.round(20 / step), Math.round(1.5 / step))).toBe(false);
  });

  it('the cast: Gondor, Rohan and the Dead of Dunharrow against the Witch-king, Gothmog, the Mûmakil and the hosts of Mordor', () => {
    const s = setup();
    expect(good(s).length).toBe(88);
    expect(evil(s).length).toBe(120);
    for (const k of ['gandalf', 'pippin', 'irolas', 'theoden', 'eomer', 'eowyn', 'merry', 'gamling', 'aragorn', 'legolas', 'gimli', 'king', 'witch-king', 'gothmog', 'enforcer', 'guritz', 'war-leader', 'chieftain', 'easterling-captain', 'royal-mumak', 'mumak-1', 'mumak-2'])
      expect(castModel(s, k), k).toBeDefined();
    expect(all(s, 'gondor').length).toBe(24);
    expect(all(s, 'citadel').length).toBe(6);
    expect(all(s, 'rider').length).toBe(24);
    expect(all(s, 'herald').length).toBe(2);
    expect(all(s, 'dead').length).toBe(20);
    expect(all(s, 'orc').length).toBe(48);
    expect(all(s, 'troll').length).toBe(2);
    expect(all(s, 'haradrim').length).toBe(12);
    expect(all(s, 'easterling').length).toBe(10);
    for (const b of ['royal-mumak', 'mumak-1', 'mumak-2']) expect(all(s, `crew-${b}`).every(m => m.aboard === castModel(s, b)!.id)).toBe(true);
    expect(castModel(s, 'war-leader')!.aboard).toBe(castModel(s, 'royal-mumak')!.id);
    // The Witch-king: 3 Attacks, 3 Might, 18 Will, 3 Fate.
    const wk = castModel(s, 'witch-king')!;
    expect([wk.might, wk.will, wk.fate]).toEqual([3, 18, 3]);
    // The Passengers: Pippin behind Gandalf, Merry behind Éowyn, their Might, Will and Fate the rider's to spend.
    const gandalf = castModel(s, 'gandalf')!;
    const pippin = castModel(s, 'pippin')!;
    expect(carrierOf(s, pippin)?.id).toBe(gandalf.id);
    expect(carrierOf(s, castModel(s, 'merry')!)?.id).toBe(castModel(s, 'eowyn')!.id);
    expect([pippin.might, pippin.will, pippin.fate]).toEqual([0, 0, 0]);
    expect(gandalf.might).toBe(3 + (pippin.lent?.[0] ?? 0));
    expect(pippin.lent).toBeDefined();
    // The Easterlings' halberds may be used two-handed, or not.
    const halberd = all(s, 'easterling').find(m => m.options?.some(o => /halberd/i.test(o)))!;
    expect(twoHandedChoice(catalog, halberd)).toBe('may');
  });

  it('who starts where: Mordor in the middle, Rohan along the east edge, the Dead along the west; the rest kept aside, spread out with no bases overlapping', () => {
    const s = setup();
    const on = Object.values(s.models).filter(m => !m.waiting && !m.aboard);
    for (const m of evil(s).filter(m => !m.waiting && !m.aboard)) expect(inBox(m, MORDOR_ZONE), m.name).toBe(true);
    for (const m of good(s).filter(m => !m.waiting && !m.aboard)) expect(inBox(m, ROHAN_ZONE) || inBox(m, DEAD_ZONE), m.name).toBe(true);
    expect(good(s).filter(m => !m.waiting && !m.aboard && inBox(m, ROHAN_ZONE)).length).toBe(28);
    expect(good(s).filter(m => !m.waiting && !m.aboard && inBox(m, DEAD_ZONE)).length).toBe(26);
    // Waiting their turn: the Witch-king, the three Mûmakil and the men of Gondor (those aboard come with them).
    expect(castModel(s, 'witch-king')!.waiting).toBe(true);
    for (const b of ['royal-mumak', 'mumak-1', 'mumak-2']) expect(castModel(s, b)!.waiting).toBe(true);
    expect([...all(s, 'gondor'), ...all(s, 'citadel'), castModel(s, 'gandalf')!, castModel(s, 'irolas')!].every(m => m.waiting)).toBe(true);
    expect(castModel(s, 'merry')!.waiting).toBeFalsy();
    for (const a of on) for (const b of on) if (a.id < b.id) expect(distanceBetween(a, b), `${a.name} and ${b.name}`).toBeGreaterThan(0.05);
    const rocks = Object.values(s.terrain).filter(t => t.kind === 'rock').map(t => outline(t));
    for (const m of on) expect(onOutlines(rocks, m, half(m)), m.name).toBe(false);
  });
});

describe('Battle of Pelennor Fields: arrivals', () => {
  it('the Mûmakil come on from the south edge in turn 2 where the Evil player chose, all aboard them with them', () => {
    let s = begun();
    expect(mayChoosePoint(s, 'p2', 'mumakil')).toBe(true);
    expect(mayChoosePoint(s, 'p1', 'mumakil')).toBe(false);
    s = run(s, { type: 'arrivalPoint', seat: 'p2', which: 'mumakil', x: 30 });
    expect(arrivalPoint(s, 'mumakil')).toBe(30);
    s = moveFor(s, 1, 'p2');
    expect(arrivalFor(s, 'p2')).toBeNull();
    s = { ...moveFor(s, ARRIVAL_TURN.mumakil, 'p2') };
    expect(arrivalFor(s, 'p2')).toBe('mumakil');
    s = run(s, { type: 'endActivation', seat: 'p2' });
    expect(s.flow.reinforce).toBe('p2');
    const out = pelennorArrives(s, uid, 1);
    const enter = out.find(a => a.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(enter.from).toEqual([30, BOARD_H]);
    expect(enter.ids.length).toBe(3);
    s = run(s, ...out);
    // The first steps on at the south edge with its crew; the others wait their turn to.
    const first = s.models[s.flow.entering!.on!];
    expect(first.waiting).toBeFalsy();
    expect(first.y + half(first)).toBeCloseTo(BOARD_H, 0);
    for (const c of Object.values(s.models).filter(m => m.aboard === first.id)) expect(c.waiting).toBeFalsy();
    // Once chosen and on their way, the point is fixed.
    expect(mayChoosePoint(s, 'p2', 'mumakil')).toBe(false);
  });

  it('the Witch-king flies in over the north wall in turn 4; the men of Gondor come out through the Gate in turn 6', () => {
    let s = run(begun(), { type: 'arrivalPoint', seat: 'p2', which: 'witch-king', x: 70 });
    // (The Mûmakil already on.)
    for (const b of ['royal-mumak', 'mumak-1', 'mumak-2']) s = put(s, castModel(s, b)!, { waiting: false });
    s = moveFor(s, ARRIVAL_TURN['witch-king'], 'p2');
    expect(arrivalFor(s, 'p2')).toBe('witch-king');
    s = run(s, { type: 'endActivation', seat: 'p2' });
    const wk = pelennorArrives(s, uid, 1).find(a => a.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(wk.from).toEqual([70, 0]);
    let g = moveFor(begun(), ARRIVAL_TURN.gondor - 1, 'p1');
    expect(arrivalFor(g, 'p1')).toBeNull();
    g = moveFor(g, ARRIVAL_TURN.gondor, 'p1');
    expect(arrivalFor(g, 'p1')).toBe('gondor');
    g = run(g, { type: 'endActivation', seat: 'p1' });
    const out = pelennorArrives(g, uid, 1);
    const enter = out.find(a => a.type === 'entering') as Extract<Action, { type: 'entering' }>;
    expect(enter.span).toEqual([GATEWAY[0], GATEWAY[2]]);
    expect(enter.ids.length).toBe(arrivalWaiting(g, 'gondor').length);
    // Pippin isn't in the list: he comes riding behind Gandalf.
    expect(enter.ids).not.toContain(castModel(g, 'pippin')!.id);
    g = run(g, ...out);
    const first = g.models[g.flow.entering!.on!];
    expect(first.x).toBeGreaterThanOrEqual(GATEWAY[0]);
    expect(first.x).toBeLessThanOrEqual(GATEWAY[2]);
  });
});

describe('Battle of Pelennor Fields: who wins', () => {
  it('five objectives, scored at the end of the chosen turns: heroes alive, the Mûmakil, the Gates and the markers', () => {
    let s = begun();
    const o = pelennorObjectives(s);
    expect(o.map(x => x.key)).toEqual(['west', 'dark', 'mumakil', 'gates', 'pelennor']);
    // As set up: every hero alive on both sides, no Mûmak slain, nobody at the Gates; Mordor's ranks on the markers.
    expect(o.find(x => x.key === 'west')!.holder).toBe('good');
    expect(o.find(x => x.key === 'dark')!.holder).toBe('evil');
    expect(o.find(x => x.key === 'mumakil')!.holder).toBe('evil');
    expect(narrativeWinner(s)).toBeNull();
    // Every Mûmak slain is Good's; more of the West's heroes slain than alive is Evil's.
    for (const b of ['royal-mumak', 'mumak-1', 'mumak-2']) s = put(s, castModel(s, b)!, { dead: true });
    for (const k of ['aragorn', 'legolas', 'gimli', 'gandalf']) s = put(s, castModel(s, k)!, { dead: true });
    const after = pelennorObjectives(s);
    expect(after.find(x => x.key === 'mumakil')!.holder).toBe('good');
    expect(after.find(x => x.key === 'west')!.holder).toBe('evil');
    // The Gates: whoever has more within 12" of them (a Dominant model counting for more).
    const gate = s.terrain['n-gate'];
    const orc = all(s, 'orc')[0];
    s = put(s, orc, { x: gate.x, y: gate.y + 6 });
    expect(pelennorObjectives(s).find(x => x.key === 'gates')!.holder).toBe('evil');
    // Over once the last turn's End phase begins.
    const end = { ...s, turn: 12, phase: 'end' as const };
    const t = pelennorTally(end);
    expect(pelennorWinner(end)).toBe(t.good > t.evil ? 'p1' : t.evil > t.good ? 'p2' : 'draw');
    expect(pelennorWinner({ ...s, turn: 11, phase: 'end' })).toBeNull();
    // Or at once if one side has nobody left.
    const gone = Object.values(s.models).reduce((st, m) => (m.owner === 'p2' ? put(st, m, { dead: true }) : st), s);
    expect(pelennorWinner(gone)).not.toBeNull();
  });
});

describe('Battle of Pelennor Fields: the special rules', () => {
  it('Passengers: Pippin lets Gandalf re-roll 1s To Wound; Merry gives Éowyn 3 Attacks; either can be struck, and gets down only during the move', () => {
    let s = begun();
    const gandalf = castModel(s, 'gandalf')!;
    const eowyn = castModel(s, 'eowyn')!;
    expect(passengerBoon(s, catalog, gandalf)).toBe('Pippin');
    expect(passengerBoon(s, catalog, eowyn)).toBe('Merry');
    const f = fighterOf(s, catalog, eowyn);
    pelennorFight(s, catalog, eowyn, f);
    expect(f.a).toBe(3);
    expect(f.passenger?.id).toBe(castModel(s, 'merry')!.id);
    const g = fighterOf(s, catalog, gandalf);
    pelennorFight(s, catalog, gandalf, g);
    expect(g.ones).toBe(true);
    // Getting down: only during the Move phase, before the mount's move is over.
    const merry = castModel(s, 'merry')!;
    expect(alightBlocked({ ...s, phase: 'shoot' }, merry, 'p1')).toBeDefined();
    s = moveFor(s, 1, 'p1');
    expect(alightBlocked(s, merry, 'p1')).toBeUndefined();
    s = apply(s, 'p1', { type: 'alight', id: merry.id }, []);
    expect(s.models[merry.id].aboard).toBeFalsy();
    expect(passengerOf(s, s.models[eowyn.id])).toBeUndefined();
    expect(distanceBetween(s.models[merry.id], s.models[eowyn.id])).toBeLessThan(0.1);
    expect(s.flow.stopped).toContain(merry.id);
  });

  it('a Passenger whose rider falls takes a Thrown Rider test, and hands back what Might, Will and Fate the rider has left', () => {
    let s = begun();
    const gandalf = castModel(s, 'gandalf')!;
    const pippin = castModel(s, 'pippin')!;
    s = put(s, gandalf, { waiting: false, x: 48, y: 10 });
    s = put(s, pippin, { waiting: false, x: 48, y: 10 });
    expect(unseated(s)).toEqual([]);
    s = put(s, s.models[gandalf.id], { dead: true });
    expect(unseated(s).map(m => m.id)).toEqual([pippin.id]);
    const before = s.models[gandalf.id];
    const d = [6];
    s = run(s, ...unseat(s, catalog, () => d.shift() ?? 3, uid, 1));
    const p = s.models[pippin.id];
    expect(p.aboard).toBeFalsy();
    expect(p.might).toBe(Math.min(pippin.lent![0], before.might));
    expect(p.stunned).toBeUndefined();
  });

  it('the Crown of Morgul: no passing Courage without a roll within 6"; once a game his blade wounds Set Ablaze', () => {
    let s = begun();
    const wk = castModel(s, 'witch-king')!;
    s = put(s, wk, { waiting: false, x: 70, y: 10 });
    const eowyn = castModel(s, 'eowyn')!;
    const theoden = castModel(s, 'theoden')!;
    s = put(s, theoden, { dead: true, killedBy: { ids: [wk.id] } as Model['killedBy'] });
    // After Théoden falls Éowyn is Fearless, and re-rolls To Wound against the one who slew him...
    expect(eowynFearless(s, catalog, s.models[eowyn.id])).toBe(true);
    expect(eowynsFoe(s, catalog, s.models[eowyn.id])).toBe(wk.id);
    expect(courageAuto(s, catalog, put(s, eowyn, { x: 20, y: 60 }).models[eowyn.id])).not.toBeNull();
    // ...but not within 6" of the Crown of Morgul.
    s = put(s, eowyn, { x: 74, y: 10 });
    expect(crownedNear(s, catalog, s.models[eowyn.id])).toBe(true);
    expect(courageAuto(s, catalog, s.models[eowyn.id])).toBeNull();
    s = { ...s, phase: 'fight', flow: { ...s.flow, resolved: [], duels: [] } };
    expect(mayLightBlade(s, catalog, s.models[wk.id])).toBe(true);
    s = apply(s, 'p2', { type: 'crownBlade', id: wk.id }, []);
    expect(bladeAlight(s, s.models[wk.id])).toBe(true);
    expect(mayLightBlade(s, catalog, s.models[wk.id])).toBe(false);
  });

  it('the Charge of the Rohirrim: a Rider that charged may declare a Heroic Combat for nothing', () => {
    let s = begun();
    const rider = all(s, 'rider')[0];
    s = { ...s, phase: 'fight', flow: { ...s.flow, charges: { [rider.id]: 'x' } as GameState['flow']['charges'] } };
    expect(rohirrimCharge(s, s.models[rider.id])).toBe(true);
    expect(rohirrimCharge(s, s.models[all(s, 'rider')[1].id])).toBe(false);
    const might = s.models[rider.id].might;
    s = run(s, { type: 'declareHeroic', model: rider.id, action: 'Heroic Combat' } as Action);
    expect(s.flow.heroics.some(h => h.model === rider.id && h.action === 'Heroic Combat')).toBe(true);
    expect(s.models[rider.id].might).toBe(might);
  });

  it("the Mûmak War Leader: Imposing Presence calls off a Heroic Move near his Royal Mûmak on a 4+; High King of the South's Stand Fast! reaches 12\" from it", () => {
    let s = begun();
    const beast = castModel(s, 'royal-mumak')!;
    const leader = castModel(s, 'war-leader')!;
    s = put(s, beast, { waiting: false, x: 48, y: 50 });
    // (Not until he's on the table.)
    expect(royalMumak(s, catalog, s.models[leader.id])).toBeUndefined();
    s = put(s, leader, { waiting: false, x: 48, y: 50 });
    expect(royalMumak(s, catalog, s.models[leader.id])?.id).toBe(beast.id);
    const orc = all(s, 'orc')[0];
    s = put(s, orc, { x: 48, y: 40 });
    expect(highKingFor(s, catalog, s.models[orc.id])?.id).toBe(leader.id);
    s = put(s, orc, { x: 10, y: 10 });
    expect(highKingFor(s, catalog, s.models[orc.id])).toBeUndefined();
    const theoden = castModel(s, 'theoden')!;
    s = put(s, theoden, { x: 52, y: 44 });
    s = { ...s, phase: 'move', flow: { ...s.flow, heroics: [{ model: theoden.id, action: 'Heroic Move', phase: 'move' }] } };
    expect(imposingDue(s, catalog)?.hero.id).toBe(theoden.id);
    const off = run(s, ...imposingRoll(s, catalog, () => 5, uid, 1));
    expect(off.flow.heroics).toEqual([]);
    expect(imposingDue(off, catalog)).toBeNull();
    const held = run(s, ...imposingRoll(s, catalog, () => 2, uid, 1));
    expect(held.flow.heroics.length).toBe(1);
  });

  it('Captain of the Citadel Guard: Citadel Guard within 3" of Irolas add 1 To Wound', () => {
    let s = begun();
    const irolas = castModel(s, 'irolas')!;
    const guard = all(s, 'citadel')[0];
    s = put(s, irolas, { waiting: false, x: 48, y: 10 });
    s = put(s, guard, { waiting: false, x: 50, y: 10 });
    const f = fighterOf(s, catalog, s.models[guard.id]);
    const mod = f.woundMod ?? 0;
    pelennorFight(s, catalog, s.models[guard.id], f);
    expect(f.woundMod).toBe(mod + 1);
  });

  it('a saved game keeps where the Mûmakil and the Witch-king come on, and what a Passenger lent', () => {
    const s = begun();
    const saved = { ...s, narrative: { ...s.narrative!, mumak: 30, wraith: 70 } };
    const back = loadState(JSON.parse(JSON.stringify(saved)));
    expect(back.narrative).toMatchObject({ mumak: 30, wraith: 70 });
    const pippin = castModel(s, 'pippin')!;
    expect(back.models[pippin.id].lent).toEqual(pippin.lent);
    expect(back.terrain['n-fields'].look).toBe('pelennor');
  });
});

describe('Battle of Pelennor Fields: the computer', () => {
  it('plays both sides through to a result with nothing refused', () => {
    const refused: string[] = [];
    const watch = (st: GameState, seat: Seat, a: Action, ok: boolean) => void (ok || refused.push(`${st.turn}:${st.phase}:${seat}:${a.type}`));
    const pre = play(setup('p1', 8), seeded(3), 4000, st => st.flow.deploy?.step === 'done', watch).state;
    const { state } = play(run(pre, { type: 'startGame', at: 1 }), seeded(3), 200000, st => !!st.result || st.turn > 10, watch);
    expect(refused).toEqual([]);
    expect(state.result?.winner).toBeDefined();
    // Everyone came on: the Mûmakil, the Witch-king and the men of Gondor.
    for (const m of Object.values(state.models)) expect(m.waiting && !m.dead, m.name).toBeFalsy();
    const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    const back = loadState(json(state));
    expect(json(back.narrative)).toEqual(json(state.narrative));
  }, 1500000);
});
