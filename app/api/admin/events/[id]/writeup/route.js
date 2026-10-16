import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEventWriteup } from '@/lib/event-writeup-data';
import { normalizeAdjustments } from '@/lib/event-writeup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_ADJUSTMENTS = 50;
const MAX_CENTS = 100_000_000; // $1,000,000 sanity ceiling per value

export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const result = await loadEventWriteup(admin, id);
  if (!result) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}

// PUT — save the manually entered values (door gross, organizer %,
// adjustments, notes) and return the recomputed write-up.
export async function PUT(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = { event_id: id, updated_by: user.id, updated_at: new Date().toISOString() };

  if ('door_gross_cents' in body) {
    const v = body.door_gross_cents;
    if (v === null || v === '') patch.door_gross_cents = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > MAX_CENTS) return NextResponse.json({ error: 'Door sales must be a positive dollar amount' }, { status: 400 });
      patch.door_gross_cents = n;
    }
  }

  if ('organizer_percent' in body) {
    const v = body.organizer_percent;
    if (v === null || v === '') patch.organizer_percent = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: 'Organizer percentage must be between 0 and 100' }, { status: 400 });
      patch.organizer_percent = Math.round(n * 100) / 100;
    }
  }

  if ('adjustments' in body) {
    if (!Array.isArray(body.adjustments) || body.adjustments.length > MAX_ADJUSTMENTS) {
      return NextResponse.json({ error: 'Invalid line items' }, { status: 400 });
    }
    const list = normalizeAdjustments(body.adjustments);
    for (const a of list) {
      if (!a.label) return NextResponse.json({ error: 'Every line item needs a name' }, { status: 400 });
      if (Math.abs(a.amount_cents) > MAX_CENTS) return NextResponse.json({ error: 'Line item amount is too large' }, { status: 400 });
    }
    patch.adjustments = list.map((a, i) => ({ id: a.id || `adj_${Date.now().toString(36)}_${i}`, label: a.label, amount_cents: a.amount_cents }));
  }

  if ('notes' in body) patch.notes = String(body.notes || '').trim().slice(0, 2000) || null;

  const admin = createAdminClient();
  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: existing } = await admin.from('event_writeups').select('event_id').eq('event_id', id).maybeSingle();
  const { error } = existing
    ? await admin.from('event_writeups').update(patch).eq('event_id', id)
    : await admin.from('event_writeups').insert({ ...patch, created_by: user.id });
  if (error) {
    console.error('[event.writeup.save]', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  const result = await loadEventWriteup(admin, id);
  return NextResponse.json({ ok: true, ...result });
}
