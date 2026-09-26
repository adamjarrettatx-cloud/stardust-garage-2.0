import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shiftWindow, orderArrivals, mergeArrivals, escapeNameSearch } from '../lib/capacity/arrival-roster.js';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = read('app/api/team/trial-pass/today/route.js');
const panel = read('app/capacity/front-desk/TonightSignInsPanel.js');
const server = read('lib/capacity/arrival-roster-server.js');
const row = (id, at, checked = false) => ({ id, kind: 'trial_pass', activity_at: at, checked_in_at: checked ? at : null });

test('newest signup, searched check-in, then later signup and check-in share one chronological list', () => {
  let rows = orderArrivals([row('old', '2026-09-25T01:00Z'), row('new', '2026-09-25T01:01Z')]);
  assert.deepEqual(rows.map(r => r.id), ['new','old']);
  rows = mergeArrivals(rows, [row('returning', '2026-09-25T01:02Z', true)]);
  assert.deepEqual(rows.map(r => r.id), ['returning','new','old']);
  rows = mergeArrivals(rows, [row('later-signup', '2026-09-25T01:03Z')]);
  rows = mergeArrivals(rows, [row('later-checkin', '2026-09-25T01:04Z', true)]);
  assert.deepEqual(rows.map(r => r.id), ['later-checkin','later-signup','returning','new','old']);
});
test('one row per person; check-in moves it once and stale reads/retries cannot bump it', () => {
  const original = row('same', '2026-09-25T01:00Z');
  const checked = row('same', '2026-09-25T01:02Z', true);
  const rows = mergeArrivals([original], [checked, original, checked]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].activity_at, checked.activity_at);
});
test('ties are deterministic, and sorting does not mutate the input', () => {
  const rows = [row('b', '2026-09-25T01:00Z'), row('a', '2026-09-25T01:00Z')];
  assert.deepEqual(orderArrivals(rows).map(r => r.id), ['a','b']);
  assert.equal(rows[0].id, 'b');
});
test('Chicago shift starts at 6 AM, survives midnight, and handles DST', () => {
  assert.deepEqual(shiftWindow(new Date('2026-09-25T05:30Z')), { shiftDay:'2026-09-24', since:'2026-09-24T11:00:00.000Z' });
  assert.equal(shiftWindow(new Date('2026-09-25T10:59:59Z')).shiftDay, '2026-09-24');
  assert.equal(shiftWindow(new Date('2026-09-25T11:00:00Z')).shiftDay, '2026-09-25');
  assert.equal(shiftWindow(new Date('2026-03-08T12:00:00Z')).since, '2026-03-08T11:00:00.000Z');
  assert.equal(shiftWindow(new Date('2026-11-01T12:00:00Z')).since, '2026-11-01T12:00:00.000Z');
});
test('wildcard characters in names cannot enumerate the full directory', () => {
  assert.equal(escapeNameSearch(' %_\\ '), '\\%\\_\\\\');
});
test('directory route is role gated and never caches private photos or names', () => {
  assert.match(route, /requireFrontDeskOrTeam\(\)/);
  assert.ok(route.indexOf('requireFrontDeskOrTeam()') < route.indexOf('loadRoster(createAdminClient()'));
  assert.match(route, /private, no-store/);
  assert.match(route, /minimumQueryLength: 2/);
  const wire = server.slice(server.indexOf('wire: {'), server.indexOf('export async function loadRoster'));
  for (const privateField of ['email:', 'phone:', 'user_id:', 'profile_photo_path:', 'identityKeys:']) {
    assert.ok(!wire.includes(privateField), privateField);
  }
});
test('roster is database-backed, polling and search cannot write check-ins', () => {
  assert.match(panel, /setInterval/);
  assert.match(panel, /\/api\/team\/trial-pass\/today\?q=/);
  assert.ok(!panel.includes('window.localStorage'));
  assert.match(panel, /AbortController/);
  assert.match(panel, /version !== requestVersion.current/);
  assert.match(panel, /mergeArrivals/);
  assert.match(panel, /setQuery\(''\)/);
  assert.match(panel, /disabled=\{isIn \|\| isBusy\}/);
});
test('name label and placeholder are explicit only on the manual form', () => {
  const form = read('app/team/trial-pass/manual/ManualTrialPassForm.js');
  assert.match(form, /label="Full legal name" placeholder="Full legal name"/);
  assert.match(form, /color: '#f5f5f5', fontSize: 14/);
});
test('check-in does not require redundant confirmation checkboxes', () => {
  assert.ok(!panel.includes('identityConfirmed'));
  assert.ok(!panel.includes('admissionConfirmed'));
  assert.ok(!panel.includes('This records arrival and capacity.'));
  assert.match(panel, /!accessClear \|\| editingName/);
  assert.match(panel, /Boolean\(busyId\) \|\| Boolean\(selectedGuest.admission_reason\)/);
  assert.ok(!panel.includes('photoUnavailable || Boolean'));
});
test('roster check-in is one tap and never blocked by the Weekend Music Experience flag', () => {
  assert.match(server, /evaluateDoorScan\(\{ pass: primary, event: null \}\)/);
  assert.match(panel, /onClick=\{\(\) => quickCheckIn\(row\)\}/);
  assert.ok(!panel.includes("'Review'"));
  assert.ok(!panel.includes('Review admission'));
});
