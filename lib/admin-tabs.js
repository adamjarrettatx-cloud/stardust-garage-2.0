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
  // Events is a list-backed section: it has no tiles because the section IS the
  // Events Calendar and the events list under it. `rendersOwnContent` tells the
  // tile-grid contract (and its test) that an empty tile set is deliberate
  // here — app/bananas/page.js renders both into this section instead.
  //
  // `countKeys` is how a list-backed section still gets a sidebar badge. Guest
  // List and Artist Pay used to be People tiles, which is where their counts
  // came from; now that both are only ever opened from a specific event row,
  // the pending-pay-request badge belongs beside Events instead.
  {
    id: 'events',
    label: 'Events',
    group: 'OPERATIONS',
    ownerOnly: false,
    rendersOwnContent: true,
    countKeys: ['pendingPayRequests'],
    // The calendar renders with no header of its own (it would duplicate this
    // one), so the one hint it needs — how to add to it — lives here.
    description: 'The programming calendar · double-click a day to add · every event upcoming and past below.',
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
  // Events intentionally has no tiles — see `rendersOwnContent` above.
  events: [],
  // The calendar used to be a third tile here, under a name that implied it was
  // about who is working when. It never was — it is the business's programming
  // calendar, so it now renders at the top of the Events section as the Events
  // Calendar rather than being something you navigate to out of Team. /team/calendar still
  // exists for non-admin team members (who have no admin dashboard) and sends
  // an admin on to Events.
  team: [
    { href: '/team/progress', action: 'TRACK', title: 'Tasks', sub: 'Assigned work by department' },
    { href: '/team/chat', action: 'VIEW', title: 'Team Chat', sub: 'Internal channels', countKey: 'unreadChat', status: 'NEW' },
  ],
  memberships: [
    { href: '/bananas/applications', action: 'REVIEW', title: 'Applications', sub: 'Awaiting your decision', countKey: 'applications' },
    { href: '/bananas/members', action: 'MANAGE', title: 'Members', sub: 'Active roster and billing', countKey: 'pastDueMembers' },
    // Trial passes are inventory, not queued work: an active pass is a
    // countdown running somewhere out in the wild, not a decision waiting
    // on you. So the tile deliberately has no `countKey` — the badge stays
    // cold and the sub-line carries the meaning. Applications is where the
    // "do something about this" energy lives once they convert.
    { href: '/team/trial-pass/analytics', action: 'VIEW', title: 'Trial Passes', sub: 'Funnel, reminders and expirations' },
    { href: '/team/trial-pass/manual', action: 'MANAGE', title: 'Issue Trial Pass', sub: 'Manual front-desk override', restricted: 'team' },
  ],
  // Guest List and Artist Pay deliberately have no tile here. Both are
  // per-event work, and a tile could only ever open the all-events summary,
  // leaving you to find the event again. They are reached from the event's own
  // row in the Events list instead — see ADMIN_SECTION_ROUTES.
  people: [
    { href: '/bananas/contacts', action: 'VIEW', title: 'Contacts', sub: 'Everyone in the database' },
    { href: '/bananas/collaborations', action: 'REVIEW', title: 'Collaborations', sub: 'Inbound partnership requests', countKey: 'collaborations' },
    { href: '/bananas/signups', action: 'VIEW', title: 'Signups', sub: 'Mailing list additions', countKey: 'newSignups' },
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
// the sidebar always matches what you find after opening it. A list-backed
// section has no tiles to carry counts, so it may name them directly with
// `countKeys` on the tab.
export function adminTabBadge(tabId, counts = {}) {
  const fromTiles = adminTilesFor(tabId).reduce(
    (sum, tile) => sum + (tile.countKey ? counts[tile.countKey] || 0 : 0),
    0
  );
  const fromTab = (adminTabById(tabId)?.countKeys || []).reduce(
    (sum, key) => sum + (counts[key] || 0),
    0
  );
  return fromTiles + fromTab;
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
// Routes that own a tile but must not be wrapped in the admin shell yet.
//
// The trial pass surfaces gained tiles in the Memberships tab (#115) at the
// same time the shell learned to wrap tiled /team routes (#116). Those two
// changes were developed in parallel and are individually correct, but together
// they put an unthemed page inside the shell: both trial pass pages render their
// own AuthenticatedPageHeader and their own <main className="min-h-screen">
// with a hardcoded background of #0a0a0a, and neither reads the authenticated
// theme tokens at all. Wrapped, an admin got two stacked headers, a nested
// <main>, and a full-bleed black panel sitting inside the light-mode shell.
//
// Making them shell-ready means porting ~765 lines of hardcoded dark styling
// onto the theme tokens, which is a change in its own right. Until then they
// open as standalone pages, exactly as they did before they had tiles. The
// tiles still work — they just navigate away rather than opening in place.
export const SHELL_EXEMPT_PREFIXES = ['/team/trial-pass'];

// True when a path owns a tile but is not ready to render inside the shell.
export function isShellExempt(pathname) {
  if (!pathname) return false;
  return SHELL_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function tileForPath(pathname) {
  if (!pathname) return null;
  const clean = pathname.replace(/\/+$/, '') || '/';
  return allAdminTiles().find((tile) => pathMatchesHref(clean, tile.href)) || null;
}

// Routes that belong to a section without going through a tile. The event
// editor, the new-event chooser and event financials all live under the Events
// section, which is list-backed rather than tile-backed, so without this the
// sidebar would highlight nothing while you are inside an event.
//
// Guest List and Artist Pay are here for the same reason plus one more: they
// are opened from a single event's row, so the trail out has to lead back to
// Events. `title` is what the breadcrumb calls them — a section route without
// one contributes highlighting only (the event routes already render their own
// titles).
export const ADMIN_SECTION_ROUTES = [
  { prefix: '/bananas/events', tabId: 'events' },
  // No tile, and no page of its own for an admin either — /team/calendar
  // redirects them into this section. Listed so any admin link that still
  // points at the old path highlights where it is taking them.
  { prefix: '/team/calendar', tabId: 'events' },
  { prefix: '/bananas/guest-list', tabId: 'events', title: 'Guest List' },
  { prefix: '/bananas/pay-requests', tabId: 'events', title: 'Artist Pay' },
];

// Which sidebar section should be highlighted for a given pathname. Returns
// null for the dashboard root so no section is marked active while the tile
// grid itself is showing.
export function tabForPath(pathname) {
  const tile = tileForPath(pathname);
  if (tile) return tile.tabId;
  if (!pathname) return null;
  const clean = pathname.replace(/\/+$/, '') || '/';
  const section = ADMIN_SECTION_ROUTES.find((r) => pathMatchesHref(clean, r.prefix));
  return section ? section.tabId : null;
}

// What the shell breadcrumb should say for a pathname: the tile it sits under,
// or a named section route for the tile-less pages. Returning null means no
// trail at all — the dashboard root and anything outside a section.
export function crumbForPath(pathname) {
  const tile = tileForPath(pathname);
  if (tile) return { title: tile.title, tabId: tile.tabId };
  if (!pathname) return null;
  const clean = pathname.replace(/\/+$/, '') || '/';
  const section = ADMIN_SECTION_ROUTES.find(
    (r) => r.title && pathMatchesHref(clean, r.prefix)
  );
  return section ? { title: section.title, tabId: section.tabId } : null;
}
