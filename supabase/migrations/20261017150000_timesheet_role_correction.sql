-- Timesheet role correction: a manager fixes the role a shift (or one part of
-- a shift with a mid-shift role switch) was clocked under.
--
-- Same posture as the rest of the time clock: SECURITY DEFINER, service-role
-- only, row locks, optimistic version check, reason required, audited with
-- before/after. Optional time changes run through the existing tc_admin
-- 'correct' path in the same transaction, so one Save is all-or-nothing.
--
-- Rate is re-snapshotted for the corrected role: the person's assigned rate for
-- that role, or a one-off rate the manager enters when the role is not on their
-- profile (the profile itself is not changed). A closed shift returns to Needs
-- review; a running shift stays open and its iPad checklist gains the corrected
-- role's duties (untouched duties of the removed role are dropped; completed
-- ones are kept as a record). Nothing is paid.

create or replace function public.tc_correct_shift(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.tc_shifts;
  v_reason text = trim(coalesce(p_payload->>'reason', ''));
  v_version integer = (p_payload->>'version')::integer;
  v_times boolean = p_payload ? 'started_at' and p_payload ? 'ended_at';
  before_value jsonb;
  item jsonb;
  g public.tc_segments;
  v_role text;
  v_role_name text;
  v_tasks jsonb;
  v_rate integer;
  v_assigned boolean;
  v_changes jsonb = '[]'::jsonb;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if length(v_reason) < 5 or length(v_reason) > 2000 then raise exception 'reason_required'; end if;
  if jsonb_typeof(coalesce(p_payload->'segments', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'segments', '[]'::jsonb)) > 50 then
    raise exception 'invalid_segments';
  end if;

  -- Lock order matches tc_admin: worker, then shift.
  perform 1 from public.tc_workers w
    where w.id = (select x.worker_id from public.tc_shifts x where x.id = (p_payload->>'id')::uuid) for update;
  select * into s from public.tc_shifts where id = (p_payload->>'id')::uuid for update;
  if s.id is null then raise exception 'shift_not_found'; end if;
  if s.version is distinct from v_version then raise exception 'shift_changed'; end if;
  before_value = public.tc_shift_view(s.id, true) - 'audit';

  -- Times first (existing validation, overlap and segment rules, own audit row).
  if v_times then
    perform public.tc_admin(p_actor, 'correct', jsonb_build_object(
      'id', s.id, 'version', s.version, 'reason', v_reason,
      'started_at', p_payload->>'started_at', 'ended_at', p_payload->>'ended_at'));
    select * into s from public.tc_shifts where id = s.id;
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'segments', '[]'::jsonb)) loop
    select * into g from public.tc_segments where id = (item->>'id')::uuid and shift_id = s.id for update;
    if g.id is null then raise exception 'invalid_segments'; end if;
    v_role = item->>'role_id';
    continue when v_role is not distinct from g.role_id;

    select ro.name, ro.tasks into v_role_name, v_tasks from public.tc_roles ro where ro.id = v_role and ro.active;
    if v_role_name is null then raise exception 'role_not_found'; end if;

    v_assigned = false; v_rate = null;
    select true, a.rate_cents into v_assigned, v_rate
      from public.tc_assignments a where a.worker_id = s.worker_id and a.role_id = v_role;
    if not coalesce(v_assigned, false) or v_rate is null then
      -- One-off rate for this shift only; the profile is not changed.
      v_rate = (item->>'rate_cents')::integer;
      if v_rate is not null and (v_rate < 0 or v_rate > 100000000) then raise exception 'invalid_rate'; end if;
    end if;

    update public.tc_segments set role_id = v_role, role_name = v_role_name, rate_cents = v_rate
      where id = g.id;
    v_changes = v_changes || jsonb_build_object('segment_id', g.id,
      'from_role', g.role_id, 'from_rate_cents', g.rate_cents,
      'to_role', v_role, 'to_rate_cents', v_rate, 'role_assigned', coalesce(v_assigned, false));

    if s.ended_at is null and g.ended_at is null then
      insert into public.tc_tasks(shift_id, role_id, title)
        select s.id, v_role, value from jsonb_array_elements_text(coalesce(v_tasks, '[]'::jsonb))
        on conflict do nothing;
    end if;
  end loop;

  if jsonb_array_length(v_changes) = 0 and not v_times then raise exception 'no_role_change'; end if;

  if jsonb_array_length(v_changes) > 0 then
    if s.ended_at is null then
      delete from public.tc_tasks t where t.shift_id = s.id and not t.done
        and not exists(select 1 from public.tc_segments x where x.shift_id = s.id and x.role_id = t.role_id);
    end if;
    update public.tc_shifts
      set status = case when ended_at is null then 'open' else 'pending' end, version = version + 1
      where id = s.id;
    insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
      values(s.id, s.worker_id, p_actor, 'correct_role', jsonb_build_object(
        'reason', v_reason, 'changes', v_changes,
        'before', before_value, 'after', public.tc_shift_view(s.id, true) - 'audit'));
  end if;

  return jsonb_build_object('shift', public.tc_shift_view(s.id, true));
end $$;

revoke all on function public.tc_correct_shift(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.tc_correct_shift(uuid, jsonb) to service_role;
