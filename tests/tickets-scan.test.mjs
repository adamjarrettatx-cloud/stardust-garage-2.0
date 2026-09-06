import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTicketScan, CHECKIN_RESULTS } from '../lib/tickets/checkin.js';

const eventId = 'evt-1';

test('validateTicketScan: null ticket -> not_found', () => {
  const r = validateTicketScan({ ticket: null, eventId });
  assert.equal(r.result, CHECKIN_RESULTS.NOT_FOUND);
});

test('validateTicketScan: valid ticket for this event -> valid', () => {
  const r = validateTicketScan({ ticket: { event_id: eventId, status: 'valid' }, eventId });
  assert.equal(r.result, CHECKIN_RESULTS.VALID);
});

test('validateTicketScan: valid ticket for a different event -> wrong_event (even if status is valid)', () => {
  const r = validateTicketScan({ ticket: { event_id: 'evt-2', status: 'valid' }, eventId });
  assert.equal(r.result, CHECKIN_RESULTS.WRONG_EVENT);
});

test('validateTicketScan: already-used ticket -> already_used, carries used_at', () => {
  const r = validateTicketScan({ ticket: { event_id: eventId, status: 'used', used_at: '2026-09-06T05:00:00Z' }, eventId });
  assert.equal(r.result, CHECKIN_RESULTS.ALREADY_USED);
  assert.equal(r.usedAt, '2026-09-06T05:00:00Z');
});

test('validateTicketScan: refunded and void tickets are rejected', () => {
  assert.equal(validateTicketScan({ ticket: { event_id: eventId, status: 'refunded' }, eventId }).result, CHECKIN_RESULTS.REFUNDED);
  assert.equal(validateTicketScan({ ticket: { event_id: eventId, status: 'void' }, eventId }).result, CHECKIN_RESULTS.VOID);
});

test('validateTicketScan: unknown status is treated as void so we fail closed', () => {
  const r = validateTicketScan({ ticket: { event_id: eventId, status: 'weird' }, eventId });
  assert.equal(r.result, CHECKIN_RESULTS.VOID);
  assert.match(r.reason, /UNKNOWN_STATUS/);
});
