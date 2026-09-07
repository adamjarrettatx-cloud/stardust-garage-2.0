-- Allow free_accounts.phone_verified_at to be NULL.
--
-- Background:
--   The original free_accounts schema was written assuming every row would be
--   created only *after* Twilio confirmed the phone (trial-pass flow), so
--   phone_verified_at was declared NOT NULL DEFAULT now().
--
--   The ticket-checkout flow later added Google-OAuth "no-verify" endpoints
--   (/api/free-account/create-no-verify and
--    /api/free-account/complete-profile-no-verify) that intentionally capture
--   a phone number WITHOUT Twilio verification. Both routes try to record that
--   fact by writing phone_verified_at = NULL, which the NOT NULL constraint
--   rejects. Result: users completing their profile from the /account/tickets
--   nudge got a 500 "Could not save profile" for every attempt.
--
-- Fix:
--   Make phone_verified_at nullable. Semantics match the trial_passes column
--   of the same name, which is already documented as "NULL means not yet
--   verified". Existing rows keep their timestamps; new no-verify rows can
--   sit at NULL until (if ever) they later go through Twilio.
--
--   The DEFAULT now() is left in place. Verified paths still write an
--   explicit timestamp via `.upsert({ phone_verified_at: now, ... })`; the
--   default is only relevant to rows inserted without touching the column,
--   which no code path currently does.

alter table public.free_accounts
  alter column phone_verified_at drop not null;
