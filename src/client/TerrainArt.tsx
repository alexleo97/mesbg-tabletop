import type { ReactElement } from 'react';
import { bandOutline } from '../shared/sight.ts';
import type { Mat, Terrain } from '../shared/types.ts';
import { TREES, type Material } from './textures.ts';

// Top-down terrain drawn as SVG in board inches. Every random-looking detail is seeded from the
// piece's id, so both players see exactly the same woods, rocks and riverbanks.

const MATERIAL: Record<Terrain['kind'], Material> = {
  wood: 'forest',
  rock: 'rock',
  building: 'roof',
  water: 'water',
  hill: 'grass',
  wall: 'wall',
  ruin: 'ruin',
  cliff: 'cliff',
  field: 'farmland',
  objective: 'stone',
  bridge: 'wall',
};

function rand(seed: string, i: number) {
  let h = 2166136261;
  for (const c of `${seed}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

type Pt = [number, number];

/** Smooth closed path through points (Catmull-Rom converted to cubic Béziers). */
function smoothClosed(pts: Pt[]): string {
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(3)} ${c1[1].toFixed(3)} ${c2[0].toFixed(3)} ${c2[1].toFixed(3)} ${p2[0].toFixed(3)} ${p2[1].toFixed(3)}`;
  }
  return `${d} Z`;
}

/** An irregular, natural outline that stays close to the piece's ellipse (so hit-testing still matches). */
function blob(t: Terrain, scale = 1, wobble = 0.09, seedOffset = 0): string {
  const n = 26;
  const phases = [0, 1, 2].map(k => rand(t.id, 40 + k + seedOffset) * Math.PI * 2);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wobble * (0.55 * Math.sin(3 * a + phases[0]) + 0.3 * Math.sin(5 * a + phases[1]) + 0.15 * Math.sin(8 * a + phases[2]));
    pts.push([Math.cos(a) * (t.w / 2) * r * scale, Math.sin(a) * (t.h / 2) * r * scale]);
  }
  return smoothClosed(pts);
}

function rectPath(w: number, h: number) {
  return `M ${-w / 2} ${-h / 2} H ${w / 2} V ${h / 2} H ${-w / 2} Z`;
}

/** A river: the long axis gets gently meandering banks. */
function riverPath(t: Terrain): string {
  const along = t.h >= t.w;
  const len = along ? t.h : t.w;
  const half = (along ? t.w : t.h) / 2;
  const steps = Math.max(6, Math.round(len / 1.5));
  const left: Pt[] = [];
  const right: Pt[] = [];
  const ph = rand(t.id, 3) * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const s = -len / 2 + (i / steps) * len;
    const meander = Math.sin(s * 0.35 + ph) * half * 0.35;
    const widen = 1 + 0.18 * Math.sin(s * 0.9 + ph * 2);
    left.push([meander - half * widen, s]);
    right.push([meander + half * widen, s]);
  }
  const pts = [...left, ...right.reverse()].map(([x, y]) => (along ? [x, y] : [y, x]) as Pt);
  let d = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)}`;
  for (const p of pts.slice(1)) d += ` L ${p[0].toFixed(3)} ${p[1].toFixed(3)}`;
  return `${d} Z`;
}

const isRiver = (t: Terrain) => t.kind === 'water' && t.shape === 'rect';

/** A river along its centreline, with smooth banks. */
function bandPath(path: [number, number, number][], grow = 0): string {
  return smoothClosed(bandOutline(path.map(([x, y, hw]) => [x, y, Math.max(0.05, hw + grow)] as [number, number, number])).map(p => [p.x, p.y] as Pt));
}

/** A smooth open line through the centreline, for the deep channel and the current. */
function centreLine(path: [number, number, number][]): string {
  let d = `M ${path[0][0].toFixed(3)} ${path[0][1].toFixed(3)}`;
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[Math.max(0, i - 1)];
    const p1 = path[i];
    const p2 = path[i + 1];
    const p3 = path[Math.min(path.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(3)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(3)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(3)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(3)} ${p2[0].toFixed(3)} ${p2[1].toFixed(3)}`;
  }
  return d;
}

/** The outline used for the ground of a piece. */
function outline(t: Terrain): string {
  if (t.path && t.path.length > 1) return bandPath(t.path);
  if (isRiver(t)) return riverPath(t);
  if (t.shape === 'rect') return rectPath(t.w, t.h);
  return blob(t, 1, t.kind === 'rock' || t.kind === 'cliff' ? 0.16 : 0.09);
}

/** Tree canopies spread through a wood without piling on top of each other. */
function trees(t: Terrain, mat: Mat): ReactElement[] {
  const target = Math.max(4, Math.round((t.w * t.h) / 4.5));
  const placed: { x: number; y: number; r: number }[] = [];
  for (let i = 0; placed.length < target && i < target * 12; i++) {
    const r = 0.55 + rand(t.id, i * 3) * 0.55;
    const x = (rand(t.id, i * 3 + 1) - 0.5) * (t.w - 2 * r);
    const y = (rand(t.id, i * 3 + 2) - 0.5) * (t.h - 2 * r);
    if (t.shape === 'circle' && (x / (t.w / 2 - r * 0.6)) ** 2 + (y / (t.h / 2 - r * 0.6)) ** 2 > 1) continue;
    if (placed.some(p => Math.hypot(p.x - x, p.y - y) < (p.r + r) * 0.55)) continue;
    placed.push({ x, y, r });
  }
  return placed.map((p, i) => {
    const pick = rand(t.id, i + 500);
    const sprite = mat === 'snow' || pick > 0.8 ? TREES.pine : pick > 0.45 ? TREES.birch : TREES.oak;
    const s = p.r * 3.1;
    return (
      <g key={i} transform={`translate(${p.x.toFixed(3)} ${p.y.toFixed(3)})`}>
        <circle className="tree-shadow" cx={0.2} cy={0.28} r={p.r * 0.95} />
        <circle className="tree-base" r={p.r * 0.8} />
        <image href={sprite} x={-s / 2} y={-s / 2} width={s} height={s} transform={`rotate(${(rand(t.id, i + 700) * 360).toFixed(1)})`} />
      </g>
    );
  });
}

/** Broken wall segments around a ruin's footprint, with gaps and rubble. */
function ruinWalls(t: Terrain): ReactElement[] {
  const w = t.w / 2;
  const h = t.h / 2;
  const sides: [Pt, Pt][] = [
    [[-w, -h], [w, -h]],
    [[w, -h], [w, h]],
    [[w, h], [-w, h]],
    [[-w, h], [-w, -h]],
  ];
  const out: ReactElement[] = [];
  sides.forEach(([a, b], s) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let pos = 0;
    let k = 0;
    while (pos < len) {
      const seg = 0.8 + rand(t.id, s * 50 + k) * 1.8;
      const gap = rand(t.id, s * 50 + k + 25) > 0.45 ? 0.5 + rand(t.id, s * 50 + k + 9) * 1.1 : 0;
      const end = Math.min(len, pos + seg);
      const f0 = pos / len;
      const f1 = end / len;
      out.push(
        <line
          key={`${s}-${k}`}
          className="ruin-wall"
          stroke="url(#tex-wall)"
          x1={a[0] + (b[0] - a[0]) * f0}
          y1={a[1] + (b[1] - a[1]) * f0}
          x2={a[0] + (b[0] - a[0]) * f1}
          y2={a[1] + (b[1] - a[1]) * f1}
        />,
      );
      pos = end + gap;
      k++;
    }
  });
  const rubble = Math.round(t.w * t.h * 0.6);
  for (let i = 0; i < rubble; i++) {
    out.push(
      <rect
        key={`r${i}`}
        className="rubble"
        x={(rand(t.id, 900 + i) - 0.5) * t.w * 0.85}
        y={(rand(t.id, 1900 + i) - 0.5) * t.h * 0.85}
        width={0.12 + rand(t.id, 2900 + i) * 0.22}
        height={0.1 + rand(t.id, 3900 + i) * 0.18}
        transform={`rotate(${rand(t.id, 4900 + i) * 90})`}
      />,
    );
  }
  return out;
}

export function TerrainArt({ t, mat }: { t: Terrain; mat: Mat }) {
  const d = outline(t);
  const tex = `url(#tex-${MATERIAL[t.kind]})`;

  switch (t.kind) {
    case 'wood':
      return (
        <>
          <path className="ground wood-floor" d={d} fill={tex} filter="url(#soft-shadow)" />
          <path className="tint" d={d} fill="#14240f55" />
          <g pointerEvents="none">{trees(t, mat)}</g>
        </>
      );
    case 'hill':
      return (
        <>
          {[1, 0.7, 0.42].map((k, i) => (
            <g key={k}>
              <path className="ground hill-step" d={t.shape === 'rect' ? rectPath(t.w * k, t.h * k) : blob(t, k, 0.1, i)} fill={tex} filter="url(#soft-shadow)" />
              <path className="tint" d={t.shape === 'rect' ? rectPath(t.w * k, t.h * k) : blob(t, k, 0.1, i)} fill={['rgba(20,30,10,0.18)', 'rgba(240,240,200,0.06)', 'rgba(250,245,200,0.14)'][i]} />
            </g>
          ))}
        </>
      );
    case 'rock':
    case 'cliff':
      return (
        <>
          <path className={`ground ${t.kind}-face`} d={d} fill={tex} filter="url(#hard-shadow)" />
          <path className="tint" d={d} fill="url(#g-dome)" />
          {t.kind === 'cliff' && <path className="tint" d={blob(t, 0.62, 0.2, 7)} fill="#00000038" />}
          {t.kind === 'cliff' && <path className="tint" d={blob(t, 0.32, 0.25, 11)} fill="#00000030" />}
          <path className="crack" d={`M ${-t.w * 0.18} ${-t.h * 0.1} l ${t.w * 0.12} ${t.h * 0.08} l ${t.w * 0.1} ${-t.h * 0.03}`} />
        </>
      );
    case 'water':
      if (t.path && t.path.length > 1) {
        const hw = t.path.reduce((a, p) => a + p[2], 0) / t.path.length;
        return (
          <>
            {/* Muddy banks fading into the grass, then shallows, then a darker channel down the middle. */}
            <path className="river-mud" d={bandPath(t.path, 0.55)} filter="url(#bank-blur)" />
            <path className="river-edge" d={bandPath(t.path, 0.18)} />
            <path className="ground water-surface" d={d} fill={tex} />
            <path className="river-shallows" d={d} />
            <path className="river-deep" d={centreLine(t.path)} strokeWidth={hw * 1.1} filter="url(#bank-blur)" />
            <path className="river-current" d={centreLine(t.path)} strokeWidth={hw * 0.12} />
          </>
        );
      }
      return (
        <>
          <path className="bank" d={d} />
          <path className="ground water-surface" d={d} fill={tex} />
          <path className="tint" d={d} fill="url(#g-water)" />
        </>
      );
    case 'building':
      return (
        <>
          <rect className="ground roof" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill="#3a2a1c" filter="url(#hard-shadow)" />
          {/* Two roof slopes of shingles, eaves at the outside, meeting at the ridge. */}
          <rect className="tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h / 2} fill={tex} />
          <g transform="scale(1 -1)">
            <rect className="tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h / 2} fill={tex} />
          </g>
          <rect className="tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h / 2} fill="#ffffff14" />
          <rect className="tint" x={-t.w / 2} y={0} width={t.w} height={t.h / 2} fill="#00000047" />
          <line className="ridge" x1={-t.w / 2} x2={t.w / 2} y1={0} y2={0} />
        </>
      );
    case 'ruin':
      return (
        <>
          <rect className="ground ruin-floor" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} />
          <rect className="tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill="#2a221a66" />
          <g pointerEvents="none" filter="url(#hard-shadow)">
            {ruinWalls(t)}
          </g>
        </>
      );
    case 'wall':
      return (
        <>
          <rect className="ground wall-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} filter="url(#hard-shadow)" />
        </>
      );
    case 'field':
      return (
        <>
          <rect className="ground" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.2} fill={tex} />
          {Array.from({ length: Math.floor((t.h - 0.4) / 0.45) }, (_, i) => (
            <line key={i} className="furrow" x1={-t.w / 2 + 0.3} x2={t.w / 2 - 0.3} y1={-t.h / 2 + 0.4 + i * 0.45} y2={-t.h / 2 + 0.4 + i * 0.45} />
          ))}
          <rect className="hedge" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.2} />
        </>
      );
    case 'bridge': {
      // Long side runs along w: planks laid across it, a rail down each edge.
      const planks = Math.max(3, Math.round(t.w / 0.45));
      return (
        <>
          <rect className="ground bridge-deck" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.12} filter="url(#hard-shadow)" />
          {Array.from({ length: planks - 1 }, (_, i) => {
            const x = -t.w / 2 + ((i + 1) * t.w) / planks;
            return <line key={i} className="bridge-plank" x1={x} x2={x} y1={-t.h / 2 + 0.2} y2={t.h / 2 - 0.2} />;
          })}
          <rect className="bridge-rail" x={-t.w / 2} y={-t.h / 2} width={t.w} height={0.22} />
          <rect className="bridge-rail" x={-t.w / 2} y={t.h / 2 - 0.22} width={t.w} height={0.22} />
        </>
      );
    }
    case 'objective':
      return (
        <>
          <circle className="ground objective" r={t.w / 2} filter="url(#hard-shadow)" />
          <circle className="objective-ring" r={t.w / 2 - 0.08} />
          <path className="objective-star" d={star(t.w * 0.28)} />
        </>
      );
  }
}

function star(r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? r * 0.45 : r;
    pts.push(`${(Math.cos(a) * k).toFixed(3)} ${(Math.sin(a) * k).toFixed(3)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/** Shared gradients and shadow filters the terrain refers to. */
export function TerrainDefs() {
  return (
    <>
      <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.12" dy="0.18" stdDeviation="0.18" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <filter id="bank-blur" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="0.25" />
      </filter>
      <filter id="hard-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.16" dy="0.24" stdDeviation="0.08" floodColor="#000" floodOpacity="0.55" />
      </filter>
      <radialGradient id="g-dome" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.32" />
        <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
      </radialGradient>
      <radialGradient id="g-canopy" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#5f8f3e" />
        <stop offset="60%" stopColor="#2f5a24" />
        <stop offset="100%" stopColor="#1a3615" />
      </radialGradient>
      <radialGradient id="g-canopy-2" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#6c8a3a" />
        <stop offset="60%" stopColor="#3b5a22" />
        <stop offset="100%" stopColor="#213a14" />
      </radialGradient>
      <radialGradient id="g-water" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#0b2233" stopOpacity="0.35" />
        <stop offset="85%" stopColor="#0b2233" stopOpacity="0" />
        <stop offset="100%" stopColor="#d8e8e0" stopOpacity="0.25" />
      </radialGradient>
    </>
  );
}
