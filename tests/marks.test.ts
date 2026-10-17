import { describe, expect, it } from 'vitest';
import { addMark, cleanMark, MAX_ARROWS } from '../src/shared/marks.ts';
import type { Mark } from '../src/shared/types.ts';

describe('pings and arrows', () => {
  it('checks marks sent by a client', () => {
    expect(cleanMark({ kind: 'ping', x: 3, y: 4 }, 'p1', 'a')).toEqual({ id: 'a', by: 'p1', kind: 'ping', x: 3, y: 4 });
    expect(cleanMark({ kind: 'arrow', x: 1, y: 1, x2: 9e9, y2: 5 }, 'p2', 'b')).toMatchObject({ x2: 200, y2: 5 });
    expect(cleanMark({ kind: 'arrow', x: 1, y: 1 }, 'p1', 'c')).toBeNull();
    expect(cleanMark({ kind: 'circle', x: 1, y: 1 }, 'p1', 'd')).toBeNull();
    expect(cleanMark('nope', 'p1', 'e')).toBeNull();
  });

  it("keeps each player's arrows to the limit, dropping their oldest", () => {
    let marks: Mark[] = [cleanMark({ kind: 'arrow', x: 0, y: 0, x2: 1, y2: 1 }, 'p2', 'theirs')!];
    for (let i = 0; i <= MAX_ARROWS; i++) marks = addMark(marks, cleanMark({ kind: 'arrow', x: i, y: 0, x2: 1, y2: 1 }, 'p1', `a${i}`)!);
    expect(marks.filter(m => m.by === 'p1')).toHaveLength(MAX_ARROWS);
    expect(marks.some(m => m.id === 'a0')).toBe(false);
    expect(marks.some(m => m.id === 'theirs')).toBe(true);
  });
});
