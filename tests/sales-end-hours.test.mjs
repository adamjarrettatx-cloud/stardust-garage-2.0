import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOURS_AFTER_DOORS_OPTIONS,
  resolveEventStartDate,
  hoursAfterDoorsFromIso,
  isoForHoursAfterDoors,
} from '../lib/tickets/sales-end-hours.js';

// Sanity: the dropdown options are the 1..12 whole-hour offsets the admin UI
// promises. Locked to catch accidental drift when the range is edited.
test('HOURS_AFTER_DOORS_OPTIONS is 1..12', () => {
  assert.deepEqual(HOURS_AFTER_DOORS_OPTIONS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

// The test file runs with TZ=UTC (see package.json "test" script), so building
// a Date from a local YYYY-MM-DD + HH:MM lands at the same wall-clock time in
// UTC. We can therefore compare against toISOString() directly.
test('resolveEventStartDate parses simple clock formats against event_date', () => {
  const d1 = resolveEventStartDate('2026-09-10', '10:00 PM');
  assert.equal(d1.toISOString(), '2026-09-10T22:00:00.000Z');

  const d2 = resolveEventStartDate('2026-09-10', '7pm');
  assert.equal(d2.toISOString(), '2026-09-10T19:00:00.000Z');

  const d3 = resolveEventStartDate('2026-09-10', '22:00');
  assert.equal(d3.toISOString(), '2026-09-10T22:00:00.000Z');
});

test('resolveEventStartDate returns null for missing or unparseable inputs', () => {
  assert.equal(resolveEventStartDate(null, '10:00 PM'), null);
  assert.equal(resolveEventStartDate('2026-09-10', null), null);
  assert.equal(resolveEventStartDate('2026-09-10', 'doors at dusk'), null);
  assert.equal(resolveEventStartDate('2026-09-10', 'late'), null);
  assert.equal(resolveEventStartDate('not-a-date', '10:00 PM'), null);
});

test('hoursAfterDoorsFromIso recovers the whole-hour offset for a saved cutoff', () => {
  const eventStart = new Date('2026-09-10T22:00:00.000Z');
  const twoHoursLater = new Date('2026-09-11T00:00:00.000Z').toISOString();
  assert.equal(hoursAfterDoorsFromIso(twoHoursLater, eventStart), 2);
  const eightHoursLater = new Date('2026-09-11T06:00:00.000Z').toISOString();
  assert.equal(hoursAfterDoorsFromIso(eightHoursLater, eventStart), 8);
});

test('hoursAfterDoorsFromIso returns null for cutoffs that do not land on a whole hour', () => {
  const eventStart = new Date('2026-09-10T22:00:00.000Z');
  // 2h 30m after doors — not a whole hour, so the dropdown falls back to
  // 'No cutoff' rather than silently rounding.
  const offBy30Min = new Date('2026-09-11T00:30:00.000Z').toISOString();
  assert.equal(hoursAfterDoorsFromIso(offBy30Min, eventStart), null);
});

test('hoursAfterDoorsFromIso returns null when the cutoff is at or before doors', () => {
  const eventStart = new Date('2026-09-10T22:00:00.000Z');
  assert.equal(hoursAfterDoorsFromIso(eventStart.toISOString(), eventStart), null);
  assert.equal(
    hoursAfterDoorsFromIso(new Date('2026-09-10T20:00:00.000Z').toISOString(), eventStart),
    null,
  );
});

test('hoursAfterDoorsFromIso returns null when either input is missing', () => {
  assert.equal(hoursAfterDoorsFromIso(null, new Date()), null);
  assert.equal(hoursAfterDoorsFromIso('2026-09-10T22:00:00Z', null), null);
});

test('isoForHoursAfterDoors round-trips the persisted cutoff', () => {
  const eventStart = new Date('2026-09-10T22:00:00.000Z');
  const iso = isoForHoursAfterDoors(eventStart, 3);
  assert.equal(iso, '2026-09-11T01:00:00.000Z');
  assert.equal(hoursAfterDoorsFromIso(iso, eventStart), 3);
});

test('isoForHoursAfterDoors returns null for missing / invalid offsets', () => {
  const eventStart = new Date('2026-09-10T22:00:00.000Z');
  assert.equal(isoForHoursAfterDoors(eventStart, null), null);
  assert.equal(isoForHoursAfterDoors(eventStart, 0), null);
  assert.equal(isoForHoursAfterDoors(eventStart, -1), null);
  assert.equal(isoForHoursAfterDoors(null, 2), null);
});
