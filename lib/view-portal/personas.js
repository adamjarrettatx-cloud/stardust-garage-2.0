// Fixed synthetic identities, never arbitrary production user impersonation.
export const VIEW_PERSONAS = Object.freeze([
  { id: 'free', label: 'Free account', group: 'Customer', path: '/account/profile', description: 'Own profile and tickets. No membership or staff privileges.' },
  { id: 'trial', label: 'Active trial', group: 'Customer', path: '/account/profile', trial: 'active', description: 'An active Trial SDG Pass with its existing benefits.' },
  { id: 'expired-trial', label: 'Expired trial', group: 'Customer', path: '/account/profile', trial: 'expired', description: 'Customer access remains; trial benefits have expired.' },
  { id: 'weekender', label: 'The Weekender', group: 'Customer', path: '/member', plan: 'weekender', description: 'Active Weekender membership with its actual tier rules.' },
  { id: 'builder', label: 'The Builder', group: 'Customer', path: '/member', plan: 'cowork', description: 'Active Builder membership with its actual tier rules.' },
  { id: 'insider', label: 'The Insider', group: 'Customer', path: '/member', plan: 'iykyk', description: 'Active Insider membership with its actual tier rules.' },
  { id: 'artist', label: 'Artist / DJ', group: 'Persons', path: '/portal/profile', partner: ['dj', 'artist'], description: 'Person with Artist access: own profile, assigned guest lists, bookings and pay requests.' },
  { id: 'promoter', label: 'Promoter', group: 'Persons', path: '/portal/profile', partner: ['promoter'], description: 'Person with Promoter access: own profile, assigned guest lists and contracts.' },
  { id: 'collective', label: 'Organization · Collective', group: 'Organizations', viewType: 'organization', scenario: 'Collective', path: '/portal/profile', partner: ['collective'], description: 'Organization represented by an authorized partner account, with its assigned allocations and agreements.' },
  { id: 'vendor', label: 'Vendor', group: 'Vendor', path: '/portal/profile', partner: ['vendor'], description: 'Vendor profile and assigned agreements, without staff access.' },
  { id: 'organizer', label: 'Organization · Event Organizer', group: 'Organizations', viewType: 'organization', scenario: 'Event Organizer', path: '/portal/profile', partner: ['event_organizer'], description: 'Organization represented by an authorized partner account, with its assigned agreements.' },
  { id: 'invited-partner', label: 'Invitation pending', group: 'Access states', path: '/portal/activate', partner: ['promoter'], partnerState: 'invited', description: 'Activation is required before partner resources are available.' },
  { id: 'disabled-partner', label: 'Disabled partner', group: 'Access states', path: '/portal/profile', partner: ['promoter'], partnerState: 'disabled', description: 'Partner access must be denied; the customer account remains.' },
  { id: 'team', label: 'Team', group: 'Staff', path: '/team/calendar', teamRole: 'team', description: 'Normal staff workspace, not owner-only tools.' },
  { id: 'front-desk', label: 'Front Desk', group: 'Staff', path: '/capacity/front-desk', teamRole: 'front_desk', description: 'Restricted attended-entry workspace only.' },
  { id: 'calendar-viewer', label: 'Calendar Viewer', group: 'Staff', path: '/team/calendar', teamRole: 'calendar_viewer', description: 'Restricted calendar access, not the full team workspace.' },
  { id: 'admin', label: 'Admin', group: 'Staff', path: '/bananas', teamRole: 'admin', description: 'Administrator permissions without your owner identity.' },
  { id: 'member-artist', label: 'Member + Artist', group: 'Combined', path: '/member', plan: 'cowork', partner: ['artist'], description: 'Builder membership and an independent artist profile under one login.' },
  { id: 'trial-promoter', label: 'Trial + Promoter', group: 'Combined', path: '/account/profile', trial: 'active', partner: ['promoter'], description: 'Active trial and promoter capability under one login.' },
  { id: 'team-partner', label: 'Team + Partner', group: 'Combined', path: '/team/calendar', teamRole: 'team', partner: ['dj'], description: 'Staff workspace plus a separately assigned partner profile.' },
]);

export const VIEW_GROUP_DESCRIPTIONS = Object.freeze({
  Persons: 'Artists and Promoters are roles under Persons, not separate contact categories.',
  Organizations: 'Collectives and Event Organizers share the Organization profile type. A main contact can be linked from Contacts or an existing account, or created as a person contact. That link alone grants no login access or signing authority.',
  'Access states': 'Test invitation and access status separately from profile type.',
});

// Presentation grouping only. Each scenario retains its existing fixed identity,
// route and permissions; no synthetic users are created or reassigned here.
export function viewOptions(personas = VIEW_PERSONAS) {
  const options = new Map();
  for (const persona of personas) {
    const id = persona.viewType || persona.id;
    if (!options.has(id)) options.set(id, {
      id, group: persona.group,
      label: persona.viewType === 'organization' ? 'Organization' : persona.label,
      description: persona.viewType === 'organization'
        ? 'One organization profile type. Choose a Collective or Event Organizer test scenario.'
        : persona.description,
      scenarios: [],
    });
    options.get(id).scenarios.push(persona);
  }
  return Array.from(options.values());
}
export function viewPersona(id) {
  return VIEW_PERSONAS.find((persona) => persona.id === id) || null;
}
export function personaEmail(id) {
  if (!viewPersona(id)) throw new Error('Unknown preview persona');
  return `view-${id}@preview.sdgatx.invalid`;
}
