import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { assembleRoster, readRosterRows } from '@/lib/tickets/event-roster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PAGE_SIZE = 100;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request, { params }) {
  const gate = await requireAdmin(request);
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!isInternalTicketingEnabled()) {
    return NextResponse.json({ error: 'Internal ticketing is disabled' }, { status: 404, headers });
  }
  const { id } = await params;
  const page = Number(new URL(request.url).searchParams.get('page') || 0);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || !Number.isSafeInteger(page) || page < 0 || page > 10000) {
    return NextResponse.json({ error: 'Invalid event or page' }, { status: 400, headers });
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  try {
    const { data: event, error: eventError } = await db.from('events')
      .select('id, title, event_date, ticketing_mode').eq('id', id).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404, headers });

    const { data: orders, error } = await db.from('orders')
      .select('id, event_id, buyer_name, buyer_email, member_profile_id, user_id, status, total_cents, refunded_cents, currency, paid_at, created_at, stripe_payment_intent_id, events(title, event_date)')
      .eq('event_id', id).order('created_at', { ascending: false }).order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    const rows = orders || [];
    const orderIds = rows.map((o) => o.id);
    const profileIds = [...new Set(rows.filter((o) => !o.buyer_name?.trim()).map((o) => o.member_profile_id).filter(Boolean))];
    const userIds = [...new Set(rows.filter((o) => !o.buyer_name?.trim()).map((o) => o.user_id).filter(Boolean))];
    const [tickets, attendees, items, profilesById, profilesByUser] = await Promise.all([
      orderIds.length ? readRosterRows(() => db.from('tickets')
        .select('id, order_id, order_item_id, attendee_id, status, used_at')
        .eq('event_id', id).in('order_id', orderIds).order('id')) : [],
      orderIds.length ? readRosterRows(() => db.from('attendees')
        .select('id, ticket_id, full_name, email').in('order_id', orderIds).order('id')) : [],
      orderIds.length ? readRosterRows(() => db.from('order_items')
        .select('id, product_name_snapshot, tier_name_snapshot').in('order_id', orderIds).order('id')) : [],
      profileIds.length ? readRosterRows(() => db.from('member_profiles')
        .select('id, user_id, full_name').in('id', profileIds).order('id')) : [],
      userIds.length ? readRosterRows(() => db.from('member_profiles')
        .select('id, user_id, full_name').in('user_id', userIds).order('id')) : [],
    ]);
    return NextResponse.json({
      event,
      orders: assembleRoster(rows, tickets, attendees, items, [...profilesById, ...profilesByUser]),
      next_page: rows.length === PAGE_SIZE ? page + 1 : null,
    }, { headers });
  } catch (error) {
    console.error('[event-attendees] read failed', error);
    return NextResponse.json({ error: 'Could not load attendees. Please retry.' }, { status: 500, headers });
  }
}
