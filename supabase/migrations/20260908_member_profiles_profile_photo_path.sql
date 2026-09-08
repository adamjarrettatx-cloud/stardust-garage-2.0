-- Add member_profiles.profile_photo_path so approved members can be served
-- their photo from the private profile-photos bucket via signed URLs,
-- instead of the older public photo_url column that was populated from the
-- application row.
--
-- Backward-compat:
--   * photo_url stays. Legacy rows (approved before this) still resolve
--     through it via the display-photo helper. Nothing is deleted.
--   * New approvals will fill BOTH profile_photo_path (preferred) AND
--     photo_url (kept as null unless the application still had the legacy
--     public URL) so a rollback to code that only reads photo_url does not
--     leave anyone without an avatar.

alter table public.member_profiles
  add column if not exists profile_photo_path text;

comment on column public.member_profiles.profile_photo_path is
  'Storage path in the private profile-photos bucket. Preferred over the older public photo_url column; readers should mint a signed URL via lib/profile-photo.js when this is set.';
