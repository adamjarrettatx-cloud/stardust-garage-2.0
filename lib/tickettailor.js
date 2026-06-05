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
