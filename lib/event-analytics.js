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

function toCents(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
