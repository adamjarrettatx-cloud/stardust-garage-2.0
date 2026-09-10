import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrenceDate } from '../lib/event-series.js';

test('nextOccurrenceDate advances weekly and biweekly schedules', () => {
  assert.equal(nextOccurrenceDate('2026-09-09', 'weekly'), '2026-09-16');
  assert.equal(nextOccurrenceDate('2026-09-09', 'biweekly'), '2026-09-23');
});

test('nextOccurrenceDate respects the optional end date', () => {
  assert.equal(nextOccurrenceDate('2026-09-09', 'weekly', '2026-09-16'), '2026-09-16');
  assert.equal(nextOccurrenceDate('2026-09-09', 'weekly', '2026-09-15'), null);
  assert.equal(nextOccurrenceDate('2026-09-09', 'monthly'), null);
});
