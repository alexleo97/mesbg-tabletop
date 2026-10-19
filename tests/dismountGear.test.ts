import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/shared/catalog.ts';
import { onFoot } from '../src/shared/cavalry.ts';
import { hasSpear } from '../src/shared/gear.ts';
import type { Model } from '../src/shared/types.ts';

const catalog: Catalog = JSON.parse(readFileSync(new URL('../src/data/mesbg-data.json', import.meta.url), 'utf8'));
const rider = (profileId: string, options: string[]): Model => ({ id: 'w', owner: 'p2', name: 'Warg Rider', x: 10, y: 10, rot: 0, base: { shape: 'oval', w: 60, h: 35 }, move: 10, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, profileId, options });
const MORDOR = '[barad-dur] mordor-warg-rider';
const ISENGARD = '[wolves-of-isengard] isengard-warg-rider';

describe('Warg Riders getting down (FAQ)', () => {
  it('keeps the shield but not the throwing spears', () => {
    expect(onFoot(catalog, rider(MORDOR, ['Shield and throwing spears'])).options).toEqual(['Shield']);
  });

  it('turns throwing spears into a spear it can support with', () => {
    const m = rider(ISENGARD, ['Throwing spears']);
    const foot = { ...m, ...onFoot(catalog, m) };
    expect(foot.options).toEqual(['Spear']);
    expect(hasSpear(catalog, foot)).toBe(true);
  });

  it('keeps an Orc bow or a shield as it is', () => {
    expect(onFoot(catalog, rider(MORDOR, ['Orc bow'])).options).toEqual(['Orc bow']);
    expect(onFoot(catalog, rider(ISENGARD, ['Shield'])).options).toEqual(['Shield']);
  });
});
