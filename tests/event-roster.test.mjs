import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { purchaserName, assembleRoster, rosterTickets, matchesRosterSearch, rosterCsv, readRosterRows } from '../lib/tickets/event-roster.js';

test('checkout name wins; only linked profiles are fallback; never derive from email', () => {
  const profiles = [{ id: 'p1', user_id: 'u1', full_name: 'Profile Name' }];
  assert.equal(purchaserName({ buyer_name: '  Checkout Name  ', member_profile_id: 'p1' }, profiles), 'Checkout Name');
  assert.equal(purchaserName({ buyer_name: ' ', member_profile_id: 'p1' }, profiles), 'Profile Name');
  assert.equal(purchaserName({ user_id: 'u1' }, profiles), 'Profile Name');
  assert.equal(purchaserName({ buyer_email: 'guess.name@example.test' }, profiles), null);
});

test('roster keeps guest identity distinct from purchaser and does not leak QR codes', () => {
  const orders = [{ id: 'o1', buyer_name: 'Buyer One', buyer_email: 'buyer@example.test', status: 'paid', total_cents: 5000 }];
  const tickets = [
    { id: 't1', order_id: 'o1', order_item_id: 'i1', attendee_id: 'a1', ticket_code: 'secret', status: 'used', used_at: '2026-09-22T01:00:00Z' },
    { id: 't2', order_id: 'o1', order_item_id: 'i1', status: 'valid' },
    { id: 't3', order_id: 'o1', order_item_id: 'i1', status: 'refunded' },
  ];
  const roster = assembleRoster(orders, tickets,
    [{ id: 'a1', ticket_id: 't1', full_name: 'Guest One' }, { id: 'a3', ticket_id: 't3', full_name: 'Guest Three' }],
    [{ id: 'i1', product_name_snapshot: 'Admission', tier_name_snapshot: 'Early' }], []);
  assert.equal(roster[0].tickets.length, 3);
  const flat = rosterTickets(roster);
  assert.equal(flat[0].attendee_name, 'Guest One');
  assert.equal(flat[0].buyer_name, 'Buyer One');
  assert.equal(flat[0].product_name, 'Admission');
  assert.equal(flat[0].status, 'used');
  assert.equal(flat[1].attendee_name, null);
  assert.equal(flat[2].attendee_name, 'Guest Three');
  assert.ok(!JSON.stringify(roster).includes('secret'));
});

test('name/email search supports mixed case, extra whitespace, and multiple words', () => {
  const row = { buyer_name: 'Alex Example', buyer_email: 'buyer@example.test', attendee_name: 'Guest Name' };
  assert.equal(matchesRosterSearch(row, '  EXAMPLE Alex '), true);
  assert.equal(matchesRosterSearch(row, 'BUYER@'), true);
  assert.equal(matchesRosterSearch(row, 'Guest Name'), true);
  assert.equal(matchesRosterSearch(row, ''), true);
  assert.equal(matchesRosterSearch(row, 'missing'), false);
});

test('CSV quotes commas/newlines/quotes and neutralizes formula injection', () => {
  const csv = rosterCsv(['Name'], [['A, B'], ['"quoted"'], ['line\nbreak'], ['=SUM(1)'], ['  +cmd'], ['@formula']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"A, B"'));
  assert.ok(csv.includes('"""quoted"""'));
  assert.ok(csv.includes('"line\nbreak"'));
  assert.ok(csv.includes(`"'=SUM(1)"`));
  assert.ok(csv.includes(`"'  +cmd"`));
  assert.ok(csv.includes(`"'@formula"`));
});

test('all child rows are paged, including lists beyond Supabase single-query cap', async () => {
  const data = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const ranges = [];
  const result = await readRosterRows(() => ({
    range: async (start, end) => {
      ranges.push([start, end]);
      return { data: data.slice(start, end + 1), error: null };
    },
  }));
  assert.equal(result.length, 1203);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
});

test('query failures are not treated as an empty attendee list', async () => {
  await assert.rejects(() => readRosterRows(() => ({
    range: async () => ({ data: null, error: new Error('DB unavailable') }),
  })), /DB unavailable/);
});

test('endpoint gates before service-role reads, scopes by event, and does not return ticket codes', () => {
  const route = fs.readFileSync(new URL('../app/api/admin/events/[id]/attendees/route.js', import.meta.url), 'utf8');
  assert.ok(route.indexOf('await requireAdmin(request)') < route.indexOf('const db = createClient('));
  assert.match(route, /if \(gate\.unauthorized\).*status: 401/);
  assert.match(route, /isInternalTicketingEnabled/);
  assert.match(route, /private, no-store/);
  assert.match(route, /\.eq\('event_id', id\)/);
  assert.ok(!route.includes('ticket_code'));
});
