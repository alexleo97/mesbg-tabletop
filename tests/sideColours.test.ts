import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The table's model rings are coloured in styles.css; a selected model must keep its side's colour.
const css = readFileSync(new URL('../src/client/styles.css', import.meta.url), 'utf8');
const rules = (selector: RegExp) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => selector.test(sel)).map(([, , body]) => body);

describe('side colours on the table', () => {
  it('rings each side in its own colour', () => {
    expect(rules(/\.model\.p1 \.ring/).join()).toMatch(/stroke:\s*var\(--p1\)/);
    expect(rules(/\.model\.p2 \.ring/).join()).toMatch(/stroke:\s*var\(--p2\)/);
  });

  it('does not repaint a selected model’s ring or base, but haloes it', () => {
    for (const body of rules(/\.model\.selected\b[^,{]*\.(ring|base)\b/)) expect(body).not.toMatch(/stroke\s*:/);
    expect(rules(/\.select-ring/).join()).toMatch(/stroke:\s*#fff/);
  });
});
