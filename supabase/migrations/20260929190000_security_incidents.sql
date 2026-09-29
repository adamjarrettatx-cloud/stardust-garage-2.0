-- Staff-only incident history and explicit per-shift rule reminders.
-- Apply BEFORE deploying code that requires these tables. No guest data changed.
begin;
create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  subject_key text not null,
  identity_keys text[] not null check (cardinality(identity_keys) between 1 and 1000),
  full_name text not null check (length(full_name) between 1 and 160),
  category text not null check (category in ('photography','altercation','harassment','other')),
  action text not null check (action in ('warning','final_warning','review','ban')),
  note text not null check (length(btrim(note)) between 1 and 1500),
  actor_id uuid not null references auth.users(id),
  actor_label text not null,
  created_at timestamptz not null default now(),
  event_id uuid references public.events(id),
  door_session_id uuid references public.door_sessions(id),
  restriction_id uuid references public.access_restrictions(id),
  unique(actor_id,request_id),
  check ((action in ('ban','review')) = (restriction_id is not null))
);
create index security_incidents_identity_idx on public.security_incidents using gin(identity_keys);
create index security_incidents_created_idx on public.security_incidents(created_at desc);
create table public.security_warning_reminders (
  id uuid primary key default gen_random_uuid(),
  identity_keys text[] not null check (cardinality(identity_keys) between 1 and 1000),
  incident_ids uuid[] not null check (cardinality(incident_ids) between 1 and 1000),
  shift_day date not null,
  actor_id uuid not null references auth.users(id),
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index security_warning_reminders_identity_idx on public.security_warning_reminders using gin(identity_keys);
create index security_warning_reminders_shift_idx on public.security_warning_reminders(shift_day);
alter table public.security_incidents enable row level security;
alter table public.security_warning_reminders enable row level security;
revoke all on public.security_incidents, public.security_warning_reminders from public,anon,authenticated;
grant select,insert on public.security_incidents, public.security_warning_reminders to service_role;

create function public.reject_security_history_change() returns trigger
language plpgsql set search_path=public as $$
begin raise exception 'Security history is append-only'; end $$;
create trigger security_incidents_immutable before update or delete on public.security_incidents
  for each row execute function public.reject_security_history_change();
create trigger security_reminders_immutable before update or delete on public.security_warning_reminders
  for each row execute function public.reject_security_history_change();
revoke all on function public.reject_security_history_change() from public,anon,authenticated;

-- Caller and current privileges are rechecked in the database. Restriction and
-- incident are committed in ONE transaction, including the existing ban audit.
create function public.record_security_incident(p_actor uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare
  v_label text; v_id uuid; v_restriction uuid; v_existing public.security_incidents;
  v_keys text[]; v_match text[]; v_session uuid; v_event uuid; v_request uuid;
begin
  select coalesce(nullif(full_name,''),'Staff') into v_label from public.team_members
    where user_id=p_actor and role in ('admin','team','front_desk');
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_data->>'identity_confirmed' is distinct from 'true' then
    raise exception 'Confirm guest identity first'; end if;
  if p_data->>'action' in ('ban','review') and p_data->>'restriction_confirmed' is distinct from 'true' then
    raise exception 'Confirm the restriction first'; end if;
  v_request := (p_data->>'request_id')::uuid;
  if v_request is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||v_request::text,0));
  select * into v_existing from public.security_incidents where actor_id=p_actor and request_id=v_request;
  if found then
    if v_existing.subject_key is distinct from p_data->>'subject_key'
      or v_existing.action is distinct from p_data->>'action'
      or v_existing.category is distinct from p_data->>'category'
      or v_existing.note is distinct from btrim(p_data->>'note') then
      raise exception 'Request ID already used for another incident'; end if;
    return v_existing.id;
  end if;
  select coalesce(array_agg(value),'{}') into v_keys from jsonb_array_elements_text(p_data->'identity_keys');
  select coalesce(array_agg(value),'{}') into v_match from jsonb_array_elements_text(p_data->'match_keys');
  if not ((p_data->>'subject_key')=any(v_keys)) then raise exception 'Linked identity required'; end if;
  select id,event_id into v_session,v_event from public.door_sessions
    where closed_at is null order by opened_at desc limit 1;
  if p_data->>'action' in ('ban','review') then
    v_restriction := public.manage_access_restriction(p_actor,'create',jsonb_build_object(
      'full_name',p_data->>'full_name','kind',case when p_data->>'action'='ban' then 'banned' else 'review' end,
      'reason',p_data->>'note','identity_keys',to_jsonb(v_keys),'match_keys',to_jsonb(v_match)));
  end if;
  insert into public.security_incidents(request_id,subject_key,identity_keys,full_name,category,action,note,
    actor_id,actor_label,event_id,door_session_id,restriction_id)
  values(v_request,p_data->>'subject_key',v_keys,p_data->>'full_name',p_data->>'category',p_data->>'action',
    btrim(p_data->>'note'),p_actor,v_label,v_event,v_session,v_restriction) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_security_incident(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_security_incident(uuid,jsonb) to service_role;

create function public.record_security_reminder(p_actor uuid,p_keys text[],p_incidents uuid[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare v_label text; v_id uuid; v_count integer; v_day date;
begin
  select coalesce(nullif(full_name,''),'Staff') into v_label from public.team_members
    where user_id=p_actor and role in ('admin','team','front_desk');
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_incidents),0) not between 1 and 1000
    or coalesce(cardinality(p_keys),0) not between 1 and 1000 then raise exception 'Warnings and identity required'; end if;
  select count(*) into v_count from public.security_incidents
    where id=any(p_incidents) and identity_keys && p_keys and action in ('warning','final_warning');
  if v_count<>cardinality(p_incidents) then raise exception 'Warnings do not match guest'; end if;
  -- Matches arrival-roster.shiftWindow: a venue shift turns over at 6am local.
  v_day := ((now() at time zone 'America/Chicago') - interval '6 hours')::date;
  insert into public.security_warning_reminders(identity_keys,incident_ids,shift_day,actor_id,actor_label)
    values(p_keys,p_incidents,v_day,p_actor,v_label) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_security_reminder(uuid,text[],uuid[]) from public,anon,authenticated;
grant execute on function public.record_security_reminder(uuid,text[],uuid[]) to service_role;
commit;
