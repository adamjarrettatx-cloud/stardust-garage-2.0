-- free_accounts.welcome_email_sent_at
--
-- Timestamp of the one-time "Welcome to Stardust Garage" email that goes out
-- when a guest first creates a Stardust account. This is deliberately a
-- separate column (not a boolean, not "created_at + N seconds") so that:
--
--   * Every account-creation route can call sendGuestAccountWelcome under an
--     idempotent update guarded by `welcome_email_sent_at IS NULL`. If two
--     concurrent requests race, only one write flips the column and only
--     that request sends the email.
--
--   * Reconnect / re-upsert branches (create-no-verify's "already registered"
--     path, verify/check's list-users fallback, OAuth complete-profile after
--     a partial earlier signup) do NOT re-send. Once the row is stamped, it
--     stays stamped.
--
--   * If a send genuinely fails, the column stays NULL and the next signup
--     touch (or a future backfill job) can retry without a schema change.
--
-- No default: existing rows created before this column existed stay NULL,
-- and the sender explicitly treats NULL as "eligible to send" only during a
-- fresh account-creation call — a pre-existing account that predates this
-- feature will never receive a retroactive welcome, because the send call
-- sites only fire from the create paths.

ALTER TABLE public.free_accounts
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

COMMENT ON COLUMN public.free_accounts.welcome_email_sent_at IS
  'Timestamp of the one-time guest-account welcome email. NULL means not yet sent; set exactly once by the account-creation routes under an idempotent update.';
