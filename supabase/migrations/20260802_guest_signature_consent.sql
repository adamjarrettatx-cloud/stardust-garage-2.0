-- =========================================================
-- Guest check-in — signed consent capture
--
-- A first-time guest at the door kiosk now draws a signature confirming it is
-- OK to contact them by text and email. That drawing is a TCPA-style opt-in
-- record, so this migration gives it somewhere private to live, a way back to
-- the guest it belongs to, and a route into the Sign Ups list the venue
-- already exports to Mailchimp.
--
-- STRICTLY ADDITIVE. Every statement is `add column if not exists` or a new
-- policy. Nothing is dropped, nothing is narrowed, no existing column changes
-- type or nullability, and every new column is nullable with no default — so
-- the homepage signup form and the existing kiosk keep working untouched
-- whether or not the app has been deployed yet.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. guest_profiles — where this guest's signature is filed, and when.
--
-- signature_path is the object key inside the private 'guest-signatures'
-- bucket (`<guest_profile_id>/<uuid>.png`), NOT a URL: the bucket is not
-- public, so there is no durable URL to store. Staff read it back through
-- /api/admin/guest-signature/[profileId], which mints a 60-second signed URL
-- behind an admin gate.
--
-- Nullable on purpose. Every guest profile created before this migration has
-- no signature, and a check-in whose storage upload fails still produces a
-- profile — with marketing_consent walked back to false, because consent we
-- cannot evidence is not consent.
-- ---------------------------------------------------------------------------
alter table public.guest_profiles
  add column if not exists signature_path text,
  add column if not exists signature_captured_at timestamptz;

-- Partial index: the only question ever asked of these columns is "which of
-- these profiles has a signature on file", from the admin guest list page.
create index if not exists guest_profiles_signature_idx
  on public.guest_profiles (id)
  where signature_path is not null;

-- ---------------------------------------------------------------------------
-- 2. signups — the existing subscriber list, extended for door intake.
--
-- The table already had `contact` + `contact_type` + `source`, which fits the
-- homepage form (one contact, either an email or a phone). Door intake always
-- collects BOTH plus the guest's name, and Mailchimp wants all three, so
-- rather than write two rows per guest — which would double-count the list and
-- break the New/Seen tabs — the extra fields get their own columns:
--
--   phone     — always present for a door signup, always null for a homepage
--               one that only left an email. The homepage form is unchanged.
--   full_name — the name on the guest list, so a Mailchimp import has a person
--               attached to the address rather than a bare mailbox.
--
-- `source` is NOT added here: it already exists (app/components/SignupForm.js
-- writes 'homepage' today, and the admin CSV already exports it). Door rows
-- use 'guest_list_checkin', which is what tells the two apart.
-- ---------------------------------------------------------------------------
alter table public.signups
  add column if not exists phone text,
  add column if not exists full_name text;

-- ---------------------------------------------------------------------------
-- 3. The private signature bucket.
--
-- `public => false`, matching the 'documents' bucket from
-- 20260611_documents_hub.sql rather than the public 'member-photos' one. These
-- are consent records tied to a named person's phone number; nothing about
-- them should be reachable by guessing a URL.
--
-- 1 MiB ceiling is generous for a finger-drawn PNG from a retina iPad and
-- small enough to make the bucket a poor place to stash anything else. The
-- app's own cap (MAX_SIGNATURE_BYTES in lib/guest-signature.js) is 512 KiB;
-- this is the backstop behind it.
--
-- The `on conflict` clause makes re-running this safe and keeps it from
-- clobbering a bucket an admin already made by hand in the dashboard.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-signatures', 'guest-signatures', false, 1048576, array['image/png'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Storage RLS.
--
-- Reads are admin-only through public.is_admin(), the same helper the rest of
-- the schema gates on. Note what is deliberately absent:
--
--   * No INSERT policy. Signatures are written by the door kiosk with the
--     service-role key from /api/capacity/guestlist/operation, which bypasses
--     RLS. A door tablet holds a team session, not an admin one, and giving
--     `authenticated` a direct INSERT on this bucket would let anyone with a
--     team login upload arbitrary PNGs into the consent archive.
--   * No UPDATE or DELETE policy for anyone. A consent record is append-only
--     by design — the whole point is being able to produce the original later.
--     Deleting one is a deliberate service-role act, not something a session
--     can do.
-- ---------------------------------------------------------------------------
drop policy if exists guest_signatures_admin_select on storage.objects;
create policy guest_signatures_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'guest-signatures' and public.is_admin());
