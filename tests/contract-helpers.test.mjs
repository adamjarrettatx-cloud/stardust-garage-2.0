import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidContractStatus,
  canTransitionContract,
  isTerminalContractStatus,
  normalizeSigner,
  validateSigners,
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
