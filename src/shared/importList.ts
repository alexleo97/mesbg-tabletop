import { bookBase, round } from './bases.ts';
import { mmToIn } from './geometry.ts';
import type { Base, GameState, Model, Seat } from './types.ts';

/** One line of an army list: a profile and how many of it. */
export interface ListEntry {
  name: string;
  count: number;
  hero: boolean;
  move?: number;
  wounds?: number;
  might?: number;
  will?: number;
  fate?: number;
  /** Known base; otherwise it's guessed from the name. */
  base?: Base;
  /** Unit id in the bundled MESBG data, for stats and photos. */
  profileId?: string;
  /** Chosen wargear and upgrades. */
  options?: string[];
  /** The warband this belongs to (the same for a hero and their followers), so it deploys as one group. */
  group?: string;
  /** The army's General; what one model cost; its heroic tier. Scenarios score these. */
  general?: boolean;
  points?: number;
  tier?: number;
}

const NAME_KEYS = ['name', 'profile_origin', 'model_name', 'unit_name', 'title'];
const COUNT_KEYS = ['quantity', 'qty', 'count', 'amount', 'num_models', 'number'];
// Children that describe wargear rather than separate models.
const SKIP_KEYS = new Set(['options', 'option', 'equipment', 'wargear', 'rules', 'special_rules', 'mount_options']);

const pick = (o: Record<string, unknown>, keys: string[]) => keys.map(k => o[k]).find(v => v !== undefined && v !== null && v !== '');

function statFrom(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+(\.\d+)?"?$/.test(v.trim())) return parseFloat(v);
  }
  return undefined;
}

function looksLikeUnit(o: Record<string, unknown>): boolean {
  const name = pick(o, NAME_KEYS);
  if (typeof name !== 'string') return false;
  return (
    pick(o, COUNT_KEYS) !== undefined ||
    'unit_type' in o ||
    'points' in o ||
    'pointsPerUnit' in o ||
    'MWFW' in o ||
    'profile' in o
  );
}

function isHero(o: Record<string, unknown>): boolean {
  if (o.hero === true || o.isHero === true) return true;
  const t = String(o.unit_type ?? o.type ?? o.role ?? '');
  if (/hero|legend|valour|fortitude|minor|independent/i.test(t)) return true;
  // MWFW is usually a list of hero stat lines, e.g. [["Aragorn","3","3","3"]] in the builder's data.
  const mwfw = o.MWFW;
  return Array.isArray(mwfw) ? mwfw.length > 0 : typeof mwfw === 'string' && mwfw.length > 0;
}

function heroStats(o: Record<string, unknown>) {
  const mwfw = o.MWFW;
  if (Array.isArray(mwfw) && Array.isArray(mwfw[0])) {
    const [, m, w, f] = mwfw[0] as unknown[];
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    return { might: n(m), will: n(w), fate: n(f) };
  }
  return {
    might: statFrom(o, ['might', 'M_might', 'Might']),
    will: statFrom(o, ['will', 'Will']),
    fate: statFrom(o, ['fate', 'Fate']),
  };
}

function walk(node: unknown, out: ListEntry[], depth: number): void {
  if (depth > 12 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (looksLikeUnit(o)) {
    const count = Number(pick(o, COUNT_KEYS) ?? 1);
    out.push({
      name: String(pick(o, NAME_KEYS)).trim(),
      count: Number.isFinite(count) ? Math.max(0, Math.min(100, Math.round(count))) : 1,
      hero: isHero(o),
      move: statFrom(o, ['move', 'Mv', 'movement', 'Move']),
      wounds: statFrom(o, ['wounds', 'W', 'Wounds']),
      ...heroStats(o),
    });
  }
  for (const [k, v] of Object.entries(o)) {
    if (!SKIP_KEYS.has(k) && v && typeof v === 'object') walk(v, out, depth + 1);
  }
}

const HEADER = /^(warband|army|total|points|pts|bow limit|throwing|models|alliance|faction|list)\b|:\s*$/i;

/** Parses the list builder's text export, e.g. "12x Warrior of Minas Tirith (shield)". */
export function parseTextList(text: string): ListEntry[] {
  const out: ListEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s\-•*–>|]+/, '').trim();
    if (!line || HEADER.test(line) || /^[=\-_#]+$/.test(line)) continue;
    const m = line.match(/^(\d{1,3})\s*[x×]?\s+(.+)$/i);
    const count = m ? parseInt(m[1], 10) : 1;
    let name = (m ? m[2] : line)
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\b\d+\s*(pts|points)\b.*$/i, '')
      .replace(/\s+with\s+.*$/i, '')
      .replace(/\s*[,;:-]\s*$/, '')
      .trim();
    // Without a count and without points, a line is probably a heading or note.
    if (!m && !/\b(pts|points)\b/i.test(line)) continue;
    if (!name || count < 1) continue;
    name = name.slice(0, 80);
    out.push({ name, count: Math.min(count, 100), hero: !m && /\b(pts|points)\b/i.test(line) });
  }
  return out;
}

/** Reads a list in any supported format: the builder's JSON export, or its text view. */
export function parseList(input: string): ListEntry[] {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const out: ListEntry[] = [];
      walk(JSON.parse(trimmed), out, 0);
      return out.filter(e => e.name && e.count > 0);
    } catch {
      // Not valid JSON after all; fall through to the text parser.
    }
  }
  return parseTextList(trimmed);
}

/** Guesses the base for a profile from its name. Players can change it on the board. */
export function guessBase(name: string): Base {
  const known = bookBase(name);
  if (known) return known;
  const n = name.toLowerCase();
  if (/m[uû]mak|oliphaunt/.test(n)) return { shape: 'oval', w: 140, h: 180 };
  if (/dragon|balrog|fell beast|great beast|war beast|smaug|watcher|\bent\b|treebeard|eagle|gwaihir|mordor troll|isengard troll/.test(n)) return round(60);
  if (/cave troll|hill troll|snow troll|\btroll|ogre|giant|werewolf/.test(n)) return round(50);
  if (/chariot|war ?wagon/.test(n)) return round(60);
  if (/catapult|trebuchet/.test(n)) return { shape: 'oval', w: 92, h: 120 };
  if (/ballista|bolt thrower|siege|bear\b|spider queen|shelob/.test(n)) return round(40);
  // Whole words only: "Aragorn, Strider" is on foot. Riders use their mount's base.
  if (/\bcavalry\b|\bknights?\b|\briders?\b|\bon (horse|horseback|warg|pony|elk|goat|boar|fell)|\bmounted\b|\bhorse(man|men)\b|\boutriders?\b/.test(n))
    return round(40);
  return round(25);
}

function defaultMove(name: string, base: Base): number {
  const n = name.toLowerCase();
  if (/hobbit|dwar|gollum|goblin(?! rider)|halfling/.test(n)) return 5;
  if (/eagle|fell beast|bat/.test(n)) return 12;
  if (base.w === 40 && /\bcavalry\b|\bknights?\b|\briders?\b|\bmounted\b|\bhorse(man|men)\b|\boutriders?\b/.test(n)) return 10;
  return 6;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** One model waiting to be placed, with its base size in inches. */
interface Pending {
  e: ListEntry;
  base: Base;
  w: number;
  h: number;
}

/**
 * Lays out an army in its deployment zone, clear of any models already on the table.
 * Player 1 deploys from the bottom edge, player 2 from the top, so armies never land on each other.
 * Each warband is placed as its own block (heroes at the front, followers in ranks behind) with a gap between
 * warbands, and a warband deployed later goes beside the ones already there.
 */
export function deployList(entries: ListEntry[], owner: Seat, state: Pick<GameState, 'board' | 'models'>): Model[] {
  const { w: boardW, h: boardH } = state.board;
  const placed: Model[] = [];
  const gap = 0.15;
  const blockGap = 1.5;
  const margin = 1;
  const usable = boardW - margin * 2;
  // Towards the enemy: up the table for player 1, down for player 2.
  const inward = owner === 'p1' ? -1 : 1;
  const edge = owner === 'p1' ? boardH - margin : margin;

  // Everything already on the table, as boxes to keep clear of.
  const boxes = Object.values(state.models)
    .filter(m => !m.dead)
    .map(m => {
      const r = mmToIn(Math.max(m.base.w, m.base.h)) / 2;
      return { x0: m.x - r, x1: m.x + r, y0: m.y - r, y1: m.y + r };
    });

  // Warbands in list order; entries without a group form one shared block.
  const groups = new Map<string, Pending[]>();
  for (const e of entries) {
    const base = e.base ?? guessBase(e.name);
    const list = groups.get(e.group ?? '') ?? [];
    for (let i = 0; i < e.count; i++) list.push({ e, base, w: mmToIn(base.w), h: mmToIn(base.h) });
    groups.set(e.group ?? '', list);
  }

  // Each warband as a block: heroes in the front rank, then followers (foot before riders) in ranks about twice as
  // wide as they are deep. Spots are relative to the block's back-left corner, with depth measured towards the enemy.
  type Spot = { m: Pending; x: number; depth: number };
  const perRank = Math.max(1, Math.floor(usable / 1.15));
  const blocks = [...groups.values()].map(models => {
    const heroes = models.filter(m => m.e.hero);
    const rest = models.filter(m => !m.e.hero).sort((p, q) => p.h - q.h);
    const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(rest.length * 2)), perRank));
    const rows: Pending[][] = [];
    for (let i = 0; i < heroes.length; i += perRank) rows.push(heroes.slice(i, i + perRank));
    for (let i = 0; i < rest.length; ) {
      // One kind of base per rank, so riders don't stagger the foot.
      const h = rest[i].h;
      const row: Pending[] = [];
      while (i < rest.length && row.length < cols && rest[i].h === h) row.push(rest[i++]);
      rows.push(row);
    }
    const rowWidth = (r: Pending[]) => r.reduce((a, m) => a + m.w, 0) + gap * (r.length - 1);
    const w = Math.min(usable, Math.max(...rows.map(rowWidth)));
    const spots: Spot[] = [];
    let depth = 0;
    for (let ri = rows.length - 1; ri >= 0; ri--) {
      const r = rows[ri];
      const rh = Math.max(...r.map(m => m.h));
      let x = (w - rowWidth(r)) / 2;
      for (const m of r) {
        spots.push({ m, x: x + m.w / 2, depth: depth + rh / 2 });
        x += m.w + gap;
      }
      depth += rh + gap;
    }
    return { w, d: depth - gap, spots };
  });

  // Blocks side by side in bands across the table.
  const bands: { w: number; d: number; spots: Spot[] }[] = [];
  for (const b of blocks) {
    const band = bands[bands.length - 1];
    if (band && band.w + blockGap + b.w <= usable) {
      const off = band.w + blockGap;
      band.spots.push(...b.spots.map(s => ({ ...s, x: s.x + off })));
      band.w = off + b.w;
      band.d = Math.max(band.d, b.d);
    } else bands.push({ w: b.w, d: b.d, spots: [...b.spots] });
  }

  // Each band goes as near its deployment edge and the middle of the table as it fits without touching anything.
  const clear = (x0: number, x1: number, y0: number, y1: number) =>
    boxes.every(b => b.x1 + blockGap / 2 <= x0 || b.x0 - blockGap / 2 >= x1 || b.y1 + gap <= y0 || b.y0 - gap >= y1);
  for (const band of bands) {
    const centre = (boardW - band.w) / 2;
    const lefts = [centre];
    for (let dx = 0.5; dx <= boardW; dx += 0.5) lefts.push(centre + dx, centre - dx);
    let left = Math.max(margin, Math.min(centre, boardW - margin - band.w));
    let back = edge;
    search: for (let depth = 0; depth < boardH; depth += 0.5) {
      const b0 = edge + inward * depth;
      const b1 = b0 + inward * band.d;
      for (const l of lefts) {
        if (l < margin - 1e-6 || l + band.w > boardW - margin + 1e-6) continue;
        if (clear(l, l + band.w, Math.min(b0, b1), Math.max(b0, b1))) {
          left = l;
          back = b0;
          break search;
        }
      }
    }
    for (const { m, x, depth } of band.spots) {
      const maxWounds = Math.max(1, Math.round(m.e.wounds ?? 1));
      const model: Model = {
        id: newId('m'),
        owner,
        name: m.e.name,
        x: Math.min(boardW - m.w / 2, left + x),
        y: back + inward * depth,
        rot: owner === 'p1' ? 0 : 180,
        base: m.base,
        move: m.e.move ?? defaultMove(m.e.name, m.base),
        wounds: maxWounds,
        maxWounds,
        might: m.e.might ?? 0,
        will: m.e.will ?? 0,
        fate: m.e.fate ?? 0,
        hero: m.e.hero,
        dead: false,
        ...(m.e.profileId ? { profileId: m.e.profileId } : {}),
        ...(m.e.options?.length ? { options: m.e.options } : {}),
        ...(m.e.general ? { general: true } : {}),
        ...(m.e.points ? { points: m.e.points } : {}),
        ...(m.e.tier ? { tier: m.e.tier } : {}),
      };
      placed.push(model);
      const r = Math.max(m.w, m.h) / 2;
      boxes.push({ x0: model.x - r, x1: model.x + r, y0: model.y - r, y1: model.y + r });
    }
  }
  return placed;
}
