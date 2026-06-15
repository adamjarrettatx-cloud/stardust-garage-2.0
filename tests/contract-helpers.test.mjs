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
  // A date-only value is accepted and normalized to start-of-day UTC.
  assert.equal(
    buildContractPatch({ effective_date: '2026-01-01' }).patch.effective_date,
    '2026-01-01T00:00:00.000Z',
  );
  // A full ISO timestamp round-trips to a canonical ISO string.
  assert.equal(
    buildContractPatch({ expiration_date: '2026-01-01T14:30:00.000Z' }).patch.expiration_date,
    '2026-01-01T14:30:00.000Z',
  );
  // Empty clears the field.
  assert.equal(buildContractPatch({ effective_date: '' }).patch.effective_date, null);
  assert.equal(buildContractPatch({ event_id: 'not-a-uuid' }).ok, false);
  assert.equal(buildContractPatch({ event_id: null }).patch.event_id, null);
});

test('normalizeContractDateTime handles dates, datetimes, and empties', () => {
  assert.deepEqual(normalizeContractDateTime(''), { ok: true, value: null });
  assert.deepEqual(normalizeContractDateTime(null), { ok: true, value: null });
  assert.deepEqual(normalizeContractDateTime('2026-03-04'), { ok: true, value: '2026-03-04T00:00:00.000Z' });
  assert.equal(normalizeContractDateTime('2026-03-04T09:15:00.000Z').value, '2026-03-04T09:15:00.000Z');
  assert.equal(normalizeContractDateTime('garbage').ok, false);
  assert.equal(normalizeContractDateTime(42).ok, false);
});

test('buildContractPatch validates signers via validateSigners', () => {
  assert.equal(buildContractPatch({ signers: [{ name: 'A', email: 'bad' }] }).ok, false);
  const ok = buildContractPatch({ signers: [{ name: 'A', email: 'a@b.com' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.signers.length, 1);
});
