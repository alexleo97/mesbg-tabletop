import { fortressNotes } from './fortress.ts';
import { formatInches } from './geometry.ts';
import { blocksSight, hasFloors, heightOf, isDifficult, slowsShots } from './sight.ts';
import type { Terrain, TerrainKind } from './types.ts';

/** What each kind of terrain is called, the group it belongs to and a note on how it plays, in this site's own words. */
export const TERRAIN_INFO: Record<TerrainKind, { name: string; type: string; note: string }> = {
  wood: { name: 'Woods', type: 'Area terrain', note: 'Trees and undergrowth: models can stand inside, but it is slow going and hard to shoot through.' },
  field: { name: 'Crop field', type: 'Area terrain', note: 'Tall crops partly hide models but are easy to walk through.' },
  ruin: { name: 'Ruins', type: 'Area terrain', note: 'Broken walls and rubble: slow to cross and good cover. Low walls can be climbed or jumped.' },
  rock: { name: 'Rocks', type: 'Obstacle', note: 'Solid enough to hide behind. Models can climb it, and jump smaller rocks.' },
  wall: { name: 'Wall', type: 'Barrier', note: 'A low wall or fence. Models can jump or climb over it, and one standing behind it can defend it in a fight.' },
  building: { name: 'Building', type: 'Impassable', note: 'Models go round it, or climb it to fight from the roof.' },
  cliff: { name: 'Cliff', type: 'Impassable', note: 'Sheer rock: models go round it unless they climb.' },
  water: { name: 'Water', type: 'Water', note: 'Shallow water and streams slow models down. Deep water, if you agree it is deep, means swimming.' },
  hill: { name: 'Hill', type: 'Elevation', note: 'Open ground that gives height: models up here can see over low terrain. It does not slow movement.' },
  objective: { name: 'Objective', type: 'Marker', note: 'A scenario objective. It does not block movement or sight.' },
  road: { name: 'Road', type: 'Open ground', note: 'A dirt track or street. Open ground: it does not slow models or block sight.' },
  gate: { name: 'Gate', type: 'Barrier', note: 'A gate or door set in a fortress wall. Set its kind and who holds it below.' },
  tower: { name: 'Siege tower', type: 'Siege engine', note: 'A wheeled tower its crew push up to the walls. Once it touches them, its ramp drops and models climb from it straight onto the battlements.' },
  bridge: { name: 'Bridge', type: 'Crossing', note: 'Carries models over water at full speed. Narrow, so it makes a natural choke point.' },
};

/** The groups used to sort terrain in the Table panel, in the order shown. */
export const TERRAIN_GROUPS = ['Area terrain', 'Obstacle', 'Barrier', 'Impassable', 'Water', 'Crossing', 'Siege engine', 'Elevation', 'Open ground', 'Marker'] as const;

/** How this piece plays here: what the board and turn guide use, plus the kind's note. */
export function terrainRules(t: Terrain): string[] {
  const out: string[] = [];
  if (isDifficult(t)) out.push('Difficult terrain: moving through it costs double.');
  if (blocksSight(t)) out.push(`Blocks line of sight up to ${heightOf(t)}" high: models behind it are hidden unless someone looks down from higher up.`);
  if (t.kind === 'hill') out.push(`Models on it stand ${heightOf(t)}" up, so they see and shoot over lower terrain.`);
  if (hasFloors(t)) {
    const n = t.floors!;
    out.push(`Walk in at ground level. ${n === 1 ? 'Climbing onto the roof' : `It has ${n} floors and a roof; each climb`} costs ${formatInches(heightOf(t) / n)} of a model's move. Models on different floors don't fight each other.`);
  } else if (t.kind === 'rock' || t.kind === 'building' || t.kind === 'cliff') out.push(`Climbing up or down it costs ${heightOf(t)}" of a model's move.`);
  if (slowsShots(t)) out.push('In the Way: shots through it need an In the Way roll.');
  if (t.kind === 'gate' || t.kind === 'tower' || t.barricade) out.push(...fortressNotes(t));
  if (t.sheer) out.push('Sheer: too tall and smooth to climb without a Siege Ladder (Swift Movement aside).');
  out.push(TERRAIN_INFO[t.kind].note);
  return out;
}
