import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('all named admission routes guard before their first admission mutation', () => {
  const paths = [
    ['app/api/capacity/trial-pass/scan/route.js', ".from('trial_pass_checkins')"],
    ['app/api/scan/member-id/route.js', ".from('member_id_scans')"],
    ['app/api/capacity/guestlist/operation/route.js', 'const resolved = await resolveGuestProfile'],
    ['app/api/capacity/trial-pass/roster-checkin/route.js', 'admin.rpc('],
  ];
  const ticket = read('app/api/tickets/scan/route.js');
  assert.match(ticket, /guest_pass_required/);
  assert.doesNotMatch(ticket, /\.update\(/);
  for (const [path, marker] of paths) {
    const source = read(path);
    if (source.includes('return commitAdmission(admin,')) {
      const shared = read('lib/capacity/commit-admission.ts');
      assert.match(shared, /const blocked = await restrictionGuard/);
      assert.match(shared, /if \(blocked\) return blocked/);
      assert.ok(shared.indexOf('restrictionGuard(admin,') < shared.indexOf("admin.rpc('commit_door_admission'"));
      assert.ok(source.indexOf('return commitAdmission(admin,') < source.indexOf(marker), path);
      continue;
    }
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
  assert.ok(panel.indexOf('const result = await onCheckIn(row)') < panel.indexOf('setSignins(previous => mergeArrivals'));
  assert.match(panel, /<AccessCheck/);
});
