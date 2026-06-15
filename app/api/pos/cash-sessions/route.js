import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/pos/cash-sessions — list sessions (team-readable). ?status=open filters.
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  const admin = createAdminClient();
  let query = admin
    .from('pos_cash_sessions')
    .select('*, pos_terminals(label, terminal_type)')
    .order('opened_at', { ascending: false })
    .limit(100);
  if (status === 'open' || status === 'closed') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load cash sessions' }, { status: 500 });
  return NextResponse.json({ sessions: data || [] });
}

// POST /api/pos/cash-sessions — open a new cash session for a terminal.
export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const terminalId = typeof body.terminal_id === 'string' && UUID.test(body.terminal_id) ? body.terminal_id : null;
  if (!terminalId) return NextResponse.json({ error: 'A terminal is required.' }, { status: 400 });
  const openingCash = Math.max(0, Math.trunc(Number(body.opening_cash_cents ?? 0)));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('pos_cash_sessions')
    .insert({
      terminal_id: terminalId,
      opened_by: user.id,
      opening_cash_cents: openingCash,
      status: 'open',
    })
    .select()
    .single();

  if (error) {
    // Unique partial index: one open session per terminal.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This terminal already has an open cash session.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to open cash session.' }, { status: 500 });
  }
  return NextResponse.json({ session: data });
}
