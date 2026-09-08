-- Member ID scan log \u2014 mirrors trial_pass_checkins and ticket_checkins.
--
-- Every time door staff scans a Member ID QR, we log:
--   * result           \u2014 'verified' (Verify tap) or 'rejected' (Reject tap)
--   * event_id         \u2014 optional; the current event context if the scanner
--                        has one loaded, so a member showing up to Show A
--                        is distinguishable from Show B in analytics
--   * reject_reason    \u2014 whitelisted reason code (photo_mismatch,
--                        no_photo_on_file, id_mismatch, manual, expired)
--   * notes            \u2014 free-text staff note, capped at 280 chars
--
-- Not gating anything: unlike trial-pass activation and ticket check-in,
-- a member scan is currently PURE audit \u2014 the member is either allowed in
-- because they are an active member, or refused. We do NOT flip
-- member_profiles.is_active or record any \"used\" state. Members re-scan
-- their badge every visit.

create table if not exists public.member_id_scans (
  id                  uuid primary key default gen_random_uuid(),
  member_profile_id   uuid not null references public.member_profiles(id) on delete cascade,
  event_id            uuid references public.events(id) on delete set null,
  result              text not null check (result in ('verified', 'rejected')),
  reject_reason       text,
  notes               text,
  scanned_at          timestamptz not null default now(),
  scanned_by          uuid,
  door_device_id      text,
  constraint member_id_scans_reject_reason_when_rejected check (
    (result = 'rejected' and reject_reason is not null)
    or (result = 'verified' and reject_reason is null)
  )
);

create index if not exists member_id_scans_member_idx
  on public.member_id_scans (member_profile_id, scanned_at desc);

create index if not exists member_id_scans_event_idx
  on public.member_id_scans (event_id, scanned_at desc)
  where event_id is not null;

alter table public.member_id_scans enable row level security;
revoke all on public.member_id_scans from anon, authenticated;

comment on table public.member_id_scans is
  'Audit log of Member ID QR scans at the door. One row per Verify or Reject tap. Pure audit \u2014 does not gate membership state.';
