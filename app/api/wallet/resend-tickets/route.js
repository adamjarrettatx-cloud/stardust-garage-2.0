import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit } from '@/lib/rate-limit';
import { sendTicketConfirmation } from '@/lib/email';
import { renderTicketQrPngBuffer } from '@/lib/tickets/qr';
import { fetchEventForEmail } from '@/lib/tickets/fetch-event-for-email';

// POST /api/wallet/resend-tickets  Body: { order_id }
// Re-sends the ticket email for one of the caller's own orders. Guarded by
// ownership check + per-user rate limit (3/min) to keep it from being used
// as a spam vector.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = rateLimit({ key: `wallet_resend:${user.id}`, limit: 3, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const orderId = body?.order_id;
  if (!orderId) return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const emailLc = (user.email || '').toLowerCase();
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, event_id, buyer_email, status, user_id, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const owns = order.user_id === user.id || (emailLc && order.buyer_email?.toLowerCase() === emailLc);
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (order.status !== 'paid') return NextResponse.json({ error: 'Order not paid' }, { status: 400 });

  const [eventCtx, tickets, items] = await Promise.all([
    fetchEventForEmail({ supabaseAdmin, eventId: order.event_id, request }),
    supabaseAdmin.from('tickets').select('id, ticket_code, order_item_id').eq('order_id', order.id),
    supabaseAdmin.from('order_items').select('id, product_name_snapshot, tier_name_snapshot').eq('order_id', order.id),
  ]);

  const itemById = new Map((items.data || []).map((i) => [i.id, i]));
  // Generate PNG QRs in parallel so we don't serialize ~50ms per ticket
  // on multi-ticket orders. Attached inline via CID inside sendTicketConfirmation.
  const ticketRows = await Promise.all(
    (tickets.data || []).map(async (t) => ({
      ticketCode: t.ticket_code,
      productName: itemById.get(t.order_item_id)?.product_name_snapshot || 'Ticket',
      tierName: itemById.get(t.order_item_id)?.tier_name_snapshot || null,
      qrPngBuffer: await renderTicketQrPngBuffer({ ticketCode: t.ticket_code, request }),
      viewUrl: null,
    })),
  );

  await sendTicketConfirmation({
    to: order.buyer_email,
    orderId: order.id,
    orderDate: order.created_at,
    eventTitle: eventCtx.eventTitle,
    eventWhen: eventCtx.eventWhen,
    eventFlyerUrl: eventCtx.eventFlyerUrl,
    venueAddress: eventCtx.venueAddress,
    ticketRows,
    orderUrl: eventCtx.orderUrlBase,
  });

  await supabaseAdmin.from('ticket_audit_log').insert({
    event_id: order.event_id,
    order_id: order.id,
    actor_user_id: user.id,
    actor_role: 'member',
    action: 'order.resend',
    detail: { to: order.buyer_email },
  });

  return NextResponse.json({ ok: true });
}
