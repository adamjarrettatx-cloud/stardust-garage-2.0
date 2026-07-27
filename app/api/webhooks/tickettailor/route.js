import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMailchimpConfigured, upsertOrder } from '@/lib/mailchimp';
import { syncMemberTicketsForOrder } from '@/lib/member-tickets';

// TEMP DIAGNOSTIC: writes every request outcome (including skips/errors) to
// webhook_debug_log so we can see exactly what Ticket Tailor is sending,
// since Vercel's own runtime logs aren't reachable from this environment.
// Safe to delete once the pipeline is confirmed working end to end.
async function logDebug(admin, fields) {
  try {
    await admin.from('webhook_debug_log').insert({
      source: 'tickettailor',
      error_message: fields.error_message || null,
      error_stack: fields.error_stack || null,
      raw_body: fields.raw_body || null,
    });
  } catch (e) {
    console.warn('[webhooks.tickettailor] debug log insert failed', e);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ticket Tailor -> our site -> Mailchimp.
//
// Ticket Tailor fires this webhook on order.created / order.updated. We:
//   1. Verify the signature (fail closed — see verifySignature below).
//   2. Only act on completed orders (skip pending/cancelled — ack 200 either way).
//   3. Look up the most recent Mailchimp click from the same buyer email
//      (within a lookback window) to recover the campaign that drove the sale.
//   4. Upsert the order into Mailchimp's ecommerce API so campaign reports
//      show real ticket revenue, attributed to that campaign when matched.
//   5. Record the outcome in ticket_order_attribution, keyed by TT order id
//      so repeat deliveries (created -> updated) upsert instead of duplicate.
//   6. Flatten the order's issued_tickets into member_tickets, the wallet the
//      mobile app reads under RLS (see lib/member-tickets.js).
//
// Mirrors app/api/webhooks/signnow/route.js conventions: read the raw body
// before parsing (required for signature verification), never 500 on an
// unrecognized/malformed payload (ack 200 + skip reason instead), and treat
// a bad signature as the one case that gets rejected outright (401).
//
// Docs:
//   https://developers.tickettailor.com/docs/webhook/structure/
//   https://developers.tickettailor.com/docs/webhook/security/
//   https://developers.tickettailor.com/  (order object field reference)

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60; // TT's own recommended replay window
const CLICK_MATCH_LOOKBACK_DAYS = 45; // matches the click cookie lifetime

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

// Header format per TT docs: "t=<unix timestamp>,s=<hex hmac>"
// Signature = HMAC-SHA256(timestamp + rawBody, sharedSecret), hex-encoded.
function verifySignature(header, rawBody, secret) {
  if (!header || !secret) return { valid: false, reason: 'missing_header_or_secret' };

  const parts = header.split(',');
  const timestampPart = parts[0]?.split('=');
  const signaturePart = parts[1]?.split('=');
  const timestamp = timestampPart?.[1];
  const signature = signaturePart?.[1];
  if (!timestamp || !signature) return { valid: false, reason: 'malformed_header' };

  const expected = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('hex');
  if (!timingSafeEqualHex(expected, signature)) return { valid: false, reason: 'signature_mismatch' };

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'stale_timestamp' };
  }
  return { valid: true };
}

export async function POST(request) {
  const secret = process.env.TICKETTAILOR_WEBHOOK_SECRET;
  const rawBody = await request.text();

  // Fail closed: no secret configured yet, or a bad/missing signature -> 401.
  // This is the one case we deliberately do NOT ack 200 for, since accepting
  // an unverified request would let anyone forge fake "order paid" events.
  const signatureHeader =
    request.headers.get('tickettailor-webhook-signature') ||
    request.headers.get('Tickettailor-Webhook-Signature');
  const verification = verifySignature(signatureHeader, rawBody, secret);
  if (!verification.valid) {
    console.warn('[webhooks.tickettailor] rejected', verification.reason);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const debugAdmin = createAdminClient();

  let envelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    await logDebug(debugAdmin, { error_message: 'bad_json', raw_body: rawBody.slice(0, 8000) });
    return NextResponse.json({ received: true, skipped: 'bad_json' });
  }

  // Ticket Tailor sends this as "ORDER.CREATED" / "ORDER.UPDATED" (uppercase)
  // in production, despite docs examples showing lowercase - normalize before
  // comparing so we don't silently ignore every real delivery.
  const eventType = envelope?.event;
  const normalizedEventType = typeof eventType === 'string' ? eventType.toLowerCase() : eventType;
  const order = envelope?.payload;
  if (!order || !['order.created', 'order.updated'].includes(normalizedEventType)) {
    await logDebug(debugAdmin, {
      error_message: `ignored_event_type: ${eventType || 'undefined'}`,
      raw_body: rawBody.slice(0, 8000),
    });
    return NextResponse.json({ received: true, skipped: 'ignored_event_type', event: eventType || null });
  }

  const orderId = order.id;
  const status = typeof order.status === 'string' ? order.status.toLowerCase() : order.status; // 'completed' | 'pending' | 'canceled' per TT docs
  const buyerEmail = order.buyer_details?.email || null;
  const totalPaidCents = Number(order.total_paid ?? order.total ?? 0);
  const currency = order.currency?.code?.toUpperCase() || 'USD';
  const ttEventId = order.event_summary?.event_id || null;
  const ttEventSeriesId = order.event_summary?.event_series_id || null;
  const eventName = order.event_summary?.name || 'Event Ticket';

  if (!orderId) {
    await logDebug(debugAdmin, { error_message: 'missing_order_id', raw_body: rawBody.slice(0, 8000) });
    return NextResponse.json({ received: true, skipped: 'missing_order_id' });
  }

  const admin = debugAdmin;

  try {
  // Look up a matching local event (for a nicer product title + local_event_id
  // FK) by the TT event series id — this is how events.tt_event_series_id
  // links a Ticket Tailor series to a row in our own events table.
  let localEventId = null;
  if (ttEventSeriesId) {
    const { data: localEvent } = await admin
      .from('events')
      .select('id, title')
      .eq('tt_event_series_id', ttEventSeriesId)
      .maybeSingle();
    if (localEvent) localEventId = localEvent.id;
  }

  // Only completed orders count as revenue. Still upsert a row for
  // pending/canceled so status transitions (e.g. offline payment later
  // completing) are visible, but skip the Mailchimp sync until it's paid.
  const isCompleted = status === 'completed';
  const isCanceled = status === 'canceled' || status === 'cancelled';

  let matchedClickId = null;
  let matchedMcCid = null;
  if (buyerEmail) {
    const lookbackIso = new Date(Date.now() - CLICK_MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: click } = await admin
      .from('marketing_email_clicks')
      .select('id, mc_cid')
      .eq('email', buyerEmail.toLowerCase())
      .gte('created_at', lookbackIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (click) {
      matchedClickId = click.id;
      matchedMcCid = click.mc_cid;
    }
  }

  let mailchimpSynced = false;
  let mailchimpSyncError = null;
  // Sync on completion (revenue) and on later cancellation (so a refunded
  // order doesn't sit in Mailchimp forever marked 'paid'). Pending orders
  // aren't synced at all — nothing to attribute yet.
  if ((isCompleted || isCanceled) && buyerEmail && isMailchimpConfigured()) {
    try {
      const result = await upsertOrder({
        orderId,
        email: buyerEmail,
        optedIn: order.marketing_opt_in === 'true' || order.marketing_opt_in === true,
        totalCents: totalPaidCents,
        productId: ttEventSeriesId || ttEventId || 'tickets',
        productTitle: eventName,
        campaignId: matchedMcCid || undefined,
        financialStatus: isCanceled ? 'cancelled' : 'paid',
        processedAtIso: order.created_at ? new Date(order.created_at * 1000).toISOString() : undefined,
      });
      mailchimpSynced = Boolean(result.ok);
      if (!result.ok) mailchimpSyncError = JSON.stringify(result.body || result.createError || 'unknown error').slice(0, 2000);
    } catch (err) {
      mailchimpSyncError = String(err?.message || err).slice(0, 2000);
      console.warn('[webhooks.tickettailor] Mailchimp sync failed', err);
    }
  } else if (!isMailchimpConfigured()) {
    mailchimpSyncError = 'mailchimp_not_configured';
  }

  const { error: upsertError } = await admin
    .from('ticket_order_attribution')
    .upsert(
      {
        tt_order_id: orderId,
        tt_event_id: ttEventId,
        local_event_id: localEventId,
        buyer_email: buyerEmail,
        total_paid_cents: Number.isFinite(totalPaidCents) ? Math.round(totalPaidCents) : 0,
        currency,
        status,
        matched_mc_cid: matchedMcCid,
        matched_click_id: matchedClickId,
        mailchimp_synced: mailchimpSynced,
        mailchimp_sync_error: mailchimpSyncError,
        raw_payload: order,
      },
      { onConflict: 'tt_order_id' },
    );

  if (upsertError) {
    console.error('[webhooks.tickettailor] failed to record order', upsertError);
    await logDebug(debugAdmin, {
      error_message: `upsert_failed: ${upsertError.message || JSON.stringify(upsertError)}`,
      raw_body: rawBody.slice(0, 8000),
    });
    // Still ack 200 — TT will retry on non-2xx, and a DB write failure here
    // should not cause TT to keep hammering the endpoint. It's logged above
    // for follow-up; a failed Mailchimp sync can be manually re-driven later.
  } else {
    // Only once the parent row exists — member_tickets.tt_order_id is an FK
    // onto ticket_order_attribution. Treated as non-fatal like every other DB
    // write here: the wallet is derivable from raw_payload at any time via
    // scripts/backfill-member-tickets.mjs, so a failure is worth logging but
    // never worth making TT retry the delivery.
    try {
      await syncMemberTicketsForOrder(admin, order, { localEventId, orderStatus: status });
    } catch (err) {
      console.error('[webhooks.tickettailor] member_tickets sync failed', err);
      await logDebug(debugAdmin, {
        error_message: `member_tickets_sync_failed order_id=${orderId}: ${String(err?.message || err).slice(0, 2000)}`,
        error_stack: String(err?.stack || '').slice(0, 4000),
      });
    }

    // TEMP DIAGNOSTIC: confirm a successful write with the raw payload, so we
    // can sanity-check field shapes even on the happy path.
    await logDebug(debugAdmin, {
      error_message: `ok order_id=${orderId} status=${status} mailchimp_synced=${mailchimpSynced}`,
      raw_body: rawBody.slice(0, 8000),
    });
  }

  return NextResponse.json({ received: true, order_id: orderId, mailchimp_synced: mailchimpSynced });
  } catch (err) {
    console.error('[webhooks.tickettailor] unhandled error', err);
    await logDebug(debugAdmin, {
      error_message: String(err?.message || err).slice(0, 2000),
      error_stack: String(err?.stack || '').slice(0, 4000),
      raw_body: rawBody.slice(0, 8000),
    });
    return NextResponse.json({ received: true, skipped: 'internal_error' });
  }
}
