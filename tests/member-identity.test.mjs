import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_IDENTITY_TOKEN_BYTES,
  buildMemberIdentityUrl,
  extractMemberIdentityTokenFromScan,
  generateMemberIdentityToken,
  hashMemberIdentityToken,
  isWellFormedMemberIdentityToken,
} from '../lib/member-identity.js';

test('token is 32 bytes / ~43 chars base64url', () => {
  assert.equal(MEMBER_IDENTITY_TOKEN_BYTES, 32);
  const token = generateMemberIdentityToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('generateMemberIdentityToken produces unique values', () => {
  const a = generateMemberIdentityToken();
  const b = generateMemberIdentityToken();
  assert.notEqual(a, b);
});

test('hashMemberIdentityToken is deterministic SHA-256 hex', () => {
  const raw = 'kTxpNwF9d0KpZLpSKyFsq1lRhkC9XCG4pW6a-Xy1lZo';
  const h1 = hashMemberIdentityToken(raw);
  const h2 = hashMemberIdentityToken(raw);
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test('hashMemberIdentityToken rejects empty/non-string input', () => {
  assert.equal(hashMemberIdentityToken(''), null);
  assert.equal(hashMemberIdentityToken(null), null);
  assert.equal(hashMemberIdentityToken(undefined), null);
  assert.equal(hashMemberIdentityToken(123), null);
});

test('isWellFormedMemberIdentityToken accepts base64url in expected range', () => {
  assert.equal(isWellFormedMemberIdentityToken('A'.repeat(43)), true);
  assert.equal(isWellFormedMemberIdentityToken('A'.repeat(20)), true);
  assert.equal(isWellFormedMemberIdentityToken('A'.repeat(64)), true);
  assert.equal(isWellFormedMemberIdentityToken('A'.repeat(19)), false); // too short
  assert.equal(isWellFormedMemberIdentityToken('A'.repeat(65)), false); // too long
  assert.equal(isWellFormedMemberIdentityToken('has space '), false);
  assert.equal(isWellFormedMemberIdentityToken('has/slash/xxxxxxxxxxxxxxxxxx'), false);
  assert.equal(isWellFormedMemberIdentityToken(''), false);
  assert.equal(isWellFormedMemberIdentityToken(null), false);
});

test('buildMemberIdentityUrl joins site + token cleanly', () => {
  assert.equal(
    buildMemberIdentityUrl('https://sdgatx.com', 'ABCxyz1234567890abcdefghijk'),
    'https://sdgatx.com/member/id/ABCxyz1234567890abcdefghijk',
  );
  assert.equal(
    buildMemberIdentityUrl('https://sdgatx.com/', 'ABCxyz1234567890abcdefghijk'),
    'https://sdgatx.com/member/id/ABCxyz1234567890abcdefghijk',
  );
  assert.equal(buildMemberIdentityUrl('https://sdgatx.com', ''), null);
  assert.equal(buildMemberIdentityUrl('https://sdgatx.com', null), null);
});

test('extractMemberIdentityTokenFromScan handles the full URL shape', () => {
  const token = generateMemberIdentityToken();
  const url = buildMemberIdentityUrl('https://www.sdgatx.com', token);
  assert.equal(extractMemberIdentityTokenFromScan(url), token);
});

test('extractMemberIdentityTokenFromScan handles the bare-token shape', () => {
  const token = generateMemberIdentityToken();
  assert.equal(extractMemberIdentityTokenFromScan(token), token);
});

test('extractMemberIdentityTokenFromScan handles whitespace + trailing slash', () => {
  const token = generateMemberIdentityToken();
  assert.equal(extractMemberIdentityTokenFromScan(`  ${token}  `), token);
  const url = `https://sdgatx.com/member/id/${token}/`;
  assert.equal(extractMemberIdentityTokenFromScan(url), token);
});

test('extractMemberIdentityTokenFromScan rejects unrelated payloads', () => {
  assert.equal(extractMemberIdentityTokenFromScan('https://instagram.com/stardustgarage'), null);
  assert.equal(extractMemberIdentityTokenFromScan('https://sdgatx.com/pass/AbCdEfGhIjKlMnOpQrStUvWxYz'), null);
  assert.equal(extractMemberIdentityTokenFromScan('https://sdgatx.com/t/TKT-123'), null);
  assert.equal(extractMemberIdentityTokenFromScan('WIFI:S:MySSID;T:WPA;P:pw;;'), null);
  assert.equal(extractMemberIdentityTokenFromScan(''), null);
  assert.equal(extractMemberIdentityTokenFromScan(null), null);
  assert.equal(extractMemberIdentityTokenFromScan('hello world'), null);
});

test('extractMemberIdentityTokenFromScan does not misread paths containing /member/id/', () => {
  // A URL where /member/id/ appears mid-path but not as the top-level route.
  const decoy = 'https://example.com/wat/member/id/AAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(extractMemberIdentityTokenFromScan(decoy), null);
});
