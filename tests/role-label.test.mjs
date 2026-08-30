import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roleLabel,
  portalName,
  canHostGuestList,
  canRequestPay,
  canSignContracts,
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

test('roleLabel and portalName know the Event Organizer type', () => {
  assert.equal(roleLabel(['event_organizer']), 'Event Organizer');
  assert.equal(roleLabel(['event_organizer'], { plural: true }), 'Event Organizers');
  assert.equal(portalName(['event_organizer']), 'Organizer Portal');
});

test('canSignContracts: true for legal counterparty roles only', () => {
  // These types are the ones SDG signs agreements with, so they get the portal
  // Contracts tab by default.
  assert.equal(canSignContracts(['event_organizer']), true);
  assert.equal(canSignContracts(['promoter']), true);
  assert.equal(canSignContracts(['venue_renter']), true);
  assert.equal(canSignContracts(['collective']), true);
  assert.equal(canSignContracts(['vendor']), true);
  // A booked DJ signs through the artist pay flow, not a venue agreement — the
  // tab only appears for them if they actually have a contract on file.
  assert.equal(canSignContracts(['dj']), false);
  assert.equal(canSignContracts(['artist']), false);
  assert.equal(canSignContracts(['resident']), false);
  assert.equal(canSignContracts([]), false);
  assert.equal(canSignContracts(null), false);
  // A string is tolerated the same way the other role helpers tolerate it.
  assert.equal(canSignContracts('event_organizer'), true);
  // Mixed types: one qualifying role is enough.
  assert.equal(canSignContracts(['dj', 'event_organizer']), true);
});
