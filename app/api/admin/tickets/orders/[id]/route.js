import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { refundTicketOrder } from '@/lib/tickets/stripe';
import { sendTicketConfirmation } from '@/lib/email';
import { renderTicketQrSvg } from '@/lib/tickets/qr';

// GET    /api/admin/tickets/orders/[id]  -> full order detail (items + tickets)
// POST   /api/admin/tickets/orders/[id]  -> body: { action: 'refund'|'void_tickets'|'resend'|'comp_note', ... }
//
// Refund calls Stripe first, then marks tickets refunded and order status.
// Void marks specific ticket ids as 'void' without a Stripe operation
// (use for lost/comped-then-cancelled tickets). Comp is a note on an
// otherwise-normal order for audit; comp *creation* is a separate flow.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(_request, { params }) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const supabaseAdmin = admin();
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [items, tickets, checkins, audit, event] = await Promise.all([
    supabaseAdmin.from('order_items').select('*').eq('order_id', id),
    supabaseAdmin.from('tickets').select('*').eq('order_id', id).order('seat_index'),
    supabaseAdmin.from('ticket_checkins').select('*').in('ticket_id',
      (await supabaseAdmin.from('tickets').select('id').eq('order_id', id)).data?.map((t) => t.id) || ['00000000-0000-0000-0000-000000000000']
    ),
    supabaseAdmin.from('ticket_audit_log').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('events').select('id, title, event_date, start_time').eq('id', order.event_id).maybeSingle(),
  ]);

  return NextResponse.json({
    order,
    event: event.data,
    items: items.data || [],
    tickets: tickets.data || [],
    checkins: checkins.data || [],
    audit: audit.data || [],
  });
}

export async function POST(request, { params }) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { action } = body || {};

  const supabaseAdmin = admin();
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'refund') {
    if (!['paid', 'partial_refund'].includes(order.status)) {
      return NextResponse.json({ error: `Cannot refund order in status ${order.status}` }, { status: 400 });
    }
    const amountCents = body.amount_cents ?? null; // null => full remaining
    const ticketIds = Array.isArray(body.ticket_ids) ? body.ticket_ids : null;

    try {
      const refund = await refundTicketOrder({
        paymentIntentId: order.stripe_payment_intent_id,
        amountCents: amountCents,
        reason: body.reason || 'requested_by_customer',
        metadata: { order_id: order.id, admin_user_id: gate.user.id },
      });

      const refunded = Number(refund.amount) || 0;
      const newRefundedTotal = (order.refunded_cents || 0) + refunded;
      const remaining = order.total_cents - newRefundedTotal;
      const newStatus = remaining <= 0 ? 'refunded' : 'partial_refund';

      await supabaseAdmin
        .from('orders')
        .update({ status: newStatus, refunded_cents: newRefundedTotal })
        .eq('id', order.id);

      // Mark impacted tickets refunded. If caller specified a subset, use it;
      // otherwise on full refund mark all still-valid tickets refunded.
      if (newStatus === 'refunded' || ticketIds) {
        const targetIds = ticketIds || (await supabaseAdmin.from('tickets').select('id').eq('order_id', order.id).eq('status', 'valid')).data?.map((t) => t.id) || [];
        if (targetIds.length) {
          await supabaseAdmin.from('tickets').update({ status: 'refunded' }).in('id', targetIds);
        }
      }

      await supabaseAdmin.from('ticket_audit_log').insert({
        event_id: order.event_id, order_id: order.id,
        actor_user_id: gate.user.id, actor_role: 'admin',
        action: 'order.refund',
        detail: { amount_cents: refunded, stripe_refund_id: refund.id, reason: body.reason || null, ticket_ids: ticketIds || 'all' },
      });

      return NextResponse.json({ ok: true, refund_id: refund.id, refunded_cents: refunded, new_status: newStatus });
    } catch (err) {
      console.error('refund failed:', err);
      return NextResponse.json({ error: `Refund failed: ${err?.message || err}` }, { status: 502 });
    }
  }

  if (action === 'void_tickets') {
    const ticketIds = Array.isArray(body.ticket_ids) ? body.ticket_ids : [];
    if (!ticketIds.length) return NextResponse.json({ error: 'Missing ticket_ids' }, { status: 400 });

    await supabaseAdmin.from('tickets').update({ status: 'void' }).in('id', ticketIds).eq('order_id', order.id);
    await supabaseAdmin.from('ticket_audit_log').insert({
      event_id: order.event_id, order_id: order.id,
      actor_user_id: gate.user.id, actor_role: 'admin',
      action: 'ticket.void',
      detail: { ticket_ids: ticketIds, note: body.note || null },
    });
    return NextResponse.json({ ok: true, voided: ticketIds.length });
  }

  if (action === 'resend') {
    if (order.status !== 'paid' && order.status !== 'partial_refund') {
      return NextResponse.json({ error: 'Order not paid' }, { status: 400 });
    }
    const [event, tickets, items] = await Promise.all([
      supabaseAdmin.from('events').select('title, event_date, start_time').eq('id', order.event_id).maybeSingle(),
      supabaseAdmin.from('tickets').select('id, ticket_code, order_item_id, status').eq('order_id', order.id).neq('status', 'void'),
      supabaseAdmin.from('order_items').select('id, product_name_snapshot, tier_name_snapshot').eq('order_id', order.id),
    ]);
    const itemById = new Map((items.data || []).map((i) => [i.id, i]));
    const ticketRows = (tickets.data || []).map((t) => ({
      ticketCode: t.ticket_code,
      productName: itemById.get(t.order_item_id)?.product_name_snapshot || 'Ticket',
      tierName: itemById.get(t.order_item_id)?.tier_name_snapshot || null,
      qrSvg: renderTicketQrSvg({ ticketCode: t.ticket_code }),
      viewUrl: null,
    }));

    await sendTicketConfirmation({
      to: body.to_email || order.buyer_email,
      orderId: order.id,
      eventTitle: event.data?.title || 'Stardust Garage',
      eventWhen: event.data?.event_date ? `${event.data.event_date}${event.data.start_time ? ` at ${event.data.start_time}` : ''}` : null,
      ticketRows,
    });

    await supabaseAdmin.from('ticket_audit_log').insert({
      event_id: order.event_id, order_id: order.id,
      actor_user_id: gate.user.id, actor_role: 'admin',
      action: 'order.resend',
      detail: { to: body.to_email || order.buyer_email },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'comp_note') {
    await supabaseAdmin.from('ticket_audit_log').insert({
      event_id: order.event_id, order_id: order.id,
      actor_user_id: gate.user.id, actor_role: 'admin',
      action: 'order.note',
      detail: { note: body.note || '' },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
}
