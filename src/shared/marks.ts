import type { Mark, Role } from './types.ts';

// Pings and planning arrows: quick ways to point at the table while talking a move over.

/** How long a ping stays on the table. */
export const PING_MS = 3000;
/** Arrows each player can have out at once; the oldest goes when another is drawn. */
export const MAX_ARROWS = 12;

/** Checks a mark from a client, or returns null if it isn't one. */
export function cleanMark(raw: unknown, by: Role, id: string): Mark | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Mark>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(200, Math.max(-24, v)) : null);
  const [x, y] = [n(o.x), n(o.y)];
  if (x === null || y === null) return null;
  if (o.kind === 'ping') return { id, by, kind: 'ping', x, y };
  if (o.kind !== 'arrow') return null;
  const [x2, y2] = [n(o.x2), n(o.y2)];
  return x2 === null || y2 === null ? null : { id, by, kind: 'arrow', x, y, x2, y2 };
}

/** Adds a mark to those on the table, keeping each player's arrows to the limit. */
export function addMark(marks: Mark[], m: Mark): Mark[] {
  const next = [...marks, m];
  if (m.kind !== 'arrow') return next;
  const mine = next.filter(x => x.kind === 'arrow' && x.by === m.by);
  return mine.length > MAX_ARROWS ? next.filter(x => x !== mine[0]) : next;
}
