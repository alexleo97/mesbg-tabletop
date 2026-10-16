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
  const n = name.toLowerCase();
  if (/m[uû]mak|oliphaunt/.test(n)) return { shape: 'rect', w: 105, h: 165 };
  if (/dragon|balrog|fell beast|great beast|war beast|smaug|watcher/.test(n)) return { shape: 'round', w: 60, h: 60 };
  if (/\btroll|\bent\b|treebeard|eagle|gwaihir|cave troll|ogre|bear\b|beorn.*bear|giant|spider queen|shelob/.test(n))
    return { shape: 'round', w: 40, h: 40 };
  if (/chariot|war ?wagon|catapult|trebuchet|ballista|bolt thrower|siege/.test(n)) return { shape: 'rect', w: 50, h: 100 };
  if (/cavalry|rider|riders|knight|on horse|mounted|on warg|on pony|on elk|on goat|on boar|horse(man|men)|outrider|wolf rider|warg|on fell/.test(n))
    return { shape: 'rect', w: 25, h: 50 };
  return { shape: 'round', w: 25, h: 25 };
}

function defaultMove(name: string, base: Base): number {
  const n = name.toLowerCase();
  if (/hobbit|dwar|gollum|goblin(?! rider)|halfling/.test(n)) return 5;
  if (/eagle|fell beast|bat/.test(n)) return 12;
  if (base.shape === 'rect' && base.h === 50) return 10;
  return 6;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Lays out an army in its deployment zone, behind any models already there.
 * Player 1 deploys from the bottom edge, player 2 from the top, so armies never land on each other.
 */
export function deployList(entries: ListEntry[], owner: Seat, state: Pick<GameState, 'board' | 'models'>): Model[] {
  const { w: boardW, h: boardH } = state.board;
  const placed: Model[] = [];
  const gap = 0.15;
  const margin = 1;
  const rowDir = owner === 'p1' ? -1 : 1;
  const existing = Object.values(state.models).filter(m => m.owner === owner);
  // Start a fresh row past anything this player already has on the table.
  let rowStart =
    owner === 'p1'
      ? Math.min(boardH - margin, ...existing.map(m => m.y - mmToIn(Math.max(m.base.w, m.base.h)) / 2 - gap))
      : Math.max(margin, ...existing.map(m => m.y + mmToIn(Math.max(m.base.w, m.base.h)) / 2 + gap));
  let x = margin;
  let rowDepth = 0;

  for (const e of entries) {
    const base = guessBase(e.name);
    const wIn = mmToIn(base.w);
    const hIn = mmToIn(base.h);
    for (let i = 0; i < e.count; i++) {
      if (x + wIn > boardW - margin) {
        rowStart += rowDir * (rowDepth + gap);
        x = margin;
        rowDepth = 0;
      }
      const maxWounds = Math.max(1, Math.round(e.wounds ?? 1));
      placed.push({
        id: newId('m'),
        owner,
        name: e.name,
        x: x + wIn / 2,
        y: rowStart + rowDir * (hIn / 2),
        rot: owner === 'p1' ? 0 : 180,
        base,
        move: e.move ?? defaultMove(e.name, base),
        wounds: maxWounds,
        maxWounds,
        might: e.might ?? 0,
        will: e.will ?? 0,
        fate: e.fate ?? 0,
        hero: e.hero,
        dead: false,
      });
      x += wIn + gap;
      rowDepth = Math.max(rowDepth, hIn);
    }
  }
  return placed;
}
