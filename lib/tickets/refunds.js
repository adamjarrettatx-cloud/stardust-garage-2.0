import { stripe } from '@/lib/stripe/client';

const get = (path, options = {}) => stripe.get(path, { ...options, timeoutMs: 10000 });
export function publicRefundResult(row) {
  return {
    id: row.id, order_id: row.order_id, amount_cents: row.amount_cents,
    currency: row.currency, status: row.status, stripe_status: row.stripe_status,
    stripe_refund_id: row.stripe_refund_id, error: row.error || null,
  };
}

async function finish(db, request, refund) {
  if (refund.amount !== Number(request.amount_cents) || refund.currency !== request.currency
    || refund.metadata?.sdg_refund_request_id !== request.id) {
    throw new Error('Refund verification failed. No further refund was issued.');
  }
  const { data, error } = await db.rpc('finish_ticket_refund', {
    p_id: request.id, p_refund_id: refund.id, p_status: refund.status,
    p_error: ['failed', 'canceled'].includes(refund.status)
      ? (refund.failure_reason || 'Stripe could not complete this refund.') : null,
  });
  if (error) throw error;
  return publicRefundResult(data);
}

async function findProviderRefund(paymentIntent, requestId) {
  let cursor;
  for (;;) {
    const response = await get('/refunds', {
      query: { payment_intent: paymentIntent, limit: 100, ...(cursor ? { starting_after: cursor } : {}) },
    });
    const match = response.data?.find((refund) => refund.metadata?.sdg_refund_request_id === requestId);
    if (match) return match;
    if (!response.has_more) return null;
    cursor = response.data?.at(-1)?.id;
    if (!cursor) throw new Error('Could not verify existing Stripe refunds.');
  }
}

export async function executeTicketRefund(db, id, actorId) {
  const { data: claimed, error: claimError } = await db.rpc('claim_ticket_refund', { p_id: id, p_actor: actorId });
  if (claimError) throw claimError;
  const { request, order } = claimed;
  if (['succeeded', 'failed'].includes(request.status)) return publicRefundResult(request);

  // Always resolve the original intent before any write, including after a
  // timeout or a database failure after Stripe already issued the refund.
  let refund = request.stripe_refund_id
    ? await get(`/refunds/${request.stripe_refund_id}`)
    : await findProviderRefund(order.stripe_payment_intent_id, request.id);
  if (refund) {
    if (refund.payment_intent !== order.stripe_payment_intent_id) throw new Error('Payment reference mismatch');
    return finish(db, request, refund);
  }
  // Stripe can prune keys after 24 hours. Never create again outside this
  // conservative window; recovery above still works indefinitely.
  if (!request.started_at || Date.now() - Date.parse(request.started_at) > 23 * 60 * 60 * 1000) {
    throw new Error('This request needs manual reconciliation in Stripe. It was not submitted again.');
  }

  const payment = await get(`/payment_intents/${order.stripe_payment_intent_id}`, {
    query: { 'expand[]': 'latest_charge' },
  });
  const charge = payment.latest_charge;
  if (payment.status !== 'succeeded' || !charge || typeof charge !== 'object'
      || charge.disputed || payment.currency !== request.currency
      || charge.amount !== Number(order.total_cents)) {
    return failWithoutRefund(db, request, 'Payment is disputed, incomplete, or its amount does not match. Review it in Stripe.');
  }
  if (charge.amount_refunded !== Number(request.expected_refunded_cents)) {
    // A competing retry may have just submitted this same request.
    refund = await findProviderRefund(order.stripe_payment_intent_id, request.id);
    if (refund) return finish(db, request, refund);
    return failWithoutRefund(db, request, 'The Stripe refund balance changed. Reconcile the order before issuing another refund.');
  }
  try {
    refund = await stripe.post('/refunds', {
      params: {
        payment_intent: order.stripe_payment_intent_id,
        amount: String(request.amount_cents),
        reason: 'requested_by_customer',
        metadata: { order_id: order.id, sdg_refund_request_id: request.id },
      },
      idempotencyKey: `sdg-refund-v2-${request.id}`,
      timeoutMs: 10000,
    });
  } catch (error) {
    // Only definite provider rejections release the order lock. A timeout,
    // 409, 429 or 5xx is uncertain and must retain the SAME request on retry.
    if ([400, 402, 404].includes(error.status) && error.stripeType !== 'idempotency_error') {
      const existing = await findProviderRefund(order.stripe_payment_intent_id, request.id);
      if (existing) return finish(db, request, existing);
      return failWithoutRefund(db, request, error.message);
    }
    throw error;
  }
  return finish(db, request, refund);
}

export async function checkTicketRefund(db, id) {
  const { data: request, error } = await db.from('ticket_refund_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!request || request.status === 'draft') throw new Error('No submitted refund found');
  let refund;
  if (request.stripe_refund_id) refund = await get(`/refunds/${request.stripe_refund_id}`);
  else if (request.status === 'processing') {
    const { data: order, error: orderError } = await db.from('orders')
      .select('stripe_payment_intent_id').eq('id', request.order_id).single();
    if (orderError) throw orderError;
    refund = await findProviderRefund(order.stripe_payment_intent_id, request.id);
  }
  // Read-only at Stripe: never create a refund from a webhook, scheduled check
  // or "check" action. Only the explicitly confirmed execution can POST.
  return refund ? finish(db, request, refund) : publicRefundResult(request);
}

async function failWithoutRefund(db, request, message) {
  const { data, error } = await db.rpc('finish_ticket_refund', {
    p_id: request.id, p_refund_id: null, p_status: 'failed', p_error: message,
  });
  if (error) throw error;
  return publicRefundResult(data);
}

// Fetch the current provider state instead of applying out-of-order webhook
// payloads. Errors propagate so Stripe retries; failed events are NOT marked done.
export async function handleTicketRefundEvent({ stripeEvent, supabaseAdmin }) {
  if (!['refund.created', 'refund.updated', 'refund.failed'].includes(stripeEvent.type)) return false;
  const payload = stripeEvent.data.object;
  const id = payload.metadata?.sdg_refund_request_id;
  if (!id) return false;
  const { data: request, error } = await supabaseAdmin.from('ticket_refund_requests')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!request) throw new Error('Refund request missing for webhook');
  const refund = await get(`/refunds/${payload.id}`);
  await finish(supabaseAdmin, request, refund);
  return true;
}
