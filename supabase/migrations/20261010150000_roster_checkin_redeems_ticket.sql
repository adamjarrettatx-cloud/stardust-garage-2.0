-- Front-desk roster ("Tonight Sign-ins") check-in now redeems the guest's
-- account ticket for the running event, in the same transaction as the
-- arrival and capacity count. Previously this path recorded the arrival only,
-- so ticket buyers checked in by name (often right after the door-QR sign-up)
-- left their tickets valid and the "scanned" count on the front-desk header
-- never moved.
--
-- Ticket matching mirrors commit_door_admission exactly:
--   * ticket for the open door session's event, status 'valid',
--     order paid / partial_refund, not reserved for a guest;
--   * order owned by one of the person's linked accounts (user:<id>) or
--     member profiles (member:<id>), or a pre-login order whose buyer email
--     equals that account's VERIFIED auth email (exact, case-insensitive);
--   * oldest ticket first; one ticket per arrival.
-- No eligible ticket → admission proceeds as before (staff-verified), which
-- keeps the POS / shared-ticket fallback.
--
-- Station authorization (station_accounts) carried over from the live
-- definition so the repository matches production.
create or replace function public.front_desk_roster_check_in(
  p_kind text, p_id uuid, p_identity_keys text[], p_actor uuid, p_door_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  s public.capacity_sessions;
  arrival public.front_desk_arrivals;
  day_key date := ((now() at time zone 'America/Chicago') - interval '6 hours')::date;
  actual_door_session uuid;
  door_event uuid;
  uids uuid[];
  mids uuid[];
  emails text[];
  t public.tickets;
  product_name text;
begin
  if p_actor is null or not exists (
    select 1 from public.team_members where user_id=p_actor and role in ('admin','team','front_desk')
     union all select 1 from public.station_accounts where user_id=p_actor and role='front_desk' and active and reset_started_at is null
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('trial_pass','member','guest') or p_id is null
    or p_identity_keys is null or cardinality(p_identity_keys)=0
    or cardinality(p_identity_keys)>100
    or not (p_kind || ':' || p_id::text = any(p_identity_keys))
  then raise exception 'Invalid identity' using errcode='22023'; end if;
  select id, event_id into actual_door_session, door_event from public.door_sessions where closed_at is null
    order by opened_at desc limit 1 for share;
  if actual_door_session is distinct from p_door_session_id then
    raise exception 'Event changed. Refresh before checking in.' using errcode='P0001';
  end if;
  -- Same per-person lock key commit_door_admission uses, so a simultaneous
  -- QR scan and roster tap for one account cannot both spend a ticket.
  if door_event is not null then
    select coalesce(array_agg(substr(k,6)::uuid),'{}') into uids from unnest(p_identity_keys) k
      where k ~ '^user:[0-9a-fA-F-]{36}$';
    select coalesce(array_agg(substr(k,8)::uuid),'{}') into mids from unnest(p_identity_keys) k
      where k ~ '^member:[0-9a-fA-F-]{36}$';
    -- Members linked by profile but without a user key still resolve to their account.
    select coalesce(array_agg(distinct x),'{}') into uids from (
      select unnest(uids) x union select user_id from public.member_profiles where id = any(mids) and user_id is not null
    ) q;
    if cardinality(uids) > 0 then
      perform pg_advisory_xact_lock(hashtextextended(door_event::text||':user:'||u::text,0))
        from unnest(uids) u order by u;
    end if;
  end if;
  s := public._capacity_lock_active();
  select * into arrival from public.front_desk_arrivals
    where shift_day=day_key and identity_keys && p_identity_keys
    order by checked_in_at desc limit 1;
  if found then
    return jsonb_build_object('alreadyCheckedIn',true,'arrival',to_jsonb(arrival));
  end if;
  if s.current_count >= s.max_capacity then
    raise exception 'At capacity. Hold entry.' using errcode='P0001';
  end if;

  if door_event is not null then
    select coalesce(array_agg(lower(trim(email))),'{}') into emails from auth.users
      where id = any(uids) and email_confirmed_at is not null and email is not null;

    if cardinality(uids) > 0 or cardinality(mids) > 0 then
      select ti.* into t from public.tickets ti join public.orders ord on ord.id=ti.order_id
        where ti.event_id=door_event and ord.event_id=door_event
          and ti.status='valid' and ord.status in ('paid','partial_refund')
          and not ti.reserved_for_guest
          and (ord.user_id = any(uids) or ord.member_profile_id = any(mids)
            or (ord.user_id is null and lower(trim(ord.buyer_email)) = any(emails)))
        order by ti.created_at, ti.id limit 1 for update of ti, ord;
    end if;
  end if;

  insert into public.front_desk_arrivals (
    subject_kind,subject_id,identity_keys,shift_day,checked_in_by,capacity_session_id,door_session_id
  ) values (p_kind,p_id,p_identity_keys,day_key,p_actor,s.id,actual_door_session) returning * into arrival;

  if t.id is not null then
    update public.tickets set status='used', used_at=now() where id=t.id and status='valid';
    if not found then raise exception 'Ticket already used. Retry check-in.' using errcode='P0001'; end if;
    insert into public.ticket_checkins(ticket_id,event_id,ticket_code_attempted,result,scanned_by,door_session_id,note)
      values(t.id,door_event,t.ticket_code,'valid',p_actor,actual_door_session,'roster:'||arrival.id::text);
    select name into product_name from public.ticket_products where id=t.product_id;
  end if;

  update public.capacity_sessions set current_count=current_count+1 where id=s.id returning * into s;
  insert into public.capacity_events(session_id,action,delta,count_after,max_capacity,actor_id,source,note)
    values(s.id,'check_in',1,s.current_count,s.max_capacity,p_actor,'front_door',
      'Front desk roster: ' || p_kind || ':' || p_id::text || ' arrival:' || arrival.id::text
      || case when t.id is not null then ' ticket:' || t.id::text else '' end);
  return jsonb_build_object('alreadyCheckedIn',false,'arrival',to_jsonb(arrival),
    'ticket', case when t.id is null then null
      else jsonb_build_object('ticket_id',t.id,'product_label',coalesce(product_name,'General Admission')) end);
end $$;
revoke all on function public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid) to service_role;
