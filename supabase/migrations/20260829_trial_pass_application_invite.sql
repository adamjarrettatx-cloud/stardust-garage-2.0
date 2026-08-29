-- =========================================================
-- Trial SDG Pass — add 'application_invite' email kind
--
-- When a trial guest is allowed in at the door on their first visit, we fire
-- a follow-up email inviting them to apply for full membership. The email is
-- recorded in trial_pass_emails so the send is idempotent under the existing
-- unique index on (trial_pass_id, kind, sequence).
--
-- The kind check constraint currently only knows the four issue/lifecycle
-- kinds ('pass_delivery', 'reminder', 'expiring_soon', 'expired', 'extended').
-- We add 'application_invite' as a fifth one-off kind — sequence stays at 0
-- because there is exactly one first-visit invite per pass, and the unique
-- index (trial_pass_id, kind, sequence) naturally guarantees it.
--
-- Nothing else about the table changes. Existing rows keep working.
-- =========================================================

alter table public.trial_pass_emails
  drop constraint if exists trial_pass_emails_kind_check;

alter table public.trial_pass_emails
  add constraint trial_pass_emails_kind_check
  check (kind in (
    'pass_delivery',
    'reminder',
    'expiring_soon',
    'expired',
    'extended',
    'application_invite'
  ));
