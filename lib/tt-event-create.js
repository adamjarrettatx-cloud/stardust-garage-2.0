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

  const eventTime = str(body?.event_time) || null;
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
      description,
      imageUrl,
      category,
      memberDiscountPercent,
      ticketTypes,
    },
  };
}

// Build the form-encoded body for POST /v1/event_series. Always creates the
// series as a DRAFT (status=draft) so nothing goes live until an explicit
// publish. `startDate`/`endDate` are sent as TicketTailor's nested
// start_date[date] / start_date[time] fields when a time is provided.
//
// Returns a URLSearchParams instance (the route stringifies it).
export function buildEventSeriesBody({ title, eventDate, eventTime, description, currency = 'USD' }) {
  const params = new URLSearchParams();
  params.append('name', title);
  params.append('status', 'draft');
  params.append('currency', currency);
  if (description) params.append('description', description);

  params.append('start_date[date]', eventDate);
  if (eventTime) params.append('start_date[time]', eventTime);

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
