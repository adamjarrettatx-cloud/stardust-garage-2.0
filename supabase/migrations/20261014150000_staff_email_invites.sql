-- Staff email invites. Additive; same posture as the time-clock migrations:
-- RLS on, no browser grants, writes only through service-role SECURITY
-- DEFINER RPCs that gated Next.js routes call after verifying the caller.
--
-- A manager sends an invite to an email address. The employee opens a
-- single-use link (72 hours) and chooses their own password, four-digit iPad
-- PIN, birthday and private photo. Only a keyed hash of the link token is
-- stored. Staff who already have logins add a missing photo/birthday from the
-- employee portal (tc_employee_profile).
begin;

-- A staff profile can now exist before its PIN is chosen. NULL never matches
-- a kiosk lookup, so a profile without a PIN simply cannot clock in yet.
alter table public.tc_workers
  alter column pin_lookup drop not null,
  alter column pin_verifier drop not null,
  add column birthdate date check (birthdate >= date '1900-01-01'),
  -- Private bucket object, readable only through short-lived signed URLs
  -- minted for Timekeeping managers or the employee themself.
  add column photo_path text check (photo_path ~ '^staff/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$'),
  add column photo_uploaded_at timestamptz,
  add column pin_set_by_employee_at timestamptz,
  add constraint tc_workers_pin_pair check ((pin_lookup is null) = (pin_verifier is null));

create table public.tc_invites (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.tc_workers(id) on delete cascade,
  -- setup: first account setup. pin: choose a new iPad PIN (manager reset).
  kind text not null check (kind in ('setup', 'pin')),
  email text not null check (length(email) between 3 and 254),
  token_hash text not null unique check (length(token_hash) = 64),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  attempts integer not null default 0
);
create index tc_invites_worker on public.tc_invites(worker_id, created_at desc);
-- At most one open invite of each kind per profile.
create unique index tc_invites_one_open on public.tc_invites(worker_id, kind)
  where used_at is null and revoked_at is null;

-- Manager actions: create (replaces any open invite of the same kind) and
-- revoke. Email delivery happens in the API after create succeeds; if
-- delivery fails the API revokes the invite.
create function public.tc_invite_admin(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.tc_workers; i public.tc_invites; k text = coalesce(p_payload->>'kind', 'setup'); n integer;
begin
  if p_actor is null then raise exception 'not_authorized'; end if;
  if k not in ('setup', 'pin') then raise exception 'invalid_action'; end if;
  select * into w from public.tc_workers where id = (p_payload->>'worker_id')::uuid for update;
  if w.id is null then raise exception 'worker_not_found'; end if;
  if p_action = 'create' then
    if not w.active then raise exception 'schedule_worker_inactive'; end if;
    if k = 'setup' and w.user_id is not null then raise exception 'login_exists'; end if;
    if k = 'pin' and w.user_id is null then raise exception 'login_missing'; end if;
    if coalesce(length(p_payload->>'token_hash'), 0) <> 64 then raise exception 'invalid_action'; end if;
    update public.tc_invites set revoked_at = clock_timestamp()
      where worker_id = w.id and kind = k and used_at is null and revoked_at is null;
    insert into public.tc_invites(worker_id, kind, email, token_hash, created_by, expires_at)
      values (w.id, k, lower(trim(p_payload->>'email')), p_payload->>'token_hash', p_actor,
        clock_timestamp() + interval '72 hours')
      returning * into i;
    insert into public.tc_audit(worker_id, actor_id, action, details)
      values (w.id, p_actor, 'invite_' || k || '_create', jsonb_build_object('invite_id', i.id, 'email', i.email));
    return jsonb_build_object('id', i.id, 'expires_at', i.expires_at, 'email', i.email);
  elsif p_action = 'revoke' then
    update public.tc_invites set revoked_at = clock_timestamp()
      where worker_id = w.id and kind = k and used_at is null and revoked_at is null;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'invite_not_found'; end if;
    insert into public.tc_audit(worker_id, actor_id, action, details)
      values (w.id, p_actor, 'invite_' || k || '_revoke', '{}'::jsonb);
    return jsonb_build_object('id', w.id);
  end if;
  raise exception 'invalid_action';
end $$;

-- Read a still-usable invite by token hash for the setup page. Returns null
-- for unknown, expired, used, revoked or over-attempted links, inactive
-- profiles, and setup links whose profile already has a login.
create function public.tc_invite_peek(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.tc_invites; w public.tc_workers;
begin
  select * into i from public.tc_invites where token_hash = p_token_hash;
  if i.id is null or i.used_at is not null or i.revoked_at is not null
    or i.expires_at <= clock_timestamp() or i.attempts >= 20 then return null; end if;
  select * into w from public.tc_workers where id = i.worker_id and active;
  if w.id is null then return null; end if;
  if i.kind = 'setup' and w.user_id is not null then return null; end if;
  if i.kind = 'pin' and w.user_id is null then return null; end if;
  return jsonb_build_object('invite_id', i.id, 'kind', i.kind, 'email', i.email, 'expires_at', i.expires_at,
    'worker_id', w.id, 'name', w.name, 'category', w.category,
    'roles', coalesce((select jsonb_agg(r.name order by r.name) from public.tc_assignments a
      join public.tc_roles r on r.id = a.role_id where a.worker_id = w.id and r.active), '[]'::jsonb));
end $$;

-- Count a submission attempt against the link (independent of IP limits).
create function public.tc_invite_attempt(p_token_hash text)
returns void language sql security definer set search_path = '' as $$
  update public.tc_invites set attempts = attempts + 1
    where token_hash = p_token_hash and used_at is null and revoked_at is null;
$$;

-- Redeem atomically. The API has already created (or chosen) the Auth user
-- and uploaded the photo; any failure here makes the API undo both.
create function public.tc_invite_redeem(p_token_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.tc_invites; w public.tc_workers; u uuid; lookup text = p_payload->>'pin_lookup';
begin
  select * into i from public.tc_invites where token_hash = p_token_hash for update;
  if i.id is null or i.used_at is not null or i.revoked_at is not null
    or i.expires_at <= clock_timestamp() then raise exception 'invite_invalid'; end if;
  select * into w from public.tc_workers where id = i.worker_id and active for update;
  if w.id is null then raise exception 'invite_invalid'; end if;
  if coalesce(length(lookup), 0) <> 64 or coalesce(p_payload->>'pin_verifier', '') = '' then
    raise exception 'pin_invalid';
  end if;
  if exists(select 1 from public.tc_workers o where o.pin_lookup = lookup and o.id <> w.id) then
    raise exception 'pin_taken';
  end if;
  if i.kind = 'setup' then
    if w.user_id is not null then raise exception 'login_exists'; end if;
    u = (p_payload->>'user_id')::uuid;
    if u is null then raise exception 'invite_invalid'; end if;
    if exists(select 1 from public.tc_workers o where o.user_id = u) then raise exception 'account_linked'; end if;
    if nullif(p_payload->>'username', '') is not null and exists(
        select 1 from public.tc_workers o where o.username = p_payload->>'username' and o.id <> w.id) then
      raise exception 'username_taken';
    end if;
    if (p_payload->>'birthdate') is null or (p_payload->>'birthdate')::date > current_date
      or (p_payload->>'photo_path') is null then
      raise exception 'profile_incomplete';
    end if;
    update public.tc_workers set user_id = u, username = nullif(p_payload->>'username', ''),
      login_enabled = true, login_managed = coalesce((p_payload->>'managed')::boolean, false),
      pin_lookup = lookup, pin_verifier = p_payload->>'pin_verifier', credential_version = gen_random_uuid(),
      pin_set_by_employee_at = clock_timestamp(), birthdate = (p_payload->>'birthdate')::date,
      photo_path = p_payload->>'photo_path', photo_uploaded_at = clock_timestamp()
      where id = w.id returning * into w;
  else
    if w.user_id is null then raise exception 'invite_invalid'; end if;
    if w.pin_lookup = lookup then raise exception 'pin_unchanged'; end if;
    update public.tc_workers set pin_lookup = lookup, pin_verifier = p_payload->>'pin_verifier',
      credential_version = gen_random_uuid(), pin_set_by_employee_at = clock_timestamp()
      where id = w.id returning * into w;
  end if;
  update public.tc_invites set used_at = clock_timestamp() where id = i.id;
  -- Any other open invite for this profile is now moot.
  update public.tc_invites set revoked_at = clock_timestamp()
    where worker_id = w.id and id <> i.id and used_at is null and revoked_at is null
      and (kind = i.kind or i.kind = 'setup');
  insert into public.tc_audit(worker_id, actor_id, action, details)
    values (w.id, w.user_id, 'invite_' || i.kind || '_redeem',
      jsonb_build_object('invite_id', i.id, 'username', w.username, 'managed', w.login_managed));
  return jsonb_build_object('id', w.id, 'user_id', w.user_id, 'username', w.username, 'managed', w.login_managed);
end $$;

-- Signed-in employee self-service: complete a missing photo/birthday and
-- choose a new iPad PIN. The API passes the VERIFIED Auth user id.
create function public.tc_employee_profile(p_user uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.tc_workers; lookup text = p_payload->>'pin_lookup'; old_photo text;
begin
  select * into w from public.tc_workers where user_id = p_user and active and login_enabled for update;
  if w.id is null then raise exception 'not_employee'; end if;
  if p_action = 'complete' then
    if (p_payload->>'birthdate') is null and w.birthdate is null then raise exception 'profile_incomplete'; end if;
    if (p_payload->>'photo_path') is null and w.photo_path is null then raise exception 'profile_incomplete'; end if;
    if (p_payload->>'birthdate')::date > current_date then raise exception 'profile_incomplete'; end if;
    old_photo = w.photo_path;
    update public.tc_workers set
      birthdate = coalesce((p_payload->>'birthdate')::date, birthdate),
      photo_path = coalesce(p_payload->>'photo_path', photo_path),
      photo_uploaded_at = case when p_payload->>'photo_path' is null then photo_uploaded_at else clock_timestamp() end
      where id = w.id returning * into w;
    insert into public.tc_audit(worker_id, actor_id, action, details)
      values (w.id, p_user, 'employee_profile_complete',
        jsonb_build_object('birthdate_set', (p_payload->>'birthdate') is not null, 'photo_set', (p_payload->>'photo_path') is not null));
    return jsonb_build_object('id', w.id,
      'replaced_photo', case when p_payload->>'photo_path' is not null then old_photo end);
  elsif p_action = 'set_pin' then
    if coalesce(length(lookup), 0) <> 64 or coalesce(p_payload->>'pin_verifier', '') = '' then raise exception 'pin_invalid'; end if;
    if w.pin_lookup = lookup then raise exception 'pin_unchanged'; end if;
    if exists(select 1 from public.tc_workers o where o.pin_lookup = lookup and o.id <> w.id) then raise exception 'pin_taken'; end if;
    update public.tc_workers set pin_lookup = lookup, pin_verifier = p_payload->>'pin_verifier',
      credential_version = gen_random_uuid(), pin_set_by_employee_at = clock_timestamp()
      where id = w.id;
    update public.tc_invites set revoked_at = clock_timestamp()
      where worker_id = w.id and kind = 'pin' and used_at is null and revoked_at is null;
    insert into public.tc_audit(worker_id, actor_id, action, details) values (w.id, p_user, 'employee_pin_set', '{}'::jsonb);
    return jsonb_build_object('id', w.id);
  end if;
  raise exception 'invalid_action';
end $$;

do $$
declare signature text;
begin
  execute 'alter table public.tc_invites enable row level security';
  execute 'revoke all on table public.tc_invites from public,anon,authenticated,service_role';
  execute 'grant select on table public.tc_invites to service_role';
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tc_invite_admin', 'tc_invite_peek', 'tc_invite_attempt',
      'tc_invite_redeem', 'tc_employee_profile') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end $$;
commit;
