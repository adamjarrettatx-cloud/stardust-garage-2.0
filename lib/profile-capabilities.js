import { isEntitledMember } from './member-entitlement.js';

const ARTISTS = ['dj', 'artist', 'performer', 'resident'];
const ORGANIZATIONS = ['organization', 'event_organizer', 'collective'];
export function profileCapabilities(contactType) {
  const types = Array.isArray(contactType) ? contactType : [];
  const has = (values) => types.some((type) => values.includes(type));
  return {
    guestList: has([...ARTISTS, ...ORGANIZATIONS, 'promoter']),
    pay: has(ARTISTS),
    contracts: has([...ARTISTS, ...ORGANIZATIONS, 'venue_renter', 'vendor']),
    events: has(ORGANIZATIONS),
  };
}
// My Events: an events-capable contact, or a Person login recorded as the main
// contact of an organization (partner_self().manages_event_organization).
// Navigation hint only; partner_has_event() remains authoritative.
export function partnerCanViewEvents(partner) {
  return profileCapabilities(partner?.contact_type).events || partner?.manages_event_organization === true;
}
export function canBookStudio(member) {
  return isEntitledMember(member) && member.subscription_plan === 'iykyk';
}
export function profileMembershipAction({ member, passes = [] } = {}) {
  if (member) return { href: '/member', label: 'Member dashboard' };
  if (passes.length) return { href: '/members', label: 'Memberships' };
  return null;
}
