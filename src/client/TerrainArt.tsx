import type { ReactElement } from 'react';
import type { Point } from '../shared/geometry.ts';
import { bandOutline, heightOf, outline as boardOutline } from '../shared/sight.ts';
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
  road: 'dirt',
  gate: 'wall',
  tower: 'wall',
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
    // (Undergrowth is a thicket of low bushes.)
    const r = t.look === 'brush' ? 0.35 + rand(t.id, i * 3) * 0.3 : 0.55 + rand(t.id, i * 3) * 0.55;
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
      <g key={i} className={t.look === 'brush' ? 'brush' : undefined} transform={`translate(${p.x.toFixed(3)} ${p.y.toFixed(3)})`}>
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
  if (t.shape === 'circle') {
    // A round ruin (a watchtower's ring): broken arcs of wall round its edge.
    const len = Math.PI * (w + h);
    const at = (d: number) => {
      const a = (d / len) * Math.PI * 2;
      return `${w * Math.cos(a)} ${h * Math.sin(a)}`;
    };
    const out: ReactElement[] = [];
    let pos = 0;
    for (let k = 0; pos < len; k++) {
      const end = Math.min(len, pos + 0.8 + rand(t.id, k) * 1.8);
      out.push(<path key={k} className="ruin-wall" stroke="url(#tex-wall)" fill="none" d={`M ${at(pos)} A ${w} ${h} 0 0 1 ${at(end)}`} />);
      pos = end + (rand(t.id, k + 25) > 0.45 ? 0.5 + rand(t.id, k + 9) * 1.1 : 0);
    }
    return out;
  }
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

export function TerrainArt({ t, mat, turn = 0 }: { t: Terrain; mat: Mat; /** How far the table is turned, so a marker's letter stays upright. */ turn?: number }) {
  const d = outline(t);
  const tex = `url(#tex-${t.look === 'stone' ? (t.kind === 'rock' ? 'cliff' : t.kind === 'building' ? 'wall' : 'stone') : t.look === 'grass' ? 'grass' : MATERIAL[t.kind]})`;

  switch (t.kind) {
    case 'wood':
      if (t.look === 'gnarled') return <MirkwoodPiece t={t} />;
      if (t.look === 'pinewood') return <PinePiece t={t} />;
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
      if (t.look === 'roots') return <MirkwoodPiece t={t} />;
      if (t.kind === 'cliff' && t.path && t.path.length > 1) return <CliffEdge t={t} d={d} tex={tex} />;
      if (t.look === 'floe') return <LakePiece t={t} />;
      if (t.look === 'crag' || t.look === 'cavewall') return <GoblinPiece t={t} />;
      if (t.look === 'rubble') return <OsgiliathPiece t={t} />;
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
      if (t.look === 'pit') return <IsengardPiece t={t} />;
      if (t.look === 'chasm') return <GoblinPiece t={t} />;
      // Deep water under a whole table is the mat itself (Lake-town's Long Lake): only a darker sheen.
      if (t.deep) return <rect className="lake-depth" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} pointerEvents="none" />;
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
      if (t.look === 'orthanc') return <IsengardPiece t={t} />;
      if (t.look === 'throne') return <GoblinPiece t={t} />;
      if (t.look === 'stepped') return <OsgiliathPiece t={t} />;
      if (t.look === 'trunk') return <MirkwoodPiece t={t} />;
      if (t.look === 'pine') return <PinePiece t={t} />;
      if (t.look === 'stone') return <StoneTower t={t} tex={tex} />;
      if (t.look === 'pillar' || t.look === 'tomb' || t.look === 'well') return <MoriaPiece t={t} />;
      if (t.look === 'lakehouse' || t.look === 'laketower' || t.look === 'lakewing') return <LakePiece t={t} />;
      if (t.shape === 'circle')
        return (
          <>
            <ellipse className="ground roof" rx={t.w / 2} ry={t.h / 2} fill={tex} filter="url(#hard-shadow)" />
            <ellipse className="tint" rx={t.w / 2} ry={t.h / 2} fill="url(#g-dome)" />
          </>
        );
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
          {t.shape === 'circle' ? (
            <>
              <ellipse className="ground ruin-floor" rx={t.w / 2} ry={t.h / 2} fill={tex} />
              <ellipse className="tint" rx={t.w / 2} ry={t.h / 2} fill="#2a221a66" />
            </>
          ) : (
            <>
              <rect className="ground ruin-floor" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} />
              <rect className="tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill="#2a221a66" />
            </>
          )}
          <g pointerEvents="none" filter="url(#hard-shadow)">
            {ruinWalls(t)}
          </g>
        </>
      );
    case 'wall':
      if (t.look === 'scaffold') return <IsengardPiece t={t} />;
      if (t.look === 'osgwall') return <OsgiliathPiece t={t} />;
      if (t.barricade) {
        // A wooden barricade: a row of logs, with stakes poking out both ways if it is spiked. Broken, only splinters.
        const logs = Math.max(3, Math.round(t.w / 0.5));
        if (t.gone)
          return (
            <>
              {Array.from({ length: 6 }, (_, i) => (
                <rect key={i} className="gate-splinter" x={-t.w / 2 + rand(t.id, i) * (t.w - 0.5)} y={-t.h / 2 + rand(t.id, i + 9) * t.h} width={0.5} height={0.12} transform={`rotate(${rand(t.id, i + 20) * 180 - 90} ${-t.w / 2 + rand(t.id, i) * (t.w - 0.5) + 0.25} ${-t.h / 2 + rand(t.id, i + 9) * t.h})`} />
              ))}
            </>
          );
        return (
          <>
            {t.barricade === 'spiked' &&
              Array.from({ length: logs }, (_, i) => {
                const x = -t.w / 2 + ((i + 0.5) * t.w) / logs;
                return <path key={i} className="barricade-spike" d={`M ${x - 0.08} 0 L ${x} ${-t.h / 2 - 0.35} L ${x + 0.08} 0 L ${x} ${t.h / 2 + 0.35} Z`} />;
              })}
            <rect className="ground gate-leaf" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.1} filter="url(#hard-shadow)" />
            {Array.from({ length: logs - 1 }, (_, i) => {
              const x = -t.w / 2 + ((i + 1) * t.w) / logs;
              return <line key={i} className="gate-plank" x1={x} x2={x} y1={-t.h / 2} y2={t.h / 2} />;
            })}
          </>
        );
      }
      return (
        <>
          <rect className="ground wall-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} filter="url(#hard-shadow)" />
          {/* A fortress wall: a walkway down the middle between two lines of battlements. */}
          {t.sheer && <Battlements w={t.w} h={t.h} />}
          {/* A ledge to stand on (Balin's Tomb): its top lit paler than the floor below, its lip picked out. */}
          {t.walk && !t.sheer && <rect className="tint ledge-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} />}
          {t.look === 'culvert' && (
            <g className="culvert">
              <rect className="culvert-mouth" x={-0.8} y={-t.h / 2} width={1.6} height={t.h} rx={0.2} />
              {[-0.45, -0.15, 0.15, 0.45].map(k => (
                <line key={k} className="culvert-bar" x1={k} x2={k} y1={-t.h / 2} y2={t.h / 2} />
              ))}
            </g>
          )}
        </>
      );
    case 'tower': {
      // A siege tower from above: a timber deck with a cross of beams, and its ramp let down at the front once it
      // reaches a wall. Broken, a heap of splinters.
      if (t.gone)
        return (
          <>
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} className="gate-splinter" x={-t.w / 2 + rand(t.id, i) * (t.w - 0.6)} y={-t.h / 2 + rand(t.id, i + 9) * (t.h - 0.2)} width={0.6} height={0.14} transform={`rotate(${rand(t.id, i + 20) * 180 - 90} ${-t.w / 2 + rand(t.id, i) * (t.w - 0.6) + 0.3} ${-t.h / 2 + rand(t.id, i + 9) * (t.h - 0.2)})`} />
            ))}
          </>
        );
      const planks = Math.max(4, Math.round(t.w / 0.4));
      return (
        <>
          {t.raised && <rect className="tower-ramp" x={-t.w * 0.35} y={t.h / 2 - 0.1} width={t.w * 0.7} height={1.1} />}
          <rect className="ground gate-leaf" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} filter="url(#hard-shadow)" />
          {Array.from({ length: planks - 1 }, (_, i) => {
            const x = -t.w / 2 + ((i + 1) * t.w) / planks;
            return <line key={i} className="gate-plank" x1={x} x2={x} y1={-t.h / 2} y2={t.h / 2} />;
          })}
          <line className="tower-beam" x1={-t.w / 2} y1={-t.h / 2} x2={t.w / 2} y2={t.h / 2} />
          <line className="tower-beam" x1={t.w / 2} y1={-t.h / 2} x2={-t.w / 2} y2={t.h / 2} />
          <rect className="tower-frame" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} />
          {t.side && <rect className={`gate-side ${t.side}`} x={-t.w / 2 + 0.15} y={-t.h / 2 + 0.15} width={t.w - 0.3} height={t.h - 0.3} />}
        </>
      );
    }
    case 'field':
      if (t.look === 'grass') {
        // Long grass: a pale tussocky patch, with tufts scattered across it (in a fixed pattern, so it doesn't shimmer).
        const n = Math.max(6, Math.round((t.w * t.h) / 3));
        return (
          <>
            <path className="ground long-grass" d={d} fill={tex} filter="url(#soft-shadow)" />
            <path className="tint" d={d} fill="#b8a04a66" />
            {Array.from({ length: n }, (_, i) => {
              const a = i * 2.39996;
              const k = Math.sqrt((i + 0.5) / n) * 0.42;
              const x = Math.cos(a) * t.w * k;
              const y = Math.sin(a) * t.h * k;
              return <path key={i} className="grass-tuft" d={`M ${x - 0.25} ${y + 0.12} l 0.12 -0.42 M ${x} ${y + 0.12} l 0 -0.5 M ${x + 0.25} ${y + 0.12} l -0.12 -0.42`} />;
            })}
          </>
        );
      }
      return (
        <>
          <rect className="ground" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.2} fill={tex} />
          {Array.from({ length: Math.floor((t.h - 0.4) / 0.45) }, (_, i) => (
            <line key={i} className="furrow" x1={-t.w / 2 + 0.3} x2={t.w / 2 - 0.3} y1={-t.h / 2 + 0.4 + i * 0.45} y2={-t.h / 2 + 0.4 + i * 0.45} />
          ))}
          <rect className="hedge" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.2} />
        </>
      );
    case 'road':
      if (t.path && t.path.length > 1)
        return (
          <>
            <path className="road-verge" d={bandPath(t.path, 0.35)} filter="url(#bank-blur)" />
            <path className="ground road-bed" d={d} fill={tex} />
            {/* Wheel ruts: two lines running along the track. */}
            <path className="road-rut" d={bandPath(t.path.map(([x, y, hw]) => [x, y, hw * 0.4]))} />
          </>
        );
      if (t.look === 'stone' && t.shape === 'circle')
        // Paved ground: a courtyard's flagstones.
        return (
          <>
            <ellipse className="ground paving" rx={t.w / 2} ry={t.h / 2} fill={tex} />
            <ellipse className="tint paving-tint" rx={t.w / 2} ry={t.h / 2} />
          </>
        );
      if (t.look === 'trapdoor' || t.look === 'doorway') return <MoriaPiece t={t} />;
      if (t.look === 'ladder') return <IsengardPiece t={t} />;
      if (t.look === 'planks' || t.look === 'boat') return <LakePiece t={t} />;
      if (t.look === 'gobplanks' || t.look === 'rungs') return <GoblinPiece t={t} />;
      if (t.stairs) {
        // A flight of steps up to a wall's walkway: treads running along the wall, rising towards it (local -y).
        const n = Math.max(4, Math.round(t.h / 0.3));
        return (
          <>
            <rect className="ground paving" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} filter="url(#hard-shadow)" />
            {Array.from({ length: n }, (_, i) => (
              <rect key={i} className="tint step" x={-t.w / 2} y={-t.h / 2 + (i * t.h) / n} width={t.w} height={t.h / n} fillOpacity={0.05 + (0.3 * i) / n} />
            ))}
            <rect className="parapet" x={-t.w / 2} y={-t.h / 2} width={0.22} height={t.h} fill="url(#tex-wall)" />
            <rect className="parapet" x={t.w / 2 - 0.22} y={-t.h / 2} width={0.22} height={t.h} fill="url(#tex-wall)" />
          </>
        );
      }
      if (t.look === 'stone')
        // A stone causeway: paved, with a low parapet down each long side.
        return (
          <>
            <rect className="ground paving" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} filter="url(#hard-shadow)" />
            <rect className="tint paving-tint" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} />
            <rect className="parapet" x={-t.w / 2} y={-t.h / 2} width={t.w} height={0.3} fill={`url(#tex-wall)`} />
            <rect className="parapet" x={-t.w / 2} y={t.h / 2 - 0.3} width={t.w} height={0.3} fill={`url(#tex-wall)`} />
          </>
        );
      return <rect className="ground road-bed" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill={tex} />;
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
    case 'gate': {
      if (t.door === 'dam') return <IsengardPiece t={t} />;
      // Long side runs along w: two leaves of planks with iron bands, a stone post at each end. Broken down, only
      // splinters and the posts are left.
      const post = Math.min(0.5, t.w * 0.12);
      const inner = t.w - post * 2;
      const planks = Math.max(4, Math.round(inner / 0.35));
      if (t.gone)
        return (
          <>
            <rect className="ground gate-post" x={-t.w / 2} y={-t.h / 2} width={post} height={t.h} fill={tex} />
            <rect className="ground gate-post" x={t.w / 2 - post} y={-t.h / 2} width={post} height={t.h} fill={tex} />
            {Array.from({ length: 7 }, (_, i) => (
              <rect key={i} className="gate-splinter" x={-inner / 2 + rand(t.id, i) * (inner - 0.5)} y={-t.h / 2 + rand(t.id, i + 9) * t.h} width={0.5} height={0.12} transform={`rotate(${rand(t.id, i + 20) * 180 - 90} ${-inner / 2 + rand(t.id, i) * (inner - 0.5) + 0.25} ${-t.h / 2 + rand(t.id, i + 9) * t.h})`} />
            ))}
          </>
        );
      return (
        <>
          <rect className="ground gate-leaf" x={-inner / 2} y={-t.h / 2} width={inner} height={t.h} filter="url(#hard-shadow)" />
          {Array.from({ length: planks - 1 }, (_, i) => {
            const x = -inner / 2 + ((i + 1) * inner) / planks;
            return <line key={i} className="gate-plank" x1={x} x2={x} y1={-t.h / 2} y2={t.h / 2} />;
          })}
          {[-0.3, 0.3].map(k => (
            <line key={k} className="gate-band" x1={-inner / 2} x2={inner / 2} y1={k * t.h} y2={k * t.h} />
          ))}
          <line className="gate-seam" x1={0} x2={0} y1={-t.h / 2} y2={t.h / 2} />
          <rect className="ground gate-post" x={-t.w / 2} y={-t.h / 2} width={post} height={t.h} fill={tex} />
          <rect className="ground gate-post" x={t.w / 2 - post} y={-t.h / 2} width={post} height={t.h} fill={tex} />
          {t.side && <rect className={`gate-side ${t.side}`} x={-inner / 2} y={-t.h / 2} width={inner} height={t.h} />}
        </>
      );
    }
    case 'objective':
      if (t.object === 'ladder')
        return (
          <g className={t.raised ? 'ladder raised' : 'ladder'} filter="url(#hard-shadow)">
            <circle className="gear-hit" r={t.w / 2} />
            <line className="ladder-rail" x1={-t.w * 0.22} x2={-t.w * 0.22} y1={-t.w * 0.6} y2={t.w * 0.6} />
            <line className="ladder-rail" x1={t.w * 0.22} x2={t.w * 0.22} y1={-t.w * 0.6} y2={t.w * 0.6} />
            {[-0.4, -0.15, 0.1, 0.35].map(k => (
              <line key={k} className="ladder-rung" x1={-t.w * 0.22} x2={t.w * 0.22} y1={k * t.w} y2={k * t.w} />
            ))}
          </g>
        );
      if (t.object === 'boat')
        // Two Elven boats drawn up side by side at the water's edge, bows downstream.
        return (
          <g className="boats" filter="url(#hard-shadow)">
            {[-0.25, 0.25].map(k => (
              <g key={k} transform={`translate(${k * t.w} 0)`}>
                <path className="boat-hull" d={`M 0 ${-t.h / 2} Q ${t.w * 0.26} ${-t.h * 0.2} ${t.w * 0.22} ${t.h * 0.3} Q ${t.w * 0.12} ${t.h / 2} 0 ${t.h / 2} Q ${-t.w * 0.12} ${t.h / 2} ${-t.w * 0.22} ${t.h * 0.3} Q ${-t.w * 0.26} ${-t.h * 0.2} 0 ${-t.h / 2} Z`} />
                <path className="boat-inside" d={`M 0 ${-t.h * 0.38} Q ${t.w * 0.16} ${-t.h * 0.1} ${t.w * 0.13} ${t.h * 0.28} L ${-t.w * 0.13} ${t.h * 0.28} Q ${-t.w * 0.16} ${-t.h * 0.1} 0 ${-t.h * 0.38} Z`} />
                <line className="boat-thwart" x1={-t.w * 0.17} x2={t.w * 0.17} y1={0} y2={0} />
              </g>
            ))}
          </g>
        );
      if (t.object === 'ram')
        return (
          <g className="ram" filter="url(#hard-shadow)">
            <circle className="gear-hit" r={t.w / 2} />
            <rect className="ram-log" x={-t.w * 0.75} y={-t.w * 0.16} width={t.w * 1.3} height={t.w * 0.32} rx={t.w * 0.12} />
            <path className={`ram-head ${t.side ?? ''}`} d={`M ${t.w * 0.55} ${-t.w * 0.24} L ${t.w * 0.8} 0 L ${t.w * 0.55} ${t.w * 0.24} Z`} />
            {[-0.45, 0.05].map(k => (
              <rect key={k} className="ram-band" x={k * t.w} y={-t.w * 0.17} width={t.w * 0.08} height={t.w * 0.34} />
            ))}
          </g>
        );
      return (
        <>
          <circle className="ground objective" r={t.w / 2} filter="url(#hard-shadow)" />
          <circle className="objective-ring" r={t.w / 2 - 0.08} />
          {t.object ? (
            <text className={`objective-glyph ${t.side ?? ''}`} fontSize={t.w * 0.62} textAnchor="middle" dominantBaseline="central" transform={turn ? `rotate(${-turn})` : undefined}>
              {t.hidden ? '?' : GLYPHS[t.object]}
            </text>
          ) : (
            <path className="objective-star" d={star(t.w * 0.28)} />
          )}
        </>
      );
  }
}

/** The pieces of Balin's Tomb: a dwarf-hewn pillar, the tomb on its plinth, the well, a trapdoor, the doorway. */
/** A number from 0 to 1 that stays the same for a piece, so its roots and stones lie the same way every time. */
function seeded(id: string, k: number) {
  let h = 2166136261;
  for (const c of `${id}:${k}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** One length of a gnarled tree: where it runs, and how thick it is. */
interface Limb {
  d: string;
  w: number;
  /** Where it ends, and whether it's one of the great boughs (a knot-hole may sit there). */
  end: Point;
  big: boolean;
}

/**
 * A gnarled limb of a Mirkwood tree seen from above, from (x, y) at angle `a`: it wavers as it goes, thinning, then
 * splits into lesser limbs, `depth` times over. The same piece always grows the same way.
 */
function gnarl(id: string, k: number, x: number, y: number, a: number, len: number, w: number, depth: number, out: Limb[]) {
  const steps = 3;
  let [px, py, dir] = [x, y, a];
  for (let s = 0; s < steps; s++) {
    dir += (seeded(id, k * 11 + s) - 0.5) * 0.8;
    const seg = len / steps;
    const nx = px + Math.cos(dir) * seg;
    const ny = py + Math.sin(dir) * seg;
    const sway = (seeded(id, k * 11 + s + 5) - 0.5) * seg * 0.6;
    const cx = (px + nx) / 2 + Math.cos(dir + Math.PI / 2) * sway;
    const cy = (py + ny) / 2 + Math.sin(dir + Math.PI / 2) * sway;
    out.push({ d: `M ${px.toFixed(2)} ${py.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${nx.toFixed(2)} ${ny.toFixed(2)}`, w: w * (1 - s * 0.14), end: { x: nx, y: ny }, big: depth >= 2 && s === 1 });
    // (A bigger limb puts out a crooked side branch partway along.)
    if (s === 1 && depth >= 2) {
      const side = seeded(id, k * 23) > 0.5 ? 1 : -1;
      gnarl(id, k * 4 + 9, nx, ny, dir + side * (0.9 + seeded(id, k * 29) * 0.5), len * 0.4, w * 0.45, depth - 2, out);
    }
    [px, py] = [nx, ny];
  }
  if (depth <= 0) return;
  const n = seeded(id, k * 13 + 3) > 0.6 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const turn = (i - (n - 1) / 2) * 0.75 + (seeded(id, k * 17 + i) - 0.5) * 0.5;
    gnarl(id, k * 4 + i + 1, px, py, dir + turn, len * (0.55 + seeded(id, k * 19 + i) * 0.2), w * 0.55, depth - 1, out);
  }
}

/** Gnarled limbs drawn as old grey-brown wood: a shadow on the ground, a dark edge, the bark, a paler ridge, knot-holes. */
function Limbs({ limbs }: { limbs: Limb[] }) {
  return (
    <g className="tint" pointerEvents="none">
      <g transform="translate(0.22 0.32)">
        {limbs.map((l, i) => (
          <path key={i} className="limb-shadow" d={l.d} strokeWidth={l.w} />
        ))}
      </g>
      {limbs.map((l, i) => (
        <path key={i} className="limb-edge" d={l.d} strokeWidth={l.w + 0.14} />
      ))}
      {limbs.map((l, i) => (
        <path key={i} className="limb-bark" d={l.d} strokeWidth={l.w} />
      ))}
      {limbs.map((l, i) => (l.w > 0.25 ? <path key={i} className="limb-ridge" d={l.d} strokeWidth={l.w * 0.22} /> : null))}
      {limbs.map((l, i) => (l.big ? <ellipse key={i} className="limb-knot" cx={l.end.x} cy={l.end.y} rx={l.w * 0.28} ry={l.w * 0.18} /> : null))}
    </g>
  );
}

/**
 * Mirkwood (The Unseen Hero), drawn after the book's map: twisted, gnarled trees seen from above, grey with age. A great
 * tree's mound of roots and stones, with its huge limbs spreading out across it; the great trunk where they meet; and
 * the lesser trees, each a crooked trunk and its branches over a patch of dark leaf-litter.
 */
function MirkwoodPiece({ t }: { t: Terrain }) {
  const rx = t.w / 2;
  const ry = t.h / 2;
  if (t.look === 'trunk') {
    // The great trunk itself: a knot of twisted wood, its limbs and roots wound round each other.
    const limbs: Limb[] = [];
    for (let i = 0; i < 6; i++) {
      const a = ((i + seeded(t.id, i) * 0.5) / 6) * Math.PI * 2;
      gnarl(t.id, i + 1, Math.cos(a + 2.2) * rx * 0.35, Math.sin(a + 2.2) * ry * 0.35, a, Math.min(rx, ry) * 1.1, Math.min(rx, ry) * 0.62, 0, limbs);
    }
    return (
      <>
        <ellipse className="ground trunk-floor" rx={rx} ry={ry} />
        <Limbs limbs={limbs} />
        <ellipse className="tint trunk-hollow" cx={rx * 0.1} cy={-ry * 0.05} rx={rx * 0.2} ry={ry * 0.14} />
      </>
    );
  }
  if (t.look === 'gnarled') {
    // One crooked tree lying along the patch (two in a big one), its branches reaching out across it.
    const along = Math.max(rx, ry);
    const across = rx >= ry ? 0 : Math.PI / 2;
    const n = t.w * t.h > 70 ? 2 : 1;
    const limbs: Limb[] = [];
    for (let i = 0; i < n; i++) {
      const side = n === 1 ? 0 : i ? 0.3 : -0.3;
      const flip = seeded(t.id, 200 + i) > 0.5 ? Math.PI : 0;
      const from = { x: Math.cos(across + flip) * along * (0.55 - Math.abs(side) * 0.3), y: Math.sin(across + flip) * along * (0.55 - Math.abs(side) * 0.3) };
      const off = { x: Math.cos(across + Math.PI / 2) * Math.min(rx, ry) * side * 1.5, y: Math.sin(across + Math.PI / 2) * Math.min(rx, ry) * side * 1.5 };
      gnarl(t.id, 30 + i, from.x + off.x, from.y + off.y, across + flip + Math.PI + (seeded(t.id, 210 + i) - 0.5) * 0.4, along * (n === 1 ? 0.75 : 0.6), 0.8, 3, limbs);
    }
    return (
      <>
        <path className="ground gnarled-floor" d={outline(t)} filter="url(#soft-shadow)" />
        <Limbs limbs={limbs} />
      </>
    );
  }
  // A great tree's mound: its huge limbs spread from the trunk across the mound, and stones lie among them.
  const stones = Array.from({ length: 6 }, (_, i) => {
    const a = seeded(t.id, i + 40) * Math.PI * 2;
    const d = 0.62 + seeded(t.id, i + 60) * 0.3;
    return { x: Math.cos(a) * rx * d, y: Math.sin(a) * ry * d, r: 0.25 + seeded(t.id, i + 80) * 0.35 };
  });
  const limbs: Limb[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = ((i + seeded(t.id, i) * 0.6) / n) * Math.PI * 2;
    // (Each limb reaches most of the way to the mound's edge in its direction.)
    const reach = 1 / Math.hypot(Math.cos(a) / rx, Math.sin(a) / ry);
    gnarl(t.id, i + 1, 0, 0, a, reach * 0.48, 1.1, 2, limbs);
  }
  return (
    <>
      <ellipse className="ground roots-mound" rx={rx} ry={ry} filter="url(#soft-shadow)" />
      {stones.map((p, i) => (
        <ellipse key={i} className="tint roots-stone" cx={p.x} cy={p.y} rx={p.r} ry={p.r * 0.8} />
      ))}
      <Limbs limbs={limbs} />
    </>
  );
}

/** A spiky ring of needles round a pine's crown: `n` points out at `r`, the notches between them further in. */
function needles(id: string, k: number, r: number, n: number, notch: number): string {
  const pts: string[] = [];
  const turn = seeded(id, k) * Math.PI * 2;
  for (let i = 0; i < n * 2; i++) {
    const a = turn + (i / (n * 2)) * Math.PI * 2 + (seeded(id, k * 41 + i) - 0.5) * (Math.PI / n) * 0.5;
    const d = i % 2 ? r * notch * (0.9 + seeded(id, k * 31 + i) * 0.2) : r * (0.82 + seeded(id, k * 37 + i) * 0.26);
    pts.push(`${(Math.cos(a) * d).toFixed(3)} ${(Math.sin(a) * d).toFixed(3)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/** One bough seen from above: a tapering spray of needles from the trunk out along `a`, ragged down both sides. */
function bough(id: string, k: number, a: number, from: number, len: number, w: number): string {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const side: string[] = [];
  const other: string[] = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const along = from + len * f;
    // (Wider partway out, tapering to a point, and jagged: every other step sticks out further.)
    const half = w * Math.sin(Math.PI * Math.min(1, f * 1.15)) * (i % 2 ? 1.25 : 0.7) * (0.85 + seeded(id, k * 13 + i) * 0.3);
    side.push(`${(ux * along - uy * half).toFixed(3)} ${(uy * along + ux * half).toFixed(3)}`);
    other.unshift(`${(ux * along + uy * half).toFixed(3)} ${(uy * along - ux * half).toFixed(3)}`);
  }
  return `M ${side.join(' L ')} L ${other.join(' L ')} Z`;
}

/**
 * The pines (And Into the Fire), seen from above as on the book's map: each tree's crown a round mass of needled
 * boughs in tiers, dark underneath and lit from the north-west on top, casting its shadow on the ground; and the
 * woodland base it stands on, a patch of needle-litter, cones and stones.
 */
function PinePiece({ t }: { t: Terrain }) {
  const rx = t.w / 2;
  const ry = t.h / 2;
  if (t.look === 'pine') {
    // The trunk is the piece; the crown spreads well beyond it.
    const r = rx / 0.4;
    const tiers = [
      { k: 10, n: 11, from: 0.1, len: 0.9, w: 0.2, cls: 'low' },
      { k: 20, n: 9, from: 0.05, len: 0.7, w: 0.19, cls: 'mid' },
      { k: 30, n: 7, from: 0, len: 0.46, w: 0.17, cls: 'high' },
    ];
    return (
      <g pointerEvents="none">
        <ellipse className="pine-shadow" cx={r * 0.38} cy={r * 0.5} rx={r * 0.92} ry={r * 0.86} filter="url(#bank-blur)" />
        <path className="pine-bough under" d={needles(t.id, 1, r * 0.98, 24, 0.74)} />
        {tiers.map(tier =>
          Array.from({ length: tier.n }, (_, i) => {
            const a = ((i + seeded(t.id, tier.k + i) * 0.5) / tier.n) * Math.PI * 2 + seeded(t.id, tier.k) * 6;
            return <path key={`${tier.k}-${i}`} className={`pine-bough ${tier.cls}`} d={bough(t.id, tier.k + i, a, r * tier.from, r * tier.len * (0.9 + seeded(t.id, tier.k + i + 50) * 0.2), r * tier.w)} />;
          }),
        )}
        <path className="pine-bough top" d={needles(t.id, 4, r * 0.2, 8, 0.55)} />
        <circle className="pine-light" r={r} fill="url(#g-pine-light)" />
        <circle className="pine-tip" r={r * 0.06} />
      </g>
    );
  }
  // The woodland base: litter of needles and cones, a few stones.
  const bits = Math.round(t.w * t.h * 3);
  return (
    <>
      <ellipse className="ground pinewood-floor" rx={rx} ry={ry} filter="url(#soft-shadow)" />
      <ellipse className="tint pinewood-shade" rx={rx * 0.86} ry={ry * 0.86} filter="url(#bank-blur)" />
      <g className="tint" pointerEvents="none">
        {Array.from({ length: bits }, (_, i) => {
          const a = seeded(t.id, i + 100) * Math.PI * 2;
          const d = Math.sqrt(seeded(t.id, i + 300));
          const x = Math.cos(a) * rx * d * 0.9;
          const y = Math.sin(a) * ry * d * 0.9;
          const kind = seeded(t.id, i + 500);
          if (kind > 0.95) return <ellipse key={i} className="pinewood-stone" cx={x} cy={y} rx={0.1 + seeded(t.id, i + 700) * 0.12} ry={0.08 + seeded(t.id, i + 800) * 0.08} />;
          if (kind > 0.85) return <ellipse key={i} className="pinewood-cone" cx={x} cy={y} rx={0.07} ry={0.045} transform={`rotate(${(seeded(t.id, i + 900) * 180).toFixed(0)} ${x.toFixed(2)} ${y.toFixed(2)})`} />;
          const l = 0.1 + seeded(t.id, i + 600) * 0.12;
          const b = seeded(t.id, i + 650) * Math.PI;
          return <line key={i} className="pinewood-needle" x1={x} y1={y} x2={x + Math.cos(b) * l} y2={y + Math.sin(b) * l} />;
        })}
      </g>
    </>
  );
}

/**
 * The rocky edge of the cliff (And Into the Fire): a band of broken rock and boulders winding down the table along
 * the drop, its boulders lit from the north-west.
 */
function CliffEdge({ t, d, tex }: { t: Terrain; d: string; tex: string }) {
  const path = t.path!;
  const rocks: ReactElement[] = [];
  let k = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0, w0] = path[i];
    const [x1, y1] = path[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let s = 0; s < len; s += 0.55) {
      const f = s / len;
      const across = (seeded(t.id, k * 3) - 0.5) * w0 * 1.5;
      const x = x0 + (x1 - x0) * f + nx * across;
      const y = y0 + (y1 - y0) * f + ny * across;
      const r = 0.22 + seeded(t.id, k * 3 + 1) ** 2 * 0.55;
      const sides = 5 + Math.floor(seeded(t.id, k * 3 + 2) * 3);
      const pts = Array.from({ length: sides }, (_, j) => {
        const a = (j / sides) * Math.PI * 2 + seeded(t.id, k * 7 + j);
        const q = r * (0.7 + seeded(t.id, k * 11 + j) * 0.45);
        return `${(x + Math.cos(a) * q).toFixed(3)},${(y + Math.sin(a) * q * 0.85).toFixed(3)}`;
      }).join(' ');
      rocks.push(<polygon key={k} className="cliff-boulder" points={pts} fill={tex} />);
      k++;
    }
  }
  const line = (off: number) => `M ${path.map(([x, y]) => `${(x + off).toFixed(2)} ${y.toFixed(2)}`).join(' L ')}`;
  return (
    <>
      <path className="ground cliff-scree" d={d} fill={tex} filter="url(#soft-shadow)" />
      <path className="tint cliff-shade" d={d} />
      {/* Where the rock falls away, along the table edge: a dark drop beyond a pale lip. */}
      <path className="tint cliff-drop" d={line(0.75)} />
      <path className="tint cliff-lip" d={line(0.25)} />
      <g className="tint" filter="url(#hard-shadow)" pointerEvents="none">
        {rocks}
      </g>
    </>
  );
}

/**
 * Goblin-town (Escape from Goblin-town): rickety plank walkways and rope-and-rung ladders over a bottomless chasm,
 * crags of dark rock, the cavern walls round the edges and the Goblin King's crude throne.
 */
function GoblinPiece({ t }: { t: Terrain }) {
  const { w, h } = t;
  if (t.look === 'chasm') {
    // Nothing below: black, with a few far-off ledges and the faint glow of fires deep down.
    return (
      <g pointerEvents="none">
        <rect className="chasm-void" x={-w / 2} y={-h / 2} width={w} height={h} />
        {Array.from({ length: 26 }, (_, i) => (
          <ellipse
            key={i}
            className={i % 5 === 0 ? 'chasm-glow' : 'chasm-ledge'}
            cx={(seeded(t.id, i) - 0.5) * w}
            cy={(seeded(t.id, i + 40) - 0.5) * h}
            rx={1 + seeded(t.id, i + 80) * 3.5}
            ry={0.6 + seeded(t.id, i + 120) * 2}
            transform={`rotate(${seeded(t.id, i + 160) * 180})`}
            filter="url(#bank-blur)"
          />
        ))}
      </g>
    );
  }
  if (t.look === 'gobplanks') {
    // Odd boards nailed across the way, none quite the same length or colour, with lashed posts at the ends.
    const boards = Math.max(2, Math.round(w / 0.45));
    const bw = w / boards;
    return (
      <>
        <rect className="ground gob-under" x={-w / 2} y={-h / 2 + 0.1} width={w} height={h - 0.2} filter="url(#hard-shadow)" />
        {Array.from({ length: boards }, (_, i) => {
          const top = -h / 2 - 0.08 + seeded(t.id, i) * 0.22;
          const bottom = h / 2 + 0.08 - seeded(t.id, i + 300) * 0.22;
          return (
            <rect
              key={i}
              className={`gob-board gob-board-${Math.floor(seeded(t.id, i + 600) * 3)}`}
              x={-w / 2 + i * bw + 0.02}
              y={top}
              width={bw - 0.05 - seeded(t.id, i + 900) * 0.06}
              height={bottom - top}
              transform={`rotate(${(seeded(t.id, i + 1200) - 0.5) * 3} ${-w / 2 + (i + 0.5) * bw} 0)`}
            />
          );
        })}
        {Array.from({ length: Math.round(w * h * 0.08) }, (_, i) => (
          <circle key={`n${i}`} className="gob-nail" cx={(seeded(t.id, i + 1500) - 0.5) * (w - 0.3)} cy={(seeded(t.id, i + 1800) - 0.5) * (h - 0.3)} r={0.05} />
        ))}
        {w * h > 12 &&
          Array.from({ length: Math.round(w * h * 0.025) }, (_, i) => {
            const x = (seeded(t.id, i + 2100) - 0.5) * (w - 1);
            const y = (seeded(t.id, i + 2400) - 0.5) * (h - 1);
            return (
              <g key={`b${i}`} className="gob-bone" transform={`translate(${x} ${y}) rotate(${seeded(t.id, i + 2700) * 180})`}>
                <line x1={-0.28} x2={0.28} y1={0} y2={0} />
                <circle cx={-0.28} cy={0} r={0.07} />
                <circle cx={0.28} cy={0} r={0.07} />
              </g>
            );
          })}
        {[-1, 1].flatMap(i => [-1, 1].map(j => <circle key={`${i}${j}`} className="gob-post" cx={i * (w / 2 - 0.12)} cy={j * (h / 2 - 0.1)} r={0.17} />))}
      </>
    );
  }
  if (t.look === 'rungs') {
    // A ladder laid flat across the gap: two poles, rungs lashed between them, the chasm showing through.
    const rungs = Math.max(3, Math.round(w / 0.36));
    return (
      <>
        {Array.from({ length: rungs }, (_, i) => {
          const x = -w / 2 + 0.15 + (i * (w - 0.3)) / (rungs - 1);
          return <line key={i} className="gob-rung" x1={x} x2={x + (seeded(t.id, i) - 0.5) * 0.08} y1={-h / 2 + 0.08} y2={h / 2 - 0.08} />;
        })}
        <rect className="gob-pole" x={-w / 2} y={-h / 2} width={w} height={0.16} rx={0.08} />
        <rect className="gob-pole" x={-w / 2} y={h / 2 - 0.16} width={w} height={0.16} rx={0.08} />
      </>
    );
  }
  if (t.look === 'throne') {
    // A great lump of a seat: a high back of rough-hewn stone, arms either side, and skulls along the top.
    return (
      <>
        <rect className="ground throne-base" x={-w / 2} y={-h / 2} width={w} height={h} rx={0.2} filter="url(#hard-shadow)" />
        <rect className="throne-back" x={-w / 2} y={-h / 2} width={w} height={h * 0.32} rx={0.15} />
        <rect className="throne-arm" x={-w / 2} y={-h / 2} width={w * 0.2} height={h} rx={0.12} />
        <rect className="throne-arm" x={w / 2 - w * 0.2} y={-h / 2} width={w * 0.2} height={h} rx={0.12} />
        <rect className="throne-seat" x={-w * 0.3} y={-h / 2 + h * 0.32} width={w * 0.6} height={h * 0.62} rx={0.1} />
        {[-0.3, 0, 0.3].map(k => (
          <circle key={k} className="throne-skull" cx={w * k} cy={-h / 2 + 0.16} r={0.14} />
        ))}
      </>
    );
  }
  // The rock: crags standing out of the chasm and the cavern walls at the edges, a heap of broken boulders on scree.
  const wall = t.look === 'cavewall';
  const n = Math.max(5, Math.round(w * h * (wall ? 0.9 : 1.1)));
  const stones = Array.from({ length: n }, (_, i) => {
    const a = seeded(t.id, i) * Math.PI * 2;
    const q = Math.sqrt(seeded(t.id, i + 50)) * 0.8;
    const r = Math.min(w, h) * (0.12 + seeded(t.id, i + 100) ** 1.5 * 0.2) + 0.15;
    return { x: (Math.cos(a) * q * w) / 2, y: (Math.sin(a) * q * h) / 2, r, k: i };
  }).sort((p, q) => p.y - q.y);
  const shape = (x: number, y: number, r: number, k: number, grow = 1) => {
    const sides = 5 + Math.floor(seeded(t.id, k + 200) * 3);
    return Array.from({ length: sides }, (_, j) => {
      const a = (j / sides) * Math.PI * 2 + seeded(t.id, k * 7 + j + 300);
      const m = r * grow * (0.72 + seeded(t.id, k * 11 + j + 400) * 0.4);
      return `${(x + Math.cos(a) * m).toFixed(3)},${(y + Math.sin(a) * m * 0.88).toFixed(3)}`;
    }).join(' ');
  };
  return (
    <>
      <path className={`ground ${wall ? 'cave-wall' : 'gob-crag'}`} d={blob(t, 1, 0.14, 3)} filter="url(#hard-shadow)" />
      <g className="tint" pointerEvents="none">
        {stones.map(({ x, y, r, k }) => (
          <g key={k}>
            <polygon className={`gob-stone gob-stone-${k % 3}`} points={shape(x, y, r, k)} />
            <polygon className="gob-stone-lit" points={shape(x - r * 0.18, y - r * 0.2, r, k, 0.55)} />
          </g>
        ))}
      </g>
    </>
  );
}

/**
 * Osgiliath (Escape from Osgiliath): broken walls of pale dressed stone, their tops ragged where they fell; the great
 * ruined buildings, roofed in steps of stone round an open court; and heaps of fallen masonry.
 */
function OsgiliathPiece({ t }: { t: Terrain }) {
  const { w, h } = t;
  if (t.look === 'osgwall') {
    // Courses of blocks along the wall, a jagged line where the top broke off, a chipped end or two.
    const blocks = Math.max(1, Math.round(w / 0.55));
    const bw = w / blocks;
    const top = Array.from({ length: blocks + 1 }, (_, i) => `${(-w / 2 + i * bw).toFixed(3)},${(-h / 2 + seeded(t.id, i) * h * 0.35).toFixed(3)}`).join(' ');
    return (
      <>
        <rect className="ground osg-wall" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />
        {Array.from({ length: blocks - 1 }, (_, i) => {
          const x = -w / 2 + (i + 1) * bw + (seeded(t.id, i + 50) - 0.5) * 0.1;
          return <line key={i} className="osg-seam" x1={x} x2={x} y1={-h / 2} y2={h / 2} />;
        })}
        <line className="osg-seam" x1={-w / 2} x2={w / 2} y1={0} y2={0} />
        <polyline className="osg-break" points={top} />
      </>
    );
  }
  if (t.look === 'stepped') {
    // Four steps of stone up to a parapet round an open court in the middle, each step paler than the one below.
    const steps = [1, 0.84, 0.68, 0.52];
    const sx = (k: number) => (w * k) / 2;
    const sy = (k: number) => (h * k) / 2;
    return (
      <>
        {steps.map((k, i) => (
          <rect key={k} className={`${i ? '' : 'ground '}osg-step osg-step-${i}`} x={-sx(k)} y={-sy(k)} width={2 * sx(k)} height={2 * sy(k)} {...(i ? {} : { filter: 'url(#hard-shadow)' })} />
        ))}
        {/* The step edges meeting at the corners, as the book's plan draws them. */}
        {[-1, 1].flatMap(i => [-1, 1].map(j => <line key={`${i}${j}`} className="osg-seam" x1={i * sx(1)} y1={j * sy(1)} x2={i * sx(0.52)} y2={j * sy(0.52)} />))}
        <rect className="osg-court" x={-sx(0.38)} y={-sy(0.38)} width={2 * sx(0.38)} height={2 * sy(0.38)} />
      </>
    );
  }
  // Rubble: a heap of broken blocks and chips, the bigger pieces toppled slabs.
  const n = Math.max(3, Math.round(w * h * 3));
  const stones = Array.from({ length: n }, (_, i) => {
    const a = seeded(t.id, i) * Math.PI * 2;
    const q = Math.sqrt(seeded(t.id, i + 50)) * 0.75;
    const r = Math.min(w, h) * (0.1 + seeded(t.id, i + 100) ** 1.5 * 0.25) + 0.06;
    return { x: (Math.cos(a) * q * w) / 2, y: (Math.sin(a) * q * h) / 2, r, k: i };
  }).sort((p, q) => p.y - q.y);
  const shape = (x: number, y: number, r: number, k: number) => {
    const sides = 4 + Math.floor(seeded(t.id, k + 200) * 3);
    return Array.from({ length: sides }, (_, j) => {
      const a = (j / sides) * Math.PI * 2 + seeded(t.id, k * 7 + j + 300);
      const m = r * (0.7 + seeded(t.id, k * 11 + j + 400) * 0.45);
      return `${(x + Math.cos(a) * m).toFixed(3)},${(y + Math.sin(a) * m).toFixed(3)}`;
    }).join(' ');
  };
  return (
    <>
      <path className="ground osg-heap" d={blob(t, 1, 0.18, 5)} filter="url(#soft-shadow)" />
      <g className="tint" pointerEvents="none">
        {stones.map(({ x, y, r, k }) => (
          <polygon key={k} className={`osg-block osg-block-${k % 3}`} points={shape(x, y, r, k)} />
        ))}
      </g>
    </>
  );
}

/**
 * Lake-town (Lake-town Escape): plank walkways on posts over the lake, rowing boats tied up, ice floes, and timber
 * houses with shingled roofs: a ridge along a long house, four slopes meeting at a point on a square one.
 */
function LakePiece({ t }: { t: Terrain }) {
  const { w, h } = t;
  if (t.look === 'planks') {
    // Boards laid across the walkway, a post at each end and every 2" along, both sides.
    const boards = Math.max(2, Math.round(w / 0.42));
    const posts = Math.max(1, Math.round(w / 2));
    return (
      <>
        <rect className="ground walk-deck" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />
        {Array.from({ length: boards - 1 }, (_, i) => {
          const x = -w / 2 + ((i + 1) * w) / boards;
          return <line key={i} className="walk-seam" x1={x} x2={x + (seeded(t.id, i) - 0.5) * 0.05} y1={-h / 2} y2={h / 2} />;
        })}
        <rect className="walk-rail" x={-w / 2} y={-h / 2} width={w} height={0.14} />
        <rect className="walk-rail" x={-w / 2} y={h / 2 - 0.14} width={w} height={0.14} />
        {Array.from({ length: posts + 1 }, (_, i) =>
          [-1, 1].map(k => <circle key={`${i}${k}`} className="walk-post" cx={-w / 2 + 0.15 + (i * (w - 0.3)) / posts} cy={k * (h / 2 - 0.07)} r={0.16} />),
        )}
      </>
    );
  }
  if (t.look === 'boat') {
    // A rowing boat seen from above: pointed at the bow, square at the stern, two thwarts across.
    const hull = `M ${-w / 2} ${-h / 2} L ${w * 0.18} ${-h / 2} Q ${w / 2} ${-h * 0.3} ${w / 2} 0 Q ${w / 2} ${h * 0.3} ${w * 0.18} ${h / 2} L ${-w / 2} ${h / 2} Z`;
    return (
      <>
        <path className="ground boat-hull" d={hull} filter="url(#hard-shadow)" />
        <path className="tint boat-inside" d={hull} transform="scale(0.78 0.6)" />
        {[-0.22, 0.12].map(k => (
          <line key={k} className="boat-thwart" x1={w * k} x2={w * k} y1={-h * 0.3} y2={h * 0.3} />
        ))}
      </>
    );
  }
  if (t.look === 'floe') {
    // A slab of ice: a pale, angular outline with a few cracks.
    const pts = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + seeded(t.id, i) * 0.5;
      const k = 0.78 + seeded(t.id, i + 10) * 0.22;
      return `${((Math.cos(a) * w) / 2) * k},${((Math.sin(a) * h) / 2) * k}`;
    });
    return (
      <>
        <polygon className="ground ice-floe" points={pts.join(' ')} filter="url(#soft-shadow)" />
        <path className="ice-crack" d={`M ${-w * 0.25} ${-h * 0.1} l ${w * 0.2} ${h * 0.15} l ${w * 0.18} ${-h * 0.2}`} />
      </>
    );
  }
  // The buildings, after Games Workshop's Lake-town House: a tower's pyramid roof over a plank gallery; a house's steep
  // gabled roof (its ridge along its length, a wing's across it) on its plank platform.
  if (t.look === 'laketower') return <LakeTower w={w} h={h} />;
  if (t.look === 'lakewing') {
    return (
      <g transform="rotate(90)">
        <GableRoof id={t.id} w={h} h={w} porch={0} />
      </g>
    );
  }
  // (Its ridge along its longer side.)
  if (h > w) {
    return (
      <g transform="rotate(90)">
        <GableRoof id={t.id} w={h} h={w} porch={Math.min(0.5, w * 0.14)} dormer={h >= 4} />
      </g>
    );
  }
  return <GableRoof id={t.id} w={w} h={h} porch={Math.min(0.5, h * 0.14)} dormer={w >= 4} />;
}

/** Planks across a platform (running along y), with a post at each corner. */
function Deck({ w, h }: { w: number; h: number }) {
  const boards = Math.max(2, Math.round(w / 0.42));
  return (
    <>
      <rect className="ground walk-deck" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />
      {Array.from({ length: boards - 1 }, (_, i) => {
        const x = -w / 2 + ((i + 1) * w) / boards;
        return <line key={i} className="walk-seam" x1={x} x2={x} y1={-h / 2} y2={h / 2} />;
      })}
      {[-1, 1].flatMap(i => [-1, 1].map(j => <circle key={`${i}${j}`} className="walk-post" cx={i * (w / 2 - 0.14)} cy={j * (h / 2 - 0.14)} r={0.15} />))}
    </>
  );
}

/**
 * A steep gabled roof seen from above, its ridge along x: two shingled slopes (the north one catching the light), a
 * ridge cap, barge boards along the gable ends, a stovepipe, and on the bigger houses a dormer on the south slope. A
 * strip of the platform shows along the south side, where the door is.
 */
function GableRoof({ id, w, h, porch, dormer }: { id: string; w: number; h: number; porch: number; dormer?: boolean }) {
  const e = 0.08;
  const [x0, x1, y0, y1] = [-w / 2 + e, w / 2 - e, -h / 2 + e, h / 2 - e - porch];
  const mid = (y0 + y1) / 2;
  const north = `M ${x0} ${y0} H ${x1} V ${mid} H ${x0} Z`;
  const south = `M ${x0} ${mid} H ${x1} V ${y1} H ${x0} Z`;
  // (The dormer and the stovepipe at the same spots on every copy of a house, but not on every house.)
  const dx = (seeded(id, 1) - 0.5) * w * 0.3;
  const px = (seeded(id, 2) > 0.5 ? 1 : -1) * w * 0.3;
  const dw = 0.9;
  const dTop = mid + 0.2;
  const dBot = y1 - 0.15;
  return (
    <>
      {porch ? <Deck w={w} h={h} /> : <rect className="ground house-eaves" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />}
      <g filter={porch ? 'url(#soft-shadow)' : undefined}>
        <path className="house-roof" d={north} />
        <path d={north} fill="url(#shingles-x)" />
        <path d={north} fill="#ffffff" opacity={0.1} />
        <path className="house-roof" d={south} />
        <path d={south} fill="url(#shingles-x)" />
        <path d={south} fill="#000" opacity={0.22} />
      </g>
      {dormer && dBot - dTop > 0.5 && (
        <g filter="url(#soft-shadow)">
          <path className="house-roof" d={`M ${dx - dw / 2} ${dTop} H ${dx} V ${dBot} H ${dx - dw / 2} Z`} />
          <path d={`M ${dx - dw / 2} ${dTop} H ${dx} V ${dBot} H ${dx - dw / 2} Z`} fill="url(#shingles-y)" />
          <path className="house-roof" d={`M ${dx} ${dTop} H ${dx + dw / 2} V ${dBot} H ${dx} Z`} />
          <path d={`M ${dx} ${dTop} H ${dx + dw / 2} V ${dBot} H ${dx} Z`} fill="#000" opacity={0.3} />
          <line className="house-ridge-thin" x1={dx} x2={dx} y1={dTop} y2={dBot} />
          <rect className="dormer-edge" x={dx - dw / 2} y={dTop} width={dw} height={dBot - dTop} />
          <rect className="dormer-window" x={dx - dw * 0.3} y={dBot - 0.02} width={dw * 0.6} height={0.14} />
        </g>
      )}
      <rect className="house-ridge-cap" x={x0} y={mid - 0.09} width={x1 - x0} height={0.18} />
      <line className="house-ridge-light" x1={x0} x2={x1} y1={mid - 0.05} y2={mid - 0.05} />
      <rect className="house-trim" x={x0 - 0.02} y={y0} width={0.13} height={y1 - y0} />
      <rect className="house-trim" x={x1 - 0.11} y={y0} width={0.13} height={y1 - y0} />
      <rect className="house-eave-line" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      {w >= 3 && (
        <>
          <circle className="house-stovepipe" cx={px} cy={mid - 0.45} r={0.16} />
          <circle className="house-stovepipe-hole" cx={px} cy={mid - 0.45} r={0.08} />
        </>
      )}
    </>
  );
}

/** A tower: a pyramid roof of shingles over a gallery of planks with a rail round it, and a finial at the top. */
function LakeTower({ w, h }: { w: number; h: number }) {
  const g = Math.min(0.55, Math.min(w, h) * 0.14);
  const [x0, x1, y0, y1] = [-w / 2 + g, w / 2 - g, -h / 2 + g, h / 2 - g];
  const faces: [string, string, number][] = [
    [`M ${x0} ${y0} L ${x1} ${y0} L 0 0 Z`, 'url(#shingles-x)', 0.12],
    [`M ${x1} ${y0} L ${x1} ${y1} L 0 0 Z`, 'url(#shingles-y)', -0.18],
    [`M ${x1} ${y1} L ${x0} ${y1} L 0 0 Z`, 'url(#shingles-x)', -0.3],
    [`M ${x0} ${y1} L ${x0} ${y0} L 0 0 Z`, 'url(#shingles-y)', 0.02],
  ];
  return (
    <>
      <Deck w={w} h={h} />
      <rect className="tower-rail" x={-w / 2 + 0.06} y={-h / 2 + 0.06} width={w - 0.12} height={h - 0.12} />
      <g filter="url(#soft-shadow)">
        {faces.map(([d, fill, light], i) => (
          <g key={i}>
            <path className="house-roof" d={d} />
            <path d={d} fill={fill} />
            <path d={d} fill={light > 0 ? '#fff' : '#000'} opacity={Math.abs(light)} />
          </g>
        ))}
      </g>
      {[
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y], i) => (
        <line key={i} className="house-hip" x1={x} y1={y} x2={0} y2={0} />
      ))}
      <rect className="house-eave-line" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      <circle className="house-finial" r={0.2} />
    </>
  );
}

/**
 * Isengard (Last March of the Ents): the black rock of Orthanc, timber scaffolds and their ladders, the pits torn in
 * the ground, and the dam holding back the Isen.
 */
function IsengardPiece({ t }: { t: Terrain }) {
  const { w, h } = t;
  if (t.look === 'orthanc') {
    // Sheer black rock, ribbed along its length; the core drawn as a stepped square.
    const ribs = t.w > t.h * 1.5 ? Math.max(2, Math.round(h / 0.6)) : 0;
    return (
      <>
        <rect className="ground orthanc-rock" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />
        {ribs > 0 && Array.from({ length: ribs - 1 }, (_, i) => <line key={i} className="tint orthanc-rib" x1={-w / 2 + 0.3} x2={w / 2 - 0.3} y1={-h / 2 + ((i + 1) * h) / ribs} y2={-h / 2 + ((i + 1) * h) / ribs} />)}
        {ribs > 0 && [-1, 1].map(k => <path key={k} className="tint orthanc-rib" d={`M ${(k * w) / 2} ${-h / 2} l ${-k * 0.45} 0.45 l 0 ${h - 0.9} l ${k * 0.45} 0.45`} />)}
        {!ribs && [0.12, 0.26, 0.4].map(f => <rect key={f} className="tint orthanc-rib" x={-w / 2 + w * f * 0.5} y={-h / 2 + h * f * 0.5} width={w * (1 - f)} height={h * (1 - f)} />)}
        <rect className="tint" x={-w / 2} y={-h / 2} width={w} height={h} fill="url(#g-dome)" />
        {!ribs && <text className="orthanc-height" x={0} y={0.35}>{`${t.height ?? 0}″`}</text>}
      </>
    );
  }
  if (t.look === 'scaffold') {
    // A timber deck: planks laid across it, a beam down each long side, and the ends of the uprights at the corners.
    const n = Math.max(4, Math.round(w / 0.32));
    return (
      <>
        <rect className="ground scaffold-deck" x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#hard-shadow)" />
        {Array.from({ length: n - 1 }, (_, i) => {
          const x = -w / 2 + ((i + 1) * w) / n;
          return <line key={i} className="tint scaffold-plank" x1={x} x2={x} y1={-h / 2} y2={h / 2} />;
        })}
        <rect className="tint scaffold-beam" x={-w / 2} y={-h / 2} width={w} height={0.16} />
        <rect className="tint scaffold-beam" x={-w / 2} y={h / 2 - 0.16} width={w} height={0.16} />
        {[-1, 1].flatMap(a => [-1, 1].map(b => <rect key={`${a}${b}`} className="tint scaffold-post" x={(a * w) / 2 - (a > 0 ? 0.3 : 0)} y={(b * h) / 2 - (b > 0 ? 0.3 : 0)} width={0.3} height={0.3} />))}
        {Array.from({ length: 3 }, (_, i) => <circle key={i} className="tint scaffold-nail" cx={-w / 2 + (0.2 + rand(t.id, i) * 0.6) * w} cy={(rand(t.id, i + 5) - 0.5) * h * 0.6} r={0.07} />)}
      </>
    );
  }
  if (t.look === 'ladder') {
    // Two rails and their rungs, running the long way (local y).
    const rungs = Math.max(3, Math.round(h / 0.22));
    return (
      <>
        {Array.from({ length: rungs }, (_, i) => {
          const y = -h / 2 + ((i + 0.5) * h) / rungs;
          return <line key={i} className="ladder-rung" x1={-w * 0.32} x2={w * 0.32} y1={y} y2={y} />;
        })}
        <line className="ladder-rail" x1={-w * 0.32} x2={-w * 0.32} y1={-h / 2} y2={h / 2} filter="url(#hard-shadow)" />
        <line className="ladder-rail" x1={w * 0.32} x2={w * 0.32} y1={-h / 2} y2={h / 2} filter="url(#hard-shadow)" />
      </>
    );
  }
  if (t.look === 'pit') {
    // A jagged crevice: crumbling pale edges round a dark gash, narrowing at its ends.
    const n = Math.max(4, Math.round(w / 0.5));
    const edge = (side: 1 | -1, k: number) =>
      Array.from({ length: n + 1 }, (_, i) => {
        const x = -w / 2 + (i * w) / n;
        const taper = Math.min(1, (Math.min(i, n - i) + 0.6) / 2);
        const y = side * (h / 2) * k * taper * (0.75 + rand(t.id, i * 2 + (side > 0 ? 1 : 0)) * 0.25);
        return `${x.toFixed(3)},${y.toFixed(3)}`;
      });
    const shape = (k: number) => [...edge(-1, k), ...edge(1, k).reverse()].join(' ');
    return (
      <>
        <polygon className="ground pit-rim" points={shape(1)} />
        <polygon className="tint pit-gash" points={shape(0.62)} />
      </>
    );
  }
  // The dam: courses of dressed stone, a walk along its top, and sluices; broken, a breach the river pours through.
  const courses = Math.max(4, Math.round(h / 0.8));
  if (t.gone)
    return (
      <>
        <rect className="ground dam-flood" x={-w / 2} y={-h / 2} width={w + 1.5} height={h} />
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} className="dam-rubble" x={-w / 2 + rand(t.id, i) * w} y={-h / 2 + rand(t.id, i + 11) * (h - 0.6)} width={0.5 + rand(t.id, i + 3) * 0.4} height={0.4} transform={`rotate(${rand(t.id, i + 20) * 90 - 45} ${-w / 2 + rand(t.id, i) * w} ${-h / 2 + rand(t.id, i + 11) * (h - 0.6)})`} />
        ))}
      </>
    );
  return (
    <>
      <rect className="ground dam-stone" x={-w / 2} y={-h / 2} width={w} height={h} fill="url(#tex-wall)" filter="url(#hard-shadow)" />
      {Array.from({ length: courses - 1 }, (_, i) => {
        const y = -h / 2 + ((i + 1) * h) / courses;
        return <line key={i} className="tint dam-course" x1={-w / 2} x2={w / 2} y1={y} y2={y} />;
      })}
      <rect className="tint dam-walk" x={w / 2 - 0.45} y={-h / 2} width={0.45} height={h} />
      {[-0.3, 0, 0.3].map(f => <rect key={f} className="tint dam-sluice" x={-w / 2 + 0.15} y={f * h - 0.5} width={w - 0.75} height={1} />)}
      <rect className="tint dam-water" x={-w / 2} y={-h / 2} width={0.22} height={h} />
    </>
  );
}

function MoriaPiece({ t }: { t: Terrain }) {
  const octagon = (r: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = ((i + 0.5) * Math.PI) / 4;
      return `${(Math.cos(a) * r).toFixed(3)},${(Math.sin(a) * r).toFixed(3)}`;
    }).join(' ');
  switch (t.look) {
    case 'pillar':
      return (
        <>
          <polygon className="ground moria-stone" points={octagon(t.w / 2)} fill="url(#tex-wall)" filter="url(#hard-shadow)" />
          <polygon className="tint moria-carving" points={octagon(t.w * 0.36)} />
          <polygon className="tint" points={octagon(t.w / 2)} fill="url(#g-dome)" />
        </>
      );
    case 'tomb':
      return (
        <>
          <rect className="ground moria-stone" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} fill="url(#tex-wall)" filter="url(#hard-shadow)" />
          <rect className="tint moria-lid" x={-t.w / 2 + 0.25} y={-t.h / 2 + 0.25} width={t.w - 0.5} height={t.h - 0.5} />
          <path className="tint moria-carving" d={`M 0 ${-t.h / 2 + 0.6} L 0 ${t.h / 2 - 0.6} M -0.35 ${-t.h / 2 + 0.9} L 0.35 ${-t.h / 2 + 0.9}`} />
        </>
      );
    case 'well':
      return (
        <>
          <circle className="ground moria-stone" r={t.w / 2} fill="url(#tex-wall)" filter="url(#hard-shadow)" />
          <circle className="tint moria-well-mouth" r={t.w / 2 - 0.22} />
        </>
      );
    case 'trapdoor': {
      const planks = 4;
      return (
        <>
          <rect className="ground gate-leaf" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.06} />
          {Array.from({ length: planks - 1 }, (_, i) => {
            const y = -t.h / 2 + ((i + 1) * t.h) / planks;
            return <line key={i} className="gate-plank" x1={-t.w / 2} x2={t.w / 2} y1={y} y2={y} />;
          })}
          <rect className="moria-trapdoor-frame" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={0.06} />
          <circle className="moria-ring" r={0.18} />
        </>
      );
    }
    default:
      // The doorway: the dark beyond, between two stone door-posts.
      return (
        <>
          <rect className="ground moria-dark" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} />
          <rect className="parapet" x={-t.w / 2 - 0.3} y={-t.h / 2} width={0.3} height={t.h} fill="url(#tex-wall)" />
          <rect className="parapet" x={t.w / 2} y={-t.h / 2} width={0.3} height={t.h} fill="url(#tex-wall)" />
        </>
      );
  }
}

/** Merlons along both long faces of a fortress wall, with the walkway between them a shade darker. */
function Battlements({ w, h }: { w: number; h: number }) {
  const n = Math.max(2, Math.round(w / 0.6));
  const m = Math.min(0.3, h * 0.26);
  return (
    <g className="battlements" pointerEvents="none">
      <rect className="walkway" x={-w / 2} y={-h / 2 + m} width={w} height={h - 2 * m} />
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + (i * w) / n + w / n / 4;
        return [-h / 2, h / 2 - m].map(y => <rect key={`${i}-${y}`} className="merlon" x={x} y={y} width={w / n / 2} height={m} />);
      })}
    </g>
  );
}

/** A stone keep or tower from above: its roof stepped up in tiers, with battlements round the top. */
function StoneTower({ t, tex }: { t: Terrain; tex: string }) {
  const round = t.shape === 'circle';
  const tier = (k: number, cls: string, fill: string, filter?: string) =>
    round ? <ellipse key={`${cls}-${k}`} className={cls} rx={(t.w / 2) * k} ry={(t.h / 2) * k} fill={fill} filter={filter} /> : <rect key={`${cls}-${k}`} className={cls} x={(-t.w / 2) * k} y={(-t.h / 2) * k} width={t.w * k} height={t.h * k} fill={fill} filter={filter} />;
  return (
    <>
      {tier(1, 'ground keep-wall', tex, 'url(#hard-shadow)')}
      {tier(1, 'tint keep-edge', 'none')}
      {tier(0.78, 'tint keep-roof', 'url(#tex-stone)', 'url(#hard-shadow)')}
      {tier(0.78, 'tint keep-edge', 'none')}
      {tier(0.45, 'tint keep-top', tex, 'url(#hard-shadow)')}
      {tier(0.45, 'tint keep-edge', 'none')}
      {tier(1, 'tint', 'url(#g-dome)')}
    </>
  );
}

/** A letter on each kind of scenario marker, so you can tell them apart at a glance. */
const GLYPHS: Record<NonNullable<Terrain['object']>, string> = { artefact: 'A', relic: 'R', heirloom: 'H', decoy: '✕', supply: 'S', ally: '+', ladder: 'L', ram: 'B', rocks: '●', oil: '♨', rally: '⚑', campfire: '♨', charge: '✸', hobbit: 'z', boat: '⛵', cocoon: '❋', dwarf: 'D', weapons: '⚔' };

function star(r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? r * 0.45 : r;
    pts.push(`${(Math.cos(a) * k).toFixed(3)} ${(Math.sin(a) * k).toFixed(3)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

// ——— Fortress faces ———
// The table is seen from a little south-east of overhead, as you'd look across a real one: each tall fortress piece
// shows its south and east faces below its top, the stone dropping away to the ground. Looks only; the top is where
// the piece stands for play.

/** How far down the screen a face reaches for each inch of height. */
const LEAN = { x: 0.17, y: 0.34 };

/** That lean on the table itself, turned `turn` degrees on screen, so the faces always drop towards the viewer. */
function leanOn(turn: number): Point {
  const a = (-turn * Math.PI) / 180;
  return { x: LEAN.x * Math.cos(a) - LEAN.y * Math.sin(a), y: LEAN.x * Math.sin(a) + LEAN.y * Math.cos(a) };
}

function hull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether a piece is part of a fortress that stands tall (its walls, gates, keep, towers and the rock under them), or a stone piece of Balin's Tomb. */
const tall = (t: Terrain) => !t.gone && ((t.sheer && t.look !== 'trunk' && t.look !== 'pine') || t.look === 'osgwall' || t.look === 'stepped' || t.kind === 'gate' || (t.look === 'stone' && t.kind !== 'road') || t.look === 'pillar' || t.look === 'tomb' || t.look === 'well' || t.look === 'scaffold');
/** Orthanc's faces are cut short, so the tower doesn't hide the table round it (its height is written on top). */
const FACE_CAP = 5.5;

/** The ground a piece's faces cover, from its top down to its foot; a causeway slopes from the gate to the ground. */
function face(t: Terrain, lean: Point): Point[] {
  const top = boardOutline(t, 28);
  if (t.kind === 'road') {
    // The causeway: its gate end (local -x) stands high, its far end on the ground.
    const a = (t.rot * Math.PI) / 180;
    const along = (p: Point) => ((p.x - t.x) * Math.cos(a) + (p.y - t.y) * Math.sin(a)) / t.w + 0.5;
    return hull([...top, ...top.map(p => ({ x: p.x + lean.x * 2.2 * (1 - along(p)), y: p.y + lean.y * 2.2 * (1 - along(p)) }))]);
  }
  const h = t.look === 'orthanc' ? Math.min(heightOf(t), FACE_CAP) : heightOf(t);
  return hull([...top, ...top.map(p => ({ x: p.x + lean.x * h, y: p.y + lean.y * h }))]);
}

/** The faces of every tall fortress piece, drawn on the ground before any of their tops. */
export function TerrainFaces({ terrain, turn = 0 }: { terrain: Terrain[]; /** How far the table is turned. */ turn?: number }) {
  const lean = leanOn(turn);
  const pieces = terrain.filter(t => tall(t) || (t.kind === 'road' && t.look === 'stone' && t.shape === 'rect' && !t.stairs));
  return (
    <g className="fortress-faces" pointerEvents="none">
      {pieces.map(t => {
        const pts = face(t, lean).map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
        return (
          <g key={t.id}>
            <polygon className="face-shadow" points={pts} transform="translate(0.35 0.45)" filter="url(#bank-blur)" />
            <polygon className="face" points={pts} fill={t.look === 'orthanc' ? '#1d1e23' : t.look === 'scaffold' ? '#5a3d1f' : t.look === 'osgwall' || t.look === 'stepped' ? '#a8977c' : t.kind === 'rock' ? 'url(#tex-cliff)' : 'url(#tex-wall)'} />
            <polygon className="face-shade" points={pts} />
          </g>
        );
      })}
    </g>
  );
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
      {/* Lake-town's roof shingles: courses along x (or y), each shingle's edge staggered from the course above. */}
      {[0, 90].map(r => (
        <pattern key={r} id={r ? 'shingles-y' : 'shingles-x'} patternUnits="userSpaceOnUse" width={0.36} height={0.5} patternTransform={r ? 'rotate(90)' : undefined}>
          <line className="shingle-course" x1={0} x2={0.36} y1={0.25} y2={0.25} />
          <line className="shingle-course" x1={0} x2={0.36} y1={0.5} y2={0.5} />
          <line className="shingle-edge" x1={0.02} x2={0.02} y1={0} y2={0.25} />
          <line className="shingle-edge" x1={0.2} x2={0.2} y1={0.25} y2={0.5} />
        </pattern>
      ))}
      <filter id="hard-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.16" dy="0.24" stdDeviation="0.08" floodColor="#000" floodOpacity="0.55" />
      </filter>
      <radialGradient id="g-dome" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.32" />
        <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
      </radialGradient>
      <radialGradient id="g-pine-light" cx="32%" cy="28%" r="78%">
        <stop offset="0%" stopColor="#e8f0b0" stopOpacity="0.32" />
        <stop offset="45%" stopColor="#e8f0b0" stopOpacity="0.04" />
        <stop offset="80%" stopColor="#000" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.34" />
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
