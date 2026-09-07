import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { requireAdmin } from '@/lib/auth-helpers';
import {
  selectActiveTier,
  isProductOnSale,
  projectTiersForBuyer,
  bookingFeeForTier,
  TEXAS_SALES_TAX_RATE_BPS,
} from '@/lib/tickets/pricing';

// GET /api/tickets/availability?event_id=<uuid>&codes=CODE1,CODE2
//
// Public, read-only endpoint that returns the products, active price tier,
// booking fee, and coarse availability for an event on internal ticketing.
//
// `codes` (optional): comma-separated access codes the buyer has entered.
// They unlock any tier whose status='access_code' with a matching code.
//
// Anon-safe: no capacity numbers, hold ids, or admin fields leak.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) {
    return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('event_id');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });
  }
  const unlockedCodes = (searchParams.get('codes') || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  // Admin-only preview mode. When ?preview=1 is present and the caller is a
  // team_members admin, we skip the 'status must be published' check so the
  // Edit Event PREVIEW button can render the buyer widget against a draft.
  // Non-admins requesting preview=1 get the same 404 as an unpublished event —
  // no information leak. The /api/tickets/hold route stays strict (drafts
  // always rejected), so preview can never turn into an actual purchase.
  const previewRequested = searchParams.get('preview') === '1';
  let previewAuthorized = false;
  if (previewRequested) {
    const { unauthorized } = await requireAdmin();
    previewAuthorized = !unauthorized;
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: event, error: eventErr } = await supabaseAdmin
    .from('events')
    .select('id, title, status, ticketing_mode, booking_fee_cents_default')
    .eq('id', eventId)
    .maybeSingle();
  if (eventErr) return NextResponse.json({ error: 'Event lookup failed' }, { status: 500 });
  if (!event || event.ticketing_mode !== 'internal') {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (event.status !== 'published' && !previewAuthorized) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const { data: products } = await supabaseAdmin
    .from('ticket_products')
    .select('id, name, description, kind, min_per_order, max_per_order, member_only, sales_start_at, sales_end_at, display_order, is_active, tier_reveal_threshold')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  const productIds = (products || []).map((p) => p.id);
  const [{ data: tiers }, { data: inv }] = await Promise.all([
    productIds.length
      ? supabaseAdmin
          .from('ticket_price_tiers')
          .select('id, product_id, name, price_cents, currency, starts_at, ends_at, display_order, is_active, status, access_codes, booking_fee_cents_override, quantity, sold_count, reserved_count')
          .in('product_id', productIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabaseAdmin
          .from('ticket_inventory')
          .select('product_id, capacity, sold, reserved')
          .in('product_id', productIds)
      : Promise.resolve({ data: [] }),
  ]);

  const tiersByProduct = new Map();
  for (const t of tiers || []) {
    if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
    tiersByProduct.get(t.product_id).push(t);
  }
  const invByProduct = new Map((inv || []).map((r) => [r.product_id, r]));
  const now = new Date();

  const items = (products || []).map((p) => {
    const productTiers = tiersByProduct.get(p.id) || [];
    const invRow = invByProduct.get(p.id);
    const remaining = invRow ? invRow.capacity - invRow.sold - invRow.reserved : null;

    const activeTier = selectActiveTier(productTiers, { now, unlockedCodes });
    const revealed = projectTiersForBuyer(productTiers, {
      now,
      unlockedCodes,
      remainingInventory: remaining,
      revealThreshold: p.tier_reveal_threshold,
    });

    let availability = 'available';
    if (remaining !== null) {
      if (remaining <= 0) availability = 'sold_out';
      else if (remaining < 10) availability = 'limited';
    }

    // If the selected active tier itself is marked sold_out on status,
    // reflect that even if inventory says otherwise.
    if (activeTier && activeTier.status === 'sold_out') availability = 'sold_out';

    // If no active tier exists but there are hidden or code-gated tiers, the
    // product is "coming soon" (or code-gated).
    const hasAnyVisible = revealed.some((t) => t.visible);
    let onSale = isProductOnSale(p, now) && !!activeTier;
    if (activeTier && activeTier.status === 'sold_out') onSale = false;

    return {
      product_id: p.id,
      kind: p.kind || 'tickets',
      name: p.name,
      description: p.description,
      member_only: p.member_only,
      min_per_order: p.min_per_order,
      max_per_order: p.max_per_order,
      on_sale: onSale,
      availability,
      any_visible: hasAnyVisible,
      price: activeTier
        ? {
            cents: activeTier.price_cents,
            currency: activeTier.currency,
            tier_name: activeTier.name,
            tier_status: activeTier.status || 'active',
            booking_fee_cents: bookingFeeForTier({ tier: activeTier, event }),
          }
        : null,
      // Buyer-safe projection of every visible tier (current + revealed
      // future tiers). Hidden and locked access-code tiers are filtered out.
      tiers: revealed
        .filter((t) => t.visible)
        .map((t) => {
          const qty = typeof t.quantity === 'number' ? t.quantity : null;
          const remainingTier = qty === null
            ? null
            : Math.max(0, qty - (t.sold_count || 0) - (t.reserved_count || 0));
          return {
            id: t.id,
            name: t.name,
            price_cents: t.price_cents,
            currency: t.currency,
            status: t.status || 'active',
            buyable: t.buyable && (remainingTier === null || remainingTier > 0),
            reveal_gated: t.reveal_gated,
            quantity: qty,
            remaining: remainingTier,
          };
        }),
    };
  });

  return NextResponse.json({
    event: {
      id: event.id,
      title: event.title,
      booking_fee_cents_default: event.booking_fee_cents_default,
    },
    // Buyer widget uses this to render the "Sales tax (8.25%)" line before
    // the buyer commits to checkout. Exposed as bps so the client doesn't
    // hardcode the rate.
    tax_rate_bps: TEXAS_SALES_TAX_RATE_BPS,
    products: items,
  });
}
