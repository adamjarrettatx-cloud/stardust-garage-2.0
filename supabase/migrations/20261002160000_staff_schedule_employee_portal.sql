-- Staff scheduling calendar + Employee portal logins. Additive only.
-- Builds on 20260930031000_staff_time_clock.sql. Same posture: RLS on, no
-- browser grants, writes only through service-role SECURITY DEFINER RPCs that
-- gated Next.js routes call after verifying the caller.
begin;

-- Employee login link. A staff profile may be linked to exactly one Supabase
-- Auth user. The link grants ONLY the personal /employee view; it never
-- creates team_members rows or any admin/team/front-desk capability.
alter table public.tc_workers
  add column user_id uuid unique references auth.users(id) on delete set null,
  add column username text unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  add column login_enabled boolean not null default false,
  -- true when the Auth user was created for this login (password managed
  -- by Timekeeping). false when an existing site account was linked.
  add column login_managed boolean not null default false;

create table public.tc_schedule (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.tc_workers(id) on delete restrict,
  role_id text not null references public.tc_roles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (length(note) <= 500),
  version integer not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index tc_schedule_start on public.tc_schedule(starts_at);
create index tc_schedule_worker_start on public.tc_schedule(worker_id, starts_at);

-- One validated schedule entry write. Raises named errors mapped by the API.
create function public.tc_schedule_check(p_id uuid, p_worker uuid, p_role text, p_start timestamptz, p_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_worker is null or p_role is null or p_start is null or p_end is null then raise exception 'schedule_invalid'; end if;
  if p_end <= p_start or p_end - p_start > interval '24 hours' then raise exception 'schedule_invalid_time'; end if;
  if p_start < clock_timestamp() - interval '400 days' or p_start > clock_timestamp() + interval '400 days' then
    raise exception 'schedule_invalid_time';
  end if;
  perform 1 from public.tc_workers w where w.id = p_worker and w.active for update;
  if not found then raise exception 'schedule_worker_inactive'; end if;
  if not exists(select 1 from public.tc_assignments a join public.tc_roles r on r.id = a.role_id
      where a.worker_id = p_worker and a.role_id = p_role and r.active) then
    raise exception 'schedule_role_not_assigned';
  end if;
  if exists(select 1 from public.tc_schedule s where s.worker_id = p_worker
      and s.id is distinct from p_id
      and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'schedule_overlap';
  end if;
end $$;

create function public.tc_schedule_admin(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e jsonb; rec public.tc_schedule; before_value jsonb; ids jsonb = '[]'::jsonb; n integer = 0;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if p_action = 'create_schedule' then
    if jsonb_typeof(p_payload->'entries') is distinct from 'array'
      or jsonb_array_length(p_payload->'entries') < 1
      or jsonb_array_length(p_payload->'entries') > 40 then
      raise exception 'schedule_invalid';
    end if;
    for e in select * from jsonb_array_elements(p_payload->'entries') loop
      perform public.tc_schedule_check(null, (e->>'worker_id')::uuid, e->>'role_id',
        (e->>'starts_at')::timestamptz, (e->>'ends_at')::timestamptz);
      insert into public.tc_schedule(worker_id, role_id, starts_at, ends_at, note, created_by)
        values((e->>'worker_id')::uuid, e->>'role_id', (e->>'starts_at')::timestamptz,
          (e->>'ends_at')::timestamptz, coalesce(e->>'note', ''), p_actor)
        returning * into rec;
      insert into public.tc_audit(worker_id, actor_id, action, details)
        values(rec.worker_id, p_actor, 'schedule_create', jsonb_build_object('after', to_jsonb(rec)));
      ids = ids || to_jsonb(rec.id);
      n = n + 1;
    end loop;
    return jsonb_build_object('ids', ids, 'count', n);
  elsif p_action = 'update_schedule' then
    select * into rec from public.tc_schedule where id = (p_payload->>'id')::uuid for update;
    if rec.id is null then raise exception 'schedule_not_found'; end if;
    if rec.version is distinct from (p_payload->>'version')::integer then raise exception 'schedule_changed'; end if;
    before_value = to_jsonb(rec);
    perform public.tc_schedule_check(rec.id, (p_payload->>'worker_id')::uuid, p_payload->>'role_id',
      (p_payload->>'starts_at')::timestamptz, (p_payload->>'ends_at')::timestamptz);
    update public.tc_schedule set worker_id = (p_payload->>'worker_id')::uuid, role_id = p_payload->>'role_id',
      starts_at = (p_payload->>'starts_at')::timestamptz, ends_at = (p_payload->>'ends_at')::timestamptz,
      note = coalesce(p_payload->>'note', ''), version = version + 1, updated_at = clock_timestamp()
      where id = rec.id returning * into rec;
    insert into public.tc_audit(worker_id, actor_id, action, details)
      values(rec.worker_id, p_actor, 'schedule_update', jsonb_build_object('before', before_value, 'after', to_jsonb(rec)));
    return jsonb_build_object('id', rec.id);
  elsif p_action = 'delete_schedule' then
    delete from public.tc_schedule where id = (p_payload->>'id')::uuid returning * into rec;
    if rec.id is null then raise exception 'schedule_not_found'; end if;
    insert into public.tc_audit(worker_id, actor_id, action, details)
      values(rec.worker_id, p_actor, 'schedule_delete', jsonb_build_object('before', to_jsonb(rec)));
    return jsonb_build_object('id', rec.id);
  end if;
  raise exception 'invalid_action';
end $$;

-- Employee login administration. Auth users are created/updated by the API
-- (Supabase Admin API); this function records the link and audits it.
create function public.tc_login_admin(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.tc_workers;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  select * into w from public.tc_workers where id = (p_payload->>'worker_id')::uuid for update;
  if w.id is null then raise exception 'worker_not_found'; end if;
  if p_action = 'link_login' then
    if w.user_id is not null then raise exception 'login_exists'; end if;
    update public.tc_workers set user_id = (p_payload->>'user_id')::uuid,
      username = nullif(p_payload->>'username', ''), login_enabled = true,
      login_managed = coalesce((p_payload->>'managed')::boolean, false)
      where id = w.id returning * into w;
  elsif p_action = 'set_login_enabled' then
    if w.user_id is null then raise exception 'login_missing'; end if;
    update public.tc_workers set login_enabled = (p_payload->>'enabled')::boolean where id = w.id returning * into w;
  elsif p_action = 'unlink_login' then
    if w.user_id is null then raise exception 'login_missing'; end if;
    update public.tc_workers set user_id = null, username = null, login_enabled = false, login_managed = false
      where id = w.id;
  elsif p_action = 'password_reset' then
    if w.user_id is null or not w.login_managed then raise exception 'login_missing'; end if;
  else
    raise exception 'invalid_action';
  end if;
  insert into public.tc_audit(worker_id, actor_id, action, details)
    values(w.id, p_actor, 'login_' || p_action, (p_payload - 'password') || jsonb_build_object('user_id', w.user_id));
  return jsonb_build_object('id', w.id, 'user_id', w.user_id);
end $$;

-- Personal, read-only employee view. The API passes the VERIFIED Auth user
-- id; browsers cannot call this. Returns null for unlinked/disabled logins.
create function public.tc_employee_view(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.tc_workers;
begin
  select * into w from public.tc_workers where user_id = p_user and active and login_enabled;
  if w.id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '400 days' then
    return null;
  end if;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'worker', jsonb_build_object('id', w.id, 'name', w.name, 'category', w.category,
      'pay_basis', w.pay_basis, 'flat_cents', w.flat_cents, 'username', w.username),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'rate_cents', a.rate_cents) order by r.name)
      from public.tc_assignments a join public.tc_roles r on r.id = a.role_id where a.worker_id = w.id and r.active), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'role_id', s.role_id, 'role_name', r.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'note', s.note,
        'crew', coalesce((select jsonb_agg(jsonb_build_object('name', ow.name, 'role_name', orr.name,
            'starts_at', o.starts_at, 'ends_at', o.ends_at) order by o.starts_at, ow.name)
          from public.tc_schedule o join public.tc_workers ow on ow.id = o.worker_id join public.tc_roles orr on orr.id = o.role_id
          where o.worker_id <> w.id and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(s.starts_at, s.ends_at, '[)')), '[]'::jsonb)
      ) order by s.starts_at)
      from public.tc_schedule s join public.tc_roles r on r.id = s.role_id
      where s.worker_id = w.id and s.ends_at >= p_from and s.starts_at <= p_to + interval '120 days'), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sh.id, 'started_at', sh.started_at, 'ended_at', sh.ended_at, 'status', sh.status,
        'pay_basis', sh.pay_basis, 'flat_cents', sh.flat_cents,
        'segments', coalesce((select jsonb_agg(jsonb_build_object('role_name', g.role_name, 'rate_cents', g.rate_cents,
            'started_at', g.started_at, 'ended_at', g.ended_at) order by g.started_at, g.id)
          from public.tc_segments g where g.shift_id = sh.id), '[]'::jsonb),
        'breaks', coalesce((select jsonb_agg(jsonb_build_object('started_at', b.started_at, 'ended_at', b.ended_at) order by b.started_at)
          from public.tc_breaks b where b.shift_id = sh.id), '[]'::jsonb)
      ) order by sh.started_at desc)
      from public.tc_shifts sh where sh.worker_id = w.id
        and ((sh.started_at >= p_from and sh.started_at <= p_to) or sh.ended_at is null)), '[]'::jsonb)
  );
end $$;

-- Server-only lookup used when a manager links an existing site account by
-- email. Returns only the id and whether it is a shared station identity.
create function public.tc_auth_user_by_email(p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id,
    'station', coalesce((u.raw_app_meta_data->>'station_account')::boolean, false))
  from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;

do $$
declare signature text;
begin
  execute 'alter table public.tc_schedule enable row level security';
  execute 'revoke all on table public.tc_schedule from public,anon,authenticated,service_role';
  execute 'grant select on table public.tc_schedule to service_role';
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tc_schedule_check', 'tc_schedule_admin', 'tc_login_admin', 'tc_employee_view', 'tc_auth_user_by_email') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end $$;
-- tc_schedule_check is an internal helper; only the definer functions call it.
revoke execute on function public.tc_schedule_check(uuid, uuid, text, timestamptz, timestamptz) from service_role;
commit;
