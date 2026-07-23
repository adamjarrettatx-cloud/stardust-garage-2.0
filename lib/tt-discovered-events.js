// Pure helpers for discovering TicketTailor events that exist ONLY in
// TicketTailor (never mirrored onto the website as a public.events row) and
// caching their income in public.tt_discovered_events.
//
// Everything here is a pure function over plain data shapes — the raw objects
// returned by lib/tickettailor.js read helpers (listEvents / listOrders /
// listIssuedTickets). No I/O, no secrets, so it is fully unit-testable and
// safe to import server-side. Money math is reused verbatim from
// lib/event-analytics.js so discovered events and local events compute income
// identically (integer minor units / cents).
//
// This NEVER writes to TicketTailor and NEVER creates a website event: it only
// reads the TT API and upserts our own internal analytics cache.

import {
  grossRevenueCents,
  totalFeesCents,
  netRevenueCents,
  ticketsSold,
  ticketsByType,
} from './event-analytics.js';

// TicketTailor read payloads carry event date/time as a nested object
// (`start_date: { date: 'YYYY-MM-DD', time, iso, unix, timezone, formatted }`).
// Be defensive: accept the object, a bare ISO/date string, or an older `start`
// alias — returning a { date, iso } pair without inventing values.
export function pickTtDate(startField) {
  if (!startField) return { date: null, iso: null };
  if (typeof startField === 'string') {
    const date = startField.slice(0, 10) || null;
    const iso = startField.length > 10 ? startField : null;
    return { date, iso };
  }
  if (typeof startField === 'object') {
    const rawDate = startField.date || startField.iso || null;
    return {
      date: rawDate ? String(rawDate).slice(0, 10) : null,
      iso: startField.iso || null,
    };
  }
  return { date: null, iso: null };
}

// Normalize one raw TicketTailor event occurrence into the identity fields we
// cache. Returns null when the row has no parent series id (nothing to key on).
export function normalizeTtEvent(ev) {
  if (!ev) return null;
  const seriesId = ev.event_series_id || null;
  if (!seriesId) return null;
  const start = pickTtDate(ev.start_date != null ? ev.start_date : ev.start);
  const name = typeof ev.name === 'string' ? ev.name.trim() : '';
  return {
    ttEventId: ev.id || null,
    ttEventSeriesId: seriesId,
    title: name || null,
    eventDate: start.date,
    startAt: start.iso,
    currency: ev.currency || null,
  };
}

// True when candidate `a` should represent its series over the current pick
// `b`: later event_date wins; a dated occurrence beats an undated one; ties
// break deterministically on ttEventId so repeated runs are stable.
function isBetterRepresentative(a, b) {
  const da = a.eventDate || '';
  const db = b.eventDate || '';
  if (da !== db) return da > db;
  return String(a.ttEventId || '') > String(b.ttEventId || '');
}

// Collapse many occurrences to one representative per series (income is pulled
// per series, so one calendar entry per series avoids double-counting). The
// representative is the series' latest-dated occurrence. Returns an array of
// normalized reps.
export function selectSeriesRepresentatives(events = []) {
  const bySeries = new Map();
  for (const raw of events) {
    const n = normalizeTtEvent(raw);
    if (!n) continue;
    const cur = bySeries.get(n.ttEventSeriesId);
    if (!cur || isBetterRepresentative(n, cur)) bySeries.set(n.ttEventSeriesId, n);
  }
  return [...bySeries.values()];
}

// Identity-only upsert payload. Deliberately OMITS the money/status/fetched_at
// columns so a conflict update preserves any income already pulled for the
// series (on insert those columns take their NOT NULL defaults → a `pending`
// row with $0 until the income pass runs).
export function buildDiscoveredIdentityRow(rep, { localEventId = null } = {}) {
  return {
    tt_event_series_id: rep.ttEventSeriesId,
    tt_event_id: rep.ttEventId,
    title: rep.title,
    event_date: rep.eventDate,
    start_at: rep.startAt,
    currency: rep.currency,
    local_event_id: localEventId,
  };
}

// Income upsert payload for a successful TT pull. Same math/units as
// buildMetricsSnapshot() in lib/event-analytics.js.
export function buildDiscoveredMetricsRow({ ttEventSeriesId, orders = [], issuedTickets = [], fetchedAt = null }) {
  return {
    tt_event_series_id: ttEventSeriesId,
    tickets_sold: ticketsSold(issuedTickets),
    orders_count: orders.filter((o) => o && o.status !== 'cancelled' && o.status !== 'refunded').length,
    gross_cents: grossRevenueCents(orders),
    fees_cents: totalFeesCents(orders),
    net_cents: netRevenueCents(orders),
    source: 'tickettailor',
    status: 'ok',
    error_detail: null,
    fetched_at: fetchedAt || new Date().toISOString(),
    raw_summary: { ticketsByType: ticketsByType(issuedTickets) },
  };
}

// Income upsert payload for a non-ok pull (not_configured / error). Numeric
// columns stay 0; `status` explains why there are no numbers.
export function buildDiscoveredPlaceholderRow({
  ttEventSeriesId,
  status = 'not_configured',
  source = 'placeholder',
  errorDetail = null,
  fetchedAt = null,
}) {
  return {
    tt_event_series_id: ttEventSeriesId,
    tickets_sold: 0,
    orders_count: 0,
    gross_cents: 0,
    fees_cents: 0,
    net_cents: 0,
    source,
    status,
    error_detail: errorDetail,
    fetched_at: fetchedAt || new Date().toISOString(),
    raw_summary: {},
  };
}

// Choose which discovered rows the income pass should refresh this run.
// Batched + resumable: skip series already covered by a local event (the
// existing event_ticket_metrics refresh owns those), then take the `limit`
// stalest rows (never-fetched first, then oldest fetched_at). Ordering here is
// pure so it is unit-testable; the route only supplies already-filtered rows.
export function selectDiscoveredToRefresh(rows = [], { limit = 25 } = {}) {
  return rows
    .filter((r) => r && r.tt_event_series_id && !r.local_event_id)
    .slice()
    .sort((a, b) => {
      const fa = a.fetched_at || '';
      const fb = b.fetched_at || '';
      if (fa === fb) return String(a.tt_event_series_id).localeCompare(String(b.tt_event_series_id));
      return fa < fb ? -1 : 1; // '' (never fetched) sorts first
    })
    .slice(0, Math.max(0, limit));
}
