import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

// Discord sign-in through Supabase. The site works the same without it: when the server has no
// Supabase settings, nothing here loads and the sign-in button stays hidden.

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Stats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface Auth {
  /** Still finding out whether sign-in is offered and who is signed in. */
  loading: boolean;
  /** Sign-in is set up on this server. */
  enabled: boolean;
  signedIn: boolean;
  /** The current sign-in token, for telling the game server who you are. */
  token: string | null;
  profile: Profile | null;
  error?: string;
}

let state: Auth = { loading: true, enabled: false, signedIn: false, token: null, profile: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Auth>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

let client: Promise<SupabaseClient | null> | null = null;

/** The Supabase client, or null when sign-in isn't set up. Loaded once, on first use. */
export function supabase(): Promise<SupabaseClient | null> {
  client ??= (async () => {
    try {
      const config: { supabaseUrl?: string; supabaseAnonKey?: string } = await fetch('/api/config').then(r => (r.ok ? r.json() : {}));
      if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
      const { createClient } = await import('@supabase/supabase-js');
      return createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
    } catch {
      return null;
    }
  })();
  return client;
}

async function loadProfile(sb: SupabaseClient, session: Session | null) {
  if (!session) return set({ loading: false, signedIn: false, token: null, profile: null, error: undefined });
  set({ token: session.access_token });
  const { data, error } = await sb.from('profiles').select('id, username, avatar_url, created_at').eq('id', session.user.id).maybeSingle();
  if (error || !data) return set({ loading: false, signedIn: true, profile: null, error: "You're signed in, but your profile couldn't be loaded. The database may not be set up yet." });
  set({ loading: false, signedIn: true, profile: data, error: undefined });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void supabase().then(async sb => {
    if (!sb) return set({ loading: false, enabled: false });
    set({ enabled: true });
    // A failed sign-in comes back with the reason in the address, in the query or after the #.
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const failed = url.searchParams.get('error_description') ?? hash.get('error_description');
    const { data, error } = await sb.auth.getSession();
    await loadProfile(sb, data.session);
    if (failed || error) set({ error: `Sign-in didn't work: ${failed ?? error?.message}` });
    // Tidy the sign-in leftovers (?code=…, ?error=…) out of the address.
    for (const k of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(k);
    if (hash.has('error') || hash.has('access_token')) url.hash = '';
    if (url.href !== location.href) history.replaceState(null, '', url);
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void loadProfile(sb, session);
      else if (event === 'TOKEN_REFRESHED') set({ token: session?.access_token ?? null });
    });
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Who is signed in, if anyone. */
export function useAuth(): Auth {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Sends the player to Discord to sign in, then back to this page. */
export async function signIn() {
  const sb = await supabase();
  if (!sb) return;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.href, scopes: 'identify' } });
  if (error) set({ error: "Couldn't reach Discord. Try again in a moment." });
}

export async function signOut() {
  const sb = await supabase();
  await sb?.auth.signOut();
}

export async function rename(username: string): Promise<string | null> {
  const sb = await supabase();
  const name = username.trim().slice(0, 32);
  if (!sb || !state.profile || !name) return 'Enter a name.';
  const { error } = await sb.from('profiles').update({ username: name }).eq('id', state.profile.id);
  if (error) return "Couldn't save your name. Try again in a moment.";
  set({ profile: { ...state.profile, username: name } });
  return null;
}

export async function statsFor(id: string): Promise<Stats | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.from('player_stats').select('games, wins, draws, losses').eq('id', id).maybeSingle();
  return data ?? { games: 0, wins: 0, draws: 0, losses: 0 };
}

export interface Standing extends Stats {
  id: string;
  username: string;
  avatar_url: string | null;
}

/** Everyone with at least one recorded game, most wins first. */
export async function leaderboard(): Promise<Standing[] | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('player_stats')
    .select('id, username, avatar_url, games, wins, draws, losses')
    .gt('games', 0)
    .order('wins', { ascending: false })
    .order('games', { ascending: true })
    .limit(100);
  return error ? null : data;
}
