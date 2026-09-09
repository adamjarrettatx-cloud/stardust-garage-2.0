import test from 'node:test';
import assert from 'node:assert/strict';

import {
  memberSatisfiesTierGate,
  MEMBERSHIP_TIER_RANK,
} from '../lib/membership-tiers.js';

test('no required tier -> everyone passes (even non-members)', () => {
  assert.equal(memberSatisfiesTierGate(null, null), true);
  assert.equal(memberSatisfiesTierGate(undefined, ''), true);
  assert.equal(memberSatisfiesTierGate('weekender', null), true);
  assert.equal(memberSatisfiesTierGate('iykyk', ''), true);
});

test('required tier + no member tier -> blocked', () => {
  assert.equal(memberSatisfiesTierGate(null, 'weekender'), false);
  assert.equal(memberSatisfiesTierGate(undefined, 'iykyk'), false);
  assert.equal(memberSatisfiesTierGate('', 'cowork'), false);
});

test('exact match passes', () => {
  assert.equal(memberSatisfiesTierGate('weekender', 'weekender'), true);
  assert.equal(memberSatisfiesTierGate('cowork', 'cowork'), true);
  assert.equal(memberSatisfiesTierGate('iykyk', 'iykyk'), true);
});

test('higher tier satisfies lower requirement', () => {
  // Insider can access Weekender + Builder events.
  assert.equal(memberSatisfiesTierGate('iykyk', 'weekender'), true);
  assert.equal(memberSatisfiesTierGate('iykyk', 'cowork'), true);
  // Builder can access Weekender events.
  assert.equal(memberSatisfiesTierGate('cowork', 'weekender'), true);
});

test('lower tier does NOT satisfy higher requirement', () => {
  // A Builder cannot buy an Insider-only ticket.
  assert.equal(memberSatisfiesTierGate('cowork', 'iykyk'), false);
  // A Weekender cannot buy Insider or Builder tickets.
  assert.equal(memberSatisfiesTierGate('weekender', 'iykyk'), false);
  assert.equal(memberSatisfiesTierGate('weekender', 'cowork'), false);
});

test('unknown tier keys fail closed', () => {
  // Unknown required tier -> block (defensive default).
  assert.equal(memberSatisfiesTierGate('iykyk', 'nonsense'), false);
  // Unknown member tier -> block (member has some other plan we don't know).
  assert.equal(memberSatisfiesTierGate('legacy_founder', 'weekender'), false);
});

test('rank ordering matches the pricing hierarchy', () => {
  // Sanity: this is the contract the gate depends on. If someone reorders
  // it, this test flags it before it silently changes access rules.
  assert.equal(MEMBERSHIP_TIER_RANK.weekender, 0);
  assert.equal(MEMBERSHIP_TIER_RANK.cowork, 1);
  assert.equal(MEMBERSHIP_TIER_RANK.iykyk, 2);
});
