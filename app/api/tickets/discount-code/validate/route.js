import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { applyDiscountCode } from '@/lib/tickets/pricing';

// POST /api/tickets/discount-code/validate
// Body: {
//   event_id: uuid,
//   code: string,
//   items: [{ product_id, unit_price_cents, quantity }]
// }
//
// Returns { code, discount_cents, discount_type, discount_value } or an error.
// Read-only — does NOT increment the redemption counter.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isInternalTicketingEnabled()) {
    return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  }
  const rl = rateLimit({ key: keyFromRequest(request, 'discount_validate'), limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const eventId = body?.event_id;
  const rawCode = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  const items = Array.isArray(body?.items) ? body.items : [];
  // Booking fee total for the current cart. Only material for target_total
  // codes; percent/amount codes ignore it. Optional to preserve callers.
  const bookingFeeCents = Math.max(0, Number(body?.booking_fee_cents) || 0);

  if (!eventId || !rawCode || !items.length) {
    return NextResponse.json({ error: 'Missing event_id, code, or items' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: code } = await supabaseAdmin
    .from('ticket_discount_codes')
    .select('*')
    .eq('event_id', eventId)
    .eq('code', rawCode)
    .eq('is_active', true)
    .maybeSingle();

  if (!code) return NextResponse.json({ error: 'Invalid or inactive code' }, { status: 400 });

  try {
    const { discountCents } = applyDiscountCode({
      code,
      items,
      productsById: new Map(),
      bookingFeeCents,
    });
    return NextResponse.json({
      code: code.code,
      discount_cents: discountCents,
      discount_type: code.discount_type,
      discount_value: code.discount_value,
    });
  } catch (err) {
    const msg = err.message || 'Invalid';
    const map = {
      DISCOUNT_INVALID: 'Invalid code',
      DISCOUNT_NOT_YET_ACTIVE: 'Code not active yet',
      DISCOUNT_EXPIRED: 'Code expired',
      DISCOUNT_EXHAUSTED: 'Code out of uses',
      DISCOUNT_NOT_APPLICABLE: 'Code does not apply to selected tickets',
    };
    return NextResponse.json({ error: map[msg] || msg }, { status: 400 });
  }
}
