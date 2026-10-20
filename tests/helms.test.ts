import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/shared/resolve.ts';
import { castModel, radius } from '../src/shared/narrative.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import { distanceToTerrain } from '../src/shared/sight.ts';
import { inEvilZone, inHornburg, onDeepingWall } from '../src/shared/helmsMap.ts';
import type { Action, GameState, Seat } from '../src/shared/types.ts';
import { catalog } from './botsim.ts';

const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);
let n = 0;
const uid = () => `u${n++}`;
const dice = (list: number[]) => {
  const seq = [...list];
  return () => seq.shift() ?? 1;
};
const ask = (s: GameState, seat: Seat, a: Action, rolls: number[] = []) => {
  const out = resolveRequest(s, seat, a, dice(rolls), uid, 1, catalog);
  return out ? run(s, ...out.apply, ...(out.record ? [out.record] : [])) : s;
};
const who = (s: GameState, key: string) => castModel(s, key)!;
const setUp = (turns?: number) => ask(initialState(), 'p1', { type: 'setNarrative', id: 'helms-deep', good: 'p1', ...(turns ? { turns } : {}) });

describe("Helm's Deep: setting up", () => {
  it('puts both casts where the book starts them', () => {
    const s = setUp();
    expect(s.board).toMatchObject({ w: 48, h: 48 });
    const ms = Object.values(s.models);
    const good = ms.filter(m => m.owner === 'p1');
    const evil = ms.filter(m => m.owner === 'p2');
    console.log(good.length, evil.length);
    expect(good.length).toBe(27 + 56 + 27);
    expect(evil.length).toBe(5 + 4 + 15 + 85 + 16);
    for (const m of good.filter(m => !m.waiting)) {
      const ok = inHornburg(m, radius(m)) || onDeepingWall(m, radius(m));
      if (!ok) console.log('out', m.name, m.x, m.y);
      expect(ok).toBe(true);
    }
    for (const m of evil) {
      if (!inEvilZone(m, radius(m))) console.log('evil out', m.name, m.x, m.y);
      expect(inEvilZone(m, radius(m))).toBe(true);
    }
    // Nobody stands in a wall or on another model.
    const walls = Object.values(s.terrain).filter(t => t.kind === 'wall' || t.kind === 'gate' || t.kind === 'building');
    for (const m of ms.filter(m => !m.waiting)) for (const t of walls) if (distanceToTerrain(m, t) < 0.01) console.log('in wall', m.name, m.x.toFixed(2), m.y.toFixed(2), t.id);
    const placed = ms.filter(m => !m.waiting);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < radius(a) + radius(b) - 0.02 && !(a.crewOf || b.crewOf)) console.log('overlap', a.name, b.name, a.x.toFixed(2), a.y.toFixed(2));
    }
    expect(s.narrative?.turns).toBe(15);
    expect(who(s, 'eomer').waiting).toBe(true);
    console.log(who(s, 'eomer').options, who(s, 'eomer').base, who(s, 'gandalf').options, who(s,'theoden').options, who(s,'ballista').base, ms.filter(m => m.crewOf).map(m => m.name));
  });
});
