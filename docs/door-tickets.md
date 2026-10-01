# Permanent door ticket QR

The printed QR encodes `https://sdgatx.com/door`. This path is a permanent operational contract: preserve it through redesigns and domain migrations. The PNG sign must not encode an event slug or a third-party QR subscription URL.

## Selection

- Only published, public events are eligible. Drafts, cancelled/archived events, unlisted events, and internal events never appear.
- The window opens one hour before the event's parsed start in `America/Chicago`.
- The window closes at the existing `computeEventListingCutoff` instant. A concrete end time takes precedence; an overnight end belongs to the following calendar day.
- Existing fallback: a start at/after 9:55 PM lasts six elapsed hours; an earlier start lasts eight. An unparseable/missing start cannot be selected automatically. Enter a concrete end time when these defaults do not describe the event.
- A single match is shown. Overlaps use an open front-desk session only if its event is eligible and the session opened within that event's current window. Otherwise all matching events are explicitly presented for the guest to choose.
- A sold-out or sales-closed event remains the selected event. Do not substitute another night.
- Outside a window, the page says no event is happening and offers a separate upcoming-events link.

## Checkout and freshness

The event-specific Buy Tickets link goes to `/events/<slug>?buy=1`, using the existing account gate, inventory holds, discounts, waiver acceptance and payment flow. Auth callbacks and checkout remain tied to that event rather than re-resolving `/door`.

The server is authoritative for the clock, public event projection and sales-status summary. The public `/api/door-events` endpoint accepts no event, clock, preview or share-token override. It emits no inventory counts, prices, staff/session identifiers or access codes. It and the page are dynamic; API responses set no-store headers for browsers and CDNs.

The page refreshes every 30 seconds, sooner at the next window boundary, and on tab/connection recovery. Failed requests remove purchasing controls and show an explicit retry/door-team message. There is no scheduled cron task and no event-by-event QR maintenance.

## Verification

```sh
TZ=UTC node --test tests/door-events.test.mjs tests/is-event-listable.test.mjs tests/event-listable-24h.test.mjs
TZ=America/Los_Angeles node --test tests/door-events.test.mjs
npx vitest run tests/api/door-events.vitest.js tests/api/ticket-tier-visibility.vitest.js
npx eslint --ext .js,.jsx app/door app/api/door-events lib/events/door-events*
npm run build
```

Browser QA covers current/empty/overlap states, sold-out/closed/free/unavailable status, retry recovery, automatic expiry, and event-bound checkout navigation at phone and desktop sizes. Test time changes belong only in fixtures; never change production event dates to exercise the page.
