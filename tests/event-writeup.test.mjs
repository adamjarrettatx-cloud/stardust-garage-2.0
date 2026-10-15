import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWriteup, computeOnline, computeDoor, keptBookingFeeCents, bookingFeeFromHoldItems } from '../lib/event-writeup.js';

test('door math matches the post-event spreadsheet', () => {
  const d = computeDoor({ doorGrossCents: 674500 });
  assert.equal(d.salesTaxCents, 55646);
  assert.equal(d.ccFeesCents, 25968);
  assert.equal(d.netCents, 592886);
});

test('stripe fee is 2.9% of gross plus 30c per transaction', () => {
  const orders = [
    { status: 'paid', total_cents: 2000, tax_cents: 150, refunded_cents: 0, booking_fee_cents: 295 },
    { status: 'paid', total_cents: 4000, tax_cents: 300, refunded_cents: 0, booking_fee_cents: 590 },
  ];
  const o = computeOnline(orders, {});
  assert.equal(o.transactions, 2);
  assert.equal(o.stripeFeesCents, Math.round(6000 * 0.029) + 60);
  assert.equal(o.bookingFeesCents, 885);
  assert.equal(o.salesTaxCents, 450);
  assert.equal(o.netCents, 6000 - 450 - o.stripeFeesCents - 885);
});

test('comps and $0 orders are excluded', () => {
  const o = computeOnline([
    { status: 'paid', checkout_kind: 'comp', total_cents: 0 },
    { status: 'paid', total_cents: 0 },
    { status: 'pending', total_cents: 5000 },
  ]);
  assert.equal(o.transactions, 0);
  assert.equal(o.grossCents, 0);
  assert.equal(o.stripeFeesCents, 0);
});

test('full refund removes booking fee and tax; partial refund prorates the fee', () => {
  assert.equal(keptBookingFeeCents({ bookingFeeCents: 295, totalCents: 1943, taxCents: 148, refundedCents: 1943, refundedTaxCents: 148 }), 0);
  assert.equal(keptBookingFeeCents({ bookingFeeCents: 590, totalCents: 4000, taxCents: 300, refundedCents: 1850, refundedTaxCents: 0 }), 295);
  const o = computeOnline([{ status: 'refunded', total_cents: 1943, tax_cents: 148, refunded_cents: 1943, refunded_tax_cents: 148, booking_fee_cents: 295 }]);
  assert.equal(o.salesTaxCents, 0);
  assert.equal(o.bookingFeesCents, 0);
  assert.equal(o.refundsCents, 1943);
});

test('hold items produce booking fee totals', () => {
  assert.equal(bookingFeeFromHoldItems([{ quantity: 2, booking_fee_unit_cents: 295 }, { quantity: 1, booking_fee_unit_cents: 0 }]), 590);
  assert.equal(bookingFeeFromHoldItems(null), 0);
});

test('organizer payout: percentage of net ticket revenue plus itemized adjustments', () => {
  const w = computeWriteup({
    orders: [{ status: 'paid', total_cents: 10000, tax_cents: 762, refunded_cents: 0, booking_fee_cents: 590 }],
    config: {
      door_gross_cents: 674500,
      organizer_percent: 20,
      adjustments: [
        { label: 'Artist pay', amount_cents: 120000 },
        { label: 'Beverage', amount_cents: -35000 },
      ],
    },
  });
  const net = w.online.netCents + 592886;
  assert.equal(w.netTicketRevenueCents, net);
  assert.equal(w.grossPayoutCents, Math.round(net * 0.2));
  assert.equal(w.netPayoutCents, w.grossPayoutCents + 85000);
  assert.equal(w.stardustKeepsCents, net - w.netPayoutCents + 590);
});

test('no organizer percent means no payout', () => {
  const w = computeWriteup({ orders: [], config: { door_gross_cents: 10000 } });
  assert.equal(w.organizerPercent, null);
  assert.equal(w.netPayoutCents, 0);
});

import { computeTicketTailorOnline } from '../lib/event-writeup.js';

test('legacy Ticket Tailor event uses the frozen snapshot (matches retired page)', () => {
  const w = computeWriteup({
    config: {},
    ticketTailor: {
      metrics: { tickets_sold: 109, orders_count: 80, gross_cents: 342557, fees_cents: 0, status: 'ok', fetched_at: '2026-10-15T06:23:00Z' },
      perTicketFeeCents: 52,
    },
  });
  assert.equal(w.online.source, 'tickettailor');
  assert.equal(w.online.perTicketFeesTotalCents, 5668);
  assert.equal(w.online.netCents, 336889);
  assert.equal(w.online.bookingFeesCents, 0);
  assert.equal(w.stardustKeepsCents, 336889);
});

test('Ticket Tailor online plus typed door sales settle with the organizer', () => {
  const w = computeWriteup({
    config: { door_gross_cents: 100000, organizer_percent: 50 },
    ticketTailor: { metrics: { tickets_sold: 10, gross_cents: 20000, fees_cents: 1000 }, perTicketFeeCents: 52 },
  });
  // online net = 20000 - 1000 - 520 = 18480; door net = 100000 - 8250 - 3850 = 87900
  assert.equal(w.online.netCents, 18480);
  assert.equal(w.netTicketRevenueCents, 106380);
  assert.equal(w.netPayoutCents, 53190);
  assert.equal(w.stardustKeepsCents, 53190);
});

test('Ticket Tailor net never goes below zero', () => {
  assert.equal(computeTicketTailorOnline({ tickets_sold: 5, gross_cents: 100, fees_cents: 500 }).netCents, 0);
});

test('sdgatx.com events are tagged as such', () => {
  assert.equal(computeOnline([]).source, 'sdgatx');
});
