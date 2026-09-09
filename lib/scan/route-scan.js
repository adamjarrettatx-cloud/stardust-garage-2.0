// route-scan.js — pure client-safe helpers that turn a sniffScan() result into
// one or two "attempt this endpoint next" descriptors. Kept out of any React
// component so the routing decision is unit-testable and identical between the
// standalone /capacity/scan page and the embedded front-desk scanner.
//
// The unified door scanner:
//   1. reads a raw QR string from the camera,
//   2. runs sniffScan() on it,
//   3. asks planScanAttempts() what to POST first,
//   4. if that POST comes back with a "wrong kind of token" signal (only
//      possible for the ambiguous_token case), falls through to the second
//      attempt.
//
// A "trial pass" and a "member ID" token are both 32-hex — sniffScan() flags
// that overlap as `ambiguous_token`. That is a real ambiguity we cannot
// resolve on the client: for the same 32-hex string there is either a member
// row or a trial-pass row in the database (never both, because we look them
// up in different tables). So we probe member first (memberships are
// long-lived and the more common daily hit at the front door) and fall back
// to trial-pass when the member probe comes back not_found.
//
// planScanAttempts(sniff, ctx?) returns:
//   { kind: 'unknown', attempts: [] }
//   { kind: 'ticket',       attempts: [ticket]     }
//   { kind: 'trial_pass',   attempts: [trialPass]  }
//   { kind: 'member_id',    attempts: [memberId]   }
//   { kind: 'ambiguous_token', attempts: [memberId, trialPass] }
//
// The optional ctx is:
//   { eventId?: string, doorSessionId?: string }
// and threads the active event + door session into every attempt body.
// Ticket scans require an eventId (the endpoint 400s without one); member
// and trial-pass scans just carry it along for the audit log.
//
// Each attempt is:
//   { source: 'member_id' | 'trial_pass' | 'ticket',
//     endpoint: string,
//     body:     object }
//
// We keep the ticket endpoint here even though the current front-desk brief
// only cares about member + trial-pass, because /capacity/scan (the fallback)
// already accepts ticket QRs and we want its refactor to keep working.

export function planScanAttempts(sniff, ctx = {}) {
  if (!sniff || typeof sniff !== 'object') return { kind: 'unknown', attempts: [] };
  const eventId = typeof ctx.eventId === 'string' && ctx.eventId ? ctx.eventId : null;
  const doorSessionId = typeof ctx.doorSessionId === 'string' && ctx.doorSessionId ? ctx.doorSessionId : null;

  switch (sniff.kind) {
    case 'member_id':
      return {
        kind: 'member_id',
        attempts: [memberAttempt(sniff.token, eventId, doorSessionId)],
      };
    case 'trial_pass':
      return {
        kind: 'trial_pass',
        attempts: [trialPassAttempt(sniff.token, eventId, doorSessionId)],
      };
    case 'ticket':
      // No eventId → no attempt. Ticket scans MUST be tied to an event, and
      // the endpoint would just 400. Better to surface a clean "start an
      // event first" message in the caller than to fire a doomed request.
      if (!eventId) {
        return { kind: 'ticket', requiresEvent: true, attempts: [] };
      }
      return {
        kind: 'ticket',
        attempts: [ticketAttempt(sniff.code, eventId, doorSessionId)],
      };
    case 'ambiguous_token':
      return {
        kind: 'ambiguous_token',
        // Member ID first — a scanned wallet card is the common daily case
        // and cheap to probe. Trial-pass fallback handles first-visit guests
        // who have not yet been upgraded.
        attempts: [
          memberAttempt(sniff.token, eventId, doorSessionId),
          trialPassAttempt(sniff.token, eventId, doorSessionId),
        ],
      };
    default:
      return { kind: 'unknown', attempts: [] };
  }
}

// Field naming here matches what the endpoints already expect — do not
// rename without also updating the routes. Verified against
// /scan/UnifiedScanClient.js so this stays in lockstep with the fallback
// standalone scanner.
//   * member-id     uses  event_id + door_session_id
//   * trial-pass    uses  eventId  + door_session_id
//   * tickets       uses  event_id + door_session_id
function memberAttempt(token, eventId, doorSessionId) {
  const body = { token, mode: 'preview' };
  if (eventId) body.event_id = eventId;
  if (doorSessionId) body.door_session_id = doorSessionId;
  return { source: 'member_id', endpoint: '/api/scan/member-id', body };
}

function trialPassAttempt(token, eventId, doorSessionId) {
  const body = { token, mode: 'preview' };
  if (eventId) body.eventId = eventId;
  if (doorSessionId) body.door_session_id = doorSessionId;
  return { source: 'trial_pass', endpoint: '/api/capacity/trial-pass/scan', body };
}

function ticketAttempt(code, eventId, doorSessionId) {
  const body = { code, mode: 'preview', event_id: eventId };
  if (doorSessionId) body.door_session_id = doorSessionId;
  return { source: 'ticket', endpoint: '/api/tickets/scan', body };
}

// shouldFallThroughAmbiguous({source, status, json}) — recognizes the
// "the other kind of QR" case for ambiguous_token so the caller knows to
// retry with the second attempt in the plan.
//
// Contracts we rely on (verified against the current routes):
//   * /api/scan/member-id
//       status 400 → token was not well-formed as a member ID; do NOT fall
//         through, this is a bug (planScanAttempts only queues this when
//         the token IS 32-hex).
//       status 404 → token is well-formed but no member row / no token row.
//         This is the fall-through signal for ambiguous_token.
//       status 200 → real preview; render it.
//       status 410 → revoked; render it (do not silently retry as trial pass).
//       status 429 / 5xx → rate-limited / server error; do NOT fall through.
//   * /api/capacity/trial-pass/scan
//       status 200 with json.result === 'not_a_pass' → not a trial-pass token.
//       everything else → render.
export function shouldFallThroughAmbiguous({ source, status, json }) {
  if (source === 'member_id') {
    return status === 404;
  }
  if (source === 'trial_pass') {
    return status === 200 && json && json.result === 'not_a_pass';
  }
  return false;
}
