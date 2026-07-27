-- RLS security hardening ahead of the SDG mobile app.
--
-- Why now: the web app's middleware.js gate only protects *page* routes.
-- The mobile app talks to Supabase directly with the anon key, so RLS is the
-- only thing actually protecting data once real members carry an
-- authenticated session in their pocket. Supabase's advisor flagged two
-- classes of problems on the live project (iwgfelvbebqbaotkylsw):
--
--   1. ERROR: several admin policies check
--      (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, and
--      user_metadata is end-user editable. Anyone could patch their own
--      metadata client-side and pass these checks. Replaced with
--      public.is_admin(), which checks the server-controlled
--      public.team_members table instead (already the source of truth used
--      by middleware.js and lib/auth-helpers.js).
--
--   2. WARN: several "authenticated"-role policies use USING/WITH CHECK
--      (true), meaning ANY signed-in user (including a future mobile
--      member) can insert/update/delete rows in admin-only tables (events,
--      gallery_images, site_settings, ...) or read PII-bearing internal
--      tables (membership_applications, venue_inquiries, collaborations,
--      early_member_applications, micro_party_inquiries, signups) that are
--      only ever surfaced through the admin-gated /bananas dashboard.
--      Tightened writes + reads on those tables to public.is_admin().
--
--   3. Bonus fix (not flagged by the linter, but relevant for mobile): the
--      public "Events are viewable by everyone" policy has no status/
--      visibility filter, so an anon/mobile client could read draft events
--      and internal-visibility micro-parties before they're meant to be
--      seen. Split into a public-safe policy (published + public) and a
--      team/admin policy (sees everything).
--
--   4. Function search_path hardening for is_team_member()/handle_updated_at
--      (WARN: function_search_path_mutable).
--
-- Nothing here changes who can currently do what through the web app --
-- /bananas is already 100% admin-gated by middleware.js, so is_admin() at
-- the DB layer matches existing real-world usage. This only closes the gap
-- that let an authenticated-but-non-admin user bypass that gate via a
-- direct Supabase call (which the mobile app will make routinely).

-- ---------------------------------------------------------------------
-- 1. Replace user_metadata-based admin checks with public.is_admin()
-- ---------------------------------------------------------------------

drop policy if exists "Admins full access" on public.member_discount_codes;
create policy "Admins full access" on public.member_discount_codes
  for all to public
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage all profiles" on public.member_profiles;
create policy "Admins can manage all profiles" on public.member_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read all profiles" on public.member_profiles;
create policy "Admins can read all profiles" on public.member_profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can manage all bookings" on public.studio_bookings;
create policy "Admins can manage all bookings" on public.studio_bookings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read all bookings" on public.studio_bookings;
create policy "Admins can read all bookings" on public.studio_bookings
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can update settings" on public.studio_settings;
create policy "Admins can update settings" on public.studio_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete team events" on public.team_events;
create policy "Admins can delete team events" on public.team_events
  for delete to public
  using (public.is_admin());

drop policy if exists "Admins can insert team events" on public.team_events;
create policy "Admins can insert team events" on public.team_events
  for insert to public
  with check (public.is_admin());

drop policy if exists "Admins can read team events" on public.team_events;
create policy "Admins can read team events" on public.team_events
  for select to public
  using (public.is_admin());

drop policy if exists "Admins can update team events" on public.team_events;
create policy "Admins can update team events" on public.team_events
  for update to public
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage team members" on public.team_members;
create policy "Admins can manage team members" on public.team_members
  for all to public
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. Tighten "any authenticated user" policies to admin-only. Public
--    submission (INSERT) policies on inquiry/application tables are left
--    untouched -- those are meant to be open (anonymous signup forms).
-- ---------------------------------------------------------------------

-- events: public read stays, but write is admin-only (see also section 3
-- below, which replaces the read policy with a status/visibility filter).
drop policy if exists "Authenticated users can insert events" on public.events;
create policy "Admins can insert events" on public.events
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Authenticated users can update events" on public.events;
create policy "Admins can update events" on public.events
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete events" on public.events;
create policy "Admins can delete events" on public.events
  for delete to authenticated
  using (public.is_admin());

-- gallery_images: public read stays; writes admin-only.
drop policy if exists "Authenticated users can insert gallery images" on public.gallery_images;
create policy "Admins can insert gallery images" on public.gallery_images
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Authenticated users can update gallery images" on public.gallery_images;
create policy "Admins can update gallery images" on public.gallery_images
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete gallery images" on public.gallery_images;
create policy "Admins can delete gallery images" on public.gallery_images
  for delete to authenticated
  using (public.is_admin());

-- membership_applications: contains full name/email/phone/birthday/photo.
-- INSERT (anonymous submission) stays open; read/write is admin-only.
drop policy if exists "Authenticated users can view applications" on public.membership_applications;
create policy "Admins can view applications" on public.membership_applications
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can update applications" on public.membership_applications;
create policy "Admins can update applications" on public.membership_applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete applications" on public.membership_applications;
create policy "Admins can delete applications" on public.membership_applications
  for delete to authenticated
  using (public.is_admin());

-- venue_inquiries: contact info + budget details. INSERT stays open.
drop policy if exists "Authenticated users can view venue inquiries" on public.venue_inquiries;
create policy "Admins can view venue inquiries" on public.venue_inquiries
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can update venue inquiries" on public.venue_inquiries;
create policy "Admins can update venue inquiries" on public.venue_inquiries
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete venue inquiries" on public.venue_inquiries;
create policy "Admins can delete venue inquiries" on public.venue_inquiries
  for delete to authenticated
  using (public.is_admin());

-- collaborations: contact info + portfolio links. INSERT stays open.
drop policy if exists "Authenticated users can view collaborations" on public.collaborations;
create policy "Admins can view collaborations" on public.collaborations
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can update collaborations" on public.collaborations;
create policy "Admins can update collaborations" on public.collaborations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete collaborations" on public.collaborations;
create policy "Admins can delete collaborations" on public.collaborations
  for delete to authenticated
  using (public.is_admin());

-- early_member_applications: contact info. INSERT stays open.
drop policy if exists "Authenticated users can read early member applications" on public.early_member_applications;
create policy "Admins can read early member applications" on public.early_member_applications
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can update early member applications" on public.early_member_applications;
create policy "Admins can update early member applications" on public.early_member_applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- micro_party_inquiries: contact info + event details. INSERT stays open.
drop policy if exists "Authenticated users can read micro party inquiries" on public.micro_party_inquiries;
create policy "Admins can read micro party inquiries" on public.micro_party_inquiries
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can update micro party inquiries" on public.micro_party_inquiries;
create policy "Admins can update micro party inquiries" on public.micro_party_inquiries
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- signups: email/phone list. INSERT (anonymous signup) stays open.
drop policy if exists "Authenticated users can view signups" on public.signups;
create policy "Admins can view signups" on public.signups
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can delete signups" on public.signups;
create policy "Admins can delete signups" on public.signups
  for delete to authenticated
  using (public.is_admin());

-- site_settings: public read stays (needed by the site + app to render
-- config); writes admin-only.
drop policy if exists "Authenticated users can insert site settings" on public.site_settings;
create policy "Admins can insert site settings" on public.site_settings
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Authenticated users can update site settings" on public.site_settings;
create policy "Admins can update site settings" on public.site_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can delete site settings" on public.site_settings;
create policy "Admins can delete site settings" on public.site_settings
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Events: public/anon should only ever see published + public-visibility
--    events (this is what both the website and the mobile app query
--    against). Team/admin can see everything, including drafts and
--    internal-visibility micro-parties.
-- ---------------------------------------------------------------------

drop policy if exists "Events are viewable by everyone" on public.events;

create policy "Public can view published public events" on public.events
  for select to public
  using (status = 'published' and visibility = 'public');

create policy "Team can view all events" on public.events
  for select to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------------
-- 4. Function hardening: pin search_path so these SECURITY-relevant
--    functions can't be redirected by a session-level search_path change.
-- ---------------------------------------------------------------------

alter function public.handle_updated_at() set search_path = public;
alter function public.is_team_member() set search_path = public;
alter function public.is_team_member(uuid) set search_path = public;
