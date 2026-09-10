// checkin-feed.js — pure helpers for the front-desk "Checked in" list.
//
// WHY THIS EXISTS
// The panel used to be fed only by a client-side ring buffer, so it started
// empty on every page load and never saw a check-in made on another device.
// A manager glancing at the laptop would see "Nobody in yet" while the door
// tablet had already admitted people. These helpers normalize the three
// server-side sources of truth into the same entry shape the client buffer
// uses, so the list can be seeded and polled instead of remembered.
//
// ENTRY SHAPE (identical to lib/scan/recent-activity.js so the two merge):
//   { id, kind, name, detail, result: 'admitted', at }
//
// The `id` values MUST match the ones the client generates, or a live scan
// would render twice — once from the local buffer and once from the next poll.
// The client's conventions (UnifiedDoorScanner + FrontDeskClient) are:
//   ticket    -> `ticket:<ticket_id>`
//   trial     -> `trial:<trial_pass_id>`
//   guestlist -> `guestlist:<entry_id>`
// Member-ID verifies use `member:<profile_id>`. These are now persisted in
// member_id_scans, so unlike before they survive a refresh.
//
// DENIALS USE A DIFFERENT KEY, AND MUST.
// An admit is keyed by its subject because a subject can only be admitted once
// -- `ticket:<id>` is naturally unique. A denial is not: the same ticket can be
// turned away at 10:04 and again at 10:31, and those are two separate facts the
// door needs to see. Keying denials by subject would collapse them into one row
// and destroy exactly the history the list exists to show. So denials are keyed
// by the SCAN row: `scan:<checkin_row_id>`. The scan endpoints return that id as
// `checkin_id` for this reason.

export const CHECKIN_FEED_MAX = 50;

// Ticket check-ins that actually admitted someone. Mirrors the `admitted`
// rule in UnifiedDoorScanner: only 'valid' and 'override' let a guest in.
export const ADMITTING_TICKET_RESULTS = ['valid', 'override'];

// Trial-pass check-ins log 'allowed' when the door admitted the pass.
export const ADMITTING_TRIAL_PASS_RESULTS = ['allowed'];

function toMillis(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function clean(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

// A guest-list entry that has been checked in. `partnerName` is the promoter or
// comp source shown as the row's secondary line.
export function normalizeGuestlistRow(row, { partnerName = null } = {}) {
  const at = toMillis(row?.checked_in_at);
  if (!row?.id || at === null) return null;
  return {
    id: `guestlist:${row.id}`,
    kind: 'guestlist',
    name: clean(row.guest_name) || 'Guest',
    detail: clean(partnerName) || 'Guest list',
    result: 'admitted',
    at,
  };
}

// A redeemed ticket. The holder's name lives on the ORDER (orders.buyer_name),
// not on the ticket -- tickets.attendee_id is usually null because nothing in
// the current purchase flow assigns per-seat attendees. Falling back to the
// buyer name is the only identity included in this operational feed.
export function normalizeTicketRow(row, { buyerName = null, productLabel = null } = {}) {
  const at = toMillis(row?.scanned_at);
  const ticketId = row?.ticket_id;
  if (!ticketId || at === null) return null;
  if (!ADMITTING_TICKET_RESULTS.includes(row?.result)) return null;
  return {
    id: `ticket:${ticketId}`,
    kind: 'ticket',
    name: clean(buyerName) || 'Ticket holder',
    detail: clean(productLabel) || (row.result === 'override' ? 'Ticket · override' : 'Ticket'),
    result: 'admitted',
    at,
  };
}

// A trial-pass check-in.
export function normalizeTrialPassRow(row, { fullName = null } = {}) {
  const at = toMillis(row?.checked_in_at);
  const passId = row?.trial_pass_id;
  if (!passId || at === null) return null;
  if (!ADMITTING_TRIAL_PASS_RESULTS.includes(row?.result)) return null;
  return {
    id: `trial:${passId}`,
    kind: 'trial_pass',
    name: clean(fullName) || 'Trial pass',
    detail: 'Trial pass',
    result: 'admitted',
    at,
  };
}

// ---- Denials ------------------------------------------------------------
//
// Same entry shape, `result: 'denied'`, and `detail` carries the human cause
// from denialLabel(). `eventTitle` is set only when the denial happened at a
// DIFFERENT event than the one on screen, which is how "wrong event" becomes
// legible instead of cryptic.

// normalizeDenialRow(row, { kind, name, eventTitle })
//
// `row` is a raw check-in row from any of the three tables. `at` is read from
// whichever timestamp column that table uses, passed in already resolved by the
// caller so this stays free of per-table branching.
export function normalizeDenialRow({ id, at, kind, name, label, eventTitle = null }) {
  if (!id || !Number.isFinite(at)) return null;
  return {
    id: `scan:${id}`,
    kind,
    name: clean(name) || fallbackNameFor(kind),
    detail: clean(label) || 'Denied',
    eventTitle: clean(eventTitle),
    result: 'denied',
    at,
  };
}

function fallbackNameFor(kind) {
  if (kind === 'ticket') return 'Ticket holder';
  if (kind === 'trial_pass') return 'Trial pass';
  if (kind === 'member_id') return 'Member';
  return 'Guest';
}

// A verified Member ID. These are persisted in member_id_scans, so they can be
// seeded from the server like the other three sources.
export function normalizeMemberIdRow(row, { fullName = null } = {}) {
  const at = toMillis(row?.scanned_at);
  const profileId = row?.member_profile_id;
  if (!profileId || at === null) return null;
  if (row?.result !== 'verified') return null;
  return {
    id: `member:${profileId}`,
    kind: 'member_id',
    name: clean(fullName) || 'Member',
    detail: 'Member ID verified',
    result: 'admitted',
    at,
  };
}

// mergeCheckinFeed(serverEntries, localEntries, max)
//
// Local entries win on conflict: they carry `photoUrl` (a short-lived signed
// URL captured during the scan preview) which the server feed cannot provide
// without minting a signed URL per row. Losing the photo on a re-render would
// look like a regression to whoever is standing at the door.
//
// Sorted newest-first and capped. Never mutates either input.
export function mergeCheckinFeed(serverEntries, localEntries, max = CHECKIN_FEED_MAX) {
  const byId = new Map();
  for (const entry of Array.isArray(serverEntries) ? serverEntries : []) {
    if (entry && entry.id) byId.set(entry.id, entry);
  }
  for (const entry of Array.isArray(localEntries) ? localEntries : []) {
    if (!entry || !entry.id) continue;
    const existing = byId.get(entry.id);
    // Keep the server timestamp when we have one -- it is the authoritative
    // write time, whereas the local entry uses the browser's clock.
    byId.set(entry.id, existing ? { ...entry, at: existing.at } : entry);
  }
  // Denials are kept. This filter used to drop everything that was not an
  // admit, which is why the list was admit-only; the front desk now shows both
  // so a guest who was turned away earlier is visible when they come back.
  return [...byId.values()]
    .filter((e) => e.result === 'admitted' || e.result === 'denied' || e.result === 'rejected')
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, max);
}
