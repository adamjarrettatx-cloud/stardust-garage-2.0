-- Manager "Delete shift": remove a shift that is simply wrong (for example a
-- forgotten clock-out that ran for days) so it no longer appears anywhere —
-- Timesheets, calendar totals, CSV export, the iPad history, the employee
-- portal or TotalView counts.
--
-- The shift row and its segments, breaks and responsibilities are physically
-- deleted. tc_audit stays immutable: the pre-existing audit rows are kept and
-- a final 'delete_shift' row records who deleted it, when, why and a full
-- snapshot of the shift as it was. To allow that, audit and change-request
-- rows keep the shift ID as a plain historical reference instead of a foreign
-- key that would block the delete.
--
-- Same posture as the rest of the time clock: SECURITY DEFINER, service-role
-- only, version-checked, worker row locked first.
begin;

do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where con.contype = 'f'
       and n.nspname = 'public'
       and con.confrelid = 'public.tc_shifts'::regclass
       and rel.relname in ('tc_audit', 'tc_change_requests')
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;

create or replace function public.tc_delete_shift(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.tc_shifts;
  v_worker uuid;
  v_reason text = trim(coalesce(p_payload->>'reason', ''));
  v_before jsonb;
  t timestamptz = clock_timestamp();
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if length(v_reason) < 5 or length(v_reason) > 2000 then raise exception 'reason_required'; end if;

  -- Lock order matches tc_admin: worker, then shift.
  select worker_id into v_worker from public.tc_shifts where id = (p_payload->>'id')::uuid;
  if v_worker is null then raise exception 'shift_not_found'; end if;
  perform 1 from public.tc_workers where id = v_worker for update;
  select * into s from public.tc_shifts where id = (p_payload->>'id')::uuid for update;
  if s.id is null then raise exception 'shift_not_found'; end if;
  if s.version is distinct from (p_payload->>'version')::integer then raise exception 'shift_changed'; end if;

  v_before = public.tc_shift_view(s.id, true) - 'audit';

  -- An open hour-fix request for this shift has nothing left to fix.
  update public.tc_change_requests
     set status = 'cancelled', manager_note = 'Shift deleted by a manager.',
         decided_by = p_actor, decided_at = t, version = version + 1
   where shift_id = s.id and status = 'pending';

  delete from public.tc_tasks where shift_id = s.id;
  delete from public.tc_breaks where shift_id = s.id;
  delete from public.tc_segments where shift_id = s.id;
  delete from public.tc_shifts where id = s.id;

  insert into public.tc_audit(shift_id, worker_id, actor_id, action, details)
    values(s.id, s.worker_id, p_actor, 'delete_shift',
      jsonb_build_object('reason', v_reason, 'before', v_before));
  return jsonb_build_object('deleted', s.id);
end $$;

revoke all on function public.tc_delete_shift(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.tc_delete_shift(uuid, jsonb) to service_role;

commit;
