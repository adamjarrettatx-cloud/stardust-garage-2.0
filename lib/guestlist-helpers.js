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

// A no_show frees the slot back up: the guest never came in, so the partner
// should be able to hand it to someone else, and an admin should be able to
// shrink the allocation down to what was actually used.
export function countGrantUsage(entries = []) {
  const usage = { free: 0, discount: 0, total: 0 };
  for (const entry of entries) {
    if (!entry || entry.status === 'no_show') continue;
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
