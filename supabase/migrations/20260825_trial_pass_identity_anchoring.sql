-- Trial SDG Pass — identity anchoring (part 2 of the trial-pass build)
--
-- Adds the two things the original 20260819 migration deliberately did not:
--
--   1. email_canonical — a normalized copy of the email that is what we actually
--      dedupe on. lower(email) alone stopped `Adam@Gmail.com` vs
--      `adam@gmail.com`, and nothing else. Anyone with a Gmail could farm a
--      fresh 30-day window by adding a dot or a +tag. We now normalize:
--
--        - lowercased
--        - strip everything from `+` through `@` in the local part
--        - if the host is gmail.com or googlemail.com, strip dots from the
--          local part and rewrite the host to gmail.com
--
--      Stored as a generated column so the value cannot drift from the raw
--      email: any UPDATE to `email` re-derives `email_canonical` automatically.
--
--   2. Unique index on phone — the E.164 phone is the identity anchor once
--      SMS verify lands (a burner email is free; a phone number is not). Same
--      phone appearing again at intake means "return this guest's pass",
--      not "start a new 30-day trial."
--
-- Also renames the existing unique index on `lower(email)` to a canonical
-- version, because with email_canonical in place the `lower()` index is
-- redundant and gives duplicate hits during the create-route lookup.
--
-- Backfill runs inline: every existing trial_passes.email gets its
-- email_canonical computed the same way the generated column will compute it,
-- so the new UNIQUE index applies to the current dataset without a follow-up
-- job. Same for the phone unique index (existing rows already have E.164).
--
-- Additive to schema, and enforcement is picked up automatically. If two
-- existing rows collide on canonical email (or phone), the ADD CONSTRAINT
-- fails loudly — which is exactly what we want in that case. Prod has ~0 rows
-- in trial_passes today so there is nothing to collide.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. email_canonical as a stored generated column
-- ---------------------------------------------------------------------------

-- Postgres generated columns cannot call arbitrary SQL functions marked as
-- volatile or that reference other columns transitively, but they can inline
-- expressions. The one below is pure text manipulation:
--   a) lowercase
--   b) split on '@' into local + host
--   c) drop the '+tag' portion of the local part
--   d) if host in (gmail.com, googlemail.com), strip dots from local and
--      normalize host to gmail.com
--
-- Kept in a single expression so it can live in a STORED generated column.
-- Anything more elaborate (case-folding for Yahoo aliases, etc.) can be
-- layered on later — for now these two carriers account for the overwhelming
-- majority of consumer inbox tricks.

ALTER TABLE public.trial_passes
  ADD COLUMN IF NOT EXISTS email_canonical text
  GENERATED ALWAYS AS (
    CASE
      WHEN email IS NULL THEN NULL
      WHEN position('@' IN email) = 0 THEN lower(email)
      WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com') THEN
        replace(
          regexp_replace(split_part(lower(email), '@', 1), '\+.*$', ''),
          '.', ''
        ) || '@gmail.com'
      ELSE
        regexp_replace(split_part(lower(email), '@', 1), '\+.*$', '') || '@' || lower(split_part(email, '@', 2))
    END
  ) STORED;

-- ---------------------------------------------------------------------------
-- 2. Swap the lower(email) unique index for one on email_canonical
-- ---------------------------------------------------------------------------

-- The 20260819 migration created `trial_passes_email_key` as a unique index
-- on lower(email). That still works, but with a canonical column present the
-- create route wants to look up by canonical to catch dot/plus tricks, and
-- having two overlapping unique indexes wastes writes and confuses
-- insert-conflict logic. Drop both possible historical names in case an
-- earlier draft of this migration ran against a dev db.

DROP INDEX IF EXISTS public.trial_passes_email_key;
DROP INDEX IF EXISTS public.trial_passes_email_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS trial_passes_email_canonical_idx
  ON public.trial_passes (email_canonical)
  WHERE email_canonical IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Unique index on phone
-- ---------------------------------------------------------------------------

-- Phone is stored in E.164 (see normalizePhone in lib/trial-pass.js). Same
-- number at intake = same person; the create route returns the existing pass
-- with a rotated token instead of a new trial window.

CREATE UNIQUE INDEX IF NOT EXISTS trial_passes_phone_idx
  ON public.trial_passes (phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- ---------------------------------------------------------------------------
-- 4. Track how a pass was minted, and who did it (for manual overrides)
-- ---------------------------------------------------------------------------

-- `signup_source` distinguishes the printed-QR self-serve intake ('trial_pass_qr',
-- already the default) from the front-desk manual override ('front_desk_manual').
-- The `created_by` column records the staff auth.users.id when the pass was
-- created by staff on behalf of a guest — an audit trail so Adam can see if the
-- override is being used sparingly (dead phones, foreign numbers, elderly
-- guests) or being used to bypass verification for friends.

ALTER TABLE public.trial_passes
  ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'trial_pass_qr';

ALTER TABLE public.trial_passes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trial_passes_signup_source_idx
  ON public.trial_passes (signup_source);

-- ---------------------------------------------------------------------------
-- 5. Phone verification state
-- ---------------------------------------------------------------------------

-- Twilio Verify does not need us to persist anything for the check to work —
-- the SID + code lives on Twilio's side and the create route calls their API
-- to confirm. But we DO want to record whether a pass was minted through a
-- verified phone or through the manual override, so the admin view of the
-- trial list can distinguish "verified" from "vouched-for-by-staff".
--
-- `phone_verified_at` is set the moment Twilio returns approved. NULL means
-- the pass was created via the manual override (or a future path we haven't
-- built yet). Combined with `signup_source` this gives a clear picture:
--
--   trial_pass_qr      + verified   → self-serve, phone confirmed
--   front_desk_manual  + not verified → staff vouched, no SMS attempted
--   trial_pass_qr      + not verified → shouldn't happen; would be a bug
--
-- Not indexed: this is a display/reporting field, not a lookup key.

ALTER TABLE public.trial_passes
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

COMMIT;
