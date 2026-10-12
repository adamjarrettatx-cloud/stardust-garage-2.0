-- Internal team notes on incoming submissions (venue inquiries,
-- micro-parties, collaborations, membership applications).
--
-- These are staff-only annotations: the submitter never sees them, and they
-- are rendered on the admin detail page in a visually distinct "internal"
-- panel. Author identity is captured server-side from the signed-in admin's
-- team_members row (never trusted from the client) and snapshotted so a note
-- still says who wrote it if that teammate's profile later changes.
--
-- Deletes are soft (deleted_at/deleted_by) so the trail stays auditable;
-- edits keep the original created_at and stamp edited_at.

create table if not exists public.submission_notes (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in (
    'applications', 'collaborations', 'micro-parties', 'venue-inquiries'
  )),
  submission_id uuid not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  author_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

create index if not exists submission_notes_submission_idx
  on public.submission_notes(submission_type, submission_id, created_at desc)
  where deleted_at is null;

alter table public.submission_notes enable row level security;

-- All writes go through server routes using the service role after
-- requireAdminMfa(); browser clients get read-only visibility for admins and
-- nothing for anyone else.
drop policy if exists submission_notes_admin_select on public.submission_notes;
create policy submission_notes_admin_select on public.submission_notes
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.submission_notes from anon, authenticated;
