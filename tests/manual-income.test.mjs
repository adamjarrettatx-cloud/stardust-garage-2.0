import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_CATEGORIES,
  DEFAULT_MANUAL_CATEGORY,
  manualEntryId,
  isSameOrigin,
  parseAmountToCents,
  normalizeEntryDate,
  validateManualEntry,
  buildManualInsert,
  buildManualUpdate,
  buildManualIncomeEntry,
} from '../lib/manual-income.js';
import {
  ENTRY_STATE,
  buildFinancialCalendar,
  entriesInMonth,
  summarizeIncome,
} from '../lib/financial-calendar.js';

const TODAY = new Date('2026-06-15T12:00:00Z');

// --- Money parsing ----------------------------------------------------------

test('parseAmountToCents handles commas, $, and decimals without float error', () => {
  assert.deepEqual(parseAmountToCents('2,800.00'), { cents: 280000 });
  assert.deepEqual(parseAmountToCents('$2,800'), { cents: 280000 });
  assert.deepEqual(parseAmountToCents('2800'), { cents: 280000 });
  assert.deepEqual(parseAmountToCents('12.5'), { cents: 1250 });
  assert.deepEqual(parseAmountToCents('0.09'), { cents: 9 });
  assert.deepEqual(parseAmountToCents(2800), { cents: 280000 });
});

test('parseAmountToCents rejects invalid / negative / over-precise input', () => {
  assert.ok(parseAmountToCents('abc').error);
  assert.ok(parseAmountToCents('').error);
  assert.ok(parseAmountToCents(null).error);
  assert.ok(parseAmountToCents('-5').error);
  assert.ok(parseAmountToCents('1.234').error);   // 3 decimals
  assert.ok(parseAmountToCents('1.2.3').error);
});

test('normalizeEntryDate accepts date + timestamp, rejects garbage and impossible days', () => {
  assert.equal(normalizeEntryDate('2026-07-18'), '2026-07-18');
  assert.equal(normalizeEntryDate('2026-07-18T21:00:00-06:00'), '2026-07-18');
  assert.equal(normalizeEntryDate('2026-02-30'), null); // impossible
  assert.equal(normalizeEntryDate('not-a-date'), null);
  assert.equal(normalizeEntryDate(''), null);
});

// --- Validation -------------------------------------------------------------

test('validateManualEntry normalizes a complete valid payload (SolarPunk example)', () => {
  const res = validateManualEntry({
    date: '2026-07-18',
    title: '  SolarPunk venue rental ',
    amount: '2,800.00',
    category: 'venue_rental',
    notes: '  paid by check ',
    customerName: 'SolarPunk',
  });
  assert.equal(res.valid, true);
  assert.deepEqual(res.value, {
    entryDate: '2026-07-18',
    title: 'SolarPunk venue rental',
    amountCents: 280000,
    category: 'venue_rental',
    notes: 'paid by check',
    customerName: 'SolarPunk',
    eventName: null,
    localEventId: null,
  });
});

test('validateManualEntry defaults category and reports per-field errors', () => {
  const ok = validateManualEntry({ date: '2026-07-18', title: 'X', amount: '10' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.category, DEFAULT_MANUAL_CATEGORY);

  const bad = validateManualEntry({ date: 'nope', title: '   ', amount: '-3', category: 'bogus' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.entryDate);
  assert.ok(bad.errors.title);
  assert.ok(bad.errors.amount);
  assert.ok(bad.errors.category);
});

test('validateManualEntry rejects zero amount (must be > 0)', () => {
  const res = validateManualEntry({ date: '2026-07-18', title: 'X', amount: '0' });
  assert.equal(res.valid, false);
  assert.ok(res.errors.amount);
});

// --- Insert/update payloads (create/update handlers) ------------------------

test('buildManualInsert sets provenance + created_by from the server, not the client', () => {
  const { value } = validateManualEntry({ date: '2026-07-18', title: 'Rental', amount: '2800', category: 'venue_rental' });
  const row = buildManualInsert(value, { createdBy: 'owner-uuid' });
  assert.equal(row.source, 'manual');
  assert.equal(row.created_by, 'owner-uuid');
  assert.equal(row.amount_cents, 280000);
  assert.equal(row.entry_date, '2026-07-18');
});

test('buildManualUpdate omits source and created_by so an edit cannot reassign them', () => {
  const { value } = validateManualEntry({ date: '2026-07-18', title: 'Rental', amount: '2900' });
  const row = buildManualUpdate(value);
  assert.equal('source' in row, false);
  assert.equal('created_by' in row, false);
  assert.equal(row.amount_cents, 290000);
});

// --- Calendar entry ---------------------------------------------------------

const solarpunkRow = {
  id: 'm-1', entry_date: '2026-07-18', title: 'SolarPunk venue rental',
  customer_name: 'SolarPunk', event_name: null, category: 'venue_rental',
  amount_cents: 280000, notes: 'paid by check', source: 'manual',
  local_event_id: null, updated_at: '2026-07-18T10:00:00Z',
};

test('buildManualIncomeEntry produces an OK, local-page-less, manual-flagged entry', () => {
  const e = buildManualIncomeEntry(solarpunkRow, TODAY);
  assert.equal(e.id, manualEntryId('m-1'));
  assert.equal(e.id, 'manual:m-1');
  assert.equal(e.isManual, true);
  assert.equal(e.hasLocalEvent, false);
  assert.equal(e.state, ENTRY_STATE.OK);
  assert.equal(e.hasIncome, true);
  assert.equal(e.grossCents, 280000);
  assert.equal(e.ticketsSold, 0);
  assert.equal(e.ordersCount, 0);
  assert.equal(e.category, 'venue_rental');
  assert.equal(e.notes, 'paid by check');
  assert.equal(e.eventDate, '2026-07-18');
});

// --- Aggregation & mixed totals ---------------------------------------------

test('buildFinancialCalendar merges manual entries into the right month by date', () => {
  const manual = [solarpunkRow];
  const entries = buildFinancialCalendar({ events: [], metrics: [], manual, today: TODAY });
  const july = entriesInMonth(entries, 2026, 6); // July = month index 6
  assert.equal(july.length, 1);
  assert.equal(july[0].id, 'manual:m-1');
  assert.equal(july[0].isManual, true);
});

test('mixed TicketTailor + manual totals add up with no double-counting', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-07-10', tt_event_series_id: 'ev_x' },
  ];
  const metrics = [
    { event_id: 'e-ok', tickets_sold: 20, orders_count: 15, gross_cents: 100000, fees_cents: 5000, net_cents: 95000, status: 'ok', source: 'tickettailor', fetched_at: '2026-07-09T10:00:00Z' },
  ];
  const manual = [solarpunkRow]; // 2026-07-18, $2,800
  const entries = buildFinancialCalendar({ events, metrics, manual, today: TODAY });
  const july = entriesInMonth(entries, 2026, 6);
  const s = summarizeIncome(july);
  assert.equal(s.eventCount, 2);
  assert.equal(s.revenueEvents, 2);
  // 100000 (TT gross) + 280000 (manual) = 380000; counted once each.
  assert.equal(s.grossCents, 380000);
  assert.equal(s.ticketsSold, 20);   // manual contributes 0 tickets
  assert.equal(s.ordersCount, 15);
});

test('manual entry ids never collide with local or discovered ids in one calendar', () => {
  const events = [{ id: 'uuid-local', title: 'Local', event_date: '2026-07-01', tt_event_series_id: null }];
  const discovered = [{ tt_event_series_id: 'es_z', title: 'TT only', event_date: '2026-07-02', gross_cents: 500, status: 'ok', local_event_id: null }];
  const manual = [solarpunkRow];
  const entries = buildFinancialCalendar({ events, metrics: [], discovered, manual, today: TODAY });
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length); // all unique
  assert.ok(ids.includes('uuid-local'));
  assert.ok(ids.includes('tt:es_z'));
  assert.ok(ids.includes('manual:m-1'));
});

// --- CSRF same-origin guard (authorization/CSRF surface) --------------------

test('isSameOrigin allows same host, missing origin; rejects cross-origin', () => {
  assert.equal(isSameOrigin('https://app.example.com', 'app.example.com'), true);
  assert.equal(isSameOrigin(null, 'app.example.com'), true);            // no Origin header
  assert.equal(isSameOrigin('https://evil.example.com', 'app.example.com'), false);
  assert.equal(isSameOrigin('not-a-url', 'app.example.com'), false);
  assert.equal(isSameOrigin('https://app.example.com', ''), false);     // no Host to compare
});

// --- Category convention ----------------------------------------------------

test('MANUAL_CATEGORIES includes venue_rental and an extensible other', () => {
  const values = MANUAL_CATEGORIES.map((c) => c.value);
  assert.ok(values.includes('venue_rental'));
  assert.ok(values.includes('other'));
});
