import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatPhone, normalizeStoredPhone, phoneHref, phoneMatchesQuery, usPhoneDigits } from '../lib/phone.js';

test('every US input stores as E.164 and displays as +1 (XXX) XXX-XXXX', () => {
  for (const input of ['5127897915', '512-789-7915', '512 789 7915', '(512) 789-7915', '15127897915', '+1 (512) 789-7915', '+15127897915', ' 512.789.7915 ']) {
    assert.equal(normalizeStoredPhone(input), '+15127897915', input);
    assert.equal(formatPhone(input), '+1 (512) 789-7915', input);
  }
});

test('international, wrong-length and invalid NANP numbers are kept as entered', () => {
  for (const input of ['+447391226140', '+972508776504', '33769301873', '1512300703', '+51276677777', '555-0100']) {
    assert.equal(usPhoneDigits(input), null, input);
    assert.equal(normalizeStoredPhone(input), input, input);
    assert.equal(formatPhone(input), input, input);
  }
  assert.equal(normalizeStoredPhone(''), '');
  assert.equal(formatPhone(null), '');
});

test('tel links dial the canonical number and search matches any typed format', () => {
  assert.equal(phoneHref('(512) 789-7915'), 'tel:+15127897915');
  assert.equal(phoneHref(''), undefined);
  assert.ok(phoneMatchesQuery('+15127897915', '(512) 789'));
  assert.ok(phoneMatchesQuery('+15127897915', '512-789-7915'));
  assert.ok(!phoneMatchesQuery('+15127897915', '12'));
});

test('the database rule mirrors the JS rule on every phone table', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261012220000_normalize_phone_numbers.sql', import.meta.url), 'utf8');
  assert.match(sql, /'\^\[2-9\]\[0-9\]\{2\}\[2-9\]\[0-9\]\{6\}\$'/);
  for (const table of ['attendees', 'collaborations', 'contacts', 'early_member_applications', 'free_accounts', 'guest_profiles',
    'membership_applications', 'micro_party_inquiries', 'signups', 'trial_passes', 'venue_inquiries']) {
    assert.ok(sql.includes(`'${table}'`), table);
  }
  assert.match(sql, /before insert or update of phone/);
  assert.match(sql, /disable trigger contacts_updated_at/);
  assert.match(sql, /enable trigger contacts_updated_at/);
});
