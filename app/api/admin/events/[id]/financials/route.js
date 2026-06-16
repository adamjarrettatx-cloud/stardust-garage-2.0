import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEventFinancials, resolveEventContract } from '@/lib/event-financials-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET — compute and return the full per-event financial summary plus the
// stored config and the contract terms feeding it.
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const result = await loadEventFinancials(admin, id);
  if (!result) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}

// PUT — upsert the per-event financial config (CPT fee, tax/cc rates, the
// contract used for split terms). Returns the recomputed summary.
export async function PUT(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = { event_id: id };
  if ('tt_cpt_fee_cents' in body) {
    const n = Number(body.tt_cpt_fee_cents);
    if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: 'tt_cpt_fee_cents must be a non-negative integer' }, { status: 400 });
    patch.tt_cpt_fee_cents = n;
  }
  for (const f of ['sales_tax_bps', 'cc_fee_bps']) {
    if (f in body) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return NextResponse.json({ error: `${f} must be 0..10000 basis points` }, { status: 400 });
      patch[f] = n;
    }
  }
  if ('contract_id' in body) {
    if (body.contract_id === null || body.contract_id === '') patch.contract_id = null;
    else if (typeof body.contract_id === 'string' && UUID.test(body.contract_id)) patch.contract_id = body.contract_id;
    else return NextResponse.json({ error: 'invalid contract_id' }, { status: 400 });
  }
  if ('notes' in body) patch.notes = String(body.notes || '').trim().slice(0, 500) || null;

  const admin = createAdminClient();
  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: existing } = await admin
    .from('event_financial_config')
    .select('id')
    .eq('event_id', id)
    .maybeSingle();

  if (existing) {
    const { error } = await admin.from('event_financial_config').update(patch).eq('event_id', id);
    if (error) { console.error('[event.financials.update]', error); return NextResponse.json({ error: 'Update failed' }, { status: 500 }); }
  } else {
    const { error } = await admin.from('event_financial_config').insert({ ...patch, created_by: user.id });
    if (error) { console.error('[event.financials.create]', error); return NextResponse.json({ error: 'Create failed' }, { status: 500 }); }
  }

  const result = await loadEventFinancials(admin, id);
  return NextResponse.json({ ok: true, ...result });
}

// POST — snapshot the currently resolved contract's reviewed terms onto the
// event_financial_config row. Once snapshotted, deleting/unlinking the contract
// no longer changes this event's split (the calc falls back to the snapshot
// instead of the 100% Stardust default). Body: { action: 'snapshot' }.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }
  if (body?.action !== 'snapshot') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const admin = createAdminClient();
  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: cfg } = await admin
    .from('event_financial_config')
    .select('id, contract_id')
    .eq('event_id', id)
    .maybeSingle();

  const contract = await resolveEventContract(admin, id, cfg?.contract_id ?? null);
  if (!contract) {
    return NextResponse.json({ error: 'No contract terms to snapshot' }, { status: 400 });
  }
  if (contract.stardust_split_percent == null && contract.flat_fee_cents == null) {
    return NextResponse.json({ error: 'Contract has no reviewed split or flat-fee terms to snapshot' }, { status: 400 });
  }

  const snapshot = {
    snapshot_stardust_split_percent: contract.stardust_split_percent,
    snapshot_flat_fee_cents: contract.flat_fee_cents,
    snapshot_revenue_share_recipient: contract.revenue_share_recipient || 'stardust',
    snapshot_taken_at: new Date().toISOString(),
    snapshot_contract_id: contract.id,
  };

  if (cfg) {
    const { error } = await admin.from('event_financial_config').update(snapshot).eq('event_id', id);
    if (error) { console.error('[event.financials.snapshot.update]', error); return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 }); }
  } else {
    const { error } = await admin.from('event_financial_config').insert({ event_id: id, created_by: user.id, ...snapshot });
    if (error) { console.error('[event.financials.snapshot.create]', error); return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 }); }
  }

  const result = await loadEventFinancials(admin, id);
  return NextResponse.json({ ok: true, ...result });
}
