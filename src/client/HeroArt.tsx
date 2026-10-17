import { useMemo } from 'react';
import { STARTER_BOARDS, starterTerrain } from '../shared/boards.ts';
import { pictureUrl } from '../shared/catalog.ts';
import { mmToIn } from '../shared/geometry.ts';
import { TerrainArt, TerrainDefs } from './TerrainArt.tsx';
import { MATERIALS, textures } from './textures.ts';

// The home page banner: the River Crossing table drawn with the game's own textures, Gondor and Mordor facing each
// other across the river as photo tokens on their book-sized bases, the way they look in a game.

const BOARD = STARTER_BOARDS.find(b => b.id === 'river-crossing')!;
const LAYER = (k: string) => (k === 'road' ? 0 : k === 'water' ? 1 : k === 'bridge' ? 3 : 2);

interface Token {
  origin: string;
  name: string;
  mm: number;
  x: number;
  y: number;
  hero?: boolean;
}

/** A rank of the same unit: `n` bases side by side from `x`. */
const rank = (origin: string, name: string, x: number, y: number, n: number, mm = 25): Token[] =>
  Array.from({ length: n }, (_, i) => ({ origin, name, mm, x: x + i * (mmToIn(mm) + 0.12), y }));

const GOOD: Token[] = [
  { origin: 'Gondor', name: 'Aragorn, King Elessar', mm: 25, x: 36.2, y: 26.9, hero: true },
  { origin: 'Gondor', name: 'Boromir, Captain of the White Tower', mm: 25, x: 37.4, y: 26.9, hero: true },
  ...rank('Gondor', 'Knight of Minas Tirith', 32.4, 27.4, 2, 40),
  ...rank('Gondor', 'Warrior of Minas Tirith', 34.2, 28.0, 6),
  ...rank('Gondor', 'Citadel Guard', 34.8, 29.1, 5),
  ...rank('Gondor', 'Ranger of Gondor', 41.4, 28.0, 3),
];
const EVIL: Token[] = [
  { origin: 'Mordor', name: 'Gothmog', mm: 25, x: 36.6, y: 21.7, hero: true },
  { origin: 'Mordor', name: 'Mordor Troll', mm: 60, x: 33.0, y: 20.4 },
  ...rank('Mordor', 'Mordor Orc Warrior', 34.6, 20.6, 6),
  ...rank('Mordor', 'Mordor Uruk-Hai', 35.2, 19.5, 5),
  ...rank('Mordor', 'Mordor Warg Rider', 41.4, 20.4, 2, 40),
];

function PhotoToken({ t, side, i }: { t: Token; side: 'p1' | 'p2'; i: number }) {
  const r = mmToIn(t.mm) / 2;
  const id = `hero-clip-${side}-${i}`;
  return (
    <g className={`hero-token ${side} ${t.hero ? 'hero' : ''}`} transform={`translate(${t.x} ${t.y})`}>
      <clipPath id={id}>
        <circle r={r} />
      </clipPath>
      <circle className="hero-base" r={r} />
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
    <svg className="hero-art" viewBox="15.5 18.7 32.5 11.7" preserveAspectRatio="xMaxYMid slice" aria-hidden>
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
