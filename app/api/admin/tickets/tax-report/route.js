import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireOwner } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { aggregateTaxReport } from '@/lib/tickets/tax-report';

// GET /api/admin/tickets/tax-report?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Portfolio-wide Texas sales-tax report across every internal-ticketing
// order. Owner-only — this is filing-grade data. Windows on paid_at (falling
// back to created_at) so a report for "Q3 2026" answers "what did we
// actually collect during Q3", not "which orders were opened then".
//
// Returns totals + a per-month breakdown + a per-event breakdown so the
// owner can (a) file with the Texas Comptroller and (b) reconcile which
// events contributed to the number. All money is integer cents.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireOwner();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Only 'paid' / 'refunded' / 'partial_refund' orders have real money.
  // Pending / cancelled / abandoned never collected tax, so exclude them.
  let q = supabaseAdmin
    .from('orders')
    .select('id, event_id, status, subtotal_cents, total_cents, tax_cents, refunded_cents, refunded_tax_cents, paid_at, created_at')
    .in('status', ['paid', 'refunded', 'partial_refund'])
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(10000);
  if (from) q = q.gte('paid_at', from);
  if (to) {
    // Inclusive end-of-day: '2026-09-30' → include everything up to
    // 2026-10-01 exclusive.
    const end = new Date(to);
    end.setUTCDate(end.getUTCDate() + 1);
    q = q.lt('paid_at', end.toISOString());
  }

  const { data: orders, error } = await q;
  if (error) return NextResponse.json({ error: `Query failed: ${error.message}` }, { status: 500 });

  // Attach event titles so the breakdown is human-readable.
  const eventIds = Array.from(new Set((orders || []).map((o) => o.event_id).filter(Boolean)));
  const eventTitles = new Map();
  if (eventIds.length) {
    const { data: events } = await supabaseAdmin.from('events').select('id, title, event_date').in('id', eventIds);
    for (const e of events || []) eventTitles.set(e.id, { title: e.title, event_date: e.event_date });
  }

  const report = aggregateTaxReport(orders || [], eventTitles);
  return NextResponse.json({ window: { from: from || null, to: to || null }, ...report });
}
