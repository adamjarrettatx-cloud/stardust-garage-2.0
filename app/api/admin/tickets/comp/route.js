import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { sendTicketConfirmation } from '@/lib/email';
import { renderTicketQrPngBuffer } from '@/lib/tickets/qr';
import { fetchEventForEmail } from '@/lib/tickets/fetch-event-for-email';
import { CompError, issueComp, validateCompRequest } from '@/lib/tickets/comp';

// POST /api/admin/tickets/comp
// Body: { event_id, product_id, quantity, buyer_email, buyer_name?, note, comp_ref, send_email? }
//
// Admin-only. Issues complimentary tickets as a $0 order; see
// lib/tickets/comp.js for inventory and idempotency rules. Used by the
// Issue comp form on /bananas/events/[id]/attendees.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let input;
  try {
    input = validateCompRequest(await request.json());
  } catch (err) {
    const message = err instanceof CompError ? err.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let result;
  try {
    result = await issueComp(db, input, gate.user.id);
  } catch (err) {
    if (err instanceof CompError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[admin.comp] issue failed', err);
    return NextResponse.json({ error: 'Could not issue the comp. Nothing was sent. Try again.' }, { status: 500 });
  }

  const { order, tickets, product, deduped } = result;
  if (deduped) {
    return NextResponse.json({ ok: true, deduped: true, order_id: order.id, tickets: 0, email: { status: 'skipped' } });
  }

  let email = { status: 'skipped' };
  if (input.sendEmail) {
    try {
      const eventCtx = await fetchEventForEmail({ supabaseAdmin: db, eventId: input.eventId, request });
      const ticketRows = await Promise.all(tickets.map(async (t) => ({
        ticketCode: t.ticket_code,
        productName: product.name,
        tierName: 'Comp',
        quantity: input.quantity,
        unitPriceCents: 0,
        subtotalCents: 0,
        qrPngBuffer: await renderTicketQrPngBuffer({ ticketCode: t.ticket_code }),
        viewUrl: null,
      })));
      const sent = await sendTicketConfirmation({
        to: input.email,
        orderId: order.id,
        orderDate: order.created_at,
        eventTitle: eventCtx.eventTitle,
        eventWhen: eventCtx.eventWhen,
        eventFlyerUrl: eventCtx.eventFlyerUrl,
        venueAddress: eventCtx.venueAddress,
        ticketRows,
        orderUrl: eventCtx.orderUrlBase,
        orderTotals: { subtotalCents: 0, feesCents: 0, taxCents: 0, discountCents: 0, totalCents: 0 },
        currency: 'usd',
      });
      if (!sent?.id) throw new Error('Email provider did not confirm the send');
      email = { status: 'sent', to: input.email, provider_id: sent.id };
      await db.from('ticket_audit_log').insert({
        event_id: input.eventId, order_id: order.id,
        actor_user_id: gate.user.id, actor_role: 'admin',
        action: 'order.resend',
        detail: { to: input.email, provider_id: sent.id, tickets: tickets.length, reason: 'comp_issued' },
      });
    } catch (err) {
      console.warn('[admin.comp] email failed', { orderId: order.id, err: err?.message });
      email = { status: 'failed', error: err?.message || 'Email failed' };
    }
  }

  return NextResponse.json({ ok: true, order_id: order.id, tickets: tickets.length, email });
}
