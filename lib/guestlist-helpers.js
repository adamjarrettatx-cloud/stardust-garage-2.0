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
