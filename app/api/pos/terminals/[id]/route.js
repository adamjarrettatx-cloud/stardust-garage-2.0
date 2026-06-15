import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const TERMINAL_TYPES = new Set(['countertop', 'handheld']);

// PATCH /api/pos/terminals/:id — update a terminal (admin only).
export async function PATCH(request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = {};
  if (typeof body.label === 'string') patch.label = body.label.trim();
  if (typeof body.terminal_type === 'string') {
    if (!TERMINAL_TYPES.has(body.terminal_type)) return NextResponse.json({ error: 'Invalid terminal type.' }, { status: 400 });
    patch.terminal_type = body.terminal_type;
  }
  if (typeof body.location === 'string') patch.location = body.location.trim() || null;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (typeof body.cash_drawer_attached === 'boolean') patch.cash_drawer_attached = body.cash_drawer_attached;
  if ('payment_processor_key' in body) {
    patch.payment_processor_key = typeof body.payment_processor_key === 'string' && body.payment_processor_key.trim()
      ? body.payment_processor_key.trim()
      : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  if (patch.label === '') return NextResponse.json({ error: 'Label cannot be empty.' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from('pos_terminals').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  return NextResponse.json({ terminal: data });
}
