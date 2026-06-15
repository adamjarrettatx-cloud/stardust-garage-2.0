import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// PATCH /api/pos/cash-sessions/:id — close a session and reconcile.
// Body: { action: 'close', closing_cash_cents, notes? }
export async function PATCH(request, { params }) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }
  if (body.action !== 'close') return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });

  const admin = createAdminClient();

  const { data: session, error: loadErr } = await admin
    .from('pos_cash_sessions')
    .select('*')
    .eq('id', id)
    .single();
  if (loadErr || !session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  if (session.status === 'closed') return NextResponse.json({ error: 'Session already closed.' }, { status: 409 });

  // Expected cash = opening float + all succeeded cash payments on orders tied
  // to this session.
  const { data: payments } = await admin
    .from('pos_payments')
    .select('amount_cents, pos_orders!inner(cash_session_id)')
    .eq('tender_type', 'cash')
    .eq('status', 'succeeded')
    .eq('pos_orders.cash_session_id', id);

  const cashSales = (payments || []).reduce((s, p) => s + (p.amount_cents || 0), 0);
  const expected = (session.opening_cash_cents || 0) + cashSales;
  const closingCash = Math.max(0, Math.trunc(Number(body.closing_cash_cents ?? 0)));

  const { data, error } = await admin
    .from('pos_cash_sessions')
    .update({
      status: 'closed',
      closed_by: user.id,
      closing_cash_cents: closingCash,
      expected_cash_cents: expected,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : session.notes,
      closed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'Failed to close session.' }, { status: 500 });
  return NextResponse.json({
    session: data,
    expected_cash_cents: expected,
    variance_cents: closingCash - expected,
  });
}
