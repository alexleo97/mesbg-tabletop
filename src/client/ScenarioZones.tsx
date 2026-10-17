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

function ZoneArt({ z, sx, sy, w, h }: { z: Zone; sx: number; sy: number; w: number; h: number }) {
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
