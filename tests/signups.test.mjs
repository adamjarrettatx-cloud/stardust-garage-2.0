import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_LIST_SIGNUP_SOURCE,
  HOMEPAGE_SIGNUP_SOURCE,
  buildSignupsCsv,
  signupSourceLabel,
} from '../lib/signups.js';

function lines(csv) {
  return csv.trimEnd().split('\n');
}

test('the two writers of public.signups stay distinguishable', () => {
  assert.equal(HOMEPAGE_SIGNUP_SOURCE, 'homepage');
  assert.equal(GUEST_LIST_SIGNUP_SOURCE, 'guest_list_checkin');
  assert.notEqual(HOMEPAGE_SIGNUP_SOURCE, GUEST_LIST_SIGNUP_SOURCE);
});

test('source labels read as English, and an unknown source is shown as-is', () => {
  assert.equal(signupSourceLabel(HOMEPAGE_SIGNUP_SOURCE), 'Homepage');
  assert.equal(signupSourceLabel(GUEST_LIST_SIGNUP_SOURCE), 'Door check-in');
  // Rows written before `source` existed, and any writer added later, must not
  // render as blank or crash the admin table.
  assert.equal(signupSourceLabel(null), 'Unknown');
  assert.equal(signupSourceLabel('  '), 'Unknown');
  assert.equal(signupSourceLabel('instagram_bio'), 'instagram_bio');
});

test('an empty list produces no CSV at all, so the download button can hide', () => {
  assert.equal(buildSignupsCsv([]), '');
  assert.equal(buildSignupsCsv(null), '');
});

test('the export carries the phone and name a Mailchimp import needs', () => {
  const csv = buildSignupsCsv([
    {
      full_name: 'Jane Doe',
      contact: 'jane@example.com',
      contact_type: 'email',
      phone: '(512) 555-1234',
      source: GUEST_LIST_SIGNUP_SOURCE,
      status: 'new',
      created_at: '2026-08-01T02:00:00.000Z',
    },
  ]);

  const [header, row] = lines(csv);
  assert.equal(header, '"Name","Contact","Type","Phone","Source","Status","Signed Up At"');
  assert.equal(
    row,
    '"Jane Doe","jane@example.com","email","(512) 555-1234","Door check-in","new","2026-08-01T02:00:00.000Z"',
  );
});

// The homepage form only ever collected one contact, so those rows have no
// phone and no name. They must still export cleanly rather than printing
// "undefined" into a column somebody then imports.
test('a homepage signup exports with empty cells, not undefined', () => {
  const csv = buildSignupsCsv([
    { contact: 'fan@example.com', contact_type: 'email', source: 'homepage', status: 'seen', created_at: '2026-07-01T00:00:00.000Z' },
  ]);

  assert.equal(
    lines(csv)[1],
    '"","fan@example.com","email","","Homepage","seen","2026-07-01T00:00:00.000Z"',
  );
});

// Guest names reach signups from a partner's free-text guest list, so a name
// containing a comma or a quote must not shift the remaining columns of that
// row into the wrong header.
test('commas, quotes and newlines in a value stay inside their own cell', () => {
  const csv = buildSignupsCsv([
    {
      full_name: 'Doe, Jane "JD"',
      contact: 'jane@example.com',
      contact_type: 'email',
      phone: '5125551234',
      source: 'homepage',
      status: 'new',
      created_at: '2026-08-01T02:00:00.000Z',
    },
  ]);

  const row = lines(csv)[1];
  assert.ok(row.startsWith('"Doe, Jane ""JD""","jane@example.com"'));
});

// A cell starting with =, +, - or @ is evaluated as a formula by Excel and
// Sheets the moment the export is opened. These values come from strangers at
// a door, so they get neutralized on the way out.
test('a value that looks like a spreadsheet formula is neutralized', () => {
  const csv = buildSignupsCsv([
    {
      full_name: '=HYPERLINK("http://evil.test","claim")',
      contact: '+15125551234',
      contact_type: 'phone',
      phone: '-1',
      source: 'homepage',
      status: 'new',
      created_at: '2026-08-01T02:00:00.000Z',
    },
  ]);

  const row = lines(csv)[1];
  assert.ok(row.startsWith(`"'=HYPERLINK(""http://evil.test"",""claim"")"`));
  assert.ok(row.includes(`"'+15125551234"`));
  assert.ok(row.includes(`"'-1"`));
});

test('every row lands under the header, one line each', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    contact: `person-${i}@example.com`,
    contact_type: 'email',
    source: 'homepage',
    status: 'new',
    created_at: '2026-08-01T02:00:00.000Z',
  }));

  assert.equal(lines(buildSignupsCsv(rows)).length, 6);
});
