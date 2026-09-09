import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInternalMetricsSnapshot } from '../lib/event-analytics.js';

// The Events list widget that shows "16 SOLD / $326.40 gross" for TicketTailor
// events must also show real numbers for internal-ticketing events. That path
// aggregates from public.orders + public.tickets rather than calling out to
// an external API, so the math it produces has to line up with the numbers
// the per-event dashboard shows (via /api/admin/tickets/summary).

test('gross sums total_cents on paid-like orders and skips pending / void / failed', () => {
  const snap = buildInternalMetricsSnapshot({
    eventId: 'e1',
    orders: [
      { status: 'paid', total_cents: 20000, fees_cents: 100, refunded_cents: 0 },
      { status: 'paid', total_cents: 10000, fees_cents: 50, refunded_cents: 0 },
      { status: 'pending', total_cents: 9999, fees_cents: 0, refunded_cents: 0 },
      { status: 'failed', total_cents: 8888, fees_cents: 0, refunded_cents: 0 },
      { status: 'void', total_cents: 7777, fees_cents: 0, refunded_cents: 0 },
    ],
    tickets: [],
  });
  assert.equal(snap.gross_cents, 30000);
  assert.equal(snap.orders_count, 2);
  assert.equal(snap.fees_cents, 150);
});

test('partial refunds subtract from net and stay in gross, matching the event dashboard', () => {
  // The event dashboard displays gross unchanged and net = gross − refunded,
  // so the row widget agrees when the owner opens the event page.
  const snap = buildInternalMetricsSnapshot({
    eventId: 'e2',
    orders: [
      { status: 'paid', total_cents: 20000, fees_cents: 0, refunded_cents: 0 },
      { status: 'partial_refund', total_cents: 10000, fees_cents: 0, refunded_cents: 4000 },
      { status: 'refunded', total_cents: 5000, fees_cents: 0, refunded_cents: 5000 },
    ],
    tickets: [],
  });
  assert.equal(snap.gross_cents, 35000);
  assert.equal(snap.net_cents, 35000 - 9000);
  assert.equal(snap.raw_summary.refunded_cents, 9000);
});

test('tickets_sold counts valid and used, ignores void and refunded', () => {
  const snap = buildInternalMetricsSnapshot({
    eventId: 'e3',
    orders: [],
    tickets: [
      { status: 'valid' },
      { status: 'valid' },
      { status: 'used' },
      { status: 'void' },
      { status: 'refunded' },
    ],
  });
  assert.equal(snap.tickets_sold, 3);
  assert.deepEqual(snap.raw_summary.ticket_status_counts, {
    valid: 2,
    used: 1,
    void: 1,
    refunded: 1,
  });
});

test('snapshot shape matches what public.event_ticket_metrics expects', () => {
  // The cache column set is fixed (NOT NULL numerics, source CHECK), so the
  // internal snapshot must ship every required key so the batched upsert in
  // refresh-event-metrics does not fail on mixed rows.
  const snap = buildInternalMetricsSnapshot({
    eventId: 'e4',
    orders: [],
    tickets: [],
    fetchedAt: '2026-09-09T00:00:00.000Z',
  });
  for (const key of [
    'event_id',
    'tt_event_series_id',
    'tickets_sold',
    'orders_count',
    'gross_cents',
    'fees_cents',
    'net_cents',
    'source',
    'status',
    'error_detail',
    'fetched_at',
    'raw_summary',
  ]) {
    assert.ok(key in snap, `missing ${key} on internal snapshot`);
  }
  assert.equal(snap.source, 'internal');
  assert.equal(snap.status, 'ok');
  assert.equal(snap.tt_event_series_id, null);
  assert.equal(snap.fetched_at, '2026-09-09T00:00:00.000Z');
});
