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
  for (const role of ['security', 'front_desk']) {
    for (const path of ['/bananas', '/team/calendar', '/api/admin/stations', '/api/admin/invite-team-member', '/api/capacity/admin', '/api/account/profile', '/api/artist-pay/payouts', '/api/station/guest-search/extra', '/api/time-clock', '/api/team/time-clock']) {
      assert.equal(stationCanRequest(role, path), false, `${role}: ${path}`);
      assert.equal(stationCanRequest(role, path, 'POST'), false);
    }
    assert.equal(stationCanRequest(role, '/api/door-session/active', 'DELETE'), false);
  }
  assert.equal(stationCanRequest('security', '/api/tickets/scan', 'POST'), false);
  assert.equal(stationCanRequest('security', '/capacity/front-desk'), false);
  assert.equal(stationCanRequest('front_desk', '/api/capacity/security', 'POST'), false);
  assert.equal(stationCanRequest('front_desk', '/capacity/security'), false);
  assert.equal(stationCanRequest('admin', '/capacity/security'), false);
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
