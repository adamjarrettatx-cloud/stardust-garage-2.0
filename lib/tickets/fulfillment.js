// Ticket order fulfillment. Called from the Stripe webhook after payment
// confirms. Every step here is written to be idempotent: a webhook replay
// (Stripe re-fires events under both original + updated names, and can
// double-deliver during outages) must be a no-op that returns 200.
//
// Sequence (webhook is the source of truth for "paid"):
//   1. Look up the hold by hold_id metadata.
//   2. Look up or create the orders row by stripe_payment_intent_id
//      (unique index) — this is the idempotency anchor.
//   3. If the order is already 'paid', return success (replay path).
//   4. Consume the hold via consume_ticket_hold() RPC (atomic sold++).
//   5. Insert order_items from the hold items snapshot.
//   6. Issue tickets (unique-by (order_item_id, seat_index) => idempotent).
//   7. Write audit log entries.
//   8. Return { orderId, ticketIds }. Email is dispatched by the caller.
//
// Every write uses the service-role client passed by the webhook, so RLS
// never applies here.

// Relative import (not @/) so this module is unit-testable under
// `node --test` without a path-alias resolver.
import { generateTicketCode } from './codes.js';

// Finalize a paid ticket order. `paymentIntent` and `session` are the raw
// Stripe objects (or lookalikes constructed by the webhook after fetching
// the session). Money fields are minor units.
export async function finalizeTicketOrder({
  supabaseAdmin,
  holdId,
  eventId,
  paymentIntent,
  session,
  buyerEmail,
  buyerName,
  userId,
  memberProfileId,
  stripeCustomerId,
}) {
  if (!holdId) throw new Error('finalizeTicketOrder: holdId is required');
  if (!paymentIntent?.id) throw new Error('finalizeTicketOrder: paymentIntent.id is required');

  // --- Idempotency check: has this PI already been fulfilled? -----------
  const { data: existingOrder } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .maybeSingle();

  if (existingOrder && existingOrder.status === 'paid') {
    return { orderId: existingOrder.id, ticketIds: [], replay: true };
  }

  // --- Load the hold and its snapshot items -----------------------------
  const { data: hold, error: holdErr } = await supabaseAdmin
    .from('ticket_holds')
    .select('*')
    .eq('id', holdId)
    .maybeSingle();
  if (holdErr || !hold) throw new Error(`Hold not found: ${holdId}`);
  if (hold.status !== 'pending' && hold.status !== 'consumed') {
    // Explicitly expired / released — this payment shouldn't have been
    // accepted. Refund logic is the caller's responsibility if desired;
    // we log and bail so the webhook still 200s and doesn't retry-loop.
    return { orderId: null, ticketIds: [], error: `HOLD_${hold.status.toUpperCase()}` };
  }

  // Charge id — Stripe places it on `latest_charge` in modern payloads;
  // older payloads use `charges.data[0].id`. Handle both without failing.
  const chargeId =
    paymentIntent.latest_charge ||
    paymentIntent.charges?.data?.[0]?.id ||
    null;

  // --- Upsert the orders row atomically on stripe_payment_intent_id ----
  // Handles the race where two webhook deliveries arrive concurrently: the
  // unique index makes the second insert fail, and we re-read to see the
  // winner. Emulated via select-then-insert here to avoid needing the
  // service-role client's on_conflict knowledge of every column.
  let orderId = existingOrder?.id || null;

  if (!orderId) {
    const totalCents = paymentIntent.amount_received ?? paymentIntent.amount ?? hold.subtotal_cents;
    const feesCents = 0; // Stripe fees are reported on the Balance Transaction; we hydrate later.
    const insert = await supabaseAdmin
      .from('orders')
      .insert({
        event_id: eventId,
        hold_id: hold.id,
        user_id: userId || hold.user_id || null,
        member_profile_id: memberProfileId || hold.member_profile_id || null,
        buyer_email: (buyerEmail || hold.buyer_email || '').toLowerCase(),
        buyer_name: buyerName || null,
        status: 'pending',
        subtotal_cents: hold.subtotal_cents,
        fees_cents: feesCents,
        total_cents: totalCents,
        currency: hold.currency || 'usd',
        stripe_customer_id: stripeCustomerId || null,
        stripe_checkout_session_id: session?.id || null,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_charge_id: chargeId,
        raw_metadata: { stripe_metadata: paymentIntent.metadata || {} },
      })
      .select('id')
      .single();

    if (insert.error) {
      // Unique index collision => another webhook won; re-read.
      const { data: winner } = await supabaseAdmin
        .from('orders')
        .select('id, status')
        .eq('stripe_payment_intent_id', paymentIntent.id)
        .maybeSingle();
      if (winner && winner.status === 'paid') {
        return { orderId: winner.id, ticketIds: [], replay: true };
      }
      if (!winner) throw insert.error;
      orderId = winner.id;
    } else {
      orderId = insert.data.id;
    }
  }

  // --- Consume the hold (moves reserved -> sold; idempotent) -----------
  const { error: consumeErr } = await supabaseAdmin.rpc('consume_ticket_hold', {
    p_hold_id: hold.id,
  });
  if (consumeErr) throw consumeErr;

  // --- Insert order_items from the hold snapshot -----------------------
  // If items already exist (replay after partial fulfillment), skip.
  const { data: existingItems } = await supabaseAdmin
    .from('order_items')
    .select('id, product_id, quantity, unit_price_cents')
    .eq('order_id', orderId);

  const items = Array.isArray(hold.items) ? hold.items : [];
  let orderItems = existingItems || [];

  if (!existingItems || existingItems.length === 0) {
    // Enrich the snapshot with human-readable names for the audit trail.
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const { data: products } = await supabaseAdmin
      .from('ticket_products')
      .select('id, name')
      .in('id', productIds);
    const nameById = new Map((products || []).map((p) => [p.id, p.name]));

    const tierIds = [...new Set(items.map((i) => i.tier_id).filter(Boolean))];
    const { data: tiers } = tierIds.length
      ? await supabaseAdmin.from('ticket_price_tiers').select('id, name').in('id', tierIds)
      : { data: [] };
    const tierNameById = new Map((tiers || []).map((t) => [t.id, t.name]));

    const rows = items.map((i) => ({
      order_id: orderId,
      product_id: i.product_id,
      tier_id: i.tier_id || null,
      product_name_snapshot: nameById.get(i.product_id) || 'Ticket',
      tier_name_snapshot: i.tier_id ? tierNameById.get(i.tier_id) || null : null,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      subtotal_cents: i.unit_price_cents * i.quantity,
    }));
    const { data: inserted, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .insert(rows)
      .select('id, product_id, quantity, unit_price_cents');
    if (itemsErr) throw itemsErr;
    orderItems = inserted;
  }

  // --- Issue tickets (one per seat_index). Unique (order_item_id, seat_index)
  //     makes this a no-op on replay. -----------------------------------
  const ticketRows = [];
  for (const item of orderItems) {
    for (let seat = 0; seat < item.quantity; seat++) {
      ticketRows.push({
        order_id: orderId,
        order_item_id: item.id,
        event_id: eventId,
        product_id: item.product_id,
        seat_index: seat,
        ticket_code: generateTicketCode(),
        status: 'valid',
      });
    }
  }

  let ticketIds = [];
  if (ticketRows.length) {
    // Retry loop for the (astronomically unlikely) code collision: swap
    // codes and retry once. Fresh randomness on the second pass is enough.
    const { data: issued, error: ticketsErr } = await supabaseAdmin
      .from('tickets')
      .insert(ticketRows)
      .select('id');
    if (ticketsErr) {
      if (String(ticketsErr.code) === '23505' && /ticket_code/.test(ticketsErr.message || '')) {
        const retryRows = ticketRows.map((r) => ({ ...r, ticket_code: generateTicketCode() }));
        const retry = await supabaseAdmin.from('tickets').insert(retryRows).select('id');
        if (retry.error) throw retry.error;
        ticketIds = retry.data.map((t) => t.id);
      } else if (String(ticketsErr.code) === '23505' && /order_item_id/.test(ticketsErr.message || '')) {
        // Replay: tickets already exist for these items. Re-read them.
        const itemIds = orderItems.map((i) => i.id);
        const { data: prior } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .in('order_item_id', itemIds);
        ticketIds = (prior || []).map((t) => t.id);
      } else {
        throw ticketsErr;
      }
    } else {
      ticketIds = issued.map((t) => t.id);
    }
  }

  // --- Mark order paid + audit log -------------------------------------
  await supabaseAdmin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_charge_id: chargeId,
    })
    .eq('id', orderId);

  await supabaseAdmin.from('ticket_audit_log').insert([
    {
      event_id: eventId,
      order_id: orderId,
      actor_role: 'webhook',
      action: 'order.paid',
      detail: {
        payment_intent_id: paymentIntent.id,
        hold_id: hold.id,
        ticket_count: ticketIds.length,
      },
    },
  ]);

  return { orderId, ticketIds, replay: false };
}

// Called from a scheduled cron sweep. Releases holds whose expires_at is
// in the past and that never got consumed. Uses the release RPC to keep
// inventory counters consistent.
export async function sweepExpiredHolds(supabaseAdmin, { limit = 100 } = {}) {
  const { data: expired, error } = await supabaseAdmin
    .from('ticket_holds')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .limit(limit);
  if (error) throw error;

  let released = 0;
  for (const h of expired || []) {
    const { data: ok } = await supabaseAdmin.rpc('release_ticket_hold', { p_hold_id: h.id });
    if (ok) released += 1;
  }
  return { released, scanned: (expired || []).length };
}
