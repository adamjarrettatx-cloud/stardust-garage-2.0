// Pure data helpers for the owner-only Financial Calendar (MVP).
//
// The Financial Calendar tracks INCOME ONLY, sourced today from the existing
// read-only TicketTailor metrics cache (public.event_ticket_metrics, normalized
// by lib/event-analytics.js). Everything here is a pure function over plain
// data shapes — no I/O, no secrets — so it is fully unit-testable and safe to
// import anywhere server-side.
//
// MONEY is integer minor units (cents), matching TicketTailor and
// lib/event-analytics.js. Conversion to USD happens only at the render edge via
// centsToUsd().
//
// EXTENSION POINT (SpotOn CSV, deferred): each calendar entry carries an
// `incomeSources` array so additional income providers can be layered in later
// WITHOUT changing the entry shape or the month-summary math. Today the only
// contributor is TicketTailor. `mergeIncomeSources()` is the single seam a
// future SpotOn importer plugs into — see buildIncomeEntry(). Forecasting is
// intentionally NOT implemented: future events show ACTUAL sales-to-date only.

import { normalizeCachedMetrics } from './event-analytics.js';

// Coarse per-entry state so the UI can render the right empty/error/zero
// treatment instead of guessing. Ordered roughly best → needs-attention.
export const ENTRY_STATE = {
  OK: 'ok',                       // TT-linked, refreshed, has real income
  ZERO: 'zero',                   // TT-linked, refreshed, genuine $0 so far
  PENDING: 'pending',             // TT-linked but never refreshed yet
  UNLINKED: 'unlinked',           // no TicketTailor series linked
  NOT_CONFIGURED: 'not_configured', // TT series linked but no API key in env
  ERROR: 'error',                 // last refresh attempt failed
};

// Classify a normalized metrics object (or null) for a TT-linked event.
function classifyMetrics(m) {
  if (!m) return ENTRY_STATE.PENDING;
  if (m.status === 'error') return ENTRY_STATE.ERROR;
  if (m.status === 'not_configured') return ENTRY_STATE.NOT_CONFIGURED;
  if (m.status === 'ok') return m.hasData ? ENTRY_STATE.OK : ENTRY_STATE.ZERO;
  return ENTRY_STATE.PENDING;
}

// Normalize an event's date to a `YYYY-MM-DD` string (or null). Accepts the
// raw column value which is already a date string in this codebase.
function toDateString(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

// Merge the income contributions from every configured source into a single
// income rollup. Today the only source is TicketTailor; a future SpotOn CSV
// source appends another object of the same shape and the totals just add up.
//   sources: [{ source, grossCents, ticketsSold, ordersCount, ... }]
export function mergeIncomeSources(sources = []) {
  return sources.filter(Boolean).reduce(
    (acc, s) => ({
      grossCents: acc.grossCents + (Number(s.grossCents) || 0),
      ticketsSold: acc.ticketsSold + (Number(s.ticketsSold) || 0),
      ordersCount: acc.ordersCount + (Number(s.ordersCount) || 0),
    }),
    { grossCents: 0, ticketsSold: 0, ordersCount: 0 },
  );
}

// Build a single TicketTailor income-source object from a normalized metrics
// row. Isolated so a SpotOn importer can mirror this shape later.
function ticketTailorIncomeSource(metrics) {
  if (!metrics) return null;
  return {
    source: 'tickettailor',
    grossCents: metrics.grossCents,
    ticketsSold: metrics.ticketsSold,
    ordersCount: metrics.ordersCount,
    feesCents: metrics.feesCents,
    netCents: metrics.netCents,
    fetchedAt: metrics.fetchedAt,
  };
}

// Build a single calendar income entry for one event.
//   event   — { id, title, event_date, category, status, tt_event_series_id }
//   metrics — raw event_ticket_metrics row (or undefined) for that event
//   today   — Date used to decide past vs. upcoming (defaults to now)
export function buildIncomeEntry(event, metricsRow, today = new Date()) {
  const eventDate = toDateString(event.event_date);
  const ttLinked = Boolean(event.tt_event_series_id);
  const normalized = normalizeCachedMetrics(metricsRow);
  const state = ttLinked ? classifyMetrics(normalized) : ENTRY_STATE.UNLINKED;

  const ttSource = ttLinked ? ticketTailorIncomeSource(normalized) : null;
  const incomeSources = [ttSource].filter(Boolean);
  const totals = mergeIncomeSources(incomeSources);

  const todayStr = toDateString(today.toISOString ? today.toISOString() : today);
  const isFuture = Boolean(eventDate && todayStr && eventDate > todayStr);

  return {
    id: event.id,
    title: event.title,
    eventDate,
    category: event.category || 'other',
    eventStatus: event.status || null,
    ttLinked,
    // True when this entry is backed by a local public.events row (so the UI can
    // deep-link to /bananas/events/:id). TicketTailor-only discovered events set
    // this false — there is no local page to link to.
    hasLocalEvent: true,
    state,
    isFuture,
    // Income totals (income-only MVP). grossCents is the headline figure.
    grossCents: totals.grossCents,
    ticketsSold: totals.ticketsSold,
    ordersCount: totals.ordersCount,
    // TicketTailor-specific breakdown for the detail view (net/fees are still
    // income-side, not expenses). Null when unlinked/unrefreshed.
    feesCents: ttSource ? ttSource.feesCents : null,
    netCents: ttSource ? ttSource.netCents : null,
    fetchedAt: ttSource ? ttSource.fetchedAt : null,
    // True once a source produced real, countable income.
    hasIncome: state === ENTRY_STATE.OK,
    incomeSources,
  };
}

// Synthetic entry id for a TicketTailor-only event so it never collides with a
// local event UUID and the UI can detect it has no local page.
export function discoveredEntryId(ttEventSeriesId) {
  return `tt:${ttEventSeriesId}`;
}

// Build a calendar entry for a TicketTailor-only discovered event (a row from
// public.tt_discovered_events). The row already carries the same money/status
// columns as event_ticket_metrics, so it doubles as its own "metrics row" and
// reuses buildIncomeEntry's classification/aggregation verbatim.
export function buildDiscoveredIncomeEntry(row, today = new Date()) {
  const pseudoEvent = {
    id: discoveredEntryId(row.tt_event_series_id),
    title: row.title || 'TicketTailor event',
    event_date: row.event_date,
    category: 'other',
    status: null,
    tt_event_series_id: row.tt_event_series_id,
  };
  const entry = buildIncomeEntry(pseudoEvent, row, today);
  entry.hasLocalEvent = false;
  entry.ttEventSeriesId = row.tt_event_series_id;
  return entry;
}

// Build the full set of calendar income entries. Pure: the caller supplies
// events + metrics rows already fetched. Metrics are keyed by event_id.
// `discovered` are TicketTailor-only events (public.tt_discovered_events); each
// is included ONLY when its series is not already represented by a local event,
// so a linked event is never double-counted. Sorted by event_date ascending.
export function buildFinancialCalendar({ events = [], metrics = [], discovered = [], today = new Date() } = {}) {
  const metricsByEvent = {};
  for (const m of metrics) {
    if (m && m.event_id) metricsByEvent[m.event_id] = m;
  }

  const localEntries = events.map((ev) => buildIncomeEntry(ev, metricsByEvent[ev.id], today));

  // Series already covered by a local event — skip the discovered duplicate.
  const localSeries = new Set(
    events.map((ev) => ev.tt_event_series_id).filter(Boolean),
  );
  const discoveredEntries = discovered
    .filter((row) => row && row.tt_event_series_id
      && !row.local_event_id
      && !localSeries.has(row.tt_event_series_id))
    .map((row) => buildDiscoveredIncomeEntry(row, today));

  return [...localEntries, ...discoveredEntries]
    .sort((a, b) => String(a.eventDate || '').localeCompare(String(b.eventDate || '')));
}

// Entries that fall within a given month (0-indexed month, matching JS Date).
export function entriesInMonth(entries = [], year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return entries.filter((e) => e.eventDate && e.eventDate.startsWith(prefix));
}

// Roll up income totals for a set of entries (typically one month's worth).
// Only entries with real income contribute to money/ticket sums; every other
// state is surfaced for empty/attention treatment but never fabricates a value.
export function summarizeIncome(entries = []) {
  const summary = entries.reduce(
    (acc, e) => {
      acc.eventCount += 1;
      if (e.hasIncome) {
        acc.revenueEvents += 1;
        acc.grossCents += e.grossCents;
        acc.ticketsSold += e.ticketsSold;
        acc.ordersCount += e.ordersCount;
      }
      if (e.fetchedAt && (!acc.lastUpdated || e.fetchedAt > acc.lastUpdated)) {
        acc.lastUpdated = e.fetchedAt;
      }
      return acc;
    },
    {
      eventCount: 0,
      revenueEvents: 0,
      grossCents: 0,
      ticketsSold: 0,
      ordersCount: 0,
      lastUpdated: null,
    },
  );
  return summary;
}
