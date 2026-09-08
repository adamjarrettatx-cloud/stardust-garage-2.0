-- Trial-pass door scanner: rejection outcome + reason.
--
-- Mirrors the ticket-scanner change (20260907_ticket_checkins_rejected.sql):
-- staff can now REJECT a scan with a reason (photo mismatch, no photo,
-- ID mismatch, manual) after previewing the buyer's face. A rejection is
-- logged but the pass is NOT activated and its state is not otherwise
-- changed, so if the wrong person scanned a forwarded QR, the real guest
-- can still walk in later and get through cleanly.

alter table public.trial_pass_checkins
  drop constraint if exists trial_pass_checkins_result_check;

alter table public.trial_pass_checkins
  add constraint trial_pass_checkins_result_check
  check (
    result = any (
      array[
        'allowed'::text,
        'denied_expired'::text,
        'denied_ineligible_event'::text,
        'denied_duplicate'::text,
        'rejected'::text
      ]
    )
  );

alter table public.trial_pass_checkins
  add column if not exists reject_reason text;

comment on column public.trial_pass_checkins.reject_reason is
  'When result = ''rejected'', a whitelisted machine value from lib/tickets/checkin.js REJECT_REASONS. Null for allowed/denied_* rows.';
