import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { generateTicketCode } from '@/lib/tickets/codes';
import { sendTicketConfirmation } from '@/lib/email';
import { renderTicketQrSvg } from '@/lib/tickets/qr';

// POST /api/admin/tickets/comp
// Body: { event_id, product_id, quantity, buyer_email, buyer_name?, send_email? }
//
// Admin-issued comp tickets. Creates a $0 order, uses the same inventory
// column so we still respect capacity, and mints tickets. Does NOT touch
// Stripe. Idempotent via a comp_ref field the caller can pass to dedupe
// double-clicks — the DB unique index on (event_id, comp_ref) makes retries
// safe.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { event_id, product_id, quantity = 1, buyer_email, buyer_name = null, send_email = true, note = null, comp_ref = null } = body || {};
  if (!event_id || !product_id || !buyer_email || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: product } = await supabaseAdmin
    .from('ticket_products')
    .select('id, event_id, name, total_inventory, sold_count, held_count, is_active')
    .eq('id', product_id)
    .maybeSingle();
  if (!product || product.event_id !== event_id || !product.is_active) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  }
  if (typeof product.total_inventory === 'number') {
    const remaining = product.total_inventory - (product.sold_count || 0) - (product.held_count || 0);
    if (remaining < quantity) return NextResponse.json({ error: 'Not enough inventory' }, { status: 409 });
  }

  // Idempotency guard.
  if (comp_ref) {
    const { data: existing } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('event_id', event_id)
      .eq('comp_ref', comp_ref)
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, order_id: existing.id, deduped: true });
  }

  // Create $0 order.
  const orderInsert = await supabaseAdmin.from('orders').insert({
    event_id,
    buyer_email: buyer_email.toLowerCase(),
    buyer_name,
    status: 'paid',
    subtotal_cents: 0,
    total_cents: 0,
    currency: 'usd',
    paid_at: new Date().toISOString(),
    checkout_kind: 'comp',
    comp_ref,
    created_by_user_id: gate.user.id,
  }).select('*').single();
  if (orderInsert.error) return NextResponse.json({ error: orderInsert.error.message }, { status: 500 });
  const order = orderInsert.data;

  const itemInsert = await supabaseAdmin.from('order_items').insert({
    order_id: order.id,
    event_id,
    product_id,
    product_name_snapshot: product.name,
    tier_name_snapshot: 'Comp',
    unit_price_cents: 0,
    quantity,
  }).select('*').single();
  if (itemInsert.error) return NextResponse.json({ error: itemInsert.error.message }, { status: 500 });

  const ticketRows = [];
  for (let seat = 0; seat < quantity; seat++) {
    const code = generateTicketCode();
    const ins = await supabaseAdmin.from('tickets').insert({
      order_id: order.id,
      order_item_id: itemInsert.data.id,
      event_id,
      product_id,
      seat_index: seat,
      ticket_code: code,
      status: 'valid',
    }).select('id, ticket_code, order_item_id').single();
    if (ins.error) {
      // Best-effort rollback: mark order void.
      await supabaseAdmin.from('orders').update({ status: 'void' }).eq('id', order.id);
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
    ticketRows.push(ins.data);
  }

  // Bump sold_count. Re-read to avoid a lost update if another comp landed
  // between our initial read and here.
  const { data: fresh } = await supabaseAdmin
    .from('ticket_products')
    .select('sold_count')
    .eq('id', product_id)
    .single();
  await supabaseAdmin
    .from('ticket_products')
    .update({ sold_count: (fresh?.sold_count || 0) + quantity })
    .eq('id', product_id);

  await supabaseAdmin.from('ticket_audit_log').insert({
    event_id, order_id: order.id,
    actor_user_id: gate.user.id, actor_role: 'admin',
    action: 'ticket.comp',
    detail: { product_id, quantity, buyer_email, note },
  });

  if (send_email) {
    const { data: event } = await supabaseAdmin.from('events').select('title, event_date, start_time').eq('id', event_id).maybeSingle();
    const rows = ticketRows.map((t) => ({
      ticketCode: t.ticket_code,
      productName: product.name,
      tierName: 'Comp',
      qrSvg: renderTicketQrSvg({ ticketCode: t.ticket_code }),
      viewUrl: null,
    }));
    try {
      await sendTicketConfirmation({
        to: buyer_email,
        orderId: order.id,
        eventTitle: event?.title || 'Stardust Garage',
        eventWhen: event?.event_date ? `${event.event_date}${event.start_time ? ` at ${event.start_time}` : ''}` : null,
        ticketRows: rows,
      });
    } catch (err) {
      console.warn('comp email send failed:', err?.message);
    }
  }

  return NextResponse.json({ ok: true, order_id: order.id, tickets: ticketRows.length });
}
