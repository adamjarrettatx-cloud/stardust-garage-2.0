-- Owner "View as employee" preview. The personal employee payload moves into
-- one internal builder so the employee's own view and the manager preview can
-- never drift apart. Employee contract unchanged: verified user -> own linked,
-- login-enabled profile, else null. The preview resolves an active staff
-- profile by id (with or without a login) and is service_role-only; the
-- website calls it only after the Timekeeping manager + MFA check.
begin;

create or replace function public.tc_employee_payload(p_worker uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.tc_workers;
begin
  select * into w from public.tc_workers where id = p_worker;
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

create or replace function public.tc_employee_view(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_worker uuid;
begin
  select id into v_worker from public.tc_workers where user_id = p_user and active and login_enabled;
  if v_worker is null then return null; end if;
  return public.tc_employee_payload(v_worker, p_from, p_to);
end $$;

create or replace function public.tc_employee_preview(p_worker uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.tc_workers; v jsonb;
begin
  select * into w from public.tc_workers where id = p_worker and active;
  if w.id is null then return null; end if;
  v := public.tc_employee_payload(w.id, p_from, p_to);
  if v is null then return null; end if;
  return v || jsonb_build_object('preview', jsonb_build_object(
    'has_login', w.user_id is not null and w.login_enabled));
end $$;

do $$
declare signature text;
begin
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tc_employee_payload', 'tc_employee_view', 'tc_employee_preview') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end $$;
-- The payload builder is internal: only the two wrappers may call it.
revoke execute on function public.tc_employee_payload(uuid, timestamptz, timestamptz) from service_role;

commit;
