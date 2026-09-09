-- SECURITY: raw Member ID credentials must never be retained at rest.
-- The application now stores and looks up only token_hash.

alter table public.member_identity_tokens drop column if exists token_raw;

comment on table public.member_identity_tokens is
  'Member ID credentials are hash-only: token_hash is the SHA-256 digest; raw tokens are emitted only at issuance and never stored.';
