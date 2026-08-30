// Shared constants and helpers for the Contacts directory — the persistent
// record of the people, collectives, renters and vendors SDG does business with.
//
// Safe to import from client components: nothing here reaches for a
// service-role key or a server-only module. auditContact() takes the admin
// client as an argument (the caller is a gated route handler).

// Order matters: this array drives the type checkboxes on the contact form AND
// the filter tabs on the contacts list (ContactsList.js builds TYPE_TABS from
// it), so Event Organizer leads — it is the profile staff start a contract from.
export const CONTACT_TYPE_OPTIONS = [
  { value: 'event_organizer', label: 'Event Organizer' },
  { value: 'dj',           label: 'DJ' },
  { value: 'artist',       label: 'Artist' },
  { value: 'performer',    label: 'Performer' },
  { value: 'collective',   label: 'Collective' },
  { value: 'promoter',     label: 'Promoter' },
  { value: 'venue_renter', label: 'Venue Renter' },
  { value: 'vendor',       label: 'Vendor' },
  { value: 'resident',     label: 'Resident' },
  { value: 'other',        label: 'Other' },
];

export const CONTACT_STATUS_OPTIONS = [
  { value: 'active',      label: 'Active' },
  { value: 'inactive',    label: 'Inactive' },
  { value: 'do_not_book', label: 'Do Not Book' },
  // Retired counterparty. Kept (never deleted) because signed contracts,
  // bookings and audit history reference the row; archived profiles are hidden
  // from pickers and blocked from being sent new contracts.
  { value: 'archived',    label: 'Archived' },
];

// Mirrors the contact_audit_log.action check constraint. The audit route
// validates against this so a client can't invent an action the DB will reject.
export const CONTACT_AUDIT_ACTIONS = [
  'create',
  'update',
  'status_change',
  'note_added',
  'link_added',
  'link_removed',
  'delete_attempted',
];

// The single wording for the "attach a contact unless it's SDG-only" rule, used
// by the event form, the TicketTailor creator and the create-with-tt route so
// all three enforcement points say the same thing.
export const CONTACT_REQUIRED_MESSAGE =
  'Select a Contact for this event, or mark it as an SDG-only event if there is no outside organizer, collective or renter involved.';

// Contact types that get paid as 1099 contractors for a set/performance,
// rather than for renting the space or bringing guests. Drives:
//   * which contacts can be booked as an artist/DJ event booking (Phase 2,
//     see lib/booking-helpers.js)
//   * which contacts show the tax-profile (W9) section (Phase 1)
//   * which contacts get contractor-flavored partner-invite copy (Phase 1)
// Shared here rather than in booking-helpers.js since it's a fact about
// contacts, not about bookings — other future features (e.g. a "pending 1099s"
// contact filter) can reuse it too without importing the booking module.
export const CONTRACTOR_CONTACT_TYPES = ['dj', 'artist', 'performer'];

export function isContractorContact(contactType) {
  return Array.isArray(contactType) && contactType.some((t) => CONTRACTOR_CONTACT_TYPES.includes(t));
}

// Idempotent: read a contact's contact_type, append 'event_organizer' if it
// isn't already there, and write it back. Called from every code path that
// attaches a contact to an event's Event Organizer slot so the profile always
// matches the role by the time a contract is drawn. Never throws — tagging is
// bookkeeping, it must not break the outer save.
//
// `client` is any Supabase client (rls or admin) whose caller can update this
// contact row. Returns the resulting contact_type array (or null on failure).
export async function ensureContactTaggedEventOrganizer(client, contactId) {
  if (!contactId) return null;
  try {
    const { data: contact, error: readError } = await client
      .from('contacts')
      .select('id, contact_type')
      .eq('id', contactId)
      .maybeSingle();
    if (readError || !contact) return null;
    const current = Array.isArray(contact.contact_type) ? contact.contact_type : [];
    if (current.includes('event_organizer')) return current;
    const next = [...current, 'event_organizer'];
    const { error: writeError } = await client
      .from('contacts')
      .update({ contact_type: next })
      .eq('id', contactId);
    if (writeError) return null;
    return next;
  } catch {
    return null;
  }
}

export function contactTypeLabel(value) {
  return CONTACT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function contactStatusLabel(value) {
  return CONTACT_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

// Insert a contact audit row. Never throws — auditing must not break the
// request. Mirrors audit() in lib/document-helpers.js, including pulling the
// real ip/user-agent off the request so they can't be spoofed by the client.
export async function auditContact({ admin, action, contactId, actorId, actorEmail, request, details = null }) {
  try {
    await admin.from('contact_audit_log').insert({
      contact_id: contactId,
      action,
      actor_id: actorId,
      actor_email: actorEmail,
      ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request?.headers.get('user-agent') || null,
      details,
    });
  } catch (err) {
    console.error('[auditContact] failed to insert audit row', err);
  }
}
