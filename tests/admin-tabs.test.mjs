import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_TABS,
  ADMIN_TAB_GROUPS,
  DEFAULT_ADMIN_TAB,
  isAdminTab,
  visibleAdminTabs,
  visibleAdminTabGroups,
  resolveAdminTab,
  resolveRootAdminTab,
  adminTabHref,
  adminTabById,
  ADMIN_TILES,
  ADMIN_TILE_ACTIONS,
  adminTilesFor,
  allAdminTiles,
  adminTabBadge,
  tabForPath,
  isShellExempt,
  tileForPath,
  crumbForPath,
} from '../lib/admin-tabs.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLIENT = fs.readFileSync(
  path.join(REPO_ROOT, 'app/bananas/AdminDashboardClient.js'),
  'utf8'
);
const PAGE = fs.readFileSync(path.join(REPO_ROOT, 'app/bananas/page.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(REPO_ROOT, 'app/bananas/AdminShell.js'), 'utf8');
const TEAM_LAYOUT = fs.readFileSync(path.join(REPO_ROOT, 'app/team/layout.js'), 'utf8');
const COUNTS = fs.readFileSync(path.join(REPO_ROOT, 'lib/admin-counts.js'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const LAYOUT = fs.readFileSync(path.join(REPO_ROOT, 'app/bananas/layout.js'), 'utf8');

// --- Tab definitions --------------------------------------------------------

test('every tab has a unique id, a label, a description and a known group', () => {
  const ids = new Set();
  for (const tab of ADMIN_TABS) {
    assert.ok(tab.id, 'tab is missing an id');
    assert.ok(!ids.has(tab.id), `duplicate tab id: ${tab.id}`);
    ids.add(tab.id);
    assert.ok(tab.label, `${tab.id} is missing a label`);
    assert.ok(tab.description, `${tab.id} is missing a description`);
    assert.ok(
      ADMIN_TAB_GROUPS.includes(tab.group),
      `${tab.id} has unknown group ${tab.group}`
    );
    assert.equal(typeof tab.ownerOnly, 'boolean', `${tab.id}.ownerOnly must be boolean`);
  }
});

test('the default tab exists and is never owner-only', () => {
  const fallback = adminTabById(DEFAULT_ADMIN_TAB);
  assert.ok(fallback, 'DEFAULT_ADMIN_TAB does not name a real tab');
  // If the fallback were owner-only, resolveAdminTab would hand a non-owner a
  // tab they cannot see and the dashboard would render an empty panel.
  assert.equal(fallback.ownerOnly, false);
});

test('every group listed in ADMIN_TAB_GROUPS is actually used', () => {
  for (const group of ADMIN_TAB_GROUPS) {
    assert.ok(
      ADMIN_TABS.some((t) => t.group === group),
      `group ${group} has no tabs`
    );
  }
});

// --- Visibility -------------------------------------------------------------

test('non-owners do not see owner-only tabs', () => {
  const forStaff = visibleAdminTabs(false).map((t) => t.id);
  assert.ok(forStaff.includes('tasks'));
  assert.ok(!forStaff.includes('analytics'), 'staff must not see Analytics');
  assert.ok(!forStaff.includes('settings'), 'staff must not see Settings');
});

test('owners see every tab', () => {
  assert.equal(visibleAdminTabs(true).length, ADMIN_TABS.length);
});

test('groups left empty by permissions are not rendered', () => {
  // MONEY holds only owner-only tabs, so a staff member must not get a bare
  // "MONEY" heading with nothing beneath it.
  const staffGroups = visibleAdminTabGroups(false).map((g) => g.group);
  assert.ok(!staffGroups.includes('MONEY'));
  for (const { tabs } of visibleAdminTabGroups(false)) {
    assert.ok(tabs.length > 0);
  }
  assert.deepEqual(visibleAdminTabGroups(true).map((g) => g.group), ADMIN_TAB_GROUPS);
});

test('visible groups preserve ADMIN_TAB_GROUPS order', () => {
  const order = visibleAdminTabGroups(true).map((g) => g.group);
  assert.deepEqual(order, ADMIN_TAB_GROUPS);
});

// --- URL resolution ---------------------------------------------------------

test('a valid tab id in the URL is honoured', () => {
  assert.equal(resolveAdminTab('people', { isOwner: false }), 'people');
  assert.equal(resolveAdminTab('rentals', { isOwner: false }), 'rentals');
});

test('a missing or junk tab param falls back to the default', () => {
  for (const input of [undefined, null, '', 'nope', 'POTENTIAL-MEMBERS', 0, {}]) {
    assert.equal(resolveAdminTab(input, { isOwner: true }), DEFAULT_ADMIN_TAB);
  }
});

test('repeated ?tab= params take the first value', () => {
  // URLSearchParams-style duplicates arrive as an array from Next.
  assert.equal(resolveAdminTab(['people', 'settings'], { isOwner: false }), 'people');
});

test('tab ids are case-sensitive', () => {
  assert.equal(resolveAdminTab('People', { isOwner: true }), DEFAULT_ADMIN_TAB);
});

test('a non-owner deep-linking an owner-only tab lands on the default', () => {
  assert.equal(resolveAdminTab('analytics', { isOwner: false }), DEFAULT_ADMIN_TAB);
  assert.equal(resolveAdminTab('settings', { isOwner: false }), DEFAULT_ADMIN_TAB);
  // ...but the owner gets what they asked for.
  assert.equal(resolveAdminTab('analytics', { isOwner: true }), 'analytics');
  assert.equal(resolveAdminTab('settings', { isOwner: true }), 'settings');
});

test('resolveAdminTab defaults to non-owner when no options are passed', () => {
  assert.equal(resolveAdminTab('settings'), DEFAULT_ADMIN_TAB);
});

test('isAdminTab recognises exactly the defined ids', () => {
  for (const tab of ADMIN_TABS) assert.ok(isAdminTab(tab.id));
  assert.ok(!isAdminTab('community'));
  assert.ok(!isAdminTab('studio'));
  assert.ok(!isAdminTab('potential-members'));
});

// --- Retired tabs stay retired ---------------------------------------------

test('tabs removed by owner decision are not reintroduced', () => {
  // Community was split into Memberships + People; Studio was folded into
  // Rentals and Settings; Potential Members was deleted outright.
  for (const dead of ['community', 'studio', 'potential-members']) {
    assert.equal(adminTabById(dead), null, `${dead} tab is back`);
  }
});

// --- Client/definition agreement -------------------------------------------

test('every defined tab has tiles unless it renders its own content', () => {
  // A tab with no tiles would render a heading over an empty grid — unless it
  // is list-backed (Events), where the section IS the content and the empty
  // tile set is deliberate.
  for (const tab of ADMIN_TABS) {
    const tiles = adminTilesFor(tab.id);
    if (tab.rendersOwnContent) {
      assert.equal(tiles.length, 0, `${tab.id} renders its own content, so it should have no tiles`);
      continue;
    }
    assert.ok(tiles.length > 0, `no tiles defined for the "${tab.id}" tab`);
  }
  // And no orphan tile groups for tabs that no longer exist.
  for (const id of Object.keys(ADMIN_TILES)) {
    assert.ok(adminTabById(id), `tiles defined for unknown tab "${id}"`);
  }
});

test('every tile has a route, an action and a title', () => {
  for (const tile of allAdminTiles()) {
    assert.ok(tile.href?.startsWith('/'), `tile "${tile.title}" has a bad href`);
    assert.ok(tile.action, `tile "${tile.title}" is missing an action`);
    assert.ok(tile.title, `a tile in "${tile.tabId}" is missing a title`);
  }
});

test('tile routes are unique', () => {
  const seen = new Set();
  for (const tile of allAdminTiles()) {
    assert.ok(!seen.has(tile.href), `duplicate tile route ${tile.href}`);
    seen.add(tile.href);
  }
});

test('every tile eyebrow comes from the fixed action vocabulary', () => {
  // The old labels mixed actions with permissions (TEAM ONLY, OWNER ONLY,
  // PRIVATE) and status (NEW, LIVE), which gave staff no learnable pattern.
  // Permissions now live on `restricted` and status on `status`.
  const actions = allAdminTiles().map((tile) => tile.action);
  assert.ok(actions.length >= 15, 'expected the full tile set to declare actions');
  for (const action of actions) {
    assert.ok(
      ADMIN_TILE_ACTIONS.includes(action),
      `"${action}" is not part of the action vocabulary`
    );
  }
});

test('permission wording never leaks back into an eyebrow', () => {
  const actions = new Set(allAdminTiles().map((tile) => tile.action));
  for (const banned of ['TEAM ONLY', 'OWNER ONLY', 'PRIVATE', 'DIRECTORY', 'REPORTING', 'ACCOUNT']) {
    assert.ok(!actions.has(banned), `"${banned}" is being used as a tile action again`);
  }
});

test('restriction markers use a defined label', () => {
  const marks = allAdminTiles()
    .map((tile) => tile.restricted)
    .filter(Boolean);
  assert.ok(marks.length > 0, 'no restricted tiles found');
  for (const mark of marks) {
    assert.ok(['owner', 'team'].includes(mark), `unknown restriction "${mark}"`);
  }
});

// --- URL-addressable navigation --------------------------------------------

test('the shell reads the section from the URL', () => {
  assert.match(SHELL, /useSearchParams/, 'the shell must read ?tab= from the URL');
  assert.match(SHELL, /resolveRootAdminTab\(searchParams\?\.get\('tab'\)/);
});

test('selecting a section writes it to the URL', () => {
  assert.match(SHELL, /history\.pushState/, 'section changes must update the URL');
  assert.match(SHELL, /searchParams\.set\('tab'/);
});

test('the shell no longer hardcodes its starting section', () => {
  // Regression guard: an early version did useState('team'), which is what made
  // the dashboard non-addressable in the first place.
  assert.ok(
    !/useState\('team'\)/.test(SHELL),
    'starting section is hardcoded again instead of read from the URL'
  );
});

// --- Legibility -------------------------------------------------------------

test('no text in the dashboard is set below the 10.5px legibility floor', () => {
  // Owner feedback 2026-08-29: the first pass of this layout read too small.
  // Everything was raised a step. This guards the floor so a later tweak cannot
  // quietly shrink it back — the only sizes allowed near the bottom are all-caps
  // micro-labels, which read larger than their nominal size.
  const sizes = [...`${CLIENT}\n${SHELL}`.matchAll(/text-\[([\d.]+)px\]/g)].map((m) =>
    Number(m[1])
  );
  assert.ok(sizes.length > 0, 'no explicit text sizes found — did the markup change?');
  for (const size of sizes) {
    assert.ok(size >= 10.5, `found ${size}px text, below the 10.5px floor`);
  }
});

test('the type scale keeps a readable hierarchy', () => {
  // Section heading > tile title > tile subtitle. If these collapse into each
  // other the panel stops being scannable.
  const size = (re) => {
    const m = CLIENT.match(re);
    assert.ok(m, `could not locate type size for ${re}`);
    return Number(m[1]);
  };
  const heading = size(/text-\[([\d.]+)px\] font-bold -tracking-\[0\.02em\] mb-\[4px\]/);
  const tileTitle = size(/text-\[([\d.]+)px\] font-bold -tracking-\[0\.015em\]"/);
  const tileSub = size(/text-\[([\d.]+)px\] mt-\[6px\]/);
  assert.ok(heading > tileTitle, `heading ${heading}px must exceed tile title ${tileTitle}px`);
  assert.ok(tileTitle > tileSub, `tile title ${tileTitle}px must exceed subtitle ${tileSub}px`);
  // Body copy should stay in comfortable reading range.
  assert.ok(tileSub >= 13, `tile subtitle ${tileSub}px is too small for body copy`);
});

// --- Owner-only pages still gate themselves --------------------------------

test('trial pass surfaces are reachable from the Memberships tab', () => {
  // The two trial-pass surfaces (/team/trial-pass/analytics and
  // /team/trial-pass/manual) existed as pages long before the sidebar linked
  // them. This test locks them into the Memberships tab so a future refactor
  // can't quietly orphan them again.
  const memberships = ADMIN_TILES.memberships;
  const hrefs = memberships.map((t) => t.href);
  assert.ok(hrefs.includes('/team/trial-pass/analytics'), 'Trial Passes analytics tile missing from Memberships');
  assert.ok(hrefs.includes('/team/trial-pass/manual'), 'Issue Trial Pass tile missing from Memberships');
  const analytics = memberships.find((t) => t.href === '/team/trial-pass/analytics');
  const manual = memberships.find((t) => t.href === '/team/trial-pass/manual');
  assert.equal(analytics.title, 'Trial Passes');
  assert.equal(manual.title, 'Issue Trial Pass');
  assert.equal(manual.restricted, 'team', 'manual issuance page is team-only, tile should show the lock');
  // Intentionally no countKey on the analytics tile: an active trial pass
  // is inventory, not queued work. If someone adds a countKey here without
  // rethinking that, this catches it.
  assert.ok(!analytics.countKey, 'Trial Passes tile should not carry a queued-work badge');
});

test('owner-only tabs point at pages that enforce access server-side', () => {
  // Hiding a tab is presentation, not security. Every page behind an owner-only
  // tab must gate itself, so a guessed URL cannot bypass the sidebar.
  const ownerPages = [
    'app/bananas/financials/page.js',
    'app/bananas/cash-flow/page.js',
    'app/bananas/settings/page.js',
    'app/bananas/studio-settings/page.js',
    'app/bananas/team/page.js',
  ];
  for (const rel of ownerPages) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    assert.match(
      src,
      /ownerPageGate|requireOwner/,
      `${rel} is reachable from an owner-only tab but does not gate on owner`
    );
  }
});

// --- Persistent shell -------------------------------------------------------

test('the shell owns the header and sidebar so they survive navigation', () => {
  // Before this, every admin page rendered its own full-screen chrome, so
  // opening one from a tile replaced the whole view and you had to click back
  // out. The header and sidebar living in the layout is what keeps them put.
  assert.match(LAYOUT, /AdminShell/, 'the layout must render the shell');
  assert.match(SHELL, /AuthenticatedPageHeader/, 'the header belongs to the shell now');
  assert.match(SHELL, /function Sidebar/, 'the sidebar belongs to the shell now');
  assert.ok(
    !/function Sidebar/.test(CLIENT),
    'the sidebar is back in the tile grid, where it would be torn down on navigation'
  );
});

test('destination pages no longer render their own page container', () => {
  // A page-level <main> would nest inside the layout's <main> (invalid) and
  // stack a second set of padding and centring inside the content column.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        // The shell itself is the one place allowed to open a <main>.
        if (full.endsWith('app/bananas/AdminShell.js')) continue;
        if (/<main[\s>]/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'app/bananas'));
  assert.deepEqual(offenders, [], `these render a nested <main>: ${offenders.join(', ')}`);
});

test('the shell keeps exactly one page container', () => {
  const opens = [...SHELL.matchAll(/<main[\s>]/g)].length;
  assert.equal(opens, 1, 'the shell should open exactly one <main>');
});

test('every tile route maps back to the section it belongs to', () => {
  // This is what lets the sidebar highlight People while you are on Contacts.
  for (const tile of allAdminTiles()) {
    assert.equal(
      tabForPath(tile.href),
      tile.tabId,
      `${tile.href} does not resolve back to the ${tile.tabId} section`
    );
  }
});

test('a nested route resolves to its parent tile, not a shallower one', () => {
  // /bananas/contacts/abc is still the Contacts page.
  assert.equal(tileForPath('/bananas/contacts/abc-123')?.title, 'Contacts');
  assert.equal(tabForPath('/bananas/contacts/abc-123'), 'people');
  assert.equal(tabForPath('/bananas/applications/xyz'), 'memberships');
  // A trailing slash must not change the answer.
  assert.equal(tabForPath('/bananas/contacts/'), 'people');
});

test('the dashboard root highlights no section by pathname alone', () => {
  // The root's section comes from ?tab=, not the path.
  assert.equal(tabForPath('/bananas'), null);
  assert.equal(tileForPath('/bananas'), null);
});

test('a route with no tile resolves to nothing rather than guessing', () => {
  assert.equal(tabForPath('/bananas/financial-calendar'), null);
  assert.equal(tabForPath(''), null);
  assert.equal(tabForPath(null), null);
});

// --- Events section ---------------------------------------------------------

test('Events is its own section, directly under Tasks in OPERATIONS', () => {
  const events = adminTabById('events');
  assert.ok(events, 'the Events tab is missing');
  assert.equal(events.label, 'Events');
  assert.equal(events.group, 'OPERATIONS');
  assert.equal(events.ownerOnly, false);
  const operations = ADMIN_TABS.filter((t) => t.group === 'OPERATIONS').map((t) => t.id);
  assert.equal(
    operations[operations.indexOf('tasks') + 1],
    'events',
    'Events must sit directly below Tasks'
  );
});

test('the events list lives in the Events section, not below every tile grid', () => {
  // It used to render on the dashboard root unconditionally, so it followed you
  // into every other tile grid — Rentals, Documents and the rest.
  const panel = fs.readFileSync(path.join(REPO_ROOT, 'app/bananas/EventsTabPanel.js'), 'utf8');
  assert.match(panel, /activeTab !== 'events'/, 'the list must only render in the Events section');
  assert.match(PAGE, /EventsTabPanel/, 'the dashboard page must render the list through the panel');
  assert.ok(
    !/<EventsSection/.test(PAGE),
    'the dashboard page renders the events list unconditionally again'
  );
});

test('every route under an event resolves back to the Events section', () => {
  // Events is list-backed, so there is no tile to map these routes home.
  assert.equal(tabForPath('/bananas/events'), 'events');
  assert.equal(tabForPath('/bananas/events/new'), 'events');
  assert.equal(tabForPath('/bananas/events/abc-123'), 'events');
  assert.equal(tabForPath('/bananas/events/abc-123/financials'), 'events');
  assert.equal(tabForPath('/bananas/events/'), 'events');
});

test('leaving an event returns you to the Events section', () => {
  for (const rel of [
    'app/bananas/components/EventForm.js',
    'app/bananas/components/TtEventCreator.js',
    'app/bananas/events/new/NewEventChooser.js',
  ]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.ok(
      !/="\/bananas"/.test(src),
      `${rel} still sends you to the dashboard default instead of ?tab=events`
    );
    assert.match(src, /\/bananas\?tab=events/, `${rel} lost its route back to Events`);
  }
});

test('section badges sum only the tiles in that section', () => {
  const counts = { applications: 3, pastDueMembers: 2, collaborations: 5, unreadChat: 1 };
  assert.equal(adminTabBadge('memberships', counts), 5);
  assert.equal(adminTabBadge('people', counts), 5);
  // Unread chat moved off the old Team tile and onto the Chat section with it.
  assert.equal(adminTabBadge('tasks', counts), 0);
  assert.equal(adminTabBadge('chat', counts), 1);
  // A section whose tiles carry no counts stays silent rather than showing 0.
  assert.equal(adminTabBadge('documents', counts), 0);
  assert.equal(adminTabBadge('unknown-section', counts), 0);
});

test('badges tolerate a missing counts object', () => {
  assert.equal(adminTabBadge('memberships'), 0);
  assert.equal(adminTabBadge('memberships', {}), 0);
});

test('the back trail points at the parent section, not a bare /bananas', () => {
  // Landing on the default section instead of the one you came from was the
  // old behaviour and is what made the trip back feel like a dead end.
  assert.match(SHELL, /href=\{`\/bananas\?tab=\$\{sectionTabId\}`\}/);
});

test('the duplicated back link is gone from destination pages', () => {
  // The shell breadcrumb replaces it. Two back affordances stacked on one page
  // is what the tile-to-page trip looked like before.
  //
  // The event forms are the deliberate exception: events are reached from the
  // list below the tile grid rather than from a tile, so tileForPath() finds
  // nothing for them and no breadcrumb renders. Their own back link is the
  // only way out, so it stays until events get a section of their own.
  const NO_TILE_SO_KEEPS_ITS_OWN_BACK_LINK = [
    'app/bananas/components/EventForm.js',
    'app/bananas/components/TtEventCreator.js',
    'app/bananas/events/new/NewEventChooser.js',
  ].map((rel) => path.join(REPO_ROOT, rel));
  const withBackLink = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        if (
          /backHref="\/bananas"/.test(src) &&
          !NO_TILE_SO_KEEPS_ITS_OWN_BACK_LINK.includes(full)
        ) {
          withBackLink.push(full);
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'app/bananas'));
  assert.deepEqual(withBackLink, [], `stale back link in: ${withBackLink.join(', ')}`);
});

test('owner-only sections are still resolved away for non-owners', () => {
  // The layout gate is admin-level, so the shell must not surface owner
  // sections to a plain admin even via a crafted ?tab=.
  assert.equal(resolveAdminTab('analytics', { isOwner: false }), DEFAULT_ADMIN_TAB);
  assert.equal(resolveAdminTab('analytics', { isOwner: true }), 'analytics');
});

test('the tile grid filters owner-only tiles as a second line of defence', () => {
  assert.match(CLIENT, /tile\.restricted !== 'owner'/);
});

test('page-level gates were not dropped when chrome was removed', () => {
  // The layout gate does not re-run on client-side navigation between child
  // routes, so it can never be the only thing protecting owner-only data.
  const gated = {
    'app/bananas/financials/page.js': /ownerPageGate/,
    'app/bananas/cash-flow/page.js': /ownerPageGate/,
    'app/bananas/studio-settings/page.js': /ownerPageGate/,
    'app/bananas/team/page.js': /ownerPageGate/,
    'app/bananas/contacts/page.js': /requireTeam/,
  };
  for (const [file, pattern] of Object.entries(gated)) {
    const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.match(src, pattern, `${file} lost its own gate`);
  }
});

test('a destination page title never competes with the app title', () => {
  // Before the shell, a page title and the "Admin" header were never on screen
  // at the same time, so both were set at 40px. Inside the shell they stack,
  // and two identical 40px headings gave the eye no starting point.
  const appTitle = Number(
    SHELL.match(/titleClassName="text-\[([\d.]+)px\]/)[1]
  );
  assert.equal(appTitle, 40, 'the app-level header should stay dominant');

  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        if (full.endsWith('app/bananas/AdminShell.js')) continue;
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/titleClassName="text-\[([\d.]+)px\]/g)) {
          if (Number(m[1]) >= appTitle) offenders.push(`${full} (${m[1]}px)`);
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'app/bananas'));
  assert.deepEqual(offenders, [], `page titles at or above the app title: ${offenders.join(', ')}`);
});

// --- /team routes inside the shell ------------------------------------------

test('the team layout never gates access, only presentation', () => {
  // /team/login must stay reachable with no session, and every page underneath
  // keeps its own auth check. A layout does not re-run on client-side
  // navigation between child routes, so it can never be relied on for access
  // control — and must not lock anyone out either.
  assert.ok(
    !/redirect\(/.test(TEAM_LAYOUT),
    'the team layout must not redirect; /team/login has no session yet'
  );
  assert.match(TEAM_LAYOUT, /if \(!user\) return children/);
});

test('a non-admin team member never gets the admin sidebar', () => {
  // The sidebar lists Memberships, Analytics and Settings — none of which a
  // plain team member can open.
  assert.match(TEAM_LAYOUT, /role !== 'admin'\) return children/);
  assert.match(TEAM_LAYOUT, /from\('team_members'\)/, 'role must come from the server');
});

test('the team layout only wraps routes that belong to a section', () => {
  // /team/documents, the trial-pass tools and /team/login have no tile, so the
  // shell must leave them alone rather than framing them in admin chrome.
  assert.match(TEAM_LAYOUT, /tileRequired/);
  assert.match(
    SHELL,
    /if \(tileRequired && \(!pathTab \|\| isShellExempt\(pathname\)\)\) return children/
  );
  for (const p of ['/team/documents', '/team/login']) {
    assert.equal(tabForPath(p), null, `${p} should not resolve to a section`);
  }
});

test('the trial pass pages own a tile but stay outside the shell', () => {
  // They gained tiles in #115 while the shell learned to wrap tiled /team
  // routes in #116. Both are fine alone; together they put an unthemed page
  // inside the shell. Until the hardcoded dark styling is ported to the theme
  // tokens, these open standalone.
  for (const p of ['/team/trial-pass/analytics', '/team/trial-pass/manual']) {
    assert.equal(tabForPath(p), 'memberships', `${p} should still own a tile`);
    assert.equal(isShellExempt(p), true, `${p} must not be wrapped in the shell`);
  }
  // The exemption is narrow — it must not swallow the shared /team pages.
  for (const p of ['/team/progress', '/team/chat']) {
    assert.equal(isShellExempt(p), false, `${p} should render inside the shell`);
  }
});

test('a shell-exempt page is the one place allowed its own header', () => {
  // This is what the exemption exists to avoid doubling. If these pages ever
  // stop rendering their own chrome, the exemption should be removed with it.
  for (const rel of [
    'app/team/trial-pass/analytics/page.js',
    'app/team/trial-pass/manual/page.js',
  ]) {
    const src = read(rel);
    assert.match(src, /AuthenticatedPageHeader/, `${rel} lost its own header`);
    assert.match(src, /<main/, `${rel} lost its own page container`);
  }
});

// --- Tasks section ----------------------------------------------------------

test('Tasks is its own section at the top of OPERATIONS', () => {
  const tasks = adminTabById('tasks');
  assert.ok(tasks, 'the Tasks tab is missing');
  assert.equal(tasks.label, 'Tasks');
  assert.equal(tasks.group, 'OPERATIONS');
  assert.equal(tasks.ownerOnly, false);
  const operations = ADMIN_TABS.filter((t) => t.group === 'OPERATIONS').map((t) => t.id);
  assert.equal(operations[0], 'tasks', 'Tasks must be the first OPERATIONS section');
});

test('the Tasks section links straight to the tasks page', () => {
  // One destination behind the section, so a tile grid holding a single tile
  // would only add a click between the sidebar and the work.
  assert.equal(adminTabHref(adminTabById('tasks')), '/team/progress');
  assert.deepEqual(ADMIN_TILES.tasks, [], 'a Tasks tile would mean two ways into one page');
  assert.ok(
    !allAdminTiles().some((t) => t.href === '/team/progress'),
    'Tasks is a section now, so nothing should still tile to it'
  );
});

test('the tasks page keeps the Tasks section highlighted', () => {
  assert.equal(tabForPath('/team/progress'), 'tasks');
  assert.equal(tabForPath('/team/progress/'), 'tasks');
  assert.equal(isShellExempt('/team/progress'), false);
});

test('the tasks page shows no breadcrumb, because it is the section', () => {
  assert.equal(crumbForPath('/team/progress'), null);
});

test('the Team section is gone entirely', () => {
  // Its four tiles were rehoused one by one — the calendar to Events, Chat and
  // Tasks to sections of their own, Team Members to Settings — which left an
  // empty heading in the sidebar. Nothing should bring it back.
  assert.equal(adminTabById('team'), null, 'the Team tab is back in the sidebar');
  assert.ok(!ADMIN_TABS.some((t) => t.id === 'team' || t.label === 'Team'));
  assert.equal(ADMIN_TILES.team, undefined, 'the Team tile set is back');
  assert.equal(adminTilesFor('team').length, 0);
  // A stale ?tab=team link must land somewhere real rather than on an empty
  // section heading.
  assert.equal(resolveAdminTab('team', { isOwner: true }), DEFAULT_ADMIN_TAB);
  assert.equal(resolveRootAdminTab('team', { isOwner: false }), DEFAULT_ADMIN_TAB);
  assert.ok(
    !/tab=team\b/.test(SHELL) && !/tab=team\b/.test(CLIENT) && !/tab=team\b/.test(PAGE),
    'something still links to ?tab=team'
  );
});

// --- Chat section -----------------------------------------------------------

test('Chat is its own section, directly under Events in OPERATIONS', () => {
  const chat = adminTabById('chat');
  assert.ok(chat, 'the Chat tab is missing');
  assert.equal(chat.label, 'Chat', 'the section is called Chat, not Team Chat');
  assert.equal(chat.group, 'OPERATIONS');
  assert.equal(chat.ownerOnly, false);
  const operations = ADMIN_TABS.filter((t) => t.group === 'OPERATIONS').map((t) => t.id);
  assert.equal(
    operations[operations.indexOf('events') + 1],
    'chat',
    'Chat must sit directly below Events'
  );
});

test('Chat is reached from the sidebar, never from a tile', () => {
  assert.ok(
    !allAdminTiles().some((t) => t.href === '/team/chat'),
    'a chat tile would mean two ways into one page'
  );
});

test('the Chat section links straight to the chat page', () => {
  // One destination behind the section, so a tile grid holding a single tile
  // would only add a click between the sidebar and the messages.
  assert.equal(adminTabHref(adminTabById('chat')), '/team/chat');
  // Every section that is not a link section still opens its tile grid on the
  // dashboard root.
  for (const tab of ADMIN_TABS.filter((t) => !t.href)) {
    assert.equal(adminTabHref(tab), `/bananas?tab=${tab.id}`);
  }
  assert.match(SHELL, /href=\{adminTabHref\(tab\)\}/, 'the sidebar must use the section href');
});

test('the chat page keeps the Chat section highlighted', () => {
  assert.equal(tabForPath('/team/chat'), 'chat');
  assert.equal(tabForPath('/team/chat/'), 'chat');
  // And it renders inside the shell rather than standalone.
  assert.equal(isShellExempt('/team/chat'), false);
});

test('the chat page shows no breadcrumb, because it is the section', () => {
  assert.equal(crumbForPath('/team/chat'), null);
});

test('a link section can never become the dashboard root panel', () => {
  // ?tab=chat has no tile grid to show, so it must fall back rather than print
  // a section heading over an empty grid.
  assert.equal(resolveAdminTab('chat', { isOwner: true }), 'chat');
  assert.equal(resolveRootAdminTab('chat', { isOwner: true }), DEFAULT_ADMIN_TAB);
  assert.equal(resolveAdminTab('tasks', { isOwner: true }), 'tasks');
  assert.equal(resolveRootAdminTab('tasks', { isOwner: true }), DEFAULT_ADMIN_TAB);
  // And the default itself must never be a link section, or the fallback loops.
  assert.ok(!adminTabById(DEFAULT_ADMIN_TAB)?.href, 'the default section has no panel to show');
  // Ordinary sections are unaffected.
  assert.equal(resolveRootAdminTab('people', { isOwner: false }), 'people');
  assert.equal(resolveRootAdminTab('analytics', { isOwner: false }), DEFAULT_ADMIN_TAB);
});

// --- Events Calendar --------------------------------------------------------

test('the calendar belongs to Events, not Team', () => {
  // It was a Team tile called "Team Calendar", which framed the venue's
  // programming calendar as a staffing surface. It is now the Events Calendar
  // rendered at the top of the Events section, so no tile points at it and the
  // old path resolves to Events rather than Team.
  assert.ok(
    !allAdminTiles().some((t) => t.href === '/team/calendar'),
    'the calendar is a tile again'
  );
  assert.equal(tileForPath('/team/calendar'), null);
  assert.equal(tabForPath('/team/calendar'), 'events');

  // The calendar is programming, not scheduling: no shift or staffing language
  // anywhere on it. (Plain "shifts" is left alone — date-math comments about
  // timezone shifting are not what this is guarding.)
  const staffingWords = /staffing|shift schedule|shift coverage|Shifts and|on shift/i;
  const sources = [
    'lib/admin-tabs.js',
    'app/components/EventsCalendarClient.js',
    'app/bananas/EventsTabPanel.js',
    'app/bananas/calendar/TeamEventModal.js',
  ];
  for (const rel of sources) {
    const src = read(rel);
    assert.doesNotMatch(src, staffingWords, `${rel} still talks about shifts`);
    assert.doesNotMatch(src, /Team Calendar/, `${rel} still calls it the Team Calendar`);
  }
});

test('the Events section renders the calendar above the events list', () => {
  // Opening Events shows the whole programme in calendar view first, then the
  // record-by-record list. Order matters: the calendar is the top of the tab.
  const panel = read('app/bananas/EventsTabPanel.js');
  const calendarAt = panel.indexOf('<EventsCalendarClient');
  const listAt = panel.indexOf('<EventsSection');
  assert.ok(calendarAt > 0, 'the Events section lost its calendar');
  assert.ok(listAt > 0, 'the Events section lost its list');
  assert.ok(calendarAt < listAt, 'the calendar must render above the events list');
  assert.match(panel, /variant="section"/);

  // One dataset, one loader — the section and the standalone team page must not
  // grow two different versions of the same calendar.
  assert.match(PAGE, /loadEventsCalendarData/);
  assert.match(read('app/team/calendar/page.js'), /loadEventsCalendarData/);
});

test('an admin opening the old calendar path lands in Events', () => {
  // /team/calendar exists for non-admin team members, who have no admin
  // dashboard to open. An admin would otherwise see a second copy of the grid
  // that already sits at the top of Events.
  const src = read('app/team/calendar/page.js');
  assert.match(src, /if \(data\.isAdmin\) redirect\('\/bananas\?tab=events'\)/);
});

test('sidebar counts are defined once and shared by both layouts', () => {
  // Two copies of these ten queries would drift the moment a tile gained or
  // lost a count.
  assert.match(LAYOUT, /fetchAdminCounts/);
  assert.match(TEAM_LAYOUT, /fetchAdminCounts/);
  assert.match(COUNTS, /export async function fetchAdminCounts/);
  for (const file of [LAYOUT, TEAM_LAYOUT]) {
    assert.ok(
      !/membership_applications/.test(file),
      'a layout is querying counts directly instead of using fetchAdminCounts'
    );
  }
});

test('every count key a tile refers to is actually produced', () => {
  const keys = allAdminTiles()
    .map((tile) => tile.countKey)
    .filter(Boolean);
  assert.ok(keys.length > 0, 'no tiles declare a count');
  for (const key of keys) {
    assert.match(
      COUNTS,
      new RegExp(`\\n\\s*${key}:`),
      `tile count "${key}" is never produced by fetchAdminCounts`
    );
  }
});

test('every count key a list-backed section refers to is actually produced', () => {
  // Events and Chat have no tiles to carry a count, so they name theirs on the
  // tab with `countKeys`. Those need the same guarantee.
  const keys = ADMIN_TABS.flatMap((tab) => tab.countKeys || []);
  assert.ok(keys.length > 0, 'no sections declare their own counts');
  for (const key of keys) {
    assert.match(
      COUNTS,
      new RegExp(`\\n\\s*${key}:`),
      `section count "${key}" is never produced by fetchAdminCounts`
    );
  }
});

test('team pages drop their own chrome only when the shell provides it', () => {
  // Reached directly by a non-admin, these pages still need their own
  // container, header and way out. Reached from the admin sidebar, rendering
  // those again would stack two headers and two sign-out buttons.
  const shellAware = [
    'app/team/chat/TeamChatClient.js',
    'app/components/EventsCalendarClient.js',
    'app/team/progress/ProgressClient.js',
  ];
  for (const rel of shellAware) {
    const src = read(rel);
    assert.match(src, /useInAdminShell/, `${rel} does not check for the shell`);
    assert.match(src, /const Frame = inShell \? 'div' : 'main'/, `${rel} always opens a <main>`);
  }
});

test('the tasks page keeps unconditional chrome for the team-member view', () => {
  // Only the admin view is ever wrapped, so the team-member view below it must
  // keep its own <main> with no condition attached.
  const src = read('app/team/progress/ProgressClient.js');
  const teamView = src.slice(src.indexOf('function TeamProgressView'));
  assert.match(teamView, /<main className="max-w-\[900px\]/);
});

test('the shell context defaults to false so an unwrapped page keeps its chrome', () => {
  const src = read('app/components/AdminShellContext.js');
  assert.match(src, /createContext\(false\)/);
});

test('the calendar renders no header of its own inside the Events tab', () => {
  // The tab already says "Events" and describes itself directly above the
  // calendar, so a second title, a second description line and an add button
  // inches from the list's "+ NEW EVENT" were three duplicates in a row.
  const src = read('app/components/EventsCalendarClient.js');
  assert.match(src, /\{!isSection && \(/, 'the header is no longer gated on the variant');

  // Everything that used to be in that header must sit inside the gate, and
  // the legend — where the section variant now starts — must sit outside it.
  const gate = src.indexOf('{!isSection && (');
  const legend = src.indexOf('{/* Legend */}');
  const pageOnlyHeader = src.slice(gate, legend);
  const afterLegend = src.slice(legend);
  for (const needle of ['Events Calendar', '+ ADD TO CALENDAR', 'double-click to add']) {
    assert.ok(pageOnlyHeader.includes(needle), `"${needle}" left the page-only header`);
    assert.ok(!afterLegend.includes(needle), `"${needle}" escaped the page-only header`);
  }

});

test('the legend and the scorecard read after the calendar, not before it', () => {
  // Both summarise the grid, so above it they were two rows of preamble
  // between the section heading and the thing you came to look at.
  const src = read('app/components/EventsCalendarClient.js');
  const monthNav = src.indexOf('{/* Month nav */}');
  const grid = src.indexOf('{/* Grid cells */}');
  const legend = src.indexOf('{/* Legend */}');
  const scorecard = src.indexOf('{/* Monthly Scorecard');

  for (const [name, at] of [['month nav', monthNav], ['grid', grid], ['legend', legend], ['scorecard', scorecard]]) {
    assert.ok(at > 0, `the calendar lost its ${name}`);
  }
  assert.ok(monthNav < grid, 'the month nav belongs above the grid');
  assert.ok(grid < legend, 'the legend must follow the grid');
  assert.ok(legend < scorecard, 'the scorecard reads after the legend');
});

test('a section that renders its own content gets no heading block', () => {
  // The tile sections need a heading to say what their tiles are for. Events
  // and Chat do not: the sidebar entry names them, and what follows — a
  // calendar, an events list, a channel list — announces itself.
  const src = read('app/bananas/AdminDashboardClient.js');
  assert.match(src, /\{section && !section\.rendersOwnContent && \(/);

  for (const id of ['events', 'chat']) {
    assert.equal(adminTabById(id).rendersOwnContent, true, `${id} would render a heading again`);
  }
  for (const id of ['team', 'memberships']) {
    assert.ok(!adminTabById(id).rendersOwnContent, `${id} lost its tile-grid heading`);
    assert.ok(adminTabById(id).description, `${id} has no description to show`);
  }
});

test('Team Chat renders its own title only outside the admin shell', () => {
  const src = read('app/team/chat/TeamChatClient.js');
  const gate = src.indexOf('{!inShell && (');
  assert.ok(gate > 0, 'the chat header is no longer gated on the shell');

  // Title, the "you are X" line and every header control sit behind the gate,
  // and nothing that belongs to the conversation itself does.
  const conversation = src.indexOf('flex gap-5 h-[70vh]');
  const header = src.slice(gate, conversation);
  for (const needle of ['Team Chat', 'channels &amp; direct messages', 'SIGN OUT']) {
    assert.ok(header.includes(needle), `"${needle}" left the standalone-only header`);
    assert.ok(!src.slice(conversation).includes(needle), `"${needle}" escaped the header`);
  }
});
