import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('all named admission routes guard before their first admission mutation', () => {
  const paths = [
    ['app/api/capacity/trial-pass/scan/route.js', ".from('trial_pass_checkins')"],
    ['app/api/scan/member-id/route.js', ".from('member_id_scans')"],
    ['app/api/tickets/scan/route.js', ".from('ticket_checkins')"],
    ['app/api/capacity/guestlist/operation/route.js', 'const resolved = await resolveGuestProfile'],
    ['app/api/capacity/trial-pass/roster-checkin/route.js', 'client.rpc('],
  ];
  for (const [path, marker] of paths) {
    const source = read(path);
    assert.match(source, /const blocked = await restrictionGuard/);
    assert.match(source, /if \(blocked\) return blocked/);
    assert.ok(source.indexOf('const blocked = await restrictionGuard') < source.indexOf(marker), path);
  }
});
test('server failure is hold-entry, not silent empty restriction list', () => {
  const source = read('lib/capacity/access-restrictions.js');
  assert.match(source, /status: 503/);
  assert.match(source, /code: 'access_unavailable'/);
  assert.match(source, /r\.match === 'confirmed' \|\| !excluded\.has\(r\.id\)/);
});
test('front desk preserves columns and adds a drawer; admission marks happen after success', () => {
  const page = read('app/capacity/front-desk/FrontDeskClient.js');
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,0.85fr\)_minmax\(0,1fr\)\]/);
  assert.match(page, /<AccessRestrictions/);
  const panel = read('app/capacity/front-desk/TonightSignInsPanel.js');
  assert.ok(panel.indexOf('warning = await onCheckIn(row)') < panel.indexOf('next.add(row.id)'));
  assert.match(panel, /<AccessCheck/);
});
