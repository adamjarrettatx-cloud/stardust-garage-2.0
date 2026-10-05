import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStationUsername, stationCanRequest, sameOrigin, hashStationToken, STATION_COOKIE } from '../lib/station-policy.js';

test('station usernames normalize without accepting email, Unicode, or path injection', () => {
  assert.equal(normalizeStationUsername(' Front-Desk '), 'front-desk');
  for (const input of ['', 'ab', '-security', 'a/b', 'security@example.com', 'sеcurity', 'a'.repeat(33), null, {}]) {
    assert.equal(normalizeStationUsername(input), null);
  }
});
test('station allowlists enforce both exact path and method', () => {
  assert.equal(stationCanRequest('security', '/capacity/security'), true);
  assert.equal(stationCanRequest('security', '/api/capacity/security', 'POST'), true);
  assert.equal(stationCanRequest('security', '/api/station/guest-search'), true);
  assert.equal(stationCanRequest('front_desk', '/api/capacity/trial-pass/roster-checkin', 'POST'), true);
  for (const role of ['security', 'front_desk', 'calendar_availability']) {
    for (const path of ['/bananas', '/team/calendar', '/api/admin/stations', '/api/admin/invite-team-member', '/api/capacity/admin', '/api/account/profile', '/api/artist-pay/payouts', '/api/station/guest-search/extra', '/api/time-clock', '/api/team/time-clock']) {
      assert.equal(stationCanRequest(role, path), false, `${role}: ${path}`);
      assert.equal(stationCanRequest(role, path, 'POST'), false);
    }
    assert.equal(stationCanRequest(role, '/api/door-session/active', 'DELETE'), false);
  }
  assert.equal(stationCanRequest('security', '/api/tickets/scan', 'POST'), false);
  assert.equal(stationCanRequest('front_desk', '/api/door-session/online-sales'), true);
  assert.equal(stationCanRequest('front_desk', '/api/door-session/online-sales', 'POST'), false);
  assert.equal(stationCanRequest('security', '/api/door-session/online-sales'), false);
  assert.equal(stationCanRequest('security', '/capacity/front-desk'), false);
  assert.equal(stationCanRequest('front_desk', '/api/capacity/security', 'POST'), false);
  assert.equal(stationCanRequest('front_desk', '/capacity/security'), false);
  assert.equal(stationCanRequest('admin', '/capacity/security'), false);
});
test('front desk station reaches Orders & Refunds and nothing else in admin ticketing', () => {
  const id = '3f2b6c1e-8a4d-4f7b-9c2e-1d5a6b7c8d9e';
  assert.equal(stationCanRequest('front_desk', '/capacity/front-desk/orders'), true);
  assert.equal(stationCanRequest('front_desk', '/capacity/front-desk/orders', 'POST'), false);
  assert.equal(stationCanRequest('front_desk', '/api/admin/tickets/roster'), true);
  assert.equal(stationCanRequest('front_desk', '/api/admin/tickets/refunds'), true);
  assert.equal(stationCanRequest('front_desk', '/api/admin/tickets/refunds', 'POST'), true);
  assert.equal(stationCanRequest('front_desk', `/api/admin/tickets/orders/${id}`, 'POST'), true);
  for (const [path, method] of [[`/api/admin/tickets/orders/${id}`, 'GET'], [`/api/admin/tickets/orders/${id}/x`, 'POST'],
    ['/api/admin/tickets/orders/not-a-uuid', 'POST'], ['/api/admin/tickets/orders', 'GET'], ['/bananas/orders', 'GET'],
    ['/api/admin/tickets/roster', 'POST'], ['/api/admin/events/x/attendees', 'GET']]) {
    assert.equal(stationCanRequest('front_desk', path, method), false, `${method} ${path}`);
  }
  for (const role of ['security', 'calendar_availability']) {
    assert.equal(stationCanRequest(role, '/capacity/front-desk/orders'), false);
    assert.equal(stationCanRequest(role, '/api/admin/tickets/refunds', 'POST'), false);
    assert.equal(stationCanRequest(role, `/api/admin/tickets/orders/${id}`, 'POST'), false);
  }
});
test('availability has only its workspace, sanitized read endpoint, session and logout', () => {
  for (const path of ['/staff/availability','/api/station/availability','/api/station/session']) {
    assert.equal(stationCanRequest('calendar_availability', path), true);
    assert.equal(stationCanRequest('calendar_availability', path, 'POST'), false);
  }
  assert.equal(stationCanRequest('calendar_availability', '/api/station/logout', 'POST'), true);
  for (const path of ['/api/door-session/active','/api/station/guest-search','/api/capacity/security','/capacity/security','/capacity/front-desk','/api/station/availability/extra']) {
    assert.equal(stationCanRequest('calendar_availability', path), false);
    assert.equal(stationCanRequest('calendar_availability', path, 'POST'), false);
  }
  for (const role of ['security','front_desk','admin','calendar_viewer','__proto__']) {
    assert.equal(stationCanRequest(role, '/api/station/availability'), false);
  }
});
test('CSRF rejects missing, null, cross-site and sibling-domain origins', () => {
  for (const origin of [null, 'null', 'https://evil.example', 'https://sdgatx.com']) {
    const headers = origin ? { origin } : {};
    assert.equal(sameOrigin(new Request('https://www.sdgatx.com/api/station/login', { headers })), false);
  }
  assert.equal(sameOrigin(new Request('https://www.sdgatx.com/api/station/login', { headers: { origin: 'https://www.sdgatx.com' } })), true);
});
test('opaque cookies use host-only name and SHA-256 hashes', async () => {
  assert.equal(STATION_COOKIE, '__Host-sdg-station');
  assert.equal((await hashStationToken('test')).length, 64);
  assert.notEqual(await hashStationToken('test'), await hashStationToken('other'));
});
