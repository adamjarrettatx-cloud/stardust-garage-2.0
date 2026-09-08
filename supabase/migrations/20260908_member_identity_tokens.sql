-- Member identity tokens: one durable badge token per member.
--
-- Mirrors the trial-pass table shape (see 20260819_trial_pass_intake.sql):
--   * token_hash is what's stored; the raw token lives only in the wallet URL
--   * one row per member (unique on member_profile_id + unique on token_hash)
--   * created_at + rotated_at for audit; issued_at is redundant with created_at
--     for now but kept if we ever start rotating tokens on a schedule
--
-- Backfill for existing members happens in the application layer (see
-- scripts/backfill-member-identity-tokens.mjs) rather than in this migration,
-- because a per-row random value cannot be produced inside a single SQL
-- statement without pgcrypto and we do not want a migration that
-- non-deterministically writes credentials to prod.
--
-- The token IS the credential; RLS forbids SELECT for anyone. All reads go
-- through the service-role client (mirrors how trial_passes is accessed).

create table if not exists public.member_identity_tokens (
  id                  uuid primary key default gen_random_uuid(),
  member_profile_id   uuid not null references public.member_profiles(id) on delete cascade,
  token_hash          text not null,
  -- Raw token, service-role-readable only. We store it (in addition to the
  -- hash) so the wallet UI can display the same QR every time without the
  -- member having to preserve a link. Unlike a session cookie, this is a
  -- badge value the member is INTENDED to see repeatedly on their own
  -- wallet page — same posture as Apple Pay's DPAN or a physical member
  -- card serial. RLS + revoked default grants keeps it away from any non-
  -- service-role client.
  token_raw           text not null,
  created_at          timestamptz not null default now(),
  rotated_at          timestamptz,
  revoked_at          timestamptz,
  revoke_reason       text,
  constraint member_identity_tokens_member_profile_id_key unique (member_profile_id),
  constraint member_identity_tokens_token_hash_key unique (token_hash)
);

create index if not exists member_identity_tokens_active_idx
  on public.member_identity_tokens (member_profile_id)
  where revoked_at is null;

alter table public.member_identity_tokens enable row level security;

-- Deny-by-default: no grants, no policies. Service role bypasses RLS.
-- (Explicit revoke of default anon/authenticated grants for paranoia.)
revoke all on public.member_identity_tokens from anon, authenticated;

comment on table public.member_identity_tokens is
  'One durable identity token per member. Raw token is the badge credential; DB stores only the SHA-256 hash. Photo verification at the door is the real gate. Modelled on trial_passes.';
comment on column public.member_identity_tokens.token_hash is
  'SHA-256 hex of the raw token. Raw token never persisted; lives in the /member/id URL and the wallet page.';
comment on column public.member_identity_tokens.rotated_at is
  'Last time this member accepted a rotation (e.g. lost device). Null for original issuance.';
comment on column public.member_identity_tokens.revoked_at is
  'Set when this token can no longer be scanned. Currently written only by admin action; the row is kept for audit rather than deleted.';
