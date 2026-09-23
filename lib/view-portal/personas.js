// Fixed synthetic identities, never arbitrary production user impersonation.
export const VIEW_PERSONAS = Object.freeze([
  { id: 'free', label: 'Free account', group: 'Customer', path: '/account/profile', description: 'Own profile and tickets. No membership or staff privileges.' },
  { id: 'trial', label: 'Active trial', group: 'Customer', path: '/account/profile', trial: 'active', description: 'An active Trial SDG Pass with its existing benefits.' },
  { id: 'expired-trial', label: 'Expired trial', group: 'Customer', path: '/account/profile', trial: 'expired', description: 'Customer access remains; trial benefits have expired.' },
  { id: 'weekender', label: 'The Weekender', group: 'Customer', path: '/member', plan: 'weekender', description: 'Active Weekender membership with its actual tier rules.' },
  { id: 'builder', label: 'The Builder', group: 'Customer', path: '/member', plan: 'cowork', description: 'Active Builder membership with its actual tier rules.' },
  { id: 'insider', label: 'The Insider', group: 'Customer', path: '/member', plan: 'iykyk', description: 'Active Insider membership with its actual tier rules.' },
  { id: 'artist', label: 'Artist / DJ', group: 'Partner', path: '/portal/profile', partner: ['dj', 'artist'], description: 'Own partner profile, assigned guest lists, bookings and pay requests.' },
  { id: 'promoter', label: 'Promoter', group: 'Partner', path: '/portal/profile', partner: ['promoter'], description: 'Own partner profile, assigned guest lists and contracts.' },
  { id: 'collective', label: 'Collective', group: 'Partner', path: '/portal/profile', partner: ['collective'], description: 'Collective contact with its own allocations and agreements.' },
  { id: 'vendor', label: 'Vendor', group: 'Partner', path: '/portal/profile', partner: ['vendor'], description: 'Vendor profile and assigned agreements, without staff access.' },
  { id: 'organizer', label: 'Event organizer', group: 'Partner', path: '/portal/profile', partner: ['event_organizer'], description: 'Organizer profile and its assigned agreements.' },
  { id: 'invited-partner', label: 'Invitation pending', group: 'Partner', path: '/portal/activate', partner: ['promoter'], partnerState: 'invited', description: 'Activation is required before partner resources are available.' },
  { id: 'disabled-partner', label: 'Disabled partner', group: 'Partner', path: '/portal/profile', partner: ['promoter'], partnerState: 'disabled', description: 'Partner access must be denied; the customer account remains.' },
  { id: 'team', label: 'Team', group: 'Staff', path: '/team/calendar', teamRole: 'team', description: 'Normal staff workspace, not owner-only tools.' },
  { id: 'front-desk', label: 'Front Desk', group: 'Staff', path: '/capacity/front-desk', teamRole: 'front_desk', description: 'Restricted attended-entry workspace only.' },
  { id: 'calendar-viewer', label: 'Calendar Viewer', group: 'Staff', path: '/team/calendar', teamRole: 'calendar_viewer', description: 'Restricted calendar access, not the full team workspace.' },
  { id: 'admin', label: 'Admin', group: 'Staff', path: '/bananas', teamRole: 'admin', description: 'Administrator permissions without your owner identity.' },
  { id: 'member-artist', label: 'Member + Artist', group: 'Combined', path: '/member', plan: 'cowork', partner: ['artist'], description: 'Builder membership and an independent artist profile under one login.' },
  { id: 'trial-promoter', label: 'Trial + Promoter', group: 'Combined', path: '/account/profile', trial: 'active', partner: ['promoter'], description: 'Active trial and promoter capability under one login.' },
  { id: 'team-partner', label: 'Team + Partner', group: 'Combined', path: '/team/calendar', teamRole: 'team', partner: ['dj'], description: 'Staff workspace plus a separately assigned partner profile.' },
]);
export function viewPersona(id) {
  return VIEW_PERSONAS.find((persona) => persona.id === id) || null;
}
export function personaEmail(id) {
  if (!viewPersona(id)) throw new Error('Unknown preview persona');
  return `view-${id}@preview.sdgatx.invalid`;
}
