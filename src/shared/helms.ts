import { entriesFor, modelStats, type Catalog } from './catalog.ts';
import { mounted, mountName, mountProfile } from './cavalry.ts';
import { courageOf } from './courage.ts';
import { breakable, isGate, ladderable, nearestEdge, overThe } from './fortress.ts';
import { basePerimeter, distanceToBase, type Point } from './geometry.ts';
import { canActivate, heroicsSettled } from './heroics.ts';
import { engineFor, firingCrew, inArc } from './siege.ts';
import { CULVERT_ID, DEEPING, GATE_ANGLE, inHornburg } from './helmsMap.ts';
import { engaged, foughtThisTurn } from './movement.ts';
import { castModel, radius, seatOf } from './narrative.ts';
import { fromMarker, onTable, touching as touchingMarker } from './objects.ts';
import { distanceToTerrain, heightOf, insidePolygon, outline } from './sight.ts';
import { fallDamage } from './terrainTests.ts';
import { woundNeed, formatNeed } from './rules.ts';
import type { Action, DiceRoll, GameState, Model, Seat, Terrain } from './types.ts';

// Helm's Deep: the scenario's own rules, in our own words. The Relief Force rides on at the end of the Good side's
// tenth move, Good heroes near the gate may Ride Out from turn 8, a Demolition Charge set off by the culvert blows the
// Deeping Wall apart, and when the battle's turns run out seven objectives decide it. The Uruk-hai Demolition Teams'
// charges are here too, as only this scenario has them.

export const isHelms = (state: Pick<GameState, 'narrative'>) => state.narrative?.id === 'helms-deep';
const alive = (m: Model) => !m.dead && !m.waiting && !m.escaped;
const unitOf = (catalog: Catalog | null | undefined, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
type D6 = () => number;
type Push = (label: string, dice: number[], extra?: Partial<DiceRoll>) => DiceRoll | void;

/** How many turns this battle lasts. */
export const helmsTurns = (state: Pick<GameState, 'narrative'>) => state.narrative?.turns ?? 15;

// ——— The objectives ———

export type Holder = 'good' | 'evil' | null;
export interface HelmsObjective {
  key: string;
  name: string;
  holder: Holder;
  /** How it stands now, in a few words. */
  detail: string;
}

/** The heroes of Helm's Deep whose fate is one of the objectives. */
export const HEROES = ['aragorn', 'legolas', 'gimli', 'theoden', 'gamling', 'haldir', 'haleth', 'aldor'];

/** Whether a model's whole base is inside a piece of terrain. */
function whollyOn(m: Model, t: Terrain): boolean {
  const poly = outline(t);
  return insidePolygon(poly, m) && basePerimeter(m, 16).every(p => insidePolygon(poly, p));
}

/** The causeway up to the gate. */
export const causeway = (state: GameState) => Object.values(state.terrain).find(t => t.id === 'n-causeway');
/** The stretch of the Deeping Wall by the culvert, while it stands. */
export const culvertWall = (state: GameState) => state.terrain[`n-${CULVERT_ID}`];
/** Whether the Deeping Wall has been destroyed. */
export const deepingDown = (state: GameState) => !!state.narrative?.breach;

/** The seven objectives as they stand right now. */
export function helmsObjectives(state: GameState): HelmsObjective[] {
  const good = seatOf(state, 'good');
  const models = Object.values(state.models).filter(alive);
  const side = (m: Model): 'good' | 'evil' => (m.owner === good ? 'good' : 'evil');
  const most = (list: Model[]): { holder: Holder; detail: string } => {
    const g = list.filter(m => side(m) === 'good').length;
    const e = list.length - g;
    return { holder: g > e ? 'good' : e > g ? 'evil' : null, detail: `Good ${g}, Evil ${e}` };
  };
  const theoden = castModel(state, 'theoden');
  const eomer = castModel(state, 'eomer');
  const heroes = HEROES.map(k => castModel(state, k)).filter((m): m is Model => !!m);
  const standing = heroes.filter(m => !m.dead).length;
  const fallen = heroes.length - standing;
  const captains = Object.values(state.models).filter(m => m.cast === 'uruk-captain');
  const slain = captains.filter(m => m.dead).length;
  const road = causeway(state);
  return [
    { key: 'theoden', name: 'Théoden', holder: theoden?.dead ? 'evil' : 'good', detail: theoden?.dead ? 'Slain' : 'Alive' },
    { key: 'wall', name: 'The Deeping Wall', holder: deepingDown(state) ? 'evil' : 'good', detail: deepingDown(state) ? 'Destroyed' : 'Standing' },
    { key: 'hornburg', name: 'The Hornburg', ...most(models.filter(m => inHornburg(m, radius(m)))) },
    { key: 'causeway', name: 'The causeway', ...most(road ? models.filter(m => whollyOn(m, road)) : []) },
    { key: 'heroes', name: "The heroes of Helm's Deep", holder: standing > fallen ? 'good' : fallen > standing ? 'evil' : null, detail: `${standing} alive, ${fallen} slain` },
    { key: 'eomer', name: 'Éomer', holder: eomer?.dead ? 'evil' : 'good', detail: eomer?.dead ? 'Slain' : 'Alive' },
    { key: 'captains', name: 'The Uruk-hai Captains', holder: slain >= 3 ? 'good' : captains.length - slain >= 3 ? 'evil' : null, detail: `${slain} of ${captains.length} slain` },
  ];
}

/** Each side's tally of objectives held. */
export function helmsTally(state: GameState): { good: number; evil: number } {
  const o = helmsObjectives(state);
  return { good: o.filter(x => x.holder === 'good').length, evil: o.filter(x => x.holder === 'evil').length };
}

/** Over once the chosen turns are done (as the last End phase begins), or at once if a side is wiped out. */
export function helmsWinner(state: GameState): Seat | 'draw' | null {
  const good = seatOf(state, 'good');
  const evil = seatOf(state, 'evil');
  if (!good || !evil) return null;
  const left = (s: Seat) => Object.values(state.models).filter(m => m.owner === s && !m.dead && !m.escaped && !m.crewOf).length;
  if (!left(good)) return evil;
  if (!left(evil)) return good;
  if (state.turn < helmsTurns(state) || (state.turn === helmsTurns(state) && state.phase !== 'end')) return null;
  const t = helmsTally(state);
  return t.good > t.evil ? good : t.evil > t.good ? evil : 'draw';
}

// ——— "Look to my coming" ———

/** The Relief Force's arrival: at the end of the Good side's 10th Move phase. */
export const RELIEF_TURN = 10;
/** They ride on from the eastern half of the south edge. */
export const RELIEF_SPAN: [number, number] = [24, 48];
export const reliefWaiting = (state: GameState) => {
  const good = seatOf(state, 'good');
  return Object.values(state.models).filter(m => m.owner === good && m.waiting && !m.dead);
};
/** Where on the south edge they come on: the Good player's choice, the middle of the eastern half unless they say. */
export const reliefPoint = (state: GameState) => Math.min(RELIEF_SPAN[1], Math.max(RELIEF_SPAN[0], state.narrative?.relief ?? 36));

/** Whether ending the Good side's move now must wait for the Relief Force to come on first (see reducer endActivation). */
export function reliefPending(state: GameState, seat: Seat): boolean {
  return isHelms(state) && state.phase === 'move' && seat === seatOf(state, 'good') && state.turn === RELIEF_TURN && state.flow.entering?.turn !== state.turn && reliefWaiting(state).length > 0;
}

/** The Good side has asked to end its 10th move: the Relief Force arrives now. */
export function reliefDue(state: GameState): boolean {
  return isHelms(state) && state.flow.started && state.phase === 'move' && !state.result && state.flow.reinforce === seatOf(state, 'good') && state.flow.entering?.turn !== state.turn && reliefWaiting(state).length > 0;
}

export function reliefArrives(state: GameState, uid: () => string, now = Date.now()): Action[] {
  const seat = seatOf(state, 'good')!;
  const coming = reliefWaiting(state);
  const x = reliefPoint(state);
  const roll: DiceRoll = { id: `n-${uid()}`, by: seat, label: '"Look to my coming": the Relief Force arrives', dice: [], note: `Éomer, Gandalf and the Riders of Rohan ride on from the south edge, ${Math.round(x)}" from the west corner, and may charge.`, at: now };
  return [{ type: 'rolled', roll }, { type: 'entering', seat, ids: coming.map(m => m.id), from: [x, state.board.h], span: RELIEF_SPAN, charge: true }];
}

/** Whether the Good player may still choose where the Relief Force comes on. */
export const mayChooseRelief = (state: GameState, seat: Seat) => isHelms(state) && seat === seatOf(state, 'good') && !state.result && state.turn <= RELIEF_TURN && reliefWaiting(state).length > 0 && state.flow.entering?.turn !== state.turn;

// ——— Ride Out ———

/** From turn 8 the heroes who could ride may mount up by the gate: each on the horse the books give him. */
export const RIDE_OUT_TURN = 8;
const RIDE_OUT: Record<string, { unit: string; option: string }> = {
  theoden: { unit: '[ride-out] theoden', option: 'Snowmane' },
  aragorn: { unit: '[ride-out] aragorn-strider', option: 'Brego' },
  gamling: { unit: '[ride-out] gamling', option: 'Horse' },
  legolas: { unit: '[ride-out] legolas', option: 'Horse' },
};
// (Théoden rides plain Snowmane in the Ride Out list as the books print it: its armoured barding costs points, which
// a narrative scenario doesn't spend.)
const SNOWMANE_UNIT = '[kingdom-of-rohan] theoden';

/** The Hornburg's great gate (standing or broken down; its ground is where the riders gather either way). */
export const helmsGate = (state: GameState) => state.terrain['n-gate'];

/** Why a hero can't Ride Out now; unset if it can. */
export function rideOutBlocked(state: GameState, m: Model | undefined): string | undefined {
  if (!m || !isHelms(state) || !alive(m) || !m.cast || !RIDE_OUT[m.cast] || m.owner !== seatOf(state, 'good')) return 'Not one of the riders of Helm’s Deep';
  if (!state.flow.started || state.result) return 'Only during the battle';
  if (state.turn < RIDE_OUT_TURN) return `Not before turn ${RIDE_OUT_TURN}`;
  if (mounted(m) || m.mount) return 'Already mounted';
  const gate = helmsGate(state);
  if (!gate || distanceToTerrain(m, gate) > 6) return 'Must be within 6" of the gate';
  // (Mounting up is done before the hero sets off: in the Priority phase, or in the Move phase before it moves.)
  if (state.phase !== 'priority' && state.phase !== 'move') return 'Only before it moves';
  if (state.phase === 'move' && (state.flow.starts?.[m.id] || state.flow.activated?.includes(m.id) || state.flow.stopped?.includes(m.id))) return 'Only before it moves';
  if (engaged(state, m)) return 'Not while it is fighting';
  return undefined;
}

/** The hero on his horse: its profile, base and Move as the books give them with that mount. */
export function rideOut(state: GameState, catalog: Catalog | null, m: Model, uid: () => string, now = Date.now()): Action[] | null {
  if (rideOutBlocked(state, m) || !catalog) return null;
  const ride = RIDE_OUT[m.cast!];
  const id = m.cast === 'theoden' ? SNOWMANE_UNIT : ride.unit;
  const unit = catalog.units[id];
  const option = unit?.options.find(o => o.name === ride.option);
  if (!unit || !option) return null;
  const e = entriesFor(id, unit, [option.id], 1)[0];
  const mount = mountName(unit, [option.name]);
  if (!e || !mount) return null;
  const roll: DiceRoll = { id: `n-${uid()}`, by: m.owner, label: `Ride Out: ${m.name} mounts ${mount === 'Horse' ? 'a horse' : mount}`, dice: [], model: m.id, at: now };
  return [
    { type: 'rolled', roll },
    { type: 'updateModel', id: m.id, patch: { base: e.base ?? m.base, move: e.move ?? 10, mount, mountWounds: mountProfile(mount)?.w ?? 1, options: [...new Set([...(m.options ?? []), option.name])] } },
  ];
}

// ——— Demolition Charges ———

export const CHARGE = { d: 7, w: 3, blast: 2 };
export const charges = (state: GameState) => onTable(state).filter(t => t.object === 'charge');

/** Within 2" of the charge: measured from the edge of its base. */
const inBlast = (charge: Terrain, m: Model) => fromMarker(m, charge) <= CHARGE.blast;
/** Things that aren't models a blast can hurt: gates and doors, siege towers, barricades and other charges. */
const blastTerrain = (state: GameState, charge: Terrain) =>
  Object.values(state.terrain).filter(t => t.id !== charge.id && !t.gone && (isGate(t) || t.kind === 'tower' || !!t.barricade || t.object === 'charge') && pieceGap(t, charge) <= CHARGE.blast);
/** How far a charge is from a piece of terrain, edge to edge. */
const pieceGap = (t: Terrain, charge: Terrain) => (t.kind === 'objective' ? Math.max(0, Math.hypot(t.x - charge.x, t.y - charge.y) - t.w / 2 - charge.w / 2) : Math.max(0, distanceToTerrainPoint(t, charge) - charge.w / 2));
function distanceToTerrainPoint(t: Terrain, p: Point): number {
  const poly = outline(t);
  if (insidePolygon(poly, p)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy)));
  }
  return best;
}

/** The culvert itself: where the Deeping Stream passes under the wall. */
export const CULVERT: Point = { x: DEEPING.corner.x, y: DEEPING.culvert };
/** A charge going off within 3" of the culvert brings that stretch of the Deeping Wall down. */
export const byCulvert = (state: GameState, charge: Terrain) => isHelms(state) && !deepingDown(state) && Math.max(0, Math.hypot(charge.x - CULVERT.x, charge.y - CULVERT.y) - charge.w / 2) <= 3;

/**
 * Whether a blast here would be worth it, as a charge may only be set off if so: it would hit a Siege Target (a large
 * gate, a building, a large siege engine or war beast, or here the Deeping Wall by the culvert) or two or more enemies.
 */
export function worthBlowing(state: GameState, charge: Terrain, seat: Seat): boolean {
  const hit = Object.values(state.models).filter(m => alive(m) && inBlast(charge, m));
  if (hit.filter(m => m.owner !== seat).length >= 2) return true;
  if (hit.some(m => m.owner !== seat && (m.beast === 'war' || m.siege === 'large'))) return true;
  if (byCulvert(state, charge)) return true;
  return Object.values(state.terrain).some(t => !t.gone && t.side !== seat && ((isGate(t) && (t.door ?? 'castle') === 'castle') || t.kind === 'building') && pieceGap(t, charge) <= CHARGE.blast);
}

/** Why this model can't try to set this charge off now; unset if it can. */
export function detonateBlocked(state: GameState, m: Model | undefined, t: Terrain | undefined): string | undefined {
  if (!m || !alive(m) || !t || t.gone || t.object !== 'charge') return 'Nothing to set off';
  if (t.side && t.side !== m.owner) return 'Not your side’s charge';
  if (!state.flow.started || state.phase !== 'fight' || !heroicsSettled(state)) return 'Only in the Fight phase, after any Heroic Combats';
  if (!touchingMarker(m, t)) return 'Must be touching it';
  if (engaged(state, m) || foughtThisTurn(state).has(m.id)) return 'Not while it is fighting';
  if (state.flow.breached?.includes(m.id) || m.siege || m.prone) return 'Not free to act';
  if (!worthBlowing(state, t, m.owner)) return 'Only to hit a Siege Target or at least two enemies';
  return undefined;
}

/** The charges a model could set off now, for its card. */
export const detonateOptions = (state: GameState, m: Model) => charges(state).filter(t => !detonateBlocked(state, m, t));

/**
 * A model tries to set a charge off: a Courage test, then with a torch it goes off, and without one only on a 6.
 * Going off means a roll on the Detonation Table.
 */
export function resolveDetonate(state: GameState, catalog: Catalog | null, seat: Seat, modelId: string, chargeId: string, d6: D6, uid: () => string, now: number): Action[] | null {
  const m = state.models[modelId];
  const t = state.terrain[chargeId];
  if (!m || m.owner !== seat || detonateBlocked(state, m, t)) return null;
  const group = `g-${uid()}`;
  const rolls: DiceRoll[] = [];
  const push: Push = (label, dice, extra = {}) => {
    const r: DiceRoll = { id: `${group}-${rolls.length}`, by: seat, label: label.slice(0, 80), dice, at: now, group, ...extra };
    rolls.push(r);
    return r;
  };
  const out: Action[] = [{ type: 'breached', id: m.id }];
  const need = courageOf(state, catalog, m);
  const dice = [d6(), d6()];
  const pass = dice[0] + dice[1] >= need;
  push(`${m.name} tries to set off the Demolition Charge: Courage ${need}+`, dice, { sum: need, model: m.id, note: pass ? (m.torch ? 'Passed: the fuse is lit.' : 'Passed, but without a torch it needs a 6.') : 'Failed: it doesn’t go off.' });
  if (pass) {
    let goes = !!m.torch;
    if (!m.torch) {
      const k = d6();
      goes = k === 6;
      push('Without a torch: a 6 to set it off', [k], { target: 6, model: m.id, note: goes ? 'It goes off!' : 'Nothing happens.' });
    }
    if (goes) explode(state, catalog, t!, seat, d6, push, out, group, new Set());
  }
  return [...rolls.map((r): Action => ({ type: 'rolled', roll: r })), ...out];
}

/**
 * A charge goes off: a roll on the Detonation Table. A 1 is a dud and it's simply removed; 2-5 and every model within
 * 2" takes D6 Wounds (riders and mounts both), and a 6 makes that 2D6. Gates, towers, barricades and other charges in
 * the blast take the same (another charge goes off on a 4+ for each Wound), and by the culvert the Deeping Wall falls.
 */
export function explode(state: GameState, catalog: Catalog | null, t: Terrain, seat: Seat, d6: D6, push: Push, out: Action[], group: string, done: Set<string>): void {
  if (done.has(t.id)) return;
  done.add(t.id);
  const table = d6();
  out.push({ type: 'updateTerrain', id: t.id, patch: { gone: 'destroyed', by: seat, carrier: '' } });
  if (table === 1) {
    push('Detonation Table', [table], { note: 'A dud: the charge is faulty and is removed.' });
    return;
  }
  const dice = table === 6 ? [d6(), d6()] : [d6()];
  const n = dice.reduce((a, b) => a + b, 0);
  push('Detonation Table', [table], { note: table === 6 ? 'Titanic Explosion: 2D6 Wounds on everything within 2".' : 'Instant Reaction: D6 Wounds on everything within 2".' });
  push(`The blast: ${n} Wound${n === 1 ? '' : 's'} on each model within 2"`, dice, {});
  const hit = Object.values(state.models).filter(m => alive(m) && inBlast(t, m) && !m.aboard);
  for (const m of hit) {
    out.push({ type: 'wound', id: m.id, count: n, how: 'other', group: `${group}-${t.id}` });
    if (mounted(m) && m.mount) out.push({ type: 'wound', id: m.id, count: n, how: 'other', mount: true, group: `${group}-${t.id}` });
  }
  for (const p of blastTerrain(state, t)) {
    if (p.object === 'charge') {
      // Each Wound another charge takes sets it off on a 4+.
      if (done.has(p.id)) continue;
      const rolls = Array.from({ length: Math.min(n, CHARGE.w) }, d6);
      const off = rolls.some(x => x >= 4);
      push('The next charge: a 4+ for each Wound sets it off', rolls, { target: 4, note: off ? 'It goes off too!' : 'It breaks without going off.' });
      if (off) explode(state, catalog, p, seat, d6, push, out, group, done);
      else out.push({ type: 'updateTerrain', id: p.id, patch: { gone: 'destroyed', by: seat, carrier: '' } });
      continue;
    }
    const b = breakable(p);
    if (!b) continue;
    const left = Math.max(0, b.left - n);
    out.push({ type: 'updateTerrain', id: p.id, patch: left ? { wounds: left } : { wounds: 0, gone: 'destroyed', by: seat } });
  }
  if (byCulvert(state, t)) breachDeeping(state, catalog, seat, d6, push, out, group);
}

/**
 * The Deeping Wall by the culvert is blown apart: everyone on that stretch (defenders along it and attackers on ladders
 * against it) takes a Strength 9 hit, then falls from the top of the wall; the ladders against it come down too.
 */
export function breachDeeping(state: GameState, catalog: Catalog | null, seat: Seat, d6: D6, push: Push, out: Action[], group: string): void {
  const wall = culvertWall(state);
  if (!wall || deepingDown(state)) return;
  push('The Deeping Wall is breached!', [], { note: 'The stretch by the culvert is blown apart.' });
  // (The stretch is taken off the table: the breach is open ground.)
  out.push({ type: 'narrativeNote', breach: state.turn }, { type: 'removeTerrain', id: wall.id });
  const ladders = onTable(state).filter(l => l.object === 'ladder' && l.raised === wall.id);
  const on = Object.values(state.models).filter(m => alive(m) && (distanceToTerrain(m, wall) <= 0.25 || ladders.some(l => touchingMarker(m, l))));
  for (const m of on) {
    const need = woundNeed(9, modelStats(catalog, m)?.D ?? 4);
    if (need) {
      const dice = [d6()];
      const follow = need.then && dice[0] >= need.target ? [d6()] : undefined;
      const hurt = need.then ? !!follow && follow[0] >= need.then : dice[0] >= need.target;
      push(`Strength 9 hit on ${m.name} (${formatNeed(need)})`, dice, { target: need.target, against: m.id, ...(need.then ? { then: need.then, follow } : {}), note: hurt ? `${m.name} is wounded.` : `${m.name} survives the blast.` });
      if (hurt) out.push({ type: 'wound', id: m.id, count: 1, how: 'other', group: `${group}-wall` });
    }
    out.push({ type: 'affect', id: m.id, patch: { prone: true } }, ...fallDamage(catalog, m, heightOf(wall), d6, (l, d, x) => void push(l, d, x), `${group}-fall`));
  }
  for (const l of ladders) out.push({ type: 'updateTerrain', id: l.id, patch: { gone: 'destroyed', by: seat } });
}

/**
 * Struck or shot, a charge rolls a D6 for each Wound it takes and goes off on a 6 (see breach.ts); losing its last
 * Wound without going off, it breaks and is removed.
 */
export function chargeWounded(state: GameState, catalog: Catalog | null, t: Terrain, wounds: number, seat: Seat, d6: D6, push: Push, out: Action[], group: string): boolean {
  if (!wounds) return false;
  const rolls = Array.from({ length: wounds }, d6);
  const off = rolls.includes(6);
  push('Does the Demolition Charge go off? (a 6 for each Wound)', rolls, { target: 6, note: off ? 'It goes off!' : 'Not this time.' });
  if (off) explode(state, catalog, t, seat, d6, push, out, group, new Set());
  return off;
}

/**
 * As the turn ends, an enemy touching a charge that did nothing this turn but move (no shooting, no spell, no fight,
 * and no power on it) disables it.
 */
export function chargeSabotage(state: GameState, uid: () => string, now = Date.now()): Action[] {
  if (state.phase !== 'end' || !state.flow.started || state.result) return [];
  const fought = foughtThisTurn(state);
  const out: Action[] = [];
  for (const t of charges(state)) {
    const by = Object.values(state.models).find(e => alive(e) && e.owner !== t.side && touchingMarker(e, t) && !state.flow.shot?.includes(e.id) && !state.flow.cast?.includes(e.id) && !fought.has(e.id) && !(e.effects ?? []).some(x => x.turn === state.turn));
    if (!by) continue;
    out.push(
      { type: 'rolled', roll: { id: `dis-${uid()}`, by: by.owner, label: `${by.name} disables a Demolition Charge`.slice(0, 80), dice: [], model: by.id, at: now, note: 'The charge is made safe and removed.' } },
      { type: 'updateTerrain', id: t.id, patch: { gone: 'destroyed', by: by.owner, carrier: '' } },
    );
  }
  return out;
}

/** Whether the charge a model carries or touches could matter for the computer: how far the culvert is from it. */
export const culvertDistance = (p: Point) => Math.hypot(p.x - CULVERT.x, p.y - CULVERT.y);

/** Where the gate's riders gather: just inside it. */
export const gateInside = (): Point => ({ x: 23.6 * Math.cos((GATE_ANGLE * Math.PI) / 180) - 2.5, y: 23.6 * Math.sin((GATE_ANGLE * Math.PI) / 180) - 0.8 });

export { distanceToBase };

// ——— Raise the Ladders! (the Assault Ballista) ———

/**
 * The Siege Ladders an Assault Ballista could raise with a grappling shot: its own side's, lying (not carried) within
 * 6" of the foot of a wall, where the point of the battlements above it is in range (12"-60") and in its arc.
 */
export function raiseLadderTargets(state: GameState, catalog: Catalog | null, engine: Model): { ladder: Terrain; wall: Terrain; at: Point }[] {
  if (!engine.siege || engine.dead || !/assault ballista/i.test(unitOf(catalog, engine)?.name ?? engine.name)) return [];
  if (!state.flow.started || state.phase !== 'shoot' || !canActivate(state, engine.owner) || state.flow.shot?.includes(engine.id) || !firingCrew(state, catalog, engine)) return [];
  const e = engineFor('Isengard Assault Ballista')!;
  const out: { ladder: Terrain; wall: Terrain; at: Point }[] = [];
  for (const l of onTable(state).filter(t => t.object === 'ladder' && !t.raised && !t.carrier && t.side === engine.owner)) {
    const wall = Object.values(state.terrain)
      .filter(w => ladderable(w) && w.sheer && distanceToTerrainPoint(w, l) - l.w / 2 <= 6)
      .sort((a, b) => distanceToTerrainPoint(a, l) - distanceToTerrainPoint(b, l))[0];
    if (!wall) continue;
    const at = nearestEdge(wall, l);
    const d = Math.hypot(at.x - engine.x, at.y - engine.y);
    if (d < e.min || d > e.max || !inArc(engine, at)) continue;
    out.push({ ladder: l, wall, at });
  }
  return out;
}

/**
 * Raise the Ladders!: instead of shooting to kill, the ballista fires a grapple at the battlements above a ladder. On a
 * hit (its crew's Shoot value) the ladder is pulled up against the wall there, and one model that was carrying it (here,
 * one touching it) is placed at the top: over the wall, or in contact with the defender standing there (a charge).
 */
export function resolveRaiseLadder(state: GameState, catalog: Catalog | null, seat: Seat, engineId: string, ladderId: string, d6: D6, uid: () => string, now: number): Action[] | null {
  const engine = state.models[engineId];
  if (!engine || engine.owner !== seat) return null;
  const target = raiseLadderTargets(state, catalog, engine).find(t => t.ladder.id === ladderId);
  const crew = firingCrew(state, catalog, engine);
  if (!target || !crew) return null;
  const group = `s-${uid()}`;
  const need = Math.min(6, crew.sv + (state.flow.turned?.includes(engine.id) ? 1 : 0));
  const hit = d6();
  const out: Action[] = [{ type: 'rolled', roll: { id: `${group}-0`, by: seat, label: `${engine.name}: Raise the Ladders! (${need}+)`, dice: [hit], target: need, model: engine.id, at: now, group, note: hit >= need ? 'The grapple bites: the ladder swings up against the wall.' : 'The grapple misses.' } }];
  if (hit < need) return out;
  const { ladder, wall, at } = target;
  out.push({ type: 'updateTerrain', id: ladder.id, patch: { x: at.x, y: at.y, raised: wall.id, side: seat } });
  // Its bearer goes up with it.
  const bearer = Object.values(state.models)
    .filter(m => m.owner === seat && alive(m) && !m.siege && !mounted(m) && touchingMarker(m, ladder) && !engaged(state, m))
    .sort((a, b) => Math.hypot(a.x - ladder.x, a.y - ladder.y) - Math.hypot(b.x - ladder.x, b.y - ladder.y))[0];
  if (!bearer) return out;
  const r = radius(bearer);
  const top = overThe(wall, at, r + 0.05);
  const foe = Object.values(state.models).filter(m => m.owner !== seat && alive(m) && Math.hypot(m.x - top.x, m.y - top.y) < radius(m) + r).sort((a, b) => Math.hypot(a.x - top.x, a.y - top.y) - Math.hypot(b.x - top.x, b.y - top.y))[0];
  let spot = top;
  if (foe) {
    // The defender is there: the climber ends in contact with it, on the ladder's side of it.
    const d = Math.hypot(at.x - foe.x, at.y - foe.y) || 1;
    spot = { x: foe.x + ((at.x - foe.x) / d) * (radius(foe) + r + 0.01), y: foe.y + ((at.y - foe.y) / d) * (radius(foe) + r + 0.01) };
  }
  const blocked = Object.values(state.models).some(m => m.id !== bearer.id && m.id !== foe?.id && alive(m) && Math.hypot(m.x - spot.x, m.y - spot.y) < radius(m) + r - 0.02);
  if (blocked) return out;
  out.push(
    { type: 'rolled', roll: { id: `${group}-1`, by: seat, label: `${bearer.name} rides the ladder up${foe ? ` onto ${foe.name}` : ''}`.slice(0, 80), dice: [], model: bearer.id, at: now, group, note: foe ? 'It charges the defender at the top.' : 'It reaches the top of the wall.' } },
    { type: 'backAway', moves: [{ id: bearer.id, x: spot.x, y: spot.y }] },
  );
  return out;
}
