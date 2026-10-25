// War beasts and chariots. A war beast (a Mûmak, a Great Beast, a Troll Brute) carries a Commander, and sometimes a
// Howdah full of warriors; it moves by Trampling straight through whatever is in its way, and a wounded one may
// Stampede. A chariot moves by a Chariot Charge, turning a little every 4". Both are Immovable Objects: never knocked
// down, trapped or pushed back, so those who beat them back away instead.
import { modelStats, type Catalog, type StatName } from './catalog.ts';
import { hitModel, mounted, mountOf } from './cavalry.ts';
import { distanceBetween, halfExtents, type Point } from './geometry.ts';
import { sideOf } from './gear.ts';
import { heightOf, insidePolygon, isDifficult, outline } from './sight.ts';
import { fallDamage } from './terrainTests.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

type D6 = () => number;
type Stats = Partial<Record<StatName, number>>;
const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const rulesOf = (catalog: Catalog | null | undefined, m: Model) => unitOf(catalog, m)?.rules ?? [];

const S = (Mv: number, Fv: number, Sv: number, St: number, D: number, A: number, W: number, C: number, I: number): Stats => ({ Mv, Fv, Sv, S: St, D, A, W, C, I });

/** The Commanders riding war beasts, from their profiles (our data only has the beast's). */
const COMMANDERS: [RegExp, Stats][] = [
  [/m[uû]mak/i, S(6, 4, 4, 4, 5, 2, 2, 6, 6)],
  [/great beast/i, S(6, 4, 5, 4, 5, 2, 2, 6, 7)],
  [/troll brute/i, S(6, 5, 5, 5, 6, 2, 2, 6, 7)],
];

/** A war beast's Howdah: its Defence and Wounds, how many warriors it holds and who, and whether it shoots itself. */
export interface Howdah {
  d: number;
  w: number;
  capacity: number;
  who?: RegExp;
  /** The Great Beast's Orc archers: as many shots as the Howdah has Wounds left, with this Shoot Value. */
  sv?: number;
}
const HOWDAHS: [RegExp, Howdah][] = [
  [/m[uû]mak/i, { d: 9, w: 5, capacity: 12, who: /haradrim warrior/i }],
  [/great beast/i, { d: 7, w: 9, capacity: 0, sv: 5 }],
];

/** The Impact Hits a war beast or chariot deals to each model it runs into: how many, and their Strength. */
const IMPACT: [RegExp, number, number][] = [
  [/m[uû]mak/i, 3, 9],
  [/great beast/i, 3, 6],
  [/troll brute/i, 2, 10],
  [/khandish/i, 2, 4],
  [/iron hills/i, 3, 6],
];

/** A Commander's own profile, for a model riding the war beast of this unit; undefined for anyone else. */
export function commanderStats(unitName: string, modelName: string | undefined): Stats | undefined {
  if (!modelName || !/commander/i.test(modelName)) return undefined;
  return COMMANDERS.find(([re]) => re.test(unitName))?.[1];
}

export const howdahFor = (unitName: string | undefined): Howdah | undefined => (unitName ? HOWDAHS.find(([re]) => re.test(unitName))?.[1] : undefined);

/** A war beast: the beast itself (not its Commander), marked as it was deployed, or one that Tramples. */
export const isWarBeast = (catalog: Catalog | null | undefined, m: Model) => m.beast === 'war' || (!m.beast && !m.aboard && rulesOf(catalog, m).includes('Trample') && !/commander|howdah/i.test(m.name));
/** A chariot: one that makes a Chariot Charge, or a hero riding one. */
export const isChariot = (catalog: Catalog | null | undefined, m: Model) => m.beast === 'chariot' || (!m.beast && rulesOf(catalog, m).includes('Chariot Charge')) || (mounted(m) && !!mountOf(m)?.chariot);
/** Never knocked down, trapped, Hurled or Barged, and never backs away. */
export const immovable = (catalog: Catalog | null | undefined, m: Model) => isWarBeast(catalog, m) || isChariot(catalog, m);
/** What it is as it's deployed: a war beast, a chariot, or neither. */
export function beastKind(catalog: Catalog | null | undefined, m: Model): Model['beast'] {
  const rules = rulesOf(catalog, m);
  if (rules.includes('Trample') && !/commander|howdah/i.test(m.name)) return 'war';
  if (rules.includes('Chariot Charge')) return 'chariot';
  return undefined;
}

/** The models riding a war beast: its Commander and any in its Howdah. */
export const riders = (state: GameState, beast: Model) => Object.values(state.models).filter(m => m.aboard === beast.id && !m.dead);
/** Its Commander: the hero riding it (if it fell, another rider takes its place). */
export const commanderOf = (state: GameState, beast: Model) => {
  const on = riders(state, beast);
  return on.find(m => m.hero) ?? on[0];
};

/** The Impact Hits for a war beast or chariot (a Mûmak with Tusk Weapons hits four times). */
export function impactHits(catalog: Catalog | null | undefined, m: Model): { n: number; s: number } {
  const name = mounted(m) && m.mount ? m.mount : (unitOf(catalog, m)?.name ?? m.name);
  const hit = IMPACT.find(([re]) => re.test(name));
  if (!hit) return { n: 2, s: modelStats(catalog, m)?.S ?? 4 };
  return { n: hit[1] + (m.options?.includes('Tusk Weapons') ? 1 : 0), s: hit[2] };
}

/** The Courage a war beast tests with: its Commander's, while it has one, else its own; Foul Temperament makes it worse. */
export function stampedeCourage(state: GameState, catalog: Catalog | null | undefined, beast: Model): number {
  const cmd = commanderOf(state, beast);
  const c = (cmd && modelStats(catalog, cmd)?.C) ?? modelStats(catalog, beast)?.C ?? 7;
  return c + (beast.options?.includes('Foul Temperament') ? 1 : 0);
}

/**
 * Puts each Commander on its war beast as an army is deployed: a Commander deployed with the beast of the same
 * profile rides it, in the middle of its base.
 */
export function boardCommanders(models: Record<string, Model>, added: string[]): Record<string, Model> {
  const out = { ...models };
  const fresh = added.map(id => out[id]).filter(Boolean);
  for (const cmd of fresh.filter(m => /commander/i.test(m.name) && !m.aboard && !m.dead)) {
    const beast = Object.values(out)
      .filter(b => b.beast === 'war' && b.owner === cmd.owner && b.profileId === cmd.profileId && !b.dead && !Object.values(out).some(o => o.aboard === b.id && /commander/i.test(o.name)))
      .sort((a, b) => Math.hypot(a.x - cmd.x, a.y - cmd.y) - Math.hypot(b.x - cmd.x, b.y - cmd.y))[0];
    if (beast) out[cmd.id] = { ...cmd, aboard: beast.id, x: beast.x, y: beast.y, rot: beast.rot };
  }
  return out;
}

/** Where a rider ends up when its war beast moves from `from` to `to` (turning with it). */
export function carried(from: Model, to: { x: number; y: number; rot: number }, rider: Model): { x: number; y: number; rot: number } {
  const a = ((to.rot - from.rot) * Math.PI) / 180;
  const dx = rider.x - from.x;
  const dy = rider.y - from.y;
  return { x: to.x + dx * Math.cos(a) - dy * Math.sin(a), y: to.y + dx * Math.sin(a) + dy * Math.cos(a), rot: (rider.rot + to.rot - from.rot + 360) % 360 };
}

/** Free spots inside a war beast's base for a rider to stand: a grid well inside the edge, the middle kept for its Commander. */
export function howdahSpot(state: GameState, beast: Model): Point | undefined {
  const { rx, ry } = halfExtents(beast.base);
  const taken = riders(state, beast);
  const a = (beast.rot * Math.PI) / 180;
  for (let row = -ry + 1.1; row <= ry - 1.1 + 1e-6; row += 1.05) {
    for (let col = -rx + 1.1; col <= rx - 1.1 + 1e-6; col += 1.05) {
      if (Math.hypot(col, row) < 0.9) continue;
      const p = { x: beast.x + col * Math.cos(a) - row * Math.sin(a), y: beast.y + col * Math.sin(a) + row * Math.cos(a) };
      if (!taken.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 0.95)) return p;
    }
  }
  return undefined;
}

/** Whether a friendly model may climb into a war beast's Howdah before the battle: one of the warriors it carries, while there's room. */
export function mayBoard(state: GameState, catalog: Catalog | null | undefined, m: Model, beast: Model): boolean {
  const howdah = howdahFor(unitOf(catalog, beast)?.name);
  if (!howdah?.capacity || !howdah.who || state.flow.started || m.owner !== beast.owner || m.aboard || m.beast || !howdah.who.test(m.name)) return false;
  return riders(state, beast).filter(r => !/commander/i.test(r.name)).length < howdah.capacity && distanceBetween(m, beast) <= 1;
}

// ——— Trample and Chariot Charge ———

const forward = (rot: number): Point => ({ x: Math.sin((rot * Math.PI) / 180), y: -Math.cos((rot * Math.PI) / 180) });
const headingTo = (from: Point, to: Point) => ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
const turnBetween = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
const STEP = 0.05;

/** The terrain a war beast or chariot can't drive through: woods (for a war beast), and anything over 2" tall for either. */
function stopsAt(t: Terrain, kind: 'war' | 'chariot'): 'blocked' | 'obstacle' | undefined {
  if (t.gone || t.kind === 'objective' || t.kind === 'road' || t.kind === 'bridge') return undefined;
  // A gate still standing stops either, whoever holds it.
  if (t.kind === 'gate') return kind === 'war' ? 'blocked' : 'obstacle';
  if (kind === 'war') {
    if (t.kind === 'wood') return 'blocked';
    if ((t.kind === 'wall' || t.kind === 'rock' || t.kind === 'cliff' || t.kind === 'building' || t.kind === 'ruin') && heightOf(t) > 2) return 'blocked';
    return undefined;
  }
  // A chariot crashes into an obstacle, and can't go up rocks or into buildings at all.
  if (t.kind === 'wall') return 'obstacle';
  if (t.kind === 'rock' || t.kind === 'cliff' || t.kind === 'building') return 'obstacle';
  return undefined;
}

/** Whether a base at this spot touches a piece of terrain: its edge or middle inside it, or a corner of it under the base. */
const onTerrain = (m: Model, poly: Point[]) => insidePolygon(poly, m) || basePoints(m).some(p => insidePolygon(poly, p)) || poly.some(p => insideBase(m, p));
function insideBase(m: Model, p: Point): boolean {
  const { rx, ry } = halfExtents(m.base);
  const a = (-m.rot * Math.PI) / 180;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return (lx / rx) ** 2 + (ly / ry) ** 2 <= 1;
}

/** Where a charge is heading: for a war beast, straight at the point; for a chariot, the legs it drives (a turn of up to 45° at the start and after each 4"). */
export interface ChargePlan {
  /** The facing it starts out on after its first pivot. */
  rot: number;
  /** How far it means to go: its whole Move for a war beast, up to the point picked for a chariot. */
  distance: number;
}

/** What a model in the way does: who is hit, how hard, and whether the charge goes on. */
interface Run {
  rolls: DiceRoll[];
  actions: Action[];
  at: { x: number; y: number; rot: number };
  /** Who it stopped against, now Engaged with it, which counts as charging them. */
  target?: string;
  /** It went off the board while Stampeding, and is lost with all aboard. */
  lost?: boolean;
  why?: string;
}

/**
 * Drives a war beast or chariot along its charge. Each model it runs into takes its Impact Hits (a rider and its
 * mount each); one slain is run over and the charge goes on, one that lives stops it, Engaged. A war beast stops at
 * woods, at anything over 2" tall and at the table edge (a Stampeding one runs off it and is lost), and two war beasts
 * that meet trade three Strength 8 hits. A chariot moves at half pace in difficult ground (and may be hurt by it),
 * crashes into obstacles (three Strength 6 hits on it), and turns up to 45° after each 4" towards where it's going.
 */
export function drive(state: GameState, catalog: Catalog | null | undefined, m: Model, toward: Point, opts: { d6: D6; uid: () => string; now: number; by: Seat; stampede?: boolean; freeTurn?: boolean; group: string; skipHits?: boolean; skip?: string[]; arriving?: boolean }): Run {
  const kind = isWarBeast(catalog, m) ? 'war' : 'chariot';
  const { d6, uid, now, by, group } = opts;
  const rolls: DiceRoll[] = [];
  const actions: Action[] = [];
  const push = (r: { rolls: DiceRoll[]; actions: Action[] }) => {
    rolls.push(...r.rolls);
    actions.push(...r.actions.filter(a => a.type !== 'rolled'));
  };
  const move = m.move;
  // A war beast turns to face any way; a chariot only 45° at a time.
  let rot = kind === 'war' || opts.freeTurn ? headingTo(m, toward) : m.rot + Math.max(-45, Math.min(45, turnBetween(m.rot, headingTo(m, toward))));
  const want = kind === 'war' ? move : Math.min(move, Math.hypot(toward.x - m.x, toward.y - m.y));
  const impact = impactHits(catalog, m);
  const hit = new Set<string>();
  const others = Object.values(state.models).filter(o => o.id !== m.id && !o.dead && !o.escaped && !o.waiting && !o.aboard && !opts.skip?.includes(o.id));
  const pieces = Object.values(state.terrain).map(t => ({ t, poly: outline(t), stop: stopsAt(t, kind) }));
  const slow = pieces.filter(p => kind === 'chariot' && isDifficult(p.t) && !p.stop);
  let pos = { x: m.x, y: m.y };
  let spent = 0;
  let travelled = 0;
  let nextTurn = 4;
  let roughRolled = false;
  const here = (p: Point, r = rot): Model => ({ ...m, x: p.x, y: p.y, rot: r });
  const reach = Math.max(halfExtents(m.base).rx, halfExtents(m.base).ry);
  const impacted = (o: Model) => {
    const st = modelStats(catalog, o);
    const slay = (n: number) => n >= o.wounds && !(o.hero && o.fate > 0);
    let wounds = 0;
    for (let i = 0; i < impact.n; i++) {
      const r = hitModel(o, st?.D ?? 4, impact.s, kind === 'war' ? `Trample (${m.name})` : `Chariot Charge (${m.name})`, d6, by, `${group}-${uid()}`, now, group, false, [m.id]);
      push(r);
      wounds += r.wounds;
    }
    // A rider and its mount are each hit.
    const steed = mounted(o) ? mountOf(o) : undefined;
    if (steed && steed.left > 0) for (let i = 0; i < impact.n; i++) push(hitModel(o, steed.d, impact.s, `Trample (${m.name})`, d6, by, `${group}-${uid()}`, now, group, true, [m.id]));
    return slay(wounds);
  };
  // Three Strength 8 (war beast) or Strength 6 (chariot) hits on it, as it crashes into something it can't get through.
  const crash = (s: number, why: string) => {
    const st = modelStats(catalog, m);
    for (let i = 0; i < 3; i++) push(hitModel(m, st?.D ?? 7, s, why, d6, by, `${group}-${uid()}`, now, group));
  };
  const done = (why?: string, target?: string, lost = false): Run => ({ rolls, actions, at: { x: pos.x, y: pos.y, rot }, ...(target ? { target } : {}), ...(lost ? { lost } : {}), ...(why ? { why } : {}) });
  while (spent < want - 1e-6) {
    // A chariot turns again after each full 4" it has driven.
    if (kind === 'chariot' && travelled >= nextTurn - 1e-6) {
      rot = rot + Math.max(-45, Math.min(45, turnBetween(rot, headingTo(pos, toward))));
      nextTurn += 4;
    }
    const dir = forward(rot);
    const next = { x: pos.x + dir.x * STEP, y: pos.y + dir.y * STEP };
    const body = here(next);
    // Off the edge of the table: a Stampede carries it off (and all aboard); otherwise it stops.
    if (next.x - reach < 0 || next.y - reach < 0 || next.x + reach > state.board.w || next.y + reach > state.board.h) {
      if (basePoints(body).some(p => p.x < 0 || p.y < 0 || p.x > state.board.w || p.y > state.board.h)) return opts.stampede ? done('It stampedes off the table.', undefined, true) : done('It reaches the edge of the table.');
    }
    // Terrain it can't get through.
    const wall = pieces.find(p => p.stop && onTerrain(body, p.poly));
    if (wall) {
      if (kind === 'chariot') crash(6, `Chariot crashes into ${wall.t.kind === 'wall' ? 'a wall' : 'terrain'}`);
      else if (opts.stampede) crash(8, 'Stampede into terrain');
      return done(kind === 'war' ? 'It can’t go on through that terrain.' : 'It crashes into an obstacle.');
    }
    // Models in its way.
    for (const o of others) {
      if (hit.has(o.id) || Math.abs(o.x - next.x) > reach + 2.5 || Math.abs(o.y - next.y) > reach + 2.5) continue;
      if (distanceBetween(body, o) > 0) continue;
      hit.add(o.id);
      if (immovable(catalog, o)) {
        // Two war beasts meet: each takes three Strength 8 hits. Anything else it hits that can't be moved takes its
        // Impact Hits, but either way the charge stops there.
        if (opts.arriving) return done(`It halts before ${o.name}.`);
        if (opts.skipHits) {
          // (Just looking where it would go.)
        } else if (kind === 'war' && isWarBeast(catalog, o)) {
          crash(8, `${m.name} meets ${o.name}`);
          for (let i = 0; i < 3; i++) push(hitModel(o, modelStats(catalog, o)?.D ?? 7, 8, `${m.name} meets ${o.name}`, d6, by, `${group}-${uid()}`, now, group, false, [m.id]));
        } else impacted(o);
        return done(`It runs into ${o.name}.`, o.owner !== m.owner ? o.id : undefined);
      }
      // Arriving from reserve, it can't trample anyone yet: it stops against them (short of them, coming on as
      // reinforcements, which may not charge).
      if (opts.arriving) return done(`It halts before ${o.name}.`);
      if (opts.skipHits || impacted(o) === false) return done(`${o.name} stands firm.`, o.owner !== m.owner ? o.id : undefined);
    }
    // Difficult ground halves a chariot's pace, and may hurt it.
    const rough = slow.some(p => onTerrain(body, p.poly));
    if (rough && !roughRolled) {
      roughRolled = true;
      const d = d6();
      rolls.push({ id: `${group}-${uid()}`, by, label: `${m.name} drives into difficult ground (1 hurts it)`.slice(0, 80), dice: [d], target: 2, model: m.id, at: now, group, note: d === 1 ? `${m.name} takes a wound.` : `${m.name} drives on.` });
      if (d === 1) actions.push({ type: 'wound', id: m.id, count: 1, how: 'other', group: `${group}-rough` });
    }
    spent += rough ? STEP * 2 : STEP;
    travelled += STEP;
    pos = next;
  }
  return done();
}

/** Points on the outline of a model's base, for the table-edge check. */
function basePoints(m: Model): Point[] {
  const { rx, ry } = halfExtents(m.base);
  const a = (m.rot * Math.PI) / 180;
  return Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    const lx = rx * Math.cos(t);
    const ly = ry * Math.sin(t);
    return { x: m.x + lx * Math.cos(a) - ly * Math.sin(a), y: m.y + lx * Math.sin(a) + ly * Math.cos(a) };
  });
}

/** The models pushed out of a war beast's way as it turns on the spot: each straight out from its middle, just clear. */
export function shoveAside(state: GameState, beast: Model, rot: number): { id: string; x: number; y: number }[] {
  const turned = { ...beast, rot };
  const out: { id: string; x: number; y: number }[] = [];
  for (const o of Object.values(state.models)) {
    if (o.id === beast.id || o.dead || o.escaped || o.waiting || o.aboard === beast.id || Math.hypot(o.x - beast.x, o.y - beast.y) > 6) continue;
    if (distanceBetween(turned, o) > 0) continue;
    const d = Math.hypot(o.x - beast.x, o.y - beast.y) || 1;
    const ux = (o.x - beast.x) / d;
    const uy = (o.y - beast.y) / d;
    let k = 0;
    while (k < 6 && distanceBetween(turned, { ...o, x: o.x + ux * k, y: o.y + uy * k }) <= 0.01) k += 0.05;
    out.push({ id: o.id, x: Math.round((o.x + ux * k) * 1000) / 1000, y: Math.round((o.y + uy * k) * 1000) / 1000 });
  }
  return out;
}

/** The enemies Engaged with a war beast or chariot before it moves, and whether together they're too strong for it to Trample. */
export function heldBy(catalog: Catalog | null | undefined, m: Model, touching: Model[]): { held: boolean; strength: number } {
  const strength = touching.reduce((a, e) => a + (modelStats(catalog, e)?.S ?? 3), 0);
  return { held: strength > (modelStats(catalog, m)?.S ?? 6), strength };
}

/**
 * Riders who fall with a war beast or its Howdah: they take Falling Damage from its height and are left Prone, on the
 * spot (inside the fallen beast's base) or beside it.
 */
export function ridersFall(state: GameState, catalog: Catalog | null, beast: Model, d6: D6, uid: () => string, now: number, by: Seat, why: string): { rolls: DiceRoll[]; actions: Action[] } {
  const rolls: DiceRoll[] = [];
  const group = `wb-${uid()}`;
  const push = (label: string, dice: number[], extra?: Partial<DiceRoll>) => rolls.push({ id: `${group}-${rolls.length}`, by, label: label.slice(0, 80), dice, at: now, group, ...extra });
  const actions: Action[] = [];
  const drop = Math.max(3, halfExtents(beast.base).ry);
  for (const r of riders(state, beast)) {
    // The Great Beast's Orc Commander goes down with it.
    if (beast.dead && /great beast/i.test(unitOf(catalog, beast)?.name ?? '') && /commander/i.test(r.name)) {
      actions.push({ type: 'wound', id: r.id, count: r.wounds, how: 'other', group: `${group}-${r.id}` });
      continue;
    }
    push(`${r.name} falls from ${beast.name} (${why})`, []);
    actions.push({ type: 'affect', id: r.id, patch: { aboard: '', prone: true } }, ...fallDamage(catalog, r, drop, d6, push, `${group}-${r.id}`));
  }
  return { rolls, actions };
}

/** What the game rolls by itself for war beasts: a Courage test for each wound a beast took, and riders falling from a slain beast or a smashed Howdah. */
export function beastTests(state: GameState, catalog: Catalog | null, d6: D6, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const b of Object.values(state.models)) {
    if (b.beast !== 'war') continue;
    if (b.dead || b.howdahWounds === 0) {
      if (!riders(state, b).length) continue;
      const fall = ridersFall(state, catalog, b, d6, uid, now, b.owner, b.dead ? 'it is slain' : 'its Howdah is destroyed');
      out.push(...fall.rolls.map(roll => ({ type: 'rolled', roll }) as Action), ...fall.actions);
      continue;
    }
    if (!b.stampedeTests) continue;
    const c = stampedeCourage(state, catalog, b);
    let failed = false;
    for (let i = 0; i < b.stampedeTests; i++) {
      const dice = [d6(), d6()];
      const pass = dice[0] + dice[1] >= c;
      failed ||= !pass;
      out.push({ type: 'rolled', roll: { id: `st-${uid()}`, by: b.owner, label: `Stampede test: ${b.name} is wounded`.slice(0, 80), dice, sum: c, model: b.id, at: now, note: pass ? `${b.name} stays under control.` : `${b.name} will Stampede as it next moves.` } });
    }
    out.push({ type: 'affect', id: b.id, patch: { stampedeTests: 0, ...(failed ? { stampede: true } : {}) } });
  }
  return out;
}

/** Whether a war beast has rolls the game should make now (see beastTests). */
export const beastTestsDue = (state: GameState) => Object.values(state.models).some(b => b.beast === 'war' && ((!b.dead && !!b.stampedeTests) || ((b.dead || b.howdahWounds === 0) && riders(state, b).length > 0)));

/**
 * Which side backs away when an Immovable Object loses a fight against another (a war beast or chariot on both
 * sides): the smaller model's side; for two the same size, a roll: 1-3 the Evil side, 4-6 the Good.
 */
export function biggerHolds(catalog: Catalog | null | undefined, a: Model, b: Model, d6: D6): { backs: 'a' | 'b'; roll?: number } {
  const size = (m: Model) => m.base.w * m.base.h;
  if (size(a) !== size(b)) return { backs: size(a) < size(b) ? 'a' : 'b' };
  const roll = d6();
  const evil = sideOf(catalog, a) === 'Evil' ? 'a' : 'b';
  return { backs: roll <= 3 ? evil : evil === 'a' ? 'b' : 'a', roll };
}
