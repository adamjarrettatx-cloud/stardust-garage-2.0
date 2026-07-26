// Pure helpers for the one-time historical TicketTailor order backfill
// (scripts/backfill-ticket-order-attribution.mjs).
//
// WHY THIS EXISTS: public.ticket_order_attribution was created on 2026-07-25 by
// the Mailchimp attribution migration and is only ever written by the live
// webhook (app/api/webhooks/tickettailor/route.js). It therefore holds no rows
// predating its own creation, which is why the sales chart at /bananas/analytics
// reads $0 for Feb–Jun 2026 despite real ticket sales in that period.
//
// Everything here is a pure function over plain data shapes — the raw order
// objects returned by TicketTailor's GET /v1/orders. No I/O, no secrets, so it
// is fully unit-testable; the script supplies the API and Supabase calls.
// Follows the same lib/route split as lib/tt-discovered-events.js.
//
// The row mapping below MIRRORS the webhook's upsert field-for-field, so a
// backfilled row is indistinguishable from a webhook-written one — with two
// deliberate exceptions, documented at buildAttributionRow().

import { SALES_DATA_START_DATE, venueDateString } from './ticket-sales-timeseries.js';

// The backfill covers exactly the range the chart is willing to render, so we
// never insert rows the UI would discard anyway. Sharing the constant means a
// future change to tracked history moves both in lockstep.
export const BACKFILL_START_DATE = SALES_DATA_START_DATE;

// The instant a TicketTailor order was placed, in epoch ms, or null when
// unusable. TT sends `created_at` as unix SECONDS on the order object — the
// webhook reads it the same way (`new Date(order.created_at * 1000)`) when
// syncing to Mailchimp, and it is what lands in raw_payload->>created_at for
// lib/ticket-sales-timeseries.js to bucket by. An ISO string is accepted as a
// fallback so a shape change does not silently drop every order.
export function ttOrderCreatedMs(order) {
  const raw = order?.created_at;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  // Only strings get the ISO fallback. Date.parse coerces its argument, so a
  // numeric 0 would stringify to '0' and parse as the year 2000 rather than
  // being rejected.
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

// One raw TT order -> one ticket_order_attribution row, or null when the order
// cannot be keyed (no id) or placed in time (no usable timestamp). Both are
// useless for a revenue chart, so they are dropped and counted rather than
// written with invented values.
//
// `localEventIdBySeriesId` maps events.tt_event_series_id -> events.id,
// reproducing the per-order lookup the webhook does against the events table.
//
// Two deliberate differences from the webhook:
//   1. `created_at` is set explicitly to the order's real historical timestamp.
//      The column defaults to now(), so omitting it would stamp every
//      backfilled order with the run date and leave the chart just as wrong.
//   2. Mailchimp attribution columns (matched_mc_cid, matched_click_id,
//      mailchimp_synced, mailchimp_sync_error) are left at their defaults.
//      Retroactive click matching is out of scope and the click table has no
//      history for this period either; this backfill is about revenue only.
export function buildAttributionRow(order, { localEventIdBySeriesId = new Map() } = {}) {
  const ttOrderId = order?.id;
  if (!ttOrderId) return null;

  const createdMs = ttOrderCreatedMs(order);
  if (createdMs == null) return null;

  const seriesId = order.event_summary?.event_series_id || null;
  const rawTotal = Number(order.total_paid ?? order.total ?? 0);

  return {
    tt_order_id: String(ttOrderId),
    tt_event_id: order.event_summary?.event_id || null,
    local_event_id: (seriesId && localEventIdBySeriesId.get(seriesId)) || null,
    buyer_email: order.buyer_details?.email || null,
    // TT's total_paid is already minor units; the webhook does no scaling and
    // neither do we. Clamped at 0 because total_paid_cents carries a
    // `check (total_paid_cents >= 0)` — a stray negative would abort the whole
    // batch insert rather than just its own row.
    total_paid_cents: Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : 0,
    currency: order.currency?.code?.toUpperCase() || 'USD',
    status: typeof order.status === 'string' ? order.status.toLowerCase() : order.status ?? null,
    raw_payload: order,
    created_at: new Date(createdMs).toISOString(),
  };
}

// True when an order falls inside the backfill window. The lower bound is
// compared as a VENUE-LOCAL date, matching how the chart decides what it will
// render — a UTC comparison would disagree for orders placed late on Jan 31.
export function isInBackfillWindow(order, { startDate = BACKFILL_START_DATE, endMs = Date.now() } = {}) {
  const ms = ttOrderCreatedMs(order);
  if (ms == null) return false;
  if (ms > endMs) return false;
  return venueDateString(ms) >= startDate;
}

// Raw TT orders -> deduped, in-window rows ready to upsert, plus the counts the
// run summary reports. Orders are deduped by tt_order_id (first wins) so a
// repeated page from the API cannot inflate an insert batch.
export function selectBackfillRows(orders = [], options = {}) {
  const rows = [];
  const seen = new Set();
  let outOfWindow = 0;
  let unusable = 0;
  let duplicates = 0;

  for (const order of orders) {
    if (!order) { unusable += 1; continue; }
    if (!isInBackfillWindow(order, options)) { outOfWindow += 1; continue; }

    const row = buildAttributionRow(order, options);
    if (!row) { unusable += 1; continue; }
    if (seen.has(row.tt_order_id)) { duplicates += 1; continue; }

    seen.add(row.tt_order_id);
    rows.push(row);
  }

  // Oldest first, so a run interrupted partway through has filled in history
  // contiguously from the start date rather than leaving a hole in the middle.
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { rows, outOfWindow, unusable, duplicates };
}

// Cursor-paginate TicketTailor's order list, oldest-relevant page last.
//
// `fetchPage({ startingAfter })` is injected so this stays I/O-free and
// testable; the script passes one that calls ttFetch('/orders?...'). It must
// resolve TT's envelope shape: { data: [...], links: { next } }.
//
// We deliberately do NOT ask the API for a server-side date filter. TT's public
// reference renders its query parameters client-side, so the exact spelling of
// any created_at bound could not be confirmed, and guessing wrong on a filter
// param fails silently — the API would ignore it and we would never know the
// window was not applied. Local filtering is unambiguous and cheap.
//
// TT returns orders newest first, so once an entire page predates the start
// date there is nothing older worth walking to.
export async function paginateOrders({ fetchPage, startDate = BACKFILL_START_DATE, maxPages = 200, onPage } = {}) {
  const orders = [];
  let startingAfter = null;
  let pages = 0;
  let stoppedEarly = false;

  while (pages < maxPages) {
    const result = await fetchPage({ startingAfter });
    const page = result?.data || [];
    pages += 1;
    if (page.length === 0) break;

    orders.push(...page);
    if (onPage) onPage({ page: pages, received: page.length, total: orders.length });

    const allBeforeStart = page.every((order) => {
      const ms = ttOrderCreatedMs(order);
      return ms != null && venueDateString(ms) < startDate;
    });
    if (allBeforeStart) { stoppedEarly = true; break; }

    if (!result?.links?.next) break;
    startingAfter = page[page.length - 1]?.id;
    if (!startingAfter) break;
  }

  // Only a real cap hit is worth warning about — stopping because we walked
  // past the start date is the intended exit.
  return { orders, pages, stoppedEarly, hitPageCap: !stoppedEarly && pages >= maxPages };
}

// Split rows into insert batches. Keeps a single statement small enough to
// avoid a statement timeout on a few thousand orders with full raw payloads.
export function chunkRows(rows = [], size = 200) {
  const limit = Number(size) > 0 ? Math.floor(size) : 200;
  const out = [];
  for (let i = 0; i < rows.length; i += limit) out.push(rows.slice(i, i + limit));
  return out;
}

// The venue-local date range the selected rows actually cover, for the summary
// line. Null when nothing was selected.
export function coveredDateRange(rows = []) {
  if (rows.length === 0) return null;
  const dates = rows.map((r) => venueDateString(Date.parse(r.created_at))).sort();
  return { first: dates[0], last: dates[dates.length - 1] };
}

// Totals for the summary, so a dry run reports the money it would add.
export function summarizeRows(rows = []) {
  return rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      grossCents: acc.grossCents + (r.status === 'completed' ? r.total_paid_cents : 0),
      completed: acc.completed + (r.status === 'completed' ? 1 : 0),
    }),
    { count: 0, grossCents: 0, completed: 0 },
  );
}
