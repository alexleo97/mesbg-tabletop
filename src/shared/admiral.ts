import type { Catalog } from './catalog.ts';
import type { WarbandEntry } from './warbands.ts';

// Reads lists copied from Tabletop Admiral's TTS view, which writes each warband as a hero line followed by its
// followers, indented:
//   (Hero Name: option, option)
//       (9x Warrior Name: option)

const LINE = /^(\s*)\((?:(\d{1,3})\s*[x×]\s*)?([^:()]+?)\s*:\s*([^()]*)\)\s*$/i;

/** Names compared without accents, punctuation or case, so "Thrór" finds "Thror". */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface Line {
  indent: boolean;
  count: number;
  name: string;
  options: string[];
}

/** The lines of a Tabletop Admiral list, or null when the text isn't one. */
export function admiralLines(text: string): Line[] | null {
  const rows = text.split(/\r?\n/).filter(l => l.trim());
  if (!rows.length) return null;
  const lines: Line[] = [];
  for (const row of rows) {
    const m = row.match(LINE);
    if (!m) return null;
    lines.push({
      indent: m[1].length > 0,
      count: m[2] ? Math.min(100, parseInt(m[2], 10)) : 1,
      name: m[3].trim(),
      options: m[4]
        .split(/\s*,\s*/)
        .map(o => o.trim())
        .filter(Boolean),
    });
  }
  return lines;
}

export interface AdmiralList {
  army: string;
  entries: WarbandEntry[];
  /** Names that matched no profile in the army. */
  missing: string[];
}

/**
 * Turns a Tabletop Admiral list into a roster in our builder: picks the army that has every profile in the list
 * (the one named after a hero in the list when several do), then each profile and its chosen options by name.
 */
export function parseAdmiral(text: string, catalog: Catalog, key: () => string): AdmiralList | null {
  const lines = admiralLines(text);
  if (!lines) return null;
  const names = [...new Set(lines.map(l => norm(l.name)))];
  const inArmy = (army: string) => new Map(catalog.armies[army].units.filter(id => catalog.units[id]).map(id => [norm(catalog.units[id].name), id]));
  const scored = Object.keys(catalog.armies)
    .map(army => {
      const units = inArmy(army);
      const found = names.filter(n => units.has(n)).length;
      // An army named after one of the list's named characters (Army of Thror for Thror) is the likelier pick.
      const named = names.some(n => catalog.units[units.get(n) ?? '']?.unique && norm(army).split(' ').includes(n.split(' ')[0]));
      return { army, found, named, size: units.size };
    })
    .filter(a => a.found > 0)
    .sort((a, b) => b.found - a.found || Number(b.named) - Number(a.named) || a.size - b.size);
  const army = scored[0]?.army;
  if (!army) return { army: '', entries: [], missing: lines.map(l => l.name) };
  const units = inArmy(army);
  const entries: WarbandEntry[] = [];
  const missing: string[] = [];
  let lead: string | undefined;
  for (const l of lines) {
    const id = units.get(norm(l.name));
    if (!id) {
      missing.push(l.name);
      continue;
    }
    const unit = catalog.units[id];
    const optionIds = l.options
      .map(o => unit.options.find(x => norm(x.name) === norm(o))?.id)
      .filter((o): o is string => !!o);
    const entry: WarbandEntry = { key: key(), unitId: id, count: l.count, optionIds };
    // Indented lines follow the hero above them.
    if (l.indent && lead) entry.lead = lead;
    else if (!l.indent) lead = entry.key;
    entries.push(entry);
  }
  return { army, entries, missing };
}
