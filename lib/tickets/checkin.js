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
});

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
