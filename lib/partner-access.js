import { canHostGuestList, canRequestPay, canSignContracts } from './role-label.js';

// Contact tags describe the relationship; they NEVER confer staff privileges.
export function isRestrictedStaffRole(role) {
  return role === 'front_desk' || role === 'calendar_viewer';
}

export function partnerState(partner) {
  if (!partner) return 'none';
  if (partner.is_active === true) return 'active';
  return partner.activated_at ? 'disabled' : 'invited';
}

export function partnerRouteRedirect({ pathname, partner, teamRole }) {
  if (!(pathname === '/portal' || pathname.startsWith('/portal/'))) return null;
  if (teamRole === 'front_desk') return '/capacity/front-desk';
  if (teamRole === 'calendar_viewer') return '/team/calendar';
  const state = partnerState(partner);
  if (state === 'active') return null;
  return state === 'invited' ? '/portal/activate' : '/account/profile';
}

// Navigation hints only. RPCs/RLS and mutation handlers remain authoritative.
export function partnerViews(contactType, { grants = [], bookings = [], contracts = [] } = {}) {
  return {
    guestList: canHostGuestList(contactType) || grants.length > 0,
    pay: canRequestPay(contactType) || bookings.length > 0,
    contracts: canSignContracts(contactType) || contracts.length > 0,
  };
}
