-- Manager "Add hours": record worked time for someone who did not clock in on
-- the iPad (or is a brand-new profile). Same posture as the rest of the time
-- clock: SECURITY DEFINER, service-role only, every write audited.
--
-- The shift is created as 'pending' (Needs review) with source 'manager', so it
-- goes through the normal calendar approval like any other shift. Rate is a
-- snapshot: the person's assigned rate for the role, or a one-off rate the
-- manager enters when the role is not on their profile. Nothing is paid.

create or replace function public.tc_add_manual_shift(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.tc_workers;
  t timestamptz = clock_timestamp();
  v_start timestamptz = (p_payload->>'started_at')::timestamptz;
  v_end timestamptz = (p_payload->>'ended_at')::timestamptz;
  v_reason text = trim(coalesce(p_payload->>'reason', ''));
  v_role text = p_payload->>'role_id';
  v_role_name text;
  v_rate integer;
  v_assigned boolean;
  v_shift uuid;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if length(v_reason) < 5 or length(v_reason) > 2000 then raise exception 'reason_required'; end if;
  if v_start is null or v_end is null or v_end <= v_start or v_end > t
     or v_end - v_start > interval '24 hours' or v_start < t - interval '400 days' then
    raise exception 'invalid_time_range';
  end if;

  -- Lock the worker so a concurrent kiosk clock-in cannot slip in an overlap.
  select * into w from public.tc_workers where id = (p_payload->>'worker_id')::uuid for update;
  if w.id is null then raise exception 'worker_not_found'; end if;
  if not w.active then raise exception 'schedule_worker_inactive'; end if;

  select ro.name into v_role_name from public.tc_roles ro where ro.id = v_role and ro.active;
  if v_role_name is null then raise exception 'role_not_found'; end if;

  if exists(select 1 from public.tc_shifts x where x.worker_id = w.id
      and tstzrange(x.started_at, coalesce(x.ended_at, 'infinity'::timestamptz), '[)')
          && tstzrange(v_start, v_end, '[)')) then
    raise exception 'shift_overlap';
  end if;

  select true, a.rate_cents into v_assigned, v_rate
    from public.tc_assignments a where a.worker_id = w.id and a.role_id = v_role;
  if not coalesce(v_assigned, false) or v_rate is null then
    -- One-off rate for this shift only; the profile is not changed.
    v_rate = (p_payload->>'rate_cents')::integer;
    if v_rate is not null and (v_rate < 0 or v_rate > 100000000) then raise exception 'invalid_rate'; end if;
  end if;

  insert into public.tc_shifts(worker_id, kiosk_id, started_at, ended_at, pay_basis, flat_cents, status, source, note)
    values(w.id, null, v_start, v_end, w.pay_basis, w.flat_cents, 'pending', 'manager', 'Added by manager: ' || v_reason)
    returning id into v_shift;
  insert into public.tc_segments(shift_id, role_id, role_name, rate_cents, started_at, ended_at)
    values(v_shift, v_role, v_role_name, v_rate, v_start, v_end);
  insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
    values(v_shift, w.id, p_actor, 'manual_shift', jsonb_build_object('reason', v_reason,
      'role_assigned', coalesce(v_assigned, false),
      'after', public.tc_shift_view(v_shift, true) - 'audit'));
  return jsonb_build_object('shift', public.tc_shift_view(v_shift, true));
end $$;

revoke all on function public.tc_add_manual_shift(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.tc_add_manual_shift(uuid, jsonb) to service_role;
