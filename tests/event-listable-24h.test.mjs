import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEventListingCutoff, isEventStillListable, __internals } from '../lib/events/is-event-listable.js';

test('mobile 24-hour event fields retain Chicago overnight visibility', () => {
  for (const event_time of ['22:00', '22:00:00', '10 PM']) {
    const event = { event_date: '2026-09-29', event_time, event_end_time: '02:00' };
    assert.equal(computeEventListingCutoff(event).toISOString(), '2026-09-30T07:00:00.000Z');
    assert.equal(isEventStillListable(event, new Date('2026-09-30T06:59:59Z')), true);
    assert.equal(isEventStillListable(event, new Date('2026-09-30T07:00:00Z')), false);
  }
  for (const value of ['24:00', '22:60', '22:00:99']) assert.equal(__internals.parseClock(value), null);
});
