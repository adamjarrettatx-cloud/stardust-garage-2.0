-- =========================================================
-- Capacity DOOR DEVICE tokens — Phase 1.1  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE. It builds on 20260615_capacity_counter.sql
-- and does NOT alter or drop any existing table, policy, RPC, or the normal
-- team/admin auth. It adds:
--   * public.capacity_device_tokens  — one row per provisioned door phone
--   * a nullable device_id column on public.capacity_events (audit trail)
--   * SECURITY DEFINER RPCs for device-scoped check-in / check-out / status
--     that stamp the acting device into the audit log
--   * admin-only RLS so the token table is never readable by team/anon clients
--
-- WHY THIS EXISTS
-- The two Unihertz Jelly2 door phones (a front-door check-in station and an
-- exit-door check-out station) currently have to be signed into a real team
-- account. Team/admin accounts are about to gain MFA + 30-day forced logouts,
-- which would be miserable to babysit on two kiosk phones. Instead an admin
-- provisions each device ONCE; the device then holds a long, random, revocable
-- token scoped to exactly one door operation. This is a narrow, revocable
-- bypass for door devices only — it does NOT weaken team/admin auth anywhere.
--
-- SECURITY MODEL
--   * Only the SHA-256 hash of a token is stored (token_hash). The raw token is
--     shown to the admin exactly once at creation and never persisted.
--   * The token table is admin-only under RLS (no team/anon select). The
--     web app verifies a presented token inside a server route using the
--     service-role client (RLS bypassed) AFTER confirming the token's scope,
--     then calls the device RPCs below. The service-role key never leaves the
--     server route.
--   * A front_door token may ONLY check in; an exit_door token may ONLY check
--     out. The device RPCs validate the device's role against the action, so
--     even a mis-dispatched call is refused at the database boundary.
--   * The device RPCs are SECURITY DEFINER and re-verify the device row is
--     active + not revoked + role-matched before mutating. They take the same
--     row lock as the team RPCs, so device taps and team taps serialize safely.
--   * Every device action is written to capacity_events with the device_id and
--     the door source, so the audit log shows which physical phone acted.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Device tokens: one per provisioned door phone.
-- ---------------------------------------------------------------------------
create table if not exists public.capacity_device_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Human label so the admin can tell devices apart ("Front phone (black)").
  label text not null default 'Door device',

  -- Which door this device drives. Constrains what the token may do.
  device_role text not null check (device_role in ('front_door', 'exit_door')),

  -- SHA-256 hex of the raw token. Raw token is NEVER stored. Unique so a
  -- (vanishingly unlikely) collision can't shadow another device.
  token_hash text not null unique,

  -- Lifecycle. `active` is the live switch; `revoked_at` records when it was
  -- turned off. A device is usable only while active = true and revoked_at is
  -- null. We keep revoked rows for the audit trail rather than deleting them.
  active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,

  -- Last time this token was successfully used for any device operation. Helps
  -- the admin spot stale/unused links.
  last_used_at timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists capacity_device_tokens_role_idx   on public.capacity_device_tokens(device_role);
create index if not exists capacity_device_tokens_active_idx  on public.capacity_device_tokens(active);
create index if not exists capacity_device_tokens_created_idx on public.capacity_device_tokens(created_at desc);

-- ---------------------------------------------------------------------------
-- Audit: link each event to the acting device (null for team/admin/system).
-- Additive nullable column; existing rows stay null.
-- ---------------------------------------------------------------------------
alter table public.capacity_events
  add column if not exists device_id uuid references public.capacity_device_tokens(id) on delete set null;

create index if not exists capacity_events_device_idx on public.capacity_events(device_id);

-- ===========================================================================
-- Device-scoped mutation RPCs.
--
-- These are called by the server route AFTER it has verified a presented token
-- (looked up the active row by token_hash via service-role) and resolved the
-- device id. They are SECURITY DEFINER and DEFENSE-IN-DEPTH re-check that the
-- device row is active and that its role matches the requested action, so a
-- bug in the route cannot let a front-door token check someone out (or vice
-- versa). They take the same active-session row lock as the team RPCs.
--
-- actor_id is left null (the device is not a Supabase user); the device_id +
-- source columns identify who acted. They return the full session row (jsonb)
-- so the caller has authoritative post-mutation state.
-- ===========================================================================

-- Internal guard: load an active, non-revoked device of the expected role, or
-- raise. Centralizes the "is this device allowed" check for both RPCs.
create or replace function public._capacity_require_device(p_device_id uuid, p_expected_role text)
returns public.capacity_device_tokens language plpgsql security definer
set search_path = public, auth as $$
declare d public.capacity_device_tokens;
begin
  select * into d from public.capacity_device_tokens
    where id = p_device_id and active = true and revoked_at is null;
  if not found then
    raise exception 'Device not authorized' using errcode = '42501';
  end if;
  if d.device_role is distinct from p_expected_role then
    raise exception 'Device role mismatch' using errcode = '42501';
  end if;
  return d;
end; $$;

-- Device check-in (+1). Only a front_door device may call this. Blocks at max.
create or replace function public.capacity_device_check_in(p_device_id uuid, p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  d := public._capacity_require_device(p_device_id, 'front_door');
  s := public._capacity_lock_active();

  if s.current_count >= s.max_capacity then
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
      values (s.id, 'blocked_full', 0, s.current_count, s.max_capacity, null, 'front_door', p_note, d.id);
    update public.capacity_device_tokens set last_used_at = now() where id = d.id;
    raise exception 'At capacity' using errcode = 'P0001';
  end if;

  update public.capacity_sessions set current_count = current_count + 1 where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
    values (s.id, 'check_in', 1, s.current_count, s.max_capacity, null, 'front_door', p_note, d.id);
  update public.capacity_device_tokens set last_used_at = now() where id = d.id;
  return s;
end; $$;

-- Device check-out (-1). Only an exit_door device may call this. Blocks at 0.
create or replace function public.capacity_device_check_out(p_device_id uuid, p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  d := public._capacity_require_device(p_device_id, 'exit_door');
  s := public._capacity_lock_active();

  if s.current_count <= 0 then
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
      values (s.id, 'blocked_empty', 0, s.current_count, s.max_capacity, null, 'exit_door', p_note, d.id);
    update public.capacity_device_tokens set last_used_at = now() where id = d.id;
    raise exception 'Already empty' using errcode = 'P0001';
  end if;

  update public.capacity_sessions set current_count = current_count - 1 where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
    values (s.id, 'check_out', -1, s.current_count, s.max_capacity, null, 'exit_door', p_note, d.id);
  update public.capacity_device_tokens set last_used_at = now() where id = d.id;
  return s;
end; $$;

-- Device status read: touch last_used_at and return the active session. Lets a
-- device's status poll keep last_used_at fresh without a write op. Read-only on
-- the session; only stamps the device's own last_used_at.
create or replace function public.capacity_device_touch(p_device_id uuid)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  select * into d from public.capacity_device_tokens
    where id = p_device_id and active = true and revoked_at is null;
  if not found then
    raise exception 'Device not authorized' using errcode = '42501';
  end if;
  update public.capacity_device_tokens set last_used_at = now() where id = d.id;

  select * into s from public.capacity_sessions
    where is_active = true order by started_at desc limit 1;
  return s; -- may be null when no active session
end; $$;

-- ---------------------------------------------------------------------------
-- Lock down execution. These RPCs run as owner and are intended to be invoked
-- ONLY by the server route using the service-role key (which is granted to the
-- service_role login). We do NOT grant them to `authenticated` or `anon`: a
-- normal logged-in client uses the existing team RPCs, never these. The
-- internal device + role checks are the real gate regardless of grants.
-- ---------------------------------------------------------------------------
revoke all on function public._capacity_require_device(uuid, text) from public;
revoke all on function public.capacity_device_check_in(uuid, text) from public;
revoke all on function public.capacity_device_check_out(uuid, text) from public;
revoke all on function public.capacity_device_touch(uuid) from public;
grant execute on function public.capacity_device_check_in(uuid, text) to service_role;
grant execute on function public.capacity_device_check_out(uuid, text) to service_role;
grant execute on function public.capacity_device_touch(uuid) to service_role;

-- ===========================================================================
-- RLS on the token table. Admin-only — team members and anon get NOTHING.
-- The web app reads/writes tokens either as an admin (provisioning UI, via the
-- RLS policies below) or as service_role inside the device verification route
-- (service_role bypasses RLS). No team/anon select policy exists, so a leaked
-- team JWT cannot enumerate device tokens.
-- ===========================================================================
alter table public.capacity_device_tokens enable row level security;

drop policy if exists capacity_device_tokens_admin_select on public.capacity_device_tokens;
drop policy if exists capacity_device_tokens_admin_insert on public.capacity_device_tokens;
drop policy if exists capacity_device_tokens_admin_update on public.capacity_device_tokens;
create policy capacity_device_tokens_admin_select on public.capacity_device_tokens
  for select to authenticated using (public.is_admin());
create policy capacity_device_tokens_admin_insert on public.capacity_device_tokens
  for insert to authenticated with check (public.is_admin());
-- Admins may revoke/relabel (update); no delete policy — revoked rows are kept
-- for the audit trail. service_role bypasses RLS for the verification path.
create policy capacity_device_tokens_admin_update on public.capacity_device_tokens
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
