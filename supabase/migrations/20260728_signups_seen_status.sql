-- Migration: signups_seen_status
-- Signups are a passive email/text subscriber list, not a workflow. They move
-- to a two-state lifecycle of their own:
--   new  → Default on signup. Nobody has looked at it yet.
--   seen → An admin loaded /bananas/signups, which acknowledges the row.
--          There is no manual button; the page load performs the transition.
--
-- Scoped to public.signups only. membership_applications, venue_inquiries,
-- micro_party_inquiries and collaborations keep the shared five-state workflow
-- (new/contacted/pending/approved/rejected) and their existing check
-- constraints untouched.

update public.signups set status = 'seen' where status = 'contacted';

-- Defensive normalization, mirroring 20260727_submission_status_contacted_workflow.sql.
update public.signups
set status = 'new'
where status is null or status not in ('new', 'seen');

alter table public.signups alter column status set default 'new';

alter table public.signups drop constraint if exists signups_status_check;

alter table public.signups
  add constraint signups_status_check check (status in ('new', 'seen'));
