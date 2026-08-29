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
} from '../lib/admin-tabs.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLIENT = fs.readFileSync(
  path.join(REPO_ROOT, 'app/bananas/AdminDashboardClient.js'),
  'utf8'
);
const PAGE = fs.readFileSync(path.join(REPO_ROOT, 'app/bananas/page.js'), 'utf8');

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

test('the client renders a tile group for every defined tab', () => {
  // A tab with no tiles block would render a heading over an empty grid.
  for (const tab of ADMIN_TABS) {
    assert.match(
      CLIENT,
      new RegExp(`\\n\\s{4}${tab.id}:\\s*\\[`),
      `AdminDashboardClient has no tiles for the "${tab.id}" tab`
    );
  }
});

test('every tile eyebrow comes from the fixed action vocabulary', () => {
  // The old labels mixed actions with permissions (TEAM ONLY, OWNER ONLY,
  // PRIVATE) and status (NEW, LIVE), which gave staff no learnable pattern.
  // Permissions now live on `restricted` and status on `status`.
  const actions = [...CLIENT.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(actions.length >= 15, 'expected the full tile set to declare actions');
  for (const action of actions) {
    assert.ok(
      ['REVIEW', 'MANAGE', 'VIEW', 'TRACK'].includes(action),
      `"${action}" is not part of the action vocabulary`
    );
  }
});

test('permission wording never leaks back into an eyebrow', () => {
  for (const banned of ['TEAM ONLY', 'OWNER ONLY', 'PRIVATE', 'DIRECTORY', 'REPORTING', 'ACCOUNT']) {
    assert.ok(
      !CLIENT.includes(`action: '${banned}'`),
      `"${banned}" is being used as a tile action again`
    );
  }
});

test('restriction markers use a defined label', () => {
  const marks = [...CLIENT.matchAll(/restricted:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(marks.length > 0, 'no restricted tiles found');
  for (const mark of marks) {
    assert.ok(['owner', 'team'].includes(mark), `unknown restriction "${mark}"`);
  }
});

// --- URL-addressable navigation --------------------------------------------

test('the dashboard reads its initial tab from searchParams on the server', () => {
  assert.match(PAGE, /searchParams/, 'page.js does not accept searchParams');
  assert.match(PAGE, /await searchParams/, 'searchParams must be awaited in Next 15');
  assert.match(PAGE, /resolveAdminTab\(params\.tab/);
  assert.match(PAGE, /initialTab=\{initialTab\}/, 'initialTab is not passed to the client');
});

test('selecting a tab writes it to the URL and back/forward is handled', () => {
  assert.match(CLIENT, /history\.pushState/, 'tab changes must update the URL');
  assert.match(CLIENT, /searchParams\.set\('tab'/);
  assert.match(CLIENT, /addEventListener\('popstate'/, 'browser back must resync the tab');
  assert.match(CLIENT, /removeEventListener\('popstate'/, 'popstate listener must be cleaned up');
});

test('the client no longer hardcodes its starting tab', () => {
  // Regression guard: the previous version did useState('team'), which is what
  // made the dashboard non-addressable in the first place.
  assert.ok(
    !/useState\('team'\)/.test(CLIENT),
    'starting tab is hardcoded again instead of read from the URL'
  );
  assert.match(CLIENT, /resolveAdminTab\(initialTab/);
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
