import { describe, expect, it } from 'vitest';
import { admiralLines, parseAdmiral } from '../src/shared/admiral.ts';
import type { Catalog } from '../src/shared/catalog.ts';
import data from '../src/data/mesbg-data.json';

const catalog = data as unknown as Catalog;
const SAMPLE = `(Thror, King Under the Mountain: )
    (9x Erebor Dwarf Warrior: Shield and Spear)

(Dwarf King: )
    (13x Grim Hammer Warrior: )

(Erebor Dwarf Captain: )
    (9x Erebor Dwarf Warrior: )`;

describe('Tabletop Admiral import', () => {
  it('reads warbands, counts and options', () => {
    let k = 0;
    const list = parseAdmiral(SAMPLE, catalog, () => `k${k++}`)!;
    expect(list.army).toBe('Army of Thror');
    expect(list.missing).toEqual([]);
    expect(list.entries.map(e => [e.unitId.split('] ')[1], e.count, e.optionIds.length, e.lead ?? null])).toEqual([
      ['thror-king-under-the-mountain', 1, 0, null],
      ['erebor-dwarf-warrior', 9, 1, 'k0'],
      ['dwarf-king', 1, 0, null],
      ['grim-hammer-warrior', 13, 0, 'k2'],
      ['erebor-dwarf-captain', 1, 0, null],
      ['erebor-dwarf-warrior', 9, 0, 'k4'],
    ]);
  });

  it('leaves other text to the other importers', () => {
    expect(admiralLines('12x Warrior of Minas Tirith')).toBeNull();
    expect(admiralLines('{"warbands": []}')).toBeNull();
  });
});
