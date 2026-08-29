-- =========================================================
-- Trial Pass: activate the 30-day window at first check-in, not at signup.
--
-- Prior model: every pass was born with issued_at = now, expires_at = now + 30.
-- That meant a guest who signed up on Monday but couldn't come until three
-- Fridays later had already burned two-thirds of their trial without setting
-- foot in the venue.
--
-- New model: two clocks.
--
--   signup_expires_at (60 days from issue)
--     The outer limit on when someone can activate at all. If they sign up
--     and never show up, the pass dies at day 60. Prevents an infinite
--     backlog of unused QRs floating around.
--
--   activated_at (null until first `allowed` door scan)
--     Marks the exact moment the 30-day clock starts.
--
--   expires_at (null until activation, then activated_at + 30 days)
--     Same column name, new meaning: this is now the ACTIVATED 30-day
--     deadline. It stays null while the pass is unactivated, and is set
--     transactionally by the door scan route on the first allowed scan.
--
-- Column changes:
--   - trial_passes.activated_at       new, nullable timestamptz
--   - trial_passes.signup_expires_at  new, filled by backfill and default
--   - trial_passes.expires_at         now nullable (was NOT NULL)
--
-- Backfill:
--   1. signup_expires_at = issued_at + interval '60 days' for every row
--   2. activated_at = earliest allowed checked_in_at for each pass, if any
--   3. For rows with activated_at, expires_at = activated_at + 30 days
--      (or extended_until if larger)
--      For rows without activated_at, expires_at = null (was previously
--      the wrong-meaning issued_at + 30, we clear it)
-- =========================================================

-- 1. New columns.
alter table public.trial_passes
  add column if not exists activated_at timestamptz;

alter table public.trial_passes
  add column if not exists signup_expires_at timestamptz;

-- 2. Backfill signup_expires_at for every existing row.
update public.trial_passes
   set signup_expires_at = issued_at + interval '60 days'
 where signup_expires_at is null;

-- 3. Make signup_expires_at required for new rows (existing rows now all set).
alter table public.trial_passes
  alter column signup_expires_at set not null;

-- 4. Default so future inserts that forget the column still get sane behavior.
alter table public.trial_passes
  alter column signup_expires_at set default (now() + interval '60 days');

-- 5. Backfill activated_at from the earliest allowed door checkin per pass.
update public.trial_passes tp
   set activated_at = c.first_allowed
  from (
    select trial_pass_id, min(checked_in_at) as first_allowed
      from public.trial_pass_checkins
     where result = 'allowed'
     group by trial_pass_id
  ) c
 where c.trial_pass_id = tp.id
   and tp.activated_at is null;

-- 6. expires_at is now nullable (was not-null in the initial schema).
alter table public.trial_passes
  alter column expires_at drop not null;

-- 7. Repopulate expires_at with the NEW meaning.
--    Activated rows: activated_at + 30 days (unless an extension already
--    pushed them further out via extended_until).
--    Unactivated rows: null. The old value was a 30-day-from-signup
--    deadline that is no longer meaningful.
update public.trial_passes
   set expires_at = case
     when activated_at is null then null
     else greatest(activated_at + interval '30 days', coalesce(extended_until, activated_at + interval '30 days'))
   end;

-- 8. Index the outer limit so the cron that expires stale unactivated passes
--    doesn't table-scan.
create index if not exists trial_passes_signup_expires_at_idx
  on public.trial_passes (signup_expires_at)
  where activated_at is null and status = 'active';

-- 9. Index the activation timestamp so analytics + reminder cron are fast.
create index if not exists trial_passes_activated_at_idx
  on public.trial_passes (activated_at)
  where activated_at is not null;
