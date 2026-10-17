// Converts the MESBG List Builder's data into the compact file this app ships with.
// Usage: node scripts/import-mlb-data.mjs <path to a clone of mhollink/mesbg-list-builder-v2024>
// The list builder is AGPL-3.0; see src/data/README.md for attribution and what is copied.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] ?? '../mesbg-list-builder-v2024');
const read = f => JSON.parse(readFileSync(join(src, 'src/assets/data', f), 'utf8').replace(/^﻿/, ''));

const units = read('mesbg_data.json');
const profiles = read('profile_data.json');
const armyLists = read('army_list_data.json');

const STATS = ['Mv', 'Fv', 'Sv', 'S', 'D', 'A', 'W', 'C', 'I'];
const profileFor = (origin, name) => profiles[origin]?.[name];

const out = { source: 'https://github.com/mhollink/mesbg-list-builder-v2024', armies: {}, units: {} };

for (const u of Object.values(units)) {
  const p = profileFor(u.profile_origin, u.name);
  const unit = {
    name: u.name,
    army: u.army_list,
    origin: u.profile_origin,
    type: u.unit_type,
    points: u.base_points,
    stats: p ? STATS.map(s => String(p[s] ?? '-')) : undefined,
    // Each entry is [model name or "", "Might:Will:Fate:Wounds"]; several entries mean several models.
    mwfw: u.MWFW?.length ? u.MWFW : undefined,
    options: u.options.map(o => {
      const mount = o.type === 'mount' || Boolean(o.mount_name) || Boolean(profiles.Mounts?.[o.name]);
      const mp = mount ? profileFor('Mounts', o.mount_name ?? o.name) ?? Object.values(profiles).map(x => x[o.mount_name ?? o.name]).find(Boolean) : undefined;
      return {
        id: o.id,
        name: o.name,
        points: o.points,
        ...(o.included ? { included: true } : {}),
        ...(mount ? { mount: true, mountMv: mp?.Mv ? parseFloat(mp.Mv) : undefined } : {}),
        ...(o.modifiers?.length ? { mods: o.modifiers.map(m => [m.stat, m.mod]) } : {}),
      };
    }),
    rules: p ? [...(p.special_rules ?? []), ...(p.active_or_passive_rules ?? []).map(r => r.name)] : [],
    wargear: p?.wargear ?? [],
    ...(u.unique ? { unique: true } : {}),
    ...(u.warband_size ? { warbandSize: u.warband_size } : {}),
    ...(u.opt_mandatory ? { pickOne: true } : {}),
  };
  out.units[u.model_id] = unit;
  (out.armies[u.army_list] ??= { side: u.army_type, units: [] }).units.push(u.model_id);
}

for (const [name, a] of Object.entries(out.armies)) a.rules = (armyLists[name]?.special_rules ?? []).map(r => r.title).filter(Boolean);

const dest = resolve('src/data/mesbg-data.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out.units).length} units in ${Object.keys(out.armies).length} armies to ${dest}`);
