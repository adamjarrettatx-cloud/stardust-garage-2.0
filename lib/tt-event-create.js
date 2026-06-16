// Pure helpers for creating a website event together with a TicketTailor draft
// event series. Split out from the route handler so the validation and the
// form-body construction can be unit-tested without importing next/server,
// Supabase, or any secret-bearing module.
//
// All TicketTailor write endpoints take application/x-www-form-urlencoded
// bodies and repeat array keys (see createDiscountCode in lib/tickettailor.js).
// Money is sent in integer minor units (cents), matching TicketTailor and
// lib/event-analytics.js. These builders never make network calls.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD (HTML date input)

// Normalize an arbitrary string to a trimmed value or '' when empty/non-string.
function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Event times in this app are free text (e.g. "10:00 PM", "7pm", "noon"), so a
// strict numeric "end after start" rule can't be applied to every value. This
// helper parses only the simple clock formats we can confidently order:
//   "10:00 PM", "10 PM", "22:00", "9:30am"
// Returns minutes-since-midnight (0..1439) or null when the value isn't one of
// those simple shapes. Callers treat null as "can't compare, don't block".
function parseSimpleClockMinutes(value) {
  const s = str(value).toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === 'pm') hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

// Decide whether an end time is a valid end for a start time. Stardust Garage is
// a late-night venue, so events routinely START in the evening and END after
// midnight ("10:00 PM" → "12:00 AM", "11:00 PM" → "1:00 AM"). We therefore do
// NOT require end > start on a same-day clock: when the parsed end is at or
// before the start we treat it as an overnight (next-day) end and accept it.
//
// The only thing we reject is an end that EQUALS the start (a zero-length
// event), which is invalid regardless of which day it falls on. As before, we
// fail open for free-text times we can't parse ("doors at dusk", "late",
// "midnight"), so legitimate non-clock entries are never blocked.
export function endTimeIsAfterStart(startTime, endTime) {
  const start = parseSimpleClockMinutes(startTime);
  const end = parseSimpleClockMinutes(endTime);
  if (start == null || end == null) return true;
  // end > start  → same-day, fine.
  // end < start  → crosses midnight, fine (overnight event).
  // end === start → zero-length, reject.
  return end !== start;
}

// True only when both times parse as simple clock values AND the end is strictly
// before the start — i.e. a confidently-detected overnight (crosses-midnight)
// range. Returns false when either side is unparseable free text (we make no
// risky inference) or when the end is later the same day. Used to decide whether
// the TicketTailor end_date should roll to the next calendar day.
function isParseableOvernight(startTime, endTime) {
  const start = parseSimpleClockMinutes(startTime);
  const end = parseSimpleClockMinutes(endTime);
  if (start == null || end == null) return false;
  return end < start;
}

// Convert a free-text clock value to TicketTailor's required HH:MM:SS 24-hour
// format for the occurrence start_time/end_time fields. Reuses the same simple
// parser the validation uses, so "10:00 PM" → "22:00:00", "7pm" → "19:00:00",
// "22:00" → "22:00:00". Returns null for anything we can't confidently parse
// ("doors at dusk", "late", "midnight") — the caller then omits the time field
// rather than sending TicketTailor a value it would reject. This is why the
// occurrence date is always sent (required) while the time is best-effort.
export function toTtClockTime(value) {
  const minutes = parseSimpleClockMinutes(value);
  if (minutes == null) return null;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

// Add one calendar day to a YYYY-MM-DD date string, returning YYYY-MM-DD. Uses
// UTC arithmetic so it never shifts due to local timezone/DST. Returns the input
// unchanged if it isn't a well-formed date (caller only passes validated dates,
// but this keeps the helper safe in isolation).
export function addOneDay(dateStr) {
  if (!DATE_RE.test(str(dateStr))) return dateStr;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Convert a price expressed in major units (dollars, possibly a string like
// "12.50") into integer cents. Returns null for blank input and NaN-producing
// junk so the caller can decide whether that's an error. Free tickets are 0.
export function dollarsToCents(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num < 0) return NaN;
  // Round to avoid 12.34 * 100 === 1233.9999999999998 style drift.
  return Math.round(num * 100);
}

// Validate a single ticket-type form row. Returns { ok, value } with a
// normalized { name, priceCents, quantity, description } or { ok:false, error }.
export function validateTicketType(raw, index = 0) {
  const label = `Ticket type ${index + 1}`;
  const name = str(raw?.name);
  if (!name) return { ok: false, error: `${label}: name is required` };
  if (name.length > 255) return { ok: false, error: `${label}: name is too long` };

  const priceCents = dollarsToCents(raw?.price);
  if (priceCents === null) {
    return { ok: false, error: `${label}: price is required (use 0 for free)` };
  }
  if (Number.isNaN(priceCents)) {
    return { ok: false, error: `${label}: price must be a non-negative number` };
  }

  // Quantity is optional. Blank → unlimited (omit from the TT payload). When
  // present it must be a positive integer.
  let quantity = null;
  const rawQty = raw?.quantity;
  if (rawQty !== '' && rawQty !== null && rawQty !== undefined) {
    const q = typeof rawQty === 'number' ? rawQty : Number(String(rawQty).trim());
    if (!Number.isInteger(q) || q <= 0) {
      return { ok: false, error: `${label}: capacity must be a whole number greater than 0` };
    }
    quantity = q;
  }

  const description = str(raw?.description) || null;
  return { ok: true, value: { name, priceCents, quantity, description } };
}

// Validate the whole "create event with TicketTailor" form payload. Returns
// { ok, value } where value is a normalized object ready for both the local
// insert and the TicketTailor payload builders, or { ok:false, error }.
export function validateCreatePayload(body) {
  const title = str(body?.title);
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > 255) return { ok: false, error: 'Title is too long' };

  const slug = str(body?.slug);
  if (!slug) return { ok: false, error: 'URL slug is required' };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: 'URL slug must be lowercase letters, numbers and hyphens' };
  }

  const eventDate = str(body?.event_date);
  if (!DATE_RE.test(eventDate)) {
    return { ok: false, error: 'A valid event date (YYYY-MM-DD) is required' };
  }

  // Ticketed events must carry both a start and an end time so the TicketTailor
  // event series has a full window and the public page can show "doors – close".
  const eventTime = str(body?.event_time) || null;
  if (!eventTime) {
    return { ok: false, error: 'Start time is required' };
  }

  const eventEndTime = str(body?.event_end_time) || null;
  if (!eventEndTime) {
    return { ok: false, error: 'End time is required' };
  }
  if (!endTimeIsAfterStart(eventTime, eventEndTime)) {
    return { ok: false, error: 'End time cannot be the same as the start time' };
  }

  const description = str(body?.description) || null;
  const imageUrl = str(body?.image_url) || null;
  const category = str(body?.category) || 'other';

  // Member discount percent is optional; when present must be 1..100.
  let memberDiscountPercent = null;
  const rawPct = body?.member_discount_percent;
  if (rawPct !== '' && rawPct !== null && rawPct !== undefined) {
    const pct = typeof rawPct === 'number' ? rawPct : Number(String(rawPct).trim());
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return { ok: false, error: 'Member discount percent must be a whole number from 1 to 100' };
    }
    memberDiscountPercent = pct;
  }

  // At least one ticket type is required for a ticketed event series.
  const rawTickets = Array.isArray(body?.ticket_types) ? body.ticket_types : [];
  if (rawTickets.length === 0) {
    return { ok: false, error: 'Add at least one ticket type' };
  }
  if (rawTickets.length > 50) {
    return { ok: false, error: 'Too many ticket types (max 50)' };
  }
  const ticketTypes = [];
  for (let i = 0; i < rawTickets.length; i++) {
    const res = validateTicketType(rawTickets[i], i);
    if (!res.ok) return res;
    ticketTypes.push(res.value);
  }

  return {
    ok: true,
    value: {
      title,
      slug,
      eventDate,
      eventTime,
      eventEndTime,
      description,
      imageUrl,
      category,
      memberDiscountPercent,
      ticketTypes,
    },
  };
}

// Build the form-encoded body for POST /v1/event_series. The event_series
// resource holds ONLY series-level metadata (name, description, currency, …) —
// it does NOT accept any date/time fields. The actual event date/time lives on a
// separate occurrence created via POST /v1/event_series/:id/events (see
// buildOccurrenceBody). Status is also NOT a field here; it is set through the
// dedicated /status endpoint. Sending date/time/status to this endpoint is the
// bug that left TicketTailor with no date — they were silently ignored.
//
// `currency` is sent lowercase to match the TicketTailor enum (gbp/usd/eur/…).
//
// Returns a URLSearchParams instance (the route stringifies it).
export function buildEventSeriesBody({ title, description, currency = 'USD' }) {
  const params = new URLSearchParams();
  params.append('name', title);
  params.append('currency', String(currency).toLowerCase());
  if (description) params.append('description', description);
  return params;
}

// Build the form-encoded body for POST /v1/event_series/:id/events — the
// occurrence that actually carries the event's date and time. TicketTailor wants
// FLAT snake_case fields: start_date / end_date as YYYY-MM-DD (required) and
// start_time / end_time as 24-hour HH:MM:SS (optional). The website stores times
// as free text, so we convert with toTtClockTime and omit a time we can't parse
// rather than sending an invalid value.
//
// The end DATE mirrors the start date for a same-day event, but rolls forward one
// calendar day when the times confidently describe an overnight (crosses
// midnight) range — e.g. "10:00 PM" → "12:00 AM" on 2026-07-04 ends on
// 2026-07-05. Without this, the end would sit before the start, producing a
// negative-duration occurrence for exactly the late-night events we support. We
// only advance the date when BOTH times parse as simple clocks; for
// free-text/unparseable ends we keep the same-day mirror and make no risky date
// inference.
//
// Returns a URLSearchParams instance (the route stringifies it).
export function buildOccurrenceBody({ eventDate, eventTime, eventEndTime }) {
  const params = new URLSearchParams();
  params.append('start_date', eventDate);

  const startClock = toTtClockTime(eventTime);
  if (startClock) params.append('start_time', startClock);

  const endDate = isParseableOvernight(eventTime, eventEndTime)
    ? addOneDay(eventDate)
    : eventDate;
  params.append('end_date', endDate);

  const endClock = toTtClockTime(eventEndTime);
  if (endClock) params.append('end_time', endClock);

  return params;
}

// Build the form-encoded body for POST /v1/event_series/:id/ticket_types for a
// single ticket type. Price is sent in minor units (cents). Quantity is only
// included when the admin set a capacity (blank = unlimited at TT).
export function buildTicketTypeBody({ name, priceCents, quantity, description }) {
  const params = new URLSearchParams();
  params.append('name', name);
  params.append('price', String(priceCents));
  if (quantity != null) params.append('quantity', String(quantity));
  if (description) params.append('description', description);
  return params;
}

// Decide whether the local website event may be flipped from draft to published
// after the TicketTailor side has been attempted. This encodes the two launch-
// safety invariants of the create-and-publish flow as one pure, testable rule:
//
//   * When TicketTailor is configured, the event may only go public once the
//     series is published AND a real ticket_url was resolved. A published series
//     with no URL would render on the site as a "PRIVATE EVENT" with no buy link,
//     so we keep it a hidden draft instead.
//   * When TicketTailor is NOT configured there is deliberately no ticketing, so
//     the event publishes directly (a private/no-ticket event is valid there).
//
// Returns { publish: boolean, reason: string }. `reason` is a stable machine
// token ('ok' | 'no_ticket_url' | 'not_published') the caller can branch on for
// messaging; it never decides to publish a ticketed event without a usable URL.
export function shouldPublishLocalEvent({ ttConfigured, ttPublished, ticketUrl }) {
  if (!ttConfigured) return { publish: true, reason: 'ok' };
  if (!ttPublished) return { publish: false, reason: 'not_published' };
  const url = str(ticketUrl);
  if (!url) return { publish: false, reason: 'no_ticket_url' };
  return { publish: true, reason: 'ok' };
}

// Extract the public box-office / checkout URL from a TicketTailor event series
// object (the response from createEventSeries / getEventSeries). The event
// series object exposes the public URL on a `url` field; we accept a couple of
// documented aliases defensively. We DO NOT derive or guess a URL from the
// series id — if the API doesn't return one, we return null so the caller can
// record that honestly rather than publishing a fabricated link.
//
// Only http(s) absolute URLs are accepted; anything else returns null.
export function extractSeriesPublicUrl(series) {
  if (!series || typeof series !== 'object') return null;
  const candidates = [series.url, series.checkout_url, series.public_url];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
    }
  }
  return null;
}
