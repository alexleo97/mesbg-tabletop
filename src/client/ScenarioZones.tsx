import type { Scenario, Zone } from '../shared/scenarios.ts';

/** Deployment zones for the chosen scenario, drawn over the table and clipped to its edges. */
export function ScenarioZones({ s, w, h }: { s: Scenario; w: number; h: number }) {
  const sx = w / 48;
  const sy = h / 48;
  return (
    <g className="deploy" pointerEvents="none" clipPath="url(#board-clip)">
      {s.deployment.zones.map((z, i) => (
        <ZoneArt key={i} z={z} sx={sx} sy={sy} w={w} h={h} />
      ))}
    </g>
  );
}

export function ZoneArt({ z, sx, sy, w, h }: { z: Zone; sx: number; sy: number; w: number; h: number }) {
  const cls = `deploy-zone ${z.seat} ${z.label ? 'sub' : ''}`;
  switch (z.shape) {
    case 'rect':
      return <rect className={cls} x={z.x * sx} y={z.y * sy} width={z.w * sx} height={z.h * sy} />;
    case 'circle':
    case 'semicircle':
    case 'quarter-circle':
      return <ellipse className={cls} cx={z.cx * sx} cy={z.cy * sy} rx={z.r * sx} ry={z.r * sy} />;
    case 'polygon':
      return <polygon className={cls} points={z.points.map(([x, y]) => `${x * sx},${y * sy}`).join(' ')} />;
    case 'edge': {
      const gap = z.minFromCorner ?? 6;
      const edges = z.edges ?? (z.edge ? [z.edge] : []);
      const lines: Record<string, [number, number, number, number]> = {
        north: [gap, 0.5, w - gap, 0.5],
        south: [gap, h - 0.5, w - gap, h - 0.5],
        west: [0.5, gap, 0.5, h - gap],
        east: [w - 0.5, gap, w - 0.5, h - gap],
        top: [gap, 0.5, w - gap, 0.5],
        bottom: [gap, h - 0.5, w - gap, h - 0.5],
      };
      return (
        <>
          {edges.map(e => lines[e.toLowerCase()]).filter(Boolean).map(([x1, y1, x2, y2], i) => (
            <line key={i} className={`deploy-edge ${z.seat}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </>
      );
    }
  }
}

/** Markers a side owns (the one in its half): drawn in that side's colour, ringed in white. */
const SIDED = new Set(['relic', 'supply', 'wounded-ally']);
const MARKERS = new Set(['objective', 'heirloom', 'artefact', 'relic', 'supply', 'wounded-ally']);

/**
 * A small, clean picture of a scenario's deployment for the scenario picker: each side's zone in solid colour, the
 * D6 sub-zones striped, edges warbands arrive from as bold bars with arrows, and the fixed objective markers.
 */
export function DeployThumb({ s }: { s: Scenario }) {
  const zones = s.deployment.zones;
  const markers = MARKERS.has(s.objectives.markerKind) ? (s.objectives.fixedPositions ?? []) : [];
  return (
    <svg className="deploy-thumb" viewBox="0 0 48 48" aria-hidden>
      <defs>
        <pattern id="dt-stripes" width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={1.3} height={3} fill="#fff" fillOpacity={0.45} />
        </pattern>
      </defs>
      <rect className="dt-table" width={48} height={48} />
      <line className="dt-centre" x1={0} y1={24} x2={48} y2={24} />
      {s.id === 'command-the-battlefield' && <line className="dt-quarter" x1={24} y1={0} x2={24} y2={48} />}
      {s.id === 'command-the-battlefield' && <line className="dt-quarter" x1={0} y1={24} x2={48} y2={24} />}
      {s.id === 'retrieval' && <line className="dt-quarter" x1={0} y1={0} x2={48} y2={48} />}
      {zones.map((z, i) => (
        <ThumbZone key={i} z={z} />
      ))}
      {markers.map(([x, y], i) => {
        const kind = s.objectives.markerKind;
        const cls = `dt-marker ${SIDED.has(kind) ? (y > 24 ? 'p1' : 'p2') : ''}`;
        return kind === 'artefact' || kind === 'heirloom' ? (
          <rect key={i} className={cls} x={x - 2.2} y={y - 2.2} width={4.4} height={4.4} transform={`rotate(45 ${x} ${y})`} />
        ) : (
          <circle key={i} className={cls} cx={x} cy={y} r={2.6} />
        );
      })}
    </svg>
  );
}

function ThumbZone({ z }: { z: Zone }) {
  const cls = `dt-zone ${z.seat}`;
  // A labelled zone inside a bigger one of the same side is a D6 sub-zone: striped over the zone. Corner A/B and
  // the Champion's circle are zones in their own right.
  const sub = z.label?.startsWith('D6');
  const fill = sub ? { className: 'dt-sub', fill: 'url(#dt-stripes)' } : { className: cls };
  switch (z.shape) {
    case 'rect':
      return <rect {...fill} x={z.x} y={z.y} width={z.w} height={z.h} />;
    case 'circle':
    case 'semicircle':
    case 'quarter-circle':
      return <ellipse {...fill} cx={z.cx} cy={z.cy} rx={z.r} ry={z.ry ?? z.r} />;
    case 'polygon':
      return <polygon {...fill} points={z.points.map(([x, y]) => `${x},${y}`).join(' ')} />;
    case 'edge': {
      const gap = z.minFromCorner ?? 6;
      const edges = (z.edges ?? (z.edge ? [z.edge] : [])).map(e => ({ top: 'north', bottom: 'south' })[e.toLowerCase()] ?? e.toLowerCase());
      // Each edge: the bar along it, and an arrow pointing in from its middle.
      const bars: Record<string, { line: [number, number, number, number]; arrow: string }> = {
        north: { line: [gap, 1.5, 48 - gap, 1.5], arrow: '20,4 28,4 24,10' },
        south: { line: [gap, 46.5, 48 - gap, 46.5], arrow: '20,44 28,44 24,38' },
        west: { line: [1.5, gap, 1.5, 48 - gap], arrow: '4,20 4,28 10,24' },
        east: { line: [46.5, gap, 46.5, 48 - gap], arrow: '44,20 44,28 38,24' },
      };
      return (
        <>
          {edges.map(e => bars[e]).filter(Boolean).map(({ line: [x1, y1, x2, y2], arrow }, i) => (
            <g key={i} className={`dt-edge ${z.seat}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <polygon points={arrow} />
            </g>
          ))}
        </>
      );
    }
  }
}
