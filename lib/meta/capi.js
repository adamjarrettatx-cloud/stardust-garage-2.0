// Server-only Meta Conversions API sender.
//
// Purchase and Subscribe are sent ONLY from the verified Stripe webhook, after
// fulfillment, so Meta never counts a purchase that did not actually happen.
// Every call is best-effort: a Meta outage or bad token is logged and never
// affects tickets, memberships, or the webhook response.

import { createHash } from 'node:crypto';
import { isMetaServerConfigured } from './attribution.js';

const GRAPH_VERSION = 'v21.0';

export function sha256Normalized(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  return createHash('sha256').update(s).digest('hex');
}

// Builds the Conversions API event payload. Exported for tests.
export function buildMetaServerEvent({
  eventName,
  eventId,
  eventTime,
  attribution,
  email,
  externalId,
  value,
  currency,
  contentIds,
  contentName,
  contentType,
  numItems,
}) {
  const userData = {};
  const em = sha256Normalized(email);
  if (em) userData.em = [em];
  const ext = sha256Normalized(externalId);
  if (ext) userData.external_id = [ext];
  if (attribution?.clientIp) userData.client_ip_address = attribution.clientIp;
  if (attribution?.userAgent) userData.client_user_agent = attribution.userAgent;
  if (attribution?.fbp) userData.fbp = attribution.fbp;
  if (attribution?.fbc) userData.fbc = attribution.fbc;

  const customData = {};
  if (Number.isFinite(value)) customData.value = Math.round(value * 100) / 100;
  if (currency) customData.currency = String(currency).toUpperCase();
  if (contentIds?.length) customData.content_ids = contentIds.map(String);
  if (contentName) customData.content_name = String(contentName).slice(0, 200);
  if (contentType) customData.content_type = contentType;
  if (Number.isFinite(numItems)) customData.num_items = numItems;

  const event = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data: userData,
    custom_data: customData,
  };
  if (attribution?.sourceUrl) event.event_source_url = attribution.sourceUrl;
  return event;
}

export async function sendMetaServerEvent(event, { fetchImpl = fetch } = {}) {
  if (!isMetaServerConfigured()) return { skipped: 'not_configured' };
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  const body = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[meta-capi] rejected', { status: res.status, event: event.event_name, id: event.event_id, body: text.slice(0, 300) });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error('[meta-capi] send failed', { event: event.event_name, id: event.event_id, err: String(err?.message || err) });
    return { ok: false };
  }
}
