// lib/tickets/fetch-event-for-email.js
//
// Single helper that every send-ticket-confirmation caller now uses to grab
// exactly the event fields the upgraded email template needs:
//
//   * title, event_date, start_time \u2014 already required by the old template
//   * image_url \u2014 the flyer, rendered as the hero of the email
//
// Also builds the derived strings the template expects (`eventWhen`,
// `eventFlyerUrl`, `venueAddress`, `orderUrl`) so the callers stay small.
// If the events row is missing (a shouldn't-happen for a real order, but
// defensive), the derived fields safely become empty strings/null and the
// email still sends with graceful degradation.
//
// The venue address is a compile-time constant \u2014 Stardust is single-venue
// so there is no per-event address column in public.events.

import { resolveSiteUrl } from '@/lib/site-url';
import { STARDUST_VENUE_ADDRESS } from '@/lib/wallet/get-orders';

export async function fetchEventForEmail({ supabaseAdmin, eventId, request } = {}) {
  const empty = {
    event: null,
    eventTitle: 'Stardust Garage',
    eventWhen: null,
    eventFlyerUrl: null,
    venueAddress: STARDUST_VENUE_ADDRESS,
    orderUrlBase: buildOrderUrlBase({ request }),
  };
  if (!supabaseAdmin || !eventId) return empty;

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, title, event_date, start_time, image_url')
    .eq('id', eventId)
    .maybeSingle();

  if (!event) return empty;

  return {
    event,
    eventTitle: event.title || 'Stardust Garage',
    eventWhen: event.event_date
      ? `${event.event_date}${event.start_time ? ` at ${event.start_time}` : ''}`
      : null,
    eventFlyerUrl: event.image_url || null,
    venueAddress: STARDUST_VENUE_ADDRESS,
    orderUrlBase: buildOrderUrlBase({ request }),
  };
}

// The email CTA links to /account/tickets \u2014 the ticket hub, not a
// per-order page (there isn't one yet). Kept as a small helper so a future
// per-order URL can be built here without every caller having to learn about
// the change.
export function buildOrderUrlBase({ request }) {
  const base = resolveSiteUrl(request);
  return `${base.replace(/\/+$/, '')}/account/tickets`;
}
