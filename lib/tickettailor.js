/**
 * Ticket Tailor API client — fetches the public list of upcoming events
 * for the homepage tile.
 *
 * Auth: HTTP Basic with the API key as username (no password).
 *   See https://developers.tickettailor.com/
 *
 * Required env var:
 *   TICKET_TAILOR_API_KEY
 *
 * If the key is missing or the request fails (no network in local dev,
 * TT outage, etc.), this returns `null` so the caller can fall back to a
 * static list. The homepage decides what to do with that.
 *
 * Caching: relies on Next.js `fetch` ISR with a 5-minute revalidate
 * window. New shows in TT show up on the site within ~5 minutes without
 * a redeploy.
 */

const API_BASE = 'https://api.tickettailor.com/v1';
const REVALIDATE_SECONDS = 300; // 5 minutes
const PUBLIC_BOX_OFFICE_SLUG = 'stardustgarageatx';

/**
 * Fetches upcoming event summaries from Ticket Tailor and returns them
 * normalized to the shape the homepage tile expects.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit] Maximum number of events to return.
 * @returns {Promise<Array<{id:string,title:string,event_date:string,ticket_url:string|null}>|null>}
 */
export async function fetchUpcomingEvents({ limit = 3 } = {}) {
  const apiKey = process.env.TICKET_TAILOR_API_KEY;
  if (!apiKey) return null;

  const auth = Buffer.from(`${apiKey}:`).toString('base64');

  let response;
  try {
    response = await fetch(
      `${API_BASE}/event_summaries?limit=${Math.min(limit * 2, 25)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
        },
        next: { revalidate: REVALIDATE_SECONDS },
      }
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const items = Array.isArray(payload?.data) ? payload.data : [];
  const now = Date.now();

  return items
    .map(normalize)
    .filter((ev) => ev && (!ev._timestamp || ev._timestamp >= now))
    .sort((a, b) => (a._timestamp ?? 0) - (b._timestamp ?? 0))
    .slice(0, limit)
    .map(({ _timestamp, ...rest }) => rest);
}

/**
 * Normalize a TT event summary into the shape the tile expects.
 * TT field shapes vary slightly between event types; we defensively
 * pick the first available value for each piece of data.
 */
function normalize(item) {
  if (!item) return null;

  const id = item.id ?? item.event_id;
  const title = item.name ?? item.title;
  if (!id || !title) return null;

  // TT exposes a `start` object: { date: 'YYYY-MM-DD', iso, unix, ... }
  const startDate =
    item.start?.date ??
    item.start_date ??
    (item.start?.iso ? item.start.iso.slice(0, 10) : null);

  const timestamp =
    item.start?.unix != null
      ? Number(item.start.unix) * 1000
      : item.start?.iso
      ? Date.parse(item.start.iso)
      : startDate
      ? Date.parse(`${startDate}T00:00:00Z`)
      : null;

  // Public-facing event URL on the TT box office.
  const ticketUrl =
    item.url ??
    `https://www.tickettailor.com/events/${PUBLIC_BOX_OFFICE_SLUG}/${id}`;

  return {
    id: String(id),
    title,
    event_date: startDate,
    ticket_url: ticketUrl,
    _timestamp: timestamp,
  };
}
