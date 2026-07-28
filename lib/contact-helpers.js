// Shared constants and helpers for the Contacts directory — the persistent
// record of the people, collectives, renters and vendors SDG does business with.
//
// Safe to import from client components: nothing here reaches for a
// service-role key or a server-only module. auditContact() takes the admin
// client as an argument (the caller is a gated route handler).

export const CONTACT_TYPE_OPTIONS = [
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
