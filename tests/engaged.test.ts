import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { engagements } from '../src/shared/movement.ts';
import type { Model } from '../src/shared/types.ts';

const base = { shape: 'round' as const, w: 25, h: 25 };
const make = (id: string, owner: 'p1' | 'p2', x: number, y: number, extra: Partial<Model> = {}): Model =>
  ({ id, owner, name: id, x, y, rot: 0, base, move: 6, wounds: 1, maxWounds: 1, might: 0, will: 0, fate: 0, hero: false, dead: false, ...extra });
const table = (...models: Model[]) => reduce(reduce(initialState(), { type: 'addModels', models }), { type: 'startGame' });
// Two 25mm bases touch when their centres are 25mm apart.
const touch = 25 / 25.4;

describe('engagements', () => {
  it('pairs enemies in base contact and finds where they meet', () => {
    const s = table(make('k', 'p2', 10, 10), make('o', 'p1', 10 + touch, 10));
    const [c, ...rest] = engagements(s);
    expect(rest).toHaveLength(0);
    expect(c.key).toBe('o|k');
    expect(c.at.x).toBeCloseTo(10 + touch / 2, 2);
    expect(c.at.y).toBeCloseTo(10, 2);
  });

  it('leaves out friends, models apart, and the dead', () => {
    const s = table(make('a', 'p1', 10, 10), make('b', 'p1', 10 + touch, 10), make('c', 'p2', 20, 10), make('d', 'p2', 10, 10 + touch, { dead: true }));
    expect(engagements(s)).toHaveLength(0);
  });

  it('uses the positions given, so a drag shows contact before it is dropped', () => {
    const s = table(make('a', 'p1', 10, 10), make('b', 'p2', 20, 10));
    expect(engagements(s)).toHaveLength(0);
    expect(engagements(s, [s.models.a, { ...s.models.b, x: 10 + touch }])).toHaveLength(1);
  });
});
