import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseCsv, mapPosRows } from '@/lib/pos-csv';
import { summarizePosRows, isRowInWindow, posRowTaxFee } from '@/lib/event-financials';
import { normalizeContractDateTime } from '@/lib/contract-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB CSV cap
const MAX_ROWS = 50000;

async function eventExists(admin, eventId) {
  const { data } = await admin.from('events').select('id').eq('id', eventId).maybeSingle();
  return Boolean(data);
}

// GET — list POS import batches for an event (roll-up totals only).
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: batches } = await admin
    .from('pos_import_batches')
    .select('*')
    .eq('event_id', id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ ok: true, batches: batches || [] });
}

// POST — import a POS CSV for the event. Body:
//   { csv: string, filename?, windowStart?, windowEnd?, mapping?, salesTaxBps?, ccFeeBps? }
// Parses + maps rows, flags those inside the window, stores the batch + rows,
// and returns the in-window roll-up. All money is computed in cents server-side.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return NextResponse.json({ error: 'csv is required' }, { status: 400 });
  if (csv.length > MAX_CSV_BYTES) return NextResponse.json({ error: 'CSV too large' }, { status: 413 });

  // Window pickers are venue-local wall clock (datetime-local, zoneless). Anchor
  // them to the venue timezone (America/Chicago, DST-aware) before comparing to
  // the UTC instants on POS rows — same convention as contract dates.
  const startParse = normalizeContractDateTime(body.windowStart);
  const endParse = normalizeContractDateTime(body.windowEnd);
  if (!startParse.ok) return NextResponse.json({ error: 'invalid windowStart' }, { status: 400 });
  if (!endParse.ok) return NextResponse.json({ error: 'invalid windowEnd' }, { status: 400 });
  const windowStart = startParse.value;
  const windowEnd = endParse.value;

  const salesTaxBps = clampBps(body.salesTaxBps);
  const ccFeeBps = clampBps(body.ccFeeBps);

  const admin = createAdminClient();
  if (!(await eventExists(admin, id))) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const parsed = parseCsv(csv);
  const { rows, headers, skipped } = mapPosRows(parsed, body.mapping || {});
  if (!rows.length) return NextResponse.json({ error: 'No data rows parsed from CSV' }, { status: 422 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 413 });

  // Compute in-window flags + roll-up using the same pure helper the calc uses.
  const summary = summarizePosRows(rows, { windowStart, windowEnd, salesTaxBps, ccFeeBps });

  // Insert the batch header first to get its id, then the rows.
  const { data: batch, error: batchErr } = await admin
    .from('pos_import_batches')
    .insert({
      event_id: id,
      source_filename: typeof body.filename === 'string' ? body.filename.slice(0, 200) : null,
      window_start: windowStart,
      window_end: windowEnd,
      row_count: rows.length,
      in_window_count: summary.inWindowCount,
      gross_cents: summary.grossCents,
      tax_cents: summary.taxCents,
      cc_fee_cents: summary.ccFeeCents,
      net_cents: summary.netCents,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (batchErr || !batch) {
    console.error('[pos-import] batch insert error', batchErr);
    return NextResponse.json({ error: 'Failed to save import batch' }, { status: 500 });
  }

  // Build row records using the same shared helpers the roll-up uses, so the
  // stored per-row tax/fee/net reconcile exactly to the batch totals
  // (summarizePosRows) the calc consumes. Per-row net is NOT clamped here, so
  // refund losses survive at the row level for audit.
  const rowRecords = rows.map((r) => {
    const inWindow = isRowInWindow(r.occurredAt, windowStart, windowEnd);
    const { grossCents, taxCents, ccFeeCents, netCents } = posRowTaxFee(r, { salesTaxBps, ccFeeBps });
    return {
      batch_id: batch.id,
      occurred_at: r.occurredAt,
      in_window: inWindow,
      gross_cents: grossCents,
      tax_cents: taxCents,
      cc_fee_cents: ccFeeCents,
      net_cents: netCents,
      description: r.description,
      raw: r.raw,
    };
  });

  // Insert rows in chunks to stay within payload limits.
  for (let i = 0; i < rowRecords.length; i += 1000) {
    const chunk = rowRecords.slice(i, i + 1000);
    const { error: rowErr } = await admin.from('pos_import_rows').insert(chunk);
    if (rowErr) {
      console.error('[pos-import] rows insert error', rowErr);
      // Roll back the batch so we don't leave a header with no/partial rows.
      await admin.from('pos_import_batches').delete().eq('id', batch.id);
      return NextResponse.json({ error: 'Failed to save POS rows' }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    headers,
    parsedRows: rows.length,
    skipped,
    summary,
  });
}

// DELETE — remove a batch (cascades its rows). Body/query: ?batchId=<uuid>.
export async function DELETE(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batchId');
  if (!batchId || !UUID.test(batchId)) return NextResponse.json({ error: 'batchId required' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('pos_import_batches')
    .delete()
    .eq('id', batchId)
    .eq('event_id', id);
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function clampBps(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10000, Math.round(n));
}
