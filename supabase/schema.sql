-- MESBG Tabletop database. Run this once in Supabase: SQL Editor > New query > paste > Run.
-- It is safe to run again; it only adds what is missing.

-- Profiles: one per player, made automatically the first time they sign in with Discord.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  discord_id text unique,
  username text not null check (char_length(username) between 1 and 32),
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Players edit their own profile" on public.profiles;
create policy "Players edit their own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- Players may only change their display name; the Discord link and dates stay as they are.
revoke update on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, discord_id, username, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    left(coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name', new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'Player'), 32),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Discord retires a picture's link when the player changes it, so take the new one at each sign-in.
create or replace function public.handle_user_updated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set avatar_url = new.raw_user_meta_data ->> 'avatar_url'
  where id = new.id and avatar_url is distinct from new.raw_user_meta_data ->> 'avatar_url';
  return new;
end $$;
drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of raw_user_meta_data on auth.users for each row execute function public.handle_user_updated();

-- Saved armies and player-made maps. Armies are private unless shared; maps are shared unless hidden.
create table if not exists public.armies (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  faction text,
  points int,
  data jsonb not null check (pg_column_size(data) < 200000),
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  data jsonb not null check (pg_column_size(data) < 200000),
  public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists armies_owner on public.armies (owner);
create index if not exists maps_owner on public.maps (owner);

do $$
declare t text;
begin
  foreach t in array array['armies', 'maps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Read shared or own" on public.%I', t);
    execute format('create policy "Read shared or own" on public.%I for select using (public or owner = auth.uid())', t);
    execute format('drop policy if exists "Add own" on public.%I', t);
    execute format('create policy "Add own" on public.%I for insert with check (owner = auth.uid())', t);
    execute format('drop policy if exists "Change own" on public.%I', t);
    execute format('create policy "Change own" on public.%I for update using (owner = auth.uid()) with check (owner = auth.uid())', t);
    execute format('drop policy if exists "Delete own" on public.%I', t);
    execute format('create policy "Delete own" on public.%I for delete using (owner = auth.uid())', t);
  end loop;
end $$;

-- Finished games. Only the game server writes these (with the service key), once both players have confirmed the result.
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  room text not null,
  scenario text,
  p1 uuid references public.profiles on delete set null,
  p2 uuid references public.profiles on delete set null,
  p1_army text,
  p2_army text,
  winner text not null check (winner in ('p1', 'p2', 'draw')),
  p1_vp int,
  p2_vp int,
  turns int,
  played_at timestamptz not null default now()
);
create index if not exists results_p1 on public.results (p1);
create index if not exists results_p2 on public.results (p2);
alter table public.results enable row level security;
drop policy if exists "Results are public" on public.results;
create policy "Results are public" on public.results for select using (true);

-- Each player's record, for profiles and the leaderboard.
create or replace view public.player_stats with (security_invoker = true) as
select
  p.id,
  p.username,
  p.avatar_url,
  count(r.id)::int as games,
  count(r.id) filter (where (r.winner = 'p1' and r.p1 = p.id) or (r.winner = 'p2' and r.p2 = p.id))::int as wins,
  count(r.id) filter (where r.winner = 'draw')::int as draws,
  count(r.id) filter (where (r.winner = 'p2' and r.p1 = p.id) or (r.winner = 'p1' and r.p2 = p.id))::int as losses
from public.profiles p
left join public.results r on r.p1 = p.id or r.p2 = p.id
group by p.id;

-- Who may reach each table through Supabase's API. Row-level security above still decides which rows.
-- Spelled out so this works whether or not the project exposes new tables automatically.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.results, public.player_stats, public.armies, public.maps to anon, authenticated;
grant insert, update, delete on public.armies, public.maps to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.results from anon, authenticated;
revoke insert, update, delete on public.armies, public.maps from anon;

-- Games in progress, so a deploy or restart doesn't lose them. Only the game server reads and writes these (with the
-- service key); nobody else can see them, since a private game's invite code is kept here too.
create table if not exists public.rooms (
  id text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  state jsonb not null check (pg_column_size(state) < 2000000),
  invite text,
  voice text,
  updated_at timestamptz not null default now()
);
create index if not exists rooms_updated on public.rooms (updated_at);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
grant select, insert, update, delete on public.rooms to service_role;
