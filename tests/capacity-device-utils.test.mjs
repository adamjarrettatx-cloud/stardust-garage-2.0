import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_ROLES,
  DEVICE_TOKEN_BYTES,
  isValidDeviceRole,
  generateDeviceToken,
  hashDeviceToken,
  verifyDeviceToken,
  extractDeviceToken,
  deviceCapability,
  deviceCanPerform,
  isDeviceActive,
  buildDeviceSetupUrl,
} from '../lib/capacity-device-utils.js';

test('DEVICE_ROLES are exactly the two door roles', () => {
  assert.deepEqual([...DEVICE_ROLES].sort(), ['exit_door', 'front_door']);
});

test('isValidDeviceRole accepts only the two door roles', () => {
  assert.equal(isValidDeviceRole('front_door'), true);
  assert.equal(isValidDeviceRole('exit_door'), true);
  assert.equal(isValidDeviceRole('admin'), false);
  assert.equal(isValidDeviceRole(''), false);
  assert.equal(isValidDeviceRole(undefined), false);
});

test('generateDeviceToken returns a long, URL-safe, unique token', () => {
  const a = generateDeviceToken();
  const b = generateDeviceToken();
  assert.notEqual(a, b);
  // base64url: no +, /, or = padding.
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  // 32 random bytes -> ~43 base64url chars. Comfortably > 32.
  assert.ok(a.length >= 32, `token length ${a.length} too short`);
  assert.equal(DEVICE_TOKEN_BYTES, 32);
});

test('hashDeviceToken is deterministic sha256 hex and rejects empties', () => {
  const t = 'some-token-value';
  const h1 = hashDeviceToken(t);
  const h2 = hashDeviceToken(t);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(hashDeviceToken(''), null);
  assert.equal(hashDeviceToken(null), null);
  assert.equal(hashDeviceToken(undefined), null);
});

test('hashDeviceToken differs for different tokens', () => {
  assert.notEqual(hashDeviceToken('a'), hashDeviceToken('b'));
});

test('verifyDeviceToken accepts the matching token and rejects others', () => {
  const raw = generateDeviceToken();
  const hash = hashDeviceToken(raw);
  assert.equal(verifyDeviceToken(raw, hash), true);
  assert.equal(verifyDeviceToken(raw + 'x', hash), false);
  assert.equal(verifyDeviceToken('totally-wrong', hash), false);
});

test('verifyDeviceToken is safe on missing/garbage inputs', () => {
  assert.equal(verifyDeviceToken(null, 'abc'), false);
  assert.equal(verifyDeviceToken('abc', null), false);
  assert.equal(verifyDeviceToken('abc', ''), false);
  assert.equal(verifyDeviceToken('abc', 'not-hex-and-wrong-length'), false);
});

test('extractDeviceToken prefers the Authorization bearer header', () => {
  assert.equal(extractDeviceToken({ authHeader: 'Bearer abc123' }), 'abc123');
  assert.equal(extractDeviceToken({ authHeader: 'bearer abc123' }), 'abc123');
  assert.equal(
    extractDeviceToken({ authHeader: 'Bearer header-tok', queryToken: 'query-tok' }),
    'header-tok',
  );
});

test('extractDeviceToken falls back to the query token', () => {
  assert.equal(extractDeviceToken({ queryToken: 'q-tok' }), 'q-tok');
  assert.equal(extractDeviceToken({ authHeader: 'Basic xyz', queryToken: 'q-tok' }), 'q-tok');
});

test('extractDeviceToken returns null when no token is present', () => {
  assert.equal(extractDeviceToken({}), null);
  assert.equal(extractDeviceToken({ authHeader: 'Bearer   ' }), null);
  assert.equal(extractDeviceToken({ queryToken: '   ' }), null);
  assert.equal(extractDeviceToken(), null);
});

test('deviceCapability maps each door to its single operation + source', () => {
  assert.deepEqual(deviceCapability('front_door'), { op: 'check_in', source: 'front_door' });
  assert.deepEqual(deviceCapability('exit_door'), { op: 'check_out', source: 'exit_door' });
  assert.equal(deviceCapability('admin'), null);
  assert.equal(deviceCapability('bogus'), null);
});

test('deviceCanPerform enforces the door scope', () => {
  // Front door: only check_in.
  assert.equal(deviceCanPerform('front_door', 'check_in'), true);
  assert.equal(deviceCanPerform('front_door', 'check_out'), false);
  // Exit door: only check_out.
  assert.equal(deviceCanPerform('exit_door', 'check_out'), true);
  assert.equal(deviceCanPerform('exit_door', 'check_in'), false);
  // Neither door may touch admin/team ops.
  for (const op of ['reset', 'adjust', 'start', 'end', undefined]) {
    assert.equal(deviceCanPerform('front_door', op), false);
    assert.equal(deviceCanPerform('exit_door', op), false);
  }
  // An unknown role can do nothing.
  assert.equal(deviceCanPerform('bogus_role', 'check_in'), false);
});

test('isDeviceActive requires active=true and no revoked_at', () => {
  assert.equal(isDeviceActive({ active: true, revoked_at: null }), true);
  assert.equal(isDeviceActive({ active: true, revoked_at: undefined }), true);
  assert.equal(isDeviceActive({ active: false, revoked_at: null }), false);
  assert.equal(isDeviceActive({ active: true, revoked_at: '2026-06-16T00:00:00Z' }), false);
  assert.equal(isDeviceActive(null), false);
  assert.equal(isDeviceActive(undefined), false);
});

test('buildDeviceSetupUrl points each role at its door page with the token', () => {
  assert.equal(
    buildDeviceSetupUrl('https://example.com', 'front_door', 'tok123'),
    'https://example.com/capacity/front-door?token=tok123',
  );
  assert.equal(
    buildDeviceSetupUrl('https://example.com/', 'exit_door', 'tok123'),
    'https://example.com/capacity/exit-door?token=tok123',
  );
});

test('buildDeviceSetupUrl url-encodes the token and rejects bad input', () => {
  const url = buildDeviceSetupUrl('https://x.io', 'front_door', 'a b/c+d');
  assert.ok(url.includes('token=a%20b%2Fc%2Bd'));
  assert.equal(buildDeviceSetupUrl('https://x.io', 'bad_role', 'tok'), null);
  assert.equal(buildDeviceSetupUrl('https://x.io', 'front_door', ''), null);
});
