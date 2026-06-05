import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lookupPlanByPriceId } from '@/lib/stripe-prices';
import { getEventSeriesTicketTypes } from '@/lib/tickettailor';
import {
  QUALIFYING_CATEGORIES,
  createCodeForMember,
  getDiscountPercent,
} from '@/lib/discountCodeUtils';

// POST /api/stripe/webhook
//
// Stripe sends events here whenever something changes (subscription created,
// payment succeeded, payment failed, subscription cancelled, etc.).
// We update member_profiles to keep is_active and subscription_status in sync.

// Need raw body to verify the signature, so disable body parsing
export const dynamic = 'force-dynamic';
// TT discount generation uses Node APIs (crypto), so pin to the Node runtime.
export const runtime = 'nodejs';

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Back-fills discount codes for a member who just became active, covering all
// upcoming qualifying events whose 3-day send window hasn't passed yet. Mirrors
// /api/admin/check-new-member-codes but runs inline (no HTTP round-trip).
async function generateCodesForNewMember(memberId, supabaseAdmin) {
  const { data: member, error: memberError } = await supabaseAdmin
    .from('member_profiles')
    .select('id, user_id, full_name, email, is_active, subscription_status')
    .eq('id', memberId)
    .single();
  if (memberError || !member) {
    throw new Error('Member not found for auto code generation: ' + memberId);
  }

  if (!(member.is_active && member.subscription_status === 'active')) {
    return;
  }

  const today = todayDateString();

  const { data: events, error: eventsError } = await supabaseAdmin
    .from('events')
    .select('*')
    .gte('event_date', today)
    .eq('discount_codes_generated', true)
    .in('category', QUALIFYING_CATEGORIES);
  if (eventsError) {
    throw new Error('Failed to load events: ' + eventsError.message);
  }

  for (const event of events || []) {
    if (!event.tt_event_series_id) continue;
    // Skip events whose send window has already passed (3 days before).
    const [y, m, d] = String(event.event_date).split('-').map(Number);
    const sendDt = new Date(Date.UTC(y, m - 1, d));
    sendDt.setUTCDate(sendDt.getUTCDate() - 3);
    const sendStr = sendDt.toISOString().slice(0, 10);
    if (sendStr < today) continue;

    try {
      const ticketTypeIds = await getEventSeriesTicketTypes(event.tt_event_series_id);
      const discountPercent = getDiscountPercent(event.category, event.member_discount_percent);
      await createCodeForMember({
        supabaseAdmin,
        event,
        member,
        ticketTypeIds,
        discountPercent,
      });
    } catch (err) {
      console.error(
        `Auto discount code failed for event ${event.id}:`,
        err?.message || err
      );
    }
  }
}

async function verifyStripeSignature(rawBody, signature, secret) {
  // Stripe sends a header: t=1234567890,v1=abc123signature
  // We compute HMAC-SHA256 of `${timestamp}.${rawBody}` using the secret
  // and compare to v1.
  const parts = signature.split(',');
  let timestamp = null;
  let v1 = null;
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1') v1 = v;
  }
  if (!timestamp || !v1) return false;

  // Use Web Crypto API (available in Edge runtime and Node 18+)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`)
  );

  // Convert to hex
  const hex = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare
  if (hex.length !== v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hex.length; i++) {
    mismatch |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Verify the signature
    const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      console.error('Invalid Stripe webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    console.log('Stripe webhook received:', event.type);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Helper to find member profile by Stripe customer ID
    async function findProfileByCustomer(customerId) {
      const { data } = await supabaseAdmin
        .from('member_profiles')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      return data;
    }

    // Helper to update profile based on Stripe subscription data
    async function syncSubscription(subscription) {
      const profile = await findProfileByCustomer(subscription.customer);
      if (!profile) {
        console.error('No member profile for Stripe customer:', subscription.customer);
        return null;
      }

      // Get price ID from subscription
      const priceId = subscription.items?.data?.[0]?.price?.id;
      const lookup = priceId ? lookupPlanByPriceId(priceId) : null;

      // Map Stripe status to our status
      let status = 'pending';
      let isActive = false;
      switch (subscription.status) {
        case 'active':
        case 'trialing':
          status = 'active';
          isActive = true;
          break;
        case 'past_due':
          status = 'past_due';
          isActive = false;
          break;
        case 'canceled':
        case 'unpaid':
          status = 'cancelled';
          isActive = false;
          break;
        case 'incomplete':
        case 'incomplete_expired':
          status = 'incomplete';
          isActive = false;
          break;
      }

      const updates = {
        stripe_subscription_id: subscription.id,
        subscription_status: status,
        is_active: isActive,
        cancel_at_period_end: subscription.cancel_at_period_end || false,
      };

      if (lookup) {
        updates.subscription_plan = lookup.plan;
        updates.subscription_period = lookup.period;
      }
      if (subscription.current_period_end) {
        updates.current_period_end = new Date(
          subscription.current_period_end * 1000
        ).toISOString();
      }

      await supabaseAdmin
        .from('member_profiles')
        .update(updates)
        .eq('id', profile.id);

      return { profileId: profile.id, isActive };
    }

    // If a member becomes active during this event, we capture their profile id
    // here and kick off discount-code generation after responding to Stripe.
    let activatedMemberId = null;

    // Handle the events we care about
    switch (event.type) {
      case 'checkout.session.completed': {
        // Initial checkout success — the subscription has been created
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          // Fetch the subscription details from Stripe
          const subRes = await fetch(
            `https://api.stripe.com/v1/subscriptions/${session.subscription}`,
            {
              headers: {
                Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              },
            }
          );
          if (subRes.ok) {
            const subscription = await subRes.json();
            const result = await syncSubscription(subscription);
            if (result?.isActive) activatedMemberId = result.profileId;
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const result = await syncSubscription(subscription);
        if (result?.isActive) activatedMemberId = result.profileId;
        break;
      }

      case 'invoice.payment_failed': {
        // Subscription payment failed — mark inactive
        const invoice = event.data.object;
        if (invoice.subscription) {
          const profile = await findProfileByCustomer(invoice.customer);
          if (profile) {
            await supabaseAdmin
              .from('member_profiles')
              .update({
                subscription_status: 'past_due',
                is_active: false,
              })
              .eq('id', profile.id);
          }
        }
        break;
      }

      default:
        // Unhandled event - just acknowledge it
        console.log('Ignoring event type:', event.type);
    }

    // Respond to Stripe immediately; generate codes fire-and-forget so a slow
    // or failing TT call can never make the webhook time out or error.
    const response = NextResponse.json({ received: true });
    if (activatedMemberId) {
      generateCodesForNewMember(activatedMemberId, supabaseAdmin).catch((err) =>
        console.error('Auto discount code error:', err)
      );
    }
    return response;
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json(
      { error: 'Webhook handler failed: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
