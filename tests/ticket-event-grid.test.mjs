import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketEventGrid, isUsableTicket } from '../lib/wallet/event-grid.js';
const now = new Date('2026-09-23T20:00:00Z');
const order = (id, date, status = 'valid', eventId = id) => ({
  id, event_id: eventId, status: 'paid', created_at: '2026-09-01T00:00:00Z',
  event: { id: eventId, title: id, event_date: date, event_time: '10 PM' },
  tickets: [{ id: `${id}-ticket`, status, ticket_code: `code-${id}` }],
});

test('upcoming events are nearest first, followed by past or used events newest first', () => {
  const result = buildTicketEventGrid([
    order('old', '2026-09-01'), order('later', '2026-10-10'), order('next', '2026-09-24'),
    order('recent', '2026-09-20'), order('used-future', '2026-09-25', 'used'),
  ], now);
  assert.deepEqual(result.map((row) => row.id), ['next', 'later', 'used-future', 'recent', 'old']);
  assert.equal(result.find((row) => row.id === 'used-future').muted, true);
});
test('multiple orders for one event become one tile without losing any ticket', () => {
  const result = buildTicketEventGrid([order('one', '2026-09-24', 'valid', 'same'), order('two', '2026-09-24', 'used', 'same')], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].orders.length, 2);
  assert.equal(result[0].tickets.length, 2);
  assert.equal(result[0].archived, false);
  assert.equal(result[0].muted, false);
});
test('a completely used event remains in history and is muted', () => {
  const result = buildTicketEventGrid([order('one', '2026-09-24', 'used', 'same'), order('two', '2026-09-24', 'used', 'same')], now);
  assert.equal(result[0].state, 'Used');
  assert.equal(result[0].tickets.length, 2);
  assert.equal(result[0].muted, true);
});
test('refunded and void tickets remain visible but are not usable', () => {
  const refunded = order('refund', '2026-09-24', 'refunded');
  refunded.status = 'refunded';
  const result = buildTicketEventGrid([refunded, order('void', '2026-09-24', 'void')], now);
  assert.equal(result.length, 2);
  assert.ok(result.every((row) => row.muted && row.archived));
  assert.equal(isUsableTicket({ status: 'used' }), false);
  assert.equal(isUsableTicket({ status: 'refunded' }), false);
  assert.equal(isUsableTicket({ status: 'void' }), false);
});
test('a late-night event is not marked past just because midnight has passed', () => {
  const result = buildTicketEventGrid([order('tonight', '2026-09-23')], new Date('2026-09-24T06:00:00Z'));
  assert.equal(result[0].past, false);
  const ended = buildTicketEventGrid([order('tonight', '2026-09-23')], new Date('2026-09-24T10:00:00Z'));
  assert.equal(ended[0].past, true);
});
test('missing event artwork or deleted event records do not erase purchases', () => {
  const missing = { id: 'missing', status: 'paid', event: null, tickets: [{ id: 'ticket', status: 'valid' }] };
  const result = buildTicketEventGrid([missing], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].state, 'Date unavailable');
  assert.equal(result[0].tickets.length, 1);
});
test('empty wallets have no fake or placeholder ticket cards', () => {
  assert.deepEqual(buildTicketEventGrid([], now), []);
});
