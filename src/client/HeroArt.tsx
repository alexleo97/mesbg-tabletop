import { useMemo } from 'react';
import { STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { TerrainArt, TerrainDefs } from './TerrainArt.tsx';
import { MATERIALS, textures } from './textures.ts';

// The home page banner: the River Crossing table drawn with the game's own textures, two warbands
// facing each other across the river.

const BOARD = STARTER_BOARDS.find(b => b.id === 'river-crossing')!;
const LAYER = (k: string) => (k === 'road' ? 0 : k === 'water' ? 1 : k === 'bridge' ? 3 : 2);

/** Ranks of bases: [x, y] centres in inches. */
const rank = (x: number, y: number, n: number, gap = 1.15): [number, number][] => Array.from({ length: n }, (_, i) => [x + i * gap, y]);
const GOOD = [...rank(33.6, 29.5, 6), ...rank(34.2, 30.7, 5), [37.5, 32.1] as [number, number]];
const EVIL = [...rank(33.2, 20.4, 6), ...rank(33.8, 19.2, 5), [36.2, 17.8] as [number, number]];

export function HeroArt() {
  const tex = useMemo(() => textures(), []);
  const terrain = useMemo(() => {
    let n = 0;
    return starterTerrain(BOARD, () => `hero-${n++}`).sort((a, b) => LAYER(a.kind) - LAYER(b.kind));
  }, []);
  return (
    <svg className="hero-art" viewBox="9 17.5 39 14.5" preserveAspectRatio="xMaxYMid slice" aria-hidden>
      <defs>
        <TerrainDefs />
        {MATERIALS.map(m => (
          <pattern key={m} id={`tex-${m}`} patternUnits="userSpaceOnUse" width={tex[m].inches} height={tex[m].tall}>
            <image href={tex[m].href} width={tex[m].inches} height={tex[m].tall} preserveAspectRatio="none" />
          </pattern>
        ))}
      </defs>
      <g className="hero-pan">
        <rect width={BOARD.w} height={BOARD.h} fill={`url(#tex-${BOARD.mat})`} />
        {terrain.map(t => (
          <g key={t.id} transform={`translate(${t.x} ${t.y}) rotate(${t.rot})`} className={`terrain ${t.kind} locked`}>
            <TerrainArt t={t} mat={BOARD.mat} />
          </g>
        ))}
        {GOOD.map(([x, y], i) => (
          <circle key={`g${i}`} className="hero-base p1" cx={x} cy={y} r={0.49} />
        ))}
        {EVIL.map(([x, y], i) => (
          <circle key={`e${i}`} className="hero-base p2" cx={x} cy={y} r={0.49} />
        ))}
      </g>
    </svg>
  );
}
