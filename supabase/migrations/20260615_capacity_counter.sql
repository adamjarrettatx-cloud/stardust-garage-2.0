-- =========================================================
-- Real-time Capacity Counter — Phase 1  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * creates two new tables (public.capacity_sessions, public.capacity_events)
--   * creates a public.is_team() helper mirroring the existing is_admin()
--   * creates SECURITY DEFINER RPCs for atomic count mutations
--   * adds RLS policies that reuse is_admin() / is_team()
-- It does NOT alter or drop any existing column, table, policy, or the paused
-- POS work. Nothing here touches TicketTailor, Stripe, or documents.
--
-- Purpose: drive the door-counter web UI on the two Jelly2 devices + a
-- read-only Raspberry Pi display. One "session" represents a night/event with
-- a configurable max_capacity. Every check-in / check-out / reset / adjust is
-- recorded in capacity_events as an immutable audit log. The current count
-- lives on the session row and is mutated ONLY through the RPCs below so two
-- simultaneous door taps can never corrupt it (row lock + atomic update).
--
-- Security model (consistent with documents_hub / event_ticket_metrics):
--   * is_admin() / is_team() read from the server-controlled team_members
--     table, NOT user_metadata (Supabase advisor 0015).
--   * Mutating RPCs are SECURITY DEFINER and re-check is_team() internally,
--     so even though they run as owner they refuse non-team callers.
--   * Audit log (capacity_events) is insert+select only for clients; no
--     update/delete policy exists, so history is immutable except to
--     service_role (which bypasses RLS).
--   * Realtime: both tables are added to the supabase_realtime publication so
--     the door/display pages get live postgres_changes updates.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Team-role helper (admin OR team). Mirrors the existing is_admin() definer.
-- ---------------------------------------------------------------------------
create or replace function public.is_team()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid() and role in ('admin','team')
  );
$$;
revoke all on function public.is_team() from public;
grant execute on function public.is_team() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Sessions: one active "night" with a configurable max capacity.
-- ---------------------------------------------------------------------------
create table if not exists public.capacity_sessions (
  id uuid primary key default gen_random_uuid(),

  name text not null default 'Tonight',
  max_capacity integer not null default 100
    check (max_capacity > 0),

  -- Live count. Never written directly by clients — only via the RPCs, which
  -- clamp it to [0, max_capacity]. The CHECK is a belt-and-suspenders backstop.
  current_count integer not null default 0
    check (current_count >= 0),

  -- Exactly one session should be active at a time. Enforced by the partial
  -- unique index below (one row where is_active = true).
  is_active boolean not null default true,

  -- Bookkeeping. created_by is the team member who started the session.
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active session at a time.
create unique index if not exists capacity_sessions_one_active_idx
  on public.capacity_sessions (is_active)
  where is_active;

create index if not exists capacity_sessions_active_idx  on public.capacity_sessions(is_active);
create index if not exists capacity_sessions_started_idx on public.capacity_sessions(started_at desc);

-- ---------------------------------------------------------------------------
-- Events: immutable audit log of every action against a session.
-- ---------------------------------------------------------------------------
create table if not exists public.capacity_events (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.capacity_sessions(id) on delete cascade,

  -- What happened. 'blocked_*' rows record an attempt that was refused (at max
  -- or at zero) so we keep an honest trail of door activity, not just success.
  action text not null check (action in (
    'check_in', 'check_out', 'reset', 'adjust',
    'start_session', 'end_session',
    'blocked_full', 'blocked_empty'
  )),

  -- Signed change applied to the count for this row (+1, -1, delta, or 0 for
  -- blocked/start/end). count_after is the resulting live count.
  delta        integer not null default 0,
  count_after  integer not null,
  max_capacity integer not null,

  -- Who/what. actor_id is null for service-role/system writes. source labels
  -- which physical station produced the tap (front_door / exit_door / etc).
  actor_id uuid references auth.users(id) on delete set null,
  source   text not null default 'unknown'
    check (source in ('front_door', 'exit_door', 'admin', 'display', 'system', 'unknown')),
  note text,

  created_at timestamptz not null default now()
);

create index if not exists capacity_events_session_idx on public.capacity_events(session_id, created_at desc);
create index if not exists capacity_events_action_idx  on public.capacity_events(action);

-- Keep capacity_sessions.updated_at fresh on every write.
create or replace function public.capacity_sessions_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists capacity_sessions_set_updated_trg on public.capacity_sessions;
create trigger capacity_sessions_set_updated_trg
before update on public.capacity_sessions
for each row execute function public.capacity_sessions_set_updated();

-- ===========================================================================
-- Atomic mutation RPCs.
--
-- All are SECURITY DEFINER and re-check is_team() so a leaked anon/JWT cannot
-- mutate the count. Each takes a row lock (SELECT ... FOR UPDATE) on the
-- session, applies the clamped change, and inserts the audit row in the SAME
-- transaction. Two concurrent door taps therefore serialize: the second waits
-- for the first to commit, reads the updated count, and clamps correctly.
--
-- They return the full session row (jsonb) so the caller has the authoritative
-- post-mutation state without a second round trip.
-- ===========================================================================

-- Internal: serialize on the active session, returns the locked row.
create or replace function public._capacity_lock_active()
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  select * into s from public.capacity_sessions
    where is_active = true
    order by started_at desc
    limit 1
    for update;
  if not found then
    raise exception 'No active capacity session' using errcode = 'P0002';
  end if;
  return s;
end; $$;

-- check-in (+1). Blocks at max_capacity; records a blocked_full audit row and
-- raises so the caller can show a clear "at capacity" state.
create or replace function public.capacity_check_in(p_source text default 'front_door', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if not public.is_team() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  s := public._capacity_lock_active();

  if s.current_count >= s.max_capacity then
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
      values (s.id, 'blocked_full', 0, s.current_count, s.max_capacity, auth.uid(), coalesce(p_source,'front_door'), p_note);
    raise exception 'At capacity' using errcode = 'P0001';
  end if;

  update public.capacity_sessions
    set current_count = current_count + 1
    where id = s.id
    returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'check_in', 1, s.current_count, s.max_capacity, auth.uid(), coalesce(p_source,'front_door'), p_note);
  return s;
end; $$;

-- check-out (-1). Blocks at 0; records a blocked_empty audit row and raises.
create or replace function public.capacity_check_out(p_source text default 'exit_door', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if not public.is_team() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  s := public._capacity_lock_active();

  if s.current_count <= 0 then
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
      values (s.id, 'blocked_empty', 0, s.current_count, s.max_capacity, auth.uid(), coalesce(p_source,'exit_door'), p_note);
    raise exception 'Already empty' using errcode = 'P0001';
  end if;

  update public.capacity_sessions
    set current_count = current_count - 1
    where id = s.id
    returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'check_out', -1, s.current_count, s.max_capacity, auth.uid(), coalesce(p_source,'exit_door'), p_note);
  return s;
end; $$;

-- reset to 0. Team-allowed; intended for end-of-night or correcting drift.
create or replace function public.capacity_reset(p_source text default 'admin', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; prev integer;
begin
  if not public.is_team() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  s := public._capacity_lock_active();
  prev := s.current_count;

  update public.capacity_sessions set current_count = 0 where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'reset', -prev, 0, s.max_capacity, auth.uid(), coalesce(p_source,'admin'), p_note);
  return s;
end; $$;

-- adjust to an explicit value (clamped to [0, max_capacity]). For manual
-- corrections. Admin-only — a wider blast radius than a single door tap.
create or replace function public.capacity_adjust(p_target integer, p_source text default 'admin', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; prev integer; target integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  s := public._capacity_lock_active();
  prev := s.current_count;
  target := greatest(0, least(coalesce(p_target, prev), s.max_capacity));

  update public.capacity_sessions set current_count = target where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'adjust', target - prev, target, s.max_capacity, auth.uid(), coalesce(p_source,'admin'), p_note);
  return s;
end; $$;

-- start a new session (deactivates any currently-active one first). Admin-only.
create or replace function public.capacity_start_session(p_name text default 'Tonight', p_max integer default 100)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(p_max, 0) <= 0 then
    raise exception 'max_capacity must be positive' using errcode = '22023';
  end if;

  -- Close out any active session so the partial unique index is satisfied.
  update public.capacity_sessions
    set is_active = false, ended_at = coalesce(ended_at, now())
    where is_active = true;

  insert into public.capacity_sessions(name, max_capacity, current_count, is_active, created_by, started_at)
    values (coalesce(nullif(trim(p_name), ''), 'Tonight'), p_max, 0, true, auth.uid(), now())
    returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'start_session', 0, 0, s.max_capacity, auth.uid(), 'admin', 'Session started');
  return s;
end; $$;

-- end the active session. Admin-only.
create or replace function public.capacity_end_session(p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  s := public._capacity_lock_active();

  update public.capacity_sessions
    set is_active = false, ended_at = now()
    where id = s.id
    returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    values (s.id, 'end_session', 0, s.current_count, s.max_capacity, auth.uid(), 'admin', coalesce(p_note,'Session ended'));
  return s;
end; $$;

-- Lock down RPC execution. service_role + authenticated may call; the internal
-- is_team()/is_admin() checks enforce role. The lock helper is internal only.
revoke all on function public._capacity_lock_active() from public;
revoke all on function public.capacity_check_in(text, text) from public;
revoke all on function public.capacity_check_out(text, text) from public;
revoke all on function public.capacity_reset(text, text) from public;
revoke all on function public.capacity_adjust(integer, text, text) from public;
revoke all on function public.capacity_start_session(text, integer) from public;
revoke all on function public.capacity_end_session(text) from public;
grant execute on function public.capacity_check_in(text, text) to authenticated;
grant execute on function public.capacity_check_out(text, text) to authenticated;
grant execute on function public.capacity_reset(text, text) to authenticated;
grant execute on function public.capacity_adjust(integer, text, text) to authenticated;
grant execute on function public.capacity_start_session(text, integer) to authenticated;
grant execute on function public.capacity_end_session(text) to authenticated;

-- ===========================================================================
-- RLS. Reads are team-or-admin; the count is internal staff data, not public.
-- All client mutations go through the SECURITY DEFINER RPCs above, so the
-- tables themselves only need a select policy for clients (plus an insert
-- policy on events for admin manual entry). service_role bypasses RLS.
-- ===========================================================================
alter table public.capacity_sessions enable row level security;
alter table public.capacity_events   enable row level security;

drop policy if exists capacity_sessions_team_select on public.capacity_sessions;
drop policy if exists capacity_sessions_admin_write on public.capacity_sessions;
create policy capacity_sessions_team_select on public.capacity_sessions
  for select to authenticated using (public.is_team());
-- Admins may directly write session rows (e.g. rename) as an escape hatch;
-- normal flow uses the RPCs.
create policy capacity_sessions_admin_write on public.capacity_sessions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists capacity_events_team_select on public.capacity_events;
drop policy if exists capacity_events_admin_insert on public.capacity_events;
create policy capacity_events_team_select on public.capacity_events
  for select to authenticated using (public.is_team());
-- No update/delete policy: the audit log is immutable to clients.
create policy capacity_events_admin_insert on public.capacity_events
  for insert to authenticated with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Realtime: publish both tables so the door/display pages receive live
-- postgres_changes events. Wrapped so re-running is a no-op if already added.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.capacity_sessions;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.capacity_events;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;
