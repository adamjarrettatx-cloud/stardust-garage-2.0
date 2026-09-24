import test from 'node:test';
import assert from 'node:assert/strict';
import { profileCapabilities, canBookStudio, profileMembershipAction } from '../lib/profile-capabilities.js';
import { partnerViews } from '../lib/partner-access.js';

test('profile rules cannot be expanded by accidentally assigned resources', () => {
  const resources = { bookings: [{}], grants: [{}], contracts: [{}] };
  assert.deepEqual(partnerViews(['promoter'], resources), { guestList: true, pay: false, contracts: false, events: false });
  assert.deepEqual(partnerViews(['vendor'], resources), { guestList: false, pay: false, contracts: true, events: false });
  for (const type of ['organization', 'collective', 'event_organizer']) {
    assert.deepEqual(partnerViews([type], resources), { guestList: true, pay: false, contracts: true, events: true });
  }
  assert.equal(profileCapabilities(['promoter', 'artist']).pay, true);
  assert.equal(profileCapabilities([]).events, false);
});
test('only an entitled Insider can book studio time', () => {
  for (const subscription_plan of ['weekender', 'cowork', null, 'unknown']) {
    assert.equal(canBookStudio({ subscription_plan, subscription_status: 'active', is_active: true }), false);
  }
  assert.equal(canBookStudio(null), false);
  for (const subscription_status of ['active', 'trialing']) {
    assert.equal(canBookStudio({ subscription_plan: 'iykyk', subscription_status, is_active: true }), true);
  }
  for (const subscription_status of ['past_due', 'canceled', null]) {
    assert.equal(canBookStudio({ subscription_plan: 'iykyk', subscription_status, is_active: true }), false);
  }
  assert.equal(canBookStudio({ subscription_plan: 'iykyk', subscription_status: 'active', is_active: false }), false);
});
test('Free has no membership action; both trial states link to public Memberships', () => {
  assert.equal(profileMembershipAction(), null);
  for (const status of ['active', 'expired']) {
    assert.deepEqual(profileMembershipAction({ passes: [{ status }] }), { href: '/members', label: 'Memberships' });
  }
  assert.equal(profileMembershipAction({ member: {}, passes: [{}] }).href, '/member');
});
