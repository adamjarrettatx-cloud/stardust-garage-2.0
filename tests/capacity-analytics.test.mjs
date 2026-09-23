import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  operatingWindow, operatingDate, capacityHourLabel, validDate,
  buildCapacityCatalogue, buildCapacityReport, capacityCsv,
} from '../lib/capacity/analytics.js';
import { capacityPages, loadCapacityAnalytics } from '../lib/capacity/analytics-loader.js';
import { adminTabById, adminTabHref, tabForPath, ADMIN_TABS } from '../lib/admin-tabs.js';

const date = '2026-09-18';
const window = operatingWindow(date);
const session = { id: 's1', started_at: window.start, ended_at: window.end, current_count: 1 };
const now = Date.parse('2026-09-23T15:00:00Z');
let id = 0;
const row = (time, action, delta, count, sessionId = 's1') => ({
  id: String(++id), session_id: sessionId, created_at: time, action, delta, count_after: count, max_capacity: 299,
});
const anchor = () => row(window.start, 'start_session', 0, 0);
const report = (rows, extra = {}) => buildCapacityReport({ date, sessions: [session], rows, now, ...extra });

// Exercise the loader's query contract without granting database credentials.
function queuedDb(results) {
  const queries = [];
  const admin = { from(table) {
    const calls = [['from', table]];
    queries.push(calls);
    const query = {};
    for (const method of ['select', 'eq', 'is', 'in', 'lt', 'gte', 'or', 'order', 'limit']) {
      query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    for (const method of ['range', 'maybeSingle']) query[method] = (...args) => {
      calls.push([method, ...args]);
      assert.ok(results.length, 'unexpected database query');
      return Promise.resolve({ data: results.shift(), error: null });
    };
    return query;
  } };
  return { admin, queries };
}

test('loader refuses event-exclusive totals for a shared date', async () => {
  const event = { id: '00000000-0000-4000-8000-000000000001', title: 'A', event_date: date };
  const db = queuedDb([event, [event, { ...event, id: 'other', title: 'B' }]]);
  const result = await loadCapacityAnalytics(db.admin, new URLSearchParams({ mode: 'event', event: event.id }), now);
  assert.equal(result.ambiguous, true);
  assert.equal(result.report, undefined);
  assert.equal(db.queries.length, 2);
});

test('loader scopes history to selected sessions and carries the server-time fence', async () => {
  const db = queuedDb([[], [session], [anchor(), row('2026-09-19T03:00:00Z', 'check_in', 2, 2)], null]);
  const result = await loadCapacityAnalytics(db.admin, new URLSearchParams({ mode: 'night', date }), now);
  assert.equal(result.report.summary.entries, 2);
  assert.ok(db.queries[2].some(c => c[0] === 'in' && c[1] === 'session_id' && c[2][0] === 's1'));
  assert.ok(db.queries[2].some(c => c[0] === 'lt' && c[1] === 'created_at' && c[2] === window.end));
  assert.equal(result.live, null);
});

test('loader ignores an old open door session when reporting live venue counts', async () => {
  const current = { ...session, started_at: '2026-09-23T14:00:00Z', ended_at: null, current_count: 7, max_capacity: 299 };
  const db = queuedDb([[], [current], [], null, current, { event_id: 'old-event', opened_at: window.start }]);
  const result = await loadCapacityAnalytics(db.admin, new URLSearchParams({ mode: 'live' }), now);
  assert.equal(result.live.count, 7);
  assert.equal(result.live.staleDoor, true);
  assert.equal(result.live.eventTitle, null);
  assert.equal(db.queries.length, 6);
});

test('operating windows use 9am Austin and retain the prior night after midnight', () => {
  assert.deepEqual(window, { start: '2026-09-18T14:00:00.000Z', end: '2026-09-19T14:00:00.000Z' });
  assert.equal(operatingDate(Date.parse('2026-09-19T08:00:00Z')), date);
  assert.equal(operatingDate(Date.parse('2026-09-19T14:00:00Z')), '2026-09-19');
});

test('DST operating windows are 23/25 hours and repeated hours carry distinct offsets', () => {
  const spring = operatingWindow('2026-03-07'), fall = operatingWindow('2026-10-31');
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 23);
  assert.equal((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000, 25);
  assert.notEqual(capacityHourLabel('2026-11-01T06:00:00Z'), capacityHourLabel('2026-11-01T07:00:00Z'));
});

test('invalid calendar dates are rejected', () => {
  for (const d of ['2026-02-30', '2026-13-01', '../secret', null, '2026-2-01']) assert.equal(validDate(d), false);
});

test('hourly peaks include carry-in and arrivals/exits do not include resets', () => {
  const r = report([anchor(), row('2026-09-19T03:20:00Z', 'check_in', 10, 10),
    row('2026-09-19T04:05:00Z', 'check_out', -1, 9), row('2026-09-19T04:10:00Z', 'reset', -9, 0)]);
  const bucket = r.buckets.find((b) => b.start === '2026-09-19T04:00:00.000Z');
  assert.equal(bucket.peak, 10); assert.equal(bucket.exits, 1); assert.equal(bucket.corrections, 1);
  assert.equal(bucket.correctionDelta, -9); assert.equal(bucket.closing, 0);
  assert.equal(r.summary.entries, 10); assert.equal(r.summary.exits, 1);
});

test('carried values persist within coverage, not across gaps between sessions', () => {
  const r = report([anchor(), row('2026-09-19T03:20:00Z', 'check_in', 2, 2)], {
    sessions: [{ ...session, ended_at: '2026-09-19T04:00:00Z' }],
  });
  const uncovered = r.buckets.find((b) => b.start === '2026-09-19T05:00:00.000Z');
  assert.equal(uncovered.peak, null); assert.equal(uncovered.entries, null); assert.equal(uncovered.coverage, 'none');
  assert.equal(r.summary.finalCount, null);
  assert.ok(r.warnings.some((w) => w.includes('gaps')));
});

test('missing history differs from recorded zero activity', () => {
  const missing = report([], { sessions: [] });
  assert.equal(missing.summary.entries, null); assert.equal(missing.summary.peak, null);
  const zero = report([anchor()]);
  assert.equal(zero.summary.entries, 0); assert.equal(zero.summary.peak, 0);
  assert.ok(zero.warnings.some((w) => w.includes('does not prove')));
});

test('session ending does not zero the final count or fabricate departures', () => {
  const r = report([anchor(), row('2026-09-19T03:20:00Z', 'check_in', 8, 8),
    row(window.end, 'end_session', 0, 8)]);
  assert.equal(r.summary.finalCount, 8); assert.equal(r.summary.exits, 0);
  assert.ok(r.warnings.some((w) => w.includes('Incomplete closeout')));
});

test('opening seed reconstructs an old multi-day session without moving earlier traffic', () => {
  const s = { ...session, started_at: '2026-09-17T14:00:00Z' };
  const seed = row('2026-09-18T13:00:00Z', 'check_in', 1, 23);
  const r = report([row('2026-09-18T15:10:00Z', 'check_out', -1, 22)], { sessions: [s], seeds: [seed] });
  assert.equal(r.buckets[0].peak, 23); assert.equal(r.summary.entries, 0);
  assert.equal(r.summary.exits, 1); assert.equal(r.summary.finalCount, 22);
});

test('unknown opening anchor is not treated as zero', () => {
  const r = report([row('2026-09-19T03:20:00Z', 'check_in', 1, 12)]);
  assert.equal(r.buckets[0].peak, null);
  assert.ok(r.warnings.some((w) => w.includes('opening audit anchor')));
});

test('only rows inside the chosen window and sessions are included', () => {
  const r = report([anchor(), row('2026-09-19T03:20:00Z', 'check_in', 1, 1),
    row('2026-09-19T03:20:00Z', 'check_in', 999, 999, 'other'),
    row(window.end, 'check_in', 100, 100)]);
  assert.equal(r.summary.entries, 1); assert.equal(r.summary.peak, 1);
});

test('future window is empty and live window stops at server time', () => {
  assert.equal(report([], { now: Date.parse(window.start) - 1 }).buckets.length, 0);
  const r = report([anchor()], { sessions: [{ ...session, ended_at: null }], now: Date.parse(window.start) + 5400000 });
  assert.equal(r.buckets.length, 2); assert.equal(r.isCurrent, true);
  assert.equal(r.buckets[1].end, '2026-09-18T15:30:00.000Z');
});

test('ambiguous same-time changes do not claim a known closing count', () => {
  const r = report([anchor(), row('2026-09-19T03:20:00Z', 'check_in', 1, 1), row('2026-09-19T03:20:00Z', 'check_in', 1, 2)]);
  assert.equal(r.summary.finalCount, null);
  assert.ok(r.warnings.some((w) => w.includes('identical timestamp')));
});

test('daily rollover jitter does not import yesterday’s leftover peak', () => {
  const boundary = '2026-09-18T14:00:00.240Z';
  const old = { id: 'old', started_at: '2026-09-17T14:00:00Z', ended_at: boundary };
  const r = report([row(boundary, 'end_session', 0, 189, 'old'), row(boundary, 'start_session', 0, 0)], {
    sessions: [old, { ...session, started_at: boundary }],
    seeds: [row('2026-09-18T08:00:00Z', 'check_in', 1, 189, 'old')],
  });
  assert.equal(r.summary.peak, 0); assert.equal(r.summary.finalCount, 0);
  assert.ok(!r.warnings.some((w) => w.includes('opening audit anchor')));
});

test('catalogue splits multi-day sessions and flags shared event dates', () => {
  const c = buildCapacityCatalogue([
    { id: 'a', title: 'A', event_date: date, status: 'published' },
    { id: 'b', title: 'B', event_date: date, status: 'published' },
    { id: 'draft', event_date: date, status: 'draft' },
  ], [{ started_at: '2026-09-17T15:00:00Z', ended_at: '2026-09-19T13:00:00Z' }], now);
  assert.equal(c.events.length, 2); assert.equal(c.events[0].shared, true);
  assert.deepEqual(c.nights.map((n) => n.date), [date, '2026-09-17']);
});

test('CSV is complete, timezone-explicit, and formula-safe', () => {
  const csv = capacityCsv(report([anchor()]), '=HYPERLINK("bad")');
  assert.equal(csv.split('\r\n').length, 25);
  assert.ok(csv.includes('"America/Chicago"')); assert.ok(csv.includes('hour_start_utc'));
  assert.ok(csv.includes(`"'=HYPERLINK`)); assert.ok(csv.includes('CDT'));
});

test('pagination reads beyond 1000 rows and fails closed on errors/limits', async () => {
  const all = Array.from({ length: 1234 }, (_, n) => ({ id: n }));
  const result = await capacityPages(() => ({ range: async (a, b) => ({ data: all.slice(a, b + 1) }) }));
  assert.equal(result.length, 1234);
  await assert.rejects(capacityPages(() => ({ range: async () => ({ error: new Error('bad') }) })));
  await assert.rejects(capacityPages(() => ({ range: async () => ({ data: all.slice(0, 500) }) }), 500, 2), /no partial/);
});

test('invalid mode/date/event is rejected before reading database tables', async () => {
  const admin = { from() { throw new Error('Must not read'); } };
  for (const q of ['mode=delete', 'mode=event&event=bad', 'mode=night&date=2026-02-30']) {
    assert.equal((await loadCapacityAnalytics(admin, new URLSearchParams(q), now)).status, 400);
  }
});

test('navigation is direct, admin-visible and keeps the new page selected', () => {
  assert.equal(adminTabHref(adminTabById('event-capacity')), '/bananas/capacity');
  assert.equal(adminTabById('event-capacity').ownerOnly, false);
  assert.equal(tabForPath('/bananas/capacity'), 'event-capacity');
  const i = ADMIN_TABS.findIndex((t) => t.id === 'front-desk');
  assert.equal(ADMIN_TABS[i + 1].id, 'event-capacity');
});

test('page and endpoint independently enforce admin gates; no write operations', () => {
  const page = readFileSync(new URL('../app/bananas/capacity/page.js', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/admin/capacity-analytics/route.js', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../lib/capacity/analytics-loader.js', import.meta.url), 'utf8');
  assert.match(page, /await adminPageGate\(\)/);
  assert.match(route, /await requireAdminMfa\(\)/);
  assert.match(route, /private, no-store/);
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(loader));
  assert.ok(!/actor_id|device_id|note,/.test(loader));
});
