import { describe, expect, it } from 'vitest';
import { formatNeed, missileWeapon, woundNeed } from '../src/shared/rules.ts';
import { reduce, initialState } from '../src/shared/reducer.ts';

describe('to wound chart', () => {
  it('reads plain and two-dice results', () => {
    expect(woundNeed(3, 4)).toEqual({ target: 5 });
    expect(woundNeed(1, 6)).toEqual({ target: 6, then: 4 });
    expect(formatNeed(woundNeed(2, 9))).toBe('6+/6+');
    expect(woundNeed(1, 10)).toBeNull();
    expect(woundNeed(10, 1)).toEqual({ target: 3 });
  });

  it('keeps follow-up dice on a roll', () => {
    const s = reduce(initialState(), { type: 'rolled', roll: { id: 'r1', by: 'p1', label: 'x', dice: [6, 2], target: 6, then: 4, follow: [5], at: 1 } });
    expect(s.log[0].follow).toEqual([5]);
    expect(s.log[0].then).toBe(4);
  });
});

describe('missile weapons from wargear', () => {
  it('picks the most specific weapon named', () => {
    expect(missileWeapon(['Armour', 'Elf bow'])?.name).toBe('Elf Bow');
    expect(missileWeapon(['Shield and throwing spears'])?.name).toBe('Throwing Spear');
    expect(missileWeapon(['Exchange spear for crossbow'])?.name).toBe('Crossbow');
    expect(missileWeapon(['Dwarf longbow'])?.name).toBe('Dwarf Longbow');
    expect(missileWeapon(['Shield', 'spear'])).toBeUndefined();
  });
});
