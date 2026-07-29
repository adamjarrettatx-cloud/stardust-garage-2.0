-- =========================================================
-- Guest List — Google sign-in for partners
--
-- WHY: partners are invited by email and, until now, the ONLY way back into
-- their account was the single-use magic link in that invite. Google sign-in
-- becomes the primary door (magic link stays as the backup), and that changes
-- one assumption the Phase 2 schema quietly relied on: that the auth.users row
-- created by /api/admin/invite-partner is the only identity a partner will ever
-- authenticate as.
--
-- It isn't. Supabase links a Google identity to an existing auth.users row by
-- verified email only when automatic identity linking is on; with manual
-- linking, the same human signing in with Google gets a DIFFERENT auth.users
-- id than the one the invite pre-created. partner_profiles.user_id would then
-- point at an identity that never signs in, and the partner would look like a
-- stranger to every RLS policy in the Phase 1 migration.
--
-- The fix is to make the INVITED EMAIL — not the auth user id — the durable
-- link between a Google account and a partner invite, so the profile row can
-- be re-pointed at whichever identity actually ends up authenticating. That is
-- what invited_email below is for.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. partner_profiles.invited_email — the address the invite was sent to.
--
-- Denormalized from contacts.email on purpose. The OAuth callback has to
-- resolve "which partner is this Google account?" before it has a session with
-- any partner privileges, and doing that through a join into contacts means the
-- lookup breaks the moment staff correct a typo in the contact's email. This
-- column is frozen at invite time: it records who we invited, not who the
-- contact currently is.
--
-- Stored lower-cased and trimmed (the invite route already normalizes this way)
-- so the callback can compare against the Google-verified email directly.
-- ---------------------------------------------------------------------------
alter table public.partner_profiles
  add column if not exists invited_email text;

-- Backfill the rows Phase 2 already created. contacts.email is the address the
-- invite actually went to, so this is exact for existing invites.
update public.partner_profiles p
   set invited_email = lower(trim(c.email))
  from public.contacts c
 where c.id = p.contact_id
   and p.invited_email is null
   and c.email is not null
   and trim(c.email) <> '';

create index if not exists partner_profiles_invited_email_idx
  on public.partner_profiles(invited_email);

-- Deliberately NOT added to the column-level UPDATE grant below — partners hold
-- update on (full_name, photo_url) only, so a partner cannot rewrite the email
-- their profile is matched on and claim someone else's invite.
--
-- (Restated here rather than changed: the grant from 20260729 already excludes
-- every column it doesn't name, including this new one.)

-- ---------------------------------------------------------------------------
-- 2. guestlist_audit_log gains 'partner_identity_relinked'.
--
-- Re-pointing partner_profiles.user_id at a different auth.users row is the one
-- privileged thing the OAuth callback does without a human in the loop, and it
-- moves guest-list access from one identity to another. It gets an audit row
-- for the same reason grant changes do. Both FKs stay null — this event is
-- scoped to a partner, not to a grant or an entry — and the before/after user
-- ids go in details.
-- ---------------------------------------------------------------------------
alter table public.guestlist_audit_log
  drop constraint if exists guestlist_audit_log_action_check;

alter table public.guestlist_audit_log
  add constraint guestlist_audit_log_action_check
  check (action in (
    'grant_created', 'grant_updated', 'grant_revoked',
    'entry_added', 'entry_removed', 'checked_in',
    'partner_identity_relinked'
  ));
