begin;

create function public.is_valid_legal_name(p_name text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(length(p_name) between 3 and 120
    and cardinality(regexp_split_to_array(p_name,' ')) >= 2
    and (select bool_and(part ~ '[[:alpha:]]' and part !~ '[^[:alpha:].''’ʼ-]')
      from unnest(regexp_split_to_array(p_name,' ')) part),false);
$$;
-- Validate new intake and actual name changes, not legacy rows on unrelated
-- updates (photos, activation, billing). No destructive backfill.
create function public.require_legal_full_name() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.full_name is not distinct from old.full_name then return new; end if;
  new.full_name := btrim(regexp_replace(normalize(new.full_name,NFC), '[[:space:]]+', ' ', 'g'));
  if not public.is_valid_legal_name(new.full_name) then
    raise exception 'Enter your legal first and last name as shown on your ID.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger legal_name_intake before insert or update of full_name on public.free_accounts
  for each row execute function public.require_legal_full_name();
create trigger legal_name_intake before insert or update of full_name on public.trial_passes
  for each row execute function public.require_legal_full_name();
create trigger legal_name_intake before insert or update of full_name on public.membership_applications
  for each row execute function public.require_legal_full_name();
create trigger legal_name_intake before insert or update of full_name on public.member_profiles
  for each row execute function public.require_legal_full_name();

create table public.legal_name_corrections (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null,
  subject_id uuid not null,
  identity_keys text[] not null,
  old_names text[] not null,
  new_name text not null,
  reason text not null check (length(reason) between 1 and 500),
  actor_id uuid not null references auth.users(id),
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index legal_name_corrections_identity on public.legal_name_corrections using gin(identity_keys);
alter table public.legal_name_corrections enable row level security;
revoke all on public.legal_name_corrections from public, anon, authenticated;
grant select, insert on public.legal_name_corrections to service_role;

-- Service-only RPC, role rechecked here as well as at the HTTP boundary.
-- Every related write and its audit record commit or roll back together.
-- IDs establish linkage; never merge people by matching names/email/phone.
create function public.correct_legal_name(
  p_actor uuid, p_kind text, p_id uuid, p_expected_name text, p_name text, p_reason text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_role text; v_label text; v_old text; v_user uuid; v_member uuid; v_guest uuid; v_order uuid;
  v_users uuid[] := '{}'; v_members uuid[] := '{}'; v_guests uuid[] := '{}'; v_passes uuid[] := '{}';
  v_keys text[]; v_names text[]; v_size int := -1; v_next int; v_audit uuid;
begin
  select role, coalesce(nullif(full_name,''),'Staff') into v_role,v_label from public.team_members where user_id=p_actor;
  if v_role is null or v_role not in ('admin','team','front_desk') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  p_name := btrim(regexp_replace(normalize(p_name,NFC),'[[:space:]]+',' ','g'));
  if not public.is_valid_legal_name(p_name) or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'Legal first and last name and a correction reason are required' using errcode='22023';
  end if;
  -- Serialize corrections across related subjects. This is a low-volume staff
  -- operation, so a single transaction lock avoids cross-subject deadlocks.
  perform pg_advisory_xact_lock(23092601);
  if p_kind='trial_pass' then
    select full_name,user_id,member_profile_id,guest_profile_id into v_old,v_user,v_member,v_guest
      from public.trial_passes where id=p_id for update;
    v_passes := array[p_id];
  elsif p_kind='member' then
    select full_name,user_id,id into v_old,v_user,v_member from public.member_profiles where id=p_id for update;
  elsif p_kind='guestlist' then
    select guest_name,guest_profile_id into v_old,v_guest from public.event_guestlist_entries where id=p_id for update;
  elsif p_kind='ticket' then
    select order_id into v_order from public.tickets where id=p_id;
    select buyer_name,user_id,member_profile_id into v_old,v_user,v_member from public.orders where id=v_order for update;
    -- The scanner prefers the current account name over the purchase snapshot.
    select coalesce((select full_name from public.free_accounts where user_id=v_user),
      (select full_name from public.member_profiles where id=v_member or user_id=v_user limit 1),v_old) into v_old;
  else
    raise exception 'Unsupported guest reference' using errcode='22023';
  end if;
  if v_old is null then raise exception 'Guest not found' using errcode='P0002'; end if;
  if v_old is distinct from p_expected_name then
    raise exception 'Name changed. Refresh before saving.' using errcode='40001';
  end if;
  if v_user is not null then v_users := array[v_user]; end if;
  if v_member is not null then v_members := array[v_member]; end if;
  if v_guest is not null then v_guests := array[v_guest]; end if;

  -- Follow existing durable profile links in both directions.
  loop
    select coalesce(array_agg(distinct id),'{}') into v_passes from public.trial_passes
      where id=any(v_passes) or user_id=any(v_users) or member_profile_id=any(v_members) or guest_profile_id=any(v_guests);
    select coalesce(array_agg(distinct id),'{}') into v_members from public.member_profiles
      where id=any(v_members) or user_id=any(v_users)
        or id in (select member_profile_id from public.trial_passes where id=any(v_passes));
    select coalesce(array_agg(distinct id),'{}') into v_users from (
      select unnest(v_users) id union select user_id from public.member_profiles where id=any(v_members)
      union select user_id from public.trial_passes where id=any(v_passes)
    ) u where id is not null;
    select coalesce(array_agg(distinct id),'{}') into v_guests from (
      select unnest(v_guests) id union select guest_profile_id from public.trial_passes where id=any(v_passes)
    ) g where id is not null;
    if cardinality(v_users)>1 then
      raise exception 'Conflicting linked accounts. Ask an admin to review.' using errcode='40001';
    end if;
    v_next := cardinality(v_passes)+cardinality(v_members)+cardinality(v_users)+cardinality(v_guests);
    exit when v_next=v_size;
    v_size := v_next;
  end loop;
  select array_agg(distinct key) into v_keys from (
    select p_kind||':'||p_id key
    union select 'user:'||unnest(v_users)
    union select 'member:'||unnest(v_members)
    union select 'trial_pass:'||unnest(v_passes)
    union select 'guest:'||unnest(v_guests)
    union select 'guestlist:'||id from public.event_guestlist_entries where guest_profile_id=any(v_guests)
  ) k;
  select array_agg(distinct name) into v_names from (
    select v_old name
    union select full_name from public.free_accounts where user_id=any(v_users)
    union select full_name from public.member_profiles where id=any(v_members)
    union select full_name from public.trial_passes where id=any(v_passes)
    union select full_name from public.guest_profiles where id=any(v_guests)
    union select guest_name from public.event_guestlist_entries where guest_profile_id=any(v_guests)
  ) n where name is not null;

  update public.free_accounts set full_name=p_name,updated_at=now() where user_id=any(v_users);
  update public.member_profiles set full_name=p_name where id=any(v_members);
  update public.trial_passes set full_name=p_name where id=any(v_passes);
  update public.guest_profiles set full_name=p_name where id=any(v_guests);
  update public.event_guestlist_entries set guest_name=p_name
    where guest_profile_id=any(v_guests) or (p_kind='guestlist' and id=p_id);
  -- Leave historical orders/waivers alone unless the scanned legacy order is
  -- the only identity record available for this buyer.
  if p_kind='ticket' and cardinality(v_members)=0
    and not exists(select 1 from public.free_accounts where user_id=any(v_users)) then
    update public.orders set buyer_name=p_name where id=v_order;
  end if;
  -- Auth/provider metadata and signed waivers remain historical, not the
  -- authoritative legal name. No auth-schema privileges are needed.
  insert into public.legal_name_corrections(subject_kind,subject_id,identity_keys,old_names,new_name,reason,actor_id,actor_label)
    values(p_kind,p_id,v_keys,v_names,p_name,btrim(p_reason),p_actor,v_label) returning id into v_audit;
  return jsonb_build_object('fullName',p_name,'correctionId',v_audit);
end $$;
revoke all on function public.correct_legal_name(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.correct_legal_name(uuid,text,uuid,text,text,text) to service_role;
commit;
