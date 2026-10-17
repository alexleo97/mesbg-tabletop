import { describe, expect, it } from 'vitest';
import { isUuid, mergeLists, newUuid } from '../src/client/cloud.ts';
import type { Roster } from '../src/client/ListBuilder.tsx';

const r = (id: string, name: string, updatedAt?: number): Roster => ({ id, name, army: 'Minas Tirith', entries: [], updatedAt });

describe('syncing army lists', () => {
  it('keeps the newer copy of each list and every list from both sides, newest first', () => {
    const merged = mergeLists([r('a', 'Local edit', 20), r('b', 'Only here', 5)], [r('a', 'Old', 10), r('c', 'Only online', 15)]);
    expect(merged.map(x => x.name)).toEqual(['Local edit', 'Only online', 'Only here']);
    expect(mergeLists([r('a', 'Local', 10)], [r('a', 'Newer online', 30)])[0].name).toBe('Newer online');
  });

  it('makes ids the database accepts', () => {
    expect(isUuid(newUuid())).toBe(true);
    expect(isUuid('k3j9x0ab')).toBe(false);
  });
});
