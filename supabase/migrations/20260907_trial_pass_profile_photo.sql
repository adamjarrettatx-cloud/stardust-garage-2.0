-- Profile photos on trial_passes.
--
-- Trial-pass intake happens BEFORE any auth.users account exists (guests
-- scan a QR at the venue and give three fields — no signup). So we can't
-- inherit the profile photo from free_accounts like we do for ticket
-- buyers. Instead we store the path on the trial_passes row itself, in
-- the SAME private `profile-photos` bucket (single bucket for the whole
-- door check-in identity system).
--
-- Storage layout for trial passes: `trial-pass/<trial_pass_id>/photo.<ext>`.
-- The `trial-pass/` prefix keeps them cleanly separated from the
-- <user_id>/photo.<ext> layout used by ticket buyers, and means the
-- storage RLS keyed on the first folder segment (auth.uid()::text) does
-- NOT match this prefix — trial-pass uploads must always go through the
-- server (service-role) which is what we want (guest is unauthenticated
-- at the time of upload).

alter table public.trial_passes
  add column if not exists profile_photo_path text,
  add column if not exists profile_photo_uploaded_at timestamptz;

comment on column public.trial_passes.profile_photo_path is
  'Storage path (bucket-relative) inside private profile-photos bucket, laid out as trial-pass/<trial_pass_id>/photo.<ext>. NULL until the guest uploads. Door staff sees this photo at check-in — a pass with no photo will be flagged by the scanner UI (see PR C).';

comment on column public.trial_passes.profile_photo_uploaded_at is
  'Timestamp of the last trial-pass profile-photo upload. Used to invalidate cached signed URLs and expose "recently updated" affordances in the door-scanner UI.';
