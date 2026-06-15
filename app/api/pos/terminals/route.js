import { NextResponse } from 'next/server';
import { requireAdmin, requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TERMINAL_TYPES = new Set(['countertop', 'handheld']);

// GET /api/pos/terminals — list terminals (team-readable for the register).
export async function GET() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('pos_terminals')
    .select('*')
    .order('terminal_type', { ascending: true })
    .order('label', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load terminals' }, { status: 500 });
  return NextResponse.json({ terminals: data || [] });
}

// POST /api/pos/terminals — create a terminal (admin only).
export async function POST(request) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const label = String(body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'Label is required.' }, { status: 400 });
  const terminalType = TERMINAL_TYPES.has(body.terminal_type) ? body.terminal_type : 'countertop';

  const row = {
    label,
    terminal_type: terminalType,
    location: typeof body.location === 'string' ? body.location.trim() || null : null,
    active: typeof body.active === 'boolean' ? body.active : true,
    // payment_processor_key is an opaque future-adapter label; null in Phase 1.
    payment_processor_key: typeof body.payment_processor_key === 'string' && body.payment_processor_key.trim()
      ? body.payment_processor_key.trim()
      : null,
    cash_drawer_attached: typeof body.cash_drawer_attached === 'boolean' ? body.cash_drawer_attached : false,
  };

  const admin = createAdminClient();
  const { data, error } = await admin.from('pos_terminals').insert(row).select().single();
  if (error) return NextResponse.json({ error: 'Failed to create terminal.' }, { status: 500 });
  return NextResponse.json({ terminal: data });
}
