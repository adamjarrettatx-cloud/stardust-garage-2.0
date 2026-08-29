import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const TABS = read('app/bananas/components/UnderlineTabs.js');

// The seven in-page filters the admin panel exposes, and the component that
// renders each one. Membership Applications, Collaborations, Signups, Venue
// Inquiries and Micro Parties all share SubmissionTabs.
const FILTER_SOURCES = [
  'app/bananas/components/SubmissionTabs.js',
  'app/bananas/contacts/ContactsList.js',
  'app/bananas/pay-requests/PayRequestsClient.js',
];

test('every in-page filter routes through the one shared tab strip', () => {
  for (const rel of FILTER_SOURCES) {
    assert.match(read(rel), /UnderlineTabs/, `${rel} does not use UnderlineTabs`);
  }
});

test('no in-page filter renders its own pill row', () => {
  // These three files previously had three different pill implementations.
  // A rounded-full row of filter buttons here means one has grown back.
  for (const rel of FILTER_SOURCES) {
    const src = read(rel);
    assert.ok(
      !/role="tablist"/.test(src),
      `${rel} builds its own tablist instead of delegating to UnderlineTabs`
    );
  }
});

test('the five submission list pages still get their status filter', () => {
  const pages = [
    'app/bananas/applications/ApplicationsList.js',
    'app/bananas/collaborations/CollaborationsList.js',
    'app/bananas/signups/SignupsClient.js',
    'app/bananas/venue-inquiries/VenueInquiriesList.js',
    'app/bananas/micro-parties/MicroPartiesList.js',
  ];
  for (const rel of pages) {
    assert.match(read(rel), /<SubmissionTabs/, `${rel} lost its status filter`);
  }
});

test('the active tab is underlined, not filled', () => {
  assert.match(TABS, /borderBottom: `2px solid \$\{isActive \? accent : 'transparent'\}`/);
  assert.ok(
    !/rounded-full text-\[12px\] font-semibold tracking-\[0\.1em\]/.test(TABS),
    'the old pill class string is still present'
  );
  assert.match(TABS, /background: 'none'/, 'tabs must not be filled');
});

test('status colour never lands on the label text', () => {
  // The status palette is tuned for dark mode and was only ever a pill fill
  // behind near-black text. As label text on the light page background it
  // measures about 1.7:1, far under the 4.5:1 body minimum. It belongs on the
  // underline and the count chip, which are large blocks and clear 3:1.
  assert.match(
    TABS,
    /color: isActive \? 'var\(--auth-text-strong\)' : 'var\(--auth-muted\)'/,
    'the label must use theme text colours, never the status colour'
  );
});

test('selection does not depend on colour alone', () => {
  // Weight change plus an underline, so the active tab is identifiable without
  // perceiving hue at all.
  assert.match(TABS, /fontWeight: isActive \? 700 : 500/);
  assert.match(TABS, /aria-selected=\{isActive\}/);
});

test('the tab strip stays usable when there are many tabs', () => {
  // Contacts has ten. Wrapping onto a second row would put half the tabs below
  // the bottom rule, breaking the line the underline reads against.
  assert.match(TABS, /overflow-x-auto/);
  assert.match(TABS, /flex-shrink-0 whitespace-nowrap/);
  assert.ok(!/flex-wrap/.test(TABS), 'the tab strip must not wrap');
});

test('a tab with no count renders no chip', () => {
  // Contacts filters by type and has nothing to count; Artist Pay's 1099 view
  // is a different cut of the same data rather than an empty bucket.
  assert.match(TABS, /const hasCount = typeof count === 'number'/);
  assert.match(TABS, /\{hasCount &&/);
  const pay = read('app/bananas/pay-requests/PayRequestsClient.js');
  assert.ok(
    !/'1099', label: '1099 Tracking', count/.test(pay),
    '1099 Tracking should not display a hardcoded zero'
  );
});

test('counts are aligned for scanning and capped', () => {
  assert.match(TABS, /tabular-nums/);
  assert.match(TABS, /count > 99 \? '99\+' : count/);
});
