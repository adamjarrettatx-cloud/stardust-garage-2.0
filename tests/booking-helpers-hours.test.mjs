// Coverage for the "slot times optional / explicit hours" refactor in
// lib/booking-helpers.js. Legacy bookings that already have slot_start/slot_end
// must keep computing the same amount; new ones use hours_worked directly.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookingPayload,
  computeBookingAmountCents,
  bookingHours,
  formatBookingAmount,
} from '../lib/booking-helpers.js';

test('buildBookingPayload — hourly with explicit hours, no slot times', () => {
  const { valid, data, error } = buildBookingPayload({
    pay_type: 'hourly',
    hourly_rate: '50',
    hours: '3',
  });
  assert.equal(error, undefined);
  assert.equal(valid, true);
  assert.deepEqual(data, {
    slot_start: null,
    slot_end: null,
    pay_type: 'hourly',
    hourly_rate_cents: 5000,
    flat_amount_cents: null,
    hours_worked: 3,
  });
});

test('buildBookingPayload — hourly with fractional hours rounds to 2 decimals', () => {
  const { data } = buildBookingPayload({ pay_type: 'hourly', hourly_rate: '75', hours: '2.501' });
  assert.equal(data.hours_worked, 2.5);
});

test('buildBookingPayload — hourly missing both hours and slot times is rejected', () => {
  const { valid, error } = buildBookingPayload({ pay_type: 'hourly', hourly_rate: '50' });
  assert.equal(valid, false);
  assert.match(error, /hours/i);
});

test('buildBookingPayload — hourly with 0 or negative hours is rejected', () => {
  assert.equal(buildBookingPayload({ pay_type: 'hourly', hourly_rate: '50', hours: '0' }).valid, false);
  assert.equal(buildBookingPayload({ pay_type: 'hourly', hourly_rate: '50', hours: '-1' }).valid, false);
});

test('buildBookingPayload — flat pay unchanged (no hours needed)', () => {
  const { valid, data } = buildBookingPayload({ pay_type: 'flat', flat_amount: '250' });
  assert.equal(valid, true);
  assert.equal(data.flat_amount_cents, 25000);
  assert.equal(data.hourly_rate_cents, null);
  assert.equal(data.hours_worked, null);
  assert.equal(data.slot_start, null);
  assert.equal(data.slot_end, null);
});

test('buildBookingPayload — hourly with slot times but no hours still works (scheduler path)', () => {
  const { valid, data } = buildBookingPayload({
    pay_type: 'hourly',
    hourly_rate: '40',
    slot_start: '2026-10-01T22:00',
    slot_end: '2026-10-02T00:00',
  });
  assert.equal(valid, true);
  assert.equal(data.hours_worked, null);
  assert.equal(typeof data.slot_start, 'string');
  assert.equal(typeof data.slot_end, 'string');
  assert.equal(data.hourly_rate_cents, 4000);
});

test('buildBookingPayload — one-sided slot time is rejected', () => {
  const { valid, error } = buildBookingPayload({
    pay_type: 'hourly',
    hourly_rate: '40',
    hours: '2',
    slot_start: '2026-10-01T22:00',
  });
  assert.equal(valid, false);
  assert.match(error, /both/i);
});

test('computeBookingAmountCents — prefers hours_worked over slot delta', () => {
  const amt = computeBookingAmountCents({
    pay_type: 'hourly',
    hourly_rate_cents: 5000,
    hours_worked: 3,
    slot_start: '2026-10-01T22:00:00Z',
    slot_end: '2026-10-02T02:00:00Z', // 4h — should be ignored
  });
  assert.equal(amt, 15000);
});

test('computeBookingAmountCents — legacy booking with only slot times still computes', () => {
  const amt = computeBookingAmountCents({
    pay_type: 'hourly',
    hourly_rate_cents: 5000,
    hours_worked: null,
    slot_start: '2026-10-01T22:00:00Z',
    slot_end: '2026-10-02T01:30:00Z', // 3.5h
  });
  assert.equal(amt, 17500);
});

test('computeBookingAmountCents — hourly with neither hours nor slots returns null', () => {
  const amt = computeBookingAmountCents({
    pay_type: 'hourly',
    hourly_rate_cents: 5000,
  });
  assert.equal(amt, null);
});

test('computeBookingAmountCents — flat pay unaffected', () => {
  const amt = computeBookingAmountCents({ pay_type: 'flat', flat_amount_cents: 20000 });
  assert.equal(amt, 20000);
});

test('bookingHours — returns explicit hours_worked when > 0', () => {
  assert.equal(bookingHours({ hours_worked: 2.5 }), 2.5);
});

test('bookingHours — falls back to slot delta when no hours_worked', () => {
  const h = bookingHours({
    slot_start: '2026-10-01T22:00:00Z',
    slot_end: '2026-10-02T00:00:00Z',
  });
  assert.equal(h, 2);
});

test('formatBookingAmount — hourly with explicit hours', () => {
  const label = formatBookingAmount({
    pay_type: 'hourly',
    hourly_rate_cents: 5000,
    hours_worked: 3,
  });
  assert.equal(label, '$150 (3h @ $50/hr)');
});

test('formatBookingAmount — legacy hourly with slot delta', () => {
  const label = formatBookingAmount({
    pay_type: 'hourly',
    hourly_rate_cents: 4000,
    hours_worked: null,
    slot_start: '2026-10-01T22:00:00Z',
    slot_end: '2026-10-02T00:30:00Z',
  });
  assert.equal(label, '$100 (2.5h @ $40/hr)');
});

test('formatBookingAmount — flat pay label', () => {
  const label = formatBookingAmount({ pay_type: 'flat', flat_amount_cents: 30000 });
  assert.equal(label, '$300 flat');
});
