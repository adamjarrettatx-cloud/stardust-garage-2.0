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
  adminTabById,
  ADMIN_TILES,
  ADMIN_TILE_ACTIONS,
  adminTilesFor,
  allAdminTiles,
  adminTabBadge,
  tabForPath,
  tileForPath,
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
  assert.ok(forStaff.includes('team'));
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

test('every defined tab has tiles', () => {
  // A tab with no tiles would render a heading over an empty grid.
  for (const tab of ADMIN_TABS) {
    const tiles = adminTilesFor(tab.id);
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
  assert.match(SHELL, /resolveAdminTab\(searchParams\?\.get\('tab'\)/);
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
  assert.equal(tabForPath('/bananas/events/new'), null);
  assert.equal(tabForPath('/bananas/financial-calendar'), null);
  assert.equal(tabForPath(''), null);
  assert.equal(tabForPath(null), null);
});

test('section badges sum only the tiles in that section', () => {
  const counts = { applications: 3, pastDueMembers: 2, collaborations: 5, unreadChat: 1 };
  assert.equal(adminTabBadge('memberships', counts), 5);
  assert.equal(adminTabBadge('people', counts), 5);
  assert.equal(adminTabBadge('team', counts), 1);
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
  assert.match(SHELL, /if \(tileRequired && !tile\) return children/);
  for (const p of ['/team/documents', '/team/trial-pass/manual', '/team/login']) {
    assert.equal(tabForPath(p), null, `${p} should not resolve to a section`);
  }
});

test('the three team tiles do resolve to the Team section', () => {
  for (const p of ['/team/progress', '/team/calendar', '/team/chat']) {
    assert.equal(tabForPath(p), 'team', `${p} should sit in the Team section`);
  }
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

test('team pages drop their own chrome only when the shell provides it', () => {
  // Reached directly by a non-admin, these pages still need their own
  // container, header and way out. Reached from the admin sidebar, rendering
  // those again would stack two headers and two sign-out buttons.
  const shellAware = [
    'app/team/chat/TeamChatClient.js',
    'app/team/calendar/CalendarClient.js',
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
