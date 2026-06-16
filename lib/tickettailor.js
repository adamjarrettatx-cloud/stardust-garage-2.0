// TicketTailor API helper module.
// Auth is HTTP Basic with the API key as the username and an empty password.

const TT_BASE_URL = 'https://api.tickettailor.com/v1';

function authHeader() {
  const apiKey = process.env.TICKETTAILOR_API_KEY;
  if (!apiKey) {
    throw new Error('TICKETTAILOR_API_KEY is not configured');
  }
  return 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
}

export async function ttFetch(path, options = {}) {
  const res = await fetch(`${TT_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`TicketTailor API error (${res.status}): ${detail}`);
  }

  return body;
}

// Returns an array of ticket type IDs for the given event series.
export async function getEventSeriesTicketTypes(eventSeriesId) {
  const series = await ttFetch(`/event_series/${eventSeriesId}`);
  const ticketTypes = series?.default_ticket_types || [];
  return ticketTypes.map((t) => t.id).filter(Boolean);
}

// Returns a list of all event series as { id, name }.
export async function listEventSeries() {
  const result = await ttFetch('/event_series');
  const data = result?.data || [];
  return data.map((s) => ({ id: s.id, name: s.name }));
}

// Creates a single-use percentage discount code restricted to the given ticket
// types. Returns { id, code }.
export async function createDiscountCode({ code, name, ticketTypeIds, expiresUnix, discountPercent }) {
  // TicketTailor expects form-encoded bodies and repeats array keys.
  const params = new URLSearchParams();
  params.append('code', code);
  params.append('name', name);
  params.append('type', 'percentage');
  params.append('price_percent', String(discountPercent));
  params.append('max_redemptions', '1');
  if (expiresUnix) {
    params.append('expires', String(expiresUnix));
  }
  for (const id of ticketTypeIds || []) {
    params.append('ticket_types[]', id);
  }

  const result = await ttFetch('/discounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  return { id: result?.id, code: result?.code || code };
}

// Deletes a discount code by its TT discount ID. Used for cleanup.
export async function deleteDiscountCode(discountId) {
  return ttFetch(`/discounts/${discountId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Event creation / publish helpers (WRITE — used by the admin "create event"
// flow). These POST/PUT to TicketTailor and so are only ever called from
// admin-gated server routes after requireAdminMfa(). Every series is created
// as a draft; publishing is a separate, explicit step.
// ---------------------------------------------------------------------------

// Creates a draft event series. `body` is a URLSearchParams built by
// lib/tt-event-create.buildEventSeriesBody (status=draft). Returns the created
// series object; callers read its `id` (e.g. "es_1234567").
export async function createEventSeries(body) {
  return ttFetch('/event_series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: typeof body === 'string' ? body : body.toString(),
  });
}

// Creates a single ticket type on an event series. `body` is a URLSearchParams
// built by lib/tt-event-create.buildTicketTypeBody. Returns the created ticket
// type object.
export async function createTicketType(eventSeriesId, body) {
  return ttFetch(`/event_series/${eventSeriesId}/ticket_types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: typeof body === 'string' ? body : body.toString(),
  });
}

// Sets the status of an event series ('published', 'draft', or 'closed').
// Used by the publish action to take a draft series live. TicketTailor exposes
// status changes on the event series resource; we send it as a form-encoded
// update. Returns the updated series object.
export async function setEventSeriesStatus(eventSeriesId, status) {
  const params = new URLSearchParams();
  params.append('status', status);
  return ttFetch(`/event_series/${eventSeriesId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

// ---------------------------------------------------------------------------
// Analytics read helpers (Phase 1 scaffolding — READ ONLY, no live writes)
// ---------------------------------------------------------------------------
//
// These wrap TicketTailor's reporting endpoints so the financial
// analytics/projections layer can pull real numbers. They only ever GET.
// They are safe to call with a configured TICKETTAILOR_API_KEY but are not yet
// wired into any route — the projection logic that consumes them lives in
// lib/event-analytics.js.

// Cursor-paginate any TicketTailor list endpoint. TT returns
// { data: [...], links: { next: '<url with starting_after>' } }.
// Returns the fully-accumulated array. `params` is an object of query params.
export async function ttList(path, params = {}, { maxPages = 20 } = {}) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: '100', ...params });
    if (startingAfter) qs.set('starting_after', startingAfter);
    const result = await ttFetch(`${path}?${qs.toString()}`);
    const data = result?.data || [];
    out.push(...data);
    // TT signals more pages via links.next; fall back to id cursor.
    const next = result?.links?.next;
    if (!next || data.length === 0) break;
    startingAfter = data[data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return out;
}

// All issued tickets, optionally filtered to an event series. Each row carries
// price/status fields used for gross-revenue + attendance analytics.
export async function listIssuedTickets({ eventSeriesId } = {}) {
  const params = {};
  if (eventSeriesId) params.event_series_id = eventSeriesId;
  return ttList('/issued_tickets', params);
}

// All orders, optionally filtered to an event series. Orders carry the
// authoritative paid totals + fees for revenue reconciliation.
export async function listOrders({ eventSeriesId } = {}) {
  const params = {};
  if (eventSeriesId) params.event_series_id = eventSeriesId;
  return ttList('/orders', params);
}

// A single event series with its ticket types + capacity, for projections.
export async function getEventSeries(eventSeriesId) {
  return ttFetch(`/event_series/${eventSeriesId}`);
}
