import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET } from '@/lib/document-helpers';
import {
  extractContractFinancialTerms,
  buildFinancialTermsPatch,
} from '@/lib/contract-financials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Only auto-extract from text we can read without an OCR/PDF dependency.
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // cap extraction input at 2 MB

async function loadContract(admin, documentId) {
  const { data: doc } = await admin
    .from('documents')
    .select('id, category')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc) return { doc: null, contract: null };
  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', documentId)
    .maybeSingle();
  return { doc, contract };
}

// Pull the latest version's text, if it is a text-like document. Returns
// null when the document is a PDF/binary (no OCR dependency in this slice).
async function readLatestVersionText(admin, documentId) {
  const { data: ver } = await admin
    .from('document_versions')
    .select('id, mime_type, storage_path, size_bytes')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ver || !TEXT_MIME.has(ver.mime_type)) return null;
  if (ver.size_bytes && ver.size_bytes > MAX_TEXT_BYTES) return null;
  const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(ver.storage_path);
  if (error || !blob) return null;
  const text = await blob.text();
  return text.slice(0, MAX_TEXT_BYTES);
}

// GET — return the contract's stored financial terms + columns.
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { doc, contract } = await loadContract(admin, id);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    contract: contract
      ? {
          stardust_split_percent: contract.stardust_split_percent,
          flat_fee_cents: contract.flat_fee_cents,
          revenue_share_recipient: contract.revenue_share_recipient,
          financial_terms: contract.financial_terms,
          financial_terms_source: contract.financial_terms_source,
          financial_terms_reviewed_at: contract.financial_terms_reviewed_at,
        }
      : null,
  });
}

// POST — run deterministic extraction. Body may include { text } to extract
// from pasted contract text; otherwise we try the stored text-like version.
// Extracted terms are stored as a SUGGESTION (source='extracted') and the raw
// columns are populated only when not already manually set, so an admin's
// override is never clobbered. Contract contents are NOT sent to any external
// service.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body = {};
  try { body = await request.json(); } catch { /* allow empty body */ }

  const admin = createAdminClient();
  const { doc, contract } = await loadContract(admin, id);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }
  if (!contract) {
    return NextResponse.json({ error: 'No contract record. Save contract details first.' }, { status: 404 });
  }

  let text = typeof body.text === 'string' ? body.text : null;
  if (!text) text = await readLatestVersionText(admin, id);
  if (!text) {
    return NextResponse.json(
      { error: 'No extractable text. Paste contract text, or upload a .txt/.md version. PDFs are not auto-parsed in this slice.' },
      { status: 422 },
    );
  }

  const extracted = extractContractFinancialTerms(text);

  // Don't overwrite a value an admin already set manually.
  const manual = contract.financial_terms_source === 'manual' || contract.financial_terms_source === 'extracted_edited';
  const patch = {
    financial_terms: { ...extracted, extractedAt: new Date().toISOString() },
    financial_terms_source: 'extracted',
    extracted_text: text.slice(0, 100000),
  };
  if (!manual) {
    if (extracted.stardustSplitPercent != null) patch.stardust_split_percent = extracted.stardustSplitPercent;
    if (extracted.flatFeeCents != null) patch.flat_fee_cents = extracted.flatFeeCents;
    if (extracted.revenueShareRecipient) patch.revenue_share_recipient = extracted.revenueShareRecipient;
  }

  const { error } = await admin.from('document_contracts').update(patch).eq('document_id', id);
  if (error) {
    console.error('[contract.financials.extract] error', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await audit({
    admin, action: 'contract_status_change', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { event: 'financial_terms_extracted', matched: extracted.matched },
  });

  return NextResponse.json({ ok: true, extracted, applied: !manual });
}

// PUT — admin manual override of the structured financial terms. Marks the
// source as 'manual' so future extractions won't clobber it.
export async function PUT(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const built = buildFinancialTermsPatch(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const admin = createAdminClient();
  const { doc, contract } = await loadContract(admin, id);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (!contract) return NextResponse.json({ error: 'No contract record. Save contract details first.' }, { status: 404 });

  const patch = {
    ...built.patch,
    financial_terms_source: contract.financial_terms_source === 'extracted' ? 'extracted_edited' : 'manual',
    financial_terms_reviewed_at: new Date().toISOString(),
  };

  const { error } = await admin.from('document_contracts').update(patch).eq('document_id', id);
  if (error) {
    console.error('[contract.financials.override] error', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await audit({
    admin, action: 'contract_status_change', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { event: 'financial_terms_override', fields: Object.keys(built.patch) },
  });

  const { data: updated } = await admin
    .from('document_contracts')
    .select('stardust_split_percent, flat_fee_cents, revenue_share_recipient, financial_terms, financial_terms_source, financial_terms_reviewed_at')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contract: updated });
}
