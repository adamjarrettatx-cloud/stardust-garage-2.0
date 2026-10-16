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
import { namesSimilar, similarNameMatch, matchReason, sniffImageType } from '../lib/capacity/access-policy.js';
test('similar names are flagged as possible matches, unrelated names are not', () => {
  for (const [a, b] of [['Jade Gonzalez', 'Jada Maria Gonzalez'], ['Jada Gonzalez', 'Jada Gonzales'], ['Jada Gonzalez', 'Jada Gonzalez-Smith'],
    ['Jada Gonzalez', 'JADA GONZÁLEZ'], ['Chris Lee', 'Christopher Lee'], ['Jada Gonzalez Smith', 'Jada Gonzalez']]) assert.equal(namesSimilar(a, b), true, `${a} ~ ${b}`);
  for (const [a, b] of [['Jada Gonzalez', 'Maria Gonzalez'], ['Jada Gonzalez', 'Jada Lopez'], ['Jada Maria Gonzalez', 'Jada Maria Lopez'], ['Jo Li', 'Joe Li'], ['Jada', 'Jade']]) {
    assert.equal(namesSimilar(a, b), false, `${a} !~ ${b}`);
  }
  const restriction = { full_name: 'Jade Gonzalez', identity_keys: [], match_keys: ['name:jade gonzalez'] };
  const identity = { full_name: 'Jada Maria Gonzalez', identity_keys: ['user:1'], match_keys: ['name:jada maria gonzalez'] };
  assert.ok(similarNameMatch(restriction, identity));
  assert.match(matchReason(restriction, identity), /similar/);
  assert.match(matchReason({ ...restriction, identity_keys: ['user:1'] }, identity), /linked/);
});
test('restriction photos accept only real JPG/PNG/WebP bytes', () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(sniffImageType(new TextEncoder().encode('RIFF0000WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg onload=1>')), null);
});
