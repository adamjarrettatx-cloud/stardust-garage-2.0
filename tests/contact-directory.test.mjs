import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTACT_DIRECTORY_SECTIONS,
  CONTACT_TYPE_OPTIONS,
  contactDirectoryHref,
  contactDirectoryTypes,
  contactMatchesDirectorySection,
  filterDirectoryContacts,
  isContactTypeSelected,
  toggleContactType,
} from '../lib/contact-helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'app/bananas/contacts/ContactsList.js'), 'utf8');

test('the directory exposes exactly the six approved sections in order', () => {
  const expected = ['Artist', 'Event Organizer', 'Venue Renter', 'Vendor', 'Collective', 'Promoter'];
  assert.deepEqual(CONTACT_DIRECTORY_SECTIONS.map(section => section.label), expected);
  assert.deepEqual(CONTACT_TYPE_OPTIONS.map(option => option.label), expected);
});

test('DJ and Performer records are included under Artist without changing stored records', () => {
  for (const value of ['artist', 'dj', 'performer']) {
    assert.equal(contactMatchesDirectorySection([value], 'artist'), true);
    assert.equal(isContactTypeSelected([value], 'artist'), true);
  }
  assert.deepEqual(contactDirectoryTypes(['dj', 'event_organizer']), ['artist', 'event_organizer']);
  assert.equal(contactMatchesDirectorySection(['collective'], 'artist'), false);
});

test('Artist form toggles replace legacy artist aliases without touching unrelated historical types', () => {
  assert.deepEqual(toggleContactType(['dj', 'resident'], 'artist'), ['resident']);
  assert.deepEqual(toggleContactType(['resident'], 'artist'), ['resident', 'artist']);
  assert.deepEqual(toggleContactType(['performer', 'other'], 'artist'), ['other']);
});

test('directory URLs only accept the six known categories', () => {
  assert.equal(contactDirectoryHref('artist'), '/bananas/contacts?category=artist');
  assert.equal(contactDirectoryHref('dj'), '/bananas/contacts');
  assert.equal(contactDirectoryHref('all'), '/bananas/contacts');
});

test('section filtering supports aliases, status, and text search', () => {
  const rows = [
    { id: 1, display_name: 'DJ One', contact_type: ['dj'], status: 'active', email: 'dj@example.com' },
    { id: 2, display_name: 'Act Two', contact_type: ['performer'], status: 'inactive' },
    { id: 3, display_name: 'Vendor', contact_type: ['vendor'], status: 'active' },
  ];
  assert.deepEqual(filterDirectoryContacts(rows, 'artist').map(row => row.id), [1, 2]);
  assert.deepEqual(filterDirectoryContacts(rows, 'artist', 'example', 'active').map(row => row.id), [1]);
  assert.deepEqual(filterDirectoryContacts(rows, 'artist', '', 'inactive').map(row => row.id), [2]);
});

test('multi-role contacts count once per category and filtering never mutates stored types', () => {
  const types = Object.freeze(['dj', 'artist', 'performer', 'collective', 'resident']);
  const contact = Object.freeze({ id: 1, contact_type: types, status: 'active' });
  assert.equal(filterDirectoryContacts([contact], 'artist').length, 1);
  assert.equal(filterDirectoryContacts([contact], 'collective').length, 1);
  assert.deepEqual(contactDirectoryTypes(types), ['artist', 'collective']);
  assert.deepEqual(types, ['dj', 'artist', 'performer', 'collective', 'resident']);
});

test('missing and unsupported types cannot create extra directory categories', () => {
  assert.deepEqual(contactDirectoryTypes(null), []);
  assert.equal(contactMatchesDirectorySection(['other'], 'other'), false);
  assert.equal(contactMatchesDirectorySection(['resident'], 'resident'), false);
  assert.deepEqual(filterDirectoryContacts([{ contact_type: ['artist'] }], 'all'), []);
});

test('the page opens on section cards and does not render an All tab', () => {
  assert.match(source, /CONTACT_DIRECTORY_SECTIONS\.map/);
  assert.ok(!/UnderlineTabs/.test(source));
  assert.ok(!/label:\s*['"]All['"]/.test(source));
});

test('contact rows use a full-height rounded container with a square left image', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app/bananas/contacts/contacts.module.css'), 'utf8');
  assert.match(css, /\.row\{[^}]*height:104px[^}]*border-radius:16px[^}]*overflow:hidden/);
  assert.match(css, /\.image\{width:104px;height:104px;flex:0 0 104px/);
  assert.ok(!/rounded-full/.test(source));
});
