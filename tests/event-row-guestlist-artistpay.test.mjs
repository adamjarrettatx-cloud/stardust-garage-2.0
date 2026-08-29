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
  // Owner decision: the way out is the event list you came from.
  assert.match(EVENT_GUEST_LIST, /backHref="\/bananas\?tab=events"/);
  assert.match(EVENT_GUEST_LIST, /BACK TO EVENTS/);
  assert.ok(
    !/backHref="\/bananas\/guest-list"/.test(EVENT_GUEST_LIST),
    'the back link points at the deleted all-events summary again'
  );
});

test('the all-events guest list summary is gone, helpers and all', () => {
  // Owner decision 2026-08-29: unnecessary once every guest list is opened from
  // its event. Deleted rather than left orphaned at a URL nothing links to.
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/guest-list/page.js')),
    false,
    'the summary page is back'
  );
  // The per-event page it used to wrap must survive the deletion.
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/guest-list/[id]/page.js')),
    true,
    'the per-event guest list page went with it'
  );
  // Its two helpers had exactly one consumer, so leaving them behind would be
  // dead code that still reads as a supported query.
  const helpers = read('lib/guestlist-helpers.js');
  for (const dead of ['summarizeEventGuestlists', 'loadGuestlistSummary', 'SUMMARY_SELECT']) {
    assert.ok(!helpers.includes(dead), `${dead} is still defined with no caller`);
  }
  // ...while the helpers the per-event page and the allocation panel share stay.
  for (const live of ['loadEventGrants', 'summarizeGrants', 'auditGuestlist']) {
    assert.ok(helpers.includes(live), `${live} was removed by mistake`);
  }
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

// --- Guest List is one screen ----------------------------------------------
// Owner decision 2026-08-29: clicking GUEST LIST on an event row opens the whole
// job on one page. It was a read-only breakdown that sent you to a panel buried
// at the bottom of the event edit form to change anything - two screens and a
// scroll for one task.

const GUEST_LIST_PANEL = read('app/bananas/guest-list/[id]/GuestListPanel.js');
const EVENT_EDIT_PAGE = read('app/bananas/events/[id]/page.js');
const HELPERS = read('lib/guestlist-helpers.js');

test('the editing panel lives on the guest list route', () => {
  assert.match(EVENT_GUEST_LIST, /import GuestListPanel from '\.\/GuestListPanel'/);
  assert.match(EVENT_GUEST_LIST, /<GuestListPanel eventId=\{event\.id\} \/>/);
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/events/[id]/GuestListPanel.js')),
    false,
    'the panel is still sitting under the event route too'
  );
});

test('the event form links to the guest list instead of duplicating it', () => {
  assert.match(EVENT_EDIT_PAGE, /href=\{`\/bananas\/guest-list\/\$\{event\.id\}`\}/);
  assert.match(EVENT_EDIT_PAGE, /OPEN GUEST LIST/);
  assert.ok(
    !/<GuestListPanel/.test(EVENT_EDIT_PAGE),
    'a second copy of the panel is back on the event form'
  );
  // The lineup panel is unrelated work and stays put.
  assert.match(EVENT_EDIT_PAGE, /<ArtistLineupPanel eventId=\{event\.id\} \/>/);
});

test('the scroll-to-anchor workaround is gone with the split it patched', () => {
  // The hash + scrollIntoView pair only existed because the panel was at the
  // bottom of another page. Nothing should need it now.
  assert.ok(!HELPERS.includes('GUEST_LIST_ANCHOR'), 'the anchor constant survived');
  assert.ok(!GUEST_LIST_PANEL.includes('scrollIntoView'), 'the panel still scrolls itself');
  assert.ok(!/EDIT ALLOCATION/.test(EVENT_GUEST_LIST), 'the hand-off button is back');
  // The way to the rest of the event still exists, just as a plain link.
  assert.match(EVENT_GUEST_LIST, /EVENT DETAILS/);
  assert.match(EVENT_GUEST_LIST, /href=\{`\/bananas\/events\/\$\{event\.id\}`\}/);
});

test('the one screen carries everything the read-only page showed', () => {
  // Roll-up, grant form, host allocations, named guests and door signatures all
  // on the page that the Events row opens.
  assert.match(GUEST_LIST_PANEL, /HOSTS/);
  assert.match(GUEST_LIST_PANEL, /SLOTS ALLOCATED/);
  assert.match(GUEST_LIST_PANEL, /CHECKED IN/);
  assert.match(GUEST_LIST_PANEL, /GRANT SLOTS/);
  assert.match(GUEST_LIST_PANEL, /SIGNATURE ON FILE/);
  assert.match(GUEST_LIST_PANEL, /guest-signature\/\$\{entry\.signature_profile_id\}/);
  // Guest names are visible without a click, since this page is named for them.
  assert.match(GUEST_LIST_PANEL, /!collapsed\[grant\.id\] && entries\.length > 0/);
});

test('the roll-up is computed from the live grant list', () => {
  // A server-rendered strip above a client panel goes stale the moment a grant
  // is edited, which is how the old page behaved.
  assert.match(GUEST_LIST_PANEL, /function Totals\(\{ grants \}\)/);
  assert.match(GUEST_LIST_PANEL, /const totals = summarizeGrants\(grants\)/);
  assert.ok(
    !/summarizeGrants/.test(EVENT_GUEST_LIST),
    'the page is computing totals server-side again'
  );
});

test('grant entries carry their signature from the loader', () => {
  // The panel reads grants from the API, so the signature lookup has to travel
  // with the grant rather than being a second server-only query.
  assert.match(HELPERS, /async function loadEntrySignatures/);
  assert.match(HELPERS, /signature_profile_id: signatures\.get\(entry\.id\) \|\| null/);
  assert.ok(
    !/loadEntrySignatures/.test(EVENT_GUEST_LIST),
    'the page still runs its own signature query'
  );
});

// --- Four buttons in one row stay readable on a small screen ----------------
// Owner decision 2026-08-29: shorten the two long labels below the sm
// breakpoint rather than let the action row wrap onto a second line.

test('the long event row labels shorten on small screens', () => {
  assert.match(EVENTS_SECTION, /<span className="sm:hidden">GUESTS<\/span>/);
  assert.match(EVENTS_SECTION, /<span className="hidden sm:inline">GUEST LIST<\/span>/);
  assert.match(EVENTS_SECTION, /<span className="sm:hidden">PAY<\/span>/);
  assert.match(EVENTS_SECTION, /<span className="hidden sm:inline">ARTIST PAY<\/span>/);
});

test('both label halves ship in the markup, so no width guess is needed', () => {
  // A JS-measured label would flash the wrong wording on first paint and hide
  // the full text from search and screen readers.
  assert.ok(
    !/useMediaQuery|window\.innerWidth|matchMedia/.test(EVENTS_SECTION),
    'the row started measuring its own width to pick a label'
  );
  // The full wording stays discoverable even when the short label is displayed.
  assert.match(EVENTS_SECTION, /title=\{`Guest list for \$\{event\.title\}`\}/);
  assert.match(EVENTS_SECTION, /title=\{`Artist pay for \$\{event\.title\}`\}/);
});
