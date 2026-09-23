import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerState, partnerRouteRedirect, partnerViews, isRestrictedStaffRole } from '../lib/partner-access.js';

const active = { is_active: true, activated_at: '2026-09-01' };
test('partner lifecycle distinguishes pending invitations from revoked profiles', () => {
  assert.equal(partnerState(null), 'none');
  assert.equal(partnerState({ is_active: false }), 'invited');
  assert.equal(partnerState(active), 'active');
  assert.equal(partnerState({ ...active, is_active: false }), 'disabled');
});
test('partner status never diverts a member or customer away from their own account', () => {
  for (const pathname of ['/member', '/member/wallet', '/account/profile', '/account/tickets', '/team/calendar']) {
    assert.equal(partnerRouteRedirect({ pathname, partner: active }), null);
  }
});
test('active partners can use their portal alongside member or staff capabilities', () => {
  for (const teamRole of [null, 'team', 'admin']) {
    assert.equal(partnerRouteRedirect({ pathname: '/portal/profile', partner: active, teamRole }), null);
  }
});
test('no partner profile is not an administrator preview entitlement', () => {
  assert.equal(partnerRouteRedirect({ pathname: '/portal', partner: null, teamRole: 'admin' }), '/account/profile');
});
test('pending profiles go to activation, disabled profiles do not', () => {
  assert.equal(partnerRouteRedirect({ pathname: '/portal/pay', partner: { is_active: false } }), '/portal/activate');
  assert.equal(partnerRouteRedirect({ pathname: '/portal/pay', partner: { ...active, is_active: false } }), '/account/profile');
});
test('restricted staff roles remain restricted even with a partner row', () => {
  for (const [teamRole, expected] of [['front_desk', '/capacity/front-desk'], ['calendar_viewer', '/team/calendar']]) {
    assert.equal(isRestrictedStaffRole(teamRole), true);
    assert.equal(partnerRouteRedirect({ pathname: '/portal', partner: active, teamRole }), expected);
  }
  assert.equal(isRestrictedStaffRole('team'), false);
});
test('views follow contact types AND assigned resources, never unrelated records', () => {
  assert.deepEqual(partnerViews(['promoter']), { guestList: true, pay: false, contracts: false, events: false });
  assert.deepEqual(partnerViews(['dj']), { guestList: true, pay: true, contracts: false, events: false });
  assert.deepEqual(partnerViews(['other']), { guestList: false, pay: false, contracts: false, events: false });
  assert.deepEqual(partnerViews(['other'], { grants: [{}], bookings: [{}], contracts: [{}] }), {
    guestList: false, pay: false, contracts: false, events: false,
  });
});
