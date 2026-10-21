import { nearestSpot, placeNear, solidOutlines, type Move } from './deployment.ts';
import { distanceBetween, halfExtents, OBJECTIVE_SIZE, type Point } from './geometry.ts';
import { inZone, scaleZone, whollyIn, zonesOf } from './objects.ts';
import { narrativeOf } from './narrative.ts';
import { objectivesMissing, scenarioById, type Zone } from './scenarios.ts';
import { onOutlines } from './sight.ts';
import type { Deploying, GameState, Model, Seat, Terrain } from './types.ts';

// Setting up in turn, as the scenarios say: a roll-off, its winner choosing their end of the table, then the players
// taking turns to put one warband down at a time (or, in Storm the Camp, their whole army). Domination's objective
// markers are placed the same way first. Narrative scenarios set their casts up side by side in the book's order.

/** How a scenario's armies (and any markers the players place) go onto the table. */
export interface Procedure {
  /** A warband at a time in turn, the whole army at once, or not at all (they arrive during the game). */
  armies: 'warbands' | 'army' | 'none';
  /** What the roll-off's winner chooses: a long edge, a corner, a pair of opposite corners, or the edge they arrive by. */
  pick: 'side' | 'corner' | 'corners' | 'edge' | null;
  /** How taking the far end changes the table: turned round, or (for a pair of corners) mirrored left to right. */
  swap?: 'round' | 'mirror';
  /** A D6 for each warband: on a 1-3 it must stand wholly within 12" of the centre line, or of its own edge. */
  d6?: 'centre' | 'edge';
  /** Each side's first warband is its Champion's: the Champion within 3" of the centre, the rest within 6" of it. */
  champion?: boolean;
  /** A side's warbands take its zones in turn (corner A, then corner B, and round again). */
  alternateZones?: boolean;
  /** No model may be set up this close to an enemy, in inches. */
  enemyGap?: number;
  /** Nor this close to the line between the two halves (Retrieval's diagonal). */
  lineGap?: number;
  /** Objective markers the players place in turn after a roll-off: how far apart, and how far from the edges. */
  markers?: { apart: number; edge: number };
}

const LONG: Procedure = { armies: 'warbands', pick: 'side', swap: 'round' };
const MAELSTROM: Procedure = { armies: 'none', pick: null };

/** Each matched play scenario's set-up, from its Layout and Starting Positions in the Matched Play Guide. */
export const PROCEDURES: Record<string, Procedure> = {
  domination: { ...LONG, markers: { apart: 12, edge: 6 } },
  'capture-and-control': { ...LONG, d6: 'centre', enemyGap: 1 },
  breakthrough: LONG,
  'stake-a-claim': LONG,
  'to-the-death': LONG,
  'lords-of-battle': { ...LONG, enemyGap: 1 },
  assassination: LONG,
  'contest-of-champions': { ...LONG, champion: true, d6: 'edge', enemyGap: 1 },
  'hold-ground': MAELSTROM,
  'heirloom-of-ages-past': MAELSTROM,
  'sites-of-power': MAELSTROM,
  'command-the-battlefield': MAELSTROM,
  'destroy-the-supplies': LONG,
  retrieval: { armies: 'warbands', pick: 'corner', swap: 'round', lineGap: 3 },
  'seize-the-prizes': LONG,
  'treasure-hoard': LONG,
  reconnoitre: { armies: 'none', pick: 'edge', swap: 'round' },
  'storm-the-camp': { armies: 'army', pick: 'corner', swap: 'round' },
  'divide-and-conquer': { armies: 'warbands', pick: 'corners', swap: 'mirror', alternateZones: true },
  'escort-the-wounded': LONG,
  'fog-of-war': LONG,
  'clash-by-moonlight': LONG,
  'lead-from-the-front': LONG,
  convergence: { armies: 'warbands', pick: 'corners', swap: 'mirror', alternateZones: true },
};

/** Every model must be set up within this far of its warband's Captain. */
export const CAPTAIN_RANGE = 6;
/** The Champion goes within this far of the centre of the table. */
const CHAMPION_RANGE = 3;
/** How big the markers the players place are across (as scenarioMarkers makes them). */
const MARKER = OBJECTIVE_SIZE;

const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');
const reach = (m: Pick<Model, 'base'>) => Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);

/** The set-up of the matched play scenario being played, if it has one (not in a narrative scenario). */
export const procedureOf = (state: Pick<GameState, 'scenario' | 'narrative'>): Procedure | undefined => (state.narrative || !state.scenario ? undefined : PROCEDURES[state.scenario]);

/** Whether the table is set out in turn before this battle: a scenario with a roll-off, or a narrative one with an order. */
export function takesTurns(state: Pick<GameState, 'scenario' | 'narrative'>): boolean {
  if (state.narrative) return !!narrativeOf(state)?.setupOrder;
  const p = procedureOf(state);
  return !!p && (p.armies !== 'none' || !!p.pick || !!p.markers);
}

/** Whether everything that is set out in turn is on the table, so the battle can start. */
export function deployReady(state: GameState): boolean {
  if (!takesTurns(state)) return true;
  const d = state.flow.deploy;
  // (A narrative game set up before set-up went in turns has nothing to wait for.)
  if (state.narrative && !d) return true;
  return d?.step === 'done';
}

/** A warband's key: its side and its warband (models with none go together). */
export const bandKey = (m: Pick<Model, 'owner' | 'warband'>) => `${m.owner}:${m.warband ?? ''}`;

/**
 * A side's warbands, each as its models (the dead left out); with `waiting`, only those still to be set up (off the
 * table, and not left off for want of room when their warband went down).
 */
export function bandsOf(state: GameState, seat: Seat, waiting = false): Model[][] {
  const groups = new Map<string, Model[]>();
  const noRoom = new Set(state.flow.deploy?.noRoom);
  for (const m of Object.values(state.models)) {
    if (m.owner !== seat || m.dead || (waiting && (!m.waiting || noRoom.has(m.id)))) continue;
    groups.set(bandKey(m), [...(groups.get(bandKey(m)) ?? []), m]);
  }
  return [...groups.values()];
}

/** A warband's Captain: its Champion in Contest of Champions, else its leading hero (highest tier, then points). */
export function captainOf(state: GameState, band: Model[]): Model | undefined {
  const champion = band[0] && state.flow.picks?.[band[0].owner]?.champion;
  const named = champion ? band.find(m => m.id === champion) : undefined;
  if (named) return named;
  const heroes = band.filter(m => m.hero && !m.aboard);
  return [...heroes].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (b.points ?? 0) - (a.points ?? 0) || (a.id < b.id ? -1 : 1))[0];
}

/** What a warband is called: after its Captain. */
export function bandName(state: GameState, band: Model[]): string {
  const c = captainOf(state, band);
  return c ? `${c.name}'s warband` : band.length === 1 ? band[0].name : `${band.length} ${band[0]?.name ?? 'model'}s`;
}

/** Whether a model belongs to the warband (or army) being placed now. */
export function inCurrent(d: Deploying | undefined, m: Pick<Model, 'owner' | 'warband'>): boolean {
  if (!d?.current) return false;
  return d.current === `${m.owner}:*` || d.current === bandKey(m);
}

/** The models being placed now. */
export const currentBand = (state: GameState) => Object.values(state.models).filter(m => !m.dead && inCurrent(state.flow.deploy, m));

/** Whether a side's first warband (its Champion's, in Contest of Champions) is the one going down now. */
const championFirst = (state: GameState, d: Deploying, seat: Seat) => !!procedureOf(state)?.champion && !d.placed.some(k => k.startsWith(`${seat}:`));

/**
 * Whether a player may move this model before the battle. Before any roll-off they arrange as they like; once setting
 * up in turn has begun, only the warband being placed moves (in a narrative scenario, only the side setting up).
 */
export function mayArrange(state: GameState, m: Model): boolean {
  const d = state.flow.deploy;
  if (state.flow.started || !d) return true;
  if (d.step === 'warbands') return inCurrent(d, m);
  if (d.step === 'sides') return m.owner === d.turn;
  return false;
}

/** The half-disc round the centre of the table that a Champion stands wholly in (within 3" of the centre, in its own half). */
function championZone(state: GameState, m: Model): Zone {
  const { w, h } = state.board;
  const r = CHAMPION_RANGE + reach(m) * (1 + Math.SQRT2);
  const start = m.owner === 'p1' ? 0 : Math.PI;
  const points = Array.from({ length: 25 }, (_, i) => start + (i * Math.PI) / 24).map(a => [w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)] as [number, number]);
  return { seat: m.owner, shape: 'polygon', points, label: 'Champion' };
}

/** Retrieval's halves, kept 3" back from the diagonal between them. */
function awayFromLine(state: GameState, seat: Seat, gap: number): Zone {
  const d = gap * Math.SQRT2;
  const points: [number, number][] = seat === 'p1' ? [[0, d], [48 - d, 48], [0, 48]] : [[d, 0], [48, 0], [48, 48 - d]];
  return scaleZone(state.board, { seat, shape: 'polygon', points });
}

/** Where a model may stand as its warband is set up: its side's zone, narrowed by the scenario's rules for this warband. */
export function deployZones(state: GameState, m: Model): Zone[] {
  const zones = zonesOf(state, m.owner);
  const d = state.flow.deploy;
  const p = procedureOf(state);
  if (!d || !p || d.step !== 'warbands' || !inCurrent(d, m) || !zones.length) return zones;
  if (p.champion && championFirst(state, d, m.owner)) return m.id === state.flow.picks?.[m.owner]?.champion ? [championZone(state, m)] : zones;
  if (p.alternateZones) {
    // (A warband already down keeps its own corner, for any of it that comes on after.)
    const order = d.placed.filter(k => k.startsWith(`${m.owner}:`));
    const at = order.indexOf(bandKey(m));
    return [zones[(at >= 0 ? at : order.length) % zones.length]];
  }
  if (p.lineGap) return [awayFromLine(state, m.owner, p.lineGap)];
  if (p.d6 && d.roll && d.roll <= 3) {
    const sub = (scenarioById(state.scenario)?.deployment.zones ?? []).filter(z => z.seat === m.owner && z.label?.includes('sub-zone'));
    if (sub.length) return sub.map(z => scaleZone(state.board, z));
  }
  return zones;
}

/** What the rule for a warband's D6 means, for the log and the set-up card. */
export function rollMeans(state: GameState, roll: number): string {
  const p = procedureOf(state);
  if (!p?.d6) return '';
  if (roll >= 4) return 'anywhere in its own half';
  return p.d6 === 'centre' ? 'wholly within 12" of the centre line' : 'wholly within 12" of its own table edge';
}

/** Enemy models a model would stand too close to, set up there. */
const tooClose = (state: GameState, m: Model, gap: number) => Object.values(state.models).some(e => e.owner !== m.owner && !e.dead && !e.waiting && !e.escaped && !e.aboard && distanceBetween(m, e) < gap - 1e-6);

/**
 * Whether a model of the warband being placed may stand at `p` under the scenario's own limits: clear of the enemy
 * where the scenario says so, and within 6" of its Captain (who is checked against the Captain's spot in `models`).
 */
export function deployFits(state: GameState, models: Record<string, Model>, m: Model, p: Point): boolean {
  const d = state.flow.deploy;
  if (!d || d.step !== 'warbands' || !inCurrent(d, m)) return true;
  const there = { ...m, x: p.x, y: p.y };
  const gap = procedureOf(state)?.enemyGap;
  if (gap && tooClose({ ...state, models }, there, gap)) return false;
  const cap = captainIdOf(state, m);
  return !cap || cap === m.id || !models[cap] || distanceBetween(there, models[cap]) <= CAPTAIN_RANGE + 1e-6;
}

/** Each warband's Captain, worked out once per table (a drag asks for it at every spot it tries). */
const captains = new WeakMap<object, Map<string, string | undefined>>();
function captainIdOf(state: GameState, m: Model): string | undefined {
  let known = captains.get(state.models);
  if (!known) captains.set(state.models, (known = new Map()));
  const key = bandKey(m);
  if (!known.has(key)) known.set(key, captainOf(state, Object.values(state.models).filter(o => !o.dead && !o.waiting && bandKey(o) === key))?.id);
  return known.get(key);
}

/** What keeps a model of the warband being placed from standing where it is, or null if it may. */
export function misplaced(state: GameState, m: Model): string | null {
  const gap = procedureOf(state)?.enemyGap;
  if (!whollyIn(deployZones(state, m), m)) return `${m.name} isn't wholly inside where it may set up.`;
  if (gap && tooClose(state, m, gap)) return `${m.name} is within ${gap}" of the enemy.`;
  const cap = captainOf(state, currentBand(state).filter(o => !o.waiting && !o.aboard && bandKey(o) === bandKey(m)));
  if (cap && cap.id !== m.id && distanceBetween(m, cap) > CAPTAIN_RANGE + 1e-6) return `${m.name} is more than 6" from ${cap.name}, its Captain.`;
  return null;
}

/** What still keeps the warband being placed from going down as it stands (an empty list when it can). */
export function deployProblems(state: GameState): string[] {
  const d = state.flow.deploy;
  if (!d?.current || d.step !== 'warbands') return [];
  const out = new Set<string>();
  for (const m of currentBand(state).filter(m => !m.waiting && !m.aboard)) {
    const x = misplaced(state, m);
    if (x) out.add(x);
  }
  return [...out].slice(0, 4);
}

/** The middle of each of `n` lanes across a zone, middle lane first, as the points warbands are laid out round. */
function lanes(state: GameState, zone: Zone, n: number): Point[] {
  const pts: Point[] = [];
  for (let x = 0.5; x < state.board.w; x += 1) for (let y = 0.5; y < state.board.h; y += 1) if (inZone(zone, { x, y })) pts.push({ x, y });
  if (!pts.length) return [{ x: state.board.w / 2, y: state.board.h / 2 }];
  const x0 = Math.min(...pts.map(p => p.x));
  const x1 = Math.max(...pts.map(p => p.x)) + 1;
  const mid = (ps: Point[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
  const all = Array.from({ length: Math.max(1, n) }, (_, i) => {
    const a = x0 + ((x1 - x0) * i) / n;
    const b = x0 + ((x1 - x0) * (i + 1)) / n;
    const col = pts.filter(p => p.x >= a && p.x < b);
    return col.length ? mid(col) : mid(pts);
  });
  // Middle out: the first warband in the middle, the next either side of it.
  const order = all.map((_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b);
  return order.map(i => all[i]);
}

/**
 * Where the game first puts a warband coming onto the table: its Captain in the next free lane of its zone, the rest
 * as close round it as they fit, all wholly in the zone, clear of terrain and models, within 6" of the Captain and
 * clear of the enemy where the scenario says. `state` has the warband marked as being placed.
 */
export function layBand(state: GameState, band: Model[], lane: number, lanesIn: number): Move[] {
  const seat = band[0]?.owner;
  if (!seat) return [];
  const gap = procedureOf(state)?.enemyGap ?? 0;
  const spacing = (o: Model) => (o.owner !== seat && gap ? gap + 0.05 : 0.1);
  const taken = Object.values(state.models).filter(m => !m.dead && !m.waiting && !m.escaped && !m.aboard && !band.includes(m));
  const placing = band.filter(m => !m.aboard);
  // Some of a warband left off when it went down, coming on later, go round its Captain where he already stands.
  const down = captainOf(state, Object.values(state.models).filter(m => !m.dead && !m.aboard && bandKey(m) === bandKey(band[0]) && (!m.waiting || band.includes(m))));
  const anchored = down && !band.includes(down) ? down : undefined;
  const cap = anchored ?? captainOf(state, placing) ?? placing[0];
  const capZone = anchored ? deployZones(state, placing[0]).find(z => inZone(z, anchored)) : deployZones(state, cap)[0];
  if (!capZone) return [];
  const restZone = anchored ? capZone : deployZones(state, placing.find(m => m !== cap) ?? cap)[0];
  const ways = lanes(state, restZone, lanesIn);
  const at = capZone.label === 'Champion' ? { x: state.board.w / 2, y: state.board.h / 2 } : ways[lane % ways.length];
  const rot = seat === 'p1' ? 0 : 180;
  // Clear of difficult ground and water where there's room; on it where there isn't.
  const place = (models: Model[], zone: Zone, near: Point, others: Model[], ok?: (m: Model, p: Point) => boolean) => {
    const first = placeNear(state, models, zone, near, others, spacing, ok);
    const left = models.filter(m => !first.some(mv => mv.id === m.id));
    const placed = first.map(mv => ({ ...state.models[mv.id], x: mv.x, y: mv.y }));
    return left.length ? [...first, ...placeNear(state, left, zone, near, [...others, ...placed], spacing, ok, false)] : first;
  };
  const capMove = anchored ? { id: cap.id, x: cap.x, y: cap.y } : place([cap], capZone, at, taken)[0];
  if (!capMove) return [];
  const capHere = { ...cap, x: capMove.x, y: capMove.y };
  const rest = placing.filter(m => m !== cap);
  const near = (m: Model, p: Point) => distanceBetween({ ...m, x: p.x, y: p.y }, capHere) <= CAPTAIN_RANGE - 0.05;
  // (Any with no room near the Captain stay off the table.)
  const others = place(rest, restZone, capHere, [...taken, capHere], near);
  return [...(anchored ? [] : [capMove]), ...others].map(mv => ({ ...mv, rot }));
}

/** Whose turn it is after a warband (or a side) has gone down, or null when everyone is on the table. */
export function nextTurn(state: GameState, d: Deploying, just: Seat): Seat | null {
  if (d.step === 'sides') {
    const order = narrativeOf(state)?.setupOrder ?? [];
    const good = state.narrative?.good ?? 'p1';
    const seats = order.map(s => (s === 'good' ? good : other(good)));
    return seats.find(s => !d.placed.includes(`${s}:*`)) ?? null;
  }
  const left = (s: Seat) => bandsOf(state, s, true).length > 0;
  return left(other(just)) ? other(just) : left(just) ? just : null;
}

/** What the next roll-off is for, if one is due now. */
export function rollDue(state: GameState): 'markers' | 'side' | null {
  const p = procedureOf(state);
  if (state.flow.started || !p) return null;
  const d = state.flow.deploy;
  if (d && d.step !== 'roll') return null;
  if (!d && p.markers && objectivesMissing(state) > 0) return 'markers';
  if (!p.pick && p.armies === 'none') return null;
  // The armies have to be chosen first: the roll-off takes them off the table to be set up warband by warband.
  if (p.armies !== 'none' && !(['p1', 'p2'] as Seat[]).every(s => Object.values(state.models).some(m => m.owner === s && !m.dead))) return null;
  return 'side';
}

/** The markers that count as the scenario's objectives (not siege gear or Writhing Vines). */
const objectives = (state: GameState) => Object.values(state.terrain).filter(t => t.kind === 'objective' && !t.vines && !t.gone && (!t.object || ['artefact', 'relic', 'heirloom', 'decoy', 'supply', 'ally'].includes(t.object)));

/** Whether an objective marker may go at `p`: far enough from the others and the table edges, and not on a building or cliff. */
export function markerFits(state: GameState, p: Point, skip?: string): boolean {
  const rules = procedureOf(state)?.markers ?? { apart: 12, edge: 6 };
  const r = MARKER / 2;
  const { w, h } = state.board;
  if (p.x - r < rules.edge - 1e-6 || p.y - r < rules.edge - 1e-6 || p.x + r > w - rules.edge + 1e-6 || p.y + r > h - rules.edge + 1e-6) return false;
  if (objectives(state).some(t => t.id !== skip && Math.hypot(t.x - p.x, t.y - p.y) - r - Math.max(t.w, t.h) / 2 < rules.apart - 1e-6)) return false;
  return !onOutlines(solidOutlines(state), p, r);
}

/** Where a marker a player asks to put at `want` goes: there if it may, else the nearest spot that may. */
export function markerSpot(state: GameState, want: Point, skip?: string, far = 36): Point | null {
  return nearestSpot(want, p => markerFits(state, p, skip), far, 0.5);
}

/** A new objective marker at `p`, for a player to place. */
export function newMarker(state: GameState, p: Point): Terrain {
  let n = objectives(state).length;
  while (state.terrain[`obj-${n}`]) n++;
  return { id: `obj-${n}`, kind: 'objective', shape: 'circle', x: p.x, y: p.y, w: MARKER, h: MARKER, rot: 0, locked: false };
}

/** Where a player's marker starts, before they drag it: in the middle of their own half, as near as it may go. */
export const markerStart = (state: GameState, seat: Seat): Point => ({ x: state.board.w / 2, y: seat === 'p1' ? state.board.h * 0.75 : state.board.h * 0.25 });

/** Markers the side has placed: what tells where the computer puts its next one. */
export const placedMarkers = (state: GameState) => objectives(state).filter(t => t.id.startsWith('obj-'));

/** The scenario markers that belong to a side, whose side changes as the table is turned round. */
const SIDED = new Set(['relic', 'supply', 'ally']);

/**
 * The terrain as it stands once the roll-off's winner has taken the far end: turned round (the long edges and corners),
 * or mirrored left to right (a pair of opposite corners). Markers that belong to a side change hands with the end.
 */
export function swapEnds(state: GameState, how: 'round' | 'mirror'): Record<string, Terrain> {
  const { w, h } = state.board;
  const out: Record<string, Terrain> = {};
  for (const t of Object.values(state.terrain)) {
    const round = how === 'round';
    const moved: Terrain = { ...t, x: w - t.x, y: round ? h - t.y : t.y, rot: round ? (t.rot + 180) % 360 : (360 - t.rot) % 360 };
    if (t.path && !round) moved.path = t.path.map(([x, y, hw]) => [-x, y, hw]);
    if (t.home) moved.home = [w - t.home[0], round ? h - t.home[1] : t.home[1]];
    if (t.side && t.object && SIDED.has(t.object)) moved.side = other(t.side);
    out[t.id] = moved;
  }
  return out;
}

/** The deployment zones to draw brighter, for the warband being set up now. */
export function zonesNow(state: GameState): Zone[] {
  const band = currentBand(state).filter(m => !m.aboard);
  const seen = new Set<string>();
  const out: Zone[] = [];
  for (const m of band)
    for (const z of deployZones(state, m)) {
      const k = JSON.stringify(z);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(z);
      }
    }
  return out;
}

/** The warband (by its warband id) the computer puts down next: its Champion's first, then the biggest. */
export function nextBandFor(state: GameState, seat: Seat): string | null {
  const d = state.flow.deploy;
  if (procedureOf(state)?.armies === 'army') return '*';
  const bands = bandsOf(state, seat, true);
  if (!bands.length || !d) return null;
  if (championFirst(state, d, seat)) {
    const champ = state.flow.picks?.[seat]?.champion;
    const b = bands.find(x => x.some(m => m.id === champ));
    return b ? (b[0].warband ?? '') : null;
  }
  return [...bands].sort((a, b) => b.length - a.length)[0][0].warband ?? '';
}

/** Whether a side may put this warband down now (a side's first warband in Contest of Champions is its Champion's). */
export function mayPutDown(state: GameState, seat: Seat, warband: string): boolean {
  const d = state.flow.deploy;
  const p = procedureOf(state);
  if (state.flow.started || !p || !d || d.step !== 'warbands' || d.turn !== seat || d.current) return false;
  const bands = bandsOf(state, seat, true);
  if (warband === '*') return p.armies === 'army' && bands.length > 0;
  if (p.armies === 'army') return false;
  const band = bands.find(b => (b[0].warband ?? '') === warband);
  if (!band) return false;
  if (championFirst(state, d, seat)) {
    const champ = state.flow.picks?.[seat]?.champion;
    return !!champ && band.some(m => m.id === champ);
  }
  return true;
}
