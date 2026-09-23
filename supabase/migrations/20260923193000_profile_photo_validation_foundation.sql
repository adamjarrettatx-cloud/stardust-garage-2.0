-- Additive, disabled-by-default profile-photo validation foundation.
-- This migration does not remove legacy columns, policies, RPC parameters, or
-- upload routes. Those are cut over only after web/mobile clients use accepted
-- immutable assets. New tables are service-role only.

begin;

create table if not exists public.profile_photo_assets (
  id uuid primary key,
  subject_kind text not null check (subject_kind in ('account','trial_pass','application','partner')),
  subject_id uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  storage_bucket text not null default 'profile-photos' check (storage_bucket = 'profile-photos'),
  storage_path text not null unique check (storage_path ~ '^assets/[0-9a-f-]{36}[.]jpg$'),
  normalized_sha256 text not null check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width >= 320 and width <= 1600),
  height integer not null check (height >= 320 and height <= 1600),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  acceptance_kind text not null check (acceptance_kind in ('auto_passed','manual_approved','legacy_unchecked')),
  policy_version text,
  provider text,
  provider_request_id text,
  accepted_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profile_photo_asset_account_owner check (
    subject_kind <> 'account' or owner_user_id is null or subject_id = owner_user_id
  ),
  constraint profile_photo_asset_acceptance check (
    (acceptance_kind = 'legacy_unchecked' and accepted_at is null)
    or (acceptance_kind in ('auto_passed','manual_approved') and accepted_at is not null)
  )
);

create index if not exists profile_photo_assets_subject_idx
  on public.profile_photo_assets(subject_kind, subject_id, created_at desc);

create table if not exists public.profile_photo_subjects (
  subject_kind text not null check (subject_kind in ('account','trial_pass','application','partner')),
  subject_id uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  current_photo_id uuid references public.profile_photo_assets(id) on delete set null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_kind, subject_id)
);

create table if not exists public.profile_photo_uploads (
  id uuid primary key,
  subject_kind text not null check (subject_kind in ('account','trial_pass','application','partner')),
  subject_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  context text not null check (context in ('account','trial_pass','application','partner')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  temporary_storage_path text not null unique
    check (temporary_storage_path = 'uploads/' || id::text || '/original'),
  declared_mime_type text not null,
  declared_byte_size integer not null check (declared_byte_size between 1024 and 5242880),
  state text not null default 'created'
    check (state in ('created','processing','accepted','rejected','retryable_error','expired')),
  policy_version text not null,
  notice_version text not null,
  base_subject_revision bigint not null default 0 check (base_subject_revision >= 0),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  processing_lease_token uuid,
  processing_lease_until timestamptz,
  reason_code text,
  photo_id uuid references public.profile_photo_assets(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id, context, idempotency_key),
  constraint profile_photo_upload_account_owner check (
    subject_kind <> 'account' or (user_id is not null and subject_id = user_id)
  ),
  constraint profile_photo_upload_lease check (
    (state = 'processing' and processing_lease_token is not null and processing_lease_until is not null)
    or (state <> 'processing' and processing_lease_token is null and processing_lease_until is null)
  ),
  constraint profile_photo_upload_notice check (length(notice_version) between 1 and 100)
);

create index if not exists profile_photo_uploads_cleanup_idx
  on public.profile_photo_uploads(expires_at)
  where state in ('created','retryable_error','rejected','expired');

create table if not exists public.profile_photo_events (
  id bigint generated always as identity primary key,
  upload_id uuid references public.profile_photo_uploads(id) on delete set null,
  photo_id uuid references public.profile_photo_assets(id) on delete set null,
  subject_kind text,
  subject_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason_code text,
  policy_version text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists profile_photo_events_subject_idx
  on public.profile_photo_events(subject_kind, subject_id, created_at desc);

create table if not exists public.profile_photo_cleanup_jobs (
  id bigint generated always as identity primary key,
  storage_bucket text not null,
  storage_path text not null,
  earliest_delete_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','processing','complete','failed')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photo-uploads',
  'profile-photo-uploads',
  false,
  5 * 1024 * 1024,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.profile_photo_assets enable row level security;
alter table public.profile_photo_subjects enable row level security;
alter table public.profile_photo_uploads enable row level security;
alter table public.profile_photo_events enable row level security;
alter table public.profile_photo_cleanup_jobs enable row level security;

revoke all on public.profile_photo_assets from public, anon, authenticated;
revoke all on public.profile_photo_subjects from public, anon, authenticated;
revoke all on public.profile_photo_uploads from public, anon, authenticated;
revoke all on public.profile_photo_events from public, anon, authenticated;
revoke all on public.profile_photo_cleanup_jobs from public, anon, authenticated;
revoke all on sequence public.profile_photo_events_id_seq from public, anon, authenticated;
revoke all on sequence public.profile_photo_cleanup_jobs_id_seq from public, anon, authenticated;

-- Do not depend on installation-specific default grants.
grant select, insert, update, delete on
  public.profile_photo_assets, public.profile_photo_subjects,
  public.profile_photo_uploads, public.profile_photo_events,
  public.profile_photo_cleanup_jobs to service_role;
grant usage, select on sequence public.profile_photo_events_id_seq,
  public.profile_photo_cleanup_jobs_id_seq to service_role;

-- Accepted bytes are immutable, even to a mistaken service-role UPDATE.
-- Storage bytes still need storage-side namespace lockdown at cutover.
create or replace function public.guard_profile_photo_asset_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'superseded_at' - 'owner_user_id')
     is distinct from (to_jsonb(old) - 'superseded_at' - 'owner_user_id')
     or (new.owner_user_id is distinct from old.owner_user_id and new.owner_user_id is not null) then
    raise exception 'profile_photo_asset_immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists profile_photo_asset_snapshot_guard on public.profile_photo_assets;
create trigger profile_photo_asset_snapshot_guard
  before update on public.profile_photo_assets for each row
  execute function public.guard_profile_photo_asset_snapshot();
revoke all on function public.guard_profile_photo_asset_snapshot() from public, anon, authenticated;

-- No client storage policies are added. The API issues an object-specific
-- signed upload token; reads and cleanup use the service role.

create or replace function public.claim_profile_photo_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.profile_photo_uploads%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_lease_token is null then
    raise exception 'profile_photo_invalid_claim' using errcode = '22023';
  end if;

  select * into u from public.profile_photo_uploads
  where id = p_upload_id and user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'profile_photo_not_found' using errcode = 'P0002';
  end if;
  if u.state in ('accepted','rejected') then
    return jsonb_build_object(
      'terminal', true, 'state', u.state, 'photo_id', u.photo_id,
      'policy_version', u.policy_version, 'accepted_at', u.accepted_at,
      'reason_code', u.reason_code
    );
  end if;
  if u.expires_at <= now() then
    update public.profile_photo_uploads
       set state = 'expired', updated_at = now(), processing_lease_token = null,
           processing_lease_until = null
     where id = u.id;
    -- Returning instead of raising preserves the expired transition.
    return jsonb_build_object(
      'terminal', true, 'state', 'expired', 'reason_code', 'UPLOAD_EXPIRED'
    );
  end if;
  if u.state = 'processing' and u.processing_lease_until > now() then
    raise exception 'profile_photo_busy' using errcode = '55P03';
  end if;
  if u.attempt_count >= 3 then
    raise exception 'profile_photo_attempts_exhausted' using errcode = 'P0001';
  end if;

  update public.profile_photo_uploads
     set state = 'processing', attempt_count = attempt_count + 1,
         processing_lease_token = p_lease_token,
         processing_lease_until = now() + interval '2 minutes',
         reason_code = null, updated_at = now()
   where id = u.id
   returning * into u;

  return jsonb_build_object(
    'terminal', false, 'temporary_storage_path', u.temporary_storage_path,
    'declared_mime_type', u.declared_mime_type,
    'declared_byte_size', u.declared_byte_size,
    'policy_version', u.policy_version
  );
end;
$$;

create or replace function public.retry_profile_photo_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_reason_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.profile_photo_uploads
     set state = 'retryable_error', reason_code = left(p_reason_code, 80),
         processing_lease_token = null, processing_lease_until = null,
         updated_at = now()
   where id = p_upload_id and user_id = p_actor_user_id
     and state = 'processing' and processing_lease_token = p_lease_token
     and processing_lease_until > now();
  if not found then
    raise exception 'profile_photo_lease_lost' using errcode = '55P03';
  end if;
end;
$$;

create or replace function public.reject_profile_photo_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_reason_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.profile_photo_uploads%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.profile_photo_uploads
     set state = 'rejected', reason_code = left(p_reason_code, 80),
         processing_lease_token = null, processing_lease_until = null,
         updated_at = now()
   where id = p_upload_id and user_id = p_actor_user_id
     and state = 'processing' and processing_lease_token = p_lease_token
     and processing_lease_until > now()
   returning * into u;
  if not found then
    raise exception 'profile_photo_lease_lost' using errcode = '55P03';
  end if;
  insert into public.profile_photo_events(
    upload_id, subject_kind, subject_id, actor_user_id, action,
    reason_code, policy_version
  ) values (
    u.id, u.subject_kind, u.subject_id, p_actor_user_id, 'rejected',
    u.reason_code, u.policy_version
  );
  insert into public.profile_photo_cleanup_jobs(storage_bucket, storage_path, earliest_delete_at)
  values ('profile-photo-uploads', u.temporary_storage_path, now())
  on conflict (storage_bucket,storage_path) do nothing;
end;
$$;

create or replace function public.commit_profile_photo_asset(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_photo_id uuid,
  p_final_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_byte_size integer,
  p_provider text,
  p_provider_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.profile_photo_uploads%rowtype;
  s public.profile_photo_subjects%rowtype;
  prior_asset public.profile_photo_assets%rowtype;
  accepted_time timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into u from public.profile_photo_uploads
   where id = p_upload_id and user_id = p_actor_user_id
   for update;
  if not found then
    raise exception 'profile_photo_not_found' using errcode = 'P0002';
  end if;
  -- Replaying a confirmed commit with the same asset is safe, including
  -- after the upload deadline. A different asset is never substituted.
  if u.state = 'accepted' then
    if u.photo_id is distinct from p_photo_id then
      raise exception 'profile_photo_already_committed' using errcode = '40001';
    end if;
    return jsonb_build_object('photo_id', u.photo_id, 'policy_version', u.policy_version,
      'accepted_at', u.accepted_at, 'replayed', true);
  end if;
  if u.state <> 'processing'
     or u.processing_lease_token is distinct from p_lease_token
     or p_lease_token is null
     or u.processing_lease_until <= now() then
    raise exception 'profile_photo_lease_lost' using errcode = '55P03';
  end if;
  if u.expires_at <= now() then
    raise exception 'profile_photo_expired' using errcode = 'P0001';
  end if;
  if u.context <> 'account' or u.subject_kind <> 'account'
     or u.subject_id <> p_actor_user_id then
    raise exception 'profile_photo_subject_mismatch' using errcode = '42501';
  end if;
  if p_photo_id is null or p_final_storage_path is distinct from ('assets/' || p_photo_id::text || '.jpg') then
    raise exception 'profile_photo_path_invalid' using errcode = '22023';
  end if;
  if p_provider is distinct from 'aws_rekognition' or u.policy_version <> 'face_photo_v1' then
    raise exception 'profile_photo_policy_mismatch' using errcode = '22023';
  end if;

  insert into public.profile_photo_subjects(
    subject_kind, subject_id, owner_user_id, revision
  ) values ('account', p_actor_user_id, p_actor_user_id, 0)
  on conflict (subject_kind, subject_id) do nothing;

  select * into s from public.profile_photo_subjects
   where subject_kind = 'account' and subject_id = p_actor_user_id
   for update;
  if s.revision <> u.base_subject_revision then
    raise exception 'profile_photo_conflict' using errcode = '40001';
  end if;
  if s.current_photo_id is not null then
    select * into prior_asset from public.profile_photo_assets
     where id = s.current_photo_id;
  end if;

  insert into public.profile_photo_assets(
    id, subject_kind, subject_id, owner_user_id, storage_path,
    normalized_sha256, width, height, byte_size, acceptance_kind,
    policy_version, provider, provider_request_id, accepted_at
  ) values (
    p_photo_id, 'account', p_actor_user_id, p_actor_user_id, p_final_storage_path,
    p_sha256, p_width, p_height, p_byte_size, 'auto_passed',
    u.policy_version, left(p_provider, 80), left(p_provider_request_id, 200),
    accepted_time
  );

  update public.profile_photo_subjects
     set current_photo_id = p_photo_id, revision = revision + 1,
         updated_at = accepted_time
   where subject_kind = 'account' and subject_id = p_actor_user_id;

  -- Compatibility projections remain server-maintained during the staged
  -- migration. Both account and member views resolve the same accepted asset.
  update public.free_accounts
     set profile_photo_path = p_final_storage_path,
         profile_photo_uploaded_at = accepted_time,
         updated_at = accepted_time
   where user_id = p_actor_user_id;
  update public.member_profiles
     set profile_photo_path = p_final_storage_path
   where user_id = p_actor_user_id;

  update public.profile_photo_uploads
     set state = 'accepted', photo_id = p_photo_id, accepted_at = accepted_time,
         reason_code = 'ACCEPTED', processing_lease_token = null,
         processing_lease_until = null, updated_at = accepted_time
   where id = u.id;

  if prior_asset.id is not null then
    update public.profile_photo_assets set superseded_at = accepted_time
     where id = prior_asset.id;
    insert into public.profile_photo_cleanup_jobs(
      storage_bucket, storage_path, earliest_delete_at
    ) values (
      prior_asset.storage_bucket, prior_asset.storage_path,
      accepted_time + interval '24 hours'
    ) on conflict (storage_bucket, storage_path) do nothing;
  end if;

  insert into public.profile_photo_events(
    upload_id, photo_id, subject_kind, subject_id, actor_user_id,
    action, reason_code, policy_version
  ) values (
    u.id, p_photo_id, 'account', p_actor_user_id, p_actor_user_id,
    'accepted', 'ACCEPTED', u.policy_version
  );
  insert into public.profile_photo_cleanup_jobs(storage_bucket, storage_path, earliest_delete_at)
  values ('profile-photo-uploads', u.temporary_storage_path, accepted_time)
  on conflict (storage_bucket,storage_path) do nothing;

  return jsonb_build_object(
    'photo_id', p_photo_id, 'policy_version', u.policy_version,
    'accepted_at', accepted_time, 'subject_revision', s.revision + 1
  );
end;
$$;

revoke all on function public.claim_profile_photo_upload(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.retry_profile_photo_upload(uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.reject_profile_photo_upload(uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.commit_profile_photo_asset(
  uuid,uuid,uuid,uuid,text,text,integer,integer,integer,text,text
) from public, anon, authenticated;

grant execute on function public.claim_profile_photo_upload(uuid,uuid,uuid)
  to service_role;
grant execute on function public.retry_profile_photo_upload(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.reject_profile_photo_upload(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.commit_profile_photo_asset(
  uuid,uuid,uuid,uuid,text,text,integer,integer,integer,text,text
) to service_role;

commit;
