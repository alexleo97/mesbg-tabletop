import { describe, expect, it } from 'vitest';
import { deployList, guessBase, parseList } from '../src/shared/importList.ts';
import { distanceBetween } from '../src/shared/geometry.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';

describe('parseList', () => {
  it('reads nested JSON warbands and skips wargear options', () => {
    const json = JSON.stringify({
      name: 'Gondor',
      warbands: [
        {
          hero: { name: 'Captain of Minas Tirith', unit_type: 'Hero of Fortitude', quantity: 1, MWFW: [['Captain', '2', '1', '1']], options: [{ name: 'Shield', quantity: 1 }] },
          units: [
            { name: 'Warrior of Minas Tirith', quantity: 8, unit_type: 'Warrior', options: [{ name: 'Shield', quantity: 8 }] },
            { name: 'Knight of Minas Tirith', quantity: 2, unit_type: 'Warrior' },
          ],
        },
      ],
    });
    const out = parseList(json);
    expect(out.map(e => [e.name, e.count, e.hero])).toEqual([
      ['Captain of Minas Tirith', 1, true],
      ['Warrior of Minas Tirith', 8, false],
      ['Knight of Minas Tirith', 2, false],
    ]);
    expect(out[0]).toMatchObject({ might: 2, will: 1, fate: 1 });
  });

  it('reads a text list', () => {
    const out = parseList(`Army: Minas Tirith
Warband 1
Captain of Minas Tirith (70 pts)
 - 12x Warrior of Minas Tirith with shield
 - 3 Knights of Minas Tirith (shield, lance)
Total points: 300`);
    expect(out.map(e => [e.name, e.count, e.hero])).toEqual([
      ['Captain of Minas Tirith', 1, true],
      ['Warrior of Minas Tirith', 12, false],
      ['Knights of Minas Tirith', 3, false],
    ]);
  });
});

describe('guessBase', () => {
  it('picks cavalry, monster and infantry bases', () => {
    expect(guessBase('Knight of Minas Tirith')).toEqual({ shape: 'rect', w: 25, h: 50 });
    expect(guessBase('Cave Troll')).toEqual({ shape: 'round', w: 40, h: 40 });
    expect(guessBase('Mordor Orc Warrior')).toEqual({ shape: 'round', w: 25, h: 25 });
  });
});

describe('deployList', () => {
  it('deploys without overlapping, and a second import lands behind the first', () => {
    let s = initialState();
    const first = deployList([{ name: 'Warrior', count: 30, hero: false }], 'p1', s);
    s = reduce(s, { type: 'addModels', models: first });
    const second = deployList([{ name: 'Knight on horse', count: 10, hero: false }], 'p1', s);
    const all = [...first, ...second];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(distanceBetween(all[i], all[j])).toBeGreaterThan(0.05);
    for (const m of all) {
      expect(m.x).toBeGreaterThan(0);
      expect(m.x).toBeLessThan(48);
      expect(m.y).toBeGreaterThan(36);
    }
  });

  it('puts player 2 at the top of the board facing down', () => {
    const [m] = deployList([{ name: 'Orc', count: 1, hero: false }], 'p2', initialState());
    expect(m.y).toBeLessThan(3);
    expect(m.rot).toBe(180);
  });
});
