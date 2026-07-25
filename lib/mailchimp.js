// Mailchimp API helper module.
//
// Auth: Bearer <MAILCHIMP_API_KEY> against https://<server prefix>.api.mailchimp.com/3.0
// (Mailchimp API keys are suffixed with the datacenter, e.g. "abc123-us18" — we
// keep the prefix as its own env var rather than parsing it out of the key so
// the key can be rotated without also updating the base URL by hand.)
//
// This module powers "did an email campaign actually drive a ticket sale":
//   1. lib/marketing-attribution.js resolves an mc_eid (Mailchimp's per-recipient
//      click-tracking id) to an email address via lookupEmailByMcEid() and logs
//      the click.
//   2. app/api/webhooks/tickettailor/route.js calls syncOrderToMailchimp() when a
//      Ticket Tailor order completes, which upserts the customer/product/order
//      into this Mailchimp "store" so Mailchimp's own campaign reports show real
//      ticket revenue per campaign, not just opens/clicks.

import crypto from 'crypto';

function serverPrefix() {
  const prefix = process.env.MAILCHIMP_SERVER_PREFIX;
  if (!prefix) throw new Error('MAILCHIMP_SERVER_PREFIX is not configured');
  return prefix;
}

function apiKey() {
  const key = process.env.MAILCHIMP_API_KEY;
  if (!key) throw new Error('MAILCHIMP_API_KEY is not configured');
  return key;
}

export function isMailchimpConfigured() {
  return Boolean(
    process.env.MAILCHIMP_API_KEY &&
      process.env.MAILCHIMP_SERVER_PREFIX &&
      process.env.MAILCHIMP_STORE_ID &&
      process.env.MAILCHIMP_LIST_ID,
  );
}

// Low-level fetch wrapper. Returns { ok, status, body }. Never throws on a
// non-2xx response — callers decide how to react (e.g. "already exists" on a
// create is fine, not fatal) so the Ticket Tailor webhook handler can stay
// fail-open on Mailchimp errors (a sale must never be lost because Mailchimp
// hiccuped).
async function mcFetch(path, options = {}) {
  const url = `https://${serverPrefix()}.api.mailchimp.com/3.0${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
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
  return { ok: res.ok, status: res.status, body };
}

// Mailchimp's "subscriber hash" is the lowercased email, MD5-hex encoded. Used
// both for list-member lookups and as our Mailchimp ecommerce customer id, so
// a customer record always lines up with the same person's list entry.
export function emailHash(email) {
  return crypto.createHash('md5').update(String(email).trim().toLowerCase()).digest('hex');
}

// Resolves a Mailchimp click-tracking id (the "mc_eid" query param Mailchimp
// appends to every link in a campaign) to the recipient's email address, via
// the list-member "unique_email_id" filter. Returns null if not found/expired
// — mc_eid values aren't guaranteed to resolve forever, and a lookup miss just
// means we skip campaign-level attribution for that click, not fail the visit.
export async function lookupEmailByMcEid(mcEid) {
  if (!mcEid) return null;
  const listId = process.env.MAILCHIMP_LIST_ID;
  if (!listId) return null;
  const { ok, body } = await mcFetch(
    `/lists/${listId}/members?unique_email_id=${encodeURIComponent(mcEid)}&count=1`,
  );
  if (!ok) return null;
  const member = body?.members?.[0];
  return member?.email_address || null;
}

// Looks up a campaign's title for nicer logging/dashboards. Best-effort only.
export async function lookupCampaignTitle(campaignId) {
  if (!campaignId) return null;
  const { ok, body } = await mcFetch(
    `/campaigns/${encodeURIComponent(campaignId)}?fields=settings.title,settings.subject_line`,
  );
  if (!ok) return null;
  return body?.settings?.title || body?.settings?.subject_line || null;
}

// Ensures a product (+ single variant) exists for a local event, so ticket
// orders have something to attach as an order "line". We model each Stardust
// Garage event as one Mailchimp ecommerce product; id = our local event id (or
// the raw Ticket Tailor event id when there's no local match).
export async function ensureEventProduct({ productId, title, priceCents }) {
  const storeId = process.env.MAILCHIMP_STORE_ID;
  const price = Math.max(0, Math.round((priceCents || 0)) / 100);
  const existing = await mcFetch(`/ecommerce/stores/${storeId}/products/${productId}`);
  if (existing.ok) return existing.body;

  const created = await mcFetch(`/ecommerce/stores/${storeId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      id: productId,
      title: title || 'Event Ticket',
      variants: [{ id: productId, title: title || 'Event Ticket', price, inventory_quantity: 0 }],
    }),
  });
  return created.body;
}

// Upserts a customer record (PUT is an upsert in Mailchimp's ecommerce API).
export async function upsertCustomer({ email, optedIn }) {
  const storeId = process.env.MAILCHIMP_STORE_ID;
  const id = emailHash(email);
  const { body } = await mcFetch(`/ecommerce/stores/${storeId}/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      id,
      email_address: email,
      opt_in_status: Boolean(optedIn),
    }),
  });
  return body;
}

// Creates (or, if it already exists, patches) an order tied to a customer,
// optionally attributed to the Mailchimp campaign that drove the click
// (campaignId = the mc_cid captured at click time). This is what makes ticket
// revenue show up against a specific campaign in Mailchimp's own reporting.
export async function upsertOrder({
  orderId,
  email,
  optedIn,
  totalCents,
  productId,
  productTitle,
  campaignId,
  financialStatus = 'paid',
  processedAtIso,
}) {
  const storeId = process.env.MAILCHIMP_STORE_ID;
  const customerId = emailHash(email);
  const orderTotal = Math.max(0, Math.round(totalCents || 0)) / 100;

  await upsertCustomer({ email, optedIn });
  await ensureEventProduct({ productId, title: productTitle, priceCents: totalCents });

  const payload = {
    id: orderId,
    customer: { id: customerId, email_address: email, opt_in_status: Boolean(optedIn) },
    currency_code: 'USD',
    order_total: orderTotal,
    financial_status: financialStatus,
    processed_at_foreign: processedAtIso || new Date().toISOString(),
    lines: [
      {
        id: '1',
        product_id: productId,
        product_variant_id: productId,
        quantity: 1,
        price: orderTotal,
      },
    ],
    ...(campaignId ? { campaign_id: campaignId } : {}),
  };

  const created = await mcFetch(`/ecommerce/stores/${storeId}/orders`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (created.ok) return { ok: true, mode: 'created', body: created.body };

  // Order id already exists (e.g. order.updated fired after order.created
  // already synced it, or a webhook retry) — patch instead of failing.
  const patched = await mcFetch(`/ecommerce/stores/${storeId}/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      financial_status: financialStatus,
      order_total: orderTotal,
      ...(campaignId ? { campaign_id: campaignId } : {}),
    }),
  });
  return { ok: patched.ok, mode: 'patched', body: patched.body, createError: created.body };
}
