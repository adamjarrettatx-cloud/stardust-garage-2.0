import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidContractStatus,
  canTransitionContract,
  isTerminalContractStatus,
  normalizeSigner,
  validateSigners,
  buildContractPatch,
  normalizeContractDateTime,
  isoToVenueInputValue,
  formatVenueDateTime,
} from '../lib/contract-helpers.js';

test('isValidContractStatus', () => {
  assert.equal(isValidContractStatus('draft'), true);
  assert.equal(isValidContractStatus('nope'), false);
});

test('canTransitionContract enforces forward-only flow', () => {
  assert.equal(canTransitionContract('draft', 'sent'), true);
  assert.equal(canTransitionContract('sent', 'signed'), true);
  assert.equal(canTransitionContract('signed', 'draft'), false);
  assert.equal(canTransitionContract('void', 'draft'), false);
  assert.equal(canTransitionContract('bogus', 'draft'), false);
});

test('isTerminalContractStatus', () => {
  assert.equal(isTerminalContractStatus('signed'), true);
  assert.equal(isTerminalContractStatus('void'), true);
  assert.equal(isTerminalContractStatus('draft'), false);
});

test('normalizeSigner applies safe defaults', () => {
  const s = normalizeSigner({ name: '  Jane  ', email: 'JANE@EXAMPLE.COM', role: 'bad', order: 0 });
  assert.equal(s.name, 'Jane');
  assert.equal(s.email, 'jane@example.com');
  assert.equal(s.role, 'signer');
  assert.equal(s.order, 1);
  assert.equal(s.status, 'pending');
});

test('validateSigners rejects bad emails and non-arrays', () => {
  assert.equal(validateSigners('x').ok, false);
  assert.equal(validateSigners([{ name: 'A', email: 'not-an-email' }]).ok, false);
  assert.equal(validateSigners([{ name: '', email: 'a@b.com' }]).ok, false);
  const good = validateSigners([{ name: 'A', email: 'a@b.com', order: 2 }]);
  assert.equal(good.ok, true);
  assert.equal(good.signers[0].order, 2);
});

test('buildContractPatch only includes provided keys', () => {
  const res = buildContractPatch({ counterparty_name: '  Acme  ', notes: '' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.patch, { counterparty_name: 'Acme', notes: null });
});

test('buildContractPatch validates signature_provider', () => {
  assert.equal(buildContractPatch({ signature_provider: 'bogus' }).ok, false);
  assert.equal(buildContractPatch({ signature_provider: 'signnow' }).patch.signature_provider, 'signnow');
});

test('buildContractPatch validates counterparty_email', () => {
  assert.equal(buildContractPatch({ counterparty_email: 'nope' }).ok, false);
  const ok = buildContractPatch({ counterparty_email: 'A@B.COM' });
  assert.equal(ok.patch.counterparty_email, 'a@b.com');
  assert.equal(buildContractPatch({ counterparty_email: '' }).patch.counterparty_email, null);
});

test('buildContractPatch validates date-times and event_id', () => {
  assert.equal(buildContractPatch({ effective_date: 'not-a-date' }).ok, false);
  // A date-only value is venue-local (America/Chicago) start-of-day. Jan is CST
  // (UTC-6), so midnight CT -> 06:00 UTC.
  assert.equal(
    buildContractPatch({ effective_date: '2026-01-01' }).patch.effective_date,
    '2026-01-01T06:00:00.000Z',
  );
  // A full ISO timestamp carries its own zone and round-trips to canonical UTC.
  assert.equal(
    buildContractPatch({ expiration_date: '2026-01-01T14:30:00.000Z' }).patch.expiration_date,
    '2026-01-01T14:30:00.000Z',
  );
  // Empty clears the field.
  assert.equal(buildContractPatch({ effective_date: '' }).patch.effective_date, null);
  assert.equal(buildContractPatch({ event_id: 'not-a-uuid' }).ok, false);
  assert.equal(buildContractPatch({ event_id: null }).patch.event_id, null);
});

test('normalizeContractDateTime treats zoneless input as venue-local (America/Chicago)', () => {
  assert.deepEqual(normalizeContractDateTime(''), { ok: true, value: null });
  assert.deepEqual(normalizeContractDateTime(null), { ok: true, value: null });

  // Date-only, winter (CST, UTC-6): midnight CT -> 06:00 UTC.
  assert.equal(normalizeContractDateTime('2026-01-15').value, '2026-01-15T06:00:00.000Z');
  // Date-only, summer (CDT, UTC-5): midnight CT -> 05:00 UTC. Confirms DST is
  // applied, not a fixed offset.
  assert.equal(normalizeContractDateTime('2026-07-15').value, '2026-07-15T05:00:00.000Z');

  // datetime-local, winter: 09:00 CT -> 15:00 UTC.
  assert.equal(normalizeContractDateTime('2026-01-15T09:00').value, '2026-01-15T15:00:00.000Z');
  // datetime-local, summer: 09:00 CT -> 14:00 UTC.
  assert.equal(normalizeContractDateTime('2026-07-15T09:00').value, '2026-07-15T14:00:00.000Z');
  // datetime-local with seconds is accepted.
  assert.equal(normalizeContractDateTime('2026-01-15T09:00:30').value, '2026-01-15T15:00:30.000Z');

  // Explicit-zone ISO is taken as an absolute instant, unchanged.
  assert.equal(normalizeContractDateTime('2026-03-04T09:15:00.000Z').value, '2026-03-04T09:15:00.000Z');

  assert.equal(normalizeContractDateTime('garbage').ok, false);
  assert.equal(normalizeContractDateTime(42).ok, false);
});

test('isoToVenueInputValue / formatVenueDateTime round-trip in venue tz, TZ-independent', () => {
  // A stored winter instant renders to its venue wall clock regardless of the
  // process TZ (these assertions hold under UTC, America/Chicago, and PT).
  assert.equal(isoToVenueInputValue('2026-01-15T15:00:00.000Z'), '2026-01-15T09:00');
  // Summer instant (CDT).
  assert.equal(isoToVenueInputValue('2026-07-15T14:00:00.000Z'), '2026-07-15T09:00');
  // Round-trip: parse the input value back and get the same instant.
  const iso = '2026-01-15T15:00:00.000Z';
  assert.equal(normalizeContractDateTime(isoToVenueInputValue(iso)).value, iso);

  assert.equal(isoToVenueInputValue(''), '');
  assert.equal(isoToVenueInputValue('garbage'), '');

  // Display includes a Central timezone abbreviation.
  assert.match(formatVenueDateTime('2026-01-15T15:00:00.000Z'), /C[SD]T/);
  assert.equal(formatVenueDateTime(''), '');
});

test('buildContractPatch validates signers via validateSigners', () => {
  assert.equal(buildContractPatch({ signers: [{ name: 'A', email: 'bad' }] }).ok, false);
  const ok = buildContractPatch({ signers: [{ name: 'A', email: 'a@b.com' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.signers.length, 1);
});
