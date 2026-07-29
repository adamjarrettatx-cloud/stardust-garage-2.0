-- =========================================================
-- Guest List — dedicated 'marked_no_show' audit action
--
-- WHY: the door kiosk (/capacity/guest-list) logged a no-show as
-- `entry_removed` with `details.reason='no_show'`, purely because
-- guestlist_audit_log.action is a CHECK constraint that had no value for it.
-- That overload is wrong on its own terms: entry_removed means a partner or
-- admin took the guest off the roster before the event, while a no-show is a
-- guest who kept their spot and never turned up. Reading the log for "who
-- pulled entries?" therefore counted every no-show, and no-show rates could
-- only be recovered by filtering on a details key.
--
-- Additive only: the existing values are re-listed unchanged, so rows already
-- written as entry_removed stay valid and nothing needs backfilling. Same
-- drop-then-re-add pattern as 20260730_partner_google_signin.sql, which is how
-- 'partner_identity_relinked' was added to this constraint.
-- =========================================================

alter table public.guestlist_audit_log
  drop constraint if exists guestlist_audit_log_action_check;

alter table public.guestlist_audit_log
  add constraint guestlist_audit_log_action_check
  check (action in (
    'grant_created', 'grant_updated', 'grant_revoked',
    'entry_added', 'entry_removed', 'checked_in',
    'partner_identity_relinked',
    'marked_no_show'
  ));
