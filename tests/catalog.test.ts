import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entriesFor, entryPoints, parseBuilderExport, pictureUrl, type Catalog } from '../src/shared/catalog.ts';

const catalog: Catalog = JSON.parse(readFileSync(new URL('../src/data/mesbg-data.json', import.meta.url), 'utf8'));
const THRANDUIL = '[halls-of-thranduil] thranduil-king-of-the-woodland-realm';
const GUARD = '[halls-of-thranduil] palace-guard';

describe('bundled data', () => {
  it('covers every army list with stats for every unit', () => {
    expect(Object.keys(catalog.armies).length).toBeGreaterThan(100);
    const noStats = Object.values(catalog.units).filter(u => !u.stats);
    expect(noStats).toEqual([]);
  });
});

describe('entriesFor', () => {
  it('puts a mounted hero on its mount\'s base with the mount\'s move', () => {
    const unit = catalog.units[THRANDUIL];
    const elk = unit.options.find(o => o.name === 'Great Elk')!;
    const [e] = entriesFor(THRANDUIL, unit, [elk.id], 1);
    expect(e).toMatchObject({ name: unit.name, hero: true, might: 3, will: 3, fate: 3, wounds: 3, move: 10, base: { shape: 'round', w: 50, h: 50 } });
    expect(e.options).toEqual(['Great Elk']);
  });

  it('keeps a foot hero on a round base with the profile move', () => {
    const [e] = entriesFor(THRANDUIL, catalog.units[THRANDUIL], [], 1);
    expect(e).toMatchObject({ move: 6, base: { shape: 'round', w: 25 } });
  });

  it('splits multi-model units into their models', () => {
    const id = "[army-of-lake-town] bard's-family";
    const out = entriesFor(id, catalog.units[id], [], 1);
    expect(out.map(e => [e.name, e.wounds])).toEqual([
      ['Bain, Son of Bard', 2],
      ['Sigrid', 1],
      ['Tilda', 1],
    ]);
  });

  it('adds option points per model', () => {
    const unit = catalog.units[GUARD];
    expect(entryPoints(unit, ['OPT0768'], 10)).toBe(140);
  });

  it('counts the options a model comes with', () => {
    // The Black Riders' Ringwraith is priced by its included profile and horse: 105 points (errata).
    expect(entryPoints(catalog.units['[the-black-riders] ringwraith'], [], 1)).toBe(105);
    // A Royal Guard in the Pelennor list comes mounted, the same price as one given a horse in Kingdom of Rohan.
    expect(entryPoints(catalog.units['[defenders-of-the-pelennor] rohan-royal-guard'], [], 1)).toBe(16);
    // Already listed among the chosen options, it's still counted once.
    const wraith = catalog.units['[the-black-riders] ringwraith'];
    expect(entryPoints(wraith, wraith.options.map(o => o.id).filter(id => wraith.options.find(o => o.id === id)?.included), 1)).toBe(105);
  });
});

describe('parseBuilderExport', () => {
  it('reads the list builder\'s export format', () => {
    const exported = JSON.stringify({
      metadata: { leader: 'x' },
      warbands: [
        {
          id: 'w1',
          hero: { model_id: THRANDUIL, MWFW: [['', '3:3:3:3']], options: [{ id: 'OPT0758', name: 'Great Elk', quantity: 1 }], compulsory: false },
          units: [
            { model_id: GUARD, MWFW: [], options: [{ id: 'OPT0768', name: 'Shield and Elven spear', quantity: 10 }], quantity: 10 },
            { model_id: '[nope] unknown', MWFW: [], options: [], quantity: 2 },
          ],
          meta: {},
        },
      ],
      id: 'r1',
      version: '1',
      name: 'Woodland Realm',
      armyList: 'Halls of Thranduil',
      edition: 'v2024',
    });
    const r = parseBuilderExport(exported, catalog)!;
    expect(r.name).toBe('Woodland Realm');
    expect(r.missing).toEqual(['[nope] unknown']);
    expect(r.entries.map(e => [e.name, e.count, e.base?.shape])).toEqual([
      ['Thranduil, King of the Woodland Realm', 1, 'round'],
      ['Palace Guard', 10, 'round'],
    ]);
  });

  it('returns null for other text', () => {
    expect(parseBuilderExport('12x Orc', catalog)).toBeNull();
    expect(parseBuilderExport('{"a":1}', catalog)).toBeNull();
  });
});

it('builds picture URLs on the list builder\'s image host', () => {
  expect(pictureUrl({ origin: 'Elven Kingdoms', name: 'Palace Guard' })).toBe(
    'https://resources.mesbg-list-builder.com/v2024/images/profiles/Elven%20Kingdoms/pictures/Palace%20Guard.png',
  );
});

describe('base sizes', () => {
  it('gives every profile and mount a base from the books', () => {
    const odd: string[] = [];
    for (const [id, unit] of Object.entries(catalog.units)) {
      for (const e of entriesFor(id, unit, [], 1)) if (e.base?.shape === 'rect') odd.push(e.name);
      for (const o of unit.options.filter(o => o.mount)) {
        const [e] = entriesFor(id, unit, [o.id], 1);
        if (e.base!.w < 40) odd.push(`${unit.name} with ${o.name}`);
      }
    }
    expect(odd).toEqual([]);
    const rider = Object.entries(catalog.units).find(([, u]) => u.name === 'Rider of Rohan')!;
    expect(entriesFor(rider[0], rider[1], [], 1)[0].base).toEqual({ shape: 'round', w: 40, h: 40 });
    const ent = Object.entries(catalog.units).find(([, u]) => u.name === 'Treebeard')!;
    expect(entriesFor(ent[0], ent[1], [], 1)[0].base).toEqual({ shape: 'round', w: 60, h: 60 });
  });
});
