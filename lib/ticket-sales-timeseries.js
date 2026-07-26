// Pure data helpers for the TicketTailor sales-over-time chart on the owner-only
// Event Analytics page.
//
// SOURCE: public.ticket_order_attribution — one row per TicketTailor order,
// written by app/api/webhooks/tickettailor/route.js on ORDER.CREATED /
// ORDER.UPDATED. The money column is `total_paid_cents` (TicketTailor's
// `total_paid`, minor units).
//
// SALES-DATE CONVENTION: buckets are keyed by WHEN THE ORDER WAS PLACED, not by
// the event's date. This chart tracks sales activity over time, so a ticket sold
// today for a show in October lands in today's bar. Note this differs from the
// Financial Calendar (lib/financial-calendar.js), which buckets income by
// EVENT date — it is fed by public.event_ticket_metrics, a per-event rollup that
// carries no per-order timestamps and therefore cannot be bucketed by sale time.
//
// MONEY is integer minor units (cents), matching lib/event-analytics.js and
// lib/financial-calendar.js. Conversion to USD happens only at the render edge.
//
// TIMEZONE: every bucket boundary is a venue-local (America/Chicago) calendar
// boundary, never a UTC one, so a 9pm Austin sale counts as that day and not the
// next. Weeks are ISO weeks: they start on MONDAY, not Sunday.

// The venue is in Austin, TX. Matches lib/contract-helpers.js's
// CONTRACT_TIME_ZONE and lib/studio-helpers.js's TIMEZONE.
export const SALES_TIME_ZONE = 'America/Chicago';

export const GRANULARITIES = ['day', 'week', 'month'];

// Default trailing window per granularity, chosen so each view covers a
// comparable stretch of recent activity without a date-range picker.
export const DEFAULT_BUCKET_COUNT = { day: 30, week: 12, month: 12 };

// HARD LOWER BOUND (venue-local). February 2026 is the start of tracked
// TicketTailor sales history for this business, so the chart must never render
// a bucket or count an order from before this date — a trailing window that
// would reach further back is clamped here instead. Consequence: a view can
// show fewer than DEFAULT_BUCKET_COUNT bars (in July 2026 the month view shows
// Feb–Jul = 6, not 12), and before Feb 2026 it shows none at all.
//
// Adjust this single constant if the business ever backfills earlier history.
export const SALES_DATA_START_DATE = '2026-02-01';

// Only completed orders are revenue. Mirrors the webhook, which upserts
// pending/canceled rows too so status transitions stay visible, but treats only
// 'completed' as money.
const REVENUE_STATUS = 'completed';

const VENUE_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: SALES_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 'YYYY-MM-DD' for an epoch-ms instant, as seen on the venue's wall clock.
// en-CA formats as an ISO-shaped date, the same trick app/home/page.js uses.
export function venueDateString(ms) {
  return VENUE_DATE_FMT.format(new Date(ms));
}

// A 'YYYY-MM-DD' venue-local date as a UTC-midnight Date. Every date helper
// below works on these so calendar arithmetic never drifts across a DST change:
// the date string already encodes the venue-local day.
function dateStringToUtcDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

function utcDateToDateString(d) {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(dateStr, days) {
  const d = dateStringToUtcDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToDateString(d);
}

// The Monday on or before `dateStr` (ISO week start). getUTCDay() is 0=Sunday,
// so (day + 6) % 7 gives days elapsed since Monday: Mon->0 ... Sun->6.
export function startOfIsoWeek(dateStr) {
  const dow = dateStringToUtcDate(dateStr).getUTCDay();
  return addUtcDays(dateStr, -((dow + 6) % 7));
}

// The bucket a venue-local date belongs to. Day/week keys are 'YYYY-MM-DD'
// (weeks keyed by their Monday); month keys are 'YYYY-MM'.
export function bucketKey(dateStr, granularity) {
  if (granularity === 'week') return startOfIsoWeek(dateStr);
  if (granularity === 'month') return dateStr.slice(0, 7);
  return dateStr;
}

// First venue-local date of a bucket, so month keys get a real date to format.
function bucketStartDate(key, granularity) {
  return granularity === 'month' ? `${key}-01` : key;
}

// Step one bucket back from `key`.
function previousBucket(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
    return `${prev[0]}-${String(prev[1]).padStart(2, '0')}`;
  }
  return addUtcDays(key, granularity === 'week' ? -7 : -1);
}

// The instant an order was placed, in epoch ms, or null when unusable.
//
// Prefers TicketTailor's own order timestamp (unix SECONDS — the webhook reads
// it the same way when syncing to Mailchimp), since that is the true sale time.
// The page selects it out of raw_payload as `tt_created_at`; the nested
// raw_payload shape is accepted too so a caller holding a full row works.
// Falls back to our row's `created_at`, which is when the webhook landed —
// near-identical in normal operation, but different for a replayed delivery.
export function orderSaleInstantMs(row) {
  const ttSeconds = Number(row?.tt_created_at ?? row?.raw_payload?.created_at);
  if (Number.isFinite(ttSeconds) && ttSeconds > 0) return ttSeconds * 1000;
  const ms = Date.parse(row?.created_at ?? '');
  return Number.isNaN(ms) ? null : ms;
}

// Human labels. Short `label` sits under the axis; `tooltipLabel` names the
// exact day / week range / month on hover.
function formatLabels(key, granularity) {
  const start = dateStringToUtcDate(bucketStartDate(key, granularity));
  const short = (d, opts) => d.toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

  if (granularity === 'month') {
    return {
      label: short(start, { month: 'short', year: '2-digit' }),
      tooltipLabel: short(start, { month: 'long', year: 'numeric' }),
    };
  }
  if (granularity === 'week') {
    const end = dateStringToUtcDate(addUtcDays(key, 6));
    return {
      label: short(start, { month: 'numeric', day: 'numeric' }),
      tooltipLabel: `Week of ${short(start, { month: 'short', day: 'numeric', year: 'numeric' })} (Mon) – ${short(end, { month: 'short', day: 'numeric' })}`,
    };
  }
  return {
    label: short(start, { month: 'numeric', day: 'numeric' }),
    tooltipLabel: short(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

// The oldest bucket a granularity is allowed to render: the one containing
// SALES_DATA_START_DATE. Bucket keys are lexicographically ordered within a
// granularity ('YYYY-MM-DD' for day/week, 'YYYY-MM' for month), so callers can
// compare against this with a plain string comparison.
//
// Note the week case: Feb 1 2026 is a SUNDAY, so the earliest week bucket is
// the Monday of 2026-01-26 and therefore straddles the cutoff. That bar is
// intentionally kept (it holds a real in-range day), but the order loop below
// still discards the Jan 26–31 portion so no pre-cutoff money is ever shown.
export function floorBucketKey(granularity) {
  return bucketKey(SALES_DATA_START_DATE, granularity);
}

// Build the trailing series of `count` buckets ending with the one containing
// `now`, oldest first. Empty buckets are included so gaps read as $0 rather
// than silently collapsing the time axis. The window is clamped at
// SALES_DATA_START_DATE, so the result may be shorter than `count` — and is
// empty when `now` predates the start of tracked history.
export function buildSalesSeries({ orders = [], granularity = 'day', count, now = new Date() } = {}) {
  if (!GRANULARITIES.includes(granularity)) throw new Error(`unknown granularity: ${granularity}`);
  const bucketCount = Number(count) > 0 ? Math.floor(count) : DEFAULT_BUCKET_COUNT[granularity];

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const currentKey = bucketKey(venueDateString(nowMs), granularity);
  const floorKey = floorBucketKey(granularity);

  // Entirely before tracked history — there is nothing legitimate to plot.
  if (currentKey < floorKey) return [];

  const keys = [currentKey];
  for (let i = 1; i < bucketCount; i += 1) {
    const prev = previousBucket(keys[0], granularity);
    if (prev < floorKey) break;
    keys.unshift(prev);
  }

  const totals = new Map(keys.map((k) => [k, { grossCents: 0, ordersCount: 0 }]));

  for (const row of orders) {
    if (!row) continue;
    const status = typeof row.status === 'string' ? row.status.toLowerCase() : row.status;
    if (status !== REVENUE_STATUS) continue;

    const ms = orderSaleInstantMs(row);
    if (ms == null) continue;

    // Independent of the bucket clamp: an order placed before tracked history
    // never counts, even when its bucket survives (see floorBucketKey's note on
    // the straddling first week).
    const saleDate = venueDateString(ms);
    if (saleDate < SALES_DATA_START_DATE) continue;

    // Orders older than the window (or, defensively, dated in the future) have
    // no bar to land in and are dropped rather than skewing an edge bucket.
    const bucket = totals.get(bucketKey(saleDate, granularity));
    if (!bucket) continue;

    bucket.grossCents += Math.max(0, Math.round(Number(row.total_paid_cents) || 0));
    bucket.ordersCount += 1;
  }

  return keys.map((key) => ({
    key,
    startDate: bucketStartDate(key, granularity),
    ...formatLabels(key, granularity),
    ...totals.get(key),
  }));
}

// Precompute every granularity in one pass so the client can toggle between
// tabs without a refetch. Returns { day: [...], week: [...], month: [...] }.
export function buildAllSalesSeries({ orders = [], now = new Date() } = {}) {
  return Object.fromEntries(
    GRANULARITIES.map((granularity) => [granularity, buildSalesSeries({ orders, granularity, now })]),
  );
}

// Earliest venue-local date any default window reaches back to, as a UTC ISO
// instant. The page uses this to bound its Supabase query instead of reading
// the whole order table. Clamped at SALES_DATA_START_DATE so we never even ask
// the database for orders predating tracked history.
export function earliestWindowStartIso(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const today = venueDateString(nowMs);

  const starts = GRANULARITIES.map((granularity) => {
    let key = bucketKey(today, granularity);
    for (let i = 1; i < DEFAULT_BUCKET_COUNT[granularity]; i += 1) key = previousBucket(key, granularity);
    return bucketStartDate(key, granularity);
  });

  const windowStart = starts.sort()[0];
  const earliest = windowStart < SALES_DATA_START_DATE ? SALES_DATA_START_DATE : windowStart;
  // Widen by a day so an order near the venue-local boundary is never excluded
  // by the UTC comparison Postgres does on created_at.
  return `${addUtcDays(earliest, -1)}T00:00:00.000Z`;
}

// PostgREST clamps every response to the project's `max-rows` setting (1000 by
// default on Supabase) and silently IGNORES a larger `.limit()` — the request
// still returns 200, just short. One request therefore cannot be trusted to
// return a whole window once the table outgrows that cap, so the order read is
// paged until a page comes back empty.
export const ORDER_PAGE_SIZE = 1000;

// Purely a runaway guard: 200k orders is far beyond anything this venue will
// plot in a 12-month window.
const MAX_ORDER_PAGES = 200;

// Read every row of the chart's window through `fetchPage({ from, to })`, which
// the caller wires to a `.range()`-bounded Supabase query. Injected so this
// stays I/O-free and testable, the same split lib/tt-order-backfill.js uses.
//
// `fetchPage` MUST apply a total order (see the analytics page) — offset paging
// over an unordered query repeats and skips rows between requests.
export async function fetchAllOrderPages({ fetchPage, pageSize = ORDER_PAGE_SIZE } = {}) {
  const orders = [];

  for (let request = 0; request < MAX_ORDER_PAGES; request += 1) {
    // The next offset is however many rows we have actually received, not
    // `request * pageSize`: the server may hand back fewer than we asked for
    // because of its own cap, which is the very thing being worked around. So a
    // short page cannot be treated as the last one — only an empty page ends the
    // read, at the cost of one extra request.
    const rows = await fetchPage({ from: orders.length, to: orders.length + pageSize - 1 });
    if (!rows?.length) break;
    orders.push(...rows);
  }

  return orders;
}

// Totals across a series, for the chart's summary line.
export function summarizeSeries(series = []) {
  return series.reduce(
    (acc, b) => ({
      grossCents: acc.grossCents + b.grossCents,
      ordersCount: acc.ordersCount + b.ordersCount,
    }),
    { grossCents: 0, ordersCount: 0 },
  );
}
