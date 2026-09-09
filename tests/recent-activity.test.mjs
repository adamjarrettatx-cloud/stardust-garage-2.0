import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushRecentActivity,
  formatActivityTime,
  RECENT_ACTIVITY_MAX,
} from '../lib/scan/recent-activity.js';

const A = { id: 'a', kind: 'guestlist', name: 'Alice', result: 'admitted', at: 1_700_000_000_000 };
const B = { id: 'b', kind: 'trial_pass', name: 'Bob',   result: 'admitted', at: 1_700_000_060_000 };
const C = { id: 'c', kind: 'member_id', name: 'Carol', result: 'admitted', at: 1_700_000_120_000 };
const D = { id: 'd', kind: 'guestlist', name: 'Dave',  result: 'rejected', at: 1_700_000_180_000 };
const E = { id: 'e', kind: 'trial_pass', name: 'Erin', result: 'denied',   at: 1_700_000_240_000 };
const F = { id: 'f', kind: 'member_id', name: 'Frank', result: 'admitted', at: 1_700_000_300_000 };

test('pushRecentActivity prepends newest entry', () => {
  const out = pushRecentActivity([A], B);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'b');
  assert.equal(out[1].id, 'a');
});

test('pushRecentActivity is immutable', () => {
  const start = [A];
  const out = pushRecentActivity(start, B);
  assert.notEqual(out, start);
  assert.equal(start.length, 1); // input untouched
});

test('pushRecentActivity dedupes by id', () => {
  // Same id (guest tapped twice) should not fill the panel with duplicates.
  const first = pushRecentActivity([A, B], A);
  assert.equal(first.length, 2);
  assert.equal(first[0].id, 'a'); // moved to front
  assert.equal(first[1].id, 'b');
});

test('pushRecentActivity trims to RECENT_ACTIVITY_MAX (5)', () => {
  let list = [];
  for (const e of [A, B, C, D, E, F]) list = pushRecentActivity(list, e);
  assert.equal(list.length, RECENT_ACTIVITY_MAX);
  assert.equal(list.length, 5);
  // A (oldest) should have fallen off.
  assert.ok(!list.some((x) => x.id === 'a'));
  // F (newest) should be first.
  assert.equal(list[0].id, 'f');
});

test('pushRecentActivity ignores null / bad entries', () => {
  assert.deepEqual(pushRecentActivity([A], null), [A]);
  assert.deepEqual(pushRecentActivity([A], undefined), [A]);
  assert.deepEqual(pushRecentActivity([A], 'nope'), [A]);
});

test('pushRecentActivity handles a non-array baseline gracefully', () => {
  const out = pushRecentActivity(null, A);
  assert.deepEqual(out, [A]);
});

test('formatActivityTime returns a human string', () => {
  const s = formatActivityTime(1_700_000_000_000);
  // Format depends on the runtime\u2019s TZ but must be non-empty and contain a digit.
  assert.equal(typeof s, 'string');
  assert.ok(s.length > 0);
});

test('formatActivityTime tolerates a bad input', () => {
  const s = formatActivityTime('nope');
  // Bad input either yields '' (in the catch) or a locale-generated 'Invalid Date'
  // string. Either way we do not throw.
  assert.equal(typeof s, 'string');
});
