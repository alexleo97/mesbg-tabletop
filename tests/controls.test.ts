import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLS } from '../src/client/controls.ts';

const listed = new Set(CONTROLS.flatMap(g => g.items.flatMap(c => c.keys ?? [])).map(k => k.toLowerCase()));

describe('the Controls list in the settings', () => {
  it('names every key the table and the game answer to', () => {
    const src = ['src/client/Board.tsx', 'src/client/App.tsx'].map(f => readFileSync(f, 'utf8')).join('\n');
    const keys = new Set([...src.matchAll(/e\.key(?:\.toLowerCase\(\))? === '([^']+)'/g)].map(m => m[1].toLowerCase()));
    for (const held of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) if (src.includes(`e.${held}`)) keys.add({ shiftKey: 'shift', ctrlKey: 'control', metaKey: 'meta', altKey: 'alt' }[held]!);
    expect(keys.size).toBeGreaterThan(5);
    expect([...keys].filter(k => !listed.has(k))).toEqual([]);
  });

  it('describes each control once', () => {
    const hows = CONTROLS.flatMap(g => g.items.map(c => c.how));
    expect(new Set(hows).size).toBe(hows.length);
  });
});
