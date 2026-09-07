import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEventTime } from '../lib/events/format-event-time.js';

test('formatEventTime returns start alone when no end is set', () => {
  assert.equal(formatEventTime('10:00 PM', null), '10:00 PM');
  assert.equal(formatEventTime('10:00 PM', ''), '10:00 PM');
  assert.equal(formatEventTime('10:00 PM', '  '), '10:00 PM');
  assert.equal(formatEventTime('10:00 PM', undefined), '10:00 PM');
});

test('formatEventTime joins bare start + end with an en-dash', () => {
  assert.equal(formatEventTime('10:00 PM', '2:00 AM'), '10:00 PM – 2:00 AM');
  assert.equal(formatEventTime('6:30 PM', '11:30 PM'), '6:30 PM – 11:30 PM');
});

test('formatEventTime never double-appends when start already contains a range', () => {
  // The bug Adam hit: event_time was '10pm - LATE' and event_end_time was
  // 'LATE', producing '10pm - LATE – LATE'. Should just show the start.
  assert.equal(formatEventTime('10pm - LATE', 'LATE'), '10pm - LATE');
  assert.equal(formatEventTime('10PM - LATE', 'LATE'), '10PM - LATE');
  assert.equal(formatEventTime('9 PM - 2 AM', '2 AM'), '9 PM - 2 AM');
  assert.equal(formatEventTime('10 pm to late', 'late'), '10 pm to late');
  assert.equal(formatEventTime('3:45PM - 10PM', '10PM'), '3:45PM - 10PM');
});

test('formatEventTime returns empty when start is missing', () => {
  assert.equal(formatEventTime(null, '2:00 AM'), '');
  assert.equal(formatEventTime('', '2:00 AM'), '');
});
