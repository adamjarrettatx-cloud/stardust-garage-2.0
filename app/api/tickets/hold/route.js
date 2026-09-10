import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { selectActiveTier, isProductOnSale, computeHoldSnapshot } from '@/lib/tickets/pricing';
import { resolveBuyerEntitlement } from '@/lib/tickets/entitlement-lookup';
import { resolveEntitlementPercent, entitlementLabel } from '@/lib/tickets/entitlement';
import { generateHoldToken } from '@/lib/tickets/codes';
import { createTicketCheckoutSession } from '@/lib/tickets/stripe';
import { findOrCreateStripeCustomer } from '@/lib/stripe/client';
import { validateAcceptancePayload, recordWaiverAcceptance, evidenceFromRequest }
  from '@/lib/waiver/accept';
import { memberSatisfiesTierGate, membershipTierLabel } from '@/lib/membership-tiers';
import { resolveWaiverGateEnabled } from '@/lib/waiver-gate';
import { UNLISTED_VISIBILITY } from '@/lib/event-visibility';

// Waiver gate — fails CLOSED in production. See lib/waiver-gate.js for
// the full policy + why. Resolved at module load so a request can never
// mutate the gate mid-flight.
const WAIVER_GATE_ENABLED = resolveWaiverGateEnabled();

// POST /api/tickets/hold
// Body: {
//   event_id: uuid,
//   selections: [{ product_id: uuid, quantity: int }],
//   access_codes?: string[],       // unlock access-code tiers
//   discount_code?: string          // optional promo code
// }
//
// Auth: A Stardust-account session is REQUIRED. Anonymous callers get a
// hard 401. The account gate lives in the InternalTicketModal wrapper —
// this endpoint is the second line of defence so an unauthenticated call
// (e.g. a curl'd hold request) never creates an order.
//
// Server flow:
//   1. Rate-limit by IP + validate flag.
//   2. Resolve caller — 401 if none.
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
  const shareToken = body?.share_token || null;
  const selections = Array.isArray(body?.selections) ? body.selections : [];
  const unlockedCodes = Array.isArray(body?.access_codes) ? body.access_codes.map(String) : [];
  const discountCodeInput = typeof body?.discount_code === 'string'
    ? body.discount_code.trim().toUpperCase()
    : null;
  const waiverEnvelope = body?.waiver ?? null;

  // --- Waiver gate --------------------------------------------------------
  // Validate BEFORE touching inventory or Stripe. If the flag is off and
  // no envelope was sent, skip — during rollout only. Once flipped on,
  // every hold must carry a fresh acceptance for the currently-active
  // waiver version.
  if (WAIVER_GATE_ENABLED || waiverEnvelope) {
    try {
      validateAcceptancePayload(waiverEnvelope, 'ticket');
    } catch (e) {
      return NextResponse.json(
        { error: e.code || 'WAIVER_INVALID', expected: e.expected },
        { status: e.status || 400 },
      );
    }
  }

  if (!eventId || !selections.length) {
    return NextResponse.json({ error: 'Missing event_id or selections' }, { status: 400 });
  }

  // Stardust-account gate. Anonymous purchases were removed when the account
  // gate shipped — every hold now belongs to a real auth.users id so the
  // ticket wallet, refunds, and door lookups all resolve to a single identity.
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in required to purchase tickets.' },
      { status: 401 },
    );
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // --- Load event and gate on ticketing_mode + published ------------------
  const { data: event } = await supabaseAdmin
    .from('events')
    // The member-pricing columns and the weekend-music flag are part of this
    // select because resolveEntitlementPercent() reads them off this row. Left
    // out, every buyer silently resolves to 0% off and the feature is inert.
    .select(
      'id, title, status, visibility, share_token, ticketing_mode, ' +
      'booking_fee_cents_default, required_membership_tier, ' +
      'is_weekend_music_experience, member_discount_percent_trial, ' +
      'member_discount_percent_weekender, member_discount_percent_cowork, ' +
      'member_discount_percent_iykyk'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!event || event.status !== 'published' || event.ticketing_mode !== 'internal') {
    return NextResponse.json({ error: 'Event not available for purchase' }, { status: 404 });
  }
  if (event.visibility === UNLISTED_VISIBILITY) {
    if (!shareToken) {
      return NextResponse.json({ error: 'Share token required for unlisted event' }, { status: 403 });
    }
    if (event.share_token !== shareToken) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 403 });
    }
  }

  // --- Resolve buyer email from the authenticated identity ---------------
  // Members carry a member_profiles row with a curated email that may differ
  // from the auth.users email (e.g. they applied with one address then
  // switched login providers). For non-members, the auth.users email is the
  // only address we have and is the one Stripe + our confirmation email use.
  //
  // subscription_plan + is_active are also loaded here for the SDG-only /
  // tier-gate check below — we need to know if the buyer is an active member
  // and what tier they hold BEFORE reserving inventory or hitting Stripe.
  const { data: memberProfile } = await supabaseAdmin
    .from('member_profiles')
    .select('id, email, full_name, stripe_customer_id, subscription_plan, is_active')
    .eq('user_id', user.id)
    .maybeSingle();

  // --- Access gate: required_membership_tier only -------------------------
  // is_sdg_only is NOT an access gate — it just means SDG is producing the
  // event without an outside partner. Public SDG-produced events
  // (is_sdg_only=true, visibility='public', no tier gate) must remain
  // buyable by guests / free accounts / non-members. That's the whole point
  // of putting ticketed shows on the site.
  //
  // required_membership_tier IS an access gate. When set, only members of
  // that tier or higher can buy (Insider > Builder > Weekender). Team
  // members bypass so they can test-purchase or self-comp.
  if (event.required_membership_tier) {
    // Team members bypass the tier gate.
    const { data: teamMember } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!teamMember) {
      const isActiveMember = memberProfile?.is_active === true;
      const memberTier = isActiveMember ? memberProfile.subscription_plan : null;
      if (!memberSatisfiesTierGate(memberTier, event.required_membership_tier)) {
        return NextResponse.json(
          {
            error: `This event is reserved for ${membershipTierLabel(event.required_membership_tier)} members. Visit /members to join or upgrade.`,
          },
          { status: 403 }
        );
      }
    }
  }

  const buyerEmail = (user.email || memberProfile?.email || '').toLowerCase();
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return NextResponse.json({ error: 'Your account has no email on file — contact the front desk.' }, { status: 400 });
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

  // SECURITY (H-03): `member_only` must require an ACTIVE member (or a
  // team member for test-purchase / self-comp — same bypass we grant the
  // tier gate above). Historically it accepted any row in member_profiles,
  // including inactive / lapsed accounts, so a cancelled member could
  // still buy Insider-only tickets.
  const hasMemberOnlyProduct = products.some((p) => p.member_only);
  let teamMemberForMemberOnly = null;
  if (hasMemberOnlyProduct) {
    const { data: teamRow } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    teamMemberForMemberOnly = teamRow || null;
  }
  const isActiveMemberForGate = memberProfile?.is_active === true;

  for (const p of products) {
    if (!isProductOnSale(p, now)) {
      return NextResponse.json({ error: `Product not on sale: ${p.name}` }, { status: 400 });
    }
    if (p.member_only && !isActiveMemberForGate && !teamMemberForMemberOnly) {
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

  // --- Resolve the buyer's automatic entitlement --------------------------
  // An active member tier or a live Trial SDG Pass earns a price without the
  // buyer holding a code. Resolved server-side and never accepted from the
  // request body: the client may not name its own discount. memberProfile is
  // passed through because it was already loaded above for the access gates.
  let entitlement = null;
  let entitlementPercent = 0;
  try {
    entitlement = await resolveBuyerEntitlement(supabaseAdmin, user.id, { memberProfile });
    entitlementPercent = resolveEntitlementPercent(event, entitlement);
  } catch (err) {
    // Never block a sale on this. Worst case the buyer pays list price, which
    // is recoverable by support; a 500 here loses the sale outright.
    console.error('[tickets.hold.entitlement]', err?.message || err);
    entitlement = null;
    entitlementPercent = 0;
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
      entitlementPercent,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid selection' }, { status: 400 });
  }

  // --- Increment discount redemption BEFORE reserving inventory so we
  //     can back it out if the hold fails. Atomic RPC guards against races
  //     and max-redemptions overflow. --------------------------------------
  // Only burn a redemption if the code is actually what the buyer is paying
  // under. When a bigger entitlement wins, the code did nothing to this order
  // and must stay available for its next use.
  const codeWasApplied = Boolean(discountCode) && snapshot.discountSource === 'code';
  if (codeWasApplied) {
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
    p_user_id: user.id,
    p_member_profile_id: memberProfile?.id || null,
    p_buyer_email: buyerEmail,
    p_expires_at: expiresAt.toISOString(),
  });

  if (holdErr) {
    // Roll back the discount redemption on inventory failure.
    if (codeWasApplied) {
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

  // Stamp the authorization capability before any network call to Stripe.
  // This closes the public -> unlisted transition window even while Checkout
  // Session creation is still in flight.
  const { error: shareTokenErr } = await supabaseAdmin
    .from('ticket_holds')
    .update({ share_token: shareToken })
    .eq('id', holdId);
  if (shareTokenErr) {
    console.error('ticket hold share token update failed:', shareTokenErr);
    await supabaseAdmin.rpc('release_ticket_hold', { p_hold_id: holdId }).catch(() => {});
    // Only roll the counter back if the code was actually the discount that
    // got applied. When an automatic entitlement beat the typed code, its
    // redemption was never incremented, so "restoring" it here would hand out
    // a free extra use of the code.
    if (codeWasApplied) {
      await supabaseAdmin
        .from('ticket_discount_codes')
        .update({ redemptions_count: discountCode.redemptions_count })
        .eq('id', discountCode.id);
    }
    return NextResponse.json({ error: 'Could not secure ticket hold' }, { status: 500 });
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
  // Texas sales tax is broken out as its own Stripe line so buyers see it
  // itemized on the Stripe-hosted checkout, exactly matching our widget.
  if (snapshot.taxCents > 0) {
    productLineDescriptors.push({
      name: `Sales tax (${(snapshot.taxRateBps / 100).toFixed(2)}%)`,
      unit_price_cents: snapshot.taxCents,
      quantity: 1,
      kind: 'tax',
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
    if (codeWasApplied) {
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

  // Persist tax on the hold row so downstream reconciliation (webhook -> order)
  // has an authoritative snapshot. Additive: pre-tax holds default to 0.
  await supabaseAdmin
    .from('ticket_holds')
    .update({ tax_cents: snapshot.taxCents || 0 })
    .eq('id', hold.id);

  // --- Record waiver acceptance scoped to this hold ----------------------
  // Writes AFTER hold + Stripe session are safely in place so a failed
  // acceptance record does not orphan a Stripe URL the user could complete
  // without evidence — we roll back the hold + refuse the checkout instead.
  if (waiverEnvelope) {
    try {
      const ev = evidenceFromRequest(request);
      await recordWaiverAcceptance({
        source: 'internal_ticket',
        payload: waiverEnvelope,
        userId: user.id,
        buyerEmail,
        buyerName: memberProfile?.full_name || null,
        eventId,
        holdId: hold.id,
        ...ev,
      });
    } catch (e) {
      console.error('waiver_record_failed', e);
      // Roll back: release the hold so inventory frees up immediately,
      // and refuse to hand the buyer a Stripe URL.
      await supabaseAdmin.rpc('release_ticket_hold', { p_hold_id: hold.id }).catch(() => {});
      if (codeWasApplied) {
        await supabaseAdmin
          .from('ticket_discount_codes')
          .update({ redemptions_count: discountCode.redemptions_count })
          .eq('id', discountCode.id);
      }
      return NextResponse.json(
        { error: 'WAIVER_RECORD_FAILED' },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    checkout_url: session.url,
    hold_id: hold.id,
    hold_token: hold.hold_token,
    expires_at: hold.expires_at,
    totals: {
      subtotal_cents: snapshot.subtotalCents,
      discount_cents: snapshot.discountCents,
      discount_source: snapshot.discountSource,
      entitlement_percent: snapshot.entitlementPercent,
      entitlement_label: entitlementLabel(entitlement, snapshot.entitlementPercent),
      booking_fee_cents: snapshot.bookingFeeCents,
      tax_cents: snapshot.taxCents,
      tax_rate_bps: snapshot.taxRateBps,
      total_cents: snapshot.totalCents,
      currency: snapshot.currency,
    },
  });
}
