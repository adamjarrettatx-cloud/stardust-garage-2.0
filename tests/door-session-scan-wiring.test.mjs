import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contract: every scan API accepts a door_session_id from the request body
// and threads it into the resulting audit row. If someone regresses this,
// per-shift analytics silently break because scans stop getting stamped.

const memberIdRoute = readFileSync(new URL('../app/api/scan/member-id/route.js', import.meta.url), 'utf8');
const trialPassRoute = readFileSync(new URL('../app/api/capacity/trial-pass/scan/route.js', import.meta.url), 'utf8');
const ticketsRoute = readFileSync(new URL('../app/api/tickets/scan/route.js', import.meta.url), 'utf8');
const clientSrc = readFileSync(new URL('../app/scan/UnifiedScanClient.js', import.meta.url), 'utf8');

test('member-id route reads door_session_id from body', () => {
  assert.match(memberIdRoute, /door_session_id/);
  assert.match(memberIdRoute, /doorSessionId\s*=\s*typeof body\?\.door_session_id/);
});

test('member-id route inserts door_session_id on both verify and reject', () => {
  const inserts = memberIdRoute.match(/member_id_scans'\)\.insert\({[\s\S]+?}\)/g) || [];
  assert.ok(inserts.length >= 2, 'expected at least verify + reject inserts');
  for (const block of inserts) {
    assert.match(block, /door_session_id/);
  }
});

test('member-id route uses correct requireTeam gate shape', () => {
  // Prior bug: the route checked `gate?.error` but requireTeam returns
  // `unauthorized`. This is the fix.
  assert.match(memberIdRoute, /gate\?\.unauthorized/);
  assert.doesNotMatch(memberIdRoute, /gate\?\.error/);
});

test('trial-pass scan route inserts door_session_id on both verify and reject', () => {
  assert.match(trialPassRoute, /doorSessionId\s*=\s*typeof body\?\.door_session_id/);
  const inserts = trialPassRoute.match(/trial_pass_checkins'\)\.insert\({[\s\S]+?}\)/g) || [];
  assert.ok(inserts.length >= 2, 'expected at least verify + reject inserts');
  for (const block of inserts) {
    assert.match(block, /door_session_id/);
  }
});

test('tickets scan route inserts door_session_id on every audit write', () => {
  assert.match(ticketsRoute, /doorSessionId\s*=\s*typeof body\?\.door_session_id/);
  const inserts = ticketsRoute.match(/ticket_checkins'\)\.insert\({[\s\S]+?}\)/g) || [];
  assert.ok(inserts.length >= 3, 'expected preview/checkin/reject/lost_race inserts');
  for (const block of inserts) {
    assert.match(block, /door_session_id/);
  }
});

test('UnifiedScanClient passes door_session_id on every fetch to a scan API', () => {
  // Every fetch to /api/(capacity/trial-pass|scan/member-id|tickets)/scan
  // MUST include door_session_id in its request body, otherwise the shift
  // stamp is dropped on the floor.
  const scanFetches = clientSrc.match(/fetch\('\/api\/(?:capacity\/trial-pass\/scan|scan\/member-id|tickets\/scan)'[\s\S]+?}\)/g) || [];
  assert.ok(scanFetches.length >= 8, `expected many scan fetches, found ${scanFetches.length}`);
  for (const block of scanFetches) {
    assert.match(block, /door_session_id/, `missing door_session_id in fetch: ${block.slice(0, 200)}`);
  }
});

test('UnifiedScanClient loads active door session on mount', () => {
  assert.match(clientSrc, /fetch\('\/api\/door-session\/active'\)/);
});

test('UnifiedScanClient exposes Start/End Event via SessionControl', () => {
  assert.match(clientSrc, /function SessionControl\(/);
  assert.match(clientSrc, /START EVENT/);
  assert.match(clientSrc, /End event/);
});

test('UnifiedScanClient uses a confirm modal before ending the shift', () => {
  assert.match(clientSrc, /ConfirmEndOverlay/);
  assert.match(clientSrc, /confirmEnd/);
});
