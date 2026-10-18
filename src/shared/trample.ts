// A war beast's Trample, or a chariot's Chariot Charge, as the player (or, for a Stampede, their opponent) points
// it somewhere: the game drives it there, rolling the Impact Hits on everyone in its way (see warBeasts.ts).
import { modelStats, type Catalog } from './catalog.ts';
import { hitModel, mounted, mountOf } from './cavalry.ts';
import { touchingEnemies } from './barriers.ts';
import { mayActivate } from './heroics.ts';
import { carried, drive, heldBy, impactHits, isChariot, isWarBeast, riders, shoveAside } from './warBeasts.ts';
import type { Action, DiceRoll, GameState, Model, Seat } from './types.ts';

type Trample = Extract<Action, { type: 'trample' }>;

/** Whether a war beast or chariot still has its move to make this turn (it must move if it can). */
export function mustCharge(state: GameState, catalog: Catalog | null | undefined, m: Model): boolean {
  return state.flow.started && state.phase === 'move' && !m.dead && !m.escaped && !m.waiting && (isWarBeast(catalog, m) || isChariot(catalog, m)) && !state.flow.trampled?.includes(m.id) && !state.flow.stopped?.includes(m.id);
}

/** A model that came on from reserve this turn (its side's arrivals are in, and it still stands at the table edge) tramples no one yet. */
function justArrived(state: GameState, m: Model): boolean {
  if (!state.flow.arrived?.includes(m.owner)) return false;
  const r = Math.max(m.base.w, m.base.h) / 50.8 + 0.5;
  return m.x < r || m.y < r || m.x > state.board.w - r || m.y > state.board.h - r;
}

/**
 * Moves a war beast or chariot towards the point the player picked. A riderless war beast first tests its Courage
 * and Stampedes if it fails; a Stampeding one is driven by the other player. A war beast held by enemies stronger
 * than it can't move; one held by weaker enemies tramples them first. A chariot may just turn on the spot instead.
 */
export function trample(state: GameState, catalog: Catalog | null, seat: Seat, action: Trample, d6: () => number, uid: () => string, now: number): Action[] | null {
  const m = state.models[String(action.id)];
  if (!m || !mustCharge(state, catalog, m) || !mayActivate(state, m)) return null;
  const war = isWarBeast(catalog, m);
  const wild = war && !!m.stampede;
  // Its own player drives it; a Stampede is driven by the other (or, if they leave it, by a die).
  if (!wild && seat !== m.owner) return null;
  const toward = { x: Number(action.x), y: Number(action.y) };
  if (!Number.isFinite(toward.x) || !Number.isFinite(toward.y)) return null;
  const group = `tr-${uid()}`;
  const from: [number, number] = [m.x, m.y];
  const out: Action[] = [];
  const log = (roll: Omit<DiceRoll, 'id' | 'at' | 'group'>) => out.push({ type: 'rolled', roll: { ...roll, id: `${group}-${uid()}`, at: now, group } as DiceRoll });

  // A war beast with no one riding it tests its own Courage before it moves; failing, it Stampedes.
  if (war && !wild && !riders(state, m).length) {
    const c = (modelStats(catalog, m)?.C ?? 7) + (m.options?.includes('Foul Temperament') ? 1 : 0);
    const dice = [d6(), d6()];
    const pass = dice[0] + dice[1] >= c;
    log({ by: m.owner, label: `Courage test: ${m.name} has no one riding it`.slice(0, 80), dice, sum: c, model: m.id, note: pass ? `${m.name} stays under control.` : `${m.name} Stampedes: the other player drives it.` });
    if (!pass) return [...out, { type: 'affect', id: m.id, patch: { stampede: true } }];
  }

  // A chariot may turn to face any way instead, and then makes no Chariot Charge this turn.
  if (action.pivot && !war) {
    const rot = (Math.atan2(toward.x - m.x, -(toward.y - m.y)) * 180) / Math.PI;
    log({ by: seat, label: `${m.name} turns on the spot`.slice(0, 80), dice: [], model: m.id });
    return [...out, { type: 'affect', id: m.id, patch: { rot: (rot + 360) % 360 } }, { type: 'trampled', id: m.id, from }];
  }

  // Engaged before it moves: a chariot can't break away; a war beast tramples the enemies holding it first, unless
  // together they're stronger than it is.
  const holding = touchingEnemies(state, m);
  let skip: string[] = [];
  if (holding.length) {
    if (!war) return null;
    const { held, strength } = heldBy(catalog, m, holding);
    if (held) {
      log({ by: seat, label: `${m.name} is held fast (enemies' Strength ${strength})`.slice(0, 80), dice: [], model: m.id, note: `Those fighting it are too strong for it to Trample.` });
      return [...out, { type: 'trampled', id: m.id, from }];
    }
    const impact = impactHits(catalog, m);
    for (const e of holding) {
      for (let i = 0; i < impact.n; i++) {
        const r = hitModel(e, modelStats(catalog, e)?.D ?? 4, impact.s, `Trample (${m.name})`, d6, seat, `${group}-${uid()}`, now, group, false, [m.id]);
        out.push(...r.actions);
      }
      const steed = mounted(e) ? mountOf(e) : undefined;
      if (steed && steed.left > 0) for (let i = 0; i < impact.n; i++) out.push(...hitModel(e, steed.d, impact.s, `Trample (${m.name})`, d6, seat, `${group}-${uid()}`, now, group, true, [m.id]).actions);
    }
    skip = holding.map(e => e.id);
  }

  // A Stampede driven by its own player (the other being away) goes where a die sends it.
  let aim = toward;
  if (wild && seat === m.owner) {
    const d = d6();
    const a = ((m.rot + (d - 1) * 60) * Math.PI) / 180;
    aim = { x: m.x + Math.sin(a) * 20, y: m.y - Math.cos(a) * 20 };
    log({ by: seat, label: `Stampede: ${m.name} bolts (a die picks the way)`.slice(0, 80), dice: [d], model: m.id });
  }
  const run = drive(state, catalog, m, aim, { d6, uid, now, by: seat, stampede: wild, group, skip, skipHits: justArrived(state, m) });
  // As it turns, models in its way are shoved aside.
  const shoves = war ? shoveAside(state, m, run.at.rot).filter(s => !skip.includes(s.id)) : [];
  out.push(...run.rolls.map(roll => ({ type: 'rolled', roll }) as Action), ...run.actions);
  if (run.why || run.rolls.length || shoves.length)
    log({ by: seat, label: `${m.name} ${war ? (wild ? 'Stampedes' : 'Tramples') : 'makes a Chariot Charge'}`.slice(0, 80), dice: [], model: m.id, ...(run.why ? { note: run.why } : {}) });
  const at = { x: Math.round(run.at.x * 1000) / 1000, y: Math.round(run.at.y * 1000) / 1000, rot: (run.at.rot + 360) % 360 };
  out.push(...shoves.map(s => ({ type: 'affect', id: s.id, patch: { x: s.x, y: s.y } }) as Action));
  out.push({ type: 'affect', id: m.id, patch: at });
  for (const r of riders(state, m)) out.push({ type: 'affect', id: r.id, patch: carried(m, at, r) });
  // Off the table in a Stampede: it is lost, and everyone riding it.
  if (run.lost) out.push(...[m, ...riders(state, m)].map(x => ({ type: 'affect', id: x.id, patch: { dead: true } }) as Action));
  out.push({ type: 'trampled', id: m.id, from, ...(run.target ? { target: run.target } : {}) });
  return out;
}

/** The war beasts and chariots a side hasn't moved yet as it ends its move: they must move if they can, so the game drives them straight on. */
export const chargesDue = (state: GameState, catalog: Catalog | null | undefined, seat: Seat) =>
  state.flow.started && state.phase === 'move' ? Object.values(state.models).filter(m => m.owner === seat && mustCharge(state, catalog, m) && mayActivate(state, m)) : [];

/** A point straight ahead of a model, far off, to drive it on the way it faces. */
export const straightOn = (m: Model) => ({ x: m.x + Math.sin((m.rot * Math.PI) / 180) * 30, y: m.y - Math.cos((m.rot * Math.PI) / 180) * 30 });
