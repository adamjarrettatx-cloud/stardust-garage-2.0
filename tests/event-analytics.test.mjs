import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grossRevenueCents,
  totalFeesCents,
  netRevenueCents,
  ticketsSold,
  ticketsByType,
  sellThroughRate,
  projectFinalSales,
  summarizeEvent,
  centsToUsd,
} from '../lib/event-analytics.js';

const orders = [
  { status: 'completed', total: 5000, total_payment_fee: 150, booking_fee: 50 },
  { status: 'completed', total: 2500, total_payment_fee: 75, booking_fee: 25 },
  { status: 'refunded',  total: 9999, total_payment_fee: 300, booking_fee: 0 },
];

const issued = [
  { status: 'valid', ticket_type_id: 'GA' },
  { status: 'valid', ticket_type_id: 'GA' },
  { status: 'valid', ticket_type_id: 'VIP' },
  { status: 'voided', ticket_type_id: 'GA' },
];

test('grossRevenueCents ignores refunded/cancelled', () => {
  assert.equal(grossRevenueCents(orders), 7500);
});

test('totalFeesCents sums payment + booking fees of valid orders', () => {
  assert.equal(totalFeesCents(orders), 150 + 50 + 75 + 25);
});

test('netRevenueCents = gross - fees', () => {
  assert.equal(netRevenueCents(orders), 7500 - 300);
});

test('ticketsSold excludes voided', () => {
  assert.equal(ticketsSold(issued), 3);
});

test('ticketsByType groups valid tickets', () => {
  assert.deepEqual(ticketsByType(issued), { GA: 2, VIP: 1 });
});

test('sellThroughRate handles unknown capacity', () => {
  assert.equal(sellThroughRate(issued, 0), null);
  assert.equal(sellThroughRate(issued, 6), 0.5);
});

test('projectFinalSales straight-lines and caps at capacity', () => {
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 5, daysTotal: 10 }), 20);
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 5, daysTotal: 10, capacity: 15 }), 15);
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 0, daysTotal: 10 }), 10);
});

test('summarizeEvent rolls up a coherent object', () => {
  const s = summarizeEvent({ orders, issuedTickets: issued, capacity: 6 });
  assert.equal(s.ticketsSold, 3);
  assert.equal(s.grossRevenueCents, 7500);
  assert.equal(s.netRevenueCents, 7200);
  assert.equal(s.sellThroughRate, 0.5);
});

test('centsToUsd formats and handles null', () => {
  assert.equal(centsToUsd(7500), '$75.00');
  assert.equal(centsToUsd(null), '—');
});
