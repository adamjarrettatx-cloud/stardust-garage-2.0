import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POTENTIAL_MEMBER_STATUSES,
  isPotentialMemberStatus,
  normalizePotentialMemberStatus,
  canTransitionPotentialMember,
  potentialMemberActionsForStatus,
  potentialMemberStatusPresentation,
  validatePotentialMemberInput,
  buildPotentialMemberUpdates,
} from '../lib/potential-members.js';

test('status list matches the expected pipeline', () => {
  assert.deepEqual(
    POTENTIAL_MEMBER_STATUSES,
    ['potential', 'contacted', 'invited', 'converted', 'archived']
  );
});

test('isPotentialMemberStatus / normalizePotentialMemberStatus', () => {
  assert.equal(isPotentialMemberStatus('potential'), true);
  assert.equal(isPotentialMemberStatus('bogus'), false);
  assert.equal(normalizePotentialMemberStatus('bogus'), 'potential');
  assert.equal(normalizePotentialMemberStatus('converted'), 'converted');
});

test('potentialMemberStatusPresentation returns label/color for any input', () => {
  const cfg = potentialMemberStatusPresentation('invited');
  assert.equal(cfg.label, 'Invited to apply');
  const fallback = potentialMemberStatusPresentation(undefined);
  assert.equal(fallback.value, 'potential');
});

test('canTransitionPotentialMember allows forward moves and same-status no-ops', () => {
  assert.equal(canTransitionPotentialMember('potential', 'contacted'), true);
  assert.equal(canTransitionPotentialMember('potential', 'invited'), true);
  assert.equal(canTransitionPotentialMember('potential', 'archived'), true);
  assert.equal(canTransitionPotentialMember('potential', 'potential'), true);
});

test('canTransitionPotentialMember blocks backward moves and terminal states', () => {
  assert.equal(canTransitionPotentialMember('contacted', 'potential'), false);
  assert.equal(canTransitionPotentialMember('converted', 'contacted'), false);
  assert.equal(canTransitionPotentialMember('archived', 'potential'), false);
});

test('potentialMemberActionsForStatus reflects ALLOWED_TRANSITIONS', () => {
  const actions = potentialMemberActionsForStatus('potential').map((a) => a.status);
  assert.deepEqual(actions, ['contacted', 'invited', 'archived']);
  assert.deepEqual(potentialMemberActionsForStatus('converted'), []);
  assert.deepEqual(potentialMemberActionsForStatus('archived'), []);
});

test('validatePotentialMemberInput requires only full_name', () => {
  const result = validatePotentialMemberInput({ full_name: '  Jane Doe  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    full_name: 'Jane Doe',
    phone: null,
    email: null,
    notes: null,
  });
});

test('validatePotentialMemberInput rejects a missing/blank name', () => {
  assert.equal(validatePotentialMemberInput({}).valid, false);
  assert.equal(validatePotentialMemberInput({ full_name: '   ' }).valid, false);
  assert.equal(validatePotentialMemberInput(null).valid, false);
});

test('validatePotentialMemberInput trims optional fields and keeps them', () => {
  const result = validatePotentialMemberInput({
    full_name: 'Jane Doe',
    phone: ' 512-555-0100 ',
    email: ' jane@example.com ',
    notes: ' met at the bar, great vibe ',
  });
  assert.deepEqual(result.data, {
    full_name: 'Jane Doe',
    phone: '512-555-0100',
    email: 'jane@example.com',
    notes: 'met at the bar, great vibe',
  });
});

test('buildPotentialMemberUpdates only includes provided fields', () => {
  const { updates, error } = buildPotentialMemberUpdates({ status: 'contacted' });
  assert.equal(error, undefined);
  assert.deepEqual(updates, { status: 'contacted' });
});

test('buildPotentialMemberUpdates rejects an invalid status', () => {
  const { error } = buildPotentialMemberUpdates({ status: 'bogus' });
  assert.equal(error, 'Invalid status.');
});

test('buildPotentialMemberUpdates rejects a blank full_name', () => {
  const { error } = buildPotentialMemberUpdates({ full_name: '   ' });
  assert.equal(error, 'Full name cannot be empty.');
});

test('buildPotentialMemberUpdates supports clearing optional fields to null', () => {
  const { updates } = buildPotentialMemberUpdates({ phone: '', notes: '  ' });
  assert.deepEqual(updates, { phone: null, notes: null });
});
