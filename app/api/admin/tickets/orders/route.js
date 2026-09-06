import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// GET /api/admin/tickets/orders?event_id=...&status=paid&search=...
// Lists internal-ticketing orders for an event with basic filters. Admin only.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let q = supabaseAdmin
    .from('orders')
    .select('id, buyer_email, buyer_name, status, subtotal_cents, total_cents, refunded_cents, currency, paid_at, created_at, stripe_payment_intent_id')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('buyer_email', `%${search}%`);

  const { data: orders } = await q;
  const orderIds = (orders || []).map((o) => o.id);

  const [items, tickets] = await Promise.all([
    orderIds.length
      ? supabaseAdmin.from('order_items').select('*').in('order_id', orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabaseAdmin.from('tickets').select('id, order_id, ticket_code, status').in('order_id', orderIds)
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

  return NextResponse.json({
    orders: (orders || []).map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) || [],
      tickets: ticketsByOrder.get(o.id) || [],
    })),
  });
}
