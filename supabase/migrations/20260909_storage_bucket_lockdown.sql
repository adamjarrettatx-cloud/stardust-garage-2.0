-- =========================================================
-- 20260909_storage_bucket_lockdown.sql
--
-- SECURITY (Critical C-02):
-- Before this migration, the `event-images` and `site-assets` Storage buckets
-- had policies of the form:
--
--   TO authenticated
--   USING      (bucket_id = 'event-images')     -- or 'site-assets'
--   WITH CHECK (bucket_id = 'event-images')
--
-- ...for INSERT / UPDATE / DELETE. That meant ANY authenticated user
-- (including a brand-new free account) could overwrite or delete every
-- event flyer or public site asset — a defacement vector reachable
-- directly through the Storage REST API with an ordinary anon+JWT client.
--
-- Uploads today happen from /bananas/* admin surfaces (see
-- lib/event-image-upload.js and app/bananas/settings/SettingsForm.js),
-- which are already team/admin-gated at the page layer. This migration
-- restricts the underlying DB policies to match:
--
--   * event-images: writable only by public.is_team()   (team + admin)
--   * site-assets:  writable only by public.is_admin()  (admin only)
--
-- Public SELECT (both buckets are `public=true`) is preserved because the
-- website + audio background reference these objects unauthenticated.
--
-- Both helpers read from the server-controlled `team_members` table, NOT
-- user_metadata — see 20260611_documents_hub.sql / 20260615_capacity_counter.sql.
-- =========================================================

-- --- event-images: drop the broad authenticated write policies ------------
drop policy if exists "Authenticated users can upload event images" on storage.objects;
drop policy if exists "Authenticated users can update event images" on storage.objects;
drop policy if exists "Authenticated users can delete event images" on storage.objects;

create policy "Team can upload event images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-images' and public.is_team());

create policy "Team can update event images" on storage.objects
  for update to authenticated
  using      (bucket_id = 'event-images' and public.is_team())
  with check (bucket_id = 'event-images' and public.is_team());

create policy "Team can delete event images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-images' and public.is_team());


-- --- site-assets: drop the broad authenticated write policies -------------
drop policy if exists "Authenticated users can upload site assets" on storage.objects;
drop policy if exists "Authenticated users can update site assets" on storage.objects;
drop policy if exists "Authenticated users can delete site assets" on storage.objects;

create policy "Admin can upload site assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());

create policy "Admin can update site assets" on storage.objects
  for update to authenticated
  using      (bucket_id = 'site-assets' and public.is_admin())
  with check (bucket_id = 'site-assets' and public.is_admin());

create policy "Admin can delete site assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());


-- --- Public SELECT is intentionally preserved ------------------------------
-- `Anyone can view event images` and `Anyone can view site assets` remain,
-- because both buckets serve public web assets (event flyers, background
-- audio track referenced by app/components/SoundProvider.js, etc.).
