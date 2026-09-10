// denial-history.js — the shared vocabulary for "somebody was turned away".
//
// WHY THIS EXISTS
// Denials were always written to the database (ticket_checkins,
// trial_pass_checkins and member_id_scans all carry a `result` and a
// `reject_reason`), but nothing ever read them back. The front desk's only
// surface for a denial was the scanner's own red result card, which vanishes
// after RESULT_HOLD_MS. So if a guest was turned away and came back twenty
// minutes later at a different door person, there was no way to know.
//
// The labels below used to live inside UnifiedDoorScanner as three private
// arrays plus a switch. They are here now because the SERVER also has to
// render them: the check-in feed turns stored rows into human text without a
// scanner in the loop. One vocabulary, two readers.
//
// This module is intentionally dependency-free and pure so it can be unit
// tested and imported from both a route handler and a client component.

// ---- Which results mean "did not get in" -------------------------------
//
// The complement of the ADMITTING_* lists in checkin-feed.js. Together they
// must cover every value each table's CHECK constraint allows, or a scan would
// be silently absent from the feed instead of appearing as one or the other.
//
//   ticket_checkins:      valid | already_used | refunded | void | wrong_event
//                         | not_found | override | rejected
//   trial_pass_checkins:  allowed | denied_expired | denied_ineligible_event
//                         | denied_duplicate | rejected
//   member_id_scans:      verified | rejected
export const DENYING_TICKET_RESULTS = [
  'already_used', 'refunded', 'void', 'wrong_event', 'not_found', 'rejected',
];
export const DENYING_TRIAL_PASS_RESULTS = [
  'denied_expired', 'denied_ineligible_event', 'denied_duplicate', 'rejected',
];
export const DENYING_MEMBER_ID_RESULTS = ['rejected'];

// ---- Human labels ------------------------------------------------------

// Keyed by the stored `result`. Mirrors humanDeniedHeadline() in the scanner,
// minus the "Denied · " prefixes — the feed renders its own badge, so the
// label here is just the cause.
const RESULT_LABELS = {
  already_used: 'Already used',
  refunded: 'Ticket refunded',
  void: 'Ticket void',
  wrong_event: 'Wrong event',
  not_found: 'Ticket not found',
  denied_expired: 'Pass expired',
  denied_ineligible_event: 'Not eligible for this event',
  denied_duplicate: 'Already used tonight',
  rejected: 'Rejected by staff',
};

// Keyed by the stored `reject_reason`. The union of REJECT_REASONS_TICKET,
// REJECT_REASONS_TRIAL_PASS and REJECT_REASONS_MEMBER_ID in the scanner, plus
// lib/tickets/checkin.js REJECT_REASONS which the ticket endpoint validates
// against. Codes overlap across sources by design and mean the same thing.
const REJECT_REASON_LABELS = {
  photo_mismatch: 'Photo mismatch',
  no_photo_on_file: 'No photo on file',
  id_mismatch: 'ID mismatch',
  membership_inactive: 'Membership inactive',
  manual: 'Manual reject',
};

export function isDenyingResult(kind, result) {
  if (kind === 'ticket') return DENYING_TICKET_RESULTS.includes(result);
  if (kind === 'trial_pass') return DENYING_TRIAL_PASS_RESULTS.includes(result);
  if (kind === 'member_id') return DENYING_MEMBER_ID_RESULTS.includes(result);
  return false;
}

// denialLabel(result, rejectReason) — the one-line cause shown on a denial row.
//
// A staff rejection carries the real information in reject_reason, so it wins:
// "Rejected · Photo mismatch" is useful where a bare "Rejected by staff" is
// not. Automatic denials (already_used, denied_expired, ...) have no
// reject_reason and use the result label alone.
export function denialLabel(result, rejectReason = null) {
  const reason = rejectReason ? (REJECT_REASON_LABELS[rejectReason] || rejectReason) : null;
  if (result === 'rejected') {
    return reason ? `Rejected · ${reason}` : 'Rejected by staff';
  }
  const base = RESULT_LABELS[result] || 'Denied';
  return reason ? `${base} · ${reason}` : base;
}

// ---- History summary ---------------------------------------------------

// summarizeDenialHistory(rows, { now, sessionStartMs })
//
// `rows` are prior denials for ONE person, newest first, each
// { at: number, label: string, eventTitle?: string|null }.
//
// Returns null when there is nothing to report, so a caller can skip the
// banner entirely rather than render an empty one.
//
//   { total, tonight, lastAt, lastLabel, reasons }
//
// `tonight` is counted separately because it carries different operational
// weight: three denials tonight is someone trying doors right now, while three
// denials spread over a year is a pattern worth knowing but not urgent.
export function summarizeDenialHistory(rows, { sessionStartMs = null } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(r.at));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => b.at - a.at);
  const tonight = sessionStartMs === null
    ? 0
    : sorted.filter((r) => r.at >= sessionStartMs).length;
  const reasons = [];
  for (const row of sorted) {
    if (row.label && !reasons.includes(row.label)) reasons.push(row.label);
  }
  return {
    total: sorted.length,
    tonight,
    lastAt: sorted[0].at,
    lastLabel: sorted[0].label || 'Denied',
    reasons,
  };
}

// relativeAge(ms, now) — "just now" / "20 min ago" / "3 hr ago" / "6 days ago".
// Deliberately coarse: the door person needs "recent or not", not a timestamp.
export function relativeAge(at, now = Date.now()) {
  const delta = Math.max(0, now - at);
  const min = Math.floor(delta / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// priorDenialBanner(summary, now) — the sentence shown on the scanner's
// preview card, before the door person decides. Front-loads the count and the
// most recent cause; the full list is rendered separately underneath.
export function priorDenialBanner(summary, now = Date.now()) {
  if (!summary) return null;
  const when = relativeAge(summary.lastAt, now);
  if (summary.tonight > 0) {
    const times = summary.tonight === 1 ? 'once' : `${summary.tonight} times`;
    return `Turned away ${times} tonight — most recently ${when} (${summary.lastLabel}).`;
  }
  const times = summary.total === 1 ? 'once before' : `${summary.total} times before`;
  return `Turned away ${times} — most recently ${when} (${summary.lastLabel}).`;
}
