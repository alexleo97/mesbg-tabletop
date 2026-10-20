import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, radius } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { climbedLevel, distanceToTerrain } from '../src/shared/sight.ts';
import { touching, touchingEnemies } from '../src/shared/barriers.ts';
import { inEvilZone, inHornburg, onArc, onDeepingWall } from '../src/shared/helmsMap.ts';
import { crossBlocked, crossingAhead } from '../src/shared/terrainTests.ts';
import { limitMove } from '../src/shared/movement.ts';
import type { Action, GameState, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';
import { chargeSabotage, deepingDown, detonateBlocked, helmsObjectives, helmsTally, raiseLadderTargets, reliefArrives, reliefDue } from '../src/shared/helms.ts';
import { gameWinner } from '../src/shared/status.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const dice = (list: number[]) => {
  const seq = [...list];
  return () => seq.shift() ?? 1;
};
const ask = (s: GameState, seat: Seat, a: Action, rolls: number[] = []) => {
  const out = resolveRequest(s, seat, a, dice(rolls), uid, 1, catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : s;
};
const who = (s: GameState, key: string) => castModel(s, key)!;
const setUp = (turns?: number) => ask(initialState(), 'p1', { type: 'setNarrative', id: 'helms-deep', good: 'p1', ...(turns ? { turns } : {}) });

describe("Helm's Deep: setting up", () => {
  it('puts both casts where the book starts them', () => {
    const s = setUp();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const ms = Object.values(s.models);
    const good = ms.filter(m => m.owner === 'p1');
    const evil = ms.filter(m => m.owner === 'p2');
    expect(good.length).toBe(27 + 56 + 27);
    expect(evil.length).toBe(5 + 4 + 15 + 85 + 16);
    for (const m of good.filter(m => !m.waiting)) {
      const ok = inHornburg(m, radius(m)) || onDeepingWall(m, radius(m));
      if (!ok) console.log('out', m.name, m.x, m.y);
      expect(ok).toBe(true);
    }
    for (const m of evil) {
      if (!inEvilZone(m, radius(m))) console.log('evil out', m.name, m.x, m.y);
      expect(inEvilZone(m, radius(m))).toBe(true);
    }
    // Nobody stands in a wall or on another model.
    const walls = Object.values(s.terrain).filter(t => (t.kind === 'wall' && !t.walk) || t.kind === 'gate' || t.kind === 'building');
    for (const m of ms.filter(m => !m.waiting)) for (const t of walls) if (distanceToTerrain(m, t) < 0.01) console.log('in wall', m.name, m.x.toFixed(2), m.y.toFixed(2), t.id);
    const placed = ms.filter(m => !m.waiting);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < radius(a) + radius(b) - 0.02 && !(a.crewOf || b.crewOf)) console.log('overlap', a.name, b.name, a.x.toFixed(2), a.y.toFixed(2));
    }
    expect(s.narrative?.turns).toBe(15);
    expect(who(s, 'eomer').waiting).toBe(true);
    // The book's wargear: Éomer on armoured Firefoot with no shield, Théoden in heavy armour with a shield.
    expect(who(s, 'eomer').options).toEqual(['Firefoot with armour']);
    expect(who(s, 'gandalf').options).toEqual(['Shadowfax']);
    expect(who(s, 'theoden').options).toEqual(['Exchange armour for heavy armour', 'Shield']);
    expect(who(s, 'gamling').options).toContain('Royal Standard of Rohan');
    expect(who(s, 'ballista').base).toEqual({ shape: 'oval', w: 105, h: 70 });
    expect(ms.filter(m => m.crewOf === who(s, 'ballista').id).map(m => m.name).sort()).toEqual(['Uruk-hai Siege Crew', 'Uruk-hai Siege Crew', 'Uruk-hai Siege Crew (Siege Veteran)']);
    const engineers = ms.filter(m => m.cast === 'engineer');
    expect(engineers.length).toBe(10);
    expect(engineers.every(m => m.name === 'Uruk-hai Engineer' && m.stats?.C === 6)).toBe(true);
    expect(ms.filter(m => m.torch).length).toBe(5);
    const count = (unit: string, opt?: string) => ms.filter(m => m.profileId?.endsWith(unit) && (!opt || m.options?.includes(opt))).length;
    expect([count('uruk-hai-warrior', 'Shield'), count('uruk-hai-warrior', 'Pike'), count('uruk-hai-warrior', 'Crossbow'), count('uruk-hai-warrior', 'Banner')]).toEqual([35, 35, 12, 3]);
    expect(count('uruk-hai-berserker')).toBe(21);
    expect(count('uruk-hai-captain')).toBe(5);
    expect([count('warrior-of-rohan', 'Shield'), count('warrior-of-rohan', 'Shield and throwing spears'), count('warrior-of-rohan', 'Bow'), count('warrior-of-rohan', 'Banner')]).toEqual([16, 16, 16, 2]);
    expect([count('galadhrim-warrior', 'Shield'), count('galadhrim-warrior', 'Shield and Elven spear'), count('galadhrim-warrior', 'Elf bow'), count('galadhrim-warrior', 'Banner')]).toEqual([8, 8, 8, 1]);
    expect([count('rider-of-rohan'), count('rider-of-rohan', 'Throwing spears')]).toEqual([24, 8]);
    // Ten ladders and five charges, the Evil side's.
    const markers = Object.values(s.terrain).filter(t => t.kind === 'objective');
    expect(markers.filter(t => t.object === 'ladder' && t.side === 'p2').length).toBe(10);
    expect(markers.filter(t => t.object === 'charge' && t.side === 'p2').length).toBe(5);
    // The gates are the defenders'.
    expect(Object.values(s.terrain).filter(t => t.kind === 'gate').every(t => t.side === 'p1')).toBe(true);
  });
});

/** Helm's Deep with Good in p1, started, in turn `turn`'s Move phase with p1 first and heroics passed. */
function battle(turn = 1, s0 = setUp()): GameState {
  let s = run(s0, { type: 'startGame', at: 1 });
  if (turn > 1) s = { ...s, turn };
  return run(s, { type: 'choosePriority', seat: 'p1' }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
}

describe("Helm's Deep: setting up, continued", () => {
  it('keeps each part of the cast in its own area before the battle', () => {
    let s = setUp();
    const g = who(s, 'gimli');
    s = run(s, { type: 'moveModels', moves: [{ id: g.id, x: 30, y: 40 }] });
    expect(s.models[g.id].x).toBe(g.x);
    const t = who(s, 'theoden');
    s = run(s, { type: 'moveModels', moves: [{ id: t.id, x: 30, y: 30 }] });
    expect(s.models[t.id].x).toBe(t.x);
    s = run(s, { type: 'moveModels', moves: [{ id: t.id, x: 8, y: 12 }] });
    expect(s.models[t.id]).toMatchObject({ x: 8, y: 12 });
    const u = who(s, 'uruk-captain');
    s = run(s, { type: 'moveModels', moves: [{ id: u.id, x: 30, y: 10 }] });
    expect(s.models[u.id].x).toBe(u.x);
  });

  it('lets the players choose how many turns it lasts', () => {
    expect(setUp(20).narrative?.turns).toBe(20);
    expect(setUp(7).narrative?.turns).toBe(15);
  });
});

describe('"Look to my coming"', () => {
  it('brings the Relief Force on from the eastern half of the south edge at the end of the 10th move, and they may charge', () => {
    let s = battle(10);
    s = run(s, { type: 'reliefPoint', seat: 'p1', x: 40 });
    expect(s.narrative?.relief).toBe(40);
    // Evil can't choose for them.
    expect(run(s, { type: 'reliefPoint', seat: 'p2', x: 30 }).narrative?.relief).toBe(40);
    s = run(s, { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).not.toContain('p1');
    expect(reliefDue(s)).toBe(true);
    s = run(s, ...reliefArrives(s, uid));
    expect(reliefDue(s)).toBe(false);
    const first = Object.values(s.models).find(m => m.cast === 'eomer')!;
    expect(first.waiting).toBeUndefined();
    expect(first.x).toBeCloseTo(40, 1);
    expect(first.y + radius(first)).toBeCloseTo(48, 1);
    expect(s.flow.entering?.charge).toBe(true);
    // The rest wait their turn to step on.
    expect(who(s, 'gandalf').waiting).toBe(true);
  });

  it('does not come before turn 10', () => {
    const s = run(battle(9), { type: 'endActivation', seat: 'p1' });
    expect(s.flow.done).toContain('p1');
    expect(reliefDue(s)).toBe(false);
  });
});

describe('Ride Out', () => {
  const nearGate = (s: GameState, key: string) => {
    const m = who(s, key);
    const gate = s.terrain['n-gate'];
    return { ...s, models: { ...s.models, [m.id]: { ...m, x: gate.x - 2.5, y: gate.y - 0.9 } } };
  };
  it('lets Théoden mount Snowmane by the gate from turn 8, not before', () => {
    const early = nearGate(battle(7), 'theoden');
    expect(who(ask(early, 'p1', { type: 'rideOut', model: who(early, 'theoden').id }), 'theoden').mount).toBeUndefined();
    let s = nearGate(battle(8), 'theoden');
    const t = who(s, 'theoden');
    s = ask(s, 'p1', { type: 'rideOut', model: t.id });
    expect(s.models[t.id].mount).toBe('Snowmane');
    expect(s.models[t.id].move).toBe(10);
    expect(s.models[t.id].base).not.toEqual(t.base);
  });
  it('gives Aragorn Brego, and not to a hero far from the gate or one without a horse', () => {
    let s = nearGate(battle(8), 'aragorn');
    s = ask(s, 'p1', { type: 'rideOut', model: who(s, 'aragorn').id });
    expect(who(s, 'aragorn').mount).toBe('Brego');
    const far = battle(8);
    expect(ask(far, 'p1', { type: 'rideOut', model: who(far, 'legolas').id }).models[who(far, 'legolas').id].mount).toBeUndefined();
    const gimli = nearGate(battle(8), 'gimli');
    expect(ask(gimli, 'p1', { type: 'rideOut', model: who(gimli, 'gimli').id }).models[who(gimli, 'gimli').id].mount).toBeUndefined();
  });
});

/** A started game in the Fight phase of turn 2 with heroics passed. */
const fightPhase = (s: GameState) => run({ ...s, phase: 'fight', flow: { ...s.flow, passed: ['p1', 'p2'] } }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
const put = (s: GameState, id: string, x: number, y: number) => ({ ...s, models: { ...s.models, [id]: { ...s.models[id], x, y } } });

describe('Demolition Charges', () => {
  it('a torch-bearer by the culvert brings the Deeping Wall down, and those on it are hit and fall', () => {
    let s = battle(2);
    const charge = s.terrain['n-charge-1'];
    const torch = Object.values(s.models).find(m => m.torch)!;
    // The charge against the culvert, the Berserker beside it, a defender on the wall above.
    s = { ...s, terrain: { ...s.terrain, [charge.id]: { ...charge, x: 24.8, y: 36.2 } } };
    s = put(s, torch.id, 25.8 + 0.05, 36.2);
    const def = Object.values(s.models).find(m => m.cast === 'wall-rohan' && Math.abs(m.y - 36) < 1.2 && m.x > 22)!;
    s = fightPhase(s);
    expect(detonateBlocked(s, s.models[torch.id], s.terrain[charge.id])).toBeUndefined();
    // Courage 3+ passes (5+4), the table says 4: D6 = 3 Wounds on everything within 2"; then the wall's S9 hit and the fall.
    s = ask(s, 'p2', { type: 'detonate', model: torch.id, charge: charge.id }, [5, 4, 4, 3, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(s.terrain[charge.id].gone).toBe('destroyed');
    expect(s.terrain['n-deeping-culvert']).toBeUndefined();
    expect(deepingDown(s)).toBe(true);
    expect(s.narrative?.breach).toBe(2);
    expect(s.models[def.id].dead || s.models[def.id].prone).toBe(true);
    expect(s.models[torch.id].dead).toBe(true);
  });

  it('needs a Siege Target or two enemies in the blast, and a torch or a 6', () => {
    let s = fightPhase(battle(2));
    const torch = Object.values(s.models).find(m => m.torch)!;
    expect(detonateBlocked(s, torch, s.terrain['n-charge-1'])).toMatch(/Siege Target/);
    // Two Elves beside the charge.
    const elves = Object.values(s.models).filter(m => m.cast === 'wall-galadhrim').slice(0, 2);
    const c = s.terrain['n-charge-1'];
    s = put(put(s, elves[0].id, c.x, c.y - 1.6), elves[1].id, c.x, c.y + 1.6);
    const eng = Object.values(s.models).find(m => m.cast === 'engineer' && Math.abs(m.y - c.y) < 1.5)!;
    expect(detonateBlocked(s, eng, c)).toBeUndefined();
    // Without a torch, a passed test needs a 6 as well: here a 5, and nothing happens.
    const after = ask(s, 'p2', { type: 'detonate', model: eng.id, charge: c.id }, [6, 6, 5]);
    expect(after.terrain[c.id].gone).toBeUndefined();
    expect(after.log.some(r => /without a torch/i.test(r.label))).toBe(true);
    // A dud is simply removed.
    const dud = ask(s, 'p2', { type: 'detonate', model: torch.id === eng.id ? eng.id : eng.id, charge: c.id }, [6, 6, 6, 1]);
    expect(dud.terrain[c.id].gone).toBe('destroyed');
    expect(Object.values(dud.models).filter(m => m.dead).length).toBe(0);
  });

  it('goes off on a 6 when wounded, and an enemy beside it that only moved disables it as the turn ends', () => {
    let s = battle(2);
    const c = s.terrain['n-charge-2'];
    const elf = Object.values(s.models).find(m => m.cast === 'wall-galadhrim')!;
    s = put(s, elf.id, c.x - 1.0, c.y);
    s = { ...s, phase: 'end' };
    const out = chargeSabotage(s, uid);
    expect(out.some(a => a.type === 'updateTerrain' && a.id === c.id)).toBe(true);
  });
});

describe("Helm's Deep: who wins", () => {
  it('scores the seven objectives when the last turn ends', () => {
    let s = battle(15);
    expect(gameWinner(s)).toBeNull();
    s = { ...s, phase: 'end' };
    const o = helmsObjectives(s);
    expect(o.map(x => x.key)).toEqual(['theoden', 'wall', 'hornburg', 'causeway', 'heroes', 'eomer', 'captains']);
    // At the start nobody stands on the causeway, and every other objective is Good's but the captains.
    expect(o.find(x => x.key === 'causeway')!.holder).toBeNull();
    expect(o.find(x => x.key === 'captains')!.holder).toBe('evil');
    expect(gameWinner(s)).toBe('p1');
  });
  it('gives Evil the win once enough has gone its way', () => {
    let s = { ...battle(15), phase: 'end' as const };
    const kill = (k: string) => Object.values(s.models).filter(m => m.cast === k).forEach(m => (s = { ...s, models: { ...s.models, [m.id]: { ...m, dead: true } } }));
    ['theoden', 'eomer', 'aragorn', 'legolas', 'gimli', 'haldir', 'hornburg-rohan'].forEach(kill);
    s = { ...s, narrative: { ...s.narrative!, breach: 5 } };
    expect(helmsTally(s).evil).toBeGreaterThan(helmsTally(s).good);
    expect(gameWinner(s)).toBe('p2');
  });
  it('ends at once if one side is wiped out', () => {
    let s = battle(3);
    for (const m of Object.values(s.models)) if (m.owner === 'p2') s = { ...s, models: { ...s.models, [m.id]: { ...m, dead: true } } };
    expect(gameWinner(s)).toBe('p1');
  });
});

describe("The walls' walkways", () => {
  it('the defenders start up on the walls, all but Théoden and Gamling behind the gate', () => {
    const s = setUp();
    const good = Object.values(s.models).filter(m => m.owner === 'p1' && !m.waiting);
    for (const m of good) expect([m.cast, climbedLevel(s, m)]).toEqual([m.cast, m.cast === 'theoden' || m.cast === 'gamling' ? 0 : 3]);
  });

  it('steps lead up onto a wall; anywhere else it is too sheer to climb', () => {
    const s = battle(2);
    const m = who(s, 'theoden');
    expect(crossingAhead(s, m, onArc(20.3, 33), onArc(23.6, 33))).toBeNull();
    const c = crossingAhead(s, m, onArc(20.3, 40), onArc(23.6, 40));
    expect(c?.test).toBe('Climb');
    expect(crossBlocked(s, m, c!)).toMatch(/Siege Ladder/);
  });

  it('an attacker at the foot reaches a defender up on the wall only by a ladder', () => {
    let s = battle(2);
    const def = Object.values(s.models).find(m => m.owner === 'p1' && m.x > 23.7 && Math.abs(m.y - 27) < 0.6)!;
    const uruk = Object.values(s.models).find(m => m.cast === 'uruk')!;
    s = put(s, uruk.id, def.x + radius(def) + radius(uruk) + 0.05, def.y);
    expect(touching(s, s.models[uruk.id], def)).toBe(false);
    const ladder = s.terrain['n-ladder-1'];
    s = { ...s, terrain: { ...s.terrain, [ladder.id]: { ...ladder, x: 24.7, y: def.y + 0.6, raised: 'n-deeping-2', side: 'p2' } } };
    expect(touching(s, s.models[uruk.id], def)).toBe(true);
  });

  it('the defenders up on the wall hold back nobody at its foot, so a ladder can be brought right up', () => {
    let s = battle(2);
    s = { ...s, phase: 'move' };
    const def = Object.values(s.models).find(m => m.owner === 'p1' && m.x > 23.7 && Math.abs(m.y - 27) < 0.6)!;
    const uruk = Object.values(s.models).find(m => m.cast === 'uruk')!;
    s = put(s, uruk.id, 30, def.y);
    const foot = { x: 24.7 + 0.05 + radius(uruk), y: def.y };
    const got = limitMove(s, { x: 30, y: def.y }, foot, 6, 'p2', s.models[uruk.id]);
    expect(got.x).toBeCloseTo(foot.x, 1);
  });

  it('a climber goes up a raised ladder onto the walkway without a test', () => {
    let s = battle(2);
    const top = { x: 23.6, y: 27 };
    for (const m of Object.values(s.models)) if (m.owner === 'p1' && Math.hypot(m.x - top.x, m.y - top.y) < 2.2) s = put(s, m.id, 10, 40 + m.y / 10);
    const ladder = s.terrain['n-ladder-1'];
    s = { ...s, terrain: { ...s.terrain, [ladder.id]: { ...ladder, x: 24.95, y: 27, raised: 'n-deeping-2', side: 'p2' } } };
    const uruk = Object.values(s.models).find(m => m.cast === 'uruk')!;
    s = put(s, uruk.id, 25.75, 27);
    expect(crossingAhead(s, s.models[uruk.id], { x: 25.75, y: 27 }, top)).toBeNull();
    expect(climbedLevel(s, top)).toBe(3);
  });
});

describe('Raise the Ladders!', () => {
  it('the ballista grapples the battlements above a ladder, and its bearer goes up with it', () => {
    let s = battle(2);
    s = run(s, { type: 'setPhase', phase: 'shoot' });
    s = run({ ...s, priority: 'p2', flow: { ...s.flow, done: [] } }, { type: 'passHeroic', seat: 'p1' }, { type: 'passHeroic', seat: 'p2' });
    const engine = who(s, 'ballista');
    const ladder = s.terrain['n-ladder-6'];
    s = { ...s, terrain: { ...s.terrain, [ladder.id]: { ...ladder, x: 26, y: 31.5 } } };
    const uruk = Object.values(s.models).find(m => m.cast === 'uruk')!;
    s = put(s, uruk.id, 27.0, 31.5);
    const targets = raiseLadderTargets(s, catalog, engine);
    expect(targets.map(t => t.ladder.id)).toContain(ladder.id);
    // A miss (the crew need 4+) does nothing.
    expect(ask(s, 'p2', { type: 'raiseLadder', model: engine.id, ladder: ladder.id }, [3]).terrain[ladder.id].raised).toBeUndefined();
    const after = ask(s, 'p2', { type: 'raiseLadder', model: engine.id, ladder: ladder.id }, [5]);
    expect(after.terrain[ladder.id].raised).toBe('n-deeping-culvert');
    // The Uruk is now at the top of the ladder, fighting the defender on the walkway there.
    const up = after.models[uruk.id];
    expect(up.x).toBeLessThan(26);
    expect(touchingEnemies(after, up).some(e => e.owner === 'p1' && climbedLevel(after, e) === 3)).toBe(true);
    // It counts as the ballista's shot this turn.
    expect(raiseLadderTargets(after, catalog, after.models[engine.id])).toEqual([]);
  });
});
