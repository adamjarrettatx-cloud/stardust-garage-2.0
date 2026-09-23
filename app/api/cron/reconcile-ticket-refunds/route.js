import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkTicketRefund } from '@/lib/tickets/refunds';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isInternalTicketingEnabled()) return NextResponse.json({ skipped: true });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  const cutoff = new Date(Date.now() - 35 * 86400000).toISOString();
  // Fair rotation. Keep checking recent successes too: a bank can later reject
  // a refund. This is a fallback when refund webhooks are delayed or disabled.
  const { data, error } = await db.from('ticket_refund_requests').select('id')
    .or(`status.in.(processing,pending),and(status.eq.succeeded,created_at.gte.${cutoff})`)
    .order('last_checked_at', { ascending: true, nullsFirst: true }).limit(25);
  if (error) return NextResponse.json({ error: 'Could not load refund requests' }, { status: 500 });
  let checked = 0;
  const failures = [];
  const started = Date.now();
  for (const row of data || []) {
    if (Date.now() - started > 40000) break;
    try { await checkTicketRefund(db, row.id); checked++; }
    catch (err) { failures.push(row.id); console.error('[refund-reconcile]', row.id, err); }
    const { error: updateError } = await db.from('ticket_refund_requests')
      .update({ last_checked_at: new Date().toISOString() }).eq('id', row.id);
    if (updateError && !failures.includes(row.id)) failures.push(row.id);
  }
  return NextResponse.json({ checked, failures }, { status: failures.length ? 503 : 200 });
}
