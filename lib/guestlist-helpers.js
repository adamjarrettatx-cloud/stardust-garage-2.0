// Shared constants and helpers for the Guest List — the per-event allocation of
// free/discounted door spots a partner (see partner_profiles) can spend on named
// guests.
//
// Safe to import from client components: nothing here reaches for a
// service-role key or a server-only module. auditGuestlist() takes the admin
// client as an argument (the caller is a gated route handler). Mirrors
// lib/contact-helpers.js.

export const COMP_TYPE_OPTIONS = [
  { value: 'free',     label: 'Free entry' },
  { value: 'discount', label: 'Discounted entry' },
];

export const ENTRY_STATUS_OPTIONS = [
  { value: 'pending',    label: 'Pending' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'no_show',    label: 'No show' },
];

// Mirrors the guestlist_audit_log.action check constraint, so a caller can't
// invent an action the DB will reject.
export const GUESTLIST_AUDIT_ACTIONS = [
  'grant_created',
  'grant_updated',
  'grant_revoked',
  'entry_added',
  'entry_removed',
  'checked_in',
  // Written by /partner/auth/callback when a Google sign-in re-points a
  // partner_profiles row at a different auth identity — see lib/partner-identity.js.
  'partner_identity_relinked',
];

export function compTypeLabel(value) {
  return COMP_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function entryStatusLabel(value) {
  return ENTRY_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

// ---------------------------------------------------------------------------
// Slot accounting
// ---------------------------------------------------------------------------
//
// These mirror, in JS, the rule the database enforces in
// event_guestlist_entries_enforce_capacity() (20260731_partner_guestlist_portal.sql).
// The trigger is the authority; this is what lets the UI show the same numbers
// and grey out the same buttons instead of finding out by getting a 409.
//
// Keeping both sides in one file is the point: change the counting rule here
// and the tests that pin it against the migration fail.

// A no_show does not occupy a spot. Someone who never turned up freed the slot
// back up, and the partner should be able to spend it on somebody else.
export function entryOccupiesSlot(entry) {
  return Boolean(entry) && entry.status !== 'no_show';
}

// How one comp type stands on a grant. `allocated` is false when the admin gave
// this partner none of that type at all, which is different from having used
// them all up — the UI hides the former and explains the latter.
export function compTypeUsage(entries, compType, allowed) {
  const total = Number.isFinite(allowed) && allowed > 0 ? allowed : 0;
  const used = (entries || []).filter(
    (e) => e?.comp_type === compType && entryOccupiesSlot(e)
  ).length;

  return {
    compType,
    used,
    total,
    // Clamped: an allocation that was cut after names were added would
    // otherwise report a negative number of spots left.
    remaining: Math.max(0, total - used),
    allocated: total > 0,
    full: used >= total,
  };
}

export function grantUsage(grant, entries) {
  return {
    free: compTypeUsage(entries, 'free', grant?.free_slots ?? 0),
    discount: compTypeUsage(entries, 'discount', grant?.discount_slots ?? 0),
  };
}

// The comp types this partner can still add against, in COMP_TYPE_OPTIONS
// order. Empty means the whole allocation is spent.
export function addableCompTypes(usage) {
  return COMP_TYPE_OPTIONS
    .map((o) => o.value)
    .filter((value) => usage?.[value]?.allocated && !usage[value].full);
}

// Only a pending entry may be withdrawn. A checked_in guest is already through
// the door and deleting them would erase the record that they came; a no_show
// is a staff observation, not the partner's to undo. Enforced again in
// DELETE /api/partner/guestlist/entries/[id] — this is the copy the UI reads.
export function canRemoveEntry(entry) {
  return entry?.status === 'pending';
}

export const MAX_GUEST_NAME_LENGTH = 80;

// Door staff read these names off a screen and match them against an ID, so
// collapse the whitespace people paste in from a spreadsheet.
export function normalizeGuestName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

// ---------------------------------------------------------------------------
// Grouping the partner's grants for display
// ---------------------------------------------------------------------------

// events.event_date is a DATE, which arrives as 'YYYY-MM-DD'. Comparing it as a
// string against today in the same format avoids parsing it into a Date and
// having the runtime's timezone decide whether tonight's event is already over.
export function austinToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Upcoming soonest-first (the night they are working on is the one they came
// here for), past most-recent-first. Past grants are kept rather than dropped:
// a partner reasonably wants to look back at who they put on last month's list.
export function splitGrantsByDate(grants, today = austinToday()) {
  const upcoming = [];
  const past = [];

  for (const grant of grants || []) {
    // A grant with no date sorts as upcoming — better to show it than to bury
    // it in a collapsed section nobody opens.
    if (!grant?.event_date || grant.event_date >= today) upcoming.push(grant);
    else past.push(grant);
  }

  upcoming.sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')));
  past.sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));

  return { upcoming, past };
}

// Insert a guest list audit row. Never throws — auditing must not break the
// request. Mirrors auditContact() in lib/contact-helpers.js, including pulling
// the real ip/user-agent off the request so they can't be spoofed by the client.
//
// Rows are grant- and/or entry-scoped: an entry action carries both ids so the
// history survives the entry being deleted (both FKs are ON DELETE SET NULL).
export async function auditGuestlist({
  admin,
  action,
  grantId = null,
  entryId = null,
  actorId,
  actorEmail,
  request,
  details = null,
}) {
  try {
    await admin.from('guestlist_audit_log').insert({
      action,
      grant_id: grantId,
      entry_id: entryId,
      actor_id: actorId,
      actor_email: actorEmail,
      ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request?.headers.get('user-agent') || null,
      details,
    });
  } catch (err) {
    console.error('[auditGuestlist] failed to insert audit row', err);
  }
}
