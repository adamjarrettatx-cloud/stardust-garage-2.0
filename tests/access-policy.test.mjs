import test from 'node:test';
import assert from 'node:assert/strict';
import { contactKeys, normalizeName, isActiveRestriction, matchLevel, validateRestriction } from '../lib/capacity/access-policy.js';

test('names normalize accents, punctuation and whitespace without fuzzy identity claims', () => {
  assert.equal(normalizeName('  JOSÉ   O’Neil '), 'jose o neil');
  assert.deepEqual(contactKeys({ full_name: 'Ana Lee', aliases: ['ANA LEE', 'A Lee'], email: ' A@B.com ', phone: '(512) 555-0100' }),
    ['name:ana lee', 'name:a lee', 'email:a@b.com', 'phone:15125550100']);
});
test('only explicit identity keys are confirmed, never names or contacts', () => {
  const restriction = { identity_keys: ['member:1'] };
  assert.equal(matchLevel(restriction, { identity_keys: ['member:1'] }), 'confirmed');
  assert.equal(matchLevel(restriction, { identity_keys: ['member:2'] }), 'possible');
  assert.equal(matchLevel({ identity_keys: [] }, { identity_keys: ['member:2'] }), 'possible');
});
test('expiration is an absolute instant; lifted and expired records stop blocking', () => {
  const now = Date.parse('2026-09-23T05:00:00Z');
  assert.equal(isActiveRestriction({}), true);
  assert.equal(isActiveRestriction({ expires_at: '2026-09-23T05:00:00Z' }, now), false);
  assert.equal(isActiveRestriction({ expires_at: '2026-09-23T06:00:00Z' }, now), true);
  assert.equal(isActiveRestriction({ lifted_at: '2026-09-22T00:00:00Z' }, now), false);
});
test('manual record requires no account; bounded reason and future temporary expiry required', () => {
  const body = { full_name: 'Test Guest', reason: 'Documented conduct', kind: 'banned' };
  assert.doesNotThrow(() => validateRestriction(body));
  assert.throws(() => validateRestriction({ ...body, reason: ' ' }));
  assert.throws(() => validateRestriction({ ...body, kind: 'temporary', expires_at: 'bad' }));
  assert.throws(() => validateRestriction({ ...body, kind: 'temporary', expires_at: '2000-01-01' }));
  assert.throws(() => validateRestriction({ ...body, aliases: [1] }));
});
