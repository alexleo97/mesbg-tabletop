// What magical powers do once they work, applied by the game: the effects that stay on models (Transfix, Paralyse,
// auras and the rest), the hits and wounds they cause, models knocked Prone or thrown from their mounts, and the
// odd ones that move models or put a marker down. The rest of the rules ask here whether a model is held by one.
import { fightsUpright } from './ambush.ts';
import { mounted } from './cavalry.ts';
import magic from '../data/magic.json';
import { modelStats, rulesFor, startingPoints, type Catalog } from './catalog.ts';
import { combats } from './flow.ts';
import { basePerimeter, distanceBetween, distanceToBase, type Point } from './geometry.ts';
import { formatNeed, woundNeed } from './rules.ts';
import { insidePolygon, outline } from './sight.ts';
import { isWarBeast } from './warBeasts.ts';
import { guards } from './wargear.ts';
import type { Action, DiceRoll, GameState, Model, ModelEffect, Seat, SpellPending } from './types.ts';

interface PowerInfo {
  name: string;
  range: string;
  duration: string;
  target: string;
  effect: string;
}

/** "Fury (Mordor Orc)" is the power Fury; the brackets name who it works on. */
export const basePower = (power: string) => power.replace(/ \(.*\)$/, '');
const INFO = new Map((magic.powers as PowerInfo[]).map(p => [basePower(p.name), p]));
export const powerInfo = (power: string) => INFO.get(basePower(power));
export const durationOf = (power: string) => powerInfo(power)?.duration ?? 'Instant';

/** How far auras reach, and the reach of Writhing Vines' marker from its caster. */
export const AURA_RANGE = 6;

/** Powers that work on the caster's own side; the rest are aimed at the enemy (or, for Self powers, the caster). */
const FRIENDLY = new Set(['Bladewrath', 'Blessing of the Valar', 'Enchant Blades', 'Enrage Beast', 'Fortify Spirit', 'Protection of the Valar', 'Renew', 'Strengthen Will']);
/** Powers that hit every enemy in range, seen or not. */
const AREA = new Set(["Nature's Wrath", 'Wrath of Bruinen']);
export const isFriendlyPower = (power: string) => FRIENDLY.has(basePower(power));
export const isAreaPower = (power: string) => AREA.has(basePower(power));
/** Tremor runs a line from the caster in a direction they pick: the model picked as the target shows which way. */
export const isLinePower = (power: string) => basePower(power) === 'Tremor';

// ---- What a model is ---------------------------------------------------------------------------------------------

const unitOf = (catalog: Catalog | null, m: Model) => (m.profileId ? catalog?.units[m.profileId] : undefined);
const hasRule = (catalog: Catalog | null, m: Model, re: RegExp) => rulesFor(catalog, m).some(r => re.test(r));
const MOUNT = /^(armoured )?(horse|steed|warg|pony|goat|war goat|camel|elk|boar|horses)$/i;
const MOUNT_OPTION = /\b(horse|steed|warg|pony|goat|camel|elk|boar)\b/i;

/** A rider on a mount (until it is thrown or its mount flees). */
export function isCavalry(catalog: Catalog | null, m: Model): boolean {
  if (m.dismounted || m.steed) return false;
  if (mounted(m)) return true;
  const unit = unitOf(catalog, m);
  return !!unit && (unit.wargear.some(w => MOUNT.test(w.trim())) || (m.options ?? []).some(o => MOUNT_OPTION.test(o)));
}

// Our data has no keywords, so Spirits and Beasts are told by name.
const SPIRIT = /ringwraith|nazg[uû]l|witch-king|kham[uû]l|dark marshal|shadow lord|undying|tainted|betrayer|knight of umbar|barrow|wight|of the dead|spirit|shade|castellan|dead marsh/i;
const BEAST = /warg|wolf|wolves|spider|\bbats?\b|crebain|bear\b|eagle|fell beast|m[uû]mak|beast|hound|boar|crow/i;
const nameOf = (catalog: Catalog | null, m: Model) => `${unitOf(catalog, m)?.name ?? ''} ${m.name}`;
export const isSpirit = (catalog: Catalog | null, m: Model) => SPIRIT.test(nameOf(catalog, m));
export const isBeast = (catalog: Catalog | null, m: Model) => BEAST.test(nameOf(catalog, m)) && !/rider|troll/i.test(nameOf(catalog, m));
const canFly = (catalog: Catalog | null, m: Model) => hasRule(catalog, m, /^Fly\b/);
const fireproof = (catalog: Catalog | null, m: Model) => hasRule(catalog, m, /Breathe Fire|I am fire/i);
const hasStaff = (catalog: Catalog | null, m: Model) =>
  !m.lostGear?.includes('Staff of Power') && [...(unitOf(catalog, m)?.wargear ?? []), ...(m.options ?? [])].some(w => /staff of power/i.test(w));

/** Whether a model has the keyword(s) a Fury power names, such as "Mordor Orc", told from its name, army and origin. */
export function hasKeyword(catalog: Catalog | null, m: Model, keyword: string): boolean {
  if (/^beasts?$/i.test(keyword)) return isBeast(catalog, m);
  if (/^spirits?$/i.test(keyword)) return isSpirit(catalog, m);
  const unit = unitOf(catalog, m);
  const text = `${unit?.name ?? ''} ${unit?.army ?? ''} ${unit?.origin ?? ''} ${m.name}`.toLowerCase();
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .every(w => text.includes(w.replace(/s$/, '')));
}

const STONE = new Set(['rock', 'building', 'ruin', 'cliff', 'wall']);
const inTerrain = (state: GameState, m: Model, kinds: Set<string>, reach = 0.25) =>
  Object.values(state.terrain).some(t => kinds.has(t.kind) && (insidePolygon(outline(t), m) || outline(t).some(p => distanceToBase(m, p) <= reach)));

// ---- Effects in play ---------------------------------------------------------------------------------------------

/**
 * Whether an effect still works: a Temporary one until the End phase of the turn it was cast, an Exhaustion one while
 * its caster has Will left. Any effect ends with its caster slain or gone from the table.
 */
export function effectActive(state: GameState, e: ModelEffect): boolean {
  // A Troll's sack holds its victim whatever becomes of the Troll, and so does a Spider's web.
  if (e.sack || e.web) return true;
  const caster = state.models[e.by];
  if (!caster || caster.dead || caster.escaped) return false;
  if (e.duration === 'Temporary') return e.turn === state.turn && state.phase !== 'end';
  return caster.will > 0;
}

export const effectsOn = (state: GameState, m: Model) => (m.effects ?? []).filter(e => effectActive(state, e));
/** Whether a model is under a power now. */
export const under = (state: GameState, m: Model | undefined, power: string) => !!m && effectsOn(state, m).some(e => basePower(e.power) === power);

/** Casters of a Self power within its 6" aura of a model: friends of it, or enemies. */
function auras(state: GameState, m: Model, power: string, side: 'friend' | 'enemy'): Model[] {
  return Object.values(state.models).filter(
    c => !c.dead && !c.escaped && (side === 'friend') === (c.owner === m.owner) && effectsOn(state, c).some(e => basePower(e.power) === power && e.by === c.id && !e.spared?.includes(m.id)) && distanceBetween(c, m) <= AURA_RANGE,
  );
}

/** Why a model can't act at all this turn, if it can't: Transfixed, Paralysed, thrown from its mount or dazed by the Haze. */
export function heldBy(state: GameState, m: Model): string | null {
  if (under(state, m, 'Paralyse')) return 'Paralysed';
  if (under(state, m, 'Transfix')) return 'Transfixed';
  if (m.stunned === state.turn) return 'Thrown from its mount';
  if (m.hazed === state.turn) return 'Dazed by the Haze of Mirkwood';
  return null;
}
export const cannotAct = (state: GameState, m: Model) => !m.dead && heldBy(state, m) !== null;

/** Why a model that wins a fight makes no strikes, if it doesn't. */
export function noStrikes(state: GameState, m: Model): string | null {
  return heldBy(state, m) ?? (m.prone && !fightsUpright(state, m) ? 'Prone' : null);
}

/** Terrifying Aura gives its caster Terror. */
export const terrifying = (state: GameState, m: Model) => under(state, m, 'Terrifying Aura');

/** Instil Fear makes enemies within 6" of its caster Fearful. */
export const madeFearful = (state: GameState, m: Model) => auras(state, m, 'Instil Fear', 'enemy').length > 0;

/** Why a model passes Courage tests without rolling, if it does. */
export function courageAuto(state: GameState, catalog: Catalog | null, m: Model): string | null {
  if (hasRule(catalog, m, /^Fearless\b/) || under(state, m, 'Enrage Beast')) return 'Fearless';
  if (auras(state, m, 'Aura of Command', 'friend').length) return 'Aura of Command';
  const fury = Object.values(state.models).find(
    c =>
      !c.dead &&
      c.owner === m.owner &&
      distanceBetween(c, m) <= AURA_RANGE &&
      effectsOn(state, c).some(e => e.by === c.id && basePower(e.power) === 'Fury' && hasKeyword(catalog, m, e.power.match(/\((.*)\)/)?.[1] ?? '')),
  );
  return fury ? 'Fury' : guards(state, catalog, m);
}

/** How much worse than its profile a model's Courage is now: Drain Courage, and an enemy Aura of Dismay. */
export const courageWorse = (state: GameState, m: Model) => (m.drained ?? 0) + (auras(state, m, 'Aura of Dismay', 'enemy').length ? 1 : 0);

/** How much worse a model's Intelligence tests are: an enemy Fog of Disarray. */
export const intelligenceWorse = (state: GameState, m: Model) => (auras(state, m, 'Fog of Disarray', 'enemy').length ? 1 : 0);

/** Free dice a model rolls to resist a power: Fortify Spirit, Resistant to Magic, and a friendly hero's Heroic Resolve. */
export function freeResistDice(state: GameState, catalog: Catalog | null, m: Model): number {
  // (Not from an Invisible hero, whose friends can't benefit from its heroic actions.)
  const resolve = state.flow.heroics.some(h => h.action === 'Heroic Resolve' && state.models[h.model] && state.models[h.model].owner === m.owner && (h.model === m.id || !state.models[h.model].ringOn) && distanceBetween(state.models[h.model], m) <= AURA_RANGE);
  return (under(state, m, 'Fortify Spirit') ? 1 : 0) + (hasRule(catalog, m, /^Resistant to Magic/) ? 1 : 0) + (resolve ? 1 : 0);
}

/** What hitting this model at range needs now: a 6 near an enemy Blinding Light, one worse for Protection of the Valar. */
export function shotNeed(state: GameState, shooter: Model, target: Model, need: number): number {
  if (auras(state, target, 'Blinding Light', 'friend').some(c => c.owner !== shooter.owner)) return 6;
  return under(state, target, 'Protection of the Valar') ? Math.min(6, need + 1) : need;
}

/** A model's Strength after Wither (and before anything else). */
export const witheredStrength = (m: Model, s: number) => Math.max(1, s - (m.withered ?? 0));

/** The words for each effect a model is under, for its card. */
export function effectNotes(state: GameState, catalog: Catalog | null, m: Model): string[] {
  const out: string[] = [];
  for (const e of effectsOn(state, m)) {
    const caster = state.models[e.by];
    const by = caster && caster.id !== m.id ? ` (${caster.name})` : '';
    if (e.sack) {
      out.push(`In ${caster?.name ?? 'a Troll'}'s sack: Paralysed until it rolls a 6 in the End phase`);
      continue;
    }
    const until = e.duration === 'Temporary' ? 'until the End phase' : 'while its caster has Will';
    out.push(`${e.power}${by}, ${until}`);
  }
  if (m.chilled === state.turn) out.push('Lingering Cold: Fight halved this turn');
  if (m.noMove === state.turn) out.push("Can't move this turn");
  if (m.prone) out.push('Prone: standing up costs half its Move');
  if (m.stunned === state.turn) out.push('Thrown from its mount: does nothing more this turn');
  if (m.drained) out.push(`Courage ${m.drained} worse (Drain Courage)`);
  if (m.withered) out.push(`Strength ${m.withered} lower (Wither)`);
  if (m.dismounted) out.push('On foot: its mount is gone');
  if (m.lostGear?.length) out.push(`Lost: ${m.lostGear.join(', ')}`);
  if (madeFearful(state, m)) out.push('Fearful (Instil Fear)');
  const auto = courageAuto(state, catalog, m);
  if (auto && auto !== 'Fearless') out.push(`Passes Courage tests (${auto})`);
  if (auras(state, m, 'Aura of Dismay', 'enemy').length) out.push('Courage tests 1 worse (Aura of Dismay)');
  if (intelligenceWorse(state, m)) out.push('Intelligence tests 1 worse (Fog of Disarray)');
  return out;
}

// ---- Targets -----------------------------------------------------------------------------------------------------

/** Whether a power can be aimed at this model: the right side, and the right kind of model for powers that ask for one. */
export function fitsTarget(state: GameState, catalog: Catalog | null, caster: Model, power: string, t: Model): boolean {
  const name = basePower(power);
  if (isLinePower(name)) return t.id !== caster.id;
  const friend = t.owner === caster.owner;
  if (friend !== isFriendlyPower(name)) return false;
  if (!friend && under(state, t, 'Protection of the Valar')) return false;
  switch (name) {
    case 'Banishment':
      return isSpirit(catalog, t);
    case 'Panic Steed':
      return isCavalry(catalog, t);
    case 'Enrage Beast':
      return isBeast(catalog, t);
    case 'Your Staff is Broken':
      return hasStaff(catalog, t);
    case 'Collapse Rocks':
      return inTerrain(state, t, STONE);
    case 'Foil Magic':
      return Object.values(state.models).some(o => effectsOn(state, o).some(e => e.by === t.id && e.duration === 'Exhaustion'));
    default:
      return true;
  }
}

const onTable = (m: Model) => !m.dead && !m.escaped && !m.waiting;

/** The models a power will work on once cast. Most have one target; some hit everyone in range or along a line. */
export function affected(state: GameState, catalog: Catalog | null, spell: Pick<SpellPending, 'caster' | 'target' | 'power'> & { reach?: number; aim?: string }): Model[] {
  const caster = state.models[spell.caster];
  if (!caster) return [];
  const range = parseFloat(powerInfo(spell.power)?.range ?? '') || rangeOf(catalog, caster, spell.power);
  if (isAreaPower(spell.power)) return Object.values(state.models).filter(t => onTable(t) && t.owner !== caster.owner && distanceBetween(caster, t) <= range);
  if (isLinePower(spell.power)) {
    const aim = state.models[spell.aim ?? spell.target];
    return aim ? lineTargets(state, catalog, caster, aim, spell.reach ?? 6) : [];
  }
  const t = state.models[spell.target];
  return t && onTable(t) ? [t] : [];
}

function rangeOf(catalog: Catalog | null, m: Model, power: string): number {
  const p = unitOf(catalog, m)?.powers?.find(x => x.name === power);
  return (p && parseFloat(p.range)) || 12;
}

/** Tremor: every model a 1mm line from the caster's base crosses, plus everyone else in a fight with one of them. Never fliers. */
export function lineTargets(state: GameState, catalog: Catalog | null, caster: Model, aim: Model, reach: number): Model[] {
  const dx = aim.x - caster.x;
  const dy = aim.y - caster.y;
  const len = Math.hypot(dx, dy) || 1;
  const start = distanceToBase(caster, { x: caster.x + (dx / len) * 50, y: caster.y + (dy / len) * 50 });
  const edge = 50 - start;
  const hit = new Set<string>();
  for (let d = edge; d <= edge + reach + 1e-6; d += 0.05) {
    const p = { x: caster.x + (dx / len) * d, y: caster.y + (dy / len) * d };
    for (const m of Object.values(state.models)) if (m.id !== caster.id && onTable(m) && distanceToBase(m, p) < 0.02) hit.add(m.id);
  }
  for (const c of combats(state)) {
    const all = [...c.p1, ...c.p2];
    if (all.some(id => hit.has(id))) for (const id of all) if (id !== caster.id) hit.add(id);
  }
  return [...hit].map(id => state.models[id]).filter(m => !canFly(catalog, m));
}

/** Of the enemies a power hits, the one who resists for all of them: the one with the most dice to roll. */
export function resister(state: GameState, catalog: Catalog | null, caster: Model, targets: Model[]): Model | null {
  const dice = (t: Model) => t.will + freeResistDice(state, catalog, t);
  const enemies = targets.filter(t => t.owner !== caster.owner && dice(t) > 0).sort((a, b) => dice(b) - dice(a));
  return enemies[0] ?? null;
}

// ---- Putting a power into play -----------------------------------------------------------------------------------

interface Ctx {
  state: GameState;
  catalog: Catalog | null;
  caster: Model;
  d6: () => number;
  uid: () => string;
  now: number;
  by: Seat;
  out: Action[];
}

const note = (ctx: Ctx, label: string, text: string, model?: Model) =>
  ctx.out.push({ type: 'rolled', roll: { id: `e-${ctx.uid()}`, by: ctx.by, label: label.slice(0, 80), dice: [], note: text, ...(model ? { aim: model.id } : {}), at: ctx.now } });

const patch = (ctx: Ctx, m: Model, p: Partial<Model>) => ctx.out.push({ type: 'affect', id: m.id, patch: p });

/** Puts a lasting effect on a model, replacing the same power from the same caster. */
function addEffect(ctx: Ctx, m: Model, power: string) {
  const duration = durationOf(power) === 'Temporary' ? 'Temporary' : 'Exhaustion';
  const effects = [...(m.effects ?? []).filter(e => effectActive(ctx.state, e) && !(e.power === power && e.by === ctx.caster.id)), { power, by: ctx.caster.id, turn: ctx.state.turn, duration } as ModelEffect];
  m.effects = effects;
  patch(ctx, m, { effects });
}

/** One hit of the given Strength on a model: the To Wound roll, and its wounds taken. Returns the wounds it does. */
function hit(ctx: Ctx, m: Model, s: number, why: string): number {
  const d = modelStats(ctx.catalog, m)?.D ?? 4;
  const need = woundNeed(s, d);
  const group = `p-${ctx.uid()}`;
  if (!need) {
    ctx.out.push({ type: 'rolled', roll: { id: `${group}-0`, by: ctx.by, label: `${why}: S${s} can't wound ${m.name}`.slice(0, 80), dice: [], at: ctx.now, group } });
    return 0;
  }
  const dice = [ctx.d6()];
  const follow = need.then ? dice.filter(x => x >= need.target).map(ctx.d6) : undefined;
  const roll: DiceRoll = {
    id: `${group}-0`,
    by: ctx.by,
    label: `${why}: S${s} hit on ${m.name} (${formatNeed(need)})`.slice(0, 80),
    dice,
    target: need.target,
    against: m.id,
    ...(need.then ? { then: need.then, follow } : {}),
    at: ctx.now,
    group,
  };
  const wounds = need.then ? (follow ?? []).filter(x => x >= need.then!).length : dice.filter(x => x >= need.target).length;
  roll.note = wounds ? `${m.name} takes a wound.` : `${m.name} shrugs it off.`;
  ctx.out.push({ type: 'rolled', roll });
  if (wounds) ctx.out.push({ type: 'wound', id: m.id, count: wounds, by: [ctx.caster.id], how: 'other', group });
  return wounds;
}

/** Whether a hit of this many wounds leaves the model standing (a hero with Fate might yet save it, so counts). */
const survives = (m: Model, wounds: number) => wounds < m.wounds || (m.hero && m.fate > 0);

/** A rider thrown from its mount: it lands on foot, takes a Strength 3 hit, lies Prone and does nothing more this turn. */
function throwRider(ctx: Ctx, m: Model, why: string) {
  const foot = modelStats(ctx.catalog, { ...m, options: (m.options ?? []).filter(o => !MOUNT_OPTION.test(o)) });
  patch(ctx, m, {
    dismounted: true,
    base: { shape: 'round', w: 25, h: 25 },
    move: foot?.Mv ?? 6,
    options: (m.options ?? []).filter(o => !MOUNT_OPTION.test(o)),
    prone: true,
    stunned: ctx.state.turn,
  });
  note(ctx, `${why}: ${m.name} is knocked flying`, `${m.name} is thrown from its mount, which is lost, and lands Prone.`, m);
  hit(ctx, { ...m, dismounted: true }, 3, 'Knocked flying');
}

/** Knocks a model Prone; a rider is knocked flying instead. */
function knockDown(ctx: Ctx, m: Model, why: string) {
  // A war beast is never knocked down: it would stop it moving its full Move.
  if (isWarBeast(ctx.catalog, m)) return;
  if (isCavalry(ctx.catalog, m)) {
    // Brego, a sure-footed steed, keeps Aragorn in the saddle on a 6.
    if (/\bbrego\b/i.test(m.mount ?? '')) {
      const d = ctx.d6();
      ctx.out.push({ type: 'rolled', roll: { id: `r-${ctx.uid()}`, by: ctx.by, label: `Sure-footed Steed: ${m.name} stays on Brego on a 6`.slice(0, 80), dice: [d], target: 6, model: m.id, at: ctx.now, note: d === 6 ? 'Brego keeps his feet.' : 'He is thrown.' } });
      if (d === 6) return;
    }
    return throwRider(ctx, m, why);
  }
  if (!m.prone) patch(ctx, m, { prone: true });
}

/** Call Winds: the model is blown straight away from the caster, stopping at the first model or solid terrain it meets. */
function blowAway(ctx: Ctx, m: Model, inches: number): Point {
  const { state, caster } = ctx;
  const dx = m.x - caster.x;
  const dy = m.y - caster.y;
  const len = Math.hypot(dx, dy) || 1;
  const others = Object.values(state.models).filter(o => o.id !== m.id && onTable(o));
  const solid = Object.values(state.terrain).filter(t => STONE.has(t.kind) || t.kind === 'wood').map(t => outline(t));
  let at: Point = { x: m.x, y: m.y };
  for (let d = 0.05; d <= inches + 1e-6; d += 0.05) {
    const p = { x: m.x + (dx / len) * d, y: m.y + (dy / len) * d };
    const moved = { ...m, ...p };
    if (p.x < 0 || p.y < 0 || p.x > state.board.w || p.y > state.board.h) break;
    // A model it's already touching (its fight) doesn't stop it, unless it's blown into it.
    if (others.some(o => distanceBetween(moved, o) < 0.01 && distanceBetween(moved, o) < distanceBetween({ ...m, ...at }, o))) break;
    if (solid.some(poly => basePerimeter(moved, 16).some(q => insidePolygon(poly, q)) && !basePerimeter({ ...m, ...at }, 16).some(q => insidePolygon(poly, q)))) break;
    at = p;
  }
  return at;
}

const d3 = (d6: () => number) => Math.ceil(d6() / 2);
/** Powers that would move a model or stop it acting. */
const UNMOVED = new Set(['Call Winds', 'Compel', 'Transfix', 'Paralyse']);

/** Rolls for each wearer of the Ring of Barahir a power would affect: those that roll a 6 are left alone. */
function barahirRolls(ctx: Ctx, power: string, ms: Model[]): string[] {
  const free: string[] = [];
  for (const m of ms) {
    if (!unitOf(ctx.catalog, m)?.rules.includes('Ring of Barahir')) continue;
    const die = ctx.d6();
    ctx.out.push({ type: 'rolled', roll: { id: `r-${ctx.uid()}`, by: m.owner, label: `Ring of Barahir: ${m.name} against ${power} (6)`.slice(0, 80), dice: [die], target: 6, model: m.id, note: die === 6 ? `${power} has no effect on ${m.name}.` : `${power} affects ${m.name}.`, at: ctx.now } });
    if (die === 6) free.push(m.id);
  }
  return free;
}

/**
 * Everything a power does once it has worked, as actions to apply: log entries, effects put on models, hits rolled,
 * wounds taken, models knocked down or moved. `spell.target` is the model it was aimed at.
 */
export function powerTakesEffect(
  state: GameState,
  catalog: Catalog | null,
  spell: Pick<SpellPending, 'caster' | 'target' | 'power'> & { reach?: number; aim?: string },
  d6: () => number,
  uid: () => string,
  now: number,
): Action[] {
  const caster = state.models[spell.caster];
  if (!caster) return [];
  const ctx: Ctx = { state, catalog, caster, d6, uid, now, by: caster.owner, out: [] };
  // Work on copies, so several changes to one model (two effects, say) build on each other.
  const name = basePower(spell.power);
  // The Ring of Barahir: an enemy power that would affect its wearer has no effect on him on a 6.
  const spared = barahirRolls(ctx, spell.power, affected(state, catalog, spell).filter(m => m.owner !== caster.owner));
  const targets = affected(state, catalog, spell).filter(m => !spared.includes(m.id)).map(m => ({ ...m }));
  const t = targets[0];
  const label = `${spell.power}${t && t.id !== caster.id ? ` on ${t.name}` : ''}`;
  const say = (text: string, m?: Model) => note(ctx, label, text, m);
  if (!targets.length && spared.length) return ctx.out;
  const pts = (m: Model) => startingPoints(catalog, m);

  // A war beast is unaffected by anything that would move it or stop it acting (Rulebook errata, Immovable Object).
  if (t && UNMOVED.has(name) && isWarBeast(catalog, t)) {
    say(`${t.name} is a war beast, an Immovable Object: it is unaffected.`, t);
    return ctx.out;
  }

  switch (name) {
    case 'Aura of Command':
    case 'Aura of Dismay':
    case 'Fog of Disarray':
    case 'Fury':
    case 'Instil Fear':
    case 'Terrifying Aura':
    case 'Blinding Light': {
      const self = { ...caster };
      addEffect(ctx, self, spell.power);
      // An aura that hinders enemies leaves a wearer of the Ring of Barahir who rolls a 6 alone, wherever he goes.
      if (name === 'Aura of Dismay' || name === 'Fog of Disarray' || name === 'Instil Fear') {
        const free = barahirRolls(ctx, spell.power, Object.values(state.models).filter(m => onTable(m) && m.owner !== caster.owner));
        if (free.length) {
          const effects = self.effects!.map(e => (e.power === spell.power && e.by === caster.id ? { ...e, spared: free } : e));
          self.effects = effects;
          patch(ctx, self, { effects });
        }
      }
      const what: Record<string, string> = {
        'Aura of Command': `${caster.name} and friends within 6" pass their Courage tests.`,
        'Aura of Dismay': `Enemies within 6" of ${caster.name} take their Courage tests at -1.`,
        'Fog of Disarray': `Enemies within 6" of ${caster.name} take their Intelligence tests at -1.`,
        Fury: `Friends within 6" of ${caster.name} with the right keyword pass their Courage tests.`,
        'Instil Fear': `Enemies within 6" of ${caster.name} are Fearful until the End phase.`,
        'Terrifying Aura': `${caster.name} causes Terror.`,
        'Blinding Light': `Enemy shots at models within 6" of ${caster.name} only hit on a 6 until the End phase.`,
      };
      say(what[name]);
      break;
    }
    case 'Writhing Vines': {
      // The marker goes as far towards the nearest enemy as it may (3" from the caster).
      const foe = Object.values(state.models)
        .filter(e => onTable(e) && e.owner !== caster.owner)
        .sort((a, b) => distanceBetween(caster, a) - distanceBetween(caster, b))[0];
      const dx = foe ? foe.x - caster.x : 0;
      const dy = foe ? foe.y - caster.y : 0;
      const len = Math.hypot(dx, dy) || 1;
      const off = foe ? Math.min(2.5, Math.hypot(dx, dy)) : 0;
      ctx.out.push({
        type: 'addTerrain',
        terrain: { id: `vines-${uid()}`, kind: 'field', shape: 'circle', x: caster.x + (dx / len) * off, y: caster.y + (dy / len) * off, w: 1, h: 1, rot: 0, locked: true, difficult: false, vines: true, side: caster.owner },
      });
      say(`Vines grow by ${caster.name}: the ground within 3" of them is difficult terrain for the enemy until the End phase.`);
      break;
    }
    case 'Transfix':
    case 'Paralyse':
    case 'Bladewrath':
    case 'Enchant Blades':
    case 'Protection of the Valar':
    case 'Fortify Spirit':
    case 'Enrage Beast': {
      if (!t) break;
      addEffect(ctx, t, spell.power);
      if (name === 'Paralyse' && !t.prone) patch(ctx, t, { prone: true });
      const what: Record<string, string> = {
        Transfix: `${t.name} can't move, shoot, cast or call heroics, and makes no strikes, until the End phase.`,
        Paralyse: `${t.name} is Paralysed and Prone. It can do nothing, adds nothing to a fight, and rolls to recover each End phase.`,
        Bladewrath: `${t.name} strikes at Strength 6 this turn.`,
        'Enchant Blades': `${t.name} re-rolls failed To Wound rolls on its strikes this turn.`,
        'Protection of the Valar': `${t.name} can't be targeted by enemy powers, and enemy shots at it are 1 worse to hit, until the End phase.`,
        'Fortify Spirit': `${t.name} rolls an extra free die whenever it resists an enemy power.`,
        'Enrage Beast': `${t.name} gets +2 Fight, Strength and Attacks and is Fearless until the End phase, then loses a Wound.`,
      };
      say(what[name], t);
      break;
    }
    case 'Banishment':
    case 'Chill Soul': {
      if (!t) break;
      say(`${t.name} loses a Wound.`, t);
      ctx.out.push({ type: 'wound', id: t.id, count: 1, by: [caster.id], how: 'other', group: `p-${uid()}` });
      break;
    }
    case 'Black Dart':
      if (t) hit(ctx, t, 6, spell.power);
      break;
    case 'Flameburst':
      if (!t) break;
      if (fireproof(catalog, t)) say(`${t.name} is immune to fire.`, t);
      else hit(ctx, t, 6, spell.power);
      break;
    case 'Sorcerous Blast': {
      if (!t) break;
      const w = hit(ctx, t, 5, spell.power);
      if (survives(t, w)) knockDown(ctx, t, spell.power);
      const fight = combats(state).find(c => [...c.p1, ...c.p2].includes(t.id));
      for (const id of fight ? [...fight.p1, ...fight.p2] : []) {
        const o = state.models[id];
        if (id !== t.id && (modelStats(catalog, o)?.S ?? 3) <= 5) knockDown(ctx, o, spell.power);
      }
      break;
    }
    case 'Collapse Rocks': {
      if (!t) break;
      const w = hit(ctx, t, 7, spell.power);
      if (survives(t, w)) knockDown(ctx, t, spell.power);
      break;
    }
    case 'Call Winds': {
      if (!t) break;
      const inches = d3(d6) + 3;
      const at = blowAway(ctx, t, inches);
      patch(ctx, t, { x: at.x, y: at.y });
      say(`${t.name} is blown ${Math.hypot(at.x - t.x, at.y - t.y).toFixed(1)}" back (of ${inches}") and knocked down.`, t);
      knockDown(ctx, { ...t, ...at }, spell.power);
      break;
    }
    case 'Compel': {
      if (!t) break;
      ctx.out.push({ type: 'compel', compel: { model: t.id, caster: caster.id, max: t.move / 2, from: [t.x, t.y] } });
      say(`${caster.name}'s player moves ${t.name} up to ${(t.move / 2).toFixed(1)}". It can't move again this turn.`, t);
      break;
    }
    case 'Curse':
      if (!t) break;
      patch(ctx, t, { fate: Math.max(0, t.fate - 1) });
      say(t.fate > 0 ? `${t.name} loses a Fate point.` : `${t.name} has no Fate to lose.`, t);
      break;
    case 'Drain Courage':
      if (!t) break;
      patch(ctx, t, { drained: (t.drained ?? 0) + 1 });
      say(`${t.name}'s Courage is 1 worse for the rest of the game.`, t);
      break;
    case 'Wither': {
      if (!t) break;
      const withered = (t.withered ?? 0) + 1;
      const left = (modelStats(catalog, t)?.S ?? 3) - withered;
      patch(ctx, t, left > 0 ? { withered } : { withered, dead: true, wounds: 0 });
      say(left > 0 ? `${t.name}'s Strength drops to ${left} for the rest of the game.` : `${t.name}'s Strength falls to 0 and it is slain.`, t);
      break;
    }
    case 'Panic Steed':
      if (t) throwRider(ctx, t, spell.power);
      break;
    case 'Your Staff is Broken':
      if (!t) break;
      patch(ctx, t, { lostGear: [...new Set([...(t.lostGear ?? []), 'Staff of Power'])] });
      say(`${t.name}'s Staff of Power is destroyed.`, t);
      break;
    case 'Foil Magic': {
      if (!t) break;
      // The target's most recent Exhaustion power ends.
      const theirs = Object.values(state.models).flatMap(o => effectsOn(state, o).filter(e => e.by === t.id && e.duration === 'Exhaustion').map(e => ({ o, e })));
      const last = theirs.sort((a, b) => b.e.turn - a.e.turn)[0];
      if (!last) {
        say(`${t.name} has no lasting power in play.`, t);
        break;
      }
      for (const { o } of theirs.filter(x => x.e.power === last.e.power)) patch(ctx, o, { effects: (o.effects ?? []).filter(e => !(e.by === t.id && e.power === last.e.power)) });
      say(`${t.name}'s ${last.e.power} ends.`, t);
      break;
    }
    case 'Blessing of the Valar': {
      if (!t) break;
      const max = pts(t)?.fate ?? state.flow.startFate?.[t.id] ?? t.fate + 1;
      patch(ctx, t, { fate: Math.min(max, t.fate + 1) });
      say(t.fate < max ? `${t.name} gets back a Fate point.` : `${t.name} has spent no Fate to get back.`, t);
      break;
    }
    case 'Renew':
      if (!t) break;
      patch(ctx, t, { wounds: Math.min(t.maxWounds, t.wounds + 1) });
      say(t.wounds < t.maxWounds ? `${t.name} heals a Wound.` : `${t.name} has no Wounds to heal.`, t);
      break;
    case 'Strengthen Will': {
      if (!t) break;
      const max = pts(t)?.will ?? 9;
      patch(ctx, t, { will: Math.min(max, t.will + 1) });
      say(t.will < max ? `${t.name} gets back a Will point.` : `${t.name} has spent no Will to get back.`, t);
      break;
    }
    case "Nature's Wrath":
      say(targets.length ? `${targets.length} ${targets.length === 1 ? 'enemy is' : 'enemies are'} knocked to the ground.` : 'No enemies in range.');
      for (const m of targets) knockDown(ctx, m, spell.power);
      break;
    case 'Wrath of Bruinen':
      say(targets.length ? `The water surges over ${targets.length} ${targets.length === 1 ? 'enemy' : 'enemies'}.` : 'No enemies in range.');
      for (const m of targets) {
        const w = hit(ctx, m, inTerrain(state, m, new Set(['water']), 0) ? 8 : 2, spell.power);
        if (survives(m, w)) knockDown(ctx, m, spell.power);
      }
      break;
    case 'Tremor':
      say(targets.length ? `The ground splits for ${spell.reach ?? 6}": ${targets.map(m => m.name).join(', ')}.`.slice(0, 200) : `The ground splits for ${spell.reach ?? 6}", but nobody is in the way.`);
      for (const m of targets) {
        const w = hit(ctx, m, 4, spell.power);
        if (survives(m, w)) knockDown(ctx, m, spell.power);
      }
      break;
    default:
      say('The power takes effect.');
  }
  return ctx.out;
}

// ---- Paralysis -------------------------------------------------------------------------------------------------

/** Whether Paralysed models still have to roll to recover this End phase. */
export function recoveryDue(state: GameState): boolean {
  return state.flow.started && state.phase === 'end' && !state.result && state.flow.recovered !== state.turn && Object.values(state.models).some(m => !m.dead && under(state, m, 'Paralyse'));
}

/** Each Paralysed model rolls a D6 to recover on a 6, then each friend touching it may roll too, any 6 freeing it. */
export function recoveryRolls(state: GameState, d6: () => number, uid: () => string, now = Date.now()): Action[] {
  const out: Action[] = [];
  for (const m of Object.values(state.models)) {
    if (m.dead || !under(state, m, 'Paralyse')) continue;
    const rollers = [m, ...Object.values(state.models).filter(f => f.id !== m.id && f.owner === m.owner && onTable(f) && distanceBetween(f, m) <= 0.05)];
    let free = false;
    for (const r of rollers) {
      const die = d6();
      free = die === 6;
      // (A hero rolling may spend its own Might on the die: see reducer useMight.)
      out.push({ type: 'rolled', roll: { id: `e-${uid()}`, by: m.owner, label: `Recover from Paralyse: ${r.id === m.id ? m.name : `${r.name} helps ${m.name}`} (6)`.slice(0, 80), dice: [die], target: 6, at: now, ...(r.hero ? { model: r.id, frees: m.id } : {}), ...(free ? { note: `${m.name} recovers.` } : {}) } });
      if (free) break;
    }
    if (free) out.push({ type: 'affect', id: m.id, patch: { effects: (m.effects ?? []).filter(e => basePower(e.power) !== 'Paralyse') } });
  }
  out.push({ type: 'recovered' });
  return out;
}
