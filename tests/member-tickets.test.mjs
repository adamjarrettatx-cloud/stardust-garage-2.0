import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTtBoolean,
  ttTimestampToIso,
  normalizeEmail,
  issuedTicketEmails,
  buildMemberTicketRows,
  chunk,
  loadMemberIdsByEmail,
  syncMemberTicketsForOrder,
} from '../lib/member-tickets.js';

// A realistic ORDER.UPDATED payload (subset of real fields), shaped like what
// the webhook receives as envelope.payload and what lands in
// ticket_order_attribution.raw_payload.
const ttOrder = (overrides = {}) => ({
  id: 'or_80206624',
  status: 'completed',
  buyer_details: { email: 'Buyer@Example.com', name: 'A Buyer' },
  event_summary: { event_id: 'ev_8679991', event_series_id: 'es_2304182', name: 'ANYTHING GOES' },
  issued_tickets: [
    {
      id: 'it_131511517',
      email: 'Buyer@Example.com',
      status: 'valid',
      barcode: 'CW8yYVg',
      event_id: 'ev_8679991',
      order_id: 'or_80206624',
      voided_at: null,
      checked_in: 'false',
      barcode_url: 'https://cdn.tickettailor.com/barcode.jpg',
      qr_code_url: 'https://cdn.tickettailor.com/qr.png',
      description: 'Tier 1 Tickets',
      ticket_type_id: 'tt_6557628',
    },
  ],
  ...overrides,
});

const LOCAL_EVENT_ID = '11111111-2222-3333-4444-555555555555';

test('TicketTailor string booleans become real booleans', () => {
  assert.equal(parseTtBoolean('true'), true);
  assert.equal(parseTtBoolean('TRUE'), true);
  assert.equal(parseTtBoolean('false'), false);
  assert.equal(parseTtBoolean(true), true);
  // NOT NULL column: anything unrecognized has to land on a value, and "not
  // checked in" is the safe one.
  assert.equal(parseTtBoolean(null), false);
  assert.equal(parseTtBoolean(undefined), false);
  assert.equal(parseTtBoolean(1), false);
});

test('TicketTailor timestamps are unix seconds, with an ISO fallback', () => {
  assert.equal(ttTimestampToIso(1769472000), '2026-01-27T00:00:00.000Z');
  assert.equal(ttTimestampToIso('1769472000'), '2026-01-27T00:00:00.000Z');
  assert.equal(ttTimestampToIso('2026-01-27T00:00:00Z'), '2026-01-27T00:00:00.000Z');
  assert.equal(ttTimestampToIso(null), null);
  assert.equal(ttTimestampToIso(''), null);
  assert.equal(ttTimestampToIso('not a date'), null);
});

test('emails normalize to lowercase or null', () => {
  assert.equal(normalizeEmail('  Buyer@Example.com '), 'buyer@example.com');
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail('   '), null);
  assert.equal(normalizeEmail(undefined), null);
});

test('a completed order maps to one fully populated wallet row', () => {
  const rows = buildMemberTicketRows(ttOrder(), {
    localEventId: LOCAL_EVENT_ID,
    memberIdByEmail: new Map([['buyer@example.com', 'member-1']]),
  });

  assert.deepEqual(rows, [{
    id: 'it_131511517',
    tt_order_id: 'or_80206624',
    tt_event_id: 'ev_8679991',
    local_event_id: LOCAL_EVENT_ID,
    member_id: 'member-1',
    buyer_email: 'buyer@example.com',
    ticket_type_id: 'tt_6557628',
    description: 'Tier 1 Tickets',
    status: 'valid',
    checked_in: false,
    barcode: 'CW8yYVg',
    barcode_url: 'https://cdn.tickettailor.com/barcode.jpg',
    qr_code_url: 'https://cdn.tickettailor.com/qr.png',
    voided_at: null,
    order_status: 'completed',
  }]);
});

test('pending orders with no issued tickets yield nothing rather than throwing', () => {
  assert.deepEqual(buildMemberTicketRows(ttOrder({ status: 'pending', issued_tickets: undefined })), []);
  assert.deepEqual(buildMemberTicketRows(ttOrder({ issued_tickets: [] })), []);
  assert.deepEqual(buildMemberTicketRows(ttOrder({ issued_tickets: null })), []);
  assert.deepEqual(buildMemberTicketRows(null), []);
  assert.deepEqual(buildMemberTicketRows(ttOrder({ id: undefined })), []);
});

test('a guest ticket keeps its own email; a ticket without one inherits the buyer', () => {
  const rows = buildMemberTicketRows(
    ttOrder({
      issued_tickets: [
        { id: 'it_1', email: 'Guest@Example.com' },
        { id: 'it_2' },
      ],
    }),
    { memberIdByEmail: new Map([['guest@example.com', 'member-guest']]) },
  );

  assert.equal(rows[0].buyer_email, 'guest@example.com');
  assert.equal(rows[0].member_id, 'member-guest');
  assert.equal(rows[1].buyer_email, 'buyer@example.com');
  // A miss is expected — RLS authorizes on buyer_email, not this column.
  assert.equal(rows[1].member_id, null);
});

test('unusable tickets are skipped instead of written with invented values', () => {
  const rows = buildMemberTicketRows(
    ttOrder({
      buyer_details: {},
      issued_tickets: [
        { id: 'it_1', email: 'guest@example.com' },
        { id: null, email: 'guest@example.com' },  // no primary key
        { id: 'it_3' },                            // no email, and no buyer to fall back to
        { id: 'it_1', email: 'guest@example.com' }, // duplicate id would abort the batch upsert
      ],
    }),
  );

  assert.deepEqual(rows.map((r) => r.id), ['it_1']);
});

test('void tickets carry their status and void timestamp', () => {
  const [row] = buildMemberTicketRows(
    ttOrder({
      status: 'CANCELED',
      issued_tickets: [{ id: 'it_9', email: 'b@x.com', status: 'VOID', checked_in: 'true', voided_at: 1769472000 }],
    }),
  );

  assert.equal(row.status, 'void');
  assert.equal(row.checked_in, true);
  assert.equal(row.voided_at, '2026-01-27T00:00:00.000Z');
  assert.equal(row.order_status, 'canceled');
});

test('an explicit orderStatus overrides the payload, so the backfill can trust the stored column', () => {
  const [row] = buildMemberTicketRows(ttOrder({ status: 'pending' }), { orderStatus: 'completed' });
  assert.equal(row.order_status, 'completed');
});

test('issuedTicketEmails dedupes across tickets and falls back to the buyer', () => {
  const emails = issuedTicketEmails(ttOrder({
    issued_tickets: [
      { id: 'it_1', email: 'Guest@Example.com' },
      { id: 'it_2', email: 'guest@example.com' },
      { id: 'it_3' },
    ],
  }));

  assert.deepEqual(emails.sort(), ['buyer@example.com', 'guest@example.com']);
  assert.deepEqual(issuedTicketEmails(ttOrder({ issued_tickets: [] })), []);
});

test('chunk splits without dropping or duplicating', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

// Minimal PostgREST-shaped stub: records the calls and replays canned results.
function stubSupabase({ profiles = [], upsertError = null } = {}) {
  const calls = { orFilters: [], upserts: [] };
  return {
    calls,
    from(table) {
      if (table === 'member_profiles') {
        return {
          select: () => ({
            or: (filter) => {
              calls.orFilters.push(filter);
              return Promise.resolve({ data: profiles, error: null });
            },
          }),
        };
      }
      return {
        upsert: (rows, options) => {
          calls.upserts.push({ rows, options });
          return Promise.resolve({ error: upsertError });
        },
      };
    },
  };
}

test('member lookup matches case-insensitively and skips addresses it cannot safely quote', async () => {
  const supabase = stubSupabase({ profiles: [{ id: 'member-1', email: 'Buyer@Example.com' }] });
  const byEmail = await loadMemberIdsByEmail(supabase, ['buyer@example.com', 'ev"il@example.com']);

  assert.equal(byEmail.get('buyer@example.com'), 'member-1');
  assert.deepEqual(supabase.calls.orFilters, ['email.ilike."buyer@example.com"']);
});

test('syncing an order upserts on the ticket id and reports how many rows were written', async () => {
  const supabase = stubSupabase({ profiles: [{ id: 'member-1', email: 'buyer@example.com' }] });
  const written = await syncMemberTicketsForOrder(supabase, ttOrder(), { localEventId: LOCAL_EVENT_ID });

  assert.equal(written, 1);
  assert.deepEqual(supabase.calls.upserts[0].options, { onConflict: 'id' });
  assert.equal(supabase.calls.upserts[0].rows[0].member_id, 'member-1');
});

test('syncing a ticketless order writes nothing and queries nothing', async () => {
  const supabase = stubSupabase();
  assert.equal(await syncMemberTicketsForOrder(supabase, ttOrder({ issued_tickets: [] })), 0);
  assert.deepEqual(supabase.calls.upserts, []);
  assert.deepEqual(supabase.calls.orFilters, []);
});

test('a failed upsert surfaces as an error the caller can log', async () => {
  const supabase = stubSupabase({ profiles: [], upsertError: { message: 'permission denied' } });
  await assert.rejects(
    () => syncMemberTicketsForOrder(supabase, ttOrder()),
    /member_tickets upsert failed: permission denied/,
  );
});
