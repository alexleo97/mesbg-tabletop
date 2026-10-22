import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryPoints, type Catalog } from '../src/shared/catalog.ts';
import { PREMADE, PREMADE_SIZES, premadeRoster, premadeSize } from '../src/shared/premade.ts';
import { armyLeader, checkList, isWarrior, organise } from '../src/shared/warbands.ts';

const catalog: Catalog = JSON.parse(readFileSync(new URL('../src/data/mesbg-data.json', import.meta.url), 'utf8'));
const THROWING = /throwing/i;
// Armies whose rules name the General.
const GENERAL: Record<string, string> = {
  Arnor: 'Arvedui, Last King of Arnor',
  'Muster of Isengard': 'Saruman',
  'Goblin-town': 'The Goblin King',
  'The Serpent Horde': 'Suladan, The Serpent Lord',
};

describe('premade armies', () => {
  for (const p of PREMADE)
    for (const size of PREMADE_SIZES)
      it(`${p.name} at ${size} pts is a legal list`, () => {
        const army = catalog.armies[p.army];
        const r = premadeRoster(catalog, p.id, size)!;
        // Every unit and option named in the list is in the army's data.
        const bands = p.lists[size];
        expect(r.entries.length).toBe(bands.reduce((n, b) => n + 1 + (b.with?.length ?? 0), 0));
        expect(r.entries.reduce((n, e) => n + e.optionIds.length, 0)).toBe(bands.reduce((n, b) => n + (b.options?.length ?? 0) + (b.with ?? []).reduce((m, f) => m + f.length - 2, 0), 0));

        expect(r.entries.reduce((n, e) => n + entryPoints(catalog.units[e.unitId], e.optionIds, e.count), 0)).toBe(size);
        expect(checkList(r.entries, catalog, size, army.bowLimit, army.restrictions).filter(c => !c.ok)).toEqual([]);

        const { warbands, loose } = organise(r.entries, catalog);
        expect(loose).toEqual([]);
        for (const w of warbands) for (const m of w.members) if (w.unit.followers) expect(w.unit.followers, w.unit.name).toContain(m.unitId);
        const unique = r.entries.filter(e => catalog.units[e.unitId].unique).map(e => e.unitId);
        expect(new Set(unique).size).toBe(unique.length);
        for (const e of r.entries) if (catalog.units[e.unitId].pickOne) expect(e.optionIds.length).toBeLessThanOrEqual(1);

        const warriors = r.entries.filter(e => isWarrior(catalog.units[e.unitId]));
        const throwers = warriors.filter(e => catalog.units[e.unitId].wargear.some(g => THROWING.test(g)) || catalog.units[e.unitId].options.some(o => e.optionIds.includes(o.id) && THROWING.test(o.name)));
        const count = (es: typeof warriors) => es.reduce((n, e) => n + e.count, 0);
        expect(count(throwers)).toBeLessThanOrEqual(Math.ceil(count(warriors) / 3));

        if (GENERAL[p.army]) expect(catalog.units[armyLeader(r.entries, catalog, r.leader)!.unitId].name).toBe(GENERAL[p.army]);
      });

  it('picks the size closest to the points asked for', () => {
    expect([300, 500, 625, 626, 750, 1000].map(premadeSize)).toEqual([500, 500, 500, 750, 750, 750]);
    expect(premadeRoster(catalog, 'white-tower', 600)).toEqual(premadeRoster(catalog, 'white-tower', 500));
    expect(premadeRoster(catalog, 'nobody', 500)).toBeNull();
  });
});
