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
