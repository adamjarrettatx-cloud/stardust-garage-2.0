import { roleLabel } from './role-label.js';
import { isRestrictedStaffRole, partnerState, partnerViews } from './partner-access.js';
import { isEntitledMember } from './tickets/entitlement-lookup.js';
import { isPassLive, effectiveExpiry } from './trial-pass.js';
import { profileMembershipAction } from './profile-capabilities.js';

const PLANS = { weekender: 'Weekender', cowork: 'Builder', iykyk: 'Insider' };
const STAFF = { admin: 'Administrator', team: 'Team', front_desk: 'Front desk', calendar_viewer: 'Calendar viewer' };

// Presentation only. Route gates and RLS remain authoritative.
export function buildAccountProfile({ member = null, passes = [], partner = null, teamRole = null, resources = {}, now = new Date() } = {}) {
  const memberActive = isEntitledMember(member);
  const pass = passes.find((item) => isPassLive(item, now)) || passes[0];
  const trialLive = isPassLive(pass, now);
  const membershipLabel = memberActive ? `${PLANS[member.subscription_plan] || 'SDG'} member`
    : trialLive ? 'Trial account' : 'Free account';
  const state = partnerState(partner);
  const partnerActive = state === 'active' && !isRestrictedStaffRole(teamRole);
  const workspaces = [];
  const membershipAction = profileMembershipAction({ member, passes });
  if (membershipAction && !isRestrictedStaffRole(teamRole)) workspaces.push(membershipAction);
  if (teamRole === 'admin') workspaces.push({ href: '/bananas', label: 'Administration' });
  if (['admin', 'team', 'calendar_viewer'].includes(teamRole)) workspaces.push({ href: '/team/calendar', label: 'Team calendar' });
  if (['admin', 'team', 'front_desk'].includes(teamRole)) workspaces.push({ href: '/capacity/front-desk', label: 'Front desk' });
  if (partnerActive) {
    const views = partnerViews(partner.contact_type, resources);
    if (views.guestList) workspaces.push({ href: '/portal/guest-list', label: 'Guest list' });
    if (views.pay) workspaces.push({ href: '/portal/pay', label: 'Bookings & pay' });
    if (views.contracts) workspaces.push({ href: '/portal/contracts', label: 'Contracts' });
    if (views.events) workspaces.push({ href: '/portal/events', label: 'My Events' });
  }
  if (state === 'invited' && !isRestrictedStaffRole(teamRole)) workspaces.push({ href: '/portal/activate', label: 'Complete partner setup' });
  const access = [{
    label: member ? 'Membership' : pass ? 'Trial pass' : 'Account type',
    value: memberActive ? membershipLabel : trialLive ? 'Trial pass available' : member ? 'Membership inactive' : pass ? 'Trial pass expired' : 'No paid membership',
    detail: memberActive ? 'Your current membership benefits apply.' : trialLive
      ? `Valid until ${effectiveExpiry(pass).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })}.${pass.activated_at ? '' : ' The trial period starts at your first check-in.'}`
      : 'Your account and purchased tickets remain available.',
  }];
  if (partner) access.push({
    label: 'Partner relationship',
    value: `${roleLabel(partner.contact_type)} · ${state === 'active' ? (partnerActive ? 'Active' : 'Workspace restricted') : state === 'invited' ? 'Setup required' : 'Disabled'}`,
    detail: partner.contact_display_name || 'Managed by Stardust Garage.',
  });
  if (STAFF[teamRole]) access.push({
    label: 'Team access', value: STAFF[teamRole],
    detail: isRestrictedStaffRole(teamRole) ? 'Limited to your assigned workspace. No broader team or administrator access.' : 'Work tools are separate from membership benefits.',
  });
  return {
    label: [membershipLabel, partnerActive ? roleLabel(partner.contact_type) : null, STAFF[teamRole]].filter(Boolean).join(' · '),
    workspaces, access, partnerActive, membershipAction,
  };
}
