// Role labels for external collaborators (DJs, artists, collectives, promoters,
// residents, venue renters, vendors) who log in via what the DB still calls
// `partner_profiles`. Everything USER-VISIBLE — email subjects, portal
// headings, admin buttons, status pills — asks this module what to render, so
// the taxonomy lives in exactly one place. Internal names (table names, RLS
// functions, variables) still say "partner"; that is deliberate.

const SINGULAR = {
  event_organizer: 'Event Organizer',
  dj: 'DJ',
  artist: 'Artist',
  performer: 'Performer',
  resident: 'Resident',
  collective: 'Collective',
  promoter: 'Promoter',
  venue_renter: 'Venue Renter',
  vendor: 'Vendor',
  other: 'Collaborator',
};

const PLURAL = {
  event_organizer: 'Event Organizers',
  dj: 'DJs',
  artist: 'Artists',
  performer: 'Performers',
  resident: 'Residents',
  collective: 'Collectives',
  promoter: 'Promoters',
  venue_renter: 'Venue Renters',
  vendor: 'Vendors',
  other: 'Collaborators',
};

const PORTAL = {
  event_organizer: 'Organizer Portal',
  dj: 'DJ Portal',
  artist: 'Artist Portal',
  performer: 'Performer Portal',
  resident: 'Resident Portal',
  collective: 'Collective Portal',
  promoter: 'Promoter Portal',
  venue_renter: 'Rental Portal',
  vendor: 'Vendor Portal',
  other: 'Collaborator Portal',
};

// Contact types whose portal shows the guest-list section.
const HOST_TYPES = new Set([
  'dj', 'artist', 'performer', 'resident', 'collective', 'promoter',
]);

// Contact types whose portal shows the pay/bookings section.
const CONTRACTOR_TYPES = new Set([
  'dj', 'artist', 'performer', 'resident',
]);

function normalize(contactType) {
  if (Array.isArray(contactType)) return contactType.filter(Boolean);
  if (typeof contactType === 'string' && contactType) return [contactType];
  return [];
}

// Human label for a contact type or types. Joins multiples with " · ".
export function roleLabel(contactType, { plural = false } = {}) {
  const types = normalize(contactType);
  const dict = plural ? PLURAL : SINGULAR;
  const fallback = plural ? 'Collaborators' : 'Collaborator';
  if (types.length === 0) return fallback;
  return types.map((t) => dict[t] || fallback).join(' · ');
}

// Name shown on the logged-in portal shell. Uses the first (primary) type.
export function portalName(contactType) {
  const types = normalize(contactType);
  if (types.length === 0) return 'Collaborator Portal';
  return PORTAL[types[0]] || 'Collaborator Portal';
}

// Does this contact's portal need the guest-list section?
export function canHostGuestList(contactType) {
  return normalize(contactType).some((t) => HOST_TYPES.has(t));
}

// Does this contact's portal need the pay/bookings section?
export function canRequestPay(contactType) {
  return normalize(contactType).some((t) => CONTRACTOR_TYPES.has(t));
}

// Contact types whose portal shows the contracts section even before any
// contract exists. An Event Organizer is, by definition, the party we sign with,
// so the tab is part of their portal from day one. Every other type only sees it
// once they actually have a contract out for signature (the layout decides that
// from data), so a DJ who has never been sent an agreement gets no empty tab.
const CONTRACT_TYPES = new Set(['event_organizer', 'promoter', 'venue_renter', 'collective', 'vendor']);

export function canSignContracts(contactType) {
  return normalize(contactType).some((t) => CONTRACT_TYPES.has(t));
}
