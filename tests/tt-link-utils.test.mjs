import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSeriesId,
  validateSeriesId,
  parseSeriesIdInput,
  isUnlink,
} from '../lib/tt-link-utils.js';

test('normalizeSeriesId trims and maps empty/whitespace/null to null', () => {
  assert.equal(normalizeSeriesId('  es_123  '), 'es_123');
  assert.equal(normalizeSeriesId('es_123'), 'es_123');
  assert.equal(normalizeSeriesId(''), null);
  assert.equal(normalizeSeriesId('   '), null);
  assert.equal(normalizeSeriesId(null), null);
});

test('normalizeSeriesId returns undefined for non-string, non-null input', () => {
  assert.equal(normalizeSeriesId(123), undefined);
  assert.equal(normalizeSeriesId({}), undefined);
  assert.equal(normalizeSeriesId(undefined), undefined);
});

test('validateSeriesId accepts a real es_ series id from the dropdown', () => {
  assert.deepEqual(validateSeriesId('es_2245532'), { ok: true, value: 'es_2245532' });
});

test('validateSeriesId still accepts a legacy ev_ id for compatibility', () => {
  assert.deepEqual(validateSeriesId('ev_1234567'), { ok: true, value: 'ev_1234567' });
});

test('validateSeriesId treats null as a valid unlink', () => {
  assert.deepEqual(validateSeriesId(null), { ok: true, value: null });
});

test('validateSeriesId rejects malformed ids', () => {
  assert.equal(validateSeriesId('1234567').ok, false);
  assert.equal(validateSeriesId('es_').ok, false);
  assert.equal(validateSeriesId('es_abc').ok, false);
  assert.equal(validateSeriesId('ev_').ok, false);
  assert.equal(validateSeriesId('ev_abc').ok, false);
  assert.equal(validateSeriesId('xx_123').ok, false);
  assert.equal(validateSeriesId('eb_123').ok, false); // near-miss prefix
  assert.equal(validateSeriesId(' es_123').ok, false); // unnormalized
});

test('validateSeriesId rejects a non-string, non-null (undefined) input type', () => {
  const res = validateSeriesId(undefined);
  assert.equal(res.ok, false);
  assert.match(res.error, /string or null/);
});

test('validateSeriesId rejects an over-long id', () => {
  assert.equal(validateSeriesId('es_' + '9'.repeat(70)).ok, false);
});

test('parseSeriesIdInput links a valid id end to end', () => {
  assert.deepEqual(parseSeriesIdInput('  es_42 '), { ok: true, value: 'es_42' });
});

test('parseSeriesIdInput unlinks on empty/null', () => {
  assert.deepEqual(parseSeriesIdInput(''), { ok: true, value: null });
  assert.deepEqual(parseSeriesIdInput(null), { ok: true, value: null });
});

test('parseSeriesIdInput rejects bad types and bad formats', () => {
  assert.equal(parseSeriesIdInput(5).ok, false);
  assert.equal(parseSeriesIdInput('nope').ok, false);
});

test('isUnlink is true only for null', () => {
  assert.equal(isUnlink(null), true);
  assert.equal(isUnlink('es_1'), false);
});
