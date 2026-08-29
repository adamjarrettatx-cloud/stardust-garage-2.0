import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_TILES,
  allAdminTiles,
  adminTabBadge,
  adminTabBadges,
  tabForPath,
  tileForPath,
  crumbForPath,
  adminTabById,
} from '../lib/admin-tabs.js';

// Owner decision 2026-08-29: Guest List and Artist Pay are per-event work, so
// they are opened from the event's own row in the Events list and nowhere else.
// A People tile could only ever open an all-events summary, which then made you
// find the event again — the exact trip this removed.

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const EVENTS_SECTION = read('app/bananas/components/EventsSection.js');
const PAY_PAGE = read('app/bananas/pay-requests/page.js');
const PAY_CLIENT = read('app/bananas/pay-requests/PayRequestsClient.js');
const SHELL = read('app/bananas/AdminShell.js');
const EVENT_GUEST_LIST = read('app/bananas/guest-list/[id]/page.js');

// --- The event row is the only entry point ----------------------------------

test('each event row links to that event\u2019s guest list and artist pay', () => {
  assert.match(
    EVENTS_SECTION,
    /href=\{`\/bananas\/guest-list\/\$\{event\.id\}`\}/,
    'the GUEST LIST button must carry the event id, not open the all-events summary'
  );
  assert.match(
    EVENTS_SECTION,
    /href=\{`\/bananas\/pay-requests\?event=\$\{event\.id\}`\}/,
    'the ARTIST PAY button must scope the queue to this event'
  );
  assert.match(EVENTS_SECTION, />\s*GUEST LIST\s*</);
  assert.match(EVENTS_SECTION, />\s*ARTIST PAY\s*</);
});

test('the row keeps its existing actions alongside the new ones', () => {
  // Adding buttons must not quietly displace editing or deleting.
  assert.match(EVENTS_SECTION, />\s*EDIT\s*</);
  assert.match(EVENTS_SECTION, /DeleteEventButton/);
  // Four pills need to be allowed to wrap rather than squeeze the title.
  assert.match(EVENTS_SECTION, /flex flex-wrap gap-2 justify-end flex-shrink-0/);
});

test('People no longer carries a Guest List or Artist Pay tile', () => {
  const hrefs = ADMIN_TILES.people.map((t) => t.href);
  assert.ok(!hrefs.includes('/bananas/guest-list'), 'Guest List tile is back under People');
  assert.ok(!hrefs.includes('/bananas/pay-requests'), 'Artist Pay tile is back under People');
  // ...and not smuggled into some other section either.
  const everywhere = allAdminTiles().map((t) => t.href);
  for (const href of ['/bananas/guest-list', '/bananas/pay-requests']) {
    assert.ok(!everywhere.includes(href), `${href} owns a tile again`);
  }
});

// --- Navigation still resolves ---------------------------------------------

test('both pages resolve to the Events section, not to nothing', () => {
  // Losing a tile must not leave the sidebar highlighting nothing while you are
  // standing on the page.
  for (const p of [
    '/bananas/guest-list',
    '/bananas/guest-list/abc-123',
    '/bananas/pay-requests',
    '/bananas/pay-requests/',
  ]) {
    assert.equal(tabForPath(p), 'events', `${p} should sit in the Events section`);
    assert.equal(tileForPath(p), null, `${p} should no longer match a tile`);
  }
});

test('the breadcrumb names the page and leads back to Events', () => {
  assert.deepEqual(crumbForPath('/bananas/guest-list/abc-123'), {
    title: 'Guest List',
    tabId: 'events',
  });
  assert.deepEqual(crumbForPath('/bananas/pay-requests'), {
    title: 'Artist Pay',
    tabId: 'events',
  });
  // A tiled route still answers with its tile.
  assert.equal(crumbForPath('/bananas/contacts/abc')?.title, 'Contacts');
  // The event routes render their own titles, so they contribute highlighting
  // only and must not produce a trail with an invented name.
  assert.equal(crumbForPath('/bananas/events/abc-123'), null);
  assert.equal(crumbForPath('/bananas'), null);
  assert.equal(crumbForPath(''), null);
});

test('the shell draws the trail from the crumb, not from the tile alone', () => {
  // Regression guard: while it was tile-driven, these two pages had no way back.
  assert.match(SHELL, /crumbForPath/);
  assert.match(SHELL, /\{crumb && section && \(/);
});

// --- The pending badge survived the move -----------------------------------

test('pending pay requests are still badged, now beside Events', () => {
  const counts = { pendingPayRequests: 4, collaborations: 5, newSignups: 1 };
  assert.equal(adminTabBadge('events', counts), 4, 'Events lost the pay-request badge');
  assert.equal(adminTabBadge('people', counts), 6, 'People should badge only its own tiles');
  assert.equal(adminTabBadges(counts).events, 4);
  assert.deepEqual(adminTabById('events').countKeys, ['pendingPayRequests']);
});

test('a section with neither tiles nor countKeys still stays silent', () => {
  assert.equal(adminTabBadge('documents', { pendingPayRequests: 9 }), 0);
  assert.equal(adminTabBadge('events'), 0);
  assert.equal(adminTabBadge('events', {}), 0);
});

test('the count key the Events badge needs is still produced', () => {
  assert.match(read('lib/admin-counts.js'), /\n\s*pendingPayRequests:/);
});

// --- Artist Pay scoping ----------------------------------------------------

test('Artist Pay reads the event from the URL and names it in the header', () => {
  assert.match(PAY_PAGE, /searchParams/, 'the page must read ?event=');
  assert.match(PAY_PAGE, /params\?\.event/);
  // Resolved from the events table rather than off a request row, so the page
  // can still say which event it is showing when that event has no requests.
  assert.match(PAY_PAGE, /from\('events'\)/);
  assert.match(PAY_PAGE, /pay requests for this event only/);
});

test('a repeated ?event= param takes the first value', () => {
  assert.match(PAY_PAGE, /Array\.isArray\(raw\) \? raw\[0\] : raw/);
});

test('the review queue is filtered by event id, and both lists agree', () => {
  assert.match(PAY_CLIENT, /r\.event_id === eventId/);
  // pending and reviewed must both come from the scoped set — filtering only the
  // pending list would show one event's queue over every event's history.
  assert.match(PAY_CLIENT, /const pending = inScope\.filter/);
  assert.match(PAY_CLIENT, /const reviewed = inScope\.filter/);
  assert.ok(
    !/\(requests \|\| \[\]\)\.filter\(\(r\) => r\.status/.test(PAY_CLIENT),
    'a status list is reading the unfiltered set again'
  );
});

test('1099 tracking stays year-wide even when the page is scoped', () => {
  // A 1099 is a per-contractor annual total. Filtered to one night it would be
  // wrong for the only purpose it has.
  assert.match(PAY_CLIENT, /<NineNineNineTab requests=\{requests\} scoped=\{Boolean\(eventId\)\}/);
  assert.match(PAY_CLIENT, /totals stay year-wide across every event/);
});

test('leaving a per-event guest list returns you to the Events list', () => {
  // Owner decision: the way out is the event list you came from, not the
  // all-events door summary. Both surfaces still exist as URLs; only the trail
  // out changed.
  assert.match(EVENT_GUEST_LIST, /backHref="\/bananas\?tab=events"/);
  assert.match(EVENT_GUEST_LIST, /BACK TO EVENTS/);
  assert.ok(
    !/backHref="\/bananas\/guest-list"/.test(EVENT_GUEST_LIST),
    'the back link points at the all-events summary again'
  );
});

test('a scoped page offers the way back out to every event', () => {
  assert.match(PAY_CLIENT, /SHOW EVERY EVENT/);
  assert.match(PAY_CLIENT, /THIS EVENT ONLY/);
  assert.match(PAY_PAGE, /BACK TO EVENTS/);
});

test('a deleted or bogus event id shows nothing rather than the whole queue', () => {
  // Silently falling back to every request would look like the filter worked.
  assert.match(PAY_PAGE, /eventMissing=\{Boolean\(eventId\) && !event\}/);
  assert.match(PAY_CLIENT, /That event no longer exists/);
});

test('Artist Pay unscoped still behaves as it did', () => {
  // /bananas/pay-requests with no param remains the full queue, so nothing that
  // already links there breaks.
  assert.match(PAY_CLIENT, /eventId \? \(requests \|\| \[\]\)\.filter/);
  assert.match(PAY_PAGE, /Review pay requests and track cumulative pay per contractor/);
});
