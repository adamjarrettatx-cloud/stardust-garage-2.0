import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBearerToken } from '../lib/request-auth.js';

test('parseBearerToken extracts the token from a well-formed header', () => {
  assert.equal(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
});

test('parseBearerToken is case-insensitive on the scheme and tolerates padding', () => {
  assert.equal(parseBearerToken('bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(parseBearerToken('BEARER\tabc.def.ghi'), 'abc.def.ghi');
  assert.equal(parseBearerToken('  Bearer   abc.def.ghi  '), 'abc.def.ghi');
});

test('parseBearerToken returns null when there is no usable bearer token', () => {
  for (const header of [
    null,
    undefined,
    '',
    '   ',
    'Bearer',
    'Bearer ',
    'abc.def.ghi',
    'Basic dXNlcjpwYXNz',
    'Bearer abc def',
    123,
  ]) {
    assert.equal(parseBearerToken(header), null, `expected null for ${JSON.stringify(header)}`);
  }
});
