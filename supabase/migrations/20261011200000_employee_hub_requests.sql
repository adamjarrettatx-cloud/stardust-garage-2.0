-- Employee hub: hour-fix, missed-shift and time-off requests with a manager
-- approval queue. Additive. Builds on the staff time-clock and schedule
-- migrations with the same posture: RLS on, no browser grants, every write
-- through a named SECURITY DEFINER RPC that a gated Next.js route calls after
-- verifying the caller. Original punches are never rewritten silently: an
-- approved fix goes through tc_admin('correct'), which audits before/after.
begin;

-- Approved missed-shift requests create a manager-entered shift, which has
-- no kiosk. Kiosk punches keep source = 'kiosk'.
alter table public.tc_shifts alter column kiosk_id drop not null;
alter table public.tc_shifts
  add column source text not null default 'kiosk' check (source in ('kiosk', 'manager'));

create table public.tc_change_requests (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.tc_workers(id) on delete restrict,
  kind text not null check (kind in ('edit_shift', 'missed_shift', 'time_off')),
  shift_id uuid references public.tc_shifts(id) on delete restrict,
  role_id text references public.tc_roles(id) on delete restrict,
  original_start timestamptz,
  original_end timestamptz,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  reason text not null check (length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  manager_note text not null default '' check (length(manager_note) <= 500),
  applied_start timestamptz,
  applied_end timestamptz,
  result_shift_id uuid references public.tc_shifts(id) on delete restrict,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  check (requested_end > requested_start),
  check ((kind = 'edit_shift') = (shift_id is not null)),
  check (kind <> 'missed_shift' or role_id is not null),
  check (status <> 'approved' or (applied_start is not null and applied_end is not null))
);
-- One open fix per worked shift, enforced even under concurrent submits.
create unique index tc_one_pending_fix_per_shift on public.tc_change_requests(shift_id)
  where status = 'pending';
create index tc_change_requests_worker on public.tc_change_requests(worker_id, created_at desc);
create index tc_change_requests_open on public.tc_change_requests(created_at) where status = 'pending';
create index tc_change_requests_time_off on public.tc_change_requests(worker_id, applied_start)
  where kind = 'time_off' and status = 'approved';

-- Employee self-service. p_user is the VERIFIED Auth user id supplied by the
-- server route; the browser cannot choose a worker. Raises named errors.
create function public.tc_employee_request(p_user uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.tc_workers; s public.tc_shifts; r public.tc_change_requests;
  t timestamptz = clock_timestamp(); v_start timestamptz; v_end timestamptz;
  v_kind text; v_reason text;
begin
  if p_user is null or p_payload is null then raise exception 'not_employee'; end if;
  -- Lock the worker row so concurrent submissions for one person serialize.
  select * into w from public.tc_workers where user_id = p_user and active and login_enabled for update;
  if w.id is null then raise exception 'not_employee'; end if;

  if p_action = 'cancel' then
    update public.tc_change_requests set status = 'cancelled', decided_at = t, version = version + 1
      where id = (p_payload->>'id')::uuid and worker_id = w.id and status = 'pending'
      returning * into r;
    if r.id is null then raise exception 'request_not_pending'; end if;
    insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
      values(r.shift_id, w.id, p_user, 'request_cancel', jsonb_build_object('request_id', r.id, 'kind', r.kind));
    return jsonb_build_object('id', r.id, 'status', r.status);
  elsif p_action is distinct from 'create' then
    raise exception 'invalid_action';
  end if;

  v_kind = p_payload->>'kind';
  v_reason = trim(coalesce(p_payload->>'reason', ''));
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'request_reason_required'; end if;
  v_start = (p_payload->>'starts_at')::timestamptz;
  v_end = (p_payload->>'ends_at')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'request_invalid_time'; end if;
  if (select count(*) from public.tc_change_requests c where c.worker_id = w.id and c.status = 'pending') >= 20 then
    raise exception 'request_limit';
  end if;

  if v_kind = 'edit_shift' then
    select * into s from public.tc_shifts where id = (p_payload->>'shift_id')::uuid and worker_id = w.id;
    if s.id is null then raise exception 'shift_not_found'; end if;
    if s.ended_at is null then raise exception 'request_shift_open'; end if;
    if v_end > t or v_end - v_start > interval '24 hours' then raise exception 'request_invalid_time'; end if;
    if v_start = s.started_at and v_end = s.ended_at then raise exception 'request_no_change'; end if;
    if exists(select 1 from public.tc_change_requests c where c.shift_id = s.id and c.status = 'pending') then
      raise exception 'request_duplicate';
    end if;
    insert into public.tc_change_requests(worker_id, kind, shift_id, original_start, original_end,
        requested_start, requested_end, reason)
      values(w.id, 'edit_shift', s.id, s.started_at, s.ended_at, v_start, v_end, v_reason)
      returning * into r;
  elsif v_kind = 'missed_shift' then
    if not exists(select 1 from public.tc_assignments a join public.tc_roles ro on ro.id = a.role_id
        where a.worker_id = w.id and a.role_id = p_payload->>'role_id' and ro.active) then
      raise exception 'role_not_assigned';
    end if;
    if v_end > t or v_end - v_start > interval '24 hours' or v_start < t - interval '62 days' then
      raise exception 'request_invalid_time';
    end if;
    if exists(select 1 from public.tc_shifts x where x.worker_id = w.id
        and tstzrange(x.started_at, coalesce(x.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(v_start, v_end, '[)')) then
      raise exception 'shift_overlap';
    end if;
    if exists(select 1 from public.tc_change_requests c where c.worker_id = w.id and c.kind = 'missed_shift'
        and c.status = 'pending' and tstzrange(c.requested_start, c.requested_end, '[)') && tstzrange(v_start, v_end, '[)')) then
      raise exception 'request_duplicate';
    end if;
    insert into public.tc_change_requests(worker_id, kind, role_id, requested_start, requested_end, reason)
      values(w.id, 'missed_shift', p_payload->>'role_id', v_start, v_end, v_reason)
      returning * into r;
  elsif v_kind = 'time_off' then
    if v_start < t - interval '1 day' or v_start > t + interval '365 days' or v_end - v_start > interval '31 days' then
      raise exception 'request_invalid_time';
    end if;
    if exists(select 1 from public.tc_change_requests c where c.worker_id = w.id and c.kind = 'time_off'
        and c.status in ('pending', 'approved')
        and tstzrange(coalesce(c.applied_start, c.requested_start), coalesce(c.applied_end, c.requested_end), '[)')
          && tstzrange(v_start, v_end, '[)')) then
      raise exception 'request_duplicate';
    end if;
    insert into public.tc_change_requests(worker_id, kind, requested_start, requested_end, reason)
      values(w.id, 'time_off', v_start, v_end, v_reason)
      returning * into r;
  else
    raise exception 'invalid_action';
  end if;

  insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
    values(r.shift_id, w.id, p_user, 'request_create', jsonb_build_object('request', to_jsonb(r)));
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

-- Manager decisions. Called only by the Timekeeping-manager-gated route.
create function public.tc_request_admin(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.tc_change_requests; s public.tc_shifts; w public.tc_workers; before_value jsonb;
  t timestamptz = clock_timestamp(); v_start timestamptz; v_end timestamptz; v_note text;
  v_rate integer; v_role_name text; v_shift uuid; corrected jsonb; conflicts jsonb = '[]'::jsonb;
begin
  if p_actor is null or p_payload is null then raise exception 'not_authorized'; end if;
  v_note = trim(coalesce(p_payload->>'note', ''));
  if length(v_note) > 500 then raise exception 'request_note_too_long'; end if;
  -- Lock order matches the employee path and tc_admin: worker, then request/shift.
  select * into r from public.tc_change_requests where id = (p_payload->>'id')::uuid;
  if r.id is null then raise exception 'request_not_found'; end if;
  select * into w from public.tc_workers where id = r.worker_id for update;
  select * into r from public.tc_change_requests where id = r.id for update;
  if r.version is distinct from (p_payload->>'version')::integer then raise exception 'request_changed'; end if;
  before_value = to_jsonb(r);

  if p_action = 'deny' then
    if r.status <> 'pending' then raise exception 'request_not_pending'; end if;
    if length(v_note) < 3 then raise exception 'request_note_required'; end if;
    update public.tc_change_requests set status = 'denied', manager_note = v_note, decided_by = p_actor,
      decided_at = t, version = version + 1 where id = r.id returning * into r;
  elsif p_action = 'revoke_time_off' then
    if r.kind <> 'time_off' or r.status <> 'approved' then raise exception 'request_not_pending'; end if;
    if length(v_note) < 3 then raise exception 'request_note_required'; end if;
    update public.tc_change_requests set status = 'cancelled', manager_note = v_note, decided_by = p_actor,
      decided_at = t, version = version + 1 where id = r.id returning * into r;
  elsif p_action = 'approve' then
    if r.status <> 'pending' then raise exception 'request_not_pending'; end if;
    -- A manager may approve with adjusted times; otherwise the requested times apply.
    v_start = coalesce((p_payload->>'starts_at')::timestamptz, r.requested_start);
    v_end = coalesce((p_payload->>'ends_at')::timestamptz, r.requested_end);
    if v_end <= v_start then raise exception 'invalid_time_range'; end if;

    if r.kind = 'edit_shift' then
      select * into s from public.tc_shifts where id = r.shift_id;
      if s.id is null then raise exception 'shift_not_found'; end if;
      -- Reuses the audited correction path (overlap, segment and break checks).
      corrected = public.tc_admin(p_actor, 'correct', jsonb_build_object(
        'id', s.id, 'version', s.version, 'started_at', v_start, 'ended_at', v_end,
        'reason', 'Employee request: ' || r.reason));
      -- The manager reviewed these exact times, so the corrected shift is approved.
      perform public.tc_admin(p_actor, 'approve', jsonb_build_object(
        'id', s.id, 'version', (corrected->'shift'->>'version')::integer));
      v_shift = s.id;
    elsif r.kind = 'missed_shift' then
      if v_end > t or v_end - v_start > interval '24 hours' then raise exception 'invalid_time_range'; end if;
      if exists(select 1 from public.tc_shifts x where x.worker_id = w.id
          and tstzrange(x.started_at, coalesce(x.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(v_start, v_end, '[)')) then
        raise exception 'shift_overlap';
      end if;
      -- Rate snapshot comes from the worker's current assignment for the role.
      select ro.name, a.rate_cents into v_role_name, v_rate
        from public.tc_roles ro left join public.tc_assignments a on a.role_id = ro.id and a.worker_id = w.id
        where ro.id = r.role_id;
      insert into public.tc_shifts(worker_id, kiosk_id, started_at, ended_at, pay_basis, flat_cents, status, source, note)
        values(w.id, null, v_start, v_end, w.pay_basis, w.flat_cents, 'approved', 'manager', 'Added from an employee request')
        returning id into v_shift;
      insert into public.tc_segments(shift_id, role_id, role_name, rate_cents, started_at, ended_at)
        values(v_shift, r.role_id, v_role_name, v_rate, v_start, v_end);
      insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
        values(v_shift, w.id, p_actor, 'manual_shift', jsonb_build_object('request_id', r.id,
          'after', public.tc_shift_view(v_shift, true) - 'audit'));
    else
      select coalesce(jsonb_agg(jsonb_build_object('id', sc.id, 'starts_at', sc.starts_at, 'ends_at', sc.ends_at)
          order by sc.starts_at), '[]'::jsonb) into conflicts
        from public.tc_schedule sc where sc.worker_id = r.worker_id
          and tstzrange(sc.starts_at, sc.ends_at, '[)') && tstzrange(v_start, v_end, '[)');
    end if;

    update public.tc_change_requests set status = 'approved', applied_start = v_start, applied_end = v_end,
      result_shift_id = v_shift, manager_note = v_note, decided_by = p_actor, decided_at = t,
      version = version + 1 where id = r.id returning * into r;
  else
    raise exception 'invalid_action';
  end if;

  insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
    values(coalesce(r.result_shift_id, r.shift_id), r.worker_id, p_actor, 'request_' || p_action,
      jsonb_build_object('before', before_value, 'after', to_jsonb(r)));
  return jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version, 'schedule_conflicts', conflicts);
end $$;

-- Manager queue: pending first, then recent decisions. Read-only.
create function public.tc_requests_view(p_status text, p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.item order by x.open_first, x.sort_at desc), '[]'::jsonb) from (
    select (c.status <> 'pending') as open_first,
      case when c.status = 'pending' then c.created_at else coalesce(c.decided_at, c.created_at) end as sort_at,
      jsonb_build_object('id', c.id, 'worker_id', c.worker_id, 'worker_name', w.name, 'kind', c.kind,
        'shift_id', c.shift_id, 'role_id', c.role_id, 'role_name', ro.name,
        'original_start', c.original_start, 'original_end', c.original_end,
        'requested_start', c.requested_start, 'requested_end', c.requested_end,
        'applied_start', c.applied_start, 'applied_end', c.applied_end,
        'reason', c.reason, 'status', c.status, 'manager_note', c.manager_note,
        'decided_at', c.decided_at, 'created_at', c.created_at, 'version', c.version,
        'shift_roles', (select coalesce(jsonb_agg(distinct g.role_name), '[]'::jsonb)
          from public.tc_segments g where g.shift_id = c.shift_id)) as item
    from public.tc_change_requests c
      join public.tc_workers w on w.id = c.worker_id
      left join public.tc_roles ro on ro.id = c.role_id
    where (p_status = 'all' or c.status = p_status
        or (p_status = 'time_off' and c.kind = 'time_off' and c.status = 'approved' and c.applied_end > clock_timestamp()))
    order by 1, 2 desc
    limit least(greatest(coalesce(p_limit, 100), 1), 300)
  ) x;
$$;

-- Scheduling over approved time off is blocked; the manager revokes the time
-- off first if the person agrees to work. Same signature as before.
create or replace function public.tc_schedule_check(p_id uuid, p_worker uuid, p_role text, p_start timestamptz, p_end timestamptz)
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
  if exists(select 1 from public.tc_change_requests c where c.worker_id = p_worker and c.kind = 'time_off'
      and c.status = 'approved' and tstzrange(c.applied_start, c.applied_end, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'schedule_time_off';
  end if;
end $$;

-- Personal view now also returns the employee's own requests and the shift
-- source. Same verified-user contract as before; null for unlinked logins.
create or replace function public.tc_employee_view(p_user uuid, p_from timestamptz, p_to timestamptz)
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
        'id', sh.id, 'started_at', sh.started_at, 'ended_at', sh.ended_at, 'status', sh.status, 'source', sh.source,
        'pay_basis', sh.pay_basis, 'flat_cents', sh.flat_cents,
        'segments', coalesce((select jsonb_agg(jsonb_build_object('role_name', g.role_name, 'rate_cents', g.rate_cents,
            'started_at', g.started_at, 'ended_at', g.ended_at) order by g.started_at, g.id)
          from public.tc_segments g where g.shift_id = sh.id), '[]'::jsonb),
        'breaks', coalesce((select jsonb_agg(jsonb_build_object('started_at', b.started_at, 'ended_at', b.ended_at) order by b.started_at)
          from public.tc_breaks b where b.shift_id = sh.id), '[]'::jsonb)
      ) order by sh.started_at desc)
      from public.tc_shifts sh where sh.worker_id = w.id
        and ((sh.started_at >= p_from and sh.started_at <= p_to) or sh.ended_at is null)), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'shift_id', c.shift_id, 'role_id', c.role_id, 'role_name', ro.name,
        'original_start', c.original_start, 'original_end', c.original_end,
        'requested_start', c.requested_start, 'requested_end', c.requested_end,
        'applied_start', c.applied_start, 'applied_end', c.applied_end,
        'reason', c.reason, 'status', c.status, 'manager_note', c.manager_note,
        'decided_at', c.decided_at, 'created_at', c.created_at) order by c.created_at desc)
      from public.tc_change_requests c left join public.tc_roles ro on ro.id = c.role_id
      where c.worker_id = w.id and (c.status = 'pending' or c.created_at > clock_timestamp() - interval '120 days'
        or (c.kind = 'time_off' and c.status = 'approved' and c.applied_end > clock_timestamp()))), '[]'::jsonb)
  );
end $$;

do $$
declare signature text;
begin
  execute 'alter table public.tc_change_requests enable row level security';
  execute 'revoke all on table public.tc_change_requests from public,anon,authenticated,service_role';
  execute 'grant select on table public.tc_change_requests to service_role';
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tc_employee_request', 'tc_request_admin', 'tc_requests_view',
      'tc_schedule_check', 'tc_employee_view') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end $$;
-- tc_schedule_check stays an internal helper, as in the schedule migration.
revoke execute on function public.tc_schedule_check(uuid, uuid, text, timestamptz, timestamptz) from service_role;

-- Linking an existing site account by email now also reports whether it is a
-- team or partner identity, which must not become employee-only.
create or replace function public.tc_auth_user_by_email(p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u record;
begin
  select id, coalesce((raw_app_meta_data->>'station_account')::boolean, false) as station
    into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if u.id is null then return null; end if;
  return jsonb_build_object('id', u.id, 'station', u.station,
    'team', exists(select 1 from public.team_members t where t.user_id = u.id),
    'partner', exists(select 1 from public.partner_profiles pp where pp.user_id = u.id and pp.is_active));
end $$;
revoke all on function public.tc_auth_user_by_email(text) from public, anon, authenticated, service_role;
grant execute on function public.tc_auth_user_by_email(text) to service_role;
commit;
