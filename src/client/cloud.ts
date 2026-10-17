import type { Mat, Terrain } from '../shared/types.ts';
import { supabase } from './auth.ts';
import type { Roster } from './ListBuilder.tsx';

// Saved armies and maps on a signed-in player's account. Everything here quietly does nothing
// when nobody is signed in, so the game works the same without an account.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);
export const newUuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (+c ^ (Math.random() * 16) >> (+c / 4)).toString(16));

async function me() {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? { sb, id: data.session.user.id } : null;
}

/** Your armies on your account, newest first. */
export async function cloudLists(): Promise<Roster[] | null> {
  const who = await me();
  if (!who) return null;
  const { data, error } = await who.sb.from('armies').select('data, updated_at').eq('owner', who.id).order('updated_at', { ascending: false }).limit(100);
  if (error) return null;
  return data.map(row => ({ ...(row.data as Roster), updatedAt: Date.parse(row.updated_at) }));
}

export async function saveCloudList(r: Roster, points?: number): Promise<boolean> {
  const who = await me();
  if (!who || !isUuid(r.id)) return false;
  const { error } = await who.sb.from('armies').upsert({
    id: r.id,
    owner: who.id,
    name: (r.name || 'Untitled list').slice(0, 80),
    faction: r.army || null,
    points: points ?? null,
    data: r,
    updated_at: new Date(r.updatedAt ?? Date.now()).toISOString(),
  });
  return !error;
}

export async function deleteCloudList(id: string) {
  const who = await me();
  if (who && isUuid(id)) await who.sb.from('armies').delete().eq('id', id).eq('owner', who.id);
}

/** Merges the lists in this browser with the ones on your account; the newer copy of each wins. */
export function mergeLists(local: Roster[], cloud: Roster[]): Roster[] {
  const byId = new Map<string, Roster>();
  for (const r of [...cloud, ...local]) {
    const have = byId.get(r.id);
    if (!have || (r.updatedAt ?? 0) > (have.updatedAt ?? 0)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export interface MapData {
  w: number;
  h: number;
  mat: Mat;
  terrain: Terrain[];
}

export interface SavedMap {
  id: string;
  name: string;
  public: boolean;
  owner: string;
  author?: string;
  updated_at: string;
  data: MapData;
}

const MAP_FIELDS = 'id, name, public, owner, updated_at, data, profiles(username)';
type MapRow = Omit<SavedMap, 'author'> & { profiles: { username: string } | { username: string }[] | null };
const toMap = (row: MapRow): SavedMap => {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return { id: row.id, name: row.name, public: row.public, owner: row.owner, updated_at: row.updated_at, data: row.data, author: p?.username };
};

/** Your own maps, or everyone's shared maps. */
export async function listMaps(which: 'mine' | 'shared'): Promise<SavedMap[] | null> {
  const sb = await supabase();
  if (!sb) return null;
  let q = sb.from('maps').select(MAP_FIELDS).order('updated_at', { ascending: false }).limit(50);
  if (which === 'mine') {
    const who = await me();
    if (!who) return null;
    q = q.eq('owner', who.id);
  } else q = q.eq('public', true);
  const { data, error } = await q;
  return error ? null : (data as unknown as MapRow[]).map(toMap);
}

export async function saveMap(name: string, map: MapData, shared: boolean): Promise<string | null> {
  const who = await me();
  if (!who) return 'Sign in to save maps.';
  const { error } = await who.sb.from('maps').insert({ owner: who.id, name: name.trim().slice(0, 80) || 'Untitled map', data: map, public: shared });
  return error ? "Couldn't save the map. Try again in a moment." : null;
}

/** Saves a new map and returns its id, so later saves update it. */
export async function createMap(name: string, map: MapData, shared: boolean): Promise<string | null> {
  const who = await me();
  if (!who) return null;
  const { data, error } = await who.sb.from('maps').insert({ owner: who.id, name: name.trim().slice(0, 80) || 'Untitled map', data: map, public: shared }).select('id').single();
  return error || !data ? null : (data as { id: string }).id;
}

export async function updateMap(id: string, patch: { name?: string; public?: boolean; data?: MapData }) {
  const who = await me();
  if (who) await who.sb.from('maps').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('owner', who.id);
}

export async function deleteMap(id: string) {
  const who = await me();
  if (who) await who.sb.from('maps').delete().eq('id', id).eq('owner', who.id);
}

export interface ArmySummary {
  id: string;
  name: string;
  faction: string | null;
  points: number | null;
}

/** Your saved armies in brief, for your profile. */
export async function armySummaries(): Promise<ArmySummary[] | null> {
  const who = await me();
  if (!who) return null;
  const { data, error } = await who.sb.from('armies').select('id, name, faction, points').eq('owner', who.id).order('updated_at', { ascending: false });
  return error ? null : data;
}

/** One map by id: your own, or anyone's shared one. */
export async function getMap(id: string): Promise<SavedMap | null> {
  const sb = await supabase();
  if (!sb || !isUuid(id)) return null;
  const { data, error } = await sb.from('maps').select(MAP_FIELDS).eq('id', id).maybeSingle();
  return error || !data ? null : toMap(data as unknown as MapRow);
}
