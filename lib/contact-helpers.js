// Shared constants and helpers for the Contacts directory — the persistent
// record of the people, collectives, renters and vendors SDG does business with.
//
// Safe to import from client components: nothing here reaches for a
// service-role key or a server-only module. auditContact() takes the admin
// client as an argument (the caller is a gated route handler).

// Canonical relationship types. Legacy organizer/collective tags are preserved.
// Historical `dj`
// and `performer` values remain valid data, but the directory and form present
// both as Artist. Historical `resident` and `other` values are preserved when a
// profile is edited, but are no longer choices in the UI.
export const CONTACT_TYPE_OPTIONS = [
  { value: 'artist',       label: 'Artist' },
  { value: 'organization', label: 'Organization' },
  { value: 'venue_renter', label: 'Venue Renter' },
  { value: 'vendor',       label: 'Vendor' },
  { value: 'promoter',     label: 'Promoter' },
  { value: 'person',       label: 'Person' },
];

export const CONTACT_DIRECTORY_SECTIONS = [
  { value: 'person', label: 'Persons', description: 'Artists, promoters and individual contacts' },
  { value: 'organization', label: 'Organizations', description: 'Event organizers, collectives and businesses' },
  { value: 'venue_renter', label: 'Venue Renter', description: 'Private and venue bookings' },
  { value: 'vendor', label: 'Vendor', description: 'Services and suppliers' },
];

const ARTIST_CONTACT_TYPES = ['artist', 'dj', 'performer'];
const PERSON_CONTACT_TYPES = [...ARTIST_CONTACT_TYPES, 'promoter', 'person'];
const ORGANIZATION_CONTACT_TYPES = ['organization', 'event_organizer', 'collective'];

export function contactMatchesDirectorySection(contactType, section) {
  if (['event_organizer', 'collective'].includes(section)) section = 'organization';
  if (['artist', 'promoter'].includes(section)) section = 'person';
  if (!CONTACT_DIRECTORY_SECTIONS.some(({ value }) => value === section)) return false;
  const types = Array.isArray(contactType) ? contactType : [];
  return section === 'person'
    ? types.some((type) => PERSON_CONTACT_TYPES.includes(type))
    : section === 'organization' ? types.some((type) => ORGANIZATION_CONTACT_TYPES.includes(type))
      : types.includes(section);
}

export function contactDirectoryTypes(types) {
  return CONTACT_DIRECTORY_SECTIONS.filter(({ value }) => contactMatchesDirectorySection(types, value)).map(({ value }) => value);
}

export function contactDirectorySection(value) {
  if (['event_organizer', 'collective'].includes(value)) value = 'organization';
  if (['artist', 'promoter'].includes(value)) value = 'person';
  return CONTACT_DIRECTORY_SECTIONS.find((section) => section.value === value) || null;
}

export function contactDirectoryHref(value, archived = false) {
  const section = contactDirectorySection(value);
  const params = new URLSearchParams();
  if (section) params.set('category', section.value);
  if (archived) params.set('view', 'archived');
  return `/bananas/contacts${params.size ? `?${params}` : ''}`;
}

function matchesContactSearch(contact, query) {
  const q = query.trim().toLowerCase();
  return !q || [contact.display_name, contact.primary_contact_name, contact.company,
    contact.email, contact.phone, contact.instagram_handle]
    .some((value) => String(value || '').toLowerCase().includes(q));
}

export function filterDirectoryContacts(contacts, section, query = '', status = '') {
  return contacts.filter((contact) => {
    if (contact.status === 'archived') return false;
    if (!contactMatchesDirectorySection(contact.contact_type, section)) return false;
    if (status && contact.status !== status) return false;
    return matchesContactSearch(contact, query);
  });
}

export function filterArchivedContacts(contacts, section = null, query = '') {
  return contacts.filter((contact) => {
    if (contact.status !== 'archived') return false;
    if (section && !contactMatchesDirectorySection(contact.contact_type, section)) return false;
    return matchesContactSearch(contact, query);
  });
}

export function isContactTypeSelected(contactType, option) {
  const types = Array.isArray(contactType) ? contactType : [];
  // Profile tags are independent of their shared directory category.
  if (option === 'artist') return types.some((type) => ARTIST_CONTACT_TYPES.includes(type));
  if (option === 'organization') return types.some((type) => ORGANIZATION_CONTACT_TYPES.includes(type));
  return types.includes(option);
}

export function toggleContactType(contactType, option) {
  const types = Array.isArray(contactType) ? contactType : [];
  if (option === 'organization') {
    const without = types.filter((type) => !ORGANIZATION_CONTACT_TYPES.includes(type));
    return contactMatchesDirectorySection(types, option) ? without : [...without, 'organization'];
  }
  if (option !== 'artist') {
    return types.includes(option)
      ? types.filter((type) => type !== option)
      : [...types, option];
  }
  const withoutArtistTypes = types.filter((type) => !ARTIST_CONTACT_TYPES.includes(type));
  return isContactTypeSelected(types, 'artist')
    ? withoutArtistTypes
    : [...withoutArtistTypes, 'artist'];
}

export const CONTACT_STATUS_OPTIONS = [
  { value: 'active',      label: 'Active' },
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
  if (['event_organizer', 'collective'].includes(value)) return 'Organization';
  // Historical labels remain readable outside the redesigned directory.
  if (value === 'dj') return 'DJ';
  if (value === 'performer') return 'Performer';
  if (value === 'resident') return 'Resident';
  if (value === 'other') return 'Other';
  return CONTACT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function contactStatusLabel(value) {
  // Preserve the original wording in historical audit entries.
  if (value === 'inactive') return 'Inactive';
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
