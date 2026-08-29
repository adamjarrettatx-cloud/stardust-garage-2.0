-- =========================================================
-- Trial Pass \u2194 Guest Profiles: identity linking + Trial Member status
--
-- Trial pass sign-ups need to feed the same guest_profiles table that door
-- staff, guest-list matching, and every other guest workflow reads from.
-- Until now they were siloed \u2014 someone who signed up for a trial pass online
-- existed only in trial_passes, never in guest_profiles. That fragmented the
-- picture of who has ever engaged with the venue.
--
-- Design decisions:
--
--   * We DON'T enforce unique email/phone on guest_profiles. Some existing
--     rows were created by name-only matching from the door guest-list flow,
--     and enforcing uniqueness after the fact would fail or would collapse
--     legitimately distinct people who happen to share a placeholder value.
--     Instead we index email/phone for FAST matching, and let the app layer
--     do the "match or create" logic idempotently.
--
--   * profile_status is a text tag, not a full state machine \u2014 the app owns
--     the transitions. We accept a fixed vocabulary via a check constraint
--     so bad values can't sneak in. Statuses:
--       'guest'            \u2013 walked in the door, no trial or membership
--       'trial_member'     \u2013 has an active trial pass (the new bucket)
--       'trial_expired'    \u2013 trial pass ended without applying
--       'applicant'        \u2013 applied for membership
--       'member'           \u2013 approved (has a member_profiles row too)
--       'former_member'    \u2013 approved but membership lapsed/cancelled
--     Default 'guest' keeps every existing row valid.
--
--   * trial_passes.guest_profile_id links every trial pass to the profile
--     it created or matched, so the analytics view can trace the funnel.
-- =========================================================

-- 1. Add profile_status to guest_profiles.
alter table public.guest_profiles
  add column if not exists profile_status text not null default 'guest';

alter table public.guest_profiles
  drop constraint if exists guest_profiles_profile_status_check;

alter table public.guest_profiles
  add constraint guest_profiles_profile_status_check
  check (profile_status in (
    'guest',
    'trial_member',
    'trial_expired',
    'applicant',
    'member',
    'former_member'
  ));

-- 2. Fast lookup indexes for match-or-create.
--    Not unique \u2014 see design note above.
create index if not exists guest_profiles_email_lower_idx
  on public.guest_profiles (lower(email))
  where email is not null;

create index if not exists guest_profiles_phone_idx
  on public.guest_profiles (phone)
  where phone is not null;

-- 3. Link column on trial_passes.
alter table public.trial_passes
  add column if not exists guest_profile_id uuid references public.guest_profiles(id) on delete set null;

create index if not exists trial_passes_guest_profile_id_idx
  on public.trial_passes (guest_profile_id)
  where guest_profile_id is not null;
