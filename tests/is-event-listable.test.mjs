import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../lib/events/is-event-listable.js');
const { isEventStillListable, computeEventListingCutoff, __internals } = mod;
const { parseClock, extractStartAndEnd, chicagoWallClockToUtc, addDays } = __internals;

// Helper: build a Date that represents a specific wall-clock time in
// America/Chicago (uses the module's own converter so DST is consistent).
const CT = (dateStr, h, m = 0) => chicagoWallClockToUtc(dateStr, h, m);

test('parseClock accepts common admin formats', () => {
  assert.deepEqual(parseClock('6:45PM'), { hour: 18, minute: 45 });
  assert.deepEqual(parseClock('6 pm'), { hour: 18, minute: 0 });
  assert.deepEqual(parseClock('10PM'), { hour: 22, minute: 0 });
  assert.deepEqual(parseClock('12:00 AM'), { hour: 0, minute: 0 });
  assert.deepEqual(parseClock('12 PM'), { hour: 12, minute: 0 });
  assert.deepEqual(parseClock('9:00 A.M.'), { hour: 9, minute: 0 });
});

test('parseClock rejects garbage', () => {
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('LATE'), null);
  assert.equal(parseClock('TBD'), null);
  assert.equal(parseClock('13:00'), null); // 24h without AM/PM: not accepted
  assert.equal(parseClock(null), null);
});

test('extractStartAndEnd splits inline ranges', () => {
  const r1 = extractStartAndEnd('6:45PM - 8:45PM', null);
  assert.deepEqual(r1.start.clock, { hour: 18, minute: 45 });
  assert.deepEqual(r1.end.clock, { hour: 20, minute: 45 });

  const r2 = extractStartAndEnd('10PM – LATE', null);
  assert.deepEqual(r2.start.clock, { hour: 22, minute: 0 });
  assert.equal(r2.end.clock, null);
  assert.match(r2.end.raw, /LATE/i);

  const r3 = extractStartAndEnd('9 PM - 2 AM', null);
  assert.deepEqual(r3.start.clock, { hour: 21, minute: 0 });
  assert.deepEqual(r3.end.clock, { hour: 2, minute: 0 });

  const r4 = extractStartAndEnd('10 pm to late', null);
  assert.deepEqual(r4.start.clock, { hour: 22, minute: 0 });
  assert.equal(r4.end.clock, null);
});

test('extractStartAndEnd uses event_end_time when event_time is bare', () => {
  const r = extractStartAndEnd('6:30 pm', '8:30 pm');
  assert.deepEqual(r.start.clock, { hour: 18, minute: 30 });
  assert.deepEqual(r.end.clock, { hour: 20, minute: 30 });
});

// --- the core scenarios the owner described ---------------------------------

test('yoga event with explicit end time delists after the end time', () => {
  // Real row from prod: Wed Sep 9 2026, 6:45 PM - 8:45 PM
  const event = {
    event_date: '2026-09-09',
    event_time: '6:45PM - 8:45PM',
    event_end_time: null,
  };
  // Just before 8:45 PM CT — still visible.
  assert.equal(isEventStillListable(event, CT('2026-09-09', 20, 44)), true);
  // Just after 8:45 PM CT — hidden.
  assert.equal(isEventStillListable(event, CT('2026-09-09', 20, 46)), false);
  // Ten PM the same day (matches the ticket) — hidden.
  assert.equal(isEventStillListable(event, CT('2026-09-09', 22, 9)), false);
});

test('early-evening event with vague end hides 8 hours after start', () => {
  // Start 6:30 PM, no end. Cutoff = 6:30 PM + 8h = 2:30 AM next day.
  const event = {
    event_date: '2026-09-10',
    event_time: '6:30 pm',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  assert.equal(cutoff.getTime(), CT('2026-09-11', 2, 30).getTime());
  assert.equal(isEventStillListable(event, CT('2026-09-11', 2, 29)), true);
  assert.equal(isEventStillListable(event, CT('2026-09-11', 2, 31)), false);
});

test('late-night event (>=9:55 PM start) hides 6 hours after start', () => {
  // Start 10 PM, end LATE. Cutoff = 10 PM + 6h = 4 AM next day.
  const event = {
    event_date: '2026-09-11',
    event_time: '10PM - LATE',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  assert.equal(cutoff.getTime(), CT('2026-09-12', 4, 0).getTime());
  assert.equal(isEventStillListable(event, CT('2026-09-12', 3, 59)), true);
  assert.equal(isEventStillListable(event, CT('2026-09-12', 4, 1)), false);
});

test('9:54 PM start is still on the 8-hour side of the cutoff', () => {
  const event = {
    event_date: '2026-09-11',
    event_time: '9:54PM - LATE',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  // 9:54 PM + 8h = 5:54 AM
  assert.equal(cutoff.getTime(), CT('2026-09-12', 5, 54).getTime());
});

test('9:55 PM start crosses to the 6-hour side of the cutoff', () => {
  const event = {
    event_date: '2026-09-11',
    event_time: '9:55PM - LATE',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  // 9:55 PM + 6h = 3:55 AM
  assert.equal(cutoff.getTime(), CT('2026-09-12', 3, 55).getTime());
});

test('end time earlier than start rolls over to next calendar day', () => {
  // "9 PM - 2 AM" — 2 AM belongs to the next day.
  const event = {
    event_date: '2026-09-11',
    event_time: '9 PM - 2 AM',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  assert.equal(cutoff.getTime(), CT('2026-09-12', 2, 0).getTime());
});

test('TBD end time treated as vague', () => {
  const event = {
    event_date: '2026-09-11',
    event_time: '8 PM',
    event_end_time: 'TBD',
  };
  const cutoff = computeEventListingCutoff(event);
  // 8 PM + 8h = 4 AM next day
  assert.equal(cutoff.getTime(), CT('2026-09-12', 4, 0).getTime());
});

test('no time at all: falls back to end-of-day Chicago', () => {
  const event = {
    event_date: '2026-09-11',
    event_time: null,
    event_end_time: null,
  };
  // Visible up through 11:59 PM CT on Sep 11.
  assert.equal(isEventStillListable(event, CT('2026-09-11', 23, 59)), true);
  // Not visible at midnight CT (start of Sep 12).
  assert.equal(isEventStillListable(event, CT('2026-09-12', 0, 0)), false);
});

test('future date is always listable', () => {
  const event = {
    event_date: '2027-01-01',
    event_time: '9PM - 2AM',
    event_end_time: null,
  };
  assert.equal(isEventStillListable(event, CT('2026-09-09', 22, 0)), true);
});

test('DST spring-forward math (March)', () => {
  // 2026 DST begins Sun Mar 8; on Mar 7 CT is still UTC-6.
  const event = {
    event_date: '2026-03-07',
    event_time: '10PM - LATE',
    event_end_time: null,
  };
  const cutoff = computeEventListingCutoff(event);
  // Start 10 PM CST Mar 7 == 04:00 UTC Mar 8. + 6h = 10:00 UTC Mar 8.
  // Which is 5:00 AM CDT (post-DST) — matches wall clock via converter.
  assert.equal(cutoff.getTime(), CT('2026-03-08', 5, 0).getTime());
});

test('addDays handles month boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
});

test('required direct-route listability boundaries', () => {
  const endedYesterday = {
    event_date: '2026-09-09',
    event_time: '6 PM',
    event_end_time: '8 PM',
  };
  assert.equal(isEventStillListable(endedYesterday, CT('2026-09-10', 12)), false);

  const endingInTwoHours = {
    event_date: '2026-09-10',
    event_time: '6 PM',
    event_end_time: '10 PM',
  };
  assert.equal(isEventStillListable(endingInTwoHours, CT('2026-09-10', 20)), true);

  const vagueEndTonight = {
    event_date: '2026-09-10',
    event_time: '6 PM',
    event_end_time: 'LATE',
  };
  assert.equal(isEventStillListable(vagueEndTonight, CT('2026-09-11', 1, 59)), true);
  assert.equal(isEventStillListable(vagueEndTonight, CT('2026-09-11', 2, 0)), false);

  const tomorrow = {
    event_date: '2026-09-11',
    event_time: '6 PM',
    event_end_time: '8 PM',
  };
  assert.equal(isEventStillListable(tomorrow, CT('2026-09-10', 12)), true);
});

test('DST fall-back math keeps events listable until their elapsed-time cutoff', () => {
  const event = {
    event_date: '2026-10-31',
    event_time: '10 PM - LATE',
    event_end_time: null,
  };
  // 10 PM CDT + 6 elapsed hours crosses the Nov. 1 fall-back transition and
  // expires at 3 AM CST, rather than 4 AM by naive wall-clock arithmetic.
  assert.equal(isEventStillListable(event, CT('2026-11-01', 2, 59)), true);
  assert.equal(isEventStillListable(event, CT('2026-11-01', 3, 0)), false);
});
