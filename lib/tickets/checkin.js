// Pure validation logic for a ticket-code scan. Kept dependency-free so it
// can be unit-tested against fixtures without spinning up Supabase.
//
// The caller passes in the ticket row (or null if not found) + the event id
// the scanner is currently locked to, and this function returns a stable
// { result, reason } tuple that the API route persists into
// public.ticket_checkins.

// Possible results are the same set enumerated in the DB check constraint
// on public.ticket_checkins.result:
export const CHECKIN_RESULTS = Object.freeze({
  VALID: 'valid',
  ALREADY_USED: 'already_used',
  REFUNDED: 'refunded',
  VOID: 'void',
  WRONG_EVENT: 'wrong_event',
  NOT_FOUND: 'not_found',
  OVERRIDE: 'override',
  // Staff explicitly turned the person away at the door (photo mismatch,
  // ID mismatch, not the buyer, etc). Does NOT consume the ticket — the
  // ticket stays valid so the actual buyer can still enter.
  REJECTED: 'rejected',
});

// Enumerated reject reasons the scanner UI offers. Free-text notes are
// captured separately in ticket_checkins.note. Keep in sync with the
// human-readable labels in app/t/scan/ScannerClient.jsx.
export const REJECT_REASONS = Object.freeze({
  PHOTO_MISMATCH: 'photo_mismatch',
  NO_PHOTO_ON_FILE: 'no_photo_on_file',
  ID_MISMATCH: 'id_mismatch',
  MANUAL: 'manual',
});

export const REJECT_REASON_VALUES = Object.freeze(Object.values(REJECT_REASONS));

export function isValidRejectReason(reason) {
  return typeof reason === 'string' && REJECT_REASON_VALUES.includes(reason);
}

// Decide the outcome. Does NOT mutate the ticket; the caller does that
// after a successful validate() so persistence + validation can be tested
// separately.
//
//   ticket:   row from public.tickets (or null)
//   eventId:  the event id the scanner is bound to
//   options:  { allowRescanWithinMs?: number } — if set, a duplicate scan
//             within N ms of the first is treated as "already_used" rather
//             than erroring so a operator double-tap doesn't panic.
export function validateTicketScan({ ticket, eventId, now = new Date(), options = {} }) {
  if (!ticket) return { result: CHECKIN_RESULTS.NOT_FOUND, reason: 'NO_MATCH' };

  if (ticket.event_id && eventId && ticket.event_id !== eventId) {
    return { result: CHECKIN_RESULTS.WRONG_EVENT, reason: 'EVENT_MISMATCH' };
  }

  switch (ticket.status) {
    case 'void':
      return { result: CHECKIN_RESULTS.VOID, reason: 'STATUS_VOID' };
    case 'refunded':
      return { result: CHECKIN_RESULTS.REFUNDED, reason: 'STATUS_REFUNDED' };
    case 'used':
      return { result: CHECKIN_RESULTS.ALREADY_USED, reason: 'PREVIOUSLY_USED', usedAt: ticket.used_at };
    case 'valid':
      return { result: CHECKIN_RESULTS.VALID, reason: 'OK' };
    default:
      return { result: CHECKIN_RESULTS.VOID, reason: `UNKNOWN_STATUS:${ticket.status}` };
  }
}
