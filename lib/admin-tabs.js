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

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
// Tile definitions live here rather than in the dashboard component because the
// persistent shell needs them too: it maps the current pathname back to a
// section so the sidebar can highlight where you are. If the two lists could
// drift, opening /bananas/contacts would highlight nothing.
//
// `countKey` names a key on the `counts` object built in app/bananas/page.js
// (and the layout) instead of embedding a number, so this file stays free of
// data fetching.
//
// The eyebrow (`action`) answers exactly one question - what kind of work is
// this? See ADMIN_TILE_ACTIONS. Permissions live on `restricted` and status on
// `status` so the three signals never compete for the same slot.
export const ADMIN_TILE_ACTIONS = ['REVIEW', 'MANAGE', 'VIEW', 'TRACK'];

export const ADMIN_TILES = {
  team: [
    { href: '/team/progress', action: 'TRACK', title: 'Tasks', sub: 'Assigned work by department' },
    { href: '/team/calendar', action: 'VIEW', title: 'Team Calendar', sub: 'Shifts and internal dates', restricted: 'team' },
    { href: '/team/chat', action: 'VIEW', title: 'Team Chat', sub: 'Internal channels', countKey: 'unreadChat', status: 'NEW' },
  ],
  memberships: [
    { href: '/bananas/applications', action: 'REVIEW', title: 'Applications', sub: 'Awaiting your decision', countKey: 'applications' },
    { href: '/bananas/members', action: 'MANAGE', title: 'Members', sub: 'Active roster and billing', countKey: 'pastDueMembers' },
  ],
  people: [
    { href: '/bananas/contacts', action: 'VIEW', title: 'Contacts', sub: 'Everyone in the database' },
    { href: '/bananas/collaborations', action: 'REVIEW', title: 'Collaborations', sub: 'Inbound partnership requests', countKey: 'collaborations' },
    { href: '/bananas/signups', action: 'VIEW', title: 'Signups', sub: 'Mailing list additions', countKey: 'newSignups' },
    { href: '/bananas/guest-list', action: 'MANAGE', title: 'Guest List', sub: 'Per-event entry grants' },
    { href: '/bananas/pay-requests', action: 'REVIEW', title: 'Artist Pay', sub: 'Payout requests', countKey: 'pendingPayRequests' },
  ],
  rentals: [
    { href: '/bananas/venue-inquiries', action: 'REVIEW', title: 'Venue Inquiries', sub: 'Full-venue requests', countKey: 'venueInquiries' },
    { href: '/bananas/micro-parties', action: 'REVIEW', title: 'Micro Parties', sub: 'Small private bookings', countKey: 'microParties' },
    { href: '/bananas/studio-bookings', action: 'MANAGE', title: 'Studio Bookings', sub: 'Hourly studio time', countKey: 'upcomingBookings' },
  ],
  documents: [
    { href: '/bananas/documents', action: 'VIEW', title: 'Documents', sub: 'Signed and internal files', restricted: 'team' },
  ],
  analytics: [
    { href: '/bananas/financials', action: 'VIEW', title: 'Financials', sub: 'Revenue and expenses', restricted: 'owner' },
    { href: '/bananas/cash-flow', action: 'VIEW', title: 'Cash Flow', sub: 'Money in and out', restricted: 'owner' },
    { href: '/capacity', action: 'VIEW', title: 'Capacity Counter', sub: 'Real-time headcount', status: 'LIVE' },
  ],
  settings: [
    { href: '/bananas/settings', action: 'MANAGE', title: 'Settings', sub: 'Venue configuration' },
    { href: '/bananas/studio-settings', action: 'MANAGE', title: 'Studio Settings', sub: 'Rates and hours', restricted: 'owner' },
    { href: '/bananas/team', action: 'MANAGE', title: 'Team Members', sub: 'Logins and roles', restricted: 'owner' },
    { href: '/bananas/security', action: 'MANAGE', title: 'Security / MFA', sub: 'Your sign-in protection' },
  ],
};

export function adminTilesFor(tabId) {
  return ADMIN_TILES[tabId] || [];
}

// Sum of the counts on a section's own tiles, so the number beside a section in
// the sidebar always matches what you find after opening it.
export function adminTabBadge(tabId, counts = {}) {
  return adminTilesFor(tabId).reduce(
    (sum, tile) => sum + (tile.countKey ? counts[tile.countKey] || 0 : 0),
    0
  );
}

export function adminTabBadges(counts = {}) {
  return Object.fromEntries(
    ADMIN_TABS.map((tab) => [tab.id, adminTabBadge(tab.id, counts)])
  );
}

// Every tile, flattened, each carrying the id of the section it belongs to.
// Sorted longest href first so nested routes resolve to the most specific tile
// (/bananas/documents/templates must not stop at /bananas/documents).
export function allAdminTiles() {
  return ADMIN_TABS.flatMap((tab) =>
    adminTilesFor(tab.id).map((tile) => ({ ...tile, tabId: tab.id }))
  ).sort((a, b) => b.href.length - a.href.length);
}

function pathMatchesHref(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The tile whose route the given pathname sits under, or null on the dashboard
// root and on any route with no tile (a bare /bananas/calendar, say).
export function tileForPath(pathname) {
  if (!pathname) return null;
  const clean = pathname.replace(/\/+$/, '') || '/';
  return allAdminTiles().find((tile) => pathMatchesHref(clean, tile.href)) || null;
}

// Which sidebar section should be highlighted for a given pathname. Returns
// null for the dashboard root so no section is marked active while the tile
// grid itself is showing.
export function tabForPath(pathname) {
  const tile = tileForPath(pathname);
  return tile ? tile.tabId : null;
}
