// Player accounts on the server: checking who a signed-in player is, and recording agreed results.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never commit the key); without them nothing is recorded.

import type { Account, GameState, Seat } from '../src/shared/types.ts';
import { vpTotal } from '../src/shared/scenarios.ts';

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const accountsEnabled = () => !!URL_ && !!KEY;

const headers = (extra: Record<string, string> = {}) => ({ apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...extra });

/** The account behind a player's sign-in token, or null if it isn't valid. */
export async function verifyToken(token: string): Promise<Account | null> {
  if (!accountsEnabled() || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    if (typeof user.id !== 'string') return null;
    const p = await fetch(`${URL_}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=username`, { headers: headers() });
    const rows = p.ok ? ((await p.json()) as { username: string }[]) : [];
    return { id: user.id, name: rows[0]?.username ?? 'Player' };
  } catch (err) {
    console.warn('Could not check a sign-in:', err);
    return null;
  }
}

/** Records an agreed result between two different signed-in players. Returns whether it was saved. */
export async function saveResult(room: string, state: GameState): Promise<boolean> {
  const a = state.accounts;
  const r = state.result;
  if (!accountsEnabled() || !r?.agreed || !a?.p1 || !a.p2 || a.p1.id === a.p2.id) return false;
  try {
    // One result per game: a game restored after a restart can't be counted twice. Rematches in the same room start later, so they still count.
    const game = `${room}@${state.flow.startedAt ?? 0}`;
    const dup = await fetch(`${URL_}/rest/v1/results?room=eq.${encodeURIComponent(game)}&select=id`, { headers: headers() });
    if (dup.ok && ((await dup.json()) as unknown[]).length) return true;
    const vp = (s: Seat) => (state.scenario ? vpTotal(state.vp[s]) : null);
    const res = await fetch(`${URL_}/rest/v1/results`, {
      method: 'POST',
      headers: headers({ prefer: 'return=minimal' }),
      body: JSON.stringify({ room: game, scenario: state.scenario, p1: a.p1.id, p2: a.p2.id, winner: r.winner, p1_vp: vp('p1'), p2_vp: vp('p2'), turns: state.turn }),
    });
    if (!res.ok) console.warn(`Saving a result failed: ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.warn('Saving a result failed:', err);
    return false;
  }
}
