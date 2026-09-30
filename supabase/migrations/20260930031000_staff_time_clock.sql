-- Staff timekeeping v1. Additive; do not apply to production before review.
-- All reads/writes flow through gated server routes. No browser grants.
begin;

create table public.tc_roles (
  id text primary key check (id ~ '^[a-z_]{2,40}$'),
  name text not null check (length(name) between 1 and 80),
  tasks jsonb not null default '[]' check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 30),
  active boolean not null default true
);
insert into public.tc_roles(id,name,tasks) values
 ('bartender','Bartender','["Check bar stock and ice","Keep bar and service area clean","Complete closing inventory"]'),
 ('floor_support','Floor support','["Walk the floor and check restrooms","Clear glassware and reset spaces","Complete final floor walkthrough"]'),
 ('front_door','Front door','["Check entry station and scanner","Follow guest entry procedures","Leave a shift handoff"]');

create table public.tc_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  category text not null check (category in ('employee','contractor')),
  active boolean not null default true,
  pay_basis text not null default 'unset' check (pay_basis in ('unset','hourly','flat')),
  flat_cents integer check (flat_cents between 0 and 100000000),
  pin_lookup text not null unique check (length(pin_lookup) = 64),
  pin_verifier text not null,
  credential_version uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check ((pay_basis = 'flat' and flat_cents is not null) or (pay_basis <> 'flat' and flat_cents is null))
);
create table public.tc_assignments (
  worker_id uuid references public.tc_workers(id) on delete restrict,
  role_id text references public.tc_roles(id) on delete restrict,
  rate_cents integer check (rate_cents between 0 and 100000000),
  primary key(worker_id,role_id)
);
create table public.tc_kiosks (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 80),
  pairing_hash text unique,
  pairing_expires timestamptz,
  token_hash text unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.tc_sessions (
  token_hash text primary key,
  kiosk_id uuid not null references public.tc_kiosks(id),
  worker_id uuid not null references public.tc_workers(id),
  credential_version uuid not null,
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  created_at timestamptz not null default now()
);
create index tc_sessions_expiry on public.tc_sessions(expires_at);
create table public.tc_limits (
  key text primary key,
  attempts integer not null,
  reset_at timestamptz not null
);
create index tc_limits_expiry on public.tc_limits(reset_at);
create table public.tc_shifts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.tc_workers(id),
  kiosk_id uuid not null references public.tc_kiosks(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  pay_basis text not null check (pay_basis in ('unset','hourly','flat')),
  flat_cents integer,
  note text not null default '' check (length(note) <= 2000),
  status text not null default 'open' check (status in ('open','pending','approved')),
  version integer not null default 1,
  check (ended_at is null or ended_at >= started_at),
  check ((ended_at is null and status = 'open') or (ended_at is not null and status <> 'open'))
);
create unique index tc_one_open_shift on public.tc_shifts(worker_id) where ended_at is null;
create index tc_shifts_worker_start on public.tc_shifts(worker_id,started_at desc);
create index tc_shifts_start on public.tc_shifts(started_at desc);
create table public.tc_segments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.tc_shifts(id),
  role_id text not null references public.tc_roles(id),
  role_name text not null,
  rate_cents integer,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index tc_one_open_segment on public.tc_segments(shift_id) where ended_at is null;
create index tc_segments_shift on public.tc_segments(shift_id,started_at);
create table public.tc_breaks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.tc_shifts(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  -- v1 logs only counted time; no automatic unpaid-break deductions.
  paid boolean not null default true check(paid),
  check (ended_at is null or ended_at >= started_at)
);
create unique index tc_one_open_break on public.tc_breaks(shift_id) where ended_at is null;
create index tc_breaks_shift on public.tc_breaks(shift_id);
create table public.tc_tasks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.tc_shifts(id),
  role_id text not null references public.tc_roles(id),
  title text not null check(length(title) between 1 and 240),
  done boolean not null default false,
  completed_at timestamptz,
  unique(shift_id,role_id,title)
);
create table public.tc_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  shift_id uuid references public.tc_shifts(id),
  worker_id uuid references public.tc_workers(id),
  kiosk_id uuid references public.tc_kiosks(id),
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}'
);
create index tc_audit_shift on public.tc_audit(shift_id,id);
create table public.tc_requests (
  request_id uuid primary key,
  worker_id uuid not null references public.tc_workers(id),
  kiosk_id uuid not null references public.tc_kiosks(id),
  action text not null,
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Reject mutation of raw audit records even by service-role callers.
create function public.tc_audit_immutable() returns trigger language plpgsql
set search_path = '' as $$
begin raise exception 'audit_is_immutable'; end $$;
create trigger tc_audit_no_rewrite before update or delete on public.tc_audit
for each row execute function public.tc_audit_immutable();

-- Durable, atomic rate limit: must be invoked in its own transaction BEFORE
-- an action which may roll back. Keys are keyed hashes, never raw IPs/PINs.
create function public.tc_take_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.tc_limits;
begin
  if length(p_key)>180 or p_limit<1 or p_limit>1000 or p_seconds<1 or p_seconds>86400 then
    raise exception 'invalid_limit';
  end if;
  insert into public.tc_limits as l(key,attempts,reset_at)
    values(p_key,1,clock_timestamp()+make_interval(secs=>p_seconds))
    on conflict(key) do update set
      attempts=case when l.reset_at<=clock_timestamp() then 1 else least(l.attempts+1,1000000) end,
      reset_at=case when l.reset_at<=clock_timestamp() then excluded.reset_at else l.reset_at end
    returning * into v;
  return v.attempts<=p_limit;
end $$;

create function public.tc_shift_view(p_id uuid,p_owner boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'id',s.id,'worker_id',s.worker_id,'worker_name',w.name,'category',w.category,
  'started_at',s.started_at,'ended_at',s.ended_at,'note',s.note,'status',s.status,'version',s.version,
  'segments',coalesce((select jsonb_agg(
    jsonb_build_object('id',g.id,'role_id',g.role_id,'role_name',g.role_name,'started_at',g.started_at,'ended_at',g.ended_at)
    || case when p_owner then jsonb_build_object('rate_cents',g.rate_cents) else '{}'::jsonb end
    order by g.started_at,g.id) from public.tc_segments g where g.shift_id=s.id),'[]'::jsonb),
  'breaks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'started_at',b.started_at,'ended_at',b.ended_at,'paid',b.paid) order by b.started_at,b.id)
    from public.tc_breaks b where b.shift_id=s.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'role_id',t.role_id,'title',t.title,'done',t.done,'completed_at',t.completed_at) order by t.role_id,t.title)
    from public.tc_tasks t where t.shift_id=s.id),'[]'::jsonb)
 ) || case when p_owner then jsonb_build_object(
   'pay_basis',s.pay_basis,'flat_cents',s.flat_cents,
   'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'at',a.at,'action',a.action,'actor_id',a.actor_id,'details',a.details) order by a.id)
    from public.tc_audit a where a.shift_id=s.id),'[]'::jsonb)
 ) else '{}'::jsonb end
 from public.tc_shifts s join public.tc_workers w on w.id=s.worker_id where s.id=p_id;
$$;

create function public.tc_pair(p_pair_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.tc_kiosks;
begin
  select * into k from public.tc_kiosks where pairing_hash=p_pair_hash
    and pairing_expires>clock_timestamp() and revoked_at is null for update;
  if k.id is null then raise exception 'pairing_invalid'; end if;
  if length(p_token_hash)<>64 then raise exception 'invalid_token'; end if;
  update public.tc_kiosks set token_hash=p_token_hash,pairing_hash=null,pairing_expires=null,
    expires_at=clock_timestamp()+interval '90 days' where id=k.id;
  insert into public.tc_audit(kiosk_id,action) values(k.id,'kiosk_paired');
  return jsonb_build_object('id',k.id,'label',k.label);
end $$;

-- PIN verification occurs in Node (scrypt); version check closes the race
-- between successful verification and an owner reset/deactivation.
create function public.tc_start_session(p_kiosk_hash text,p_worker uuid,p_version uuid,p_session_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.tc_kiosks; w public.tc_workers;
begin
  select * into k from public.tc_kiosks where token_hash=p_kiosk_hash
    and revoked_at is null and expires_at>clock_timestamp() for update;
  select * into w from public.tc_workers where id=p_worker and active for update;
  if k.id is null or w.id is null or w.credential_version<>p_version then raise exception 'not_authorized'; end if;
  if length(p_session_hash)<>64 then raise exception 'invalid_token'; end if;
  delete from public.tc_sessions where kiosk_id=k.id or expires_at<clock_timestamp();
  insert into public.tc_sessions(token_hash,kiosk_id,worker_id,credential_version)
    values(p_session_hash,k.id,w.id,w.credential_version);
end $$;

create function public.tc_state(p_kiosk_hash text,p_session_hash text,p_touch boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.tc_kiosks; sess public.tc_sessions; w public.tc_workers; active_id uuid; result jsonb;
begin
  select * into k from public.tc_kiosks where token_hash=p_kiosk_hash
    and revoked_at is null and expires_at>clock_timestamp();
  if k.id is null then raise exception 'device_not_authorized'; end if;
  select * into sess from public.tc_sessions where token_hash=p_session_hash and kiosk_id=k.id
    and expires_at>clock_timestamp() and created_at>clock_timestamp()-interval '15 minutes';
  select * into w from public.tc_workers where id=sess.worker_id and active and credential_version=sess.credential_version;
  result=jsonb_build_object('kiosk',jsonb_build_object('label',k.label),'server_now',clock_timestamp(),'authenticated',false);
  if w.id is null then return result; end if;
  if p_touch then
    update public.tc_sessions set expires_at=least(clock_timestamp()+interval '90 seconds',created_at+interval '15 minutes')
      where token_hash=sess.token_hash returning * into sess;
  end if;
  select id into active_id from public.tc_shifts where worker_id=w.id and ended_at is null;
  return result || jsonb_build_object('authenticated',true,'expires_at',sess.expires_at,
    'worker',jsonb_build_object('id',w.id,'name',w.name,'category',w.category),
    'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'tasks',r.tasks) order by r.name)
      from public.tc_assignments a join public.tc_roles r on r.id=a.role_id where a.worker_id=w.id and r.active),'[]'::jsonb),
    'shift',public.tc_shift_view(active_id,false),
    'history',coalesce((select jsonb_agg(public.tc_shift_view(x.id,false) order by x.started_at desc)
      from (select id,started_at from public.tc_shifts where worker_id=w.id and ended_at is not null order by started_at desc limit 10) x),'[]'::jsonb));
end $$;

create function public.tc_lock(p_kiosk_hash text,p_session_hash text)
returns void language sql security definer set search_path = '' as $$
 delete from public.tc_sessions s using public.tc_kiosks k
 where s.kiosk_id=k.id and k.token_hash=p_kiosk_hash and s.token_hash=p_session_hash;
$$;

create function public.tc_operate(p_kiosk_hash text,p_session_hash text,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.tc_kiosks; sess public.tc_sessions; w public.tc_workers;
 s public.tc_shifts; role public.tc_roles; prior public.tc_requests; amount integer;
 t timestamptz; result jsonb; affected integer;
begin
  -- Fixed lock order: kiosk, worker, shift. Owner edits lock worker then shift.
  select * into k from public.tc_kiosks where token_hash=p_kiosk_hash
    and revoked_at is null and expires_at>clock_timestamp() for update;
  select * into sess from public.tc_sessions where token_hash=p_session_hash and kiosk_id=k.id
    and expires_at>clock_timestamp() and created_at>clock_timestamp()-interval '15 minutes';
  select * into w from public.tc_workers where id=sess.worker_id and active and credential_version=sess.credential_version for update;
  if k.id is null or w.id is null then raise exception 'not_authorized'; end if;
  if p_request is null or p_payload is null then raise exception 'invalid_request'; end if;
  select * into prior from public.tc_requests where request_id=p_request;
  if prior.request_id is not null then
    if prior.worker_id<>w.id or prior.kiosk_id<>k.id or prior.action<>p_action or prior.payload<>p_payload then
      raise exception 'request_conflict';
    end if;
    return prior.response;
  end if;
  select * into s from public.tc_shifts where worker_id=w.id and ended_at is null for update;
  t=clock_timestamp();
  if p_action in ('clock_in','switch_role') then
    select r.*,a.rate_cents into role.id,role.name,role.tasks,role.active,amount
      from public.tc_roles r join public.tc_assignments a on a.role_id=r.id
      where a.worker_id=w.id and r.id=p_payload->>'role_id' and r.active;
    if role.id is null then raise exception 'role_not_assigned'; end if;
  end if;
  if p_action='clock_in' then
    if s.id is not null then raise exception 'shift_already_open'; end if;
    insert into public.tc_shifts(worker_id,kiosk_id,started_at,pay_basis,flat_cents)
      values(w.id,k.id,t,w.pay_basis,w.flat_cents) returning * into s;
  else
    if s.id is null or s.id is distinct from (p_payload->>'shift_id')::uuid then raise exception 'shift_changed'; end if;
  end if;
  if p_action='clock_in' or p_action='switch_role' then
    if p_action='switch_role' then
      if exists(select 1 from public.tc_breaks where shift_id=s.id and ended_at is null) then raise exception 'end_break_first'; end if;
      if exists(select 1 from public.tc_segments where shift_id=s.id and ended_at is null and role_id=role.id) then raise exception 'same_role'; end if;
      update public.tc_segments set ended_at=t where shift_id=s.id and ended_at is null;
    end if;
    insert into public.tc_segments(shift_id,role_id,role_name,rate_cents,started_at) values(s.id,role.id,role.name,amount,t);
    insert into public.tc_tasks(shift_id,role_id,title)
      select s.id,role.id,value from jsonb_array_elements_text(role.tasks) on conflict do nothing;
  elsif p_action='clock_out' then
    update public.tc_segments set ended_at=t where shift_id=s.id and ended_at is null;
    update public.tc_breaks set ended_at=t where shift_id=s.id and ended_at is null;
    update public.tc_shifts set ended_at=t,status='pending',note=coalesce(p_payload->>'note',note) where id=s.id;
  elsif p_action='break_start' then
    if exists(select 1 from public.tc_breaks where shift_id=s.id and ended_at is null) then raise exception 'break_already_open'; end if;
    insert into public.tc_breaks(shift_id,started_at) values(s.id,t);
  elsif p_action='break_end' then
    update public.tc_breaks set ended_at=t where shift_id=s.id and ended_at is null;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'no_open_break'; end if;
  elsif p_action='task' then
    if jsonb_typeof(p_payload->'done') is distinct from 'boolean' then raise exception 'invalid_task'; end if;
    update public.tc_tasks set done=(p_payload->>'done')::boolean,
      completed_at=case when (p_payload->>'done')::boolean then t else null end
      where id=(p_payload->>'task_id')::uuid and shift_id=s.id;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'invalid_task'; end if;
  elsif p_action='note' then
    update public.tc_shifts set note=coalesce(p_payload->>'note','') where id=s.id;
  else
    raise exception 'invalid_action';
  end if;
  update public.tc_shifts set version=version+1 where id=s.id;
  insert into public.tc_audit(at,shift_id,worker_id,kiosk_id,action,details)
    values(t,s.id,w.id,k.id,p_action,p_payload);
  update public.tc_sessions set expires_at=least(t+interval '90 seconds',created_at+interval '15 minutes') where token_hash=sess.token_hash;
  result=jsonb_build_object('shift',public.tc_shift_view(s.id,false),'server_now',t);
  insert into public.tc_requests(request_id,worker_id,kiosk_id,action,payload,response)
    values(p_request,w.id,k.id,p_action,p_payload,result);
  return result;
end $$;

-- Owner server routes exclusively call this RPC, after owner + MFA gate.
-- Supplying actor_id here NEVER grants permission to a browser: EXECUTE is
-- restricted to service_role below. No trusting caller-provided auth claims.
create function public.tc_admin(p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.tc_workers; s public.tc_shifts; before_value jsonb; result jsonb='{}'; rid text;
 k public.tc_kiosks; t timestamptz=clock_timestamp(); new_start timestamptz; new_end timestamptz;
 first_id uuid; last_id uuid; worker_uuid uuid; value jsonb;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if p_action='save_role' then
    before_value=(select to_jsonb(r) from public.tc_roles r where r.id=p_payload->>'id');
    insert into public.tc_roles(id,name,tasks,active) values(p_payload->>'id',p_payload->>'name',p_payload->'tasks',(p_payload->>'active')::boolean)
      on conflict on constraint tc_roles_pkey do update set name=excluded.name,tasks=excluded.tasks,active=excluded.active;
    insert into public.tc_audit(actor_id,action,details) values(p_actor,p_action,jsonb_build_object('before',before_value,'after',p_payload));
    return jsonb_build_object('id',p_payload->>'id');
  elsif p_action='save_worker' then
    if p_payload->>'id' is not null then
      select * into w from public.tc_workers where tc_workers.id=(p_payload->>'id')::uuid for update;
      if w.id is null then raise exception 'worker_not_found'; end if;
      before_value=to_jsonb(w)-'pin_lookup'-'pin_verifier'-'credential_version';
      before_value=before_value || jsonb_build_object('roles',(select jsonb_agg(to_jsonb(a)) from public.tc_assignments a where a.worker_id=w.id));
      update public.tc_workers set name=p_payload->>'name',category=p_payload->>'category',
        active=(p_payload->>'active')::boolean,pay_basis=p_payload->>'pay_basis',
        credential_version=case when w.active and not (p_payload->>'active')::boolean
          then gen_random_uuid() else credential_version end,
        flat_cents=(p_payload->>'flat_cents')::integer where tc_workers.id=w.id;
      -- Turning access off is permanent for existing sessions, even if the
      -- profile is reactivated before their normal expiry. Keep punches intact.
      if not (p_payload->>'active')::boolean then
        delete from public.tc_sessions where worker_id=w.id;
      end if;
    else
      insert into public.tc_workers(name,category,active,pay_basis,flat_cents,pin_lookup,pin_verifier)
        values(p_payload->>'name',p_payload->>'category',(p_payload->>'active')::boolean,p_payload->>'pay_basis',(p_payload->>'flat_cents')::integer,
          p_payload->>'pin_lookup',p_payload->>'pin_verifier') returning * into w;
    end if;
    delete from public.tc_assignments where worker_id=w.id;
    for value in select * from jsonb_array_elements(p_payload->'roles') loop
      insert into public.tc_assignments(worker_id,role_id,rate_cents) values(w.id,value->>'role_id',(value->>'rate_cents')::integer);
    end loop;
    -- A deactivated worker loses PIN access immediately. Existing shifts
    -- remain open and must be explicitly closed by the owner; never erase time.
    insert into public.tc_audit(worker_id,actor_id,action,details)
      values(w.id,p_actor,p_action,jsonb_build_object('before',before_value,'after',p_payload-'pin_lookup'-'pin_verifier'));
    return jsonb_build_object('id',w.id);
  elsif p_action='reset_pin' then
    select * into w from public.tc_workers where tc_workers.id=(p_payload->>'id')::uuid for update;
    if w.id is null then raise exception 'worker_not_found'; end if;
    if w.pin_lookup=p_payload->>'pin_lookup' then raise exception 'pin_unchanged'; end if;
    update public.tc_workers set pin_lookup=p_payload->>'pin_lookup',pin_verifier=p_payload->>'pin_verifier',
      credential_version=gen_random_uuid() where tc_workers.id=(p_payload->>'id')::uuid returning * into w;
    if w.id is null then raise exception 'worker_not_found'; end if;
    insert into public.tc_audit(worker_id,actor_id,action) values(w.id,p_actor,p_action);
    return jsonb_build_object('id',w.id);
  elsif p_action='create_kiosk' then
    insert into public.tc_kiosks(label,pairing_hash,pairing_expires)
      values(p_payload->>'label',p_payload->>'pairing_hash',t+interval '15 minutes') returning * into k;
    insert into public.tc_audit(kiosk_id,actor_id,action) values(k.id,p_actor,p_action);
    return jsonb_build_object('id',k.id);
  elsif p_action='revoke_kiosk' then
    update public.tc_kiosks set revoked_at=t,pairing_hash=null where tc_kiosks.id=(p_payload->>'id')::uuid returning * into k;
    if k.id is null then raise exception 'device_not_found'; end if;
    delete from public.tc_sessions where kiosk_id=k.id;
    insert into public.tc_audit(kiosk_id,actor_id,action) values(k.id,p_actor,p_action);
    return jsonb_build_object('id',k.id);
  elsif p_action in ('approve','correct') then
    select worker_id into worker_uuid from public.tc_shifts where tc_shifts.id=(p_payload->>'id')::uuid;
    perform 1 from public.tc_workers where tc_workers.id=worker_uuid for update;
    select * into s from public.tc_shifts where tc_shifts.id=(p_payload->>'id')::uuid for update;
    if s.id is null then raise exception 'shift_not_found'; end if;
    if s.version is distinct from (p_payload->>'version')::integer then raise exception 'shift_changed'; end if;
    before_value=public.tc_shift_view(s.id,true)-'audit';
    if p_action='approve' then
      if s.ended_at is null then raise exception 'shift_still_open'; end if;
      if s.status='approved' then return jsonb_build_object('shift',public.tc_shift_view(s.id,true)); end if;
      update public.tc_shifts set status='approved',version=version+1 where tc_shifts.id=s.id;
    else
      if length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'reason_required'; end if;
      new_start=(p_payload->>'started_at')::timestamptz;
      new_end=(p_payload->>'ended_at')::timestamptz;
      if new_start is null or new_end is null or new_end<new_start or new_end>t or new_start>t then raise exception 'invalid_time_range'; end if;
      if exists(select 1 from public.tc_shifts x where x.worker_id=s.worker_id and x.id<>s.id
        and tstzrange(x.started_at,coalesce(x.ended_at,'infinity'::timestamptz),'[)') && tstzrange(new_start,new_end,'[)')) then
        raise exception 'shift_overlap';
      end if;
      select g.id into first_id from public.tc_segments g where shift_id=s.id order by started_at,g.id limit 1;
      select g.id into last_id from public.tc_segments g where shift_id=s.id order by started_at desc,g.id desc limit 1;
      if first_id is null or last_id is null then raise exception 'invalid_segments'; end if;
      if exists(select 1 from public.tc_segments g where shift_id=s.id and
          ((g.id<>first_id and g.started_at<new_start) or (g.id<>last_id and g.ended_at>new_end)))
        or exists(select 1 from public.tc_breaks b where shift_id=s.id and
          (b.started_at<new_start or b.started_at>new_end or b.ended_at>new_end)) then raise exception 'correction_crosses_segment'; end if;
      update public.tc_segments set
        started_at=case when tc_segments.id=first_id then new_start else started_at end,
        ended_at=case when tc_segments.id=last_id then new_end else ended_at end
        where tc_segments.id in (first_id,last_id);
      update public.tc_breaks set ended_at=new_end where shift_id=s.id and ended_at is null;
      update public.tc_shifts set started_at=new_start,ended_at=new_end,status='pending',version=version+1 where tc_shifts.id=s.id;
    end if;
    insert into public.tc_audit(shift_id,worker_id,actor_id,action,details) values(s.id,s.worker_id,p_actor,p_action,
      jsonb_build_object('before',before_value,'after',public.tc_shift_view(s.id,true)-'audit','reason',p_payload->>'reason'));
    return jsonb_build_object('shift',public.tc_shift_view(s.id,true));
  else raise exception 'invalid_action';
  end if;
end $$;

create function public.tc_cleanup() returns void language sql security definer set search_path = '' as $$
 delete from public.tc_sessions where expires_at<clock_timestamp();
 delete from public.tc_limits where reset_at<clock_timestamp()-interval '1 day';
$$;

-- Service SELECT allows explicit-column server reads; writes only through
-- transactional SECURITY DEFINER RPCs. No sensitive browser/self-read policies.
do $$
declare name text; signature text;
begin
  foreach name in array array['tc_roles','tc_workers','tc_assignments','tc_kiosks','tc_sessions','tc_limits',
    'tc_shifts','tc_segments','tc_breaks','tc_tasks','tc_audit','tc_requests'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',name);
    execute format('grant select on table public.%I to service_role',name);
  end loop;
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('tc_audit_immutable','tc_take_limit','tc_shift_view','tc_pair',
      'tc_start_session','tc_state','tc_lock','tc_operate','tc_admin','tc_cleanup') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end $$;
-- Production defaults also grant sequence privileges. Table/RPC revocation
-- above does not revoke these. SECURITY DEFINER inserts use the owner instead.
revoke all on sequence public.tc_audit_id_seq from public,anon,authenticated,service_role;
commit;
