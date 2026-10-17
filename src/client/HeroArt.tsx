import { useMemo } from 'react';
import { starterTerrain } from '../shared/boards.ts';
import { pictureUrl } from '../shared/catalog.ts';
import { mmToIn } from '../shared/geometry.ts';
import { BOARD, EVIL, GOOD, type Token } from './heroBattle.ts';
import { TerrainArt, TerrainDefs } from './TerrainArt.tsx';
import { MATERIALS, textures } from './textures.ts';

// The home page banner: the River Crossing table drawn with the game's own textures, Gondor and Mordor facing each
// other across the river as photo tokens on their book-sized bases, the way they look in a game.

const LAYER = (k: string) => (k === 'road' ? 0 : k === 'water' ? 1 : k === 'bridge' ? 3 : 2);

const initials = (name: string) =>
  name
    .split(/[\s,]+/)
    .filter(w => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map(w => w[0])
    .join('');

function PhotoToken({ t, side, i }: { t: Token; side: 'p1' | 'p2'; i: number }) {
  const r = mmToIn(t.mm) / 2;
  const id = `hero-clip-${side}-${i}`;
  return (
    <g className={`hero-token ${side} ${t.hero ? 'hero' : ''}`} transform={`translate(${t.x} ${t.y})`}>
      <clipPath id={id}>
        <circle r={r} />
      </clipPath>
      <circle className="hero-base" r={r} />
      <text className="hero-initials" textAnchor="middle" dominantBaseline="central" style={{ fontSize: r * 0.8 }}>
        {initials(t.name)}
      </text>
      <image href={pictureUrl(t)} x={-r} y={-r} width={2 * r} height={2 * r} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`} onError={e => (e.currentTarget.style.display = 'none')} />
      <circle className="hero-ring" r={r} />
    </g>
  );
}

export function HeroArt() {
  const tex = useMemo(() => textures(), []);
  const terrain = useMemo(() => {
    let n = 0;
    return starterTerrain(BOARD, () => `hero-${n++}`).sort((a, b) => LAYER(a.kind) - LAYER(b.kind));
  }, []);
  return (
    <svg className="hero-art" viewBox="0.2 19.5 36 13" preserveAspectRatio="xMaxYMid slice" aria-hidden>
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
        {GOOD.map((t, i) => (
          <PhotoToken key={`g${i}`} t={t} side="p1" i={i} />
        ))}
        {EVIL.map((t, i) => (
          <PhotoToken key={`e${i}`} t={t} side="p2" i={i} />
        ))}
      </g>
    </svg>
  );
}
