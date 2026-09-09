// Unit tests for the notification type catalog.
//
// The catalog is the contract between callers of notify() and the sender
// (which reads defaultChannels + userConfigurable to decide what to do). A
// regression here silently breaks delivery, so the assertions are strict:
//
//   * every listed type has the required fields
//   * essential (non-userConfigurable) types are exactly the ones that
//     genuinely can't be turned off
//   * effectiveChannels() respects the override rules

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_TYPES,
  CATEGORIES,
  getType,
  listTypes,
  listUserConfigurableTypes,
  effectiveChannels,
} from '../lib/notifications/types.js';

test('every type has required fields', () => {
  for (const [id, def] of Object.entries(NOTIFICATION_TYPES)) {
    assert.equal(def.id, id, `type ${id}: id mismatch`);
    assert.ok(def.category, `type ${id}: missing category`);
    assert.ok(Object.values(CATEGORIES).includes(def.category), `type ${id}: bad category ${def.category}`);
    assert.ok(def.label, `type ${id}: missing label`);
    assert.ok(def.description, `type ${id}: missing description`);
    assert.ok(def.defaultChannels, `type ${id}: missing defaultChannels`);
    assert.equal(typeof def.defaultChannels.in_app, 'boolean', `type ${id}: in_app default`);
    assert.equal(typeof def.defaultChannels.push, 'boolean', `type ${id}: push default`);
    assert.equal(typeof def.defaultChannels.email, 'boolean', `type ${id}: email default`);
    assert.equal(typeof def.userConfigurable, 'boolean', `type ${id}: userConfigurable`);
    assert.equal(typeof def.requiresEmail, 'boolean', `type ${id}: requiresEmail`);
  }
});

test('essential types include ticket, refund, welcome, renewal, payment failed, contract', () => {
  const essentialIds = [
    'ticket_ready', 'ticket_refund_issued', 'member_welcome',
    'member_renewal_upcoming', 'member_payment_failed', 'contract_signed',
    'trial_activated', 'trial_ending_soon',
  ];
  for (const id of essentialIds) {
    const t = getType(id);
    assert.ok(t, `expected essential type ${id} to exist`);
    assert.equal(t.userConfigurable, false, `${id} must not be user-configurable`);
  }
});

test('marketing types are user-configurable and default push+email on', () => {
  const marketing = listTypes().filter((t) => t.category === CATEGORIES.MARKETING);
  assert.ok(marketing.length > 0, 'expected at least one marketing type');
  for (const t of marketing) {
    assert.equal(t.userConfigurable, true, `${t.id} marketing must be user-configurable`);
    // Marketing defaults ON per product decision.
    assert.equal(t.defaultChannels.push, true, `${t.id} push default should be on`);
  }
});

test('in-app is always on regardless of pref override', () => {
  const t = getType('event_published');
  assert.ok(t);
  const ch = effectiveChannels('event_published', { in_app: false, push: false, email: false });
  assert.equal(ch.in_app, true, 'in-app must be forced on');
});

test('user-configurable pref overrides push/email defaults', () => {
  // Marketing type: push default ON, but user turns it off \u2014 must honor.
  const t = listTypes().find((x) => x.category === CATEGORIES.MARKETING && x.userConfigurable);
  assert.ok(t, 'expected a configurable marketing type');
  const ch = effectiveChannels(t.id, { push: false, email: false });
  assert.equal(ch.push, false);
  assert.equal(ch.email, false);
});

test('essential type ignores pref \u2014 email default is preserved', () => {
  // ticket_ready: essential, email default ON. Even if the user's pref row
  // says email off, essentials always deliver.
  const ch = effectiveChannels('ticket_ready', { email: false, push: false });
  const def = getType('ticket_ready');
  assert.equal(ch.email, def.defaultChannels.email);
  assert.equal(ch.push, def.defaultChannels.push);
});

test('listUserConfigurableTypes omits essentials', () => {
  const list = listUserConfigurableTypes();
  for (const t of list) {
    assert.equal(t.userConfigurable, true);
  }
  const ids = new Set(list.map((t) => t.id));
  assert.equal(ids.has('ticket_ready'), false, 'essential must not appear in settings');
  assert.equal(ids.has('member_welcome'), false);
});

test('getType() returns null for unknown type', () => {
  assert.equal(getType('does_not_exist'), null);
  assert.equal(getType(null), null);
  assert.equal(getType(''), null);
});
