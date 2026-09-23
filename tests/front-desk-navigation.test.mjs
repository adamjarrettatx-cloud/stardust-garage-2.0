import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_TILES,
  DEFAULT_ADMIN_TAB,
  adminTabById,
  adminTabHref,
  resolveRootAdminTab,
  visibleAdminTabGroups,
} from '../lib/admin-tabs.js';

test('Front Desk is the first direct destination under ADMIN', () => {
  const group = visibleAdminTabGroups(true).find(({ group }) => group === 'ADMIN');
  assert.equal(group.tabs[0].id, 'front-desk');
  const tab = adminTabById('front-desk');
  assert.equal(tab.label, 'Front Desk');
  assert.equal(adminTabHref(tab), '/capacity/front-desk');
  assert.equal(tab.rendersOwnContent, true);
  assert.deepEqual(ADMIN_TILES['front-desk'], []);
});

test('non-owner admins can also see the Front Desk shortcut', () => {
  const group = visibleAdminTabGroups(false).find(({ group }) => group === 'ADMIN');
  assert.ok(group.tabs.some(({ id }) => id === 'front-desk'));
  assert.equal(adminTabById('front-desk').ownerOnly, false);
});

test('a Front Desk query cannot create an empty admin dashboard panel', () => {
  for (const isOwner of [true, false]) {
    assert.equal(resolveRootAdminTab('front-desk', { isOwner }), DEFAULT_ADMIN_TAB);
  }
});
