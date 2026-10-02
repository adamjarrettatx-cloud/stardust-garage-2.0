begin;
-- Only the server may invoke this operation. One event + one canonical person
-- can consume one ticket, even across different pass kinds or retrying devices.
create table public.door_admissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  door_session_id uuid not null references public.door_sessions(id),
  person_key text not null,
  subject_kind text not null check(subject_kind in ('member','trial_pass')),
  subject_id uuid not null,
  ticket_id uuid not null unique references public.tickets(id),
  actor_id uuid,
  device_id uuid,
  admitted_at timestamptz not null default now(),
  unique(event_id,person_key)
);
alter table public.door_admissions enable row level security;
revoke all on public.door_admissions from public,anon,authenticated;
grant select,insert on public.door_admissions to service_role;

create function public.commit_door_admission(
  p_actor uuid, p_device uuid, p_kind text, p_subject uuid, p_token_hash text,
  p_event uuid, p_session uuid, p_ticket_code text default null, p_station_hash text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ds public.door_sessions; ev public.events; m public.member_profiles; tp public.trial_passes;
  t public.tickets; o public.orders; cap public.capacity_sessions;
  prior public.door_admissions; admission_id uuid; log_id uuid;
  uid uuid; mid uuid; canonical text; verified_email text; staff_id uuid;
begin
  if p_actor is not null then
    select id into staff_id from public.team_members
      where user_id=p_actor and role in ('admin','team','front_desk');
    if staff_id is null and not exists(
      select 1 from public.resolve_station_session(p_station_hash) where user_id=p_actor and role='front_desk'
    ) then raise exception 'Staff authorization required' using errcode='42501'; end if;
  elsif p_device is not null then
    -- Device authentication and revocation are checked by the route. The
    -- database also refuses devices not provisioned for entry.
    if not exists(select 1 from public.capacity_device_tokens where id=p_device and device_role='front_door' and active=true and revoked_at is null) then
      raise exception 'Door device authorization required' using errcode='42501';
    end if;
  else raise exception 'Staff authorization required' using errcode='42501';
  end if;

  select * into ds from public.door_sessions where closed_at is null for share;
  if ds.id is null or p_event is distinct from ds.event_id
    or (p_session is not null and p_session is distinct from ds.id) then
    raise exception 'Start the correct door event before scanning' using errcode='P0001';
  end if;
  select * into ev from public.events where id=ds.event_id for share;
  if ev.status in ('archived','deleted','cancelled') then
    raise exception 'Event is not accepting admission' using errcode='P0001';
  end if;

  if p_kind='member' then
    select * into m from public.member_profiles where id=p_subject for update;
    if m.id is null or not exists(select 1 from public.member_identity_tokens
      where member_profile_id=m.id and token_hash=p_token_hash and revoked_at is null) then
      raise exception 'Pass is no longer valid' using errcode='P0001';
    end if;
    if m.is_active is distinct from true or coalesce(m.subscription_status,'') not in ('active','trialing') then
      raise exception 'Membership is not active' using errcode='P0001';
    end if;
    if nullif(m.profile_photo_path,'') is null and nullif(m.photo_url,'') is null then
      raise exception 'Profile photo required' using errcode='P0001';
    end if;
    uid:=m.user_id; mid:=m.id;
  elsif p_kind='trial_pass' then
    select * into tp from public.trial_passes where id=p_subject for update;
    if tp.id is null or tp.qr_token_hash is distinct from p_token_hash then
      raise exception 'Pass is no longer valid' using errcode='P0001';
    end if;
    if tp.status='expired' or
       coalesce(case when tp.activated_at is null then tp.signup_expires_at
          else greatest(tp.expires_at,tp.extended_until) end, '-infinity'::timestamptz)<=now() then
      raise exception 'Trial pass expired' using errcode='P0001';
    end if;
    if ev.is_weekend_music_experience is distinct from true then
      raise exception 'This event does not accept trial passes' using errcode='P0001';
    end if;
    if nullif(tp.profile_photo_path,'') is null then
      raise exception 'Profile photo required' using errcode='P0001';
    end if;
    mid:=tp.member_profile_id;
    uid:=tp.user_id;
    if uid is null and mid is not null then select user_id into uid from public.member_profiles where id=mid; end if;
  else raise exception 'A member or trial pass is required' using errcode='22023';
  end if;
  canonical:=case when uid is not null then 'user:'||uid::text
    when mid is not null then 'member:'||mid::text else 'trial_pass:'||p_subject::text end;
  perform pg_advisory_xact_lock(hashtextextended(ds.event_id::text||':'||canonical,0));
  select * into prior from public.door_admissions where event_id=ds.event_id and person_key=canonical;
  if prior.id is not null then
    return jsonb_build_object('ok',false,'result','already_used','reason','This guest is already checked in. No additional ticket was used.','admission_id',prior.id);
  end if;
  -- Existing pre-migration admissions must not be spent a second time.
  if (mid is not null and exists(select 1 from public.member_id_scans where member_profile_id=mid and event_id=ds.event_id and result='verified'))
    or exists(select 1 from public.trial_pass_checkins c join public.trial_passes p on p.id=c.trial_pass_id
      where c.event_id=ds.event_id and c.result='allowed' and
        (p.id=case when p_kind='trial_pass' then p_subject else null end
         or (uid is not null and p.user_id=uid) or (mid is not null and p.member_profile_id=mid))) then
    return jsonb_build_object('ok',false,'result','already_used','reason','This guest was already checked in. No ticket was used.');
  end if;
  if exists(select 1 from public.front_desk_arrivals a join public.door_sessions s on s.id=a.door_session_id
    where s.event_id=ds.event_id and canonical=any(a.identity_keys)) then
    return jsonb_build_object('ok',false,'result','already_used','reason','This guest was already admitted at the front desk. No ticket was used.');
  end if;

  -- Never trust editable profile email for ticket ownership. For pre-login
  -- purchases only use the identity provider's verified email, exact equality.
  select lower(trim(email)) into verified_email from auth.users
    where id=uid and email_confirmed_at is not null;
  select ti.* into t from public.tickets ti join public.orders ord on ord.id=ti.order_id
    where ti.event_id=ds.event_id and ord.event_id=ds.event_id
      and ti.status='valid' and ord.status in ('paid','partial_refund')
      and (case when nullif(p_ticket_code,'') is not null then ti.ticket_code=p_ticket_code
        else (ord.user_id=uid or ord.member_profile_id=mid or
          (ord.user_id is null and verified_email is not null and lower(trim(ord.buyer_email))=verified_email)) end)
    order by ti.created_at,ti.id limit 1 for update of ti,ord;
  if t.id is null then raise exception 'A valid unused ticket for this event is required. For a group ticket, scan the ticket first, then this guest''s pass.' using errcode='P0001'; end if;

  select * into cap from public.capacity_sessions where is_active=true for update;
  if cap.id is null then raise exception 'Start the capacity session before admitting guests' using errcode='P0001'; end if;
  if cap.current_count>=cap.max_capacity then raise exception 'Venue is at capacity. Hold entry.' using errcode='P0001'; end if;

  update public.tickets set status='used',used_at=now() where id=t.id and status='valid';
  if not found then raise exception 'Ticket already used' using errcode='P0001'; end if;
  insert into public.door_admissions(event_id,door_session_id,person_key,subject_kind,subject_id,ticket_id,actor_id,device_id)
    values(ds.event_id,ds.id,canonical,p_kind,p_subject,t.id,p_actor,p_device) returning id into admission_id;
  insert into public.ticket_checkins(ticket_id,event_id,ticket_code_attempted,result,scanned_by,door_session_id,note)
    values(t.id,ds.event_id,t.ticket_code,'valid',p_actor,ds.id,'admission:'||admission_id::text);
  if p_kind='member' then
    insert into public.member_id_scans(member_profile_id,event_id,result,scanned_by,door_session_id)
      values(p_subject,ds.event_id,'verified',p_actor,ds.id) returning id into log_id;
  else
    insert into public.trial_pass_checkins(trial_pass_id,event_id,result,checked_in_by,door_device_id,door_session_id)
      values(p_subject,ds.event_id,'allowed',staff_id,p_device,ds.id) returning id into log_id;
    update public.trial_passes set activated_at=now(),expires_at=now()+interval '30 days',updated_at=now()
      where id=p_subject and activated_at is null;
  end if;
  update public.capacity_sessions set current_count=current_count+1,updated_at=now() where id=cap.id;
  insert into public.front_desk_arrivals(subject_kind,subject_id,identity_keys,shift_day,
    checked_in_by,capacity_session_id,door_session_id)
    values(p_kind,p_subject,array[canonical,p_kind||':'||p_subject::text],
      ((now() at time zone 'America/Chicago')-interval '6 hours')::date,p_actor,cap.id,ds.id)
    on conflict(shift_day,subject_kind,subject_id) do nothing;
  insert into public.capacity_events(session_id,action,delta,count_after,max_capacity,actor_id,source,note)
    values(cap.id,'check_in',1,cap.current_count+1,cap.max_capacity,p_actor,'front_door','admission:'||admission_id::text);
  return jsonb_build_object('ok',true,'result',case when p_kind='member' then 'verified' else 'allowed' end,
    'admission_id',admission_id,'checkin_id',log_id,'capacity_managed',true,
    'trial_activated',(p_kind='trial_pass' and tp.activated_at is null),
    'ticket',jsonb_build_object('result','valid','ticket_id',t.id));
end;
$$;
revoke all on function public.commit_door_admission(uuid,uuid,text,uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.commit_door_admission(uuid,uuid,text,uuid,text,uuid,uuid,text,text) to service_role;
commit;
