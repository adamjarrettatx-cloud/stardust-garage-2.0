-- Migration: submission_status_contacted_workflow
-- Replaces the 'reviewed' ("Seen") status with 'contacted' across every
-- submission table and locks the column down to the supported statuses.
--
-- Status lifecycle:
--   new        → Default on form submission. Stays here until an admin acts;
--                opening a submission never changes its status.
--   contacted  → Admin has reached out.
--   pending    → Admin is holding it for follow-up.
--   approved   → Accepted (for applications: triggers account creation).
--   rejected   → Denied.
--
-- Admins can no longer delete submissions — the delete policies are dropped so
-- the database matches the admin UI, which only re-classifies submissions.

do $$
declare
  submission_table text;
begin
  foreach submission_table in array array[
    'membership_applications',
    'venue_inquiries',
    'micro_party_inquiries',
    'collaborations',
    'signups'
  ]
  loop
    execute format('alter table public.%I alter column status set default ''new''', submission_table);
    execute format('update public.%I set status = ''contacted'' where status = ''reviewed''', submission_table);
    execute format(
      'update public.%I set status = ''new'' where status is null or status not in (''new'',''contacted'',''pending'',''approved'',''rejected'')',
      submission_table
    );
    execute format('alter table public.%I drop constraint if exists %I', submission_table, submission_table || '_status_check');
    execute format(
      'alter table public.%I add constraint %I check (status in (''new'',''contacted'',''pending'',''approved'',''rejected''))',
      submission_table,
      submission_table || '_status_check'
    );
  end loop;
end
$$;

-- ─────────────────────────────────────────
-- Submissions are never deletable
-- ─────────────────────────────────────────
drop policy if exists "Admins can delete applications" on public.membership_applications;
drop policy if exists "Authenticated users can delete applications" on public.membership_applications;

drop policy if exists "Admins can delete venue inquiries" on public.venue_inquiries;
drop policy if exists "Authenticated users can delete venue inquiries" on public.venue_inquiries;

drop policy if exists "Admins can delete micro party inquiries" on public.micro_party_inquiries;
drop policy if exists "Authenticated users can delete micro party inquiries" on public.micro_party_inquiries;

drop policy if exists "Admins can delete collaborations" on public.collaborations;
drop policy if exists "Authenticated users can delete collaborations" on public.collaborations;

drop policy if exists "Admins can delete signups" on public.signups;
drop policy if exists "Authenticated users can delete signups" on public.signups;
