-- Shared station identities deliberately have NO team_members row.
-- Supabase Auth checks passwords, but its tokens NEVER go to the browser.
-- Only service-role API routes can use the station/session tables and RPCs.
begin;
create table public.station_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  username text not null unique check(username ~ '^[a-z][a-z0-9-]{2,31}$'),
  label text not null check(length(btrim(label)) between 1 and 80),
  role text not null check(role in ('security','front_desk')),
  auth_email text not null unique,
  active boolean not null default true,
  epoch integer not null default 1,
  reset_started_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.station_sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  station_id uuid not null references public.station_accounts(id),
  epoch integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check(expires_at <= created_at + interval '12 hours')
);
create index station_sessions_account_idx on public.station_sessions(station_id);
create table public.station_access_events (
  id bigint generated always as identity primary key,
  station_id uuid references public.station_accounts(id),
  actor_id uuid references auth.users(id),
  action text not null,
  created_at timestamptz not null default now()
);
create table public.station_login_limits (
  bucket text primary key,
  attempts integer not null,
  window_start timestamptz not null
);
alter table public.station_accounts enable row level security;
alter table public.station_sessions enable row level security;
alter table public.station_access_events enable row level security;
alter table public.station_login_limits enable row level security;
revoke all on public.station_accounts,public.station_sessions,public.station_access_events,public.station_login_limits from public,anon,authenticated;
revoke all on public.station_accounts,public.station_sessions,public.station_access_events,public.station_login_limits from service_role;
grant select,insert,update on public.station_accounts,public.station_sessions,public.station_login_limits to service_role;
grant delete on public.station_sessions,public.station_login_limits to service_role;
grant select,insert on public.station_access_events to service_role;
grant usage,select on sequence public.station_access_events_id_seq to service_role;
create trigger station_audit_immutable before update or delete on public.station_access_events
  for each row execute function public.reject_security_history_change();

-- The station mapping must never also be a personal/team identity.
create function public.prevent_station_team_membership() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='team_members' then
    if exists(select 1 from public.station_accounts where user_id=new.user_id) then
      raise exception 'Station accounts cannot become team members' using errcode='42501';
    end if;
  elsif exists(select 1 from public.team_members where user_id=new.user_id) then
    raise exception 'Team members cannot become station accounts' using errcode='42501';
  end if;
  return new;
end $$;
create trigger no_station_team before insert or update on public.team_members
  for each row execute function public.prevent_station_team_membership();
create trigger no_team_station before insert or update on public.station_accounts
  for each row execute function public.prevent_station_team_membership();
revoke all on function public.prevent_station_team_membership() from public,anon,authenticated;

-- Atomic shared counters. IP and username hashes have independent buckets.
-- Limits cannot be reset by opening another serverless instance.
create function public.consume_station_login_limit(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_attempts integer;
begin
  if length(p_bucket)>160 or p_limit not between 1 and 1000 or p_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit';
  end if;
  insert into public.station_login_limits(bucket,attempts,window_start)
    values(p_bucket,1,clock_timestamp())
  on conflict(bucket) do update set
    attempts=case when station_login_limits.window_start <= clock_timestamp()-make_interval(secs=>p_seconds)
      then 1 else station_login_limits.attempts+1 end,
    window_start=case when station_login_limits.window_start <= clock_timestamp()-make_interval(secs=>p_seconds)
      then clock_timestamp() else station_login_limits.window_start end
  returning attempts into v_attempts;
  delete from public.station_login_limits where window_start < now()-interval '2 days';
  return v_attempts<=p_limit;
end $$;

create function public.resolve_station_session(p_hash text)
returns table(id uuid,user_id uuid,username text,label text,role text,expires_at timestamptz)
language sql stable security invoker set search_path=public as $$
  select a.id,a.user_id,a.username,a.label,a.role,s.expires_at
  from public.station_sessions s join public.station_accounts a on a.id=s.station_id
  where s.token_hash=p_hash and a.active and a.reset_started_at is null
    and s.epoch=a.epoch and s.revoked_at is null and s.expires_at>now()
$$;

create function public.open_station_session(p_station uuid,p_epoch integer,p_hash text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare a public.station_accounts;
begin
  select * into a from public.station_accounts where id=p_station for update;
  if not found or not a.active or a.epoch<>p_epoch or a.reset_started_at is not null then return false; end if;
  insert into public.station_sessions(token_hash,station_id,epoch,expires_at)
    values(p_hash,a.id,a.epoch,now()+interval '12 hours');
  insert into public.station_access_events(station_id,actor_id,action) values(a.id,a.user_id,'login');
  delete from public.station_sessions where expires_at < now()-interval '7 days';
  return true;
end $$;

create function public.close_station_session(p_hash text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_id uuid;
begin
  update public.station_sessions set revoked_at=now() where token_hash=p_hash and revoked_at is null returning station_id into v_id;
  if v_id is not null then
    insert into public.station_access_events(station_id,actor_id,action)
      select id,user_id,'logout' from public.station_accounts where id=v_id;
  end if;
end $$;

create function public.manage_station_access(p_actor uuid,p_station uuid,p_action text,p_epoch integer default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a public.station_accounts; was_active boolean;
begin
  if not exists(select 1 from public.team_members where user_id=p_actor and role='admin' and email='adam@sdgatx.com') then
    raise exception 'Owner required' using errcode='42501';
  end if;
  select * into a from public.station_accounts where id=p_station for update;
  if not found then raise exception 'Station not found'; end if;
  was_active:=a.active;
  if p_action='finish_reset' then
    if a.epoch is distinct from p_epoch or a.reset_started_at is null then raise exception 'Reset superseded'; end if;
    update public.station_accounts set reset_started_at=null where id=a.id;
  elsif p_action in ('disable','enable','revoke','reset') then
    if p_action='enable' and a.reset_started_at is not null then raise exception 'Complete password reset first'; end if;
    if p_action='reset' and a.reset_started_at>now()-interval '5 minutes' then raise exception 'Password reset already in progress'; end if;
    update public.station_accounts set epoch=epoch+1,
      active=case when p_action='disable' then false when p_action='enable' then true else active end,
      reset_started_at=case when p_action='reset' then now() else reset_started_at end
      where id=a.id returning epoch into a.epoch;
    update public.station_sessions set revoked_at=now() where station_id=a.id and revoked_at is null;
  else raise exception 'Unknown station action'; end if;
  insert into public.station_access_events(station_id,actor_id,action) values(a.id,p_actor,p_action);
  return jsonb_build_object('epoch',a.epoch,'was_active',was_active);
end $$;

create function public.create_station_account(p_actor uuid,p_user uuid,p_username text,p_label text,p_role text,p_email text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a public.station_accounts;
begin
  if not exists(select 1 from public.team_members where user_id=p_actor and role='admin' and email='adam@sdgatx.com') then
    raise exception 'Owner required' using errcode='42501';
  end if;
  insert into public.station_accounts(user_id,username,label,role,auth_email,created_by)
    values(p_user,p_username,p_label,p_role,p_email,p_actor) returning * into a;
  insert into public.station_access_events(station_id,actor_id,action) values(a.id,p_actor,'create');
  return jsonb_build_object('id',a.id,'username',a.username,'label',a.label,'role',a.role,'active',a.active);
end $$;

-- Capacity operations receive the verified opaque-session hash, never a
-- client-supplied actor. No impersonation or changes to JWT claims are used.
create function public.station_capacity_operation(p_hash text,p_op text,p_source text,p_note text)
returns public.capacity_sessions language plpgsql security definer set search_path=public as $$
declare a record; s public.capacity_sessions; delta integer;
begin
  select * into a from public.resolve_station_session(p_hash);
  if not found or a.role<>'front_desk' or p_op not in ('check_in','check_out') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  s:=public._capacity_lock_active();
  delta:=case when p_op='check_in' then 1 else -1 end;
  if delta=1 and s.current_count>=s.max_capacity then raise exception 'At capacity' using errcode='P0001'; end if;
  if delta=-1 and s.current_count<=0 then raise exception 'Already empty' using errcode='P0001'; end if;
  update public.capacity_sessions set current_count=current_count+delta where id=s.id returning * into s;
  insert into public.capacity_events(session_id,action,delta,count_after,max_capacity,actor_id,source,note)
    values(s.id,p_op,delta,s.current_count,s.max_capacity,a.user_id,p_source,left(p_note,280));
  return s;
end $$;

-- Narrow extension to existing service-only incident functions. No RLS team
-- predicate is widened. Front Desk can acknowledge warnings; Security records
-- incidents. Shared stations never acquire manager/lift permissions.
do $$
declare def text; signature text;
begin
  foreach signature in array array['public.record_security_incident(uuid,jsonb)','public.record_security_reminder(uuid,text[],uuid[])'] loop
    def:=pg_get_functiondef(signature::regprocedure);
    if position('where user_id=p_actor and role in (''admin'',''team'',''front_desk'');' in def)=0 then
      raise exception 'Security function drift: %',signature;
    end if;
    def:=replace(def,'where user_id=p_actor and role in (''admin'',''team'',''front_desk'');',
      'where user_id=p_actor and role in (''admin'',''team'',''front_desk'');
       if not found then
         select label into v_label from public.station_accounts
         where user_id=p_actor and active and reset_started_at is null and role=' ||
         case when signature like '%record_security_incident%' then '''security''' else '''front_desk''' end || ';
       end if;');
    execute def;
  end loop;
  def:=pg_get_functiondef('public.manage_access_restriction(uuid,text,jsonb)'::regprocedure);
  if position('from public.team_members where user_id = p_actor;' in def)=0 then
    raise exception 'Restriction function drift';
  end if;
  def:=replace(def,'from public.team_members where user_id = p_actor;',
    'from public.team_members where user_id = p_actor;
     if v_role is null then
       select ''front_desk'',label into v_role,v_label from public.station_accounts
         where user_id=p_actor and active and reset_started_at is null
           and ((role=''security'' and p_action=''create'')
             or (role=''front_desk'' and p_action in (''note'',''same_person'',''different_person'')));
     end if;');
  execute def;
  def:=pg_get_functiondef('public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid)'::regprocedure);
  if position('select 1 from public.team_members where user_id=p_actor and role in (''admin'',''team'',''front_desk'')' in def)=0 then
    raise exception 'Roster function drift';
  end if;
  def:=replace(def,
    'select 1 from public.team_members where user_id=p_actor and role in (''admin'',''team'',''front_desk'')',
    'select 1 from public.team_members where user_id=p_actor and role in (''admin'',''team'',''front_desk'')
     union all select 1 from public.station_accounts where user_id=p_actor and role=''front_desk'' and active and reset_started_at is null');
  execute def;
  def:=pg_get_functiondef('public.correct_legal_name(uuid,text,uuid,text,text,text)'::regprocedure);
  if position('from public.team_members where user_id=p_actor;' in def)=0 then
    raise exception 'Legal-name function drift';
  end if;
  def:=replace(def,'from public.team_members where user_id=p_actor;',
    'from public.team_members where user_id=p_actor;
     if v_role is null then
       select ''front_desk'',label into v_role,v_label from public.station_accounts
         where user_id=p_actor and role=''front_desk'' and active and reset_started_at is null;
     end if;');
  execute def;
end $$;

revoke all on function public.consume_station_login_limit(text,integer,integer),
  public.resolve_station_session(text),public.open_station_session(uuid,integer,text),
  public.close_station_session(text),public.manage_station_access(uuid,uuid,text,integer),
  public.create_station_account(uuid,uuid,text,text,text,text),
  public.station_capacity_operation(text,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_station_login_limit(text,integer,integer),
  public.resolve_station_session(text),public.open_station_session(uuid,integer,text),
  public.close_station_session(text),public.manage_station_access(uuid,uuid,text,integer),
  public.create_station_account(uuid,uuid,text,text,text,text),
  public.station_capacity_operation(text,text,text,text) to service_role;
commit;
