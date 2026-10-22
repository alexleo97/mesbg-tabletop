import { STARTER_BOARDS, starterTerrain } from './boards.ts';
import { NARRATIVES } from './narrative.ts';
import type { Mat, Terrain } from './types.ts';

/** A table you can pick to play on: one of the Middle-earth maps or one of the community boards. */
export interface TableChoice {
  /** `me:<narrative id>` or `board:<board id>`, as the battle menu and links name it. */
  key: string;
  name: string;
  blurb: string;
  /** The book the map is from (Middle-earth maps), or who made it (community boards). */
  from?: string;
  author?: string;
  w: number;
  h: number;
  mat: Mat;
  terrain: (newId: (p: string) => string) => Terrain[];
}

/**
 * The narrative scenarios' tables, terrain only, for any battle: the scenario's own markers (the campfire, siege
 * ladders, demolition charges) are left off, and its gates belong to nobody until a player gives them a side.
 * New narrative scenarios show up here as they're added.
 */
export const MIDDLE_EARTH_MAPS: TableChoice[] = NARRATIVES.map(n => ({
  key: `me:${n.id}`,
  name: n.name,
  blurb: n.layout,
  from: n.from,
  w: n.board.w,
  h: n.board.h,
  mat: n.board.mat,
  terrain: newId => n.terrain.filter(t => t.kind !== 'objective').map(({ held: _, ...t }) => ({ ...t, id: newId('t'), locked: true })),
}));

/** The original boards, credited to their author and listed with the community maps. */
export const COMMUNITY_BOARDS: TableChoice[] = STARTER_BOARDS.map(b => ({
  key: `board:${b.id}`,
  name: b.name,
  blurb: b.blurb,
  author: b.author,
  w: b.w,
  h: b.h,
  mat: b.mat,
  terrain: newId => starterTerrain(b, newId),
}));

export const tableByKey = (key: string | null | undefined) => [...MIDDLE_EARTH_MAPS, ...COMMUNITY_BOARDS].find(t => t.key === key);
