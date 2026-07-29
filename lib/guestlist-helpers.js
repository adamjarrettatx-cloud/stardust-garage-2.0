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
  // Door staff marked a guest as a no-show. Distinct from entry_removed: the
  // entry stays on the roster, it just never showed up.
  'marked_no_show',
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

// ---------------------------------------------------------------------------
// Allocation maths and validation
//
// Shared by the admin panel (app/bananas/events/[id]/GuestListPanel.js) and the
// routes that write grants, so the browser blocks a bad allocation with the same
// wording the server would answer with. The DB CHECK constraint
// event_guestlist_grants_slots_check is the final backstop.
// ---------------------------------------------------------------------------

const SLOT_FIELDS = [
  ['total_slots', 'Total slots'],
  ['free_slots', 'Free slots'],
  ['discount_slots', 'Discounted slots'],
];

// Per-comp-type totals for a whole grant, keyed the way the admin panel and the
// summary page want them. Same no_show rule as entryOccupiesSlot() above, which
// is why it defers to it: an admin should be able to shrink an allocation down
// to what was actually used.
export function countGrantUsage(entries = []) {
  const usage = { free: 0, discount: 0, total: 0 };
  for (const entry of entries) {
    if (!entryOccupiesSlot(entry)) continue;
    if (entry.comp_type === 'free') usage.free += 1;
    else if (entry.comp_type === 'discount') usage.discount += 1;
    else continue;
    usage.total += 1;
  }
  return usage;
}

// Validates the three slot numbers. `usage` is the current non-no_show entry
// count from countGrantUsage() — pass it when editing an existing grant so the
// allocation cannot be shrunk under names the partner has already added, and
// omit it when creating (a new grant has no entries).
export function validateGrantSlots(body, usage = null) {
  const slots = {};
  for (const [field, label] of SLOT_FIELDS) {
    const raw = body?.[field];
    const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
    if (raw === '' || raw === null || raw === undefined || !Number.isInteger(n) || n < 0) {
      return { valid: false, error: `${label} must be a whole number, 0 or more.` };
    }
    slots[field] = n;
  }

  if (slots.free_slots + slots.discount_slots > slots.total_slots) {
    return {
      valid: false,
      error:
        `Free (${slots.free_slots}) + discounted (${slots.discount_slots}) slots come to ` +
        `${slots.free_slots + slots.discount_slots}, which is more than the total of ${slots.total_slots}.`,
    };
  }

  if (usage) {
    for (const [field, label, used] of [
      ['free_slots', 'free', usage.free],
      ['discount_slots', 'discounted', usage.discount],
    ]) {
      if (slots[field] < used) {
        return {
          valid: false,
          error:
            `This grant already has ${used} ${label} guest${used === 1 ? '' : 's'} on the list. ` +
            `Mark the ones who aren't coming as no-show before dropping ${label} slots below ${used}.`,
        };
      }
    }
  }

  return { valid: true, data: slots };
}

// Full create/update payload: validated slots plus the two free-text fields.
export function buildGrantPayload(body, usage = null) {
  const slots = validateGrantSlots(body, usage);
  if (!slots.valid) return slots;

  const discountDetail = String(body?.discount_detail ?? '').trim();
  return {
    valid: true,
    data: {
      ...slots.data,
      // Door staff read this verbatim, so a leftover "50% off" against zero
      // discounted slots would be actively misleading.
      discount_detail: slots.data.discount_slots > 0 ? discountDetail || null : null,
      notes: String(body?.notes ?? '').trim() || null,
    },
  };
}

// Why a grant can't be deleted, or null when it can. Entries are ON DELETE
// CASCADE, so revoking a grant with names on it would silently drop guests who
// may already be checked in — staff reconcile first.
export function grantRevokeBlockedMessage(usage) {
  const total = usage?.total || 0;
  if (total === 0) return null;
  return (
    `This grant has ${total} guest ${total === 1 ? 'entry' : 'entries'} on the list. ` +
    'Remove or check in guest entries first (mark no-shows as no-show), then revoke.'
  );
}

// Shapes the rows the admin panel renders: usage counts per comp type and the
// contact's partner-login state, since a grant is invisible to a contact who has
// never activated a partner profile.
export function decorateGrants(grants = [], partnerProfiles = []) {
  const byContact = new Map((partnerProfiles || []).map((p) => [p.contact_id, p]));

  return (grants || [])
    .map((grant) => {
      const entries = grant.entries || [];
      const partner = byContact.get(grant.contact_id) || null;
      return {
        ...grant,
        entries,
        usage: countGrantUsage(entries),
        partner: partner
          ? {
              is_active: Boolean(partner.is_active),
              invited_at: partner.invited_at || null,
              activated_at: partner.activated_at || null,
            }
          : null,
      };
    })
    .sort((a, b) =>
      (a.contact?.display_name || '').localeCompare(b.contact?.display_name || '', 'en', {
        sensitivity: 'base',
      })
    );
}

const GRANT_SELECT = `
  id, event_id, contact_id, total_slots, free_slots, discount_slots,
  discount_detail, notes, created_at, updated_at,
  contact:contact_id ( display_name, company ),
  entries:event_guestlist_entries ( id, guest_name, comp_type, status, checked_in_at )
`;

// Every grant on an event, decorated for the admin panel. Takes the service-role
// client because the caller is a gated route handler (same contract as
// auditGuestlist below).
export async function loadEventGrants(admin, eventId) {
  const { data: grants, error } = await admin
    .from('event_guestlist_grants')
    .select(GRANT_SELECT)
    .eq('event_id', eventId);

  if (error) return { error };

  const contactIds = (grants || []).map((g) => g.contact_id);
  let partnerProfiles = [];
  if (contactIds.length) {
    const { data } = await admin
      .from('partner_profiles')
      .select('contact_id, is_active, invited_at, activated_at')
      .in('contact_id', contactIds);
    partnerProfiles = data || [];
  }

  return { grants: decorateGrants(grants, partnerProfiles) };
}

// ---------------------------------------------------------------------------
// Grant notification
// ---------------------------------------------------------------------------

// Should creating/changing this grant email the contact? Pure so the routes and
// the tests agree on the rules:
//   * only an ACTIVE partner is mailed — an uninvited or half-activated contact
//     would get a link to /partner/guest-list they cannot sign in to. The admin
//     panel already warns about that state (see PartnerState in
//     GuestListPanel.js), so the fix belongs there, not in a second email.
//   * a grant they cannot spend (no free and no discounted slots) is not news.
export function resolveGrantNotification({ contact, partner, slots }) {
  const email = String(contact?.email || '').trim();
  if (!partner?.is_active) return { send: false, reason: partner ? 'invite_pending' : 'no_partner' };
  if (!email) return { send: false, reason: 'no_email' };
  if ((slots?.free_slots || 0) + (slots?.discount_slots || 0) === 0) {
    return { send: false, reason: 'no_spendable_slots' };
  }
  return { send: true, reason: null, email };
}

// The "can't use the portal yet" reasons deliberately don't repeat the fix —
// the row's own PARTNER badge already links to the contact to invite them.
const NOTIFICATION_NOTICES = {
  sent: 'Emailed the partner a link to their guest list.',
  no_partner: 'No email sent — this contact has no partner login yet.',
  invite_pending: 'No email sent — their partner invite is still pending.',
  no_email: 'No email sent — this contact has no email address on file.',
  no_spendable_slots: 'No email sent — there are no free or discounted slots to spend yet.',
  send_failed: 'Saved, but the notification email could not be sent.',
};

// What the admin panel says after a save about whether the partner was told.
// null when there is nothing worth saying (an edit that didn't add slots).
export function grantNotificationNotice(notification) {
  if (!notification) return null;
  if (notification.sent) return NOTIFICATION_NOTICES.sent;
  return NOTIFICATION_NOTICES[notification.reason] || null;
}

// True when an edit handed the partner more room than they had. A grant that
// shrinks, or only changes its notes, is not worth an email.
export function grantSlotsIncreased(before, after) {
  return (
    (after?.free_slots || 0) > (before?.free_slots || 0) ||
    (after?.discount_slots || 0) > (before?.discount_slots || 0)
  );
}

// ---------------------------------------------------------------------------
// Cross-event reporting (app/bananas/guest-list)
// ---------------------------------------------------------------------------

// Rolls the grants of one event up into the numbers the summary page lists.
// `checked_in` counts entries the door has actually admitted, so it is read off
// status rather than countGrantUsage (which answers "is this slot spoken for").
export function summarizeGrants(grants = []) {
  const totals = {
    partners: grants.length,
    total_slots: 0,
    free_slots: 0,
    discount_slots: 0,
    used_free: 0,
    used_discount: 0,
    used: 0,
    checked_in: 0,
  };

  for (const grant of grants) {
    const usage = countGrantUsage(grant.entries || []);
    totals.total_slots += grant.total_slots || 0;
    totals.free_slots += grant.free_slots || 0;
    totals.discount_slots += grant.discount_slots || 0;
    totals.used_free += usage.free;
    totals.used_discount += usage.discount;
    totals.used += usage.total;
    totals.checked_in += (grant.entries || []).filter((e) => e?.status === 'checked_in').length;
  }

  return totals;
}

// Groups grant rows by event, newest event first. Rows whose event join came
// back empty are dropped — an event delete cascades its grants away, so this
// only happens mid-delete.
export function summarizeEventGuestlists(grantRows = []) {
  const byEvent = new Map();
  for (const row of grantRows || []) {
    if (!row?.event?.id) continue;
    const bucket = byEvent.get(row.event.id) || { event: row.event, grants: [] };
    bucket.grants.push(row);
    byEvent.set(row.event.id, bucket);
  }

  return [...byEvent.values()]
    .map(({ event, grants }) => ({ event, ...summarizeGrants(grants) }))
    .sort((a, b) => String(b.event.event_date || '').localeCompare(String(a.event.event_date || '')));
}

const SUMMARY_SELECT = `
  id, event_id, total_slots, free_slots, discount_slots,
  event:event_id ( id, title, event_date ),
  entries:event_guestlist_entries ( comp_type, status )
`;

// Every event that has at least one grant, with its roll-up. Takes the
// service-role client for the same reason loadEventGrants does.
export async function loadGuestlistSummary(admin) {
  const { data, error } = await admin.from('event_guestlist_grants').select(SUMMARY_SELECT);
  if (error) return { error };
  return { events: summarizeEventGuestlists(data) };
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
