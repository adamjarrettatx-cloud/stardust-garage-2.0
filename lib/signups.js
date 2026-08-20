// The Sign Ups list itself: where a row came from, and how the admin page turns
// the table into the CSV that gets imported into Mailchimp.
//
// Pure — no Supabase, no React — so the export format is unit-testable and the
// door kiosk and the admin page agree on the `source` value without importing
// each other.

// Every writer of public.signups. `source` already existed for the homepage
// form; the door kiosk is the second one, and staff need to tell them apart
// because a door signup carries a signed consent record and a name.
export const HOMEPAGE_SIGNUP_SOURCE = 'homepage';
export const GUEST_LIST_SIGNUP_SOURCE = 'guest_list_checkin';
// Third writer: the printed-QR trial pass form (/pass). Like a door signup it
// arrives with a name, an email and a phone, but the person typed it themselves
// off their own phone rather than an attendant typing it for them — worth
// telling apart when Adam looks at where the list is actually coming from.
export const TRIAL_PASS_SIGNUP_SOURCE = 'trial_pass_qr';

const SOURCE_LABELS = {
  [HOMEPAGE_SIGNUP_SOURCE]: 'Homepage',
  [GUEST_LIST_SIGNUP_SOURCE]: 'Door check-in',
  [TRIAL_PASS_SIGNUP_SOURCE]: 'Trial pass QR',
};

export function signupSourceLabel(source) {
  const value = typeof source === 'string' ? source.trim() : '';
  if (value === '') return 'Unknown';
  return SOURCE_LABELS[value] || value;
}

const CSV_COLUMNS = [
  ['Name', (row) => row.full_name],
  ['Contact', (row) => row.contact],
  ['Type', (row) => row.contact_type],
  ['Phone', (row) => row.phone],
  ['Source', (row) => signupSourceLabel(row.source)],
  ['Status', (row) => row.status],
  ['Signed Up At', (row) => row.created_at],
];

// Quote every cell and double any quote inside it, so a name or a note
// containing a comma, a quote or a newline cannot shift the remaining columns
// of that row into the wrong header.
//
// The leading apostrophe on =, +, - and @ is CSV injection defence: guest names
// reach this table from a partner's free-text guest list, and Excel/Sheets
// evaluate a cell starting with any of those as a formula on open.
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// The whole Sign Ups table as CSV, newest first (the caller's order is kept).
// Returns '' for an empty list so the admin page can hide the download button.
export function buildSignupsCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return '';

  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(',')];
  for (const row of list) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(row || {}))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
