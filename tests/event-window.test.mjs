import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import {
  parseTimeToken,
  splitTimeRange,
  computeEventWindow,
  centralWallClockToUtcMs,
} from '../lib/event-window.js';

// Human-facing helper for asserting a specific Chicago wall-clock instant.
function ct(y, mo, d, hh, mm) {
  return centralWallClockToUtcMs(y, mo, d, hh, mm);
}

// -----------------------------------------------------------------------------
// Token parsing
// -----------------------------------------------------------------------------

test('parseTimeToken handles PM suffix variants', () => {
  const a = parseTimeToken('10:00 PM');
  strictEqual(a.hh, 22);
  strictEqual(a.mm, 0);
  const b = parseTimeToken('10:00pm');
  strictEqual(b.hh, 22);
  const c = parseTimeToken('10PM');
  strictEqual(c.hh, 22);
});

test('parseTimeToken handles AM and midnight/noon', () => {
  strictEqual(parseTimeToken('12:00 AM').hh, 0);
  strictEqual(parseTimeToken('12:00 PM').hh, 12);
  strictEqual(parseTimeToken('6:30 AM').hh, 6);
});

test('parseTimeToken handles suffix-less "10:00" as PM (venue heuristic)', () => {
  // The venue types "10:00" for late-night sets, never a morning event, so
  // we bias unsuffixed times of 8+ to PM.
  strictEqual(parseTimeToken('10:00').hh, 22);
  strictEqual(parseTimeToken('11').hh, 23);
});

test('parseTimeToken flags LATE tokens', () => {
  const t = parseTimeToken('LATE');
  strictEqual(t.late, true);
});

test('splitTimeRange separates start and end on dash variants', () => {
  const a = splitTimeRange('10:00PM - LATE');
  strictEqual(a.startTok, '10:00PM');
  strictEqual(a.endTok, 'LATE');
  const b = splitTimeRange('6:30PM - 2:00AM');
  strictEqual(b.endTok, '2:00AM');
  const c = splitTimeRange('10:00 PM');
  strictEqual(c.endTok, null);
});

// -----------------------------------------------------------------------------
// Event window
// -----------------------------------------------------------------------------

test('computeEventWindow: explicit start + end within same day', () => {
  const w = computeEventWindow('2026-09-16', '6:45PM - 8:45PM');
  ok(w.parsed);
  // Start = 6:45 PM CT minus 2h buffer = 4:45 PM CT
  strictEqual(w.startMs, ct(2026, 9, 16, 16, 45));
  // End = 8:45 PM CT plus 2h buffer = 10:45 PM CT
  strictEqual(w.endMs, ct(2026, 9, 16, 22, 45));
});

test('computeEventWindow: start + end spanning midnight rolls the end day', () => {
  const w = computeEventWindow('2026-09-17', '6:30PM - 2:00AM');
  ok(w.parsed);
  strictEqual(w.startMs, ct(2026, 9, 17, 16, 30));
  // End 2:00 AM lives on the 18th, plus 2h buffer -> 4:00 AM on the 18th.
  strictEqual(w.endMs, ct(2026, 9, 18, 4, 0));
});

test('computeEventWindow: late-night start + LATE runs to 6am next day + buffer', () => {
  // SDG night events at 10pm run until 5-6am the next morning.
  const w = computeEventWindow('2026-09-19', '10:00PM - LATE');
  ok(w.parsed);
  strictEqual(w.startMs, ct(2026, 9, 19, 20, 0));
  // 6am on the 20th + 2h buffer = 8am on the 20th.
  strictEqual(w.endMs, ct(2026, 9, 20, 8, 0));
});

test('computeEventWindow: late-night start with no end token runs to 6am next day', () => {
  // "10:00 PM" alone means a night event that will run late.
  const w = computeEventWindow('2026-09-18', '10:00 PM');
  ok(w.parsed);
  strictEqual(w.startMs, ct(2026, 9, 18, 20, 0));
  // 6am on the 19th + 2h buffer = 8am on the 19th.
  strictEqual(w.endMs, ct(2026, 9, 19, 8, 0));
});

test('computeEventWindow: daytime start with no end token gets +4h', () => {
  // Non-late-night starts keep the old +4h behavior; a 6pm workshop is
  // not going to run until 6am.
  const w = computeEventWindow('2026-09-16', '3:00 PM');
  ok(w.parsed);
  strictEqual(w.startMs, ct(2026, 9, 16, 13, 0));
  // 3pm + 4h = 7pm, plus 2h buffer = 9pm.
  strictEqual(w.endMs, ct(2026, 9, 16, 21, 0));
});

test('computeEventWindow: missing event_time -> whole-day fallback with parsed=false', () => {
  const w = computeEventWindow('2026-09-20', '');
  strictEqual(w.parsed, false);
  strictEqual(w.startMs, ct(2026, 9, 20, 6, 0));
  strictEqual(w.endMs, ct(2026, 9, 21, 6, 0));
});

test('computeEventWindow: daytime event with explicit PM-PM range', () => {
  const w = computeEventWindow('2026-09-20', '2PM - 11PM');
  ok(w.parsed);
  strictEqual(w.startMs, ct(2026, 9, 20, 12, 0));
  strictEqual(w.endMs, ct(2026, 9, 21, 1, 0)); // 11pm + 2h
});
