import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { ACCOUNT_NAMES } from '@/lib/financial-ledger';
import {
  MAX_CSV_BYTES,
  buildPreview,
  buildSpotOnLedgerRows,
  mapSpotOnRows,
  sanitizeMapping,
  summarizeImport,
  validateMapping,
} from '@/lib/spoton-import';
import { resolveAccountId, auditLedger } from '@/lib/financial-ledger-db';

export const runtime = 'nodejs';

// OWNER-ONLY manual SpotOn POS CSV import, in two steps.
//
//   POST  (multipart: file)          -> parse + preview, store a 'pending' batch
//   PATCH ({ batchId, mapping })     -> re-derive from the STORED rows, write the ledger
//   DELETE ({ batchId })             -> discard a pending batch
//
// Why two steps with server-side storage in between: the confirm step must not
// trust anything the browser computed. It reloads the raw rows this server
// parsed and recomputes every amount from them, so the only client input that
// matters is the column mapping — and that is validated against the file's
// actual headers before use.
//
// Security posture matches /api/admin/manual-income: owner gate, same-origin
// CSRF check, service-role writes only after the gate, uploader/created_by taken
// from the session. The confirm action is audit-logged.

const ALLOWED_MIME = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel', // what several browsers label a .csv as
  '',
]);

async function guard(request) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return { error: NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 }) };
  }
  const { user, unauthorized } = await requireOwner();
  if (unauthorized) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Step 1 — upload. Parses the file, stores the parsed rows as a pending batch,
// and returns a preview plus a suggested mapping. Nothing lands in the ledger.
export async function POST(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    let form;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
    }

    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
    }
    const filename = String(file.name || 'upload.csv').slice(0, 300);
    if (!/\.csv$/i.test(filename)) {
      return NextResponse.json({ error: 'Only .csv files can be imported.' }, { status: 415 });
    }
    if (!ALLOWED_MIME.has(String(file.type || ''))) {
      return NextResponse.json({ error: `Unsupported file type "${file.type}".` }, { status: 415 });
    }
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: `The file is larger than ${Math.round(MAX_CSV_BYTES / (1024 * 1024))}MB.` },
        { status: 413 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    // Re-check after reading: file.size is client-reported metadata.
    if (bytes.byteLength > MAX_CSV_BYTES) {
      return NextResponse.json({ error: 'The file is too large.' }, { status: 413 });
    }
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    // Strip a UTF-8 BOM so the first header name is not "﻿Date".
    const text = bytes.toString('utf8').replace(/^﻿/, '');

    const preview = buildPreview(text);
    if (preview.error) {
      return NextResponse.json({ error: preview.error }, { status: 422 });
    }

    const supabase = createAdminClient();

    // Duplicate guard: warn (do not block) if this exact file was already
    // imported. The admin can still force it through on confirm — a genuine
    // re-import of a corrected batch is their call to make.
    const { data: existing } = await supabase
      .from('spoton_import_batches')
      .select('id, filename, created_at')
      .eq('file_hash', fileHash)
      .eq('status', 'confirmed')
      .maybeSingle();

    const { data: batch, error: batchError } = await supabase
      .from('spoton_import_batches')
      .insert({
        filename,
        uploaded_by: g.user.id,
        row_count: preview.rowCount,
        status: 'pending',
        raw_rows: preview.rows,
        file_hash: fileHash,
      })
      .select('id, filename, row_count, created_at')
      .single();
    if (batchError) throw new Error(`Could not stage the import: ${batchError.message}`);

    await auditLedger({
      admin: supabase,
      action: 'ledger_spoton_upload',
      user: g.user,
      request,
      details: { batch_id: batch.id, filename, row_count: preview.rowCount, duplicate_of: existing?.id || null },
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      filename: batch.filename,
      headers: preview.headers,
      previewRows: preview.previewRows,
      rowCount: preview.rowCount,
      suggestedMapping: preview.suggestedMapping,
      duplicateOf: existing ? { id: existing.id, filename: existing.filename, createdAt: existing.created_at } : null,
    });
  } catch (err) {
    console.error('spoton-import POST error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

// Step 2 — confirm. Everything is recomputed from the stored rows.
export async function PATCH(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    const body = await readJson(request);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

    const batchId = String(body.batchId || '').trim();
    if (!batchId) return NextResponse.json({ error: 'A batchId is required.' }, { status: 400 });

    const supabase = createAdminClient();
    const { data: batch, error: batchError } = await supabase
      .from('spoton_import_batches')
      .select('id, filename, status, raw_rows, file_hash, row_count')
      .eq('id', batchId)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 });
    if (batch.status === 'confirmed') {
      return NextResponse.json({ error: 'This batch has already been imported.' }, { status: 409 });
    }

    const rawRows = Array.isArray(batch.raw_rows) ? batch.raw_rows : [];
    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'This batch has no stored rows to import.' }, { status: 422 });
    }
    // Headers come from the stored rows, not from the client, so the mapping is
    // validated against what was actually parsed.
    const headers = Object.keys(rawRows[0] || {});

    const mapping = sanitizeMapping(body.mapping);
    const check = validateMapping(mapping, headers);
    if (!check.valid) {
      return NextResponse.json({ error: 'Validation failed', fields: check.errors }, { status: 422 });
    }

    if (!body.force && batch.file_hash) {
      const { data: duplicate } = await supabase
        .from('spoton_import_batches')
        .select('id, filename, created_at')
        .eq('file_hash', batch.file_hash)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (duplicate) {
        return NextResponse.json({
          error: 'This file has already been imported.',
          hint: `"${duplicate.filename}" was imported on ${new Date(duplicate.created_at).toLocaleDateString('en-US')}. Re-send with force to import it again.`,
          duplicateOf: duplicate.id,
        }, { status: 409 });
      }
    }

    const { mapped, errors, skippedZero } = mapSpotOnRows(rawRows, mapping);
    if (mapped.length === 0) {
      await supabase
        .from('spoton_import_batches')
        .update({ status: 'failed', column_mapping: mapping, error_detail: 'No importable rows.' })
        .eq('id', batch.id);
      return NextResponse.json({
        error: 'No rows could be imported with that mapping.',
        hint: errors[0]?.message || 'Every row was empty or had a zero amount.',
      }, { status: 422 });
    }

    const accountId = await resolveAccountId(supabase, ACCOUNT_NAMES.spoton);
    const ledgerRows = buildSpotOnLedgerRows({
      mapped,
      accountId,
      batchId: batch.id,
      createdBy: g.user.id,
      mapping,
    });

    const { error: insertError } = await supabase
      .from('financial_transactions')
      .upsert(ledgerRows, { onConflict: 'source,external_ref' });
    if (insertError) {
      await supabase
        .from('spoton_import_batches')
        .update({ status: 'failed', column_mapping: mapping, error_detail: insertError.message.slice(0, 500) })
        .eq('id', batch.id);
      throw new Error(`Could not write the ledger: ${insertError.message}`);
    }

    const { error: confirmError } = await supabase
      .from('spoton_import_batches')
      .update({
        status: 'confirmed',
        column_mapping: mapping,
        row_count: rawRows.length,
        confirmed_at: new Date().toISOString(),
        error_detail: null,
      })
      .eq('id', batch.id);
    if (confirmError) throw new Error(confirmError.message);

    const summary = summarizeImport(mapped);

    await auditLedger({
      admin: supabase,
      action: 'ledger_spoton_confirm',
      user: g.user,
      request,
      details: {
        batch_id: batch.id,
        filename: batch.filename,
        column_mapping: mapping,
        imported: summary.rows,
        skipped_zero: skippedZero,
        unparseable: errors.length,
        inflow_cents: summary.inflowCents,
        outflow_cents: summary.outflowCents,
        forced: Boolean(body.force),
      },
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      imported: summary.rows,
      skippedZero,
      unparseable: errors.length,
      rowErrors: errors.slice(0, 10),
      inflowCents: summary.inflowCents,
      outflowCents: summary.outflowCents,
      netCents: summary.netCents,
    });
  } catch (err) {
    console.error('spoton-import PATCH error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

// Discard a staged upload the admin decided not to import. Only ever removes a
// batch that never reached 'confirmed', so a real import cannot be deleted here.
export async function DELETE(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    const body = await readJson(request);
    const batchId = (body?.batchId ?? new URL(request.url).searchParams.get('batchId') ?? '').toString().trim();
    if (!batchId) return NextResponse.json({ error: 'A batchId is required.' }, { status: 400 });

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('spoton_import_batches')
      .delete()
      .eq('id', batchId)
      .neq('status', 'confirmed');
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, batchId });
  } catch (err) {
    console.error('spoton-import DELETE error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
