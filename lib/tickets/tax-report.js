// Pure aggregation used by the owner-facing Texas sales-tax report. Lives in
// lib/ (not the app/api route file) so tests can import it without pulling in
// Next.js server-only modules.
//
// Inputs are plain rows already filtered to paid-like orders; the route
// layer handles auth, date-window SQL, and event-title lookup.

function toMonthKey(iso) {
  // iso like '2026-09-07T...' → '2026-09'.
  if (!iso) return 'unknown';
  return String(iso).slice(0, 7);
}

// Roll up a list of order rows into totals + per-month + per-event
// breakdowns. Every field is integer cents; dollars stay in the UI layer.
//   orders: [{ event_id, status, total_cents, tax_cents, refunded_cents,
//             refunded_tax_cents, paid_at, created_at }]
//   titles: Map<event_id, { title, event_date }>
export function aggregateTaxReport(orders = [], titles = new Map()) {
  let taxCollectedCents = 0;
  let taxRefundedCents = 0;
  let grossCents = 0;
  let refundedCents = 0;
  const byMonth = new Map();
  const byEvent = new Map();

  for (const o of orders) {
    const tax = o.tax_cents || 0;
    const taxRef = o.refunded_tax_cents || 0;
    const gross = o.total_cents || 0;
    const ref = o.refunded_cents || 0;
    taxCollectedCents += tax;
    taxRefundedCents += taxRef;
    grossCents += gross;
    refundedCents += ref;

    const mk = toMonthKey(o.paid_at || o.created_at);
    const m = byMonth.get(mk) || { month: mk, tax_collected_cents: 0, tax_refunded_cents: 0, net_tax_owed_cents: 0, orders_count: 0 };
    m.tax_collected_cents += tax;
    m.tax_refunded_cents += taxRef;
    m.net_tax_owed_cents = m.tax_collected_cents - m.tax_refunded_cents;
    m.orders_count += 1;
    byMonth.set(mk, m);

    const ekey = o.event_id || 'unknown';
    const meta = titles.get(o.event_id) || {};
    const e = byEvent.get(ekey) || {
      event_id: o.event_id,
      title: meta.title || '(unknown event)',
      event_date: meta.event_date || null,
      tax_collected_cents: 0,
      tax_refunded_cents: 0,
      net_tax_owed_cents: 0,
      orders_count: 0,
    };
    e.tax_collected_cents += tax;
    e.tax_refunded_cents += taxRef;
    e.net_tax_owed_cents = e.tax_collected_cents - e.tax_refunded_cents;
    e.orders_count += 1;
    byEvent.set(ekey, e);
  }

  return {
    totals: {
      tax_collected_cents: taxCollectedCents,
      tax_refunded_cents: taxRefundedCents,
      net_tax_owed_cents: taxCollectedCents - taxRefundedCents,
      gross_cents: grossCents,
      refunded_cents: refundedCents,
      orders_count: orders.length,
    },
    by_month: Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month)),
    by_event: Array.from(byEvent.values()).sort((a, b) => b.net_tax_owed_cents - a.net_tax_owed_cents),
  };
}
