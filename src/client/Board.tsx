import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { distanceBetween, distanceToBase, formatInches, halfExtents, type Point } from '../shared/geometry.ts';
import type { Action, GameState, Model } from '../shared/types.ts';
import { TerrainArt, TerrainDefs } from './TerrainArt.tsx';
import { ScenarioZones } from './ScenarioZones.tsx';
import { scenarioById } from '../shared/scenarios.ts';
import { MATERIALS, textures } from './textures.ts';
import { TERRAIN_INFO, terrainRules } from '../shared/terrain.ts';
import { inDifficult, insidePolygon, inTheWay, isDifficult, moveCost, outline, shadowPath, sightTo } from '../shared/sight.ts';

export type Tool = 'move' | 'select' | 'measure';

interface Props {
  state: GameState;
  tool: Tool;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  selectedTerrain: string | null;
  setSelectedTerrain: (id: string | null) => void;
  dispatch: (a: Action) => void;
  showZones: boolean;
  showDeployment: boolean;
  showGrid: boolean;
  /** Photo URL for a model's unit, if photos are on and known. */
  photoFor: (m: Model) => string | undefined;
  /** Called when a model is tapped; return true to use the tap (e.g. to pick a shooting target) instead of selecting. */
  onModelTap?: (m: Model) => boolean;
  /** Lines to draw between models, such as a shooter and its target. */
  links?: { from: string; to: string; label: string; ok: boolean }[];
  /** Fights on the table, drawn as markers that open the fight when tapped. */
  fights?: { key: string; ids: string[]; done: boolean }[];
  onFightTap?: (key: string) => void;
  /** Shade what this model can't see and mark which enemies it can. */
  sightFrom?: string;
  /** How far the sight model can shoot, drawn as a ring around it. */
  sightRange?: number;
  /** Write each model's name under its base. */
  showNames?: boolean;
}

interface View {
  x: number;
  y: number;
  s: number; // pixels per inch
}

type Gesture =
  | { kind: 'pan'; start: Point; view: View; moved: boolean }
  | { kind: 'drag'; start: Point; origin: Record<string, Point>; moved: boolean; tapId: string; multi: boolean; wasSelected: boolean }
  | { kind: 'terrain'; id: string; start: Point; origin: Point; moved: boolean }
  | { kind: 'box'; start: Point; end: Point; additive: boolean }
  | { kind: 'measure'; start: Point; end: Point; from?: string }
  | { kind: 'pinch'; dist: number; mid: Point; view: View };

const SEND_EVERY_MS = 60;
const TAP_SLOP_PX = 6;

function initials(name: string) {
  const words = name.replace(/[^\p{L}\s']/gu, ' ').split(/\s+/).filter(w => w && !/^(of|the|on|with|and|de)$/i.test(w));
  return words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map(w => w[0]).join('');
}

/** A base outline grown outward by `pad` inches, used for move and control zones. */
function ZoneShape({ m, pad, className }: { m: Model; pad: number; className: string }) {
  const { rx, ry } = halfExtents(m.base);
  if (m.base.shape === 'rect')
    return <rect className={className} x={-rx - pad} y={-ry - pad} width={2 * (rx + pad)} height={2 * (ry + pad)} rx={pad} />;
  return <ellipse className={className} rx={rx + pad} ry={ry + pad} />;
}

function BaseShape({ m, className = 'base' }: { m: Model; className?: string }) {
  const { rx, ry } = halfExtents(m.base);
  if (m.base.shape === 'rect') return <rect className={className} x={-rx} y={-ry} width={2 * rx} height={2 * ry} rx={0.04} />;
  return <ellipse className={className} rx={rx} ry={ry} />;
}

const clipId = (m: Model) => `clip-${m.base.shape}-${m.base.w}-${m.base.h}`;

export function Board({ state, tool, selected, setSelected, selectedTerrain, setSelectedTerrain, dispatch, showZones, showDeployment, showGrid, photoFor, onModelTap, links, fights, onFightTap, sightFrom, sightRange, showNames }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tex = useMemo(() => textures(), []);
  const [view, setView] = useState<View>({ x: 0, y: 0, s: 10 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragPos, setDragPos] = useState<Record<string, Point> | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ruler, setRuler] = useState<{ start: Point; end: Point; from?: string } | null>(null);
  useEffect(() => {
    if (tool !== 'measure') setRuler(null);
  }, [tool]);
  const pointers = useRef(new Map<number, Point>());
  const lastSend = useRef(0);
  const fitted = useRef(false);

  const models = useMemo(() => Object.values(state.models).filter(m => !m.dead), [state.models]);
  // Roads and water lie on the ground, under everything else; bridges sit on top of the water.
  const terrain = useMemo(() => {
    const layer = (k: string) => (k === 'road' ? 0 : k === 'water' ? 1 : k === 'bridge' ? 3 : 2);
    return Object.values(state.terrain).sort((a, b) => layer(a.kind) - layer(b.kind));
  }, [state.terrain]);
  const viewer = sightFrom ? state.models[sightFrom] : undefined;
  const sight = useMemo(() => {
    if (!viewer || viewer.dead) return null;
    const enemies = Object.values(state.models).filter(m => !m.dead && m.owner !== viewer.owner);
    const seen = new Map(enemies.map(m => [m.id, sightTo(state, viewer, m)]));
    const lines = enemies.map(m => ({ m, seen: seen.get(m.id)!, dist: distanceBetween(viewer, m), between: inTheWay(state, viewer, m).length }));
    return { path: shadowPath(state, viewer), seen, lines };
  }, [viewer, state]);
  const heroicIds = useMemo(() => new Set(state.flow.heroics.map(h => h.model)), [state.flow.heroics]);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 16;
    const s = Math.min((r.width - pad * 2) / state.board.w, (r.height - pad * 2) / state.board.h);
    setView({ s, x: (r.width - state.board.w * s) / 2, y: (r.height - state.board.h * s) / 2 });
  }, [state.board.w, state.board.h]);

  useLayoutEffect(() => {
    if (!fitted.current) {
      fit();
      fitted.current = true;
    }
  }, [fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'f') fit();
      if ((e.key === 'q' || e.key === 'e') && selected.size) {
        const d = e.key === 'q' ? -45 : 45;
        dispatch({ type: 'moveModels', moves: [...selected].flatMap(id => {
          const m = state.models[id];
          return m ? [{ id, x: m.x, y: m.y, rot: m.rot + d }] : [];
        }) });
      }
      if (e.key === 'Escape') {
        setSelected(new Set());
        setRuler(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, selected, state.models, dispatch, setSelected]);

  const toBoard = useCallback(
    (clientX: number, clientY: number, v: View = view): Point => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - v.x) / v.s, y: (clientY - r.top - v.y) / v.s };
    },
    [view],
  );

  const zoomAt = useCallback((factor: number, sx: number, sy: number, base: View) => {
    const s = Math.min(200, Math.max(3, base.s * factor));
    const k = s / base.s;
    setView({ s, x: sx - (sx - base.x) * k, y: sy - (sy - base.y) * k });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView(v => {
        const s = Math.min(200, Math.max(3, v.s * Math.exp(-e.deltaY * 0.0015)));
        const k = s / v.s;
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        return { s, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const modelAt = (p: Point) => {
    // Topmost first, so the model drawn last wins.
    for (let i = models.length - 1; i >= 0; i--) if (distanceToBase(models[i], p) === 0) return models[i];
    return null;
  };

  const terrainAt = (p: Point, any = false) => {
    for (let i = terrain.length - 1; i >= 0; i--) {
      const t = terrain[i];
      if (t.locked && !any) continue;
      const a = (-t.rot * Math.PI) / 180;
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const inside = t.path ? insidePolygon(outline(t), p) : t.shape === 'rect' ? Math.abs(lx) <= t.w / 2 && Math.abs(ly) <= t.h / 2 : (lx / (t.w / 2)) ** 2 + (ly / (t.h / 2)) ** 2 <= 1;
      if (inside) return t;
    }
    return null;
  };

  const sendMoves = (pos: Record<string, Point>, force: boolean) => {
    const now = performance.now();
    if (!force && now - lastSend.current < SEND_EVERY_MS) return;
    lastSend.current = now;
    dispatch({ type: 'moveModels', moves: Object.entries(pos).map(([id, p]) => ({ id, x: p.x, y: p.y })) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    setPinned(null);
    setHover(null);
    const r = svgRef.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });

    if (pointers.current.size === 2) {
      // Second finger: switch to pinch-zoom and drop whatever the first finger started.
      if (gesture?.kind === 'drag' && dragPos) sendMoves(dragPos, true);
      setDragPos(null);
      const [a, b] = [...pointers.current.values()];
      setGesture({ kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view });
      return;
    }
    if (pointers.current.size > 2) return;

    const p = toBoard(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = modelAt(p);

    if (tool === 'measure') {
      setRuler(null);
      setGesture({ kind: 'measure', start: p, end: p, from: hit?.id });
      return;
    }
    if (hit && onModelTap?.(hit)) return;
    if (hit) {
      // In select mode, or with shift/ctrl held, taps build up a group instead of replacing it.
      const multi = additive || tool === 'select';
      const wasSelected = selected.has(hit.id);
      const group = wasSelected ? selected : multi ? new Set([...selected, hit.id]) : new Set([hit.id]);
      if (!wasSelected) setSelected(group);
      setSelectedTerrain(null);
      const origin: Record<string, Point> = {};
      for (const id of group) if (state.models[id]) origin[id] = { x: state.models[id].x, y: state.models[id].y };
      setGesture({ kind: 'drag', start: p, origin, moved: false, tapId: hit.id, multi, wasSelected });
      return;
    }
    if (tool === 'select') {
      setGesture({ kind: 'box', start: p, end: p, additive });
      return;
    }
    const t = terrainAt(p);
    if (t) {
      setSelectedTerrain(t.id);
      setGesture({ kind: 'terrain', id: t.id, start: p, origin: { x: t.x, y: t.y }, moved: false });
      return;
    }
    setGesture({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, view, moved: false });
  };

  /** Where a terrain label sits, in pixels inside the board. */
  const tipAt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    // Just off the pointer, and kept inside the board.
    return { x: Math.max(4, Math.min(e.clientX - r.left + 14, r.width - 290)), y: Math.max(4, Math.min(e.clientY - r.top + 14, r.height - 180)) };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // A mouse resting over terrain names it, so you always know what you're looking at.
    if (e.pointerType === 'mouse' && !gesture) {
      const t = terrainAt(toBoard(e.clientX, e.clientY), true);
      setHover(t ? { id: t.id, ...tipAt(e) } : null);
    }
    if (!pointers.current.has(e.pointerId)) return;
    const r = svgRef.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (!gesture) return;

    if (gesture.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = gesture.view;
      const s = Math.min(200, Math.max(3, v.s * (dist / gesture.dist)));
      const k = s / v.s;
      setView({ s, x: mid.x - (gesture.mid.x - v.x) * k, y: mid.y - (gesture.mid.y - v.y) * k });
      return;
    }
    if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.start.x;
      const dy = e.clientY - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      setGesture({ ...gesture, moved: true });
      setView({ ...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy });
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    if (gesture.kind === 'drag') {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * view.s < TAP_SLOP_PX) return;
      if (!gesture.moved) setGesture({ ...gesture, moved: true });
      const pos: Record<string, Point> = {};
      for (const [id, o] of Object.entries(gesture.origin)) pos[id] = { x: o.x + dx, y: o.y + dy };
      setDragPos(pos);
      sendMoves(pos, false);
    } else if (gesture.kind === 'terrain') {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * view.s < TAP_SLOP_PX) return;
      setGesture({ ...gesture, moved: true });
      const now = performance.now();
      if (now - lastSend.current >= SEND_EVERY_MS) {
        lastSend.current = now;
        dispatch({ type: 'updateTerrain', id: gesture.id, patch: { x: gesture.origin.x + dx, y: gesture.origin.y + dy } });
      }
    } else if (gesture.kind === 'box' || gesture.kind === 'measure') {
      setGesture({ ...gesture, end: p });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.current.size === 0) setGesture(null);
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    if (gesture.kind === 'drag') {
      if (gesture.moved && dragPos) sendMoves(dragPos, true);
      else if (gesture.wasSelected && gesture.multi) {
        const next = new Set(selected);
        next.delete(gesture.tapId);
        setSelected(next);
      } else if (gesture.wasSelected) setSelected(new Set([gesture.tapId]));
      setDragPos(null);
    } else if (gesture.kind === 'terrain') {
      if (gesture.moved)
        dispatch({ type: 'updateTerrain', id: gesture.id, patch: { x: gesture.origin.x + p.x - gesture.start.x, y: gesture.origin.y + p.y - gesture.start.y } });
      else setPinned({ id: gesture.id, ...tipAt(e) });
    } else if (gesture.kind === 'pan') {
      if (!gesture.moved) {
        setSelected(new Set());
        setSelectedTerrain(null);
        // Tapping any piece, even a locked one, shows what it is and how it plays.
        const t = terrainAt(p, true);
        setPinned(t ? { id: t.id, ...tipAt(e) } : null);
      }
    } else if (gesture.kind === 'box') {
      const x0 = Math.min(gesture.start.x, gesture.end.x);
      const x1 = Math.max(gesture.start.x, gesture.end.x);
      const y0 = Math.min(gesture.start.y, gesture.end.y);
      const y1 = Math.max(gesture.start.y, gesture.end.y);
      const inBox = models.filter(m => m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1).map(m => m.id);
      setSelected(new Set(gesture.additive ? [...selected, ...inBox] : inBox));
    } else if (gesture.kind === 'measure') {
      // A tap without a drag clears the ruler instead of leaving a zero-length one behind.
      const moved = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) >= 0.25;
      setRuler(moved ? { start: gesture.start, end: p, from: gesture.from } : null);
    }
    setGesture(null);
  };

  const shown = (m: Model): Model => (dragPos?.[m.id] ? { ...m, ...dragPos[m.id] } : m);

  const activeRuler = gesture?.kind === 'measure' ? gesture : ruler;
  const rulerInfo = useMemo(() => {
    if (!activeRuler) return null;
    const { start, end, from } = activeRuler;
    const a = from ? state.models[from] : undefined;
    const target = models.find(m => m.id !== from && distanceToBase(m, end) === 0);
    let d: number;
    if (a && target) d = distanceBetween(a, target);
    else if (a) d = distanceToBase(a, end);
    else if (target) d = distanceToBase(target, start);
    else d = Math.hypot(end.x - start.x, end.y - start.y);
    return { start, end, d, baseToBase: Boolean(a || target) };
  }, [activeRuler, state.models, models]);

  const fontSize = Math.max(0.22, 11 / view.s);
  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    for (let x = 0; x <= state.board.w; x++)
      lines.push(<line key={`x${x}`} className={x % 6 === 0 ? 'grid major' : 'grid'} x1={x} y1={0} x2={x} y2={state.board.h} />);
    for (let y = 0; y <= state.board.h; y++)
      lines.push(<line key={`y${y}`} className={y % 6 === 0 ? 'grid major' : 'grid'} x1={0} y1={y} x2={state.board.w} y2={y} />);
    return lines;
  }, [state.board.w, state.board.h]);

  return (
    <div className="board-wrap">
      <svg
        ref={svgRef}
        className={`board tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={e => e.preventDefault()}
      >
        <defs>
          <TerrainDefs />
          <pattern id="difficult-hatch" patternUnits="userSpaceOnUse" width={0.6} height={0.6} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.6} className="hatch-line" />
          </pattern>
          <clipPath id="board-clip">
            <rect width={state.board.w} height={state.board.h} />
          </clipPath>
          {MATERIALS.map(m => (
            <pattern key={m} id={`tex-${m}`} patternUnits="userSpaceOnUse" width={tex[m].inches} height={tex[m].tall}>
              <image href={tex[m].href} width={tex[m].inches} height={tex[m].tall} preserveAspectRatio="none" />
            </pattern>
          ))}
          {[...new Map(models.map(m => [clipId(m), m])).values()].map(m => (
            <clipPath key={clipId(m)} id={clipId(m)}>
              <BaseShape m={m} className="" />
            </clipPath>
          ))}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`} style={{ fontSize }}>
          <rect className="mat" width={state.board.w} height={state.board.h} fill={`url(#tex-${state.board.mat})`} />
          {showGrid && gridLines}
          <g clipPath="url(#board-clip)">
          {terrain.map(t => (
            <g
              key={t.id}
              transform={`translate(${t.x} ${t.y}) rotate(${t.rot})`}
              className={`terrain ${t.kind} ${t.locked ? 'locked' : ''} ${selectedTerrain === t.id ? 'selected' : ''}`}
            >
              <TerrainArt t={t} mat={state.board.mat} />
            </g>
          ))}
          </g>
          <g clipPath="url(#board-clip)">
            {terrain.filter(isDifficult).map(t => (
              <polygon key={`d-${t.id}`} className="difficult" points={outline(t).map(p => `${p.x},${p.y}`).join(' ')} pointerEvents="none" />
            ))}
          </g>
          {sight && (
            <g clipPath="url(#board-clip)" pointerEvents="none">
              <path className="los-shadow" d={sight.path} />
              {sightRange && viewer && <circle className="sight-range" cx={viewer.x} cy={viewer.y} r={sightRange + Math.max(halfExtents(viewer.base).rx, halfExtents(viewer.base).ry)} />}
              {viewer &&
                sight.lines.map(l => <line key={`sl-${l.m.id}`} className={`sight-line ${l.seen}`} x1={viewer.x} y1={viewer.y} x2={l.m.x} y2={l.m.y} />)}
            </g>
          )}
          {showDeployment && scenarioById(state.scenario) && <ScenarioZones s={scenarioById(state.scenario)!} w={state.board.w} h={state.board.h} />}

          {models.filter(m => selected.has(m.id)).map(m => {
            // While dragging, zones stay where the move started so you can see the limit.
            const s = m;
            return (
              <g key={`z-${m.id}`} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} pointerEvents="none">
                {showZones && <ZoneShape m={m} pad={m.move} className="zone-move" />}
                {showZones && inDifficult(state, m) && <ZoneShape m={m} pad={m.move / 2} className="zone-move slow" />}
                {showZones && <ZoneShape m={m} pad={1} className="zone-control" />}
              </g>
            );
          })}

          {dragPos &&
            gesture?.kind === 'drag' &&
            Object.entries(gesture.origin).map(([id, o]) => {
              const m = state.models[id];
              const now = dragPos[id];
              if (!m || !now) return null;
              const d = Math.hypot(now.x - o.x, now.y - o.y);
              // Difficult terrain costs double, so the move is judged on what it costs.
              const { cost, difficult } = moveCost(state, o, now);
              const over = cost > m.move + 1e-6;
              return (
                <g key={`g-${id}`} pointerEvents="none">
                  <g transform={`translate(${o.x} ${o.y}) rotate(${m.rot})`} className="ghost">
                    <BaseShape m={m} />
                  </g>
                  <line className={`trail ${over ? 'over' : ''}`} x1={o.x} y1={o.y} x2={now.x} y2={now.y} />
                  {id === gesture.tapId && (
                    <text className={`trail-label ${over ? 'over' : ''}`} x={now.x} y={now.y - halfExtents(m.base).ry - 0.3} textAnchor="middle">
                      {difficult ? `${formatInches(d)} (${formatInches(cost)} in difficult terrain)` : formatInches(d)} / {m.move}"
                    </text>
                  )}
                </g>
              );
            })}

          {models.map(m0 => {
            const m = shown(m0);
            const { rx, ry } = halfExtents(m.base);
            const photo = photoFor(m);
            return (
              <g
                key={m.id}
                transform={`translate(${m.x} ${m.y}) rotate(${m.rot})`}
                className={`model ${m.owner} ${m.hero ? 'hero' : ''} ${selected.has(m.id) ? 'selected' : ''} ${sight?.seen.has(m.id) ? `seen-${sight.seen.get(m.id)}` : ''}`}
              >
                <BaseShape m={m} />
                {photo && (
                  <>
                    <text className="label" textAnchor="middle" dominantBaseline="central" transform={`rotate(${-m.rot})`} style={{ fontSize: Math.min(ry * 0.8, 0.32) }}>
                      {initials(m.name)}
                    </text>
                    {/* The clip follows the base; the photo inside stays upright. */}
                    <g clipPath={`url(#${clipId(m)})`}>
                      <image
                        href={photo}
                        x={-Math.max(rx, ry)}
                        y={-Math.max(rx, ry)}
                        width={2 * Math.max(rx, ry)}
                        height={2 * Math.max(rx, ry)}
                        preserveAspectRatio="xMidYMid slice"
                        transform={`rotate(${-m.rot})`}
                      />
                    </g>
                    <BaseShape m={m} className="ring" />
                  </>
                )}
                <path className="facing" d={`M ${-0.12} ${-ry + 0.04} L 0 ${-ry - 0.1} L ${0.12} ${-ry + 0.04} Z`} />
                {!photo && (
                  <text className="label" textAnchor="middle" dominantBaseline="central" transform={`rotate(${-m.rot})`} style={{ fontSize: Math.min(ry * 0.8, 0.32) }}>
                    {initials(m.name)}
                  </text>
                )}
                {sight?.seen.has(m.id) && <ZoneShape m={m} pad={0.12} className="sight-ring" />}
                {heroicIds.has(m.id) && (
                  <text className="heroic-mark" textAnchor="middle" transform={`rotate(${-m.rot}) translate(${rx * 0.8} ${-ry * 0.7})`} style={{ fontSize: 0.32 }}>
                    ⚡
                  </text>
                )}
                {m.maxWounds > 1 && (
                  <text className="wounds" textAnchor="middle" transform={`rotate(${-m.rot}) translate(0 ${ry + 0.25})`} style={{ fontSize: 0.25 }}>
                    {m.wounds}/{m.maxWounds}W
                  </text>
                )}
              </g>
            );
          })}

          {showNames &&
            terrain
              .filter(t => t.kind !== 'objective')
              .map(t => (
                <text key={`tn-${t.id}`} className="terrain-name" x={t.x} y={t.y} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">
                  {TERRAIN_INFO[t.kind].name}
                </text>
              ))}
          {showNames &&
            models.map(m0 => {
              const m = shown(m0);
              const { ry } = halfExtents(m.base);
              return (
                <text key={`n-${m.id}`} className={`model-name ${m.owner}`} x={m.x} y={m.y + ry + (m.maxWounds > 1 ? 0.45 : 0.1) + fontSize * 0.8} textAnchor="middle" pointerEvents="none">
                  {m.name}
                </text>
              );
            })}

          {sight?.lines
            .filter(l => l.seen !== 'hidden')
            .map(l => (
              <text key={`st-${l.m.id}`} className={`sight-label ${l.seen}`} x={l.m.x} y={l.m.y - halfExtents(l.m.base).ry - fontSize * 0.5} textAnchor="middle" pointerEvents="none">
                {formatInches(l.dist)}
                {l.between > 0 ? ` · ${l.between} in the way` : ''}
              </text>
            ))}

          {links?.map(l => {
            const a = state.models[l.from];
            const b = state.models[l.to];
            if (!a || !b) return null;
            return (
              <g key={`l-${l.from}-${l.to}`} className={`aim ${l.ok ? 'ok' : 'bad'}`} pointerEvents="none">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - fontSize * 0.6} textAnchor="middle">
                  {l.label}
                </text>
              </g>
            );
          })}

          {fights?.map(f => {
            const ms = f.ids.map(id => state.models[id]).filter(Boolean);
            if (!ms.length) return null;
            const x = ms.reduce((n, m) => n + m.x, 0) / ms.length;
            const y = Math.min(...ms.map(m => m.y - halfExtents(m.base).ry)) - fontSize * 1.2;
            const r = fontSize * 0.9;
            return (
              <g
                key={f.key}
                className={`fight-mark ${f.done ? 'done' : ''}`}
                transform={`translate(${x} ${y})`}
                onPointerDown={e => {
                  e.stopPropagation();
                  onFightTap?.(f.key);
                }}
              >
                <circle r={r} />
                <text textAnchor="middle" dominantBaseline="central" style={{ fontSize: r * 1.1 }}>
                  {f.done ? '✓' : '⚔'}
                </text>
              </g>
            );
          })}

          {gesture?.kind === 'box' && (
            <rect
              className="box"
              x={Math.min(gesture.start.x, gesture.end.x)}
              y={Math.min(gesture.start.y, gesture.end.y)}
              width={Math.abs(gesture.end.x - gesture.start.x)}
              height={Math.abs(gesture.end.y - gesture.start.y)}
            />
          )}

          {rulerInfo && (
            <g className="ruler" pointerEvents="none">
              <line x1={rulerInfo.start.x} y1={rulerInfo.start.y} x2={rulerInfo.end.x} y2={rulerInfo.end.y} />
              <circle cx={rulerInfo.start.x} cy={rulerInfo.start.y} r={fontSize * 0.25} />
              <circle cx={rulerInfo.end.x} cy={rulerInfo.end.y} r={fontSize * 0.25} />
              <text x={rulerInfo.end.x} y={rulerInfo.end.y - fontSize} textAnchor="middle">
                {formatInches(rulerInfo.d)}
                {rulerInfo.baseToBase ? ' base-to-base' : ''}
              </text>
            </g>
          )}
        </g>
      </svg>
      {(() => {
        const at = pinned ?? hover;
        const t = at && state.terrain[at.id];
        if (!at || !t) return null;
        const info = TERRAIN_INFO[t.kind];
        return (
          <div className={`terrain-tip ${pinned ? 'pinned' : ''}`} style={{ left: at.x, top: at.y }} role="status">
            <b>{info.name}</b> <small>{info.type}</small>
            {pinned ? (
              <ul>
                {terrainRules(t).map(r => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <small className="tip-more">Click for its rules</small>
            )}
          </div>
        );
      })()}
      <div className="zoom-controls">
        <button aria-label="Zoom in" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2, view); }}>+</button>
        <button aria-label="Zoom out" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2, view); }}>−</button>
        <button aria-label="Fit board" onClick={fit}>⤢</button>
      </div>
    </div>
  );
}
