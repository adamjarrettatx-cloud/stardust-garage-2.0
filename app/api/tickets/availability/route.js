import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { selectActiveTier, isProductOnSale } from '@/lib/tickets/pricing';

// GET /api/tickets/availability?event_id=<uuid>
//
// Public, read-only endpoint that returns the products, active price tier,
// and coarse availability for an event running on internal ticketing. Uses
// the service-role client to read past RLS because the public view
// (ticket_product_availability) hides raw sold/reserved counts and we want
// to reuse a single source of truth for the JSON shape.
//
// Anon-safe: returns only display fields; never returns capacity numbers,
// hold ids, or admin fields.
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

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: event, error: eventErr } = await supabaseAdmin
    .from('events')
    .select('id, title, status, ticketing_mode')
    .eq('id', eventId)
    .maybeSingle();
  if (eventErr) return NextResponse.json({ error: 'Event lookup failed' }, { status: 500 });
  if (!event || event.status !== 'published' || event.ticketing_mode !== 'internal') {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const { data: products } = await supabaseAdmin
    .from('ticket_products')
    .select('id, name, description, min_per_order, max_per_order, member_only, sales_start_at, sales_end_at, display_order, is_active')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  const productIds = (products || []).map((p) => p.id);
  const [{ data: tiers }, { data: inv }] = await Promise.all([
    productIds.length
      ? supabaseAdmin
          .from('ticket_price_tiers')
          .select('id, product_id, name, price_cents, currency, starts_at, ends_at, display_order, is_active')
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
    const activeTier = selectActiveTier(tiersByProduct.get(p.id) || [], { now });
    const invRow = invByProduct.get(p.id);
    const remaining = invRow ? invRow.capacity - invRow.sold - invRow.reserved : 0;
    let availability = 'available';
    if (!invRow || remaining <= 0) availability = 'sold_out';
    else if (remaining < 10) availability = 'limited';
    return {
      product_id: p.id,
      name: p.name,
      description: p.description,
      member_only: p.member_only,
      min_per_order: p.min_per_order,
      max_per_order: p.max_per_order,
      on_sale: isProductOnSale(p, now),
      availability,
      price: activeTier
        ? { cents: activeTier.price_cents, currency: activeTier.currency, tier_name: activeTier.name }
        : null,
    };
  });

  return NextResponse.json({
    event: { id: event.id, title: event.title },
    products: items,
  });
}
