-- SECURITY (Critical C-03): lock down the legacy `member-photos` bucket.
--
-- The bucket predates the current `profile-photos` (private) flow. Its live
-- policies were:
--   * INSERT — role `public`, `bucket_id='member-photos'`
--     → any anonymous browser could POST to storage and fill the bucket.
--   * DELETE — role `public`, gated on
--     `(auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true`.
--     `user_metadata` is user-editable at Supabase, so any signed-in user
--     could self-promote and delete any object in the bucket.
--   * SELECT — role `public`. Kept: 6 existing objects (partner + one member
--     photo) are already publicly linked from the site and must keep loading.
--
-- Fix:
--   1. Drop the anonymous INSERT policy; replace with an authenticated-only
--      one so the partner-photo uploader keeps working (see lib/partner-photo.js)
--      but anonymous browsers cannot fill the bucket.
--   2. Drop the user_metadata-based DELETE policy; replace with one gated on
--      `public.is_admin()` (backed by team_members.role='admin').
--   3. Leave the public SELECT policy in place — the 6 existing objects are
--      referenced by public partner pages and must stay reachable at their
--      current URLs. New photos should go to `profile-photos` (private).
--
-- No data is moved by this migration. Retiring the bucket entirely (moving
-- the 6 objects into `profile-photos` and pointing partner_profiles /
-- member_profiles at signed URLs) is tracked as a follow-up.

begin;

-- 1) INSERT: drop the anonymous policy, replace with authenticated-only.
drop policy if exists "Allow public upload to member-photos" on storage.objects;

create policy "Authenticated upload to member-photos"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'member-photos');

-- 2) DELETE: drop the user_metadata-based admin check, replace with
-- team_members-backed public.is_admin().
drop policy if exists "Allow admin delete of member-photos" on storage.objects;

create policy "Admin delete of member-photos"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'member-photos' and public.is_admin());

-- 3) SELECT is intentionally left alone. Existing public policy:
--   "Allow public read of member-photos" — role public, qual bucket_id='member-photos'
-- Keeps the 6 legacy photos loading on public partner pages.

commit;
