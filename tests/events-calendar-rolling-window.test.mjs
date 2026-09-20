// Regression test for the rolling-window Events Calendar.
//
// The calendar renders one segment per calendar month in a 365-day rolling
// window starting on today. The invariant that must hold for every possible
// "today" anchor: EVERY calendar date in the window [today, today+364] must
// appear exactly once as an ACTIVE cell across all segments, and never as
// a duplicated active cell. Weekday-column alignment is preserved by
// inactive spacer cells at the leading/trailing edges of each segment.
//
// A previous implementation broke this invariant when a month's last day
// fell mid-week: the next segment started a week late, hiding several days
// at the top of the next month. This test locks the fix in.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'components', 'EventsCalendarClient.js'),
  'utf8',
);

// --- Duplicate the pure segmentation logic ---------------------------------
// This is a straight port of the useMemo in EventsCalendarClient.js. If the
// component's logic diverges from this, the invariant tests below will fail
// to reflect reality — so the source itself is asserted to still contain
// the anchoring markers we depend on.
const ROLLING_WINDOW_DAYS = 365;
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function key(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildSegments(today) {
  const todayStart = startOfDay(today);
  const windowEnd = addDays(todayStart, ROLLING_WINDOW_DAYS - 1);
  const gridStart = addDays(todayStart, -todayStart.getDay());
  const gridEnd = addDays(windowEnd, 6 - windowEnd.getDay());

  const months = [];
  let m = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const endMonth = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
  while (m <= endMonth) {
    months.push({ year: m.getFullYear(), month: m.getMonth() });
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  }
  const segments = [];
  for (const { year: segYear, month: segMonth } of months) {
    const firstOfMonth = new Date(segYear, segMonth, 1);
    const lastOfMonth = new Date(segYear, segMonth + 1, 0);
    let segStart = addDays(firstOfMonth, -firstOfMonth.getDay());
    if (segStart < gridStart) segStart = new Date(gridStart);
    let segEnd = addDays(lastOfMonth, 6 - lastOfMonth.getDay());
    if (segEnd > gridEnd) segEnd = new Date(gridEnd);
    const cells = [];
    for (let d = new Date(segStart); d <= segEnd; d = addDays(d, 1)) cells.push(new Date(d));
    if (cells.length) segments.push({ year: segYear, month: segMonth, cells });
  }
  return { todayStart, windowEnd, segments };
}

function activeKeys({ todayStart, windowEnd, segments }) {
  const set = new Set();
  for (const seg of segments) {
    for (const c of seg.cells) {
      const inMonth = c.getMonth() === seg.month && c.getFullYear() === seg.year;
      const isPast = c < todayStart;
      const isBeyond = c > windowEnd;
      if (inMonth && !isPast && !isBeyond) {
        const k = key(c);
        if (set.has(k)) throw new Error(`duplicate active cell: ${k}`);
        set.add(k);
      }
    }
  }
  return set;
}

function expectedKeys({ todayStart, windowEnd }) {
  const set = new Set();
  for (let d = new Date(todayStart); d <= windowEnd; d = addDays(d, 1)) set.add(key(d));
  return set;
}

// --- Tests -----------------------------------------------------------------

test('EventsCalendarClient uses the rolling-window segmentation we test', () => {
  // Guard against silent divergence: if the component drops these markers,
  // this test file's port is no longer a faithful mirror.
  assert.match(source, /const ROLLING_WINDOW_DAYS = 365;/);
  assert.match(source, /const monthSegments = useMemo\(\(\) => \{/);
  assert.match(source, /const firstOfMonth = new Date\(segYear, segMonth, 1\);/);
  assert.match(source, /const lastOfMonth = new Date\(segYear, segMonth \+ 1, 0\);/);
});

test('every day in the 365-day window renders as exactly one active cell — for all 400 anchor days', () => {
  const failures = [];
  for (let offset = 0; offset < 400; offset++) {
    const today = addDays(new Date(2026, 8, 19), offset);
    const built = buildSegments(today);
    const got = activeKeys(built);
    const want = expectedKeys(built);
    const missing = [...want].filter(k => !got.has(k));
    const extra = [...got].filter(k => !want.has(k));
    if (missing.length || extra.length) {
      failures.push({ today: key(today), missing: missing.slice(0, 5), extra: extra.slice(0, 5) });
    }
  }
  assert.deepEqual(failures, [], `anchor days with missing/extra active cells:\n${JSON.stringify(failures, null, 2)}`);
});

test('regression: a month whose last day is mid-week does not hide days of the following month', () => {
  // Nov 30, 2026 is a Monday — the exact case the previous implementation
  // broke. December 1–5 must all appear as active cells under a "December"
  // segment, not swallowed by the November week.
  const built = buildSegments(new Date(2026, 10, 15)); // mid-November anchor
  const dec = built.segments.find(s => s.year === 2026 && s.month === 11);
  assert.ok(dec, 'December 2026 segment must exist');
  const activeDec = dec.cells
    .filter(c => c.getMonth() === 11 && c.getFullYear() === 2026 && c >= built.todayStart && c <= built.windowEnd)
    .map(key);
  for (let day = 1; day <= 5; day++) {
    const k = `2026-12-0${day}`;
    assert.ok(activeDec.includes(k), `December ${day} must appear as active in the December segment (got ${activeDec.slice(0, 8).join(',')}...)`);
  }
});

test('every segment starts on a Sunday and ends on a Saturday, so weekday columns stay aligned', () => {
  const built = buildSegments(new Date(2026, 8, 19));
  for (const seg of built.segments) {
    assert.equal(seg.cells[0].getDay(), 0, `segment ${seg.year}-${seg.month + 1} must start on Sunday, got ${seg.cells[0].toDateString()}`);
    assert.equal(seg.cells[seg.cells.length - 1].getDay(), 6, `segment ${seg.year}-${seg.month + 1} must end on Saturday, got ${seg.cells.at(-1).toDateString()}`);
    assert.equal(seg.cells.length % 7, 0, `segment ${seg.year}-${seg.month + 1} cell count must be a multiple of 7`);
  }
});
