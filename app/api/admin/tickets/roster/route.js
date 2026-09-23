import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { assembleRoster, readRosterRows } from '@/lib/tickets/event-roster';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  const gate = await requireAdmin(request);
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404, headers });
  const page = Number(new URL(request.url).searchParams.get('page') || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400, headers });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: orders, error } = await db.from('orders')
      .select('id, event_id, buyer_name, buyer_email, member_profile_id, user_id, status, total_cents, refunded_cents, currency, paid_at, created_at, stripe_payment_intent_id, events(title, event_date)')
      .order('created_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
    if (error) throw error;
    const rows = orders || [];
    const ids = rows.map((r) => r.id);
    const profileIds = [...new Set(rows.map((r) => r.member_profile_id).filter(Boolean))];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    const [tickets, attendees, items, profiles, userProfiles] = await Promise.all([
      ids.length ? readRosterRows(() => db.from('tickets').select('id, order_id, order_item_id, attendee_id, status, used_at').in('order_id', ids).order('id')) : [],
      ids.length ? readRosterRows(() => db.from('attendees').select('id, ticket_id, full_name, email').in('order_id', ids).order('id')) : [],
      ids.length ? readRosterRows(() => db.from('order_items').select('id, product_name_snapshot, tier_name_snapshot').in('order_id', ids).order('id')) : [],
      profileIds.length ? readRosterRows(() => db.from('member_profiles').select('id, user_id, full_name').in('id', profileIds).order('id')) : [],
      userIds.length ? readRosterRows(() => db.from('member_profiles').select('id, user_id, full_name').in('user_id', userIds).order('id')) : [],
    ]);
    return NextResponse.json({ orders: assembleRoster(rows, tickets, attendees, items, [...profiles, ...userProfiles]),
      next_page: rows.length === 100 ? page + 1 : null }, { headers });
  } catch (error) {
    console.error('[all-event-orders]', error);
    return NextResponse.json({ error: 'Could not load orders. Please retry.' }, { status: 500, headers });
  }
}
