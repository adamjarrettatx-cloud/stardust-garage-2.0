-- Trial SDG Pass: sealed token so the signed-in profile can show the QR.
--
-- qr_token_hash remains the only lookup key for scans and /pass/<token>.
-- qr_token_sealed holds AES-256-GCM ciphertext of the same raw token, keyed by
-- a server-only secret, so /account/profile can redraw the guest's own QR
-- without rotating it (which would break the link in their email).
--
-- Additive and nullable: rows without a seal keep working everywhere, and the
-- profile re-mints such a pass once on first view.

alter table public.trial_passes
  add column if not exists qr_token_sealed text;

comment on column public.trial_passes.qr_token_sealed is
  'AES-256-GCM sealed raw pass token (server key). Decrypted only for the authenticated pass owner on /account/profile. Lookups use qr_token_hash.';
