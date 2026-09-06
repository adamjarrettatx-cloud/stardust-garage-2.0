import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// GET /api/wallet/orders
// Returns the caller's ticket purchase history: paid orders + their tickets
// + basic event info. Reads via the RLS-scoped anon client so members only
// ever see their own rows (email or user_id match).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Match by user_id OR buyer_email (mirrors RLS + covers pre-signup buys).
  const emailLc = (user.email || '').toLowerCase();
  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, event_id, buyer_email, status, subtotal_cents, total_cents, refunded_cents, currency, paid_at, created_at')
    .or(`user_id.eq.${user.id}${emailLc ? `,buyer_email.eq.${emailLc}` : ''}`)
    .in('status', ['paid', 'refunded', 'partial_refund'])
    .order('created_at', { ascending: false })
    .limit(100);

  const orderIds = (orders || []).map((o) => o.id);
  const eventIds = [...new Set((orders || []).map((o) => o.event_id))];

  const [items, tickets, events] = await Promise.all([
    orderIds.length
      ? supabaseAdmin
          .from('order_items')
          .select('id, order_id, product_name_snapshot, tier_name_snapshot, quantity, unit_price_cents')
          .in('order_id', orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabaseAdmin
          .from('tickets')
          .select('id, order_id, ticket_code, status')
          .in('order_id', orderIds)
      : Promise.resolve({ data: [] }),
    eventIds.length
      ? supabaseAdmin
          .from('events')
          .select('id, title, slug, event_date, start_time')
          .in('id', eventIds)
      : Promise.resolve({ data: [] }),
  ]);

  const itemsByOrder = new Map();
  for (const i of items.data || []) {
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []);
    itemsByOrder.get(i.order_id).push(i);
  }
  const ticketsByOrder = new Map();
  for (const t of tickets.data || []) {
    if (!ticketsByOrder.has(t.order_id)) ticketsByOrder.set(t.order_id, []);
    ticketsByOrder.get(t.order_id).push(t);
  }
  const eventById = new Map((events.data || []).map((e) => [e.id, e]));

  return NextResponse.json({
    orders: (orders || []).map((o) => ({
      ...o,
      event: eventById.get(o.event_id) || null,
      items: itemsByOrder.get(o.id) || [],
      tickets: ticketsByOrder.get(o.id) || [],
    })),
  });
}
