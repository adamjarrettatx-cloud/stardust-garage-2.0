import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { selectActiveTier, isProductOnSale, computeHoldSnapshot } from '@/lib/tickets/pricing';
import { generateHoldToken } from '@/lib/tickets/codes';
import { createTicketCheckoutSession } from '@/lib/tickets/stripe';
import { findOrCreateStripeCustomer } from '@/lib/stripe/client';

// POST /api/tickets/hold
// Body: {
//   event_id: uuid,
//   selections: [{ product_id: uuid, quantity: int }],
//   buyer_email?: string,          // required for guest checkout
//   access_codes?: string[],       // unlock access-code tiers
//   discount_code?: string          // optional promo code
// }
//
// Server flow:
//   1. Rate-limit by IP + validate flag.
//   2. Resolve caller (member session or guest).
//   3. Load products + tiers + optional discount code, verify on-sale,
//      price authoritatively (adds per-ticket booking fee, applies
//      discount to subtotal).
//   4. Reserve inventory via create_ticket_hold() RPC.
//   5. Create a Stripe Checkout Session with hold_id in metadata.
//   6. Stamp session id back on the hold and return { checkout_url }.
//
// Every price the client sends is IGNORED. The server recomputes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOLD_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Distribute a total discount proportionally across an array of items,
// mutating unit_price_cents so Stripe sees the discounted price. Handles
// integer rounding by giving the remainder to the last item so the
// pennies always add up. Never allows a unit price below zero.
function applyDiscountToLines(items, totalDiscountCents) {
  if (!totalDiscountCents || totalDiscountCents <= 0) return items;
  const eligibleSubtotal = items.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);
  if (eligibleSubtotal <= 0) return items;

  let allocated = 0;
  const out = items.map((line, idx) => {
    const lineSubtotal = line.unit_price_cents * line.quantity;
    let lineDiscount;
    if (idx === items.length - 1) {
      lineDiscount = totalDiscountCents - allocated; // remainder
    } else {
      lineDiscount = Math.floor((lineSubtotal * totalDiscountCents) / eligibleSubtotal);
    }
    allocated += lineDiscount;
    const discountedSubtotal = Math.max(0, lineSubtotal - lineDiscount);
    const perUnit = Math.floor(discountedSubtotal / line.quantity);
    return { ...line, unit_price_cents: perUnit };
  });
  return out;
}

export async function POST(request) {
  if (!isInternalTicketingEnabled()) {
    return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  }
  const rl = rateLimit({
    key: keyFromRequest(request, 'tickets_hold'),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const eventId = body?.event_id;
  const selections = Array.isArray(body?.selections) ? body.selections : [];
  const buyerEmailInput = typeof body?.buyer_email === 'string' ? body.buyer_email.trim().toLowerCase() : null;
  const unlockedCodes = Array.isArray(body?.access_codes) ? body.access_codes.map(String) : [];
  const discountCodeInput = typeof body?.discount_code === 'string'
    ? body.discount_code.trim().toUpperCase()
    : null;

  if (!eventId || !selections.length) {
    return NextResponse.json({ error: 'Missing event_id or selections' }, { status: 400 });
  }

  const user = await getRequestUser(request); // may be null for guests

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // --- Load event and gate on ticketing_mode + published ------------------
  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, title, status, ticketing_mode, booking_fee_cents_default')
    .eq('id', eventId)
    .maybeSingle();
  if (!event || event.status !== 'published' || event.ticketing_mode !== 'internal') {
    return NextResponse.json({ error: 'Event not available for purchase' }, { status: 404 });
  }

  // --- Resolve buyer email (member session wins) --------------------------
  let memberProfile = null;
  let buyerEmail = null;
  if (user) {
    const { data } = await supabaseAdmin
      .from('member_profiles')
      .select('id, email, full_name, stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    memberProfile = data;
    buyerEmail = (user.email || memberProfile?.email || '').toLowerCase();
  } else {
    buyerEmail = buyerEmailInput;
  }
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return NextResponse.json({ error: 'A valid email is required for guest checkout' }, { status: 400 });
  }

  // --- Load products + tiers ---------------------------------------------
  const productIds = [...new Set(selections.map((s) => s.product_id).filter(Boolean))];
  if (!productIds.length) return NextResponse.json({ error: 'No products selected' }, { status: 400 });

  const { data: products } = await supabaseAdmin
    .from('ticket_products')
    .select('*')
    .eq('event_id', eventId)
    .in('id', productIds);
  if (!products || products.length !== productIds.length) {
    return NextResponse.json({ error: 'One or more products are unavailable' }, { status: 400 });
  }

  const now = new Date();
  for (const p of products) {
    if (!isProductOnSale(p, now)) {
      return NextResponse.json({ error: `Product not on sale: ${p.name}` }, { status: 400 });
    }
    if (p.member_only && !memberProfile) {
      return NextResponse.json({ error: `Members only: ${p.name}` }, { status: 403 });
    }
  }

  const { data: tiers } = await supabaseAdmin
    .from('ticket_price_tiers')
    .select('*')
    .in('product_id', productIds);
  const tiersByProduct = new Map();
  for (const t of tiers || []) {
    if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
    tiersByProduct.get(t.product_id).push(t);
  }
  const activeTierByProduct = new Map();
  for (const pid of productIds) {
    const tier = selectActiveTier(tiersByProduct.get(pid) || [], { now, unlockedCodes });
    if (tier) activeTierByProduct.set(pid, tier);
  }

  const productsById = new Map(products.map((p) => [p.id, p]));

  // --- Optional discount code lookup --------------------------------------
  let discountCode = null;
  if (discountCodeInput) {
    const { data: dc } = await supabaseAdmin
      .from('ticket_discount_codes')
      .select('*')
      .eq('event_id', eventId)
      .eq('code', discountCodeInput)
      .eq('is_active', true)
      .maybeSingle();
    if (!dc) {
      return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 });
    }
    discountCode = dc;
  }

  // --- Compute the authoritative snapshot ---------------------------------
  let snapshot;
  try {
    snapshot = computeHoldSnapshot({
      selections,
      productsById,
      activeTierByProduct,
      event,
      discountCode,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid selection' }, { status: 400 });
  }

  // --- Increment discount redemption BEFORE reserving inventory so we
  //     can back it out if the hold fails. Atomic RPC guards against races
  //     and max-redemptions overflow. --------------------------------------
  if (discountCode) {
    const { error: incErr } = await supabaseAdmin.rpc('increment_discount_code_redemption', {
      p_code_id: discountCode.id,
    });
    if (incErr) {
      const msg = String(incErr.message || '');
      if (msg.includes('DISCOUNT_CODE_UNAVAILABLE')) {
        return NextResponse.json({ error: 'Discount code no longer available' }, { status: 409 });
      }
      console.error('discount redemption failed:', incErr);
      return NextResponse.json({ error: 'Could not apply discount code' }, { status: 500 });
    }
  }

  // --- Reserve inventory + create hold via RPC ---------------------------
  const holdToken = generateHoldToken();
  const expiresAt = new Date(Date.now() + HOLD_TTL_MS);

  const { data: holdId, error: holdErr } = await supabaseAdmin.rpc('create_ticket_hold', {
    p_event_id: eventId,
    p_hold_token: holdToken,
    p_items: snapshot.items,
    p_quantity_total: snapshot.quantityTotal,
    p_subtotal_cents: snapshot.totalCents, // hold subtotal = what the buyer pays
    p_currency: snapshot.currency,
    p_user_id: user?.id || null,
    p_member_profile_id: memberProfile?.id || null,
    p_buyer_email: buyerEmail,
    p_expires_at: expiresAt.toISOString(),
  });

  if (holdErr) {
    // Roll back the discount redemption on inventory failure.
    if (discountCode) {
      await supabaseAdmin
        .from('ticket_discount_codes')
        .update({ redemptions_count: discountCode.redemptions_count })
        .eq('id', discountCode.id);
    }
    if (String(holdErr.message || '').includes('INVENTORY_UNAVAILABLE')) {
      return NextResponse.json({ error: 'Not enough tickets available' }, { status: 409 });
    }
    console.error('create_ticket_hold failed:', holdErr);
    return NextResponse.json({ error: 'Could not reserve tickets' }, { status: 500 });
  }

  // Re-load the hold so we can pass a full row to the Stripe helper.
  const { data: hold } = await supabaseAdmin
    .from('ticket_holds')
    .select('*')
    .eq('id', holdId)
    .single();

  // --- Ensure the buyer has a Stripe customer (members only) --------------
  let customerId = memberProfile?.stripe_customer_id || null;
  if (memberProfile && !customerId) {
    try {
      const customer = await findOrCreateStripeCustomer({
        email: buyerEmail,
        name: memberProfile.full_name,
        metadata: {
          supabase_user_id: user.id,
          member_profile_id: memberProfile.id,
        },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('member_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', memberProfile.id);
    } catch (err) {
      console.error('Stripe customer create failed:', err);
      // Continue as guest with just email — non-fatal.
    }
  }

  // --- Build product line descriptors + create Checkout Session -----------
  //
  // Fold the discount into per-line unit prices proportionally, then add a
  // separate "Booking fee" line item so buyers see the fee broken out. Total
  // ends up equal to snapshot.totalCents.
  const discountedItems = applyDiscountToLines(snapshot.items, snapshot.discountCents || 0);
  const productLineDescriptors = discountedItems.map((line) => {
    const product = productsById.get(line.product_id);
    const productKind = product.kind || 'tickets';
    // Prefix private-space line items so the Stripe dashboard reads clearly
    // (e.g. "Rental — Outer Space Green Room" vs plain "Early Bird").
    const displayName = productKind === 'private_space' ? `Rental — ${product.name}` : product.name;
    return {
      name: displayName,
      unit_price_cents: line.unit_price_cents,
      quantity: line.quantity,
      kind: productKind,
    };
  });
  if (snapshot.bookingFeeCents > 0) {
    productLineDescriptors.push({
      name: 'Booking fee',
      unit_price_cents: snapshot.bookingFeeCents,
      quantity: 1,
      kind: 'fee',
    });
  }

  const origin = resolveSiteUrl(request);
  const successUrl = `${origin}/tickets/status?hold=${hold.hold_token}`;
  const cancelUrl = `${origin}/tickets/status?hold=${hold.hold_token}&cancelled=1`;

  let session;
  try {
    session = await createTicketCheckoutSession({
      hold,
      event,
      lineDescriptors: productLineDescriptors,
      successUrl,
      cancelUrl,
      customerId,
      buyerEmail,
      request,
    });
  } catch (err) {
    console.error('Ticket checkout session create failed:', err);
    await supabaseAdmin.rpc('release_ticket_hold', { p_hold_id: hold.id }).catch(() => {});
    if (discountCode) {
      await supabaseAdmin
        .from('ticket_discount_codes')
        .update({ redemptions_count: discountCode.redemptions_count })
        .eq('id', discountCode.id);
    }
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 });
  }

  await supabaseAdmin
    .from('ticket_holds')
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent || null,
    })
    .eq('id', hold.id);

  return NextResponse.json({
    checkout_url: session.url,
    hold_id: hold.id,
    hold_token: hold.hold_token,
    expires_at: hold.expires_at,
    totals: {
      subtotal_cents: snapshot.subtotalCents,
      discount_cents: snapshot.discountCents,
      booking_fee_cents: snapshot.bookingFeeCents,
      total_cents: snapshot.totalCents,
      currency: snapshot.currency,
    },
  });
}
