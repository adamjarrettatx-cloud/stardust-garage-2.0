import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickTtDate,
  normalizeTtEvent,
  selectSeriesRepresentatives,
  buildDiscoveredIdentityRow,
  buildDiscoveredMetricsRow,
  buildDiscoveredPlaceholderRow,
  selectDiscoveredToRefresh,
} from '../lib/tt-discovered-events.js';

// A realistic TicketTailor /v1/events occurrence payload (subset of real fields).
const ttEvent = {
  id: 'ev_100',
  object: 'event',
  name: 'February Warehouse Party',
  event_series_id: 'es_100',
  currency: 'usd',
  start_date: { date: '2026-02-14', time: '21:00', iso: '2026-02-14T21:00:00-06:00', unix: 1, timezone: 'America/Chicago' },
  end_date: { date: '2026-02-15', time: '02:00', iso: '2026-02-15T02:00:00-06:00' },
  status: 'published',
  total_issued_tickets: '80',
};

test('pickTtDate reads nested {date,iso}, bare string, and null', () => {
  assert.deepEqual(pickTtDate({ date: '2026-02-14', iso: '2026-02-14T21:00:00-06:00' }),
    { date: '2026-02-14', iso: '2026-02-14T21:00:00-06:00' });
  assert.deepEqual(pickTtDate('2026-03-01T18:30:00Z'), { date: '2026-03-01', iso: '2026-03-01T18:30:00Z' });
  assert.deepEqual(pickTtDate('2026-03-01'), { date: '2026-03-01', iso: null });
  assert.deepEqual(pickTtDate(null), { date: null, iso: null });
});

test('normalizeTtEvent maps real payload fields; requires a series id', () => {
  const n = normalizeTtEvent(ttEvent);
  assert.deepEqual(n, {
    ttEventId: 'ev_100',
    ttEventSeriesId: 'es_100',
    title: 'February Warehouse Party',
    eventDate: '2026-02-14',
    startAt: '2026-02-14T21:00:00-06:00',
    currency: 'usd',
  });
  // No parent series → cannot key a cache row → dropped.
  assert.equal(normalizeTtEvent({ id: 'ev_x', name: 'orphan' }), null);
  assert.equal(normalizeTtEvent(null), null);
});

test('selectSeriesRepresentatives collapses occurrences to one-per-series (latest date wins)', () => {
  const reps = selectSeriesRepresentatives([
    { id: 'ev_a1', event_series_id: 'es_a', name: 'A', start_date: { date: '2026-03-01' } },
    { id: 'ev_a2', event_series_id: 'es_a', name: 'A', start_date: { date: '2026-04-10' } },
    { id: 'ev_b1', event_series_id: 'es_b', name: 'B', start_date: { date: '2026-02-20' } },
    { id: 'ev_bad', name: 'no series' },
  ]);
  const bySeries = Object.fromEntries(reps.map((r) => [r.ttEventSeriesId, r]));
  assert.equal(reps.length, 2);
  assert.equal(bySeries.es_a.eventDate, '2026-04-10'); // latest occurrence
  assert.equal(bySeries.es_a.ttEventId, 'ev_a2');
  assert.equal(bySeries.es_b.eventDate, '2026-02-20');
});

test('buildDiscoveredIdentityRow omits money/status so upserts preserve income', () => {
  const row = buildDiscoveredIdentityRow(normalizeTtEvent(ttEvent), { localEventId: null });
  assert.deepEqual(Object.keys(row).sort(), [
    'currency', 'event_date', 'local_event_id', 'start_at', 'title', 'tt_event_id', 'tt_event_series_id',
  ].sort());
  assert.equal('gross_cents' in row, false);
  assert.equal('status' in row, false);
  assert.equal(row.local_event_id, null);
});

test('buildDiscoveredMetricsRow computes gross/fees/net/tickets/orders like local events', () => {
  const orders = [
    { status: 'paid', total: 5000, total_payment_fee: 200, booking_fee: 50 },
    { status: 'refunded', total: 9999, total_payment_fee: 999 },      // excluded
    { status: 'paid', total: 3000, total_payment_fee: 100 },
  ];
  const issued = [
    { status: 'valid', ticket_type_id: 'tt_1' },
    { status: 'valid', ticket_type_id: 'tt_1' },
    { status: 'voided' },                                             // excluded
  ];
  const row = buildDiscoveredMetricsRow({ ttEventSeriesId: 'es_100', orders, issuedTickets: issued, fetchedAt: '2026-07-23T00:00:00Z' });
  assert.equal(row.tt_event_series_id, 'es_100');
  assert.equal(row.gross_cents, 8000);            // 5000 + 3000
  assert.equal(row.fees_cents, 350);              // 200+50 + 100
  assert.equal(row.net_cents, 7650);              // 8000 - 350
  assert.equal(row.tickets_sold, 2);
  assert.equal(row.orders_count, 2);
  assert.equal(row.status, 'ok');
  assert.equal(row.fetched_at, '2026-07-23T00:00:00Z');
});

test('buildDiscoveredPlaceholderRow records a non-ok status with zeroed money', () => {
  const row = buildDiscoveredPlaceholderRow({ ttEventSeriesId: 'es_e', status: 'error', source: 'tickettailor', errorDetail: 'boom' });
  assert.equal(row.status, 'error');
  assert.equal(row.gross_cents, 0);
  assert.equal(row.error_detail, 'boom');
});

test('selectDiscoveredToRefresh skips linked series, prioritizes never-fetched, and caps to limit', () => {
  const rows = [
    { tt_event_series_id: 'es_linked', local_event_id: 'uuid-1', fetched_at: null },   // skipped (local owns it)
    { tt_event_series_id: 'es_new', local_event_id: null, fetched_at: null },          // never fetched → first
    { tt_event_series_id: 'es_old', local_event_id: null, fetched_at: '2026-01-01T00:00:00Z' },
    { tt_event_series_id: 'es_recent', local_event_id: null, fetched_at: '2026-07-01T00:00:00Z' },
  ];
  const picked = selectDiscoveredToRefresh(rows, { limit: 2 });
  assert.deepEqual(picked.map((r) => r.tt_event_series_id), ['es_new', 'es_old']);
});
