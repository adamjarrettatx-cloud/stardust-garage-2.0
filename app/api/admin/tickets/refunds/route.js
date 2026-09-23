import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { executeTicketRefund, checkTicketRefund, publicRefundResult } from '@/lib/tickets/refunds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const json = (data, status = 200) => NextResponse.json(data, { status, headers });
const database = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

export async function GET(request) {
  const gate = await requireAdmin(request);
  if (gate.unauthorized) return json({ error: 'Unauthorized' }, 401);
  if (!isInternalTicketingEnabled()) return json({ error: 'Ticketing disabled' }, 404);
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (eventId && !uuid(eventId)) return json({ error: 'Invalid event' }, 400);
  let q = database().from('ticket_refund_requests')
    .select('*, order:orders!inner(id, buyer_name, buyer_email, event_id, events(title))')
    .neq('status', 'draft').order('created_at', { ascending: false }).limit(100);
  if (eventId) q = q.eq('order.event_id', eventId);
  const { data, error } = await q;
  if (error) return json({ error: 'Could not load refund activity' }, 500);
  return json({ refunds: (data || []).map((row) => ({
    ...publicRefundResult(row), created_at: row.created_at, note: row.note,
    buyer_name: row.order?.buyer_name, buyer_email: row.order?.buyer_email,
    event_title: row.order?.events?.title,
    can_resume: row.actor_user_id === gate.user.id,
  })) });
}

export async function POST(request) {
  const gate = await requireAdmin(request);
  if (gate.unauthorized) return json({ error: 'Unauthorized' }, 401);
  if (!isInternalTicketingEnabled()) return json({ error: 'Ticketing disabled' }, 404);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin request denied' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON required' }, 415);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const db = database();
  if (body?.action === 'execute' || body?.action === 'check') {
    if (!uuid(body.request_id)) return json({ error: 'Invalid refund request' }, 400);
    try {
      return json({ result: body.action === 'check' ? await checkTicketRefund(db, body.request_id)
        : await executeTicketRefund(db, body.request_id, gate.user.id) });
    } catch (error) {
      console.error('[ticket-refund]', error);
      // The UI retains the intent ID. "Unknown" is never displayed as failure
      // or retried with a new ID; re-checking resolves the same intent.
      return json({ error: error.message || 'Could not confirm refund status. Check this request again.',
        request_id: body.request_id, status: 'needs_check' }, 409);
    }
  }
  if (body?.action !== 'review') return json({ error: 'Unknown action' }, 400);
  const ids = body.order_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => !uuid(id))
      || new Set(ids).size !== ids.length) return json({ error: 'Select 1–100 distinct orders' }, 400);
  const partial = body.amount_cents;
  if (partial != null && (ids.length !== 1 || !Number.isSafeInteger(partial) || partial <= 0)) {
    return json({ error: 'Partial refunds require one order and a positive amount in cents' }, 400);
  }
  if (typeof body.note !== 'string' || !body.note.trim() || body.note.trim().length > 500) {
    return json({ error: 'Enter a refund reason, up to 500 characters' }, 400);
  }
  const { data: orders, error } = await db.from('orders')
    .select('id, event_id, buyer_name, buyer_email, total_cents, refunded_cents, currency, status, stripe_payment_intent_id, events(title)')
    .in('id', ids);
  if (error) return json({ error: 'Could not read orders' }, 500);
  if (orders.length !== ids.length) return json({ error: 'One or more orders no longer exist. Refresh the list.' }, 409);
  const { data: active, error: activeError } = await db.from('ticket_refund_requests')
    .select('order_id').in('order_id', ids).in('status', ['processing', 'pending']);
  if (activeError) return json({ error: 'Could not check refund status' }, 500);
  const blocked = new Set((active || []).map((r) => r.order_id));
  const drafts = [];
  const skipped = [];
  for (const order of orders) {
    const remaining = Number(order.total_cents) - Number(order.refunded_cents || 0);
    let reason = '';
    if (!['paid', 'partial_refund'].includes(order.status) || remaining <= 0) reason = 'Already refunded or not paid';
    else if (!order.stripe_payment_intent_id) reason = 'No refundable Stripe payment (for example, a comp)';
    else if (blocked.has(order.id)) reason = 'A refund is already in progress. Check refund activity.';
    else if (partial != null && partial > remaining) reason = 'Amount exceeds the remaining refundable balance';
    if (reason) { skipped.push({ order_id: order.id, buyer_name: order.buyer_name, buyer_email: order.buyer_email, reason }); continue; }
    drafts.push({
      order_id: order.id, actor_user_id: gate.user.id, amount_cents: partial ?? remaining,
      expected_refunded_cents: Number(order.refunded_cents || 0), currency: order.currency,
      note: body.note.trim(),
    });
  }
  if (!drafts.length) return json({ requests: [], skipped });
  const { data: created, error: insertError } = await db.from('ticket_refund_requests')
    .insert(drafts).select('id, order_id, amount_cents, currency');
  if (insertError) return json({ error: 'Could not prepare refund review. No money was moved.' }, 500);
  const byId = new Map(orders.map((order) => [order.id, order]));
  return json({
    requests: created.map((row) => {
      const order = byId.get(row.order_id);
      return { ...row, buyer_name: order.buyer_name, buyer_email: order.buyer_email,
        event_title: order.events?.title, remaining_cents: Number(order.total_cents) - Number(order.refunded_cents || 0) };
    }), skipped,
  });
}
