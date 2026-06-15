// Pure analytics + projection helpers for event financials.
//
// Everything here is a pure function over plain data shapes (the arrays
// returned by lib/tickettailor.js read helpers). No I/O, no secrets — so this
// is fully unit-testable and safe to import anywhere server-side.
//
// TicketTailor money fields are integer minor units (cents). We keep cents
// internally and only convert at the formatting boundary.

// Sum gross revenue (cents) from an array of TT orders.
// Orders look like: { status, total: <cents>, total_payment_fee, ... }
export function grossRevenueCents(orders = []) {
  return orders
    .filter((o) => o && o.status !== 'cancelled' && o.status !== 'refunded')
    .reduce((sum, o) => sum + toCents(o.total), 0);
}

// Total TicketTailor/processor fees (cents).
export function totalFeesCents(orders = []) {
  return orders
    .filter((o) => o && o.status !== 'cancelled' && o.status !== 'refunded')
    .reduce((sum, o) => sum + toCents(o.total_payment_fee) + toCents(o.booking_fee), 0);
}

// Net revenue after fees (cents).
export function netRevenueCents(orders = []) {
  return grossRevenueCents(orders) - totalFeesCents(orders);
}

// Count of valid (non-void) issued tickets => attendance.
export function ticketsSold(issuedTickets = []) {
  return issuedTickets.filter((t) => t && t.status !== 'voided' && t.status !== 'cancelled').length;
}

// Breakdown of tickets sold by ticket_type_id => { [ticketTypeId]: count }.
export function ticketsByType(issuedTickets = []) {
  const out = {};
  for (const t of issuedTickets) {
    if (!t || t.status === 'voided' || t.status === 'cancelled') continue;
    const key = t.ticket_type_id || t.description || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// Sell-through rate against a known capacity (0..1). Returns null if capacity
// is unknown/zero so callers can render "—" instead of NaN.
export function sellThroughRate(issuedTickets = [], capacity) {
  if (!capacity || capacity <= 0) return null;
  return Math.min(1, ticketsSold(issuedTickets) / capacity);
}

// Straight-line projection of final ticket sales for an in-progress on-sale.
//   soldSoFar  — tickets sold to date
//   daysElapsed — days the event has been on sale
//   daysTotal   — total days from on-sale to event date
// Returns a projected final count (>= soldSoFar), capped at capacity if given.
export function projectFinalSales({ soldSoFar, daysElapsed, daysTotal, capacity = null }) {
  if (!Number.isFinite(soldSoFar) || soldSoFar < 0) return 0;
  if (!daysElapsed || daysElapsed <= 0 || !daysTotal || daysTotal <= 0) return soldSoFar;
  const dailyRate = soldSoFar / daysElapsed;
  let projected = Math.round(dailyRate * daysTotal);
  if (projected < soldSoFar) projected = soldSoFar;
  if (capacity && capacity > 0) projected = Math.min(projected, capacity);
  return projected;
}

// Roll a per-event summary object up from raw TT data + optional metadata.
export function summarizeEvent({ orders = [], issuedTickets = [], capacity = null, faceValueCents = null }) {
  const sold = ticketsSold(issuedTickets);
  const gross = grossRevenueCents(orders);
  return {
    ticketsSold: sold,
    ticketsByType: ticketsByType(issuedTickets),
    grossRevenueCents: gross,
    feesCents: totalFeesCents(orders),
    netRevenueCents: netRevenueCents(orders),
    sellThroughRate: sellThroughRate(issuedTickets, capacity),
    // If TT order data is thin, estimate gross from face value as a fallback.
    estimatedGrossCents: gross || (faceValueCents ? faceValueCents * sold : 0),
  };
}

export function centsToUsd(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// ---------------------------------------------------------------------------
// Cached event-metrics normalization (no external API required)
// ---------------------------------------------------------------------------
//
// Rows from public.event_ticket_metrics (populated by the read-only refresh
// route) are normalized into a stable shape the UI can render directly. A row
// may be absent (event never refreshed), so callers pass `undefined`/`null`.

// Normalize a single cached metrics row into a predictable object. Returns
// `null` when there is no cached row, so the UI can show an empty state.
export function normalizeCachedMetrics(row) {
  if (!row) return null;
  const grossCents = toCents(row.gross_cents);
  const feesCents = toCents(row.fees_cents);
  // Prefer the stored net, but fall back to gross - fees if it's missing.
  const netCents = row.net_cents == null ? grossCents - feesCents : toCents(row.net_cents);
  return {
    ticketsSold: toCount(row.tickets_sold),
    ordersCount: toCount(row.orders_count),
    grossCents,
    feesCents,
    netCents,
    attendeesCount: row.attendees_count == null ? null : toCount(row.attendees_count),
    checkinsCount: row.checkins_count == null ? null : toCount(row.checkins_count),
    source: row.source || 'tickettailor',
    status: row.status || 'pending',
    fetchedAt: row.fetched_at || null,
    hasData: row.status === 'ok' && (toCount(row.tickets_sold) > 0 || toCents(row.gross_cents) > 0),
  };
}

// Build per-event performance rows by joining events, their member-discount
// codes, and any cached TicketTailor metrics. Pure: the caller supplies all
// three arrays already fetched. Returns one row per event sorted by event_date
// descending. `metrics` rows are keyed by their event_id.
export function buildEventPerformance({ events = [], codes = [], metrics = [] }) {
  const codesByEvent = groupCodesByEvent(codes);
  const metricsByEvent = {};
  for (const m of metrics) {
    if (m && m.event_id) metricsByEvent[m.event_id] = m;
  }
  return events
    .map((ev) => ({
      id: ev.id,
      title: ev.title,
      eventDate: ev.event_date || null,
      category: ev.category || 'other',
      ttSeriesLinked: Boolean(ev.tt_event_series_id),
      codesGenerated: Boolean(ev.discount_codes_generated),
      memberCodes: summarizeMemberCodes(codesByEvent[ev.id] || []),
      metrics: normalizeCachedMetrics(metricsByEvent[ev.id]),
    }))
    .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')));
}

// Roll portfolio-wide totals up from the rows produced by
// buildEventPerformance(). Only rows with usable cached metrics contribute to
// the revenue figures; member-code counts always contribute.
export function summarizePerformanceTotals(rows = []) {
  return rows.reduce(
    (acc, r) => {
      acc.events += 1;
      acc.ttLinked += r.ttSeriesLinked ? 1 : 0;
      acc.memberCodes += r.memberCodes.total;
      acc.codesSent += r.memberCodes.sent;
      if (r.metrics && r.metrics.hasData) {
        acc.eventsWithMetrics += 1;
        acc.ticketsSold += r.metrics.ticketsSold;
        acc.ordersCount += r.metrics.ordersCount;
        acc.grossCents += r.metrics.grossCents;
        acc.feesCents += r.metrics.feesCents;
        acc.netCents += r.metrics.netCents;
      }
      return acc;
    },
    {
      events: 0,
      ttLinked: 0,
      eventsWithMetrics: 0,
      memberCodes: 0,
      codesSent: 0,
      ticketsSold: 0,
      ordersCount: 0,
      grossCents: 0,
      feesCents: 0,
      netCents: 0,
    },
  );
}

function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// Build a row ready to upsert into public.event_ticket_metrics from raw TT
// data already fetched by the read-only helpers in lib/tickettailor.js. Pure:
// no I/O, so the refresh route stays thin and this is unit-testable. The
// caller supplies the local event id + series id and the fetched arrays.
export function buildMetricsSnapshot({ eventId, ttEventSeriesId = null, orders = [], issuedTickets = [], fetchedAt = null }) {
  const summary = summarizeEvent({ orders, issuedTickets });
  return {
    event_id: eventId,
    tt_event_series_id: ttEventSeriesId,
    tickets_sold: summary.ticketsSold,
    orders_count: orders.filter((o) => o && o.status !== 'cancelled' && o.status !== 'refunded').length,
    gross_cents: summary.grossRevenueCents,
    fees_cents: summary.feesCents,
    net_cents: summary.netRevenueCents,
    source: 'tickettailor',
    status: 'ok',
    error_detail: null,
    fetched_at: fetchedAt || new Date().toISOString(),
    raw_summary: { ticketsByType: summary.ticketsByType },
  };
}

// ---------------------------------------------------------------------------
// Local member-discount-code analytics (no external API required)
// ---------------------------------------------------------------------------
//
// These operate purely on rows from public.member_discount_codes + events that
// already live in our own database, so the dashboard renders real numbers
// without any TicketTailor credentials. Each row shape (subset):
//   { event_id, member_id, discount_percent, sent_at, send_scheduled_for }

// Per-event rollup of member-code distribution. Returns
//   { total, sent, pending, avgDiscountPercent }
export function summarizeMemberCodes(codes = []) {
  const valid = codes.filter(Boolean);
  const total = valid.length;
  const sent = valid.filter((c) => c.sent_at).length;
  const percents = valid
    .map((c) => Number(c.discount_percent))
    .filter((n) => Number.isFinite(n));
  const avgDiscountPercent = percents.length
    ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length)
    : null;
  return { total, sent, pending: total - sent, avgDiscountPercent };
}

// Group a flat list of member-code rows by event_id => array of rows.
export function groupCodesByEvent(codes = []) {
  const out = {};
  for (const c of codes) {
    if (!c || !c.event_id) continue;
    (out[c.event_id] ||= []).push(c);
  }
  return out;
}

// Build per-event analytics rows from events + their member codes. Pure: the
// caller supplies both arrays (already fetched). Returns one row per event with
// the local code metrics, sorted by event_date descending.
export function buildEventAnalytics({ events = [], codes = [] }) {
  const byEvent = groupCodesByEvent(codes);
  return events
    .map((ev) => ({
      id: ev.id,
      title: ev.title,
      eventDate: ev.event_date || null,
      category: ev.category || 'other',
      ttSeriesLinked: Boolean(ev.tt_event_series_id),
      codesGenerated: Boolean(ev.discount_codes_generated),
      memberCodes: summarizeMemberCodes(byEvent[ev.id] || []),
    }))
    .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')));
}

function toCents(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
