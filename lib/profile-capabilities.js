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
export function canBookStudio(member) {
  return isEntitledMember(member) && member.subscription_plan === 'iykyk';
}
export function profileMembershipAction({ member, passes = [] } = {}) {
  if (member) return { href: '/member', label: 'Member dashboard' };
  if (passes.length) return { href: '/members', label: 'Memberships' };
  return null;
}
