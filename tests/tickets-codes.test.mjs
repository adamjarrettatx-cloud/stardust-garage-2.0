import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTicketCode, normalizeTicketCode, generateHoldToken, stripeIdempotencyKey } from '../lib/tickets/codes.js';

test('generateTicketCode returns prefixed grouped Crockford base32', () => {
  const code = generateTicketCode();
  // Crockford alphabet minus I/L/O/U; 15 random bytes -> 24 base32 chars
  // grouped in six blocks of four.
  assert.match(code, /^SDGA(-[A-HJKMNPQRSTVWXYZ0-9]{4}){6}$/);
});

test('generateTicketCode entropy: 1k codes all unique', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateTicketCode());
  assert.equal(seen.size, 1000);
});

test('normalizeTicketCode round-trips a valid code, ignoring case + separators', () => {
  const code = generateTicketCode();
  const messy = ` ${code.toLowerCase().replaceAll('-', ' ')}\n`;
  assert.equal(normalizeTicketCode(messy), code);
  assert.equal(normalizeTicketCode(code), code);
});

test('normalizeTicketCode returns null on codes that do not match the emitted shape', () => {
  assert.equal(normalizeTicketCode('SDGA-1234'), null);   // too short
  assert.equal(normalizeTicketCode('sdga!badchars'), null);
});

test('normalizeTicketCode returns null on empty / non-string', () => {
  assert.equal(normalizeTicketCode(''), null);
  assert.equal(normalizeTicketCode(null), null);
  assert.equal(normalizeTicketCode(undefined), null);
  assert.equal(normalizeTicketCode(42), null);
});

test('generateHoldToken has the hld_ prefix and enough entropy', () => {
  const a = generateHoldToken();
  const b = generateHoldToken();
  assert.match(a, /^hld_[0-9A-Z]{20}$/);
  assert.notEqual(a, b);
});

test('stripeIdempotencyKey is deterministic per (purpose, id) pair', () => {
  const a = stripeIdempotencyKey('hold', 'abc');
  const b = stripeIdempotencyKey('hold', 'abc');
  const c = stripeIdempotencyKey('hold', 'def');
  assert.equal(a, b);
  assert.notEqual(a, c);
});
