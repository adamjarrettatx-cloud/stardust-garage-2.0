-- SECURITY: Lock down direct PostgREST RPC access for capacity mutations.
--
-- The affected functions run as SECURITY DEFINER. Each ordinary capacity RPC
-- now requires an authenticated JWT before evaluating the existing team/admin
-- role helper. Device RPCs remain server-mediated: only the service-role client
-- may invoke them after the route has verified the hashed device credential.

begin;

create or replace function public.capacity_check_in(p_source text default 'front_door', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_check_out(p_source text default 'exit_door', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_reset(p_source text default 'admin', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; prev integer;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_adjust(p_target integer, p_source text default 'admin', p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; prev integer; target integer;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_start_session(p_name text default 'Tonight', p_max integer default 100)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_end_session(p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public._capacity_require_device(p_device_id uuid, p_expected_role text)
returns public.capacity_device_tokens language plpgsql security definer
set search_path = public, auth as $$
declare d public.capacity_device_tokens;
begin
  if auth.role() <> 'service_role' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

create or replace function public.capacity_device_check_in(p_device_id uuid, p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  if auth.role() <> 'service_role' then
    raise exception 'access denied' using errcode = '42501';
  end if;
  d := public._capacity_require_device(p_device_id, 'front_door');
  s := public._capacity_lock_active();

  if s.current_count >= s.max_capacity then
    -- NOTE: this audit insert (and any last_used_at touch) is rolled back by
    -- the RAISE below — the function aborts the whole statement. We intentionally
    -- do NOT stamp last_used_at here: it would be discarded anyway, and the
    -- ~4s status poll (capacity_device_touch) keeps last_used_at fresh.
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
      values (s.id, 'blocked_full', 0, s.current_count, s.max_capacity, null, 'front_door', p_note, d.id);
    raise exception 'At capacity' using errcode = 'P0001';
  end if;

  update public.capacity_sessions set current_count = current_count + 1 where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
    values (s.id, 'check_in', 1, s.current_count, s.max_capacity, null, 'front_door', p_note, d.id);
  update public.capacity_device_tokens set last_used_at = now() where id = d.id;
  return s;
end; $$;

create or replace function public.capacity_device_check_out(p_device_id uuid, p_note text default null)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  if auth.role() <> 'service_role' then
    raise exception 'access denied' using errcode = '42501';
  end if;
  d := public._capacity_require_device(p_device_id, 'exit_door');
  s := public._capacity_lock_active();

  if s.current_count <= 0 then
    -- NOTE: this audit insert (and any last_used_at touch) is rolled back by
    -- the RAISE below — the function aborts the whole statement. We intentionally
    -- do NOT stamp last_used_at here: it would be discarded anyway, and the
    -- ~4s status poll (capacity_device_touch) keeps last_used_at fresh.
    insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
      values (s.id, 'blocked_empty', 0, s.current_count, s.max_capacity, null, 'exit_door', p_note, d.id);
    raise exception 'Already empty' using errcode = 'P0001';
  end if;

  update public.capacity_sessions set current_count = current_count - 1 where id = s.id returning * into s;

  insert into public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note, device_id)
    values (s.id, 'check_out', -1, s.current_count, s.max_capacity, null, 'exit_door', p_note, d.id);
  update public.capacity_device_tokens set last_used_at = now() where id = d.id;
  return s;
end; $$;

create or replace function public.capacity_device_touch(p_device_id uuid)
returns public.capacity_sessions language plpgsql security definer
set search_path = public, auth as $$
declare s public.capacity_sessions; d public.capacity_device_tokens;
begin
  if auth.role() <> 'service_role' then
    raise exception 'access denied' using errcode = '42501';
  end if;
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

-- Never leave execute rights to inherited/default roles. Normal staff actions
-- are available only to authenticated callers; device actions only to the
-- server's service role after route-side token verification.
revoke all on function public._capacity_lock_active() from public, anon, authenticated, service_role;
revoke all on function public._capacity_require_device(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_check_in(text, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_check_out(text, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_reset(text, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_adjust(integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_start_session(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.capacity_end_session(text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_device_check_in(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_device_check_out(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.capacity_device_touch(uuid) from public, anon, authenticated, service_role;

grant execute on function public.capacity_check_in(text, text) to authenticated;
grant execute on function public.capacity_check_out(text, text) to authenticated;
grant execute on function public.capacity_reset(text, text) to authenticated;
grant execute on function public.capacity_adjust(integer, text, text) to authenticated;
grant execute on function public.capacity_start_session(text, integer) to authenticated;
grant execute on function public.capacity_end_session(text) to authenticated;
grant execute on function public.capacity_device_check_in(uuid, text) to service_role;
grant execute on function public.capacity_device_check_out(uuid, text) to service_role;
grant execute on function public.capacity_device_touch(uuid) to service_role;

commit;
