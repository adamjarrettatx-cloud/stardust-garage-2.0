-- 20260907_ticket_checkins_rejected.sql
--
-- PR C: door-scanner upgrade. Adds a `rejected` outcome so staff can
-- explicitly turn someone away at the door (photo mismatch, ID mismatch,
-- not the buyer, etc.) without consuming the ticket. Also adds
-- `reject_reason` for the audit trail.
--
-- Behavior:
--   * `rejected` rows in ticket_checkins DO NOT flip tickets.status. The
--     ticket stays valid so the actual buyer can still enter if the
--     rejected person was, say, a friend the buyer sent with the QR.
--   * `reject_reason` is a free-text string (bounded UI values in the
--     scanner client, plus arbitrary staff notes).

alter table public.ticket_checkins
  drop constraint if exists ticket_checkins_result_check;

alter table public.ticket_checkins
  add constraint ticket_checkins_result_check
  check (result = any (array[
    'valid'::text,
    'already_used'::text,
    'refunded'::text,
    'void'::text,
    'wrong_event'::text,
    'not_found'::text,
    'override'::text,
    'rejected'::text
  ]));

alter table public.ticket_checkins
  add column if not exists reject_reason text;

comment on column public.ticket_checkins.reject_reason is
  'When result=rejected, the staff-supplied reason. Values include photo_mismatch, no_photo_on_file, id_mismatch, manual.';
