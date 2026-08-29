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

test('the tab strip scrolls by default and only wraps when asked', () => {
  // Default is a single scrolling row: the rule stays continuous for the
  // underline to read against, and tabs never break mid-word.
  assert.match(TABS, /overflow-x-auto/);
  assert.match(TABS, /flex-shrink-0 whitespace-nowrap/);
  // Wrapping is opt-in via `wrap`, for strips that genuinely do not fit. The
  // Tasks department filter has twelve tabs and needs ~1204px against a ~1004px
  // content column, so scrolling hid two of them completely.
  assert.match(TABS, /wrap = false/);
  assert.match(TABS, /wrap \? 'flex-wrap gap-x-7 gap-y-0' : 'gap-7 overflow-x-auto'/);
});

test('only the twelve-tab department strip opts into wrapping', () => {
  const wrapping = ['app/team/progress/ProgressClient.js'];
  const notWrapping = [
    'app/bananas/components/SubmissionTabs.js',
    'app/bananas/pay-requests/PayRequestsClient.js',
    'app/bananas/contacts/ContactsList.js',
  ];
  for (const rel of wrapping) {
    assert.match(read(rel), /\n\s+wrap\n/, `${rel} should opt into wrapping`);
  }
  for (const rel of notWrapping) {
    // Match the JSX prop on its own line, not the word 'wrap' inside class
    // names like flex-wrap elsewhere in the file.
    const src = read(rel);
    assert.ok(!/\n\s+wrap\n/.test(src), `${rel} fits on one row and should not wrap`);
  }
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
