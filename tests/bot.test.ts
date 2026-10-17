import { describe, expect, it } from 'vitest';
import { botStep, newMemo } from '../src/shared/bot.ts';
import { botRoster, playableArmies } from '../src/shared/botList.ts';
import { entryPoints } from '../src/shared/catalog.ts';
import { duelChance, fightOdds, woundChance } from '../src/shared/odds.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { BOT_NAME, type Model } from '../src/shared/types.ts';
import { catalog, play, seeded, setup } from './botsim.ts';

const base = { shape: 'round' as const, w: 25, h: 25 };
const mk = (id: string, owner: 'p1' | 'p2', x: number, y: number, extra: Partial<Model> = {}): Model => ({
  id, owner, name: id, x, y, rot: 0, base, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra,
});

describe('odds', () => {
  it('weighs duels by dice and Fight', () => {
    expect(duelChance(1, 3, 1, 3)).toBeCloseTo(0.5);
    expect(duelChance(1, 4, 1, 3)).toBeGreaterThan(0.5);
    expect(duelChance(3, 3, 1, 3)).toBeGreaterThan(0.7);
    expect(duelChance(0, 5, 1, 1)).toBe(0);
  });
  it('reads the wound chart', () => {
    expect(woundChance(3, 3)).toBeCloseTo(0.5);
    expect(woundChance(1, 6)).toBeCloseTo(1 / 6 / 2);
    expect(woundChance(1, 10)).toBe(0);
  });
  it('likes a hero against a warrior', () => {
    const hero = { a: 3, f: 5, s: 4, d: 6, w: 2, value: 6 };
    const orc = { a: 1, f: 3, s: 3, d: 4, w: 1, value: 1 };
    expect(fightOdds({ models: [hero] }, { models: [orc] }).score).toBeGreaterThan(0);
    expect(fightOdds({ models: [orc] }, { models: [hero] }).score).toBeLessThan(0);
  });
});

describe("the computer's army", () => {
  it('builds a list for every playable army within the points', () => {
    const rand = seeded(7);
    const armies = playableArmies(catalog);
    expect(armies.length).toBeGreaterThan(40);
    for (const army of armies) {
      const { entries, leader } = botRoster(catalog, army, 500, rand);
      const pts = entries.reduce((n, e) => n + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);
      expect(pts, army).toBeLessThanOrEqual(500);
      expect(entries.length, army).toBeGreaterThan(0);
      expect(leader, army).toBeTruthy();
    }
  });
});

describe('the computer player', () => {
  it('takes a seat and leaves the open games list', () => {
    const s = reduce(initialState(), { type: 'setBot', seat: 'p2' });
    expect(s.bot).toBe('p2');
    expect(s.listed).toBe(false);
    expect(s.names.p2).toBe(BOT_NAME);
    expect(reduce(s, { type: 'setBot', seat: null }).bot).toBeUndefined();
  });

  it('can be told to play faster', () => {
    const s = reduce(initialState(), { type: 'setBotSpeed', speed: 'instant' });
    expect(s.botSpeed).toBe('instant');
    expect(reduce(s, { type: 'setBotSpeed', speed: 'normal' }).botSpeed).toBeUndefined();
    expect(reduce(s, { type: 'setBotSpeed', speed: 'warp' as never }).botSpeed).toBe('instant');
  });

  it('never takes the same wounds twice', () => {
    let s = reduce(initialState(), { type: 'addModels', models: [mk('a', 'p1', 10, 10, { wounds: 3, maxWounds: 3 })] });
    s = reduce(s, { type: 'wound', id: 'a', count: 1, group: 'f-1' });
    s = reduce(s, { type: 'wound', id: 'a', count: 1, group: 'f-1' });
    expect(s.models.a.wounds).toBe(2);
  });

  it('charges a lone enemy it can beat', () => {
    let s = reduce(initialState(), {
      type: 'addModels',
      models: [
        mk('hero', 'p2', 24, 20, { hero: true, wounds: 3, maxWounds: 3, might: 3, points: 160, profileId: '[minas-tirith] boromir-captain-of-the-white-tower' }),
        mk('orc', 'p1', 24, 25, { points: 8, profileId: '[barad-dur] mordor-orc-warrior' }),
      ],
    });
    s = reduce(s, { type: 'startGame', at: 1 });
    s = reduce(s, { type: 'priorityRolled', roll: [1, 6], chooser: 'p2' });
    s = reduce(s, { type: 'choosePriority', seat: 'p2' });
    s = reduce(s, { type: 'passHeroic', seat: 'p1' });
    s = reduce(s, { type: 'passHeroic', seat: 'p2' });
    const step = botStep(s, 'p2', catalog, newMemo(), 5000);
    expect(step?.action?.type).toBe('moveModels');
    s = reduce(s, step!.action!);
    expect(Math.hypot(s.models.hero.x - 24, s.models.hero.y - 25)).toBeLessThan(1.05);
  });

  it('plays whole games to the end without getting stuck', () => {
    for (const seed of [1, 2]) {
      const rand = seeded(seed);
      const { state } = play(setup(['Minas Tirith', 'Legions of Mordor'], 300, seed === 2 ? 'domination' : null, rand), rand);
      expect(state.turn).toBeGreaterThan(2);
      const lost = Object.values(state.models).filter(m => m.dead).length;
      expect(lost).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('premade armies', () => {
  it('are playable armies that fit the points', async () => {
    const { PREMADE, premadeRoster } = await import('../src/shared/premade.ts');
    const armies = playableArmies(catalog);
    for (const p of PREMADE) {
      expect(armies, p.name).toContain(p.army);
      for (const points of [300, 500, 800]) {
        const r = premadeRoster(catalog, p.id, points)!;
        const pts = r.entries.reduce((n, e) => n + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0);
        expect(pts, p.name).toBeLessThanOrEqual(points);
        expect(r.entries.length, p.name).toBeGreaterThan(1);
      }
      expect(premadeRoster(catalog, p.id, 500)).toEqual(premadeRoster(catalog, p.id, 500));
    }
  });
});
