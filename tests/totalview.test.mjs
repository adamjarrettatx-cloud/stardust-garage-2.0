import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTALVIEW_RANGES,
  DEFAULT_TOTALVIEW_RANGE,
  resolveTotalViewRange,
  windowStats,
  metricAcrossRanges,
  describeChange,
  withinDateWindow,
  austinDate,
  eventStatusLabel,
  eventNeedsContract,
  daysLate,
  initials,
  shiftHourPoints,
  TOTALVIEW_LOOKBACK_MS,
} from '../lib/totalview.js';
import { adminTabById, adminTabHref, tabForPath, crumbForPath } from '../lib/admin-tabs.js';

const HOUR = 3600 * 1000;
// Saturday Oct 17 2026, 1:00 PM in Austin (CDT, UTC-5).
const NOW = Date.parse('2026-10-17T18:00:00Z');

test('ranges are the five owner-requested windows, default 72 hrs', () => {
  assert.deepEqual(TOTALVIEW_RANGES.map((r) => r.label), ['24 hrs', '72 hrs', '7 days', '30 days', '90 days']);
  assert.equal(DEFAULT_TOTALVIEW_RANGE, '72h');
  assert.equal(resolveTotalViewRange(undefined), '72h');
  assert.equal(resolveTotalViewRange('bogus'), '72h');
  assert.equal(resolveTotalViewRange(['30d', '7d']), '30d');
  assert.equal(TOTALVIEW_LOOKBACK_MS, 180 * 24 * HOUR, 'lookback covers 90 days plus the 90 before');
});

test('windowStats splits current vs prior period and ignores the future', () => {
  const pts = [
    NOW - 1 * HOUR, NOW - 23 * HOUR, // current 24h
    NOW - 25 * HOUR, // prior 24h
    NOW - 50 * HOUR, // outside both
    NOW + 1 * HOUR, // future
  ];
  const r = windowStats(pts, NOW, 24 * HOUR);
  assert.equal(r.value, 2);
  assert.equal(r.prior, 1);
  assert.equal(r.series.length, 12);
  assert.equal(r.series.reduce((a, b) => a + b, 0), 2);
  assert.equal(r.series[11], 1, 'most recent point lands in the last bucket');
});

test('weighted points sum weights (money, door deltas, hours)', () => {
  const r = windowStats([{ at: NOW - HOUR, weight: 2500 }, { at: NOW - 2 * HOUR, weight: 500 }], NOW, 24 * HOUR);
  assert.equal(r.value, 3000);
});

test('metricAcrossRanges marks failed sources unavailable', () => {
  const m = metricAcrossRanges([], NOW, { available: false });
  assert.equal(m['72h'].value, null);
  assert.equal(Object.keys(m).length, 5);
});

test('describeChange: absolute for small priors, percent otherwise', () => {
  assert.deepEqual(describeChange(5, 2), { text: '+3', direction: 'up' });
  assert.deepEqual(describeChange(1, 4), { text: '−3', direction: 'down' });
  assert.deepEqual(describeChange(120, 100), { text: '+20%', direction: 'up' });
  assert.equal(describeChange(10, 10).text, 'No change');
  assert.equal(describeChange(null, 3).text, '');
});

test('date windows use the Austin calendar day', () => {
  assert.equal(austinDate(NOW), '2026-10-17');
  // 11:30 PM Austin on the 17th is already the 18th in UTC.
  assert.equal(austinDate(Date.parse('2026-10-18T04:30:00Z')), '2026-10-17');
  assert.ok(withinDateWindow('2026-10-17', NOW, 24 * HOUR), 'today counts');
  assert.ok(withinDateWindow('2026-10-18', NOW, 24 * HOUR), 'tomorrow is inside next 24 hrs');
  assert.ok(!withinDateWindow('2026-10-19', NOW, 24 * HOUR));
  assert.ok(withinDateWindow('2026-10-20', NOW, 72 * HOUR));
  assert.ok(!withinDateWindow('2026-10-16', NOW, 72 * HOUR), 'past days are not upcoming');
});

test('event status mirrors the Events list badges', () => {
  assert.equal(eventStatusLabel({ status: 'draft', visibility: 'public' }), 'draft');
  assert.equal(eventStatusLabel({ status: 'published', visibility: 'unlisted' }), 'secret');
  assert.equal(eventStatusLabel({ status: 'published', visibility: 'internal' }), 'internal');
  assert.equal(eventStatusLabel({ status: 'published', visibility: 'public' }), 'live');
  assert.equal(eventNeedsContract({ visibility: 'internal' }), false);
  assert.equal(eventNeedsContract({ visibility: 'public' }), true);
});

test('task lateness, initials and shift hours', () => {
  assert.equal(daysLate('2026-10-13', NOW), 4);
  assert.equal(daysLate('2026-10-17', NOW), 0);
  assert.equal(daysLate('2026-10-20', NOW), -3);
  assert.equal(initials('Adam Jarrett'), 'AJ');
  assert.equal(initials('Kai'), 'K');
  assert.equal(initials(''), '—');
  const pts = shiftHourPoints([{ started_at: '2026-10-17T02:00:00Z', ended_at: '2026-10-17T08:30:00Z' }, { started_at: 'x', ended_at: null }]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].weight, 6.5);
});

test('TotalView is a sidebar section with its own page', () => {
  const tab = adminTabById('totalview');
  assert.ok(tab);
  assert.equal(tab.ownerOnly, false);
  assert.equal(adminTabHref(tab), '/bananas/totalview');
  assert.equal(tabForPath('/bananas/totalview'), 'totalview');
  assert.equal(crumbForPath('/bananas/totalview'), null, 'no "TotalView / TotalView" breadcrumb');
});
