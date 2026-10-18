// Games in progress, kept in Supabase so a deploy or restart doesn't lose them. The server keeps each live game in
// memory and writes it here every few seconds while it changes, at each new phase, and once more as it shuts down.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and the `rooms` table from supabase/schema.sql; without them games
// are only kept on the server's own disk, as before.

const URL_ = () => (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const storeEnabled = () => !!URL_() && !!KEY();

const headers = (extra: Record<string, string> = {}) => ({ apikey: KEY(), authorization: `Bearer ${KEY()}`, 'content-type': 'application/json', ...extra });

/** A saved game: the game itself, and the private details that stay on the server. */
export interface StoredRoom {
  state: unknown;
  invite?: string;
  voice?: string;
}

/** Says why the store isn't working once, rather than on every save. */
let warned = '';
function warn(what: string, detail: unknown) {
  const line = `${what}: ${detail instanceof Error ? detail.message : String(detail)}`;
  if (line === warned) return;
  warned = line;
  console.warn(line);
}

/** The saved game for a room: null if there is none, undefined if the store couldn't be reached. */
export async function loadRoom(id: string): Promise<StoredRoom | null | undefined> {
  if (!storeEnabled()) return undefined;
  try {
    const res = await fetch(`${URL_()}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}&select=state,invite,voice`, { headers: headers() });
    if (!res.ok) {
      warn('Could not read a saved game', `${res.status} ${await res.text()}`);
      return undefined;
    }
    const rows = (await res.json()) as { state: unknown; invite: string | null; voice: string | null }[];
    const row = rows[0];
    if (!row) return null;
    return { state: row.state, ...(row.invite ? { invite: row.invite } : {}), ...(row.voice ? { voice: row.voice } : {}) };
  } catch (err) {
    warn('Could not read a saved game', err);
    return undefined;
  }
}

/** Saves a room's game, replacing the last save. Returns whether it was saved. */
export async function saveRoom(id: string, room: StoredRoom): Promise<boolean> {
  if (!storeEnabled()) return false;
  try {
    const res = await fetch(`${URL_()}/rest/v1/rooms?on_conflict=id`, {
      method: 'POST',
      headers: headers({ prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id, state: room.state, invite: room.invite ?? null, voice: room.voice ?? null, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) warn('Could not save a game', `${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    warn('Could not save a game', err);
    return false;
  }
}

/** Removes games nobody has touched for a while. */
export async function pruneRooms(olderThanMs: number): Promise<void> {
  if (!storeEnabled()) return;
  try {
    const before = new Date(Date.now() - olderThanMs).toISOString();
    const res = await fetch(`${URL_()}/rest/v1/rooms?updated_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: headers({ prefer: 'return=minimal' }) });
    if (!res.ok) warn('Could not clear out old games', `${res.status} ${await res.text()}`);
  } catch (err) {
    warn('Could not clear out old games', err);
  }
}
