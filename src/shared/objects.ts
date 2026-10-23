import { mounted } from './cavalry.ts';
import { isAmbush, isHobbit } from './ambush.ts';
import { atBoats, carriesHobbit, isAmon, mayCarryHobbit } from './amon.ts';
import { distanceToBase, halfExtents, inBaseContact, type Point } from './geometry.ts';
import { fortressNotes, helpers, HEAVY } from './fortress.ts';
import { scenarioById, type Zone } from './scenarios.ts';
import type { GameState, MarkerObject, Model, Seat, Terrain } from './types.ts';

// Scenario markers that models interact with: artefacts to dig up and carry, relics, heirlooms and their decoys,
// supplies to destroy and wounded allies to rescue. Also models leaving the table over an edge.

export const OBJECT_NAMES: Record<MarkerObject, string> = {
  artefact: 'Artefact',
  relic: 'Relic',
  heirloom: 'Heirloom',
  decoy: 'Heirloom',
  supply: 'Supply',
  campfire: 'Campfire',
  charge: 'Demolition Charge',
  ally: 'Wounded Ally',
  ladder: 'Siege Ladder',
  ram: 'Battering Ram',
  rocks: 'Rocks',
  oil: 'Boiling Oil',
  rally: 'Rallying Point',
  hobbit: 'Knocked-out Hobbit',
  boat: 'Boats',
  cocoon: 'Webbed bundle',
};

/** How far a model's base is from a marker's edge. */
export const fromMarker = (m: Model, t: Terrain) => Math.max(0, distanceToBase(m, t) - Math.max(t.w, t.h) / 2);
/** Base contact, with a little slack for dragging by hand. */
export const touching = (m: Model, t: Terrain) => fromMarker(m, t) <= 0.25;

export const markers = (state: GameState) => Object.values(state.terrain).filter(t => t.kind === 'objective');
/** Markers still on the table (not carried off, destroyed, rescued or revealed as decoys). */
export const onTable = (state: GameState) => markers(state).filter(t => !t.gone);
export const carriedBy = (state: GameState, m: Model) => onTable(state).filter(t => t.carrier === m.id);

/** Models fighting this one: enemies in base contact. */
const engaged = (state: GameState, m: Model) =>
  Object.values(state.models).some(e => e.owner !== m.owner && !e.dead && !e.escaped && inBaseContact(e, m));

const isCavalry = (m: Model) => mounted(m);

/** Player 1 starts at the bottom of the table, player 2 at the top. */
export function inZone(z: Zone, p: Point): boolean {
  if (z.shape === 'rect') return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
  if (z.shape === 'circle' || z.shape === 'semicircle' || z.shape === 'quarter-circle') return ((p.x - z.cx) / z.r) ** 2 + ((p.y - z.cy) / (z.ry ?? z.r)) ** 2 <= 1;
  if (z.shape === 'polygon') {
    let inside = false;
    const pts = z.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** A scenario zone (in inches on a 48" table) scaled to the board, across and down separately. */
export function scaleZone(board: { w: number; h: number }, z: Zone): Zone {
  const k = board.w / 48;
  const ky = board.h / 48;
  return z.shape === 'rect'
    ? { ...z, x: z.x * k, y: z.y * ky, w: z.w * k, h: z.h * ky }
    : z.shape === 'polygon'
      ? { ...z, points: z.points.map(([x, y]) => [x * k, y * ky] as [number, number]) }
      : z.shape === 'edge'
        ? z
        : { ...z, cx: z.cx * k, cy: z.cy * ky, r: z.r * k, ry: z.r * ky };
}

/** A side's deployment zone(s) from the scenario, scaled to the board (across and down separately). */
export function zonesOf(state: GameState, seat: Seat): Zone[] {
  const s = scenarioById(state.scenario);
  return (s?.deployment.zones ?? []).filter(z => z.seat === seat && z.shape !== 'edge' && !z.label?.includes('sub-zone') && !z.label?.includes('Champion')).map(z => scaleZone(state.board, z));
}

/** Whether a model stands wholly inside one of the zones. */
export function whollyIn(zones: Zone[], m: Model): boolean {
  const { rx, ry } = halfExtents(m.base);
  const corners = [
    { x: m.x - rx, y: m.y - ry },
    { x: m.x + rx, y: m.y - ry },
    { x: m.x - rx, y: m.y + ry },
    { x: m.x + rx, y: m.y + ry },
  ];
  return zones.some(z => corners.every(c => inZone(z, c)));
}

/** Whether a round marker lies wholly inside a zone. */
export const markerWhollyIn = (z: Zone, t: Terrain) => {
  const r = Math.max(t.w, t.h) / 2;
  return Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).every(a => inZone(z, { x: t.x + r * Math.cos(a), y: t.y + r * Math.sin(a) }));
};

/** In the half of the table a side deploys in. */
export const inHalf = (state: GameState, seat: Seat, p: Point) => (seat === 'p1' ? p.y > state.board.h / 2 : p.y < state.board.h / 2);

/** Which edges a model may leave the table by in this scenario, if any. */
export function exitEdges(state: GameState, m: Model): ('top' | 'bottom' | 'left' | 'right')[] {
  const enemyEdge = m.owner === 'p1' ? 'top' : 'bottom';
  const carrying = carriedBy(state, m);
  // Ambush at Night: Merry and Pippin get away off any edge.
  if (isAmbush(state) && isHobbit(m)) return ['top', 'bottom', 'left', 'right'];
  // Amon Hen: an Uruk-hai carrying off a Hobbit goes by any edge but the river's.
  if (isAmon(state)) return carriesHobbit(state, m) ? ['top', 'bottom', 'right'] : [];
  switch (state.scenario) {
    case 'reconnoitre':
      return [enemyEdge];
    case 'seize-the-prizes':
      return carrying.some(t => t.object === 'artefact') ? [enemyEdge] : [];
    case 'retrieval':
      // The enemy's Relic can be carried off any edge of your own corner zone.
      return carrying.some(t => t.object === 'relic' && t.side !== m.owner) ? (m.owner === 'p1' ? ['bottom', 'left'] : ['top', 'right']) : [];
    default:
      return [];
  }
}

function atEdge(state: GameState, m: Model, edge: 'top' | 'bottom' | 'left' | 'right'): boolean {
  const { rx, ry } = halfExtents(m.base);
  const slack = 0.3;
  if (edge === 'top') return m.y - ry <= slack;
  if (edge === 'bottom') return m.y + ry >= state.board.h - slack;
  if (edge === 'left') return m.x - rx <= slack;
  return m.x + rx >= state.board.w - slack;
}

export const canEscape = (state: GameState, m: Model) => !m.dead && !m.escaped && !m.waiting && (exitEdges(state, m).some(e => atEdge(state, m, e)) || atBoats(state, m));

export interface MarkerAction {
  kind: 'pickUp' | 'uncover' | 'flip' | 'drop' | 'escape';
  marker?: string;
  label: string;
}

/** What a model can do with the markers around it right now, for its card. */
export function markerActions(state: GameState, m: Model): MarkerAction[] {
  if (m.dead || m.escaped) return [];
  const out: MarkerAction[] = [];
  for (const t of carriedBy(state, m)) out.push({ kind: 'drop', marker: t.id, label: `Drop the ${OBJECT_NAMES[t.object!]}` });
  if (canEscape(state, m)) out.push({ kind: 'escape', label: atBoats(state, m) ? 'Get into a boat and away' : carriesHobbit(state, m) ? 'Carry him off the table' : 'Leave the table here' });
  for (const t of onTable(state)) {
    if (!t.object || t.carrier || !touching(m, t)) continue;
    const name = OBJECT_NAMES[t.object];
    if (t.hidden && (t.object === 'heirloom' || t.object === 'decoy')) {
      if (!isCavalry(m) && !engaged(state, m)) out.push({ kind: 'flip', marker: t.id, label: 'Turn the marker over' });
    } else if (t.hidden && t.object === 'artefact') {
      if (!isCavalry(m) && t.tried?.[m.owner] !== state.turn) out.push({ kind: 'uncover', marker: t.id, label: `Dig up the ${name} (Intelligence test)` });
    } else if (canPickUp(state, m, t)) out.push({ kind: 'pickUp', marker: t.id, label: `Pick up the ${name}` });
  }
  return out;
}

export function canPickUp(state: GameState, m: Model, t: Terrain): boolean {
  if (!t.object || t.gone || t.carrier || t.hidden || !touching(m, t) || m.dead || m.escaped) return false;
  if (t.object === 'supply' || t.object === 'decoy' || t.object === 'rally' || t.object === 'campfire' || t.object === 'boat' || t.object === 'cocoon') return false;
  // A knocked-out Hobbit is carried off by the Uruk-hai, one apiece.
  if (t.object === 'hobbit') return !isCavalry(m) && mayCarryHobbit(state, m, t);
  // Rocks and oil are only for the defenders who brought them.
  if ((t.object === 'rocks' || t.object === 'oil') && t.side && t.side !== m.owner) return false;
  // Cavalry can't carry a Heavy Object; a raised ladder stays against its wall, and a ram takes two to lift.
  if (HEAVY.has(t.object) && isCavalry(m)) return false;
  if (t.object === 'ladder' && t.raised) return false;
  if (t.object === 'ram' && !helpers(state, m, t).length) return false;
  // A Demolition Charge is only hauled about by its own side.
  if (t.object === 'charge' && t.side && t.side !== m.owner) return false;
  if (t.object === 'ladder' || t.object === 'ram' || t.object === 'charge') return !carriedBy(state, m).length;
  // You can only carry your own wounded; nobody carries both Relics, and your own only once the enemy has had it.
  if (t.object === 'ally') return t.side === m.owner;
  if (t.object === 'relic') {
    if (carriedBy(state, m).some(c => c.object === 'relic')) return false;
    if (t.side === m.owner) return !!t.home && Math.hypot(t.x - t.home[0], t.y - t.home[1]) > 0.1;
  }
  // Warriors carry one Heirloom; heroes any number.
  if (t.object === 'heirloom' && !m.hero && carriedBy(state, m).some(c => c.object === 'heirloom')) return false;
  return true;
}

/** Where a carried marker sits: tucked against its carrier's base. */
export function carriedSpot(m: Model): Point {
  const { rx, ry } = halfExtents(m.base);
  return { x: m.x + rx * 0.7, y: m.y - ry * 0.7 };
}

/** Keeps carried markers with their carriers: they follow it, drop where it falls, and leave the table with it. */
export function syncCarried(state: GameState): GameState {
  let terrain = state.terrain;
  for (const t of Object.values(state.terrain)) {
    if (!t.carrier || t.gone) continue;
    const m = state.models[t.carrier];
    let next: Terrain;
    if (!m || m.dead) {
      const { carrier: _gone, ...rest } = t;
      next = rest;
    } else if (m.escaped) next = { ...t, gone: 'off', by: m.owner };
    else {
      const p = carriedSpot(m);
      if (Math.abs(p.x - t.x) < 1e-6 && Math.abs(p.y - t.y) < 1e-6) continue;
      next = { ...t, ...p };
    }
    terrain = { ...terrain, [t.id]: next };
  }
  return terrain === state.terrain ? state : { ...state, terrain };
}

/**
 * End phase effects of markers: a standing enemy touching a Supply destroys it, and a Wounded Ally is rescued when it
 * and a friend touching it are both wholly inside one of its side's Sanctuaries (within 12" of the far corners).
 */
export function markerUpkeep(state: GameState): GameState['terrain'] {
  let terrain = state.terrain;
  const models = Object.values(state.models).filter(m => !m.dead && !m.escaped);
  for (const t of onTable(state)) {
    if (t.object === 'supply') {
      const raider = models.find(m => m.owner !== t.side && touching(m, t) && !(m.hero && m.pending));
      if (raider) terrain = { ...terrain, [t.id]: { ...t, gone: 'destroyed', by: raider.owner } };
    }
    // An enemy that only moved this turn (no shooting, casting or fighting, and under no power) pulls down a
    // Rallying Point it ends the turn touching.
    if (t.object === 'rally') {
      const fought = new Set(state.flow.resolved.flatMap(k => k.split(',')));
      const raider = models.find(m => m.owner !== t.side && touching(m, t) && !state.flow.shot?.includes(m.id) && !state.flow.cast?.includes(m.id) && !fought.has(m.id) && !m.effects?.length);
      if (raider) terrain = { ...terrain, [t.id]: { ...t, gone: 'destroyed', by: raider.owner } };
    }
    if (t.object === 'ally' && t.side) {
      const zones = sanctuary(state, t.side);
      const friend = models.find(m => m.owner === t.side && touching(m, t) && zones.some(z => whollyIn([z], m) && markerWhollyIn(z, t)));
      if (friend) terrain = { ...terrain, [t.id]: { ...t, gone: 'rescued', by: friend.owner } };
    }
  }
  return terrain;
}

/** A side's Sanctuaries: within 12" of the two corners on the far edge. */
export function sanctuary(state: GameState, seat: Seat): Zone[] {
  const { w, h } = state.board;
  const y = seat === 'p1' ? 0 : h;
  return [
    { seat, shape: 'quarter-circle', cx: 0, cy: y, r: 12 },
    { seat, shape: 'quarter-circle', cx: w, cy: y, r: 12 },
  ];
}

const seatName = (state: GameState, s: Seat) => state.names[s] || (s === 'p1' ? 'Player 1' : 'Player 2');

/** A marker's name as players see it: face-down markers don't give away what they are. */
export function markerName(state: GameState, t: Terrain): string {
  if (!t.object) return '';
  if (t.hidden && (t.object === 'heirloom' || t.object === 'decoy')) return 'Face-down marker';
  if (t.object === 'cocoon') return t.gone === 'rescued' ? 'Bundle cut open: Dwarves freed' : t.gone ? 'Bundle cut open: a decoy' : 'Webbed bundle';
  if (t.hidden) return 'Buried Artefact';
  const name = OBJECT_NAMES[t.object];
  const owner = t.side ? `${seatName(state, t.side)}'s ${name}` : name;
  const carrier = t.carrier ? state.models[t.carrier] : undefined;
  return carrier ? `${owner}, carried by ${carrier.name}` : owner;
}

/** How a marker works, in a line or two for its tooltip. */
export function markerNotes(t: Terrain): string[] {
  switch (t.object) {
    case 'artefact':
      return t.hidden
        ? ['An infantry model touching it after moving can take an Intelligence test to dig it up. Each side gets one try a turn.']
        : ['A light object. Touch it to pick it up; a model can carry several.'];
    case 'relic':
      return ["A light object. Nobody carries both Relics, and you can't pick up your own until the enemy has moved it."];
    case 'heirloom':
    case 'decoy':
      return t.hidden
        ? ['Turn it over with an infantry model that is touching it and not in a fight. Decoys are taken away; the real Heirloom is picked up.']
        : ["A light object that can't be dropped. Warriors carry one, heroes any number."];
    case 'supply':
      return ['An enemy model touching it in the End phase destroys it.'];
    case 'ally':
      return ["A heavy object only its own side can carry. It is rescued when it and a friend touching it are both wholly inside one of your Sanctuaries (within 12\" of the enemy's corners) in the End phase."];
    case 'ladder':
    case 'ram':
      return fortressNotes(t);
    case 'rocks':
      return ['A light object for the defenders. A model touching it on the walls can drop it in the Shoot phase on an enemy within 1" of the walls or on a ladder, 8" away at most: 4+ to hit, then a Strength 6 hit.'];
    case 'oil':
      return ['A vat of boiling oil: a Heavy Object. Two defenders touching it on the walls pour it as a shot (4+ to hit): Strength 8 on the target and Strength 4 on everyone within 2". It runs dry on a 1 afterwards.'];
    case 'hobbit':
      return ['A Hobbit knocked out (as if Paralysed). The Uruk-hai carry him as a Heavy Object, and capture him by carrying him off the north, south or east edge. A friend ending the Good move touching him brings him round, Prone; otherwise he comes round on a 6 in the End phase.'];
    case 'boat':
      return ['The boats on the Anduin. Frodo, touching them, can get away in one.'];
    case 'cocoon':
      return ['Spun up tight by the Spiders: two of the three bundles hold Dwarves, one is a decoy. Bilbo touching it in the End phase cuts it open on a 3+.'];
    case 'campfire':
      return ["The Trolls' fire. Bert can roast a foe he beats within 6\" of it: it is put beside the fire and Set Ablaze."];
    case 'rally':
      return ['The defenders treat it as a banner, and their Courage tests within 6" get +1. An enemy that only moved this turn and ends it touching the Rallying Point pulls it down.'];
    default:
      return [];
  }
}
