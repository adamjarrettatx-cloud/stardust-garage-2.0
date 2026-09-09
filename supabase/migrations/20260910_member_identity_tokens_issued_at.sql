-- Give Member ID credentials a finite lifetime for the mobile refresh
-- contract. The existing table predates expiry and enforces one historical
-- row per member, so replace that constraint with one live row per member.
-- Historical revoked rows remain available for audit.

alter table public.member_identity_tokens
  add column if not exists issued_at timestamptz,
  add column if not exists expires_at timestamptz;

-- Preserve existing badges for their original 90-day issuance window rather
-- than changing their effective start date when this migration is applied.
update public.member_identity_tokens
set
  issued_at = coalesce(issued_at, created_at),
  expires_at = coalesce(expires_at, created_at + interval '90 days');

alter table public.member_identity_tokens
  alter column issued_at set default now(),
  alter column issued_at set not null,
  alter column expires_at set default (now() + interval '90 days'),
  alter column expires_at set not null;

alter table public.member_identity_tokens
  drop constraint if exists member_identity_tokens_member_profile_id_key;

drop index if exists public.member_identity_tokens_active_idx;

create unique index if not exists member_identity_tokens_one_active_idx
  on public.member_identity_tokens (member_profile_id)
  where revoked_at is null;

create index if not exists member_identity_tokens_active_expiry_idx
  on public.member_identity_tokens (member_profile_id, expires_at)
  where revoked_at is null;

comment on column public.member_identity_tokens.issued_at is
  'When this Member ID credential was issued.';
comment on column public.member_identity_tokens.expires_at is
  'When this Member ID credential expires; mobile clients refresh one hour before this time.';
