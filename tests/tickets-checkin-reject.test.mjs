import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKIN_RESULTS,
  REJECT_REASONS,
  REJECT_REASON_VALUES,
  isValidRejectReason,
  validateTicketScan,
} from '../lib/tickets/checkin.js';

test('adds REJECTED to CHECKIN_RESULTS', () => {
  assert.equal(CHECKIN_RESULTS.REJECTED, 'rejected');
});

test('reject reasons match the DB-facing set', () => {
  assert.deepEqual(REJECT_REASONS, Object.freeze({
    PHOTO_MISMATCH: 'photo_mismatch',
    NO_PHOTO_ON_FILE: 'no_photo_on_file',
    ID_MISMATCH: 'id_mismatch',
    MANUAL: 'manual',
  }));
  assert.deepEqual(
    [...REJECT_REASON_VALUES].sort(),
    ['id_mismatch', 'manual', 'no_photo_on_file', 'photo_mismatch'],
  );
});

test('isValidRejectReason rejects unknowns and empties', () => {
  assert.equal(isValidRejectReason('photo_mismatch'), true);
  assert.equal(isValidRejectReason('no_photo_on_file'), true);
  assert.equal(isValidRejectReason('id_mismatch'), true);
  assert.equal(isValidRejectReason('manual'), true);
  assert.equal(isValidRejectReason(''), false);
  assert.equal(isValidRejectReason(null), false);
  assert.equal(isValidRejectReason(undefined), false);
  assert.equal(isValidRejectReason('bogus'), false);
  assert.equal(isValidRejectReason('PHOTO_MISMATCH'), false); // case-sensitive
});

test('validateTicketScan is unchanged by the rejected addition', () => {
  // Guard against a refactor accidentally turning a valid ticket into a
  // rejection outcome. Pure-function contract only \u2014 rejection is a
  // caller-side decision, never a validator decision.
  const ticket = { id: 't', event_id: 'e1', status: 'valid', used_at: null };
  const d = validateTicketScan({ ticket, eventId: 'e1' });
  assert.equal(d.result, CHECKIN_RESULTS.VALID);
  assert.notEqual(d.result, CHECKIN_RESULTS.REJECTED);
});
