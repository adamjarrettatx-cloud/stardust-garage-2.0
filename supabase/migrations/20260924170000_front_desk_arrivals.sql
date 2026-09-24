-- Durable named roster admission. No change to QR activation, ticket redemption,
-- member entitlements, or the existing generic capacity RPCs.
create table public.front_desk_arrivals (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('trial_pass','member','guest')),
  subject_id uuid not null,
  identity_keys text[] not null check (cardinality(identity_keys) > 0),
  shift_day date not null,
  checked_in_at timestamptz not null default clock_timestamp(),
  checked_in_by uuid references auth.users(id) on delete set null,
  capacity_session_id uuid not null references public.capacity_sessions(id),
  door_session_id uuid references public.door_sessions(id),
  unique (shift_day, subject_kind, subject_id)
);
create index front_desk_arrivals_shift_idx on public.front_desk_arrivals(shift_day, checked_in_at desc);
create index front_desk_arrivals_identity_idx on public.front_desk_arrivals using gin(identity_keys);
alter table public.front_desk_arrivals enable row level security;
revoke all on public.front_desk_arrivals from public, anon, authenticated;
grant select, insert on public.front_desk_arrivals to service_role;

-- ONLY the server route may invoke this, after fresh access/eligibility checks.
-- Serialize with the SAME capacity row lock as other counter operations.
-- A duplicate retry returns the original timestamp and never increases capacity.
create or replace function public.front_desk_roster_check_in(
  p_kind text, p_id uuid, p_identity_keys text[], p_actor uuid, p_door_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  s public.capacity_sessions;
  arrival public.front_desk_arrivals;
  day_key date := ((now() at time zone 'America/Chicago') - interval '6 hours')::date;
  actual_door_session uuid;
begin
  if p_actor is null or not exists (
    select 1 from public.team_members where user_id=p_actor and role in ('admin','team','front_desk')
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('trial_pass','member','guest') or p_id is null
    or p_identity_keys is null or cardinality(p_identity_keys)=0
    or cardinality(p_identity_keys)>100
    or not (p_kind || ':' || p_id::text = any(p_identity_keys))
  then raise exception 'Invalid identity' using errcode='22023'; end if;
  -- Verify the event context has not changed since the route checked eligibility.
  select id into actual_door_session from public.door_sessions where closed_at is null
    order by opened_at desc limit 1 for share;
  if actual_door_session is distinct from p_door_session_id then
    raise exception 'Event changed. Refresh before checking in.' using errcode='P0001';
  end if;
  s := public._capacity_lock_active();
  select * into arrival from public.front_desk_arrivals
    where shift_day=day_key and identity_keys && p_identity_keys
    order by checked_in_at desc limit 1;
  if found then
    return jsonb_build_object('alreadyCheckedIn',true,'arrival',to_jsonb(arrival));
  end if;
  if s.current_count >= s.max_capacity then
    raise exception 'At capacity. Hold entry.' using errcode='P0001';
  end if;
  insert into public.front_desk_arrivals (
    subject_kind,subject_id,identity_keys,shift_day,checked_in_by,capacity_session_id,door_session_id
  ) values (p_kind,p_id,p_identity_keys,day_key,p_actor,s.id,actual_door_session) returning * into arrival;
  update public.capacity_sessions set current_count=current_count+1 where id=s.id returning * into s;
  insert into public.capacity_events(session_id,action,delta,count_after,max_capacity,actor_id,source,note)
    values(s.id,'check_in',1,s.current_count,s.max_capacity,p_actor,'front_door',
      'Front desk roster: ' || p_kind || ':' || p_id::text || ' arrival:' || arrival.id::text);
  return jsonb_build_object('alreadyCheckedIn',false,'arrival',to_jsonb(arrival));
end $$;
revoke all on function public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid) to service_role;
