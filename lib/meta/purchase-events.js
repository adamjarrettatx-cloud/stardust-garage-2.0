// Server-only. Builds and sends the Purchase (tickets) and Subscribe
// (memberships) Conversions API events from the Stripe webhook.

import { metaAttributionFromMetadata, isMetaServerConfigured } from './attribution.js';
import { buildMetaServerEvent, sendMetaServerEvent } from './capi.js';
import { UNLISTED_VISIBILITY } from '@/lib/event-visibility';

// Called as a webhook followup after a ticket order is finalized. Runs once
// per order (webhook replays return before followups are queued) and uses a
// stable event_id so Meta would de-duplicate any repeat anyway.
export async function sendTicketPurchaseToMeta({ supabaseAdmin, orderId, session }) {
  if (!isMetaServerConfigured()) return { skipped: 'not_configured' };
  const attribution = metaAttributionFromMetadata(session?.metadata);
  if (!attribution) return { skipped: session?.metadata?.meta_optout || 'no_consent_metadata' };

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, buyer_email, user_id, event_id, total_cents, currency, paid_at, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || !(order.total_cents > 0)) return { skipped: 'no_paid_total' };

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, title, visibility')
    .eq('id', order.event_id)
    .maybeSingle();
  if (!event || event.visibility === UNLISTED_VISIBILITY) return { skipped: 'unlisted_or_missing_event' };

  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('quantity')
    .eq('order_id', order.id);
  const numItems = (items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  const paidAt = Date.parse(order.paid_at || order.created_at || '') || Date.now();
  const metaEvent = buildMetaServerEvent({
    eventName: 'Purchase',
    eventId: `ticket_order_${order.id}`,
    eventTime: Math.floor(paidAt / 1000),
    attribution,
    email: order.buyer_email,
    externalId: order.user_id,
    value: order.total_cents / 100,
    currency: order.currency || 'usd',
    contentIds: [event.id],
    contentName: event.title,
    contentType: 'product',
    numItems: numItems || undefined,
  });
  return sendMetaServerEvent(metaEvent);
}

// Called from the subscription branch of the webhook on the initial
// checkout.session.completed for a membership.
export async function sendMembershipSubscribeToMeta({ session }) {
  if (!isMetaServerConfigured()) return { skipped: 'not_configured' };
  const attribution = metaAttributionFromMetadata(session?.metadata);
  if (!attribution) return { skipped: session?.metadata?.meta_optout || 'no_consent_metadata' };
  const total = Number(session.amount_total);
  if (!(total > 0)) return { skipped: 'no_paid_total' };

  const plan = session.metadata?.plan || 'membership';
  const period = session.metadata?.period || '';
  const metaEvent = buildMetaServerEvent({
    eventName: 'Subscribe',
    eventId: `membership_checkout_${session.id}`,
    eventTime: Number(session.created) || undefined,
    attribution,
    email: session.customer_details?.email || session.customer_email || null,
    externalId: session.metadata?.supabase_user_id || null,
    value: total / 100,
    currency: session.currency || 'usd',
    contentIds: [`${plan}${period ? `:${period}` : ''}`],
    contentName: 'Stardust Garage membership',
    contentType: 'product',
  });
  return sendMetaServerEvent(metaEvent);
}
