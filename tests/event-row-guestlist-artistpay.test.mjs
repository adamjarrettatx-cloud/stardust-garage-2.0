import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_TILES,
  ADMIN_TABS,
  allAdminTiles,
  adminTabBadge,
  adminTabBadges,
  tabForPath,
  tileForPath,
  crumbForPath,
  adminTabById,
  adminTabHref,
} from '../lib/admin-tabs.js';

// Owner decision 2026-09-04: Artist Pay moved to its own MONEY sidebar tab so
// the full queue is one click from anywhere. The per-event ARTIST PAY button
// on the Events list was replaced with a live ticket-sales + gross readout for
// that event, pulled from the cached public.event_ticket_metrics snapshot and
// refreshable in place. Guest List remains per-event on the row because it has
// no useful global equivalent.

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const EVENTS_SECTION = read('app/bananas/components/EventsSection.js');
const TICKETS_LIVE = read('app/bananas/components/EventTicketSalesLive.js');
const EVENTS_TAB_PANEL = read('app/bananas/EventsTabPanel.js');
const DASHBOARD_PAGE = read('app/bananas/page.js');
const PAY_PAGE = read('app/bananas/pay-requests/page.js');
const PAY_CLIENT = read('app/bananas/pay-requests/PayRequestsClient.js');
const SHELL = read('app/bananas/AdminShell.js');
const EVENT_GUEST_LIST = read('app/bananas/guest-list/[id]/page.js');

// --- The event row keeps Guest List and gains live ticket sales -------------

test('each event row still links to that event\u2019s guest list', () => {
  assert.match(
    EVENTS_SECTION,
    /href=\{`\/bananas\/guest-list\/\$\{event\.id\}`\}/,
    'the GUEST LIST button must carry the event id, not open an all-events summary'
  );
  assert.match(EVENTS_SECTION, />\s*GUEST LIST\s*</);
});

test('the per-event ARTIST PAY button is gone from the event row', () => {
  // Artist Pay moved to a MONEY sidebar tab; a duplicate per-event button
  // would only route to the same destination and clutter the row again.
  assert.ok(
    !/ARTIST PAY/.test(EVENTS_SECTION),
    'the ARTIST PAY button is back on the event row'
  );
  assert.ok(
    !/pay-requests\?event=/.test(EVENTS_SECTION),
    'the event row is still building a scoped pay-requests link'
  );
});

test('live ticket sales for the event render where the button used to sit', () => {
  // The component is imported and mounted for every event row, with the
  // event id and the tt-linked flag so it can decide whether to render.
  assert.match(EVENTS_SECTION, /import EventTicketSalesLive from '\.\/EventTicketSalesLive'/);
  assert.match(EVENTS_SECTION, /<EventTicketSalesLive/);
  assert.match(EVENTS_SECTION, /eventId=\{event\.id\}/);
  assert.match(EVENTS_SECTION, /hasTicketTailor=\{Boolean\(event\.tt_event_series_id\)\}/);
  assert.match(EVENTS_SECTION, /initialMetrics=\{metricsByEvent\[event\.id\] \|\| null\}/);
});

test('the row keeps its existing actions alongside the new sales block', () => {
  // Adding the sales readout must not quietly displace editing or deleting.
  assert.match(EVENTS_SECTION, />\s*EDIT\s*</);
  assert.match(EVENTS_SECTION, /DeleteEventButton/);
  // The pill row still allows wrapping rather than squeezing the title.
  assert.match(EVENTS_SECTION, /flex flex-wrap gap-2 justify-end flex-shrink-0/);
});

test('the long guest-list label still shortens on small screens', () => {
  assert.match(EVENTS_SECTION, /<span className="sm:hidden">GUESTS<\/span>/);
  assert.match(EVENTS_SECTION, /<span className="hidden sm:inline">GUEST LIST<\/span>/);
});

test('label halves ship in the markup, so no width guess is needed', () => {
  // A JS-measured label would flash the wrong wording on first paint and hide
  // the full text from search and screen readers.
  assert.ok(
    !/useMediaQuery|window\.innerWidth|matchMedia/.test(EVENTS_SECTION),
    'the row started measuring its own width to pick a label'
  );
  assert.match(EVENTS_SECTION, /title=\{`Guest list for \$\{event\.title\}`\}/);
});

// --- The live ticket sales component ---------------------------------------

test('the live sales component renders nothing for non-ticketed events', () => {
  // Internal micro parties never had ticket sales, so a "0 sold" beside one
  // would be technically true and completely uninformative.
  assert.match(TICKETS_LIVE, /if \(!hasTicketTailor\) return null/);
});

test('the live sales component reads sold and gross from the cached row', () => {
  assert.match(TICKETS_LIVE, /metrics\?\.tickets_sold/);
  assert.match(TICKETS_LIVE, /metrics\?\.gross_cents/);
  assert.match(TICKETS_LIVE, /SOLD/);
  assert.match(TICKETS_LIVE, /gross/);
});

test('the refresh button posts to the existing scoped refresh route', () => {
  // The route already accepts { eventId } and re-upserts one row (read-only
  // against Ticket Tailor). We reuse it so there is one refresh path, not two.
  assert.match(TICKETS_LIVE, /\/api\/admin\/refresh-event-metrics/);
  assert.match(TICKETS_LIVE, /JSON\.stringify\(\{ eventId \}\)/);
  // router.refresh() lets the server component re-read the cache so the new
  // number replaces the old one without a full navigation.
  assert.match(TICKETS_LIVE, /router\.refresh\(\)/);
});

test('the sales component surfaces a not-configured status honestly', () => {
  // The refresh job records placeholder rows with an explanatory status when
  // the event is not TT-linked or the API key is missing; showing "0 sold"
  // in those states would look like a real read.
  assert.match(TICKETS_LIVE, /LIVE UNAVAILABLE/);
  assert.match(TICKETS_LIVE, /TICKETING NOT CONFIGURED/);
});

// --- The server page feeds metrics into the client tree --------------------

test('the dashboard page loads cached metrics for every ticketed event', () => {
  assert.match(DASHBOARD_PAGE, /event_ticket_metrics/);
  assert.match(DASHBOARD_PAGE, /tickets_sold, gross_cents/);
  // Scoped by tt_event_series_id so internal events do not trigger the query.
  assert.match(DASHBOARD_PAGE, /tt_event_series_id/);
  // The metrics map flows into the panel that renders the list.
  assert.match(DASHBOARD_PAGE, /metricsByEvent=\{metricsByEvent\}/);
  assert.match(EVENTS_TAB_PANEL, /metricsByEvent/);
});

// --- Artist Pay is a MONEY sidebar tab -------------------------------------

test('Artist Pay is a top-level MONEY tab that links straight to the page', () => {
  const artistPay = adminTabById('artist-pay');
  assert.ok(artistPay, 'the artist-pay tab is missing');
  assert.equal(artistPay.group, 'MONEY');
  assert.equal(artistPay.ownerOnly, true, 'artist pay is financial \u2014 owner-only');
  assert.equal(artistPay.href, '/bananas/pay-requests', 'the tab must go straight to the queue');
  assert.equal(artistPay.rendersOwnContent, true, 'single-destination tabs render their own page');
  assert.equal(adminTabHref(artistPay), '/bananas/pay-requests');
});

test('the pending badge follows the Artist Pay tab, not Events', () => {
  const counts = { pendingPayRequests: 4, collaborations: 5, newSignups: 1 };
  assert.equal(adminTabBadge('artist-pay', counts), 4);
  assert.equal(adminTabBadge('events', counts), 0, 'Events should not carry the pay-request badge anymore');
  assert.equal(adminTabBadges(counts)['artist-pay'], 4);
  assert.deepEqual(adminTabById('artist-pay').countKeys, ['pendingPayRequests']);
  // Events keeps no explicit countKeys now that Artist Pay owns the badge.
  assert.ok(
    !adminTabById('events').countKeys,
    'Events must not shadow the Artist Pay badge'
  );
});

test('the count key the Artist Pay badge needs is still produced', () => {
  assert.match(read('lib/admin-counts.js'), /\n\s*pendingPayRequests:/);
});

test('Artist Pay owns its own tile entry, kept empty like Chat and Tasks', () => {
  // Every visible tab must appear in ADMIN_TILES so the tile-grid invariant
  // holds. Single-destination sections deliberately have an empty tile list.
  assert.ok('artist-pay' in ADMIN_TILES, 'artist-pay is missing from ADMIN_TILES');
  assert.deepEqual(ADMIN_TILES['artist-pay'], []);
});

// --- Navigation resolves for both pages ------------------------------------

test('guest list routes still resolve to the Events section', () => {
  for (const p of ['/bananas/guest-list', '/bananas/guest-list/abc-123']) {
    assert.equal(tabForPath(p), 'events', `${p} should sit in the Events section`);
    assert.equal(tileForPath(p), null, `${p} should not match a tile`);
  }
});

test('pay-requests routes resolve to the Artist Pay section', () => {
  for (const p of ['/bananas/pay-requests', '/bananas/pay-requests/']) {
    assert.equal(tabForPath(p), 'artist-pay', `${p} should highlight Artist Pay`);
    assert.equal(tileForPath(p), null, `${p} should not match a tile`);
  }
});

test('the breadcrumb still names the guest-list page and leads back to Events', () => {
  assert.deepEqual(crumbForPath('/bananas/guest-list/abc-123'), {
    title: 'Guest List',
    tabId: 'events',
  });
});

test('Artist Pay is its own section, so it renders no breadcrumb trail', () => {
  // The section IS the page, the way Chat is: an "Artist Pay / Artist Pay"
  // trail would say nothing and just add chrome.
  assert.equal(crumbForPath('/bananas/pay-requests'), null);
  assert.equal(crumbForPath('/bananas/pay-requests?event=abc'), null);
});

test('nothing has smuggled a pay-requests tile back in under a different section', () => {
  const everywhere = allAdminTiles().map((t) => t.href);
  assert.ok(!everywhere.includes('/bananas/pay-requests'), '/bananas/pay-requests owns a tile again');
  // Guest List remains tile-less as well.
  assert.ok(!everywhere.includes('/bananas/guest-list'), '/bananas/guest-list owns a tile again');
});

test('the shell still draws the trail from the crumb helper', () => {
  assert.match(SHELL, /crumbForPath/);
  assert.match(SHELL, /\{crumb && section && \(/);
});

// --- Artist Pay scoping stays available for deep links ---------------------

test('Artist Pay still reads ?event= for deep-linked scoped views', () => {
  assert.match(PAY_PAGE, /searchParams/, 'the page must read ?event=');
  assert.match(PAY_PAGE, /params\?\.event/);
  assert.match(PAY_PAGE, /from\('events'\)/);
  assert.match(PAY_PAGE, /pay requests for this event only/);
});

test('a repeated ?event= param takes the first value', () => {
  assert.match(PAY_PAGE, /Array\.isArray\(raw\) \? raw\[0\] : raw/);
});

test('the review queue is filtered by event id, and both lists agree', () => {
  assert.match(PAY_CLIENT, /r\.event_id === eventId/);
  // pending and reviewed must both come from the scoped set \u2014 filtering only the
  // pending list would show one event's queue over every event's history.
  assert.match(PAY_CLIENT, /const pending = inScope\.filter/);
  assert.match(PAY_CLIENT, /const reviewed = inScope\.filter/);
  assert.ok(
    !/\(requests \|\| \[\]\)\.filter\(\(r\) => r\.status/.test(PAY_CLIENT),
    'a status list is reading the unfiltered set again'
  );
});

test('1099 tracking stays year-wide even when the page is scoped', () => {
  assert.match(PAY_CLIENT, /<NineNineNineTab requests=\{requests\} scoped=\{Boolean\(eventId\)\}/);
  assert.match(PAY_CLIENT, /totals stay year-wide across every event/);
});

test('a scoped view offers the way back out to every event', () => {
  // The client-side toggle still exists so a scoped viewer can widen the queue.
  assert.match(PAY_CLIENT, /SHOW EVERY EVENT/);
  assert.match(PAY_CLIENT, /THIS EVENT ONLY/);
  // The server-side header carries a back link to the unscoped queue, which
  // is now the destination of the sidebar tab (rather than the Events tab).
  assert.match(PAY_PAGE, /SHOW EVERY EVENT/);
  assert.match(PAY_PAGE, /backHref=\{event \? `\/bananas\/pay-requests` : null\}/);
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

// --- Guest List is still one screen ----------------------------------------

test('leaving a per-event guest list returns you to the Events list', () => {
  assert.match(EVENT_GUEST_LIST, /backHref="\/bananas\?tab=events"/);
  assert.match(EVENT_GUEST_LIST, /BACK TO EVENTS/);
});

test('the all-events guest list summary is still gone, helpers and all', () => {
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/guest-list/page.js')),
    false,
    'the summary page is back'
  );
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/guest-list/[id]/page.js')),
    true,
    'the per-event guest list page went with it'
  );
  const helpers = read('lib/guestlist-helpers.js');
  for (const dead of ['summarizeEventGuestlists', 'loadGuestlistSummary', 'SUMMARY_SELECT']) {
    assert.ok(!helpers.includes(dead), `${dead} is still defined with no caller`);
  }
  for (const live of ['loadEventGrants', 'summarizeGrants', 'auditGuestlist']) {
    assert.ok(helpers.includes(live), `${live} was removed by mistake`);
  }
});

const GUEST_LIST_PANEL = read('app/bananas/components/GuestListPanel.js');
const EVENT_EDIT_PAGE = read('app/bananas/events/[id]/page.js');
const HELPERS = read('lib/guestlist-helpers.js');

test('one shared panel serves the guest list screen and the event form', () => {
  assert.match(EVENT_GUEST_LIST, /import GuestListPanel from '\.\.\/\.\.\/components\/GuestListPanel'/);
  assert.match(EVENT_GUEST_LIST, /<GuestListPanel eventId=\{event\.id\} \/>/);
  assert.match(EVENT_EDIT_PAGE, /import GuestListPanel from '\.\.\/\.\.\/components\/GuestListPanel'/);
  assert.match(EVENT_EDIT_PAGE, /<GuestListPanel eventId=\{event\.id\} \/>/);
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'app/bananas/events/[id]/GuestListPanel.js')),
    false,
    'a route-local copy of the panel is back'
  );
  assert.match(EVENT_EDIT_PAGE, /<ArtistLineupPanel eventId=\{event\.id\} \/>/);
});

test('the scroll-to-anchor workaround is gone with the split it patched', () => {
  assert.ok(!HELPERS.includes('GUEST_LIST_ANCHOR'), 'the anchor constant survived');
  assert.ok(!GUEST_LIST_PANEL.includes('scrollIntoView'), 'the panel still scrolls itself');
  assert.ok(!/EDIT ALLOCATION/.test(EVENT_GUEST_LIST), 'the hand-off button is back');
  assert.match(EVENT_GUEST_LIST, /EVENT DETAILS/);
  assert.match(EVENT_GUEST_LIST, /href=\{`\/bananas\/events\/\$\{event\.id\}`\}/);
});

test('the one screen carries everything the read-only page showed', () => {
  assert.match(GUEST_LIST_PANEL, /HOSTS/);
  assert.match(GUEST_LIST_PANEL, /SLOTS ALLOCATED/);
  assert.match(GUEST_LIST_PANEL, /CHECKED IN/);
  assert.match(GUEST_LIST_PANEL, /GRANT SLOTS/);
  assert.match(GUEST_LIST_PANEL, /SIGNATURE ON FILE/);
  assert.match(GUEST_LIST_PANEL, /guest-signature\/\$\{entry\.signature_profile_id\}/);
  assert.match(GUEST_LIST_PANEL, /!collapsed\[grant\.id\] && entries\.length > 0/);
});

test('the roll-up is computed from the live grant list', () => {
  assert.match(GUEST_LIST_PANEL, /function Totals\(\{ grants \}\)/);
  assert.match(GUEST_LIST_PANEL, /const totals = summarizeGrants\(grants\)/);
  assert.ok(
    !/summarizeGrants/.test(EVENT_GUEST_LIST),
    'the page is computing totals server-side again'
  );
});

test('grant entries carry their signature from the loader', () => {
  assert.match(HELPERS, /async function loadEntrySignatures/);
  assert.match(HELPERS, /signature_profile_id: signatures\.get\(entry\.id\) \|\| null/);
  assert.ok(
    !/loadEntrySignatures/.test(EVENT_GUEST_LIST),
    'the page still runs its own signature query'
  );
});

// --- Retired shape does not creep back --------------------------------------

test('the retired ARTIST PAY row button and its shortened label are not restored', () => {
  for (const gone of ['ARTIST PAY', '>PAY<', 'Artist pay for']) {
    assert.ok(!EVENTS_SECTION.includes(gone), `the retired \"${gone}\" marker is back on the event row`);
  }
});

test('every tab in ADMIN_TABS carries a matching ADMIN_TILES entry', () => {
  // Regression guard: forgetting the empty tile entry for a single-destination
  // section (like the new Artist Pay tab) would break the tile-grid invariant.
  for (const tab of ADMIN_TABS) {
    assert.ok(tab.id in ADMIN_TILES, `ADMIN_TILES is missing an entry for ${tab.id}`);
  }
});
