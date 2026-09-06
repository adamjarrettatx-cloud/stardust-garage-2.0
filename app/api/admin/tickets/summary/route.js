import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// GET /api/admin/tickets/summary?event_id=...
// Roll-up numbers for an event's dashboard: gross, refunded, net, ticket
// counts by status, checkin counts. All money in cents.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [orders, tickets, checkins, products] = await Promise.all([
    supabaseAdmin.from('orders').select('status, total_cents, refunded_cents').eq('event_id', eventId),
    supabaseAdmin.from('tickets').select('status').eq('event_id', eventId),
    supabaseAdmin.from('ticket_checkins').select('result').eq('event_id', eventId),
    supabaseAdmin.from('ticket_products').select('id, name, total_inventory, sold_count, held_count').eq('event_id', eventId),
  ]);

  const grossCents = (orders.data || []).filter((o) => ['paid', 'refunded', 'partial_refund'].includes(o.status)).reduce((s, o) => s + (o.total_cents || 0), 0);
  const refundedCents = (orders.data || []).reduce((s, o) => s + (o.refunded_cents || 0), 0);
  const netCents = grossCents - refundedCents;
  const orderStatusCounts = {};
  for (const o of orders.data || []) orderStatusCounts[o.status] = (orderStatusCounts[o.status] || 0) + 1;

  const ticketStatusCounts = {};
  for (const t of tickets.data || []) ticketStatusCounts[t.status] = (ticketStatusCounts[t.status] || 0) + 1;

  const scanCounts = {};
  for (const c of checkins.data || []) scanCounts[c.result] = (scanCounts[c.result] || 0) + 1;

  return NextResponse.json({
    money: { gross_cents: grossCents, refunded_cents: refundedCents, net_cents: netCents, currency: 'usd' },
    orders: orderStatusCounts,
    tickets: ticketStatusCounts,
    scans: scanCounts,
    products: products.data || [],
  });
}
