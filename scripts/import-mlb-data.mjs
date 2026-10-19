// Converts the MESBG List Builder's data into the compact file this app ships with.
// Usage: node scripts/import-mlb-data.mjs <path to a clone of mhollink/mesbg-list-builder-v2024>
// The list builder is AGPL-3.0; see src/data/README.md for attribution and what is copied.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] ?? '../mesbg-list-builder-v2024');
const read = f => JSON.parse(readFileSync(join(src, 'src/assets/data', f), 'utf8').replace(/^﻿/, ''));

// Our own fixes to the source data, by option id: a shield the source forgot gives +1 Defence.
const OPTION_MODS = { OPT1432: [['D', 1]], OPT1116: [['D', 1]] };
// And rule names the source spells differently from the book.
const RULE_NAMES = { 'Embedded Axe-blade': 'Embedded Axe' };
const ruleName = name => RULE_NAMES[name] ?? name;

const units = read('mesbg_data.json');
const profiles = read('profile_data.json');
const armyLists = read('army_list_data.json');
const keywords = read('keywords.json');
const constraints = read('hero_constraint_data.json');

// Rules text is never copied: each rule gets an id, and src/data/rules-text.json holds our own
// explanation of it under that id (written separately, in plain words, from the original as reference).
const textId = (kind, name, text) => createHash('sha1').update(`${kind}|${name}|${text}`).digest('hex').slice(0, 10);
const written = existsSync(resolve('src/data/rules-text.json')) ? JSON.parse(readFileSync(resolve('src/data/rules-text.json'), 'utf8')) : {};
const missing = new Set();
const ref = id => {
  if (!written[id]) missing.add(id);
  return id;
};
// "Throw Stones (range 8", Strength 1)" and "Throw Stones (X)" are the same rule.
// A few profiles spell Hatred as "Hated".
const plain = s => s.replace(/\s*\(.*?\)\s*/g, '').trim().replace(/\.$/, '').toLowerCase().replace(/^hated$/, 'hatred');
const universal = new Map(keywords.map(k => [plain(k.name), textId(k.type, k.name, k.description)]));
const universalRef = name => (universal.has(plain(name)) ? ref(universal.get(plain(name))) : undefined);

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
        ...(o.modifiers?.length ? { mods: o.modifiers.map(m => [m.stat, m.mod]) } : OPTION_MODS[o.id] ? { mods: OPTION_MODS[o.id] } : {}),
      };
    }),
    rules: p ? [...(p.special_rules ?? []), ...(p.active_or_passive_rules ?? []).map(r => ruleName(r.name))] : [],
    // Which explanation goes with each rule, heroic action and magical power on the card.
    ruleRefs: p
      ? Object.fromEntries(
          [
            ...(p.special_rules ?? []).map(r => [r, universalRef(r)]),
            ...(p.active_or_passive_rules ?? []).map(r => [ruleName(r.name), ref(textId('hero_rule', r.name, r.description))]),
            ...(p.heroic_actions ?? []).map(h => [h, universalRef(h)]),
            ...(p.magic_powers ?? []).map(m => [m.name, universalRef(m.name)]),
          ].filter(([, id]) => id),
        )
      : undefined,
    ...(p?.heroic_actions?.length ? { heroics: p.heroic_actions } : {}),
    ...(p?.magic_powers?.length ? { powers: p.magic_powers.map(m => ({ name: m.name, range: m.range, cast: m.cast })) } : {}),
    ...(constraints[u.model_id]?.valid_warband_units?.length ? { followers: constraints[u.model_id].valid_warband_units } : {}),
    wargear: p?.wargear ?? [],
    ...(u.unique ? { unique: true } : {}),
    ...(u.warband_size ? { warbandSize: u.warband_size } : {}),
    ...(u.opt_mandatory ? { pickOne: true } : {}),
  };
  out.units[u.model_id] = unit;
  (out.armies[u.army_list] ??= { side: u.army_type, units: [] }).units.push(u.model_id);
}

for (const [name, a] of Object.entries(out.armies)) {
  const list = armyLists[name] ?? {};
  a.rules = (list.special_rules ?? []).map(r => r.title).filter(Boolean);
  a.bonuses = (list.special_rules ?? []).map(r => ({ name: r.title ?? '', id: ref(textId('army_bonus', r.title ?? '', r.description)) }));
  a.restrictions = (list.additional_rules ?? []).map(r => ref(textId('army_restriction', '', r.description)));
  if (typeof list.bow_limit === 'number') a.bowLimit = list.bow_limit;
  if (typeof list.throw_limit === 'number') a.throwLimit = list.throw_limit;
}

const dest = resolve('src/data/mesbg-data.json');
writeFileSync(dest, JSON.stringify(out));
if (missing.size) console.warn(`${missing.size} rules have no explanation in src/data/rules-text.json yet.`);
console.log(`Wrote ${Object.keys(out.units).length} units in ${Object.keys(out.armies).length} armies to ${dest}`);
