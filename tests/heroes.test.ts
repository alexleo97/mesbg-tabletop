import { describe, expect, it } from 'vitest';
import { cleanFight, duelLeader, resolveDuel, resolveStrikes, type Fighter } from '../src/shared/fight.ts';
import { heroicsSettled, heroicTurn, orderRollNeeded } from '../src/shared/heroics.ts';
import { initialState, loadState, reduce } from '../src/shared/reducer.ts';
import { inTheWay, moveCost, sightTo } from '../src/shared/sight.ts';
import { gameWinner } from '../src/shared/status.ts';
import type { Action, DiceRoll, GameState, Model, Terrain } from '../src/shared/types.ts';

const m = (id: string, owner: 'p1' | 'p2', x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base: { shape: 'round', w: 25, h: 25 }, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});
const t = (id: string, kind: Terrain['kind'], x: number, y: number, w: number, h: number): Terrain => ({ id, kind, shape: 'rect', x, y, w, h, rot: 0, locked: false });
const run = (s: GameState, ...as: Action[]) => as.reduce(reduce, s);
const dice = (...seq: number[]) => () => seq.shift() ?? 1;
const f = (id: string, s: Partial<Fighter> = {}): Fighter => ({ id, name: id, f: 3, a: 1, s: 3, d: 4, ...s });

/** A started game in the Move phase with player 1 holding Priority. */
function game(...models: Model[]): GameState {
  return run(initialState(), { type: 'addModels', models }, { type: 'startGame' }, { type: 'priorityRolled', roll: [6, 1], chooser: 'p1' }, { type: 'choosePriority', seat: 'p1' });
}

describe('heroic actions', () => {
  it('starts with the player without Priority, spends Might and lets the other side respond after a pass', () => {
    let s = game(m('aragorn', 'p1', 5, 5, { hero: true, might: 3 }), m('lurtz', 'p2', 20, 20, { hero: true, might: 2 }));
    expect(heroicTurn(s)).toBe('p2');
    s = reduce(s, { type: 'passHeroic', seat: 'p2' });
    expect(heroicTurn(s)).toBe('p1');
    s = reduce(s, { type: 'declareHeroic', model: 'aragorn', action: 'Heroic Move' });
    expect(s.models.aragorn.might).toBe(2);
    // Player 2's pass is undone so they can answer it.
    expect(heroicTurn(s)).toBe('p2');
    s = reduce(s, { type: 'declareHeroic', model: 'lurtz', action: 'Heroic Move' });
    expect(orderRollNeeded(s)).toBe(true);
    // Each hero can only declare once a phase, and only actions of this phase.
    expect(reduce(s, { type: 'declareHeroic', model: 'aragorn', action: 'Heroic March' })).toBe(s);
    expect(reduce(s, { type: 'declareHeroic', model: 'lurtz', action: 'Heroic Combat' })).toBe(s);
    expect(heroicsSettled(s)).toBe(true);
  });

  it('skips the step when nobody has Might and clears declarations on a new turn', () => {
    const quiet = game(m('a', 'p1', 5, 5, { hero: true }), m('b', 'p2', 20, 20));
    expect(heroicsSettled(quiet)).toBe(true);
    let s = game(m('a', 'p1', 5, 5, { hero: true, might: 1 }));
    s = reduce(s, { type: 'declareHeroic', model: 'a', action: 'Heroic Move' });
    s = run(s, { type: 'nextPhase' }, { type: 'nextPhase' }, { type: 'nextPhase' }, { type: 'nextPhase' });
    expect(s.turn).toBe(2);
    expect(s.flow.heroics).toEqual([]);
    expect(loadState(JSON.parse(JSON.stringify(reduce(game(m('a', 'p1', 5, 5, { hero: true, might: 1 })), { type: 'declareHeroic', model: 'a', action: 'Heroic Move' })))).flow.heroics).toHaveLength(1);
  });
});

describe('Might', () => {
  const roll = (extra: Partial<DiceRoll>): DiceRoll => ({ id: 'r1', by: 'p1', label: 'x', dice: [3, 5], at: 0, model: 'hero', ...extra });

  it("raises a die on the hero's own roll and spends a point", () => {
    let s = game(m('hero', 'p1', 5, 5, { hero: true, might: 2 }));
    s = run(s, { type: 'rolled', roll: roll({}) }, { type: 'useMight', roll: 'r1', die: 1 }, { type: 'useMight', roll: 'r1', die: 1 });
    expect(s.log.at(-1)).toMatchObject({ dice: [3, 6], might: 1 });
    // Can't go past 6, and the one spent point is all that went.
    expect(s.models.hero.might).toBe(1);
  });

  it("won't touch a warrior's roll or a 6/4+ roll's first dice", () => {
    let s = game(m('hero', 'p1', 5, 5, { hero: true, might: 2 }), m('orc', 'p2', 9, 9, { might: 2 }));
    s = reduce(s, { type: 'rolled', roll: roll({ by: 'p2', model: 'orc' }) });
    expect(reduce(s, { type: 'useMight', roll: 'r1', die: 0 })).toBe(s);
    s = reduce(s, { type: 'rolled', roll: roll({ id: 'r2', target: 6, then: 4, dice: [6, 2], follow: [3] }) });
    expect(reduce(s, { type: 'useMight', roll: 'r2', die: 1 })).toBe(s);
    expect(reduce(s, { type: 'useMight', roll: 'r2', die: 0, follow: true }).log.at(-1)!.follow).toEqual([4]);
  });
});

describe('Fate', () => {
  const fate = (id: string, d: number): DiceRoll => ({ id, by: 'p1', label: 'Fate', dice: [d], target: 4, model: 'hero', at: 0 });

  it('holds wounds on a hero with Fate until each is saved or taken', () => {
    let s = game(m('hero', 'p1', 5, 5, { hero: true, wounds: 2, maxWounds: 2, fate: 2 }));
    s = reduce(s, { type: 'wound', id: 'hero', count: 2 });
    expect(s.models.hero).toMatchObject({ wounds: 2, pending: 2 });
    s = reduce(s, { type: 'fateRolled', id: 'hero', roll: fate('f1', 5) });
    expect(s.models.hero).toMatchObject({ wounds: 2, pending: 1, fate: 1 });
    s = reduce(s, { type: 'fateRolled', id: 'hero', roll: fate('f2', 2) });
    // Out of Fate and Might, the last wound is taken automatically.
    expect(s.models.hero).toMatchObject({ wounds: 1, fate: 0 });
    expect(s.models.hero.pending).toBeUndefined();
  });

  it('lets Might turn a failed Fate roll into a save', () => {
    let s = game(m('hero', 'p1', 5, 5, { hero: true, fate: 1, might: 1 }));
    s = run(s, { type: 'wound', id: 'hero', count: 1 }, { type: 'fateRolled', id: 'hero', roll: fate('f1', 3) });
    expect(s.models.hero).toMatchObject({ pending: 1, fateRoll: 'f1' });
    s = reduce(s, { type: 'useMight', roll: 'f1', die: 0 });
    expect(s.models.hero).toMatchObject({ dead: false, wounds: 1, might: 0 });
    expect(s.models.hero.pending).toBeUndefined();
  });

  it('removes a model with no wounds left, and a hero who takes its wounds', () => {
    let s = game(m('orc', 'p2', 5, 5), m('hero', 'p1', 9, 9, { hero: true, fate: 1 }));
    s = run(s, { type: 'wound', id: 'orc', count: 1 }, { type: 'wound', id: 'hero', count: 1 });
    expect(s.models.orc.dead).toBe(true);
    expect(s.models.hero.dead).toBe(false);
    expect(reduce(s, { type: 'takeWound', id: 'hero' }).models.hero.dead).toBe(true);
  });
});

describe('duel then strikes', () => {
  it('rolls one duel roll per model, adds Heroic Strike, and lets Might change the winner before strikes', () => {
    const req = cleanFight({ sides: [[f('hero', { strike: true })], [f('orc', { f: 5 })]], targets: ['orc', 'hero'] })!;
    // Heroic Strike D6 3 → +2, hero rolls 4, orc rolls 5.
    const duel = resolveDuel(req, dice(3, 4, 5), 'p1', 'g');
    expect(duel.map(r => r.label)).toEqual(['Heroic Strike: hero +2 Fight', 'Duel: hero (F5)', 'Duel: orc (F5)']);
    expect(duelLeader(duel)).toEqual({ winner: 1, how: 'dice' });
    // Might on the hero's 4 makes it 5: tied dice and Fight, so a roll-off (2, 6) goes to the orc.
    duel[1] = { ...duel[1], dice: [5] };
    expect(duelLeader(duel)).toBeNull();
    const { rolls, outcome } = resolveStrikes(req, duel, dice(2, 6, 5), 'p2', 'g');
    expect(rolls[0].label).toMatch(/^Roll-off/);
    expect(outcome).toMatchObject({ winner: 1, how: 'roll-off', wounds: 1 });
  });

  it('only wounds a hero with Heroic Defence on 6s', () => {
    const req = cleanFight({ sides: [[f('troll', { s: 7 })], [f('hero', { defence: true })]], targets: ['hero', 'troll'] })!;
    const { rolls } = resolveStrikes(req, resolveDuel(req, dice(6, 1), 'p1', 'g'), dice(5), 'p1', 'g');
    expect(rolls[0]).toMatchObject({ target: 6, dice: [5] });
  });
});

describe('line of sight and terrain', () => {
  it('hides a model behind a building and counts what is in the way of a shot', () => {
    const s = run(
      initialState(),
      { type: 'addModels', models: [m('archer', 'p1', 2, 10), m('orc', 'p2', 20, 10), m('goblin', 'p2', 20, 30), m('friend', 'p1', 10, 30)] },
      { type: 'addTerrain', terrain: t('house', 'building', 10, 10, 4, 4) },
      { type: 'addTerrain', terrain: t('trees', 'wood', 15, 30, 3, 6) },
    );
    expect(sightTo(s, s.models.archer, s.models.orc)).toBe('hidden');
    expect(sightTo(s, s.models.archer, s.models.goblin)).toBe('clear');
    const shooter = { ...s.models.archer, y: 30 };
    expect(inTheWay(s, shooter, s.models.goblin)).toEqual(['wood', 'friend']);
  });

  it('counts movement through difficult terrain double', () => {
    const s = reduce(initialState(), { type: 'addTerrain', terrain: t('river', 'water', 5, 0, 2, 40) });
    const { cost, difficult } = moveCost(s, { x: 0, y: 10 }, { x: 10, y: 10 });
    expect(difficult).toBe(true);
    expect(cost).toBeCloseTo(12, 0);
    const dry = reduce(s, { type: 'updateTerrain', id: 'river', patch: { difficult: false } });
    expect(moveCost(dry, { x: 0, y: 10 }, { x: 10, y: 10 }).cost).toBe(10);
  });
});

describe('the end of a game', () => {
  it('declares the winner itself, and both players confirm it', () => {
    let s = game(m('a', 'p1', 5, 5), m('b', 'p2', 9, 9));
    expect(gameWinner(s)).toBeNull();
    s = reduce(s, { type: 'wound', id: 'b', count: 1 });
    expect(gameWinner(s)).toBe('p1');
    s = reduce(s, { type: 'gameOver', winner: 'p1' });
    expect(s.result).toEqual({ winner: 'p1', by: 'game', confirmed: [], agreed: false });
    s = reduce(s, { type: 'answerResult', seat: 'p2', agree: true });
    expect(s.result?.agreed).toBe(false);
    // Turning it down does nothing: players fix the score instead.
    expect(reduce(s, { type: 'answerResult', seat: 'p1', agree: false })).toBe(s);
    s = reduce(s, { type: 'answerResult', seat: 'p1', agree: true });
    expect(s.result).toMatchObject({ agreed: true, confirmed: ['p2', 'p1'] });
    s = reduce(s, { type: 'resultSaved' });
    expect(reduce(s, { type: 'gameOver', winner: 'p2' })).toBe(s);
  });

  it('lets a player concede, or offer a draw the other must accept, but never claim a win', () => {
    const s = game(m('a', 'p1', 5, 5));
    expect(reduce(s, { type: 'concede', seat: 'p1' }).result).toEqual({ winner: 'p2', by: 'p1', agreed: true });
    expect(reduce(s, { type: 'proposeResult', seat: 'p1', winner: 'p1' })).toBe(s);
    const offer = reduce(s, { type: 'proposeResult', seat: 'p1', winner: 'draw' });
    expect(reduce(offer, { type: 'answerResult', seat: 'p1', agree: true })).toBe(offer);
    expect(reduce(offer, { type: 'answerResult', seat: 'p2', agree: false }).result).toBeUndefined();
    expect(reduce(offer, { type: 'answerResult', seat: 'p2', agree: true }).result?.agreed).toBe(true);
  });

  it('keeps accounts and the result through a save and load', () => {
    let s = game(m('a', 'p1', 5, 5));
    s = run(s, { type: 'seatAccount', seat: 'p1', account: { id: 'u1', name: 'Alex' } }, { type: 'gameOver', winner: 'draw' }, { type: 'answerResult', seat: 'p2', agree: true });
    const back = loadState(JSON.parse(JSON.stringify(s)));
    expect(back.accounts).toEqual({ p1: { id: 'u1', name: 'Alex' } });
    expect(back.result).toEqual({ winner: 'draw', by: 'game', confirmed: ['p2'], agreed: false });
    expect(reduce(back, { type: 'seatAccount', seat: 'p1', account: null }).accounts).toEqual({});
  });
});
