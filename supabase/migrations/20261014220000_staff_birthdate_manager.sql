-- Staff profile view: Timekeeping managers can correct a staff birthday from
-- the Edit screen. Additive; service-role only, like every tc_ RPC. The gated
-- Next.js route verifies the manager (MFA + Staff access) before calling it.
-- The photo stays employee-owned and is not writable here.
begin;

create function public.tc_worker_birthdate(p_actor uuid, p_worker uuid, p_birthdate date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.tc_workers;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if p_birthdate is null or p_birthdate > current_date or p_birthdate < date '1900-01-01' then
    raise exception 'profile_incomplete';
  end if;
  select * into w from public.tc_workers where id = p_worker for update;
  if w.id is null then raise exception 'worker_not_found'; end if;
  if w.birthdate is not distinct from p_birthdate then
    return jsonb_build_object('id', w.id, 'changed', false);
  end if;
  update public.tc_workers set birthdate = p_birthdate where id = w.id;
  insert into public.tc_audit(worker_id, actor_id, action, details)
    values (w.id, p_actor, 'birthdate_set', jsonb_build_object('had_birthdate', w.birthdate is not null));
  return jsonb_build_object('id', w.id, 'changed', true);
end $$;

revoke all on function public.tc_worker_birthdate(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.tc_worker_birthdate(uuid, uuid, date) to service_role;
commit;
