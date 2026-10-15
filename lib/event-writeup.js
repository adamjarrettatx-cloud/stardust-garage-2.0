// Financial Write-Up — pure per-event settlement math.
//
// Mirrors the post-event spreadsheet Adam sends to Event Organizers, with
// one correction the venue agreements require: booking fees belong 100% to
// Stardust Garage, so they are pulled out of online revenue BEFORE the
// organizer percentage is applied.
//
// Money is integer cents throughout. No I/O here — fully unit-testable.
//
//   ONLINE (sdgatx.com orders, computed live)
//     gross         = Σ order total charged (tickets + booking fees + tax)
//     refunds       = Σ refunded to buyers
//     sales tax     = Σ tax collected − Σ tax refunded   (actual, per order)
//     stripe fees   = gross × 2.9% + $0.30 × paid transactions
//     booking fees  = Σ booking fees kept (refunds remove them pro rata)
//     online net    = gross − refunds − tax − stripe − booking fees
//
//   DOOR (POS gross typed in by Adam)
//     sales tax     = door gross × 8.25%
//     cc fees       = door gross × 3.85%
//     door net      = door gross − tax − cc fees
//
//   SETTLEMENT
//     net ticket revenue  = online net + door net
//     gross EO payout     = net ticket revenue × organizer %
//     adjustments         = itemized (+ paid to EO, − charged to EO)
//     net EO payout       = gross EO payout + Σ adjustments
//     Stardust keeps      = net ticket revenue − net EO payout + booking fees

export const WRITEUP_DEFAULTS = Object.freeze({
  door_tax_bps: 825,
  door_cc_fee_bps: 385,
  stripe_pct_bps: 290,
  stripe_fixed_cents: 30,
});

const COUNTED_ORDER_STATUSES = new Set(['paid', 'partial_refund', 'refunded']);

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function bpsOf(cents, bps) {
  return Math.round((int(cents) * int(bps)) / 10000);
}

// Booking fee captured on the checkout hold snapshot: Σ unit fee × quantity.
export function bookingFeeFromHoldItems(items) {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const line of items) {
    const unit = int(line?.booking_fee_unit_cents);
    const qty = int(line?.quantity);
    if (unit > 0 && qty > 0) total += unit * qty;
  }
  return total;
}

// Booking fee still kept after refunds. Full refunds return the whole fee
// (RefundDialog: "Full refunds include ... booking fees and tax"). Partial
// refunds are dollar amounts, so the fee is reduced in proportion to the
// pre-tax amount refunded.
export function keptBookingFeeCents({ bookingFeeCents, totalCents, taxCents, refundedCents, refundedTaxCents }) {
  const fee = Math.max(0, int(bookingFeeCents));
  if (fee === 0) return 0;
  const total = int(totalCents);
  const refunded = int(refundedCents);
  if (refunded <= 0) return fee;
  if (refunded >= total) return 0;
  const preTax = total - int(taxCents);
  const refundedPreTax = refunded - int(refundedTaxCents);
  if (preTax <= 0) return fee;
  const ratio = Math.min(1, Math.max(0, refundedPreTax / preTax));
  return fee - Math.round(fee * ratio);
}

// orders: [{ status, checkout_kind, total_cents, tax_cents, refunded_cents,
//            refunded_tax_cents, booking_fee_cents }]
export function computeOnline(orders = [], { stripePctBps, stripeFixedCents, ticketsSold = 0 } = {}) {
  const pct = stripePctBps ?? WRITEUP_DEFAULTS.stripe_pct_bps;
  const fixed = stripeFixedCents ?? WRITEUP_DEFAULTS.stripe_fixed_cents;
  let gross = 0;
  let refunds = 0;
  let tax = 0;
  let bookingFees = 0;
  let transactions = 0;
  for (const o of orders) {
    if (!o || !COUNTED_ORDER_STATUSES.has(o.status)) continue;
    if (o.checkout_kind === 'comp' || o.checkout_kind === 'save_payment_method') continue;
    const total = int(o.total_cents);
    if (total <= 0) continue;
    transactions += 1;
    gross += total;
    refunds += Math.max(0, int(o.refunded_cents));
    tax += Math.max(0, int(o.tax_cents) - int(o.refunded_tax_cents));
    bookingFees += keptBookingFeeCents({
      bookingFeeCents: o.booking_fee_cents,
      totalCents: total,
      taxCents: o.tax_cents,
      refundedCents: o.refunded_cents,
      refundedTaxCents: o.refunded_tax_cents,
    });
  }
  const stripeFees = transactions > 0 ? bpsOf(gross, pct) + fixed * transactions : 0;
  const net = gross - refunds - tax - stripeFees - bookingFees;
  return {
    ticketsSold: int(ticketsSold),
    transactions,
    grossCents: gross,
    refundsCents: refunds,
    salesTaxCents: tax,
    stripeFeesCents: stripeFees,
    stripePctBps: pct,
    stripeFixedCents: fixed,
    bookingFeesCents: bookingFees,
    netCents: net,
  };
}

export function computeDoor({ doorGrossCents, doorTaxBps, doorCcFeeBps } = {}) {
  const taxBps = doorTaxBps ?? WRITEUP_DEFAULTS.door_tax_bps;
  const ccBps = doorCcFeeBps ?? WRITEUP_DEFAULTS.door_cc_fee_bps;
  const entered = doorGrossCents != null && doorGrossCents !== '';
  const gross = entered ? Math.max(0, int(doorGrossCents)) : 0;
  const tax = bpsOf(gross, taxBps);
  const cc = bpsOf(gross, ccBps);
  return {
    entered,
    grossCents: gross,
    salesTaxCents: tax,
    salesTaxBps: taxBps,
    ccFeesCents: cc,
    ccFeeBps: ccBps,
    netCents: gross - tax - cc,
  };
}

export function normalizeAdjustments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({
      id: typeof a?.id === 'string' && a.id ? a.id.slice(0, 64) : null,
      label: String(a?.label ?? '').trim().slice(0, 120),
      amount_cents: int(a?.amount_cents),
    }))
    .filter((a) => a.label || a.amount_cents !== 0);
}

// Everything after the online roll-up. Shared by the server and the page so
// typed-in values update the totals live before saving.
export function computeSettlement(online, config = {}) {
  const door = computeDoor({
    doorGrossCents: config.door_gross_cents,
    doorTaxBps: config.door_tax_bps,
    doorCcFeeBps: config.door_cc_fee_bps,
  });
  const netTicketRevenueCents = online.netCents + door.netCents;
  const pctRaw = config.organizer_percent;
  const hasOrganizer = pctRaw != null && pctRaw !== '' && Number.isFinite(Number(pctRaw));
  const organizerPercent = hasOrganizer ? Math.min(100, Math.max(0, Number(pctRaw))) : null;
  const grossPayoutCents = hasOrganizer ? Math.round((netTicketRevenueCents * organizerPercent) / 100) : 0;
  const adjustments = normalizeAdjustments(config.adjustments);
  const adjustmentsTotalCents = adjustments.reduce((s, a) => s + a.amount_cents, 0);
  const netPayoutCents = grossPayoutCents + adjustmentsTotalCents;
  const stardustKeepsCents = netTicketRevenueCents - netPayoutCents + online.bookingFeesCents;
  return {
    online,
    door,
    netTicketRevenueCents,
    organizerPercent,
    grossPayoutCents,
    adjustments,
    adjustmentsTotalCents,
    netPayoutCents,
    stardustKeepsCents,
  };
}

export function computeWriteup({ orders = [], ticketsSold = 0, config = {} } = {}) {
  const online = computeOnline(orders, {
    stripePctBps: config.stripe_pct_bps,
    stripeFixedCents: config.stripe_fixed_cents,
    ticketsSold,
  });
  return computeSettlement(online, config);
}
