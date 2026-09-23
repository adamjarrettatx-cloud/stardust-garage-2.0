import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminTabById, adminTabHref, adminTilesFor, adminTabBadge,
  adminTabBadges, visibleAdminTabGroups, tabForPath, crumbForPath,
} from '../lib/admin-tabs.js';

const destinations = [
  ['Collaborations', '/bananas/collaborations', 'collaborations', 'REVIEW'],
  ['Signups', '/bananas/signups', 'newSignups', 'VIEW'],
  ['Venue Inquiries', '/bananas/venue-inquiries', 'venueInquiries', 'REVIEW'],
  ['Micro Parties', '/bananas/micro-parties', 'microParties', 'REVIEW'],
  ['Studio Bookings', '/bananas/studio-bookings', 'upcomingBookings', 'MANAGE'],
];

test('Incoming replaces People and Rentals under Operations for owners and admins', () => {
  const incoming = adminTabById('incoming');
  assert.equal(incoming.label, 'Incoming');
  assert.equal(incoming.group, 'OPERATIONS');
  assert.equal(incoming.ownerOnly, false);
  assert.equal(adminTabHref(incoming), '/bananas?tab=incoming');
  for (const isOwner of [false, true]) {
    const operations = visibleAdminTabGroups(isOwner).find(g => g.group === 'OPERATIONS');
    assert.deepEqual(operations.tabs.map(t => t.id), [
      'tasks', 'events', 'chat', 'memberships', 'incoming',
    ]);
  }
});

test('Incoming preserves every existing destination, action, and count key', () => {
  assert.deepEqual(
    adminTilesFor('incoming').map(t => [t.title, t.href, t.countKey, t.action]),
    destinations,
  );
  assert.deepEqual(adminTilesFor('people'), []);
  assert.deepEqual(adminTilesFor('rentals'), []);
});

test('all Incoming pages and nested details highlight Incoming and return there', () => {
  for (const [title, href] of destinations) {
    for (const pathname of [href, `${href}/`, `${href}/record-id`]) {
      assert.equal(tabForPath(pathname), 'incoming');
      assert.deepEqual(crumbForPath(pathname), { title, tabId: 'incoming' });
    }
    assert.equal(tabForPath(`${href}-other`), null);
  }
});

test('Incoming badge combines both old queues without unrelated or duplicate counts', () => {
  const counts = {
    collaborations: 2, newSignups: 3, venueInquiries: 5,
    microParties: 7, upcomingBookings: 11,
    applications: 100, unreadChat: 100,
  };
  assert.equal(adminTabBadge('incoming', counts), 28);
  assert.equal(adminTabBadge('incoming'), 0);
  assert.equal(adminTabBadge('incoming', { venueInquiries: 5 }), 5);
  const badges = adminTabBadges(counts);
  assert.equal(badges.incoming, 28);
  assert.equal(badges.people, undefined);
  assert.equal(badges.rentals, undefined);
});
