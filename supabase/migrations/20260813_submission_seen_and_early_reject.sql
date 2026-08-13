-- Migration: submission_seen_and_early_reject
-- Extends the shared five-state submission workflow (new/contacted/pending/
-- approved/rejected) with a sixth, lighter-touch 'seen' state, and widens the
-- status_check constraints on the four manual-workflow tables to allow it.
--
-- Updated status lifecycle for membership_applications, venue_inquiries,
-- micro_party_inquiries, collaborations:
--   new        → Default on form submission. Opening a submission never
--                changes its status (still true).
--   seen       → Admin clicked "Mark as seen": acknowledged, no decision yet.
--   contacted  → Admin has reached out.
--   pending    → Admin is holding it for follow-up.
--   approved   → Accepted (for applications: triggers account creation).
--   rejected   → Denied. Now reachable directly from 'new' and 'seen' too,
--                not just from contacted/pending.
--
-- signups keeps its own separate two-state ('new' → 'seen') constraint from
-- 20260728_signups_seen_status.sql, untouched by this migration.

do $$
declare
  submission_table text;
begin
  foreach submission_table in array array[
    'membership_applications',
    'venue_inquiries',
    'micro_party_inquiries',
    'collaborations'
  ]
  loop
    execute format('alter table public.%I drop constraint if exists %I', submission_table, submission_table || '_status_check');
    execute format(
      'alter table public.%I add constraint %I check (status in (''new'',''seen'',''contacted'',''pending'',''approved'',''rejected''))',
      submission_table,
      submission_table || '_status_check'
    );
  end loop;
end
$$;
