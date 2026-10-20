import { describe, expect, it } from 'vitest';
import { objectiveMarkers, STARTER_BOARDS, starterTerrain } from '../src/shared/boards.ts';
import { inDifficult, moveCost } from '../src/shared/sight.ts';
import { drawLayer, isMarker } from '../src/shared/terrain.ts';
import { initialState, reduce } from '../src/shared/reducer.ts';
import type { Terrain } from '../src/shared/types.ts';

let n = 0;
const id = (p: string) => `${p}${n++}`;
const withBridges = STARTER_BOARDS.filter(b => b.pieces.some(p => p.kind === 'bridge'));

describe('what is drawn over what', () => {
  it('has starter boards with bridges to check', () => {
    expect(withBridges.map(b => b.id).length).toBeGreaterThanOrEqual(2);
  });

  it('draws bridges over water, and every marker over every piece of terrain', () => {
    for (const b of withBridges) {
      const terrain: Terrain[] = [...starterTerrain(b, id), ...objectiveMarkers(b.w, b.h, id)];
      const top = (pred: (t: Terrain) => boolean) => Math.max(...terrain.filter(pred).map(drawLayer));
      const bottom = (pred: (t: Terrain) => boolean) => Math.min(...terrain.filter(pred).map(drawLayer));
      expect(bottom(t => t.kind === 'bridge'), b.id).toBeGreaterThan(top(t => t.kind === 'water' || t.kind === 'road'));
      expect(bottom(isMarker), b.id).toBeGreaterThan(top(t => !isMarker(t)));
    }
  });

  it('puts the Writhing Vines marker and a carried objective over a bridge too', () => {
    const bridge = { id: 'b', kind: 'bridge', shape: 'rect', x: 0, y: 0, w: 8, h: 2.8, rot: 0, locked: true } as Terrain;
    const vines = { ...bridge, id: 'v', kind: 'field', shape: 'circle', vines: true } as Terrain;
    const carried = { ...bridge, id: 'o', kind: 'objective', shape: 'circle', carrier: 'm1' } as Terrain;
    expect(drawLayer(vines)).toBeGreaterThan(drawLayer(bridge));
    expect(drawLayer(carried)).toBeGreaterThan(drawLayer(vines));
  });

  it('treats the deck of every starter bridge as clear ground, not the river under it', () => {
    for (const b of withBridges) {
      const s = reduce(initialState(), { type: 'setScenery', w: b.w, h: b.h, mat: b.mat, terrain: starterTerrain(b, id) });
      for (const t of Object.values(s.terrain).filter(t => t.kind === 'bridge')) {
        const a = (t.rot * Math.PI) / 180;
        const end = (k: number) => ({ x: t.x + Math.cos(a) * k * (t.w / 2 - 0.3), y: t.y + Math.sin(a) * k * (t.w / 2 - 0.3) });
        expect(inDifficult(s, { x: t.x, y: t.y }), `${b.id} ${t.id}`).toBe(false);
        expect(moveCost(s, end(-1), end(1)).difficult, `${b.id} ${t.id}`).toBe(false);
      }
    }
  });
});
