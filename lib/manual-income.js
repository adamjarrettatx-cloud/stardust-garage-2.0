// Pure data + validation helpers for OWNER-entered manual income on the
// Financial Calendar.
//
// Manual income covers money with no local website event and no TicketTailor
// record (e.g. a venue rental paid directly). Rows live in
// public.manual_income_entries and are gated to the owner alone (see the
// 20260723_manual_income_entries.sql migration + requireOwner()).
//
// Everything here is a pure function over plain data — no I/O, no secrets — so
// it is fully unit-testable and safe to import on the server and in the route
// handler. MONEY is integer minor units (cents), matching the rest of the
// financial-calendar pipeline; conversion to USD happens only at the render
// edge via centsToUsd().
//
// SpotOn note: this module is deliberately manual-only. A future SpotOn CSV
// importer is a SEPARATE income source that contributes its own
// `incomeSources` object into lib/financial-calendar.js; it must NOT reuse this
// table or these helpers.

import { ENTRY_STATE } from './financial-calendar.js';

// Canonical manual-income categories. Kept here (not as a Postgres enum) so new
// categories can be added without a schema migration — the DB only guards
// length. `venue_rental` is the motivating case; `other` is the escape hatch.
export const MANUAL_CATEGORIES = [
  { value: 'venue_rental', label: 'Venue rental' },
  { value: 'sponsorship',  label: 'Sponsorship' },
  { value: 'merch',        label: 'Merchandise' },
  { value: 'food_bev',     label: 'Food & beverage' },
  { value: 'service',      label: 'Service / fee' },
  { value: 'donation',     label: 'Donation' },
  { value: 'other',        label: 'Other' },
];

const CATEGORY_VALUES = new Set(MANUAL_CATEGORIES.map((c) => c.value));
export const DEFAULT_MANUAL_CATEGORY = 'venue_rental';

// Synthetic calendar-entry id so a manual entry never collides with a local
// event UUID or a `tt:`-prefixed discovered entry, and the UI can detect it.
export function manualEntryId(id) {
  return `manual:${id}`;
}

// CSRF defense-in-depth: for a state-changing request, confirm the browser's
// Origin header matches the server's Host. Auth is already enforced by the
// owner gate + SameSite session cookies; this rejects a cross-site form/script
// POST that rides those cookies. Returns true when same-origin (or when no
// Origin header is present, e.g. a same-origin request that omitted it or a
// server-to-server call — those are not cross-site CSRF vectors).
export function isSameOrigin(originHeader, hostHeader) {
  if (!originHeader) return true;
  if (!hostHeader) return false;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}

// Parse a user-supplied money value into a non-negative integer number of
// cents WITHOUT floating-point rounding error. Accepts:
//   - numbers (2800, 12.5)
//   - strings with optional $, thousands commas, and up to 2 decimals
//     ("$2,800.00", "2800", "12.5")
// Returns { cents } on success or { error } on invalid/negative/too-precise
// input. Never throws.
export function parseAmountToCents(input) {
  if (input == null || input === '') return { error: 'Amount is required.' };

  let raw = String(input).trim();
  raw = raw.replace(/[$\s]/g, '').replace(/,/g, '');
  if (raw === '') return { error: 'Amount is required.' };

  // Optional leading sign — reject negatives explicitly (income is >= 0).
  if (raw.startsWith('-')) return { error: 'Amount must be zero or greater.' };
  if (raw.startsWith('+')) raw = raw.slice(1);

  // Digits with an optional 1–2 digit decimal part. No exponent, no extra dots.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return { error: 'Enter a valid dollar amount (e.g. 2800 or 2,800.00).' };

  const dollars = Number(match[1]);
  const centsPart = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  const cents = dollars * 100 + centsPart;

  if (!Number.isSafeInteger(cents)) return { error: 'Amount is too large.' };
  return { cents };
}

// Normalize an arbitrary date-ish input to a YYYY-MM-DD string, or null if it
// does not look like a valid calendar date. Accepts a bare date or a longer
// timestamp string and keeps only the date portion.
export function normalizeEntryDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible days (e.g. 2026-02-30) via a round-trip check.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function cleanOptionalText(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  return s.slice(0, max);
}

// Validate + normalize a manual-income payload coming from the client. Returns
// { valid: true, value } with a clean, typed object, or
// { valid: false, errors } mapping field → message. Pure; safe to reuse in the
// route handler and in tests.
export function validateManualEntry(input = {}) {
  const errors = {};

  const entryDate = normalizeEntryDate(input.entryDate ?? input.date);
  if (!entryDate) errors.entryDate = 'A valid date is required.';

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.title = 'A title is required.';
  else if (title.length > 200) errors.title = 'Title must be 200 characters or fewer.';

  const amount = parseAmountToCents(input.amount ?? input.amountCents);
  if (amount.error) errors.amount = amount.error;
  else if (amount.cents <= 0) errors.amount = 'Amount must be greater than zero.';

  let category = typeof input.category === 'string' ? input.category.trim() : '';
  if (!category) category = DEFAULT_MANUAL_CATEGORY;
  if (!CATEGORY_VALUES.has(category)) errors.category = 'Choose a valid category.';

  const notes = cleanOptionalText(input.notes, 2000);
  const customerName = cleanOptionalText(input.customerName ?? input.customer_name, 200);
  const eventName = cleanOptionalText(input.eventName ?? input.event_name, 200);

  let localEventId = input.localEventId ?? input.local_event_id ?? null;
  if (localEventId != null) {
    localEventId = String(localEventId).trim() || null;
  }

  if (Object.keys(errors).length) return { valid: false, errors };

  return {
    valid: true,
    value: {
      entryDate,
      title,
      amountCents: amount.cents,
      category,
      notes,
      customerName,
      eventName,
      localEventId,
    },
  };
}

// Confirm a client-supplied local_event_id actually references an existing
// local event. The route fetches the candidate row from public.events (server
// side, never trusting the client) and passes it here. Returns
// { ok: true, localEventId } (localEventId is null when none was supplied) or
// { ok: false, error } when a non-empty id does not resolve to a real event.
// Pure so the existence rule is unit-testable independently of the DB call.
export function checkEventLink(localEventId, eventRow) {
  if (localEventId == null || String(localEventId).trim() === '') {
    return { ok: true, localEventId: null };
  }
  const id = String(localEventId).trim();
  if (!eventRow || eventRow.id == null || String(eventRow.id) !== id) {
    return { ok: false, error: 'The linked event could not be found.' };
  }
  return { ok: true, localEventId: id };
}

// Build the DB insert payload for a validated entry. `createdBy` is the
// authenticated owner's user id (server-supplied — never trusted from client).
export function buildManualInsert(value, { createdBy } = {}) {
  return {
    entry_date: value.entryDate,
    title: value.title,
    customer_name: value.customerName,
    event_name: value.eventName,
    category: value.category,
    amount_cents: value.amountCents,
    notes: value.notes,
    source: 'manual',
    local_event_id: value.localEventId,
    created_by: createdBy ?? null,
  };
}

// Build the DB update payload for a validated entry. Omits created_by/source so
// an edit never reassigns provenance or authorship.
export function buildManualUpdate(value) {
  return {
    entry_date: value.entryDate,
    title: value.title,
    customer_name: value.customerName,
    event_name: value.eventName,
    category: value.category,
    amount_cents: value.amountCents,
    notes: value.notes,
    local_event_id: value.localEventId,
  };
}

// Build one calendar income entry from a manual_income_entries row. Shaped to
// merge seamlessly with TicketTailor/local entries in lib/financial-calendar.js
// (same money field names, same ENTRY_STATE), but flagged `isManual` so the UI
// labels the source and shows edit/delete controls. Manual income is always
// real, countable money, so state is OK and hasIncome is true. It carries no
// tickets/orders/fees.
export function buildManualIncomeEntry(row, today = new Date()) {
  const eventDate = row.entry_date ? String(row.entry_date).slice(0, 10) : null;
  const grossCents = Number(row.amount_cents) || 0;
  const todayStr = (today.toISOString ? today.toISOString() : String(today)).slice(0, 10);
  const isFuture = Boolean(eventDate && todayStr && eventDate > todayStr);

  return {
    id: manualEntryId(row.id),
    manualId: row.id,
    title: row.title || 'Manual income',
    eventDate,
    category: row.category || DEFAULT_MANUAL_CATEGORY,
    eventStatus: null,
    ttLinked: false,
    hasLocalEvent: false,
    isManual: true,
    source: 'manual',
    state: ENTRY_STATE.OK,
    isFuture,
    grossCents,
    ticketsSold: 0,
    ordersCount: 0,
    feesCents: null,
    netCents: null,
    fetchedAt: null,
    hasIncome: grossCents > 0,
    // Manual-specific detail fields for the day panel.
    customerName: row.customer_name || null,
    eventName: row.event_name || null,
    notes: row.notes || null,
    localEventId: row.local_event_id || null,
    updatedAt: row.updated_at || null,
    incomeSources: [{ source: 'manual', grossCents, ticketsSold: 0, ordersCount: 0 }],
  };
}
