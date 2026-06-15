import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCronAuth } from '../lib/event-metrics-auth.js';

test('classifyCronAuth accepts a matching Bearer token', () => {
  assert.equal(classifyCronAuth('Bearer s3cret', 's3cret'), 'cron');
});

test('classifyCronAuth rejects a wrong or missing token', () => {
  assert.equal(classifyCronAuth('Bearer nope', 's3cret'), null);
  assert.equal(classifyCronAuth(null, 's3cret'), null);
  assert.equal(classifyCronAuth('', 's3cret'), null);
});

test('classifyCronAuth never matches when the secret is unset', () => {
  // A missing CRON_SECRET must not be bypassable with an empty bearer token.
  assert.equal(classifyCronAuth('Bearer ', ''), null);
  assert.equal(classifyCronAuth('Bearer ', undefined), null);
  assert.equal(classifyCronAuth(undefined, undefined), null);
});
