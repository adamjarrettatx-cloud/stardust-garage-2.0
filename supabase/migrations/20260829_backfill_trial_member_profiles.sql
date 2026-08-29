-- =========================================================
-- Backfill: link existing trial_passes rows to guest_profiles rows.
--
-- The main linking migration and code change land in the same PR as this
-- backfill. For net-new signups the app writes the link inline; for the
-- passes that existed before that code shipped, this migration does one
-- match-or-create pass so the analytics view isn't missing rows.
--
-- Match rules (same order as the app):
--   1. email (case-insensitive) matches an existing guest_profiles row
--   2. phone exact match
--   3. otherwise, create a new guest_profiles row from the pass
--
-- This runs once and is idempotent: trial_passes with a non-null
-- guest_profile_id are skipped, so re-running does nothing.
-- =========================================================

-- Backfill: match by email first.
update public.trial_passes tp
   set guest_profile_id = gp.id
  from public.guest_profiles gp
 where tp.guest_profile_id is null
   and tp.email is not null
   and gp.email is not null
   and lower(tp.email) = lower(gp.email);

-- Backfill: then by phone.
update public.trial_passes tp
   set guest_profile_id = gp.id
  from public.guest_profiles gp
 where tp.guest_profile_id is null
   and tp.phone is not null
   and gp.phone is not null
   and tp.phone = gp.phone;

-- Backfill: create new profiles for still-unlinked passes.
--
-- CTE captures the ids of passes that need a profile, inserts a profile per
-- pass, and returns the mapping so we can update trial_passes in the same
-- statement.
with unlinked as (
  select id, full_name, email, phone
    from public.trial_passes
   where guest_profile_id is null
),
created as (
  insert into public.guest_profiles (full_name, email, phone, profile_status, marketing_consent)
  select full_name, email, phone, 'trial_member', false
    from unlinked
  returning id as profile_id, full_name, email, phone
)
update public.trial_passes tp
   set guest_profile_id = c.profile_id
  from created c
 where tp.guest_profile_id is null
   and tp.full_name = c.full_name
   and (
     (tp.email is not distinct from c.email) and (tp.phone is not distinct from c.phone)
   );

-- Escalate profile_status to trial_member for any guest_profiles that were
-- linked to a trial pass in steps 1 or 2 above but were still sitting at
-- the default 'guest' status. Never demote existing higher-rank statuses.
update public.guest_profiles gp
   set profile_status = 'trial_member'
  from public.trial_passes tp
 where tp.guest_profile_id = gp.id
   and gp.profile_status = 'guest';
