import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { armyLeader, checkList, hasBow, organise } from '../src/shared/warbands.ts';

const catalog: Catalog = JSON.parse(readFileSync(new URL('../src/data/mesbg-data.json', import.meta.url), 'utf8'));
const BOROMIR = '[minas-tirith] boromir-captain-of-the-white-tower';
const CAPTAIN = '[minas-tirith] captain-of-minas-tirith';
const WARRIOR = '[minas-tirith] warrior-of-minas-tirith';
const GUARD = '[minas-tirith] citadel-guard';
const longbow = catalog.units[GUARD].options.find(o => o.name === 'Longbow')!.id;

describe('warbands', () => {
  it('puts followers with their hero and fills older lists into the warbands with the most room', () => {
    const entries = [
      { key: 'b', unitId: BOROMIR, count: 1, optionIds: [] },
      { key: 'c', unitId: CAPTAIN, count: 1, optionIds: [] },
      { key: 'w1', unitId: WARRIOR, count: 10, optionIds: [], lead: 'c' },
      { key: 'w2', unitId: WARRIOR, count: 12, optionIds: [] },
      { key: 'w3', unitId: WARRIOR, count: 8, optionIds: [] },
    ];
    const { warbands, loose } = organise(entries, catalog);
    expect(warbands.map(w => [w.leader.key, w.size, w.max])).toEqual([
      ['b', 20, 15],
      ['c', 10, 12],
    ]);
    expect(loose).toEqual([]);
    expect(armyLeader(entries, catalog)?.key).toBe('b');
    expect(armyLeader(entries, catalog, 'c')?.key).toBe('c');
    const checks = checkList(entries, catalog, 300);
    expect(checks.filter(c => !c.ok).map(c => c.text)).toEqual([
      "Boromir, Captain of the White Tower's warband has 20 models; a Hero of Valour leads up to 15.",
      `${160 + 60 + 30 * 8 - 300} pts over your 300 pt limit.`,
    ]);
  });

  it('checks the bow limit and asks for a hero first', () => {
    expect(hasBow(catalog.units[GUARD], [])).toBe(false);
    expect(hasBow(catalog.units[GUARD], [longbow])).toBe(true);
    const entries = [
      { key: 'g', unitId: GUARD, count: 5, optionIds: [longbow] },
      { key: 'w', unitId: WARRIOR, count: 5, optionIds: [] },
    ];
    const checks = checkList(entries, catalog);
    expect(checks.map(c => [c.ok, c.text])).toEqual([
      [false, 'Add a hero to lead your first warband.'],
      [false, "2 units aren't in a warband yet."],
      [false, '5 of 10 warriors carry bows (this army allows 4, a third rounded up)'],
    ]);
    expect(checkList(entries, catalog, undefined, 0.5).at(-1)).toEqual({ ok: true, text: '5 of 10 warriors carry bows (this army allows 5, half rounded up)' });
  });
});
