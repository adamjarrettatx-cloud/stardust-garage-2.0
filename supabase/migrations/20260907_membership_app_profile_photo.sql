-- 20260907_membership_app_profile_photo.sql
--
-- Adds profile_photo_path to membership_applications so the paid-membership
-- application form can store a private-bucket path (profile-photos/member-app/<id>/photo.<ext>)
-- alongside the legacy public photo_url column.
--
-- Rationale: PR B.3 moves the "attach a photo" step from the public
-- `member-photos` bucket to the private `profile-photos` bucket (same one
-- used by ticket buyers and trial passes). Legacy photo_url is kept as
-- nullable for backwards-compat with rows submitted before this migration.
-- Door staff and admin surfaces will prefer profile_photo_path when set.

alter table public.membership_applications
  add column if not exists profile_photo_path text,
  add column if not exists profile_photo_uploaded_at timestamptz;

comment on column public.membership_applications.profile_photo_path is
  'Path within the private profile-photos bucket, format member-app/<application_id>/photo.<ext>. Preferred over the legacy photo_url.';
comment on column public.membership_applications.profile_photo_uploaded_at is
  'When the applicant uploaded their face photo. Null when never uploaded.';
