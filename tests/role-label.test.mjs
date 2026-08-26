import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roleLabel,
  portalName,
  canHostGuestList,
  canRequestPay,
} from '../lib/role-label.js';

test('roleLabel: empty input falls back to Collaborator', () => {
  assert.equal(roleLabel([]), 'Collaborator');
  assert.equal(roleLabel(null), 'Collaborator');
  assert.equal(roleLabel(undefined), 'Collaborator');
  assert.equal(roleLabel(''), 'Collaborator');
});

test('roleLabel: empty input plural falls back to Collaborators', () => {
  assert.equal(roleLabel([], { plural: true }), 'Collaborators');
  assert.equal(roleLabel(null, { plural: true }), 'Collaborators');
});

test('roleLabel: single value renders the singular label', () => {
  assert.equal(roleLabel(['dj']), 'DJ');
  assert.equal(roleLabel(['collective']), 'Collective');
  assert.equal(roleLabel(['promoter']), 'Promoter');
  assert.equal(roleLabel(['venue_renter']), 'Venue Renter');
});

test('roleLabel: single value as a bare string also works', () => {
  assert.equal(roleLabel('dj'), 'DJ');
  assert.equal(roleLabel('artist'), 'Artist');
});

test('roleLabel: multiple values are joined with a middle dot', () => {
  assert.equal(roleLabel(['dj', 'collective']), 'DJ · Collective');
  assert.equal(
    roleLabel(['dj', 'artist', 'resident']),
    'DJ · Artist · Resident',
  );
});

test('roleLabel: plural form uses plural dictionary', () => {
  assert.equal(roleLabel(['dj'], { plural: true }), 'DJs');
  assert.equal(roleLabel(['collective'], { plural: true }), 'Collectives');
});

test('roleLabel: unknown values fall back to Collaborator, known values keep their label', () => {
  assert.equal(roleLabel(['dj', 'unknown_new_type']), 'DJ · Collaborator');
});

test('portalName: uses the first type as the primary', () => {
  assert.equal(portalName(['dj']), 'DJ Portal');
  assert.equal(portalName(['dj', 'collective']), 'DJ Portal');
  assert.equal(portalName(['collective', 'dj']), 'Collective Portal');
});

test('portalName: empty falls back to Collaborator Portal', () => {
  assert.equal(portalName([]), 'Collaborator Portal');
  assert.equal(portalName(null), 'Collaborator Portal');
});

test('portalName: venue_renter maps to Rental Portal', () => {
  assert.equal(portalName(['venue_renter']), 'Rental Portal');
});

test('canHostGuestList: true for hosting roles, false for vendor/venue_renter/other', () => {
  assert.equal(canHostGuestList(['dj']), true);
  assert.equal(canHostGuestList(['collective']), true);
  assert.equal(canHostGuestList(['promoter']), true);
  assert.equal(canHostGuestList(['resident']), true);
  assert.equal(canHostGuestList(['artist']), true);
  assert.equal(canHostGuestList(['performer']), true);
  assert.equal(canHostGuestList(['venue_renter']), false);
  assert.equal(canHostGuestList(['vendor']), false);
  assert.equal(canHostGuestList(['other']), false);
  assert.equal(canHostGuestList([]), false);
});

test('canHostGuestList: true if any of multiple types can host', () => {
  assert.equal(canHostGuestList(['vendor', 'dj']), true);
  assert.equal(canHostGuestList(['vendor', 'other']), false);
});

test('canRequestPay: true for contractor roles only', () => {
  assert.equal(canRequestPay(['dj']), true);
  assert.equal(canRequestPay(['artist']), true);
  assert.equal(canRequestPay(['performer']), true);
  assert.equal(canRequestPay(['resident']), true);
  assert.equal(canRequestPay(['collective']), false);
  assert.equal(canRequestPay(['promoter']), false);
  assert.equal(canRequestPay(['venue_renter']), false);
  assert.equal(canRequestPay(['vendor']), false);
  assert.equal(canRequestPay([]), false);
});
