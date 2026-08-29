// Single source of truth for the /bananas admin dashboard navigation.
//
// This lives in lib/ (not inside the client component) because BOTH sides need
// it: the server page validates the ?tab= query param before handing an initial
// tab to the client, and the client renders the sidebar from the same list. If
// the two ever disagreed you'd get a tab in the URL that renders nothing.
//
// Sections are grouped so the sidebar can teach the structure passively rather
// than presenting seven flat, equal-weight destinations.

export const ADMIN_TAB_GROUPS = ['OPERATIONS', 'MONEY', 'ADMIN'];

export const DEFAULT_ADMIN_TAB = 'team';

// `description` is shown under the section heading. Keep it to one short line —
// it's orientation for a staff member who just landed, not documentation.
export const ADMIN_TABS = [
  {
    id: 'team',
    label: 'Team',
    group: 'OPERATIONS',
    ownerOnly: false,
    description: 'Day-to-day staff workflows.',
  },
  {
    id: 'memberships',
    label: 'Memberships',
    group: 'OPERATIONS',
    ownerOnly: false,
    description: 'The membership pipeline — applications in, members managed.',
  },
  {
    id: 'people',
    label: 'People',
    group: 'OPERATIONS',
    ownerOnly: false,
    description: 'Person records that are not membership decisions.',
  },
  {
    id: 'rentals',
    label: 'Rentals',
    group: 'OPERATIONS',
    ownerOnly: false,
    description: 'Renting out the space.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    group: 'MONEY',
    ownerOnly: true,
    description: 'Owner-only reporting.',
  },
  {
    id: 'documents',
    label: 'Documents',
    group: 'ADMIN',
    ownerOnly: false,
    description: 'Contracts, SOPs, and internal files.',
  },
  {
    id: 'settings',
    label: 'Settings',
    group: 'ADMIN',
    ownerOnly: true,
    description: 'Configuration and access control.',
  },
];

export function isAdminTab(id) {
  return ADMIN_TABS.some((t) => t.id === id);
}

// Tabs the signed-in user is actually allowed to see.
export function visibleAdminTabs(isOwner) {
  return ADMIN_TABS.filter((t) => !t.ownerOnly || isOwner);
}

// Groups that still have at least one visible tab, in ADMIN_TAB_GROUPS order.
// Used so a non-owner never sees an empty "MONEY" heading with nothing under it.
export function visibleAdminTabGroups(isOwner) {
  const visible = visibleAdminTabs(isOwner);
  return ADMIN_TAB_GROUPS
    .map((group) => ({ group, tabs: visible.filter((t) => t.group === group) }))
    .filter((g) => g.tabs.length > 0);
}

// Resolves whatever arrived in ?tab= to a tab the caller may actually open.
//
// Falls back to DEFAULT_ADMIN_TAB for: missing param, unknown id, and — the
// case that matters for security-by-obscurity hygiene — an owner-only tab
// requested by a non-owner. Note this is presentation only; the owner-only
// PAGES behind those tiles enforce access themselves via ownerPageGate().
export function resolveAdminTab(requested, { isOwner = false } = {}) {
  const id = Array.isArray(requested) ? requested[0] : requested;
  const match = ADMIN_TABS.find((t) => t.id === id);
  if (!match) return DEFAULT_ADMIN_TAB;
  if (match.ownerOnly && !isOwner) return DEFAULT_ADMIN_TAB;
  return match.id;
}

export function adminTabById(id) {
  return ADMIN_TABS.find((t) => t.id === id) || null;
}
