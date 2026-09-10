import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The refresh route now feeds the event_ticket_metrics cache from TWO
// providers: TicketTailor (external read-only pull) and internal ticketing
// (local aggregate over public.orders + public.tickets). This test locks in
// the wiring so a future refactor of the route cannot silently drop the
// internal path — which would take the live sales widget dark on every
// first-party ticketed event.

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const ROUTE = read('app/api/admin/refresh-event-metrics/route.js');

test('the route imports the internal snapshot builder alongside the TT one', () => {
  assert.match(ROUTE, /buildInternalMetricsSnapshot/);
  assert.match(ROUTE, /buildMetricsSnapshot/);
  assert.match(ROUTE, /buildPlaceholderMetricsRow/);
});

test('the events query pulls ticketing_mode so the provider branch can decide', () => {
  assert.match(ROUTE, /'events'\)\.select\('id, title, tt_event_series_id, ticketing_mode'\)/);
});

test('internal-ticketing events are aggregated from orders and tickets locally', () => {
  // The helper reads paid-like columns from orders and status from tickets;
  // both selects are essential to the widget's math.
  assert.match(ROUTE, /ticketing_mode === 'internal'/);
  assert.match(ROUTE, /from\('orders'\)/);
  assert.match(ROUTE, /from\('tickets'\)/);
  assert.match(ROUTE, /total_cents, fees_cents, refunded_cents/);
});

test('an internal read failure records an error row instead of skipping the event', () => {
  // A silently-missing row would leave the widget frozen on stale numbers;
  // a placeholder with source='internal' + status='error' makes the failure
  // visible on the row ("LIVE UNAVAILABLE").
  assert.match(ROUTE, /source: 'internal'/);
  assert.match(ROUTE, /status: 'error'/);
});
