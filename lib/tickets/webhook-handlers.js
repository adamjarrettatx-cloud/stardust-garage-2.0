// Webhook dispatchers for internal-ticketing Stripe events. Called from
// app/api/stripe/webhook/route.js after signature verification. Each handler
// is idempotent — safe to run more than once for the same Stripe event.

import { CHECKOUT_KIND_TICKET, CHECKOUT_KIND_SETUP, retrieveCheckoutSession } from '@/lib/tickets/stripe';
import { stripe } from '@/lib/stripe/client';
import { finalizeTicketOrder } from '@/lib/tickets/fulfillment';
import { sendTicketConfirmation } from '@/lib/email';
import { renderTicketQrSvg } from '@/lib/tickets/qr';

// Returns true if the event applies to the internal ticketing flow, so the
// shared webhook can short-circuit non-ticket events into the existing
// subscription handler untouched.
export function isTicketFlowEvent(stripeEvent) {
  const md =
    stripeEvent?.data?.object?.metadata ||
    stripeEvent?.data?.object?.payment_intent?.metadata ||
    null;
  const kind = md?.checkout_kind;
  return kind === CHECKOUT_KIND_TICKET || kind === CHECKOUT_KIND_SETUP;
}

// Same shape as the subscription webhook returns — { pushes, followups } —
// so the shared route can fire them after ACKing Stripe.
export async function handleTicketFlowEvent({ stripeEvent, supabaseAdmin, request }) {
  const obj = stripeEvent.data.object;
  const md = obj.metadata || {};
  const kind = md.checkout_kind || obj.payment_intent?.metadata?.checkout_kind;

  if (kind === CHECKOUT_KIND_TICKET) {
    return handleTicketPurchaseEvent({ stripeEvent, supabaseAdmin, request });
  }
  if (kind === CHECKOUT_KIND_SETUP) {
    return handleSavePaymentMethodEvent({ stripeEvent, supabaseAdmin });
  }
  return { handled: false };
}

async function handleTicketPurchaseEvent({ stripeEvent, supabaseAdmin, request }) {
  const type = stripeEvent.type;
  const obj = stripeEvent.data.object;

  // We fulfill on either checkout.session.completed OR payment_intent.succeeded;
  // whichever arrives first wins and the other becomes a replay no-op.
  if (type !== 'checkout.session.completed' && type !== 'payment_intent.succeeded') {
    // Non-fulfillment events (async payment failed, etc.) — log and skip.
    return { handled: true, ignored: true };
  }

  let session = null;
  let paymentIntent = null;
  let holdId = null;
  let eventId = null;

  if (type === 'checkout.session.completed') {
    session = obj;
    holdId = session.metadata?.hold_id;
    eventId = session.metadata?.event_id;
    if (session.payment_intent) {
      paymentIntent = await stripe.get(`/payment_intents/${session.payment_intent}`);
    }
  } else {
    paymentIntent = obj;
    holdId = paymentIntent.metadata?.hold_id;
    eventId = paymentIntent.metadata?.event_id;
    // Best-effort: look up the session for buyer name + email.
    if (holdId) {
      const { data: hold } = await supabaseAdmin
        .from('ticket_holds')
        .select('stripe_checkout_session_id')
        .eq('id', holdId)
        .maybeSingle();
      if (hold?.stripe_checkout_session_id) {
        try {
          session = await retrieveCheckoutSession(hold.stripe_checkout_session_id, {
            expand: ['customer_details'],
          });
        } catch {
          session = null;
        }
      }
    }
  }

  if (!holdId || !eventId) {
    console.error('[ticket-webhook] missing hold_id/event_id on', type);
    return { handled: true, error: 'MISSING_METADATA' };
  }
  if (paymentIntent?.status !== 'succeeded') {
    return { handled: true, ignored: true, reason: `pi_status=${paymentIntent?.status}` };
  }

  const buyerEmail =
    session?.customer_details?.email ||
    session?.customer_email ||
    paymentIntent?.receipt_email ||
    null;
  const buyerName = session?.customer_details?.name || null;

  const result = await finalizeTicketOrder({
    supabaseAdmin,
    holdId,
    eventId,
    paymentIntent,
    session,
    buyerEmail,
    buyerName,
    userId: paymentIntent.metadata?.user_id || null,
    memberProfileId: paymentIntent.metadata?.member_profile_id || null,
    stripeCustomerId: session?.customer || paymentIntent.customer || null,
  });

  if (result.replay) {
    return { handled: true, replay: true, orderId: result.orderId };
  }
  if (result.error) {
    return { handled: true, error: result.error };
  }

  // Deliver the confirmation email — fire-and-forget from the caller.
  const followups = [async () => sendConfirmationEmailFor({ supabaseAdmin, orderId: result.orderId, request })];
  return { handled: true, orderId: result.orderId, ticketIds: result.ticketIds, followups };
}

async function sendConfirmationEmailFor({ supabaseAdmin, orderId, request }) {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, buyer_email, event_id')
    .eq('id', orderId)
    .single();
  if (!order?.buyer_email) return;

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, title, event_date, start_time')
    .eq('id', order.event_id)
    .maybeSingle();

  const { data: tickets } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_code, order_item_id')
    .eq('order_id', order.id);

  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('id, product_name_snapshot, tier_name_snapshot')
    .eq('order_id', order.id);
  const itemById = new Map((items || []).map((i) => [i.id, i]));

  const ticketRows = (tickets || []).map((t) => ({
    ticketCode: t.ticket_code,
    productName: itemById.get(t.order_item_id)?.product_name_snapshot || 'Ticket',
    tierName: itemById.get(t.order_item_id)?.tier_name_snapshot || null,
    qrSvg: renderTicketQrSvg({ ticketCode: t.ticket_code, request }),
    viewUrl: null,
  }));

  const eventWhen = event?.event_date
    ? `${event.event_date}${event.start_time ? ` at ${event.start_time}` : ''}`
    : null;

  try {
    await sendTicketConfirmation({
      to: order.buyer_email,
      orderId: order.id,
      eventTitle: event?.title || 'Stardust Garage',
      eventWhen,
      ticketRows,
    });
  } catch (err) {
    console.error('[ticket-webhook] confirmation email failed:', err);
  }
}

async function handleSavePaymentMethodEvent({ stripeEvent, supabaseAdmin }) {
  const type = stripeEvent.type;
  if (type !== 'checkout.session.completed' && type !== 'setup_intent.succeeded') {
    return { handled: true, ignored: true };
  }

  let setupIntent = null;
  let session = null;
  let userId = null;
  let memberProfileId = null;
  let customerId = null;

  if (type === 'checkout.session.completed') {
    session = stripeEvent.data.object;
    userId = session.metadata?.user_id;
    memberProfileId = session.metadata?.member_profile_id;
    customerId = session.customer;
    if (session.setup_intent) {
      setupIntent = await stripe.get(`/setup_intents/${session.setup_intent}`);
    }
  } else {
    setupIntent = stripeEvent.data.object;
    userId = setupIntent.metadata?.user_id;
    memberProfileId = setupIntent.metadata?.member_profile_id;
    customerId = setupIntent.customer;
  }

  if (!userId || !customerId || !setupIntent?.payment_method) {
    return { handled: true, error: 'MISSING_SETUP_FIELDS' };
  }

  const pm = await stripe.get(`/payment_methods/${setupIntent.payment_method}`);
  const card = pm.card || {};

  // Upsert on stripe_payment_method_id (unique index) so replays are no-ops.
  const { error: upsertErr } = await supabaseAdmin
    .from('saved_payment_method_refs')
    .upsert(
      {
        user_id: userId,
        member_profile_id: memberProfileId || null,
        stripe_customer_id: customerId,
        stripe_payment_method_id: pm.id,
        brand: card.brand || null,
        last4: card.last4 || null,
        exp_month: card.exp_month || null,
        exp_year: card.exp_year || null,
      },
      { onConflict: 'stripe_payment_method_id' }
    );
  if (upsertErr) throw upsertErr;

  // First saved PM for this user? Mark default.
  const { count } = await supabaseAdmin
    .from('saved_payment_method_refs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (count === 1) {
    await supabaseAdmin
      .from('saved_payment_method_refs')
      .update({ is_default: true })
      .eq('user_id', userId)
      .eq('stripe_payment_method_id', pm.id);
  }

  return { handled: true, paymentMethodId: pm.id };
}
