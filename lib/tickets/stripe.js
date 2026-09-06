// Stripe operations specific to the internal ticketing flow. These wrap the
// generic lib/stripe/client.js with our metadata conventions so the webhook
// can find its way back to the right hold / order / event.
//
// Server-only.

import { stripe, findOrCreateStripeCustomer } from '@/lib/stripe/client';
import { stripeIdempotencyKey } from '@/lib/tickets/codes';

// checkout_kind is how the shared webhook (app/api/stripe/webhook/route.js)
// tells subscription flows apart from ticket flows. NEVER remove or rename
// without updating the webhook dispatcher.
export const CHECKOUT_KIND_TICKET = 'ticket_order';
export const CHECKOUT_KIND_SETUP = 'save_payment_method';

// Create a Stripe Checkout Session for one internal ticket order.
//
// `hold` is a public.ticket_holds row plus the joined event + products so
// we can render meaningful line items in Stripe's UI without another query.
// Metadata carries hold_id / order_intent_id / event_id / user_id so the
// webhook can locate and finalize the order without trusting client input.
export async function createTicketCheckoutSession({
  hold,
  event,
  lineDescriptors,   // [{ name, unit_price_cents, quantity }]
  successUrl,
  cancelUrl,
  customerId,       // optional — reuse if member already has one
  buyerEmail,
  request,
}) {
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Ticket sales are one-shot payments; disable Stripe's saved-PM flow
    // here so the wallet is opted into explicitly via /api/wallet/setup.
    payment_method_types: ['card'],
    // Collect an email at checkout for guest buyers so the webhook can
    // dispatch confirmation + ticket delivery even without an account.
    ...(customerId ? { customer: customerId } : { customer_email: buyerEmail || undefined }),
    line_items: lineDescriptors.map((line) => ({
      quantity: String(line.quantity),
      price_data: {
        currency: hold.currency || 'usd',
        unit_amount: String(line.unit_price_cents),
        product_data: {
          name: line.name,
          // Stripe truncates description at 500 chars.
          description: event.title ? `Ticket for ${event.title}`.slice(0, 500) : undefined,
        },
      },
    })),
    // Metadata carried on the Session AND propagated to PaymentIntent so
    // both event types on the webhook can find the hold.
    metadata: {
      checkout_kind: CHECKOUT_KIND_TICKET,
      hold_id: hold.id,
      event_id: hold.event_id,
      ...(hold.user_id ? { user_id: hold.user_id } : {}),
      ...(hold.member_profile_id ? { member_profile_id: hold.member_profile_id } : {}),
    },
    payment_intent_data: {
      metadata: {
        checkout_kind: CHECKOUT_KIND_TICKET,
        hold_id: hold.id,
        event_id: hold.event_id,
        ...(hold.user_id ? { user_id: hold.user_id } : {}),
      },
      // Statement descriptor suffix appears on the buyer's card statement.
      statement_descriptor_suffix: 'SDG TICKETS',
    },
    // 30 min matches our hold TTL default; Stripe will 410 stale sessions.
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
  };
  return stripe.post('/checkout/sessions', {
    params,
    idempotencyKey: stripeIdempotencyKey('checkout', hold.id),
  });
}

// Create a Stripe Checkout Session in `setup` mode. Buyer enters a card,
// Stripe validates and files it under the customer, and the webhook stores
// a saved_payment_method_refs row. NO ticket purchase — this is wallet-only.
export async function createSavePaymentMethodSession({
  userId,
  memberProfileId,
  email,
  fullName,
  existingCustomerId,
  successUrl,
  cancelUrl,
}) {
  const customer = await findOrCreateStripeCustomer({
    existingId: existingCustomerId,
    email,
    name: fullName,
    metadata: {
      supabase_user_id: userId,
      ...(memberProfileId ? { member_profile_id: memberProfileId } : {}),
    },
  });

  const session = await stripe.post('/checkout/sessions', {
    params: {
      mode: 'setup',
      customer: customer.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ['card'],
      metadata: {
        checkout_kind: CHECKOUT_KIND_SETUP,
        user_id: userId,
        ...(memberProfileId ? { member_profile_id: memberProfileId } : {}),
      },
      setup_intent_data: {
        metadata: {
          checkout_kind: CHECKOUT_KIND_SETUP,
          user_id: userId,
          ...(memberProfileId ? { member_profile_id: memberProfileId } : {}),
        },
      },
    },
    idempotencyKey: stripeIdempotencyKey('setup', `${userId}_${Date.now()}`),
  });

  return { session, customerId: customer.id };
}

// Full or partial refund of a paid ticket order. Amount in minor units.
// `orderId` seeds an idempotency key so a retried refund click never
// results in two refunds for the same order.
export async function refundTicketOrder({ chargeId, paymentIntentId, amountCents, orderId, reason }) {
  if (!chargeId && !paymentIntentId) {
    throw new Error('refundTicketOrder requires chargeId or paymentIntentId');
  }
  const params = {};
  if (chargeId) params.charge = chargeId;
  else params.payment_intent = paymentIntentId;
  if (amountCents !== undefined && amountCents !== null) {
    params.amount = String(amountCents);
  }
  if (reason) params.reason = reason; // 'duplicate' | 'fraudulent' | 'requested_by_customer'
  params.metadata = { order_id: orderId };

  return stripe.post('/refunds', {
    params,
    idempotencyKey: stripeIdempotencyKey('refund', `${orderId}_${amountCents ?? 'full'}`),
  });
}

// Convenience: fetch a Checkout Session by id (used by the webhook when the
// event payload doesn't already include what we need).
export async function retrieveCheckoutSession(sessionId, { expand = [] } = {}) {
  const query = {};
  expand.forEach((e, i) => { query[`expand[${i}]`] = e; });
  return stripe.get(`/checkout/sessions/${sessionId}`, { query });
}
