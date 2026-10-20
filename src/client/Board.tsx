import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { placeSpot, placingNow } from '../shared/placing.ts';
import { distanceBetween, distanceToBase, formatInches, halfExtents, type Point } from '../shared/geometry.ts';
import type { Action, GameState, Mark, Model, Seat, Terrain } from '../shared/types.ts';
import { markerName, markerNotes } from '../shared/objects.ts';
import { Effects } from './Effects.tsx';
import { TerrainArt, TerrainDefs } from './TerrainArt.tsx';
import { ScenarioZones } from './ScenarioZones.tsx';
import { scenarioById } from '../shared/scenarios.ts';
import { MATERIALS, textures } from './textures.ts';
import { TERRAIN_INFO, terrainRules } from '../shared/terrain.ts';
import { holdInZones } from '../shared/deployment.ts';
import { frontFirst, limitMove, moveAllowance, moveLeft, moveStart, movesLimited, settleMove, spent } from '../shared/movement.ts';
import { dropTarget } from '../shared/terrainTests.ts';
import { inDifficult, standingAt, insidePolygon, inTheWay, isDifficult, moveCost, outline, shadowPath, sightTo, VINES_REACH } from '../shared/sight.ts';
import { effectsOn } from '../shared/powers.ts';
import { carried, drive, riders } from '../shared/warBeasts.ts';
import { mounted, mountProfile } from '../shared/cavalry.ts';
import { fitView, homeTurn, snapTurn, toScreen, toTable, viewAt, wrapTurn, type View } from './view.ts';

export type Tool = 'move' | 'select' | 'measure' | 'mark';

interface Props {
  state: GameState;
  /** The viewer's seat, for pushing their siege tower once the battle is on. */
  role?: Seat | 'spectator';
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
  /** Write each terrain piece's name on it. */
  showTerrainNames?: boolean;
  /** Pings and arrows on the table, and how to put one down (a click pings, a drag draws an arrow). */
  marks?: Mark[];
  onMark?: (m: Pick<Mark, 'kind' | 'x' | 'y' | 'x2' | 'y2'>) => void;
  /** Glide moves and show wounds, deaths and shots as they happen. */
  animate?: boolean;
  /** Models to zoom in on, such as the fight being rolled; the view glides there each time `key` changes. */
  focus?: { key: string; ids: string[] } | null;
}

/** How long the table takes to turn a quarter, and how far two fingers twist before the table turns with them. */
const TURN_GLIDE = 250;
const TWIST_START = 12;

/** Room (px) left for the fight card when zooming to a fight, inches of table round it, the closest zoom, and how long the glide takes. */
const FOCUS_INSET = 480;
const FOCUS_PAD = 5;
const FOCUS_MAX_ZOOM = 45;
const FOCUS_GLIDE = 600;

type Gesture =
  | { kind: 'pan'; start: Point; view: View; moved: boolean }
  | { kind: 'drag'; start: Point; origin: Record<string, Point>; moved: boolean; tapId: string; multi: boolean; wasSelected: boolean }
  | { kind: 'terrain'; id: string; start: Point; origin: Point; moved: boolean }
  | { kind: 'box'; start: Point; end: Point; additive: boolean }
  | { kind: 'measure'; start: Point; end: Point; from?: string }
  | { kind: 'mark'; start: Point; end: Point }
  | { kind: 'pinch'; dist: number; mid: Point; angle: number; twisting: boolean; view: View };

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

/**
 * Move zones and 1" control zones of the selected models. With a group selected the zones are merged into one
 * outline with a single faint fill, so twenty overlapping circles don't fog the table.
 */
function MoveZones({ state, models }: { state: GameState; models: Model[] }) {
  // A zone for each model that can still go somewhere this phase.
  models = models.filter(m => moveAllowance(state, m) !== 0);
  if (!models.length) return null;
  // The zone is round where the model is now, as far as the Move it has left (it can go round things to get there).
  const starts = models.map(m => ({ m, s: m }));
  const zones = (className: string) =>
    starts.map(({ m, s }) => (
      <g key={m.id} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}>
        <ZoneShape m={m} pad={moveLeft(state, m) ?? m.move} className={className} />
      </g>
    ));
  return (
    <g pointerEvents="none">
      <mask id="move-zones-inside" maskUnits="userSpaceOnUse" x={-50} y={-50} width={state.board.w + 100} height={state.board.h + 100}>
        <rect x={-50} y={-50} width={state.board.w + 100} height={state.board.h + 100} fill="#fff" />
        {zones('zone-mask')}
      </mask>
      <g className="zone-fill">{zones('zone-solid')}</g>
      <g mask="url(#move-zones-inside)">{zones('zone-move')}</g>
      {starts.map(({ m, s }) => (
        <g key={`z-${m.id}`}>
          {inDifficult(state, s, m.owner) && (
            <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}>
              <ZoneShape m={m} pad={(moveAllowance(state, m) ?? m.move) / 2} className="zone-move slow" />
            </g>
          )}
          <g transform={`translate(${m.x} ${m.y}) rotate(${m.rot})`}>
            <ZoneShape m={m} pad={1} className="zone-control" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** Whether a model moves by charging now: a war beast or chariot in the Move phase, which the game drives (see warBeasts.ts). */
const chargesNow = (state: GameState, m: Model) => state.flow.started && state.phase === 'move' && !state.flow.trampled?.includes(m.id) && (m.beast !== undefined || (mounted(m) && !!mountProfile(m.mount)?.chariot));

function BaseShape({ m, className = 'base', grow = 0 }: { m: Model; className?: string; grow?: number }) {
  const { rx: bx, ry: by } = halfExtents(m.base);
  const rx = bx + grow, ry = by + grow;
  if (m.base.shape === 'rect') return <rect className={className} x={-rx} y={-ry} width={2 * rx} height={2 * ry} rx={0.04} />;
  return <ellipse className={className} rx={rx} ry={ry} />;
}

/** A planning arrow in its player's colour, with how far it reaches. */
function Arrow({ by, from, to, fontSize, turn }: { by: string; from: Point; to: Point; fontSize: number; turn: number }) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const head = Math.min(len * 0.4, Math.max(1, fontSize * 1.8));
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (s: number) => `${to.x - head * Math.cos(a + s * 0.45)},${to.y - head * Math.sin(a + s * 0.45)}`;
  const neck = { x: to.x - head * 0.8 * Math.cos(a), y: to.y - head * 0.8 * Math.sin(a) };
  return (
    <g className={`arrow ${by}`}>
      <line x1={from.x} y1={from.y} x2={neck.x} y2={neck.y} />
      <polygon points={`${to.x},${to.y} ${wing(1)} ${wing(-1)}`} />
      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - fontSize * 0.6} textAnchor="middle" transform={upright(turn, (from.x + to.x) / 2, (from.y + to.y) / 2)}>
        {formatInches(len)}
      </text>
    </g>
  );
}

/** Turns writing back upright about a point on the table, so it reads the right way up however the table is turned. */
const upright = (turn: number, x: number, y: number) => (turn ? `rotate(${-turn} ${x} ${y})` : undefined);

const clipId = (m: Model) => `clip-${m.base.shape}-${m.base.w}-${m.base.h}`;

export function Board({ state, tool, selected, setSelected, selectedTerrain, setSelectedTerrain, dispatch, showZones, showDeployment, showGrid, photoFor, onModelTap, links, fights, onFightTap, sightFrom, sightRange, showNames, showTerrainNames, marks, onMark, animate, role, focus }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tex = useMemo(() => textures(), []);
  const [view, setView] = useState<View>({ x: 0, y: 0, s: 10, r: 0 });
  const turn = view.r;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragPos, setDragPos] = useState<Record<string, Point> | null>(null);
  // A siege tower being pushed: shown where it is dragged, and only sent (as a push) when let go.
  const [towerAt, setTowerAt] = useState<{ id: string } & Point | null>(null);
  const pushing = (id: string) => (role === 'p1' || role === 'p2') && state.flow.started && state.terrain[id]?.kind === 'tower';
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ruler, setRuler] = useState<{ start: Point; end: Point; from?: string } | null>(null);
  useEffect(() => {
    if (tool !== 'measure') setRuler(null);
  }, [tool]);
  const pointers = useRef(new Map<number, Point>());
  // A war beast or chariot being pointed where to charge, and the spot it's pointed at.
  const charging = useRef<{ id: string; toward: Point } | null>(null);
  const lastSend = useRef(0);

  // Models that left the table over an edge are off it.
  // (Those riding a war beast are drawn on top of it.)
  const models = useMemo(() => Object.values(state.models).filter(m => !m.dead && !m.escaped && !m.waiting).sort((a, b) => Number(!!a.aboard) - Number(!!b.aboard)), [state.models]);
  // Roads and water lie on the ground, under everything else; bridges sit on top of the water.
  const terrain = useMemo(() => {
    const layer = (k: string) => (k === 'road' ? 0 : k === 'water' ? 1 : k === 'bridge' ? 3 : 2);
    // Markers carried off, destroyed, rescued or turned over as decoys are gone (a broken gate stays, in pieces);
    // carried ones are drawn last.
    const layerOf = (t: Terrain) => (t.carrier ? 4 : layer(t.kind));
    return Object.values(state.terrain)
      .filter(t => !t.gone || t.kind === 'gate' || t.kind === 'tower' || !!t.barricade)
      .sort((a, b) => layerOf(a) - layerOf(b));
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

  const viewRef = useRef(view);
  viewRef.current = view;
  // Any glide under way (to a fight, or a quarter turn), stopped when another starts or you take hold of the table.
  const glide = useRef(0);
  const stopGlide = () => cancelAnimationFrame(glide.current);

  /** Fit the whole table on screen, turned as it is now (or to `r`). */
  const fit = useCallback(
    (r: number = viewRef.current.r) => {
      const el = svgRef.current;
      if (!el) return;
      stopGlide();
      const b = el.getBoundingClientRect();
      setView(fitView(state.board, b.width, b.height, r));
    },
    [state.board.w, state.board.h],
  );

  // You look at the table from your own side, your army at the bottom of the screen as if standing at a real table
  // (spectators from the first player's). Set again, with the table fitted, when the table, the scenario or your seat
  // changes, or once your army first appears where the scenario has no zones to go by.
  const seat: Seat = role === 'p2' ? 'p2' : 'p1';
  const hasArmy = models.some(m => m.owner === seat);
  useLayoutEffect(() => {
    fit(homeTurn(state, seat));
  }, [fit, seat, state.scenario, hasArmy]);

  /** Glide the view to `to` (from where it is now, turning the shorter way round). */
  const glideTo = (to: (k: number, from: View) => View, ms: number) => {
    stopGlide();
    const from = viewRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setView(to(t * t * (3 - 2 * t), from));
      if (t < 1) glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  };

  /** Turn the table by `d` degrees about the middle of the screen. */
  const turnBy = (d: number) => {
    const el = svgRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const mid = { x: b.width / 2, y: b.height / 2 };
    const from = viewRef.current;
    const at = toTable(from, mid);
    // Turning a quarter lands square, even after a free twist.
    const target = Math.abs(d) === 90 ? Math.round((from.r + d) / 90) * 90 : from.r + d;
    glideTo((k, v) => viewAt(at, mid, v.s, v.r + (target - v.r) * k), TURN_GLIDE);
  };

  // Glide to the models in focus, leaving room on the left for the card that shows their fight.
  useEffect(() => {
    const el = svgRef.current;
    const ms = (focus?.ids ?? []).map(id => state.models[id]).filter(m => m && !m.dead);
    if (!el || !focus || !ms.length) return;
    const r = el.getBoundingClientRect();
    const left = r.width > 900 ? FOCUS_INSET : 0;
    // Measured across and down the screen, however the table is turned.
    const cur = viewRef.current;
    const flat = ms.map(m => toScreen({ x: 0, y: 0, s: 1, r: cur.r }, m));
    const x0 = Math.min(...flat.map(p => p.x)) - FOCUS_PAD;
    const x1 = Math.max(...flat.map(p => p.x)) + FOCUS_PAD;
    const y0 = Math.min(...flat.map(p => p.y)) - FOCUS_PAD;
    const y1 = Math.max(...flat.map(p => p.y)) + FOCUS_PAD;
    const s = Math.min(FOCUS_MAX_ZOOM, (r.width - left) / (x1 - x0), r.height / (y1 - y0));
    const centre = toTable({ x: 0, y: 0, s: 1, r: cur.r }, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    const to = viewAt(centre, { x: left + (r.width - left) / 2, y: r.height / 2 }, s, cur.r);
    glideTo((k, from) => ({ s: from.s + (to.s - from.s) * k, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, r: from.r }), FOCUS_GLIDE);
    return stopGlide;
  }, [focus?.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'f') fit();
      if (e.key === 'r' || e.key === 'R') turnBy(e.key === 'R' ? -90 : 90);
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
      return toTable(v, { x: clientX - r.left, y: clientY - r.top });
    },
    [view],
  );

  const zoomAt = useCallback((factor: number, sx: number, sy: number, base: View) => {
    const s = Math.min(200, Math.max(3, base.s * factor));
    const k = s / base.s;
    setView({ ...base, s, x: sx - (sx - base.x) * k, y: sy - (sy - base.y) * k });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(glide.current);
      const r = el.getBoundingClientRect();
      const q = { x: e.clientX - r.left, y: e.clientY - r.top };
      // Shift and the wheel turns the table freely about the pointer (some browsers send it sideways).
      if (e.shiftKey)
        return setView(v => {
          const r2 = v.r + (e.deltaY || e.deltaX) * 0.15;
          return viewAt(toTable(v, q), q, v.s, r2);
        });
      setView(v => {
        const s = Math.min(200, Math.max(3, v.s * Math.exp(-e.deltaY * 0.0015)));
        const k = s / v.s;
        return { ...v, s, x: q.x - (q.x - v.x) * k, y: q.y - (q.y - v.y) * k };
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
      if ((t.locked || t.carrier) && !any) continue;
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
    stopGlide();

    if (pointers.current.size === 2) {
      // Second finger: switch to pinch-zoom and drop whatever the first finger started.
      if (gesture?.kind === 'drag' && dragPos) sendMoves(dragPos, true);
      setDragPos(null);
      const [a, b] = [...pointers.current.values()];
      setGesture({ kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x), twisting: false, view });
      return;
    }
    if (pointers.current.size > 2) return;

    const p = toBoard(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = modelAt(p);

    // The Mark tool, or Alt with any tool: click to ping, drag to draw an arrow.
    if (onMark && (tool === 'mark' || e.altKey)) {
      setGesture({ kind: 'mark', start: p, end: p });
      return;
    }
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
      // Dragging someone riding a war beast drives the beast.
      const ridden = (id: string) => {
        const beast = state.models[state.models[id]?.aboard ?? ''];
        return beast && !beast.dead ? beast.id : id;
      };
      // Only your own models move (and the Palantír's in a solo game, and a model your caster has Compelled).
      const compel = state.flow.compel;
      const movable = (id: string) => !role || state.models[id].owner === role || state.models[id].owner === state.bot || (compel?.model === id && state.models[compel.caster]?.owner === role);
      for (const id of [...group].map(ridden)) if (state.models[id] && movable(id)) origin[id] = { x: state.models[id].x, y: state.models[id].y };
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
      // Twisting two fingers turns the table with them, once they have twisted far enough to mean it.
      const twist = wrapTurn(((Math.atan2(b.y - a.y, b.x - a.x) - gesture.angle) * 180) / Math.PI);
      const twisting = gesture.twisting || Math.abs(twist) > TWIST_START;
      if (twisting && !gesture.twisting) setGesture({ ...gesture, twisting });
      setView(viewAt(toTable(v, gesture.mid), mid, s, v.r + (twisting ? twist : 0)));
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
      // A war beast Tramples and a chariot makes its Chariot Charge: drag to point it, and it shows where it would get to.
      const lone = Object.keys(gesture.origin).length === 1 ? state.models[Object.keys(gesture.origin)[0]] : undefined;
      if (lone && chargesNow(state, lone)) {
        const toward = { x: gesture.origin[lone.id].x + dx, y: gesture.origin[lone.id].y + dy };
        charging.current = { id: lone.id, toward };
        const run = drive(state, null, lone, toward, { d6: () => 6, uid: () => '', now: 0, by: lone.owner, group: '', skipHits: true, stampede: !!lone.stampede });
        // Those riding it go with it.
        const aboard = Object.fromEntries(riders(state, lone).map(r => [r.id, carried(lone, run.at, r) as Point]));
        setDragPos({ ...aboard, [lone.id]: { x: run.at.x, y: run.at.y, rot: run.at.rot } as Point });
        return;
      }
      charging.current = null;
      const pos: Record<string, Point> = {};
      // Models dragged together go front first, each keeping clear of where the others have got to, as on the server.
      const asked = frontFirst(state, Object.entries(gesture.origin).map(([id, o]) => ({ id, x: o.x + dx, y: o.y + dy })));
      let now = state;
      for (const to of asked) {
        const m = state.models[to.id];
        // Once the battle is under way a model stops at the edge of its allowance, as the server would hold it there anyway.
        // A move goes on from where the model is now, with what's left of its Move; putting it back where it began
        // the phase is always allowed.
        const left = m && moveLeft(state, m);
        const start = m && moveStart(state, m);
        const at = m && left != null ? (Math.hypot(to.x - start!.x, to.y - start!.y) < 0.3 ? start! : limitMove(now, { x: m.x, y: m.y }, to, left, m.owner, m)) : { x: to.x, y: to.y };
        pos[to.id] = at;
        if (m && state.flow.started) now = { ...now, models: { ...now.models, [m.id]: { ...m, ...at } } };
      }
      // A model being placed goes only where its placing allows, and nothing else moves meanwhile.
      const placing = state.flow.started ? placingNow(state) : undefined;
      if (placing)
        for (const [id, o] of Object.entries(gesture.origin)) {
          const m = state.models[id];
          pos[id] = (id === placing.model && m && placeSpot(state, placing, m, { x: o.x + dx, y: o.y + dy })) || o;
        }
      // Before the battle, models stop at the edge of their deployment zone, as the server would hold them there.
      if (!state.flow.started) for (const mv of holdInZones(state, Object.entries(pos).map(([id, p]) => ({ id, ...p })))) if (pos[mv.id]) pos[mv.id] = { x: mv.x, y: mv.y };
      setDragPos(pos);
      sendMoves(pos, false);
    } else if (gesture.kind === 'terrain') {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * view.s < TAP_SLOP_PX) return;
      setGesture({ ...gesture, moved: true });
      const now = performance.now();
      if (pushing(gesture.id)) setTowerAt({ id: gesture.id, x: gesture.origin.x + dx, y: gesture.origin.y + dy });
      else if (now - lastSend.current >= SEND_EVERY_MS) {
        lastSend.current = now;
        dispatch({ type: 'updateTerrain', id: gesture.id, patch: { x: gesture.origin.x + dx, y: gesture.origin.y + dy } });
      }
    } else if (gesture.kind === 'box' || gesture.kind === 'measure' || gesture.kind === 'mark') {
      setGesture({ ...gesture, end: p });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.current.size === 0) {
        setGesture(null);
        // A twist that ends nearly square settles square, about the middle of the screen.
        const v = viewRef.current;
        const r = snapTurn(v.r);
        if (gesture.twisting && r !== v.r) {
          const b = svgRef.current!.getBoundingClientRect();
          const mid = { x: b.width / 2, y: b.height / 2 };
          setView(viewAt(toTable(v, mid), mid, v.s, r));
        }
      }
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    if (gesture.kind === 'drag') {
      const charge = charging.current;
      charging.current = null;
      if (gesture.moved && charge) dispatch({ type: 'trample', id: charge.id, x: charge.toward.x, y: charge.toward.y });
      else if (gesture.moved && dragPos) {
        // A model dropped just short of an enemy is charging it: finish the move into base contact.
        const settled: Record<string, Point> = {};
        for (const [id, at] of Object.entries(dragPos)) {
          const m = state.models[id];
          settled[id] = m ? settleMove(state, m, at) : at;
          // Held at terrain that needs a test, it sends where it was dragged to, so its card offers the test.
          const o = gesture.origin[id];
          if (m && o) settled[id] = dropTarget(state, m, settled[id], { x: o.x + p.x - gesture.start.x, y: o.y + p.y - gesture.start.y });
        }
        sendMoves(settled, true);
      } else if (gesture.wasSelected && gesture.multi) {
        const next = new Set(selected);
        next.delete(gesture.tapId);
        setSelected(next);
      } else if (gesture.wasSelected) setSelected(new Set([gesture.tapId]));
      setDragPos(null);
    } else if (gesture.kind === 'terrain') {
      setTowerAt(null);
      if (gesture.moved && pushing(gesture.id)) dispatch({ type: 'pushTower', id: gesture.id, seat: role as Seat, x: gesture.origin.x + p.x - gesture.start.x, y: gesture.origin.y + p.y - gesture.start.y });
      else if (gesture.moved)
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
    } else if (gesture.kind === 'mark') {
      const { start } = gesture;
      if (Math.hypot(p.x - start.x, p.y - start.y) * view.s < TAP_SLOP_PX) onMark?.({ kind: 'ping', x: start.x, y: start.y });
      else onMark?.({ kind: 'arrow', x: start.x, y: start.y, x2: p.x, y2: p.y });
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
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s}) rotate(${turn})`} style={{ fontSize }}>
          <rect className="mat" width={state.board.w} height={state.board.h} fill={`url(#tex-${state.board.mat})`} />
          {showGrid && gridLines}
          <g clipPath="url(#board-clip)">
          {terrain.map(t =>
            t.vines ? (
              // Writhing Vines: the marker, and the ground around it that is difficult for the other side.
              <g key={t.id} transform={`translate(${t.x} ${t.y})`} className={`vines ${t.side}`} pointerEvents="none">
                <circle className="vines-reach" r={VINES_REACH + t.w / 2} />
                <circle className="vines-marker" r={t.w / 2} />
              </g>
            ) : (
              <g
                key={t.id}
                transform={`translate(${towerAt?.id === t.id ? towerAt.x : t.x} ${towerAt?.id === t.id ? towerAt.y : t.y}) rotate(${t.rot})`}
                className={`terrain ${t.kind} ${t.locked ? 'locked' : ''} ${selectedTerrain === t.id ? 'selected' : ''}`}
              >
                <TerrainArt t={t} mat={state.board.mat} turn={turn} />
              </g>
            ),
          )}
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

          {showZones && <MoveZones state={state} models={models.filter(m => selected.has(m.id))} />}
          {/* A selected siege engine's 45° Arc of Sight, and the Iron Hills Ballista's lines across the table. */}
          <g pointerEvents="none" clipPath="url(#board-clip)">
            {models
              .filter(m => m.siege && !m.dead && selected.has(m.id))
              .map(m => {
                const r = 96;
                const a = (k: number) => ((m.rot + k) * Math.PI) / 180;
                return <path key={`arc-${m.id}`} className="engine-arc" d={`M${m.x},${m.y} L${m.x + Math.sin(a(-22.5)) * r},${m.y - Math.cos(a(-22.5)) * r} L${m.x + Math.sin(a(22.5)) * r},${m.y - Math.cos(a(22.5)) * r} Z`} />;
              })}
            {(state.flow.cables ?? []).map(([x1, y1, x2, y2], i) => (
              <line key={`cable-${i}`} className="cable" x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>

          {dragPos &&
            gesture?.kind === 'drag' &&
            Object.entries(gesture.origin).map(([id, dragFrom]) => {
              const m = state.models[id];
              // Measure on from where the model is, adding what it has already walked this phase.
              const limited = m && movesLimited(state, m);
              const o = m && limited ? { x: m.x, y: m.y } : dragFrom;
              const now = dragPos[id];
              if (!m || !now) return null;
              const before = limited ? spent(state, m) : 0;
              const d = before + Math.hypot(now.x - o.x, now.y - o.y);
              // Difficult terrain costs double and climbing costs the height, so the move is judged on what it costs.
              const step = moveCost(state, o, now, m.owner);
              const cost = before + step.cost;
              const difficult = step.difficult;
              const allowance = moveAllowance(state, m) ?? m.move;
              const over = cost > allowance + 1e-6;
              // The ghost stays where the model began the phase; the trail follows the way it has gone since.
              const home = limited ? moveStart(state, m) : dragFrom;
              const way = limited && state.flow.paths?.[id]?.length ? state.flow.paths[id] : [[home.x, home.y]];
              return (
                <g key={`g-${id}`} pointerEvents="none">
                  <g transform={`translate(${home.x} ${home.y}) rotate(${m.rot})`} className="ghost">
                    <BaseShape m={m} />
                  </g>
                  <polyline className={`trail ${over ? 'over' : ''}`} fill="none" points={[...way, [o.x, o.y], [now.x, now.y]].map(q => q.join(',')).join(' ')} />
                  {id === gesture.tapId && (
                    <text className={`trail-label ${over ? 'over' : ''}`} x={now.x} y={now.y - halfExtents(m.base).ry - 0.3} textAnchor="middle" transform={upright(turn, now.x, now.y)}>
                      {difficult ? `${formatInches(d)} (${formatInches(cost)} in difficult terrain)` : cost > d + 0.05 ? `${formatInches(d)} (${formatInches(cost)} with climbing)` : formatInches(d)} / {allowance}"
                    </text>
                  )}
                </g>
              );
            })}

          {/* This Move phase's moves so far, so you can see what went where. */}
          {state.phase === 'move' &&
            Object.entries(state.flow.starts ?? {}).map(([id, [x, y]]) => {
              const m = state.models[id];
              if (!m || m.dead || dragPos?.[id] || Math.hypot(m.x - x, m.y - y) < 0.2) return null;
              const way = state.flow.paths?.[id]?.length ? state.flow.paths[id] : [[x, y]];
              return <polyline key={`mt-${id}`} className={`move-trail ${m.owner}`} points={[...way, [m.x, m.y]].map(q => q.join(',')).join(' ')} fill="none" pointerEvents="none" />;
            })}
          {models.map(m0 => {
            const m = shown(m0);
            const { rx, ry } = halfExtents(m.base);
            const photo = photoFor(m);
            return (
              <g
                key={m.id}
                // A CSS transform, so models moved by the other player glide to where they went.
                style={{ transform: `translate(${m.x}px, ${m.y}px) rotate(${m.rot}deg)` }}
                className={`model ${animate && !dragPos?.[m.id] ? 'glide' : ''} ${m.owner} ${m.hero ? 'hero' : ''} ${selected.has(m.id) ? 'selected' : ''} ${sight?.seen.has(m.id) ? `seen-${sight.seen.get(m.id)}` : ''}`}
              >
                <BaseShape m={m} />
                {photo && (
                  <>
                    <text className="label" textAnchor="middle" dominantBaseline="central" transform={`rotate(${-m.rot - turn})`} style={{ fontSize: Math.min(ry * 0.8, 0.32) }}>
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
                        transform={`rotate(${-m.rot - turn})`}
                      />
                    </g>
                    {/* A hero keeps its side's ring just inside a gold one at the edge. */}
                    <BaseShape m={m} className="ring" grow={m.hero ? -0.09 : 0} />
                    {m.hero && <BaseShape m={m} className="ring gold" />}
                  </>
                )}
                <path className="facing" d={`M ${-0.12} ${-ry + 0.04} L 0 ${-ry - 0.1} L ${0.12} ${-ry + 0.04} Z`} />
                {!photo && (
                  <text className="label" textAnchor="middle" dominantBaseline="central" transform={`rotate(${-m.rot - turn})`} style={{ fontSize: Math.min(ry * 0.8, 0.32) }}>
                    {initials(m.name)}
                  </text>
                )}
                {sight?.seen.has(m.id) && <ZoneShape m={m} pad={0.12} className="sight-ring" />}
                {/* A power at work on it, and whether it lies Prone. */}
                {state.flow.started && effectsOn(state, m).length > 0 && <ZoneShape m={m} pad={0.07} className="spell-ring" />}
                {m.prone && (
                  <text className="prone-mark" textAnchor="middle" transform={`rotate(${-m.rot - turn}) translate(${-rx * 0.8} ${-ry * 0.7})`} style={{ fontSize: 0.28 }}>
                    P
                  </text>
                )}
                {heroicIds.has(m.id) && (
                  <text className="heroic-mark" textAnchor="middle" transform={`rotate(${-m.rot - turn}) translate(${rx * 0.8} ${-ry * 0.7})`} style={{ fontSize: 0.32 }}>
                    ⚡
                  </text>
                )}
                {m.maxWounds > 1 && (
                  <text className="wounds" textAnchor="middle" transform={`rotate(${-m.rot - turn}) translate(0 ${ry + 0.25})`} style={{ fontSize: 0.25 }}>
                    {m.wounds}/{m.maxWounds}W
                  </text>
                )}
              </g>
            );
          })}

          {showTerrainNames &&
            terrain
              .filter(t => t.kind !== 'objective' && !t.vines)
              .map(t => (
                <text key={`tn-${t.id}`} className="terrain-name" x={t.x} y={t.y} textAnchor="middle" dominantBaseline="middle" pointerEvents="none" transform={upright(turn, t.x, t.y)}>
                  {TERRAIN_INFO[t.kind].name}
                  {t.floors ? ` · ${t.floors + 1} levels` : ''}
                </text>
              ))}
          {animate && <Effects state={state} fontSize={fontSize} turn={turn} />}
          {/* Models standing up high show how far up they are. */}
          {models.map(m0 => {
            const m = shown(m0);
            const up = Math.round(standingAt(state, m) * 10) / 10;
            if (!up) return null;
            const { rx, ry } = halfExtents(m.base);
            return (
              <text key={`h-${m.id}`} className="model-height" x={m.x + rx + 0.1} y={m.y - ry * 0.6} textAnchor="start" pointerEvents="none" transform={upright(turn, m.x, m.y)}>
                ▲{up}
              </text>
            );
          })}
          {showNames &&
            models.map(m0 => {
              const m = shown(m0);
              const { ry } = halfExtents(m.base);
              return (
                <text key={`n-${m.id}`} className={`model-name ${m.owner}`} x={m.x} y={m.y + ry + (m.maxWounds > 1 ? 0.45 : 0.1) + fontSize * 0.8} textAnchor="middle" pointerEvents="none" transform={upright(turn, m.x, m.y)}>
                  {m.name}
                </text>
              );
            })}

          {sight?.lines
            .filter(l => l.seen !== 'hidden')
            .map(l => (
              <text key={`st-${l.m.id}`} className={`sight-label ${l.seen}`} x={l.m.x} y={l.m.y - halfExtents(l.m.base).ry - fontSize * 0.5} textAnchor="middle" pointerEvents="none" transform={upright(turn, l.m.x, l.m.y)}>
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
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - fontSize * 0.6} textAnchor="middle" transform={upright(turn, (a.x + b.x) / 2, (a.y + b.y) / 2)}>
                  {l.label}
                </text>
              </g>
            );
          })}

          {fights?.map(f => {
            const ms = f.ids.map(id => state.models[id]).filter(Boolean);
            if (!ms.length) return null;
            const x = ms.reduce((n, m) => n + m.x, 0) / ms.length;
            const y = ms.reduce((n, m) => n + m.y, 0) / ms.length;
            // Just above the fight on screen, however the table is turned.
            const flat = ms.map(m => toScreen({ x: 0, y: 0, s: 1, r: turn }, m));
            const above = flat.reduce((n, p) => n + p.y, 0) / flat.length - Math.min(...flat.map((p, i) => p.y - Math.max(halfExtents(ms[i].base).rx, halfExtents(ms[i].base).ry))) + fontSize * 1.2;
            const r = fontSize * 0.9;
            return (
              <g
                key={f.key}
                className={`fight-mark ${f.done ? 'done' : ''}`}
                transform={`translate(${x} ${y}) rotate(${-turn}) translate(0 ${-above})`}
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

          <g className="marks" pointerEvents="none">
            {(marks ?? []).map(m =>
              m.kind === 'ping' ? (
                <g key={m.id} className={`ping ${m.by}`} transform={`translate(${m.x} ${m.y})`}>
                  <circle className="ping-dot" r={fontSize * 0.35} />
                  <circle className="ping-ring" r={1} />
                  <circle className="ping-ring late" r={1} />
                </g>
              ) : (
                <Arrow key={m.id} by={m.by} from={{ x: m.x, y: m.y }} to={{ x: m.x2!, y: m.y2! }} fontSize={fontSize} turn={turn} />
              ),
            )}
            {gesture?.kind === 'mark' && Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y) * view.s >= TAP_SLOP_PX && (
              <Arrow by="mine" from={gesture.start} to={gesture.end} fontSize={fontSize} turn={turn} />
            )}
          </g>
          {rulerInfo && (
            <g className="ruler" pointerEvents="none">
              <line x1={rulerInfo.start.x} y1={rulerInfo.start.y} x2={rulerInfo.end.x} y2={rulerInfo.end.y} />
              <circle cx={rulerInfo.start.x} cy={rulerInfo.start.y} r={fontSize * 0.25} />
              <circle cx={rulerInfo.end.x} cy={rulerInfo.end.y} r={fontSize * 0.25} />
              <text x={rulerInfo.end.x} y={rulerInfo.end.y - fontSize} textAnchor="middle" transform={upright(turn, rulerInfo.end.x, rulerInfo.end.y)}>
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
        const marker = t.object && markerName(state, t);
        return (
          <div className={`terrain-tip ${pinned ? 'pinned' : ''}`} style={{ left: at.x, top: at.y }} role="status">
            <b>{marker || info.name}</b> <small>{info.type}</small>
            {pinned ? (
              <ul>
                {(t.object ? markerNotes(t) : terrainRules(t)).map(r => (
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
        <button aria-label="Fit board" onClick={() => fit()}>⤢</button>
        <button aria-label="Turn the table left" title="Turn the table left (Shift+R)" onClick={() => turnBy(-90)}>⟲</button>
        <button aria-label="Turn the table right" title="Turn the table right (R)" onClick={() => turnBy(90)}>⟳</button>
      </div>
    </div>
  );
}
