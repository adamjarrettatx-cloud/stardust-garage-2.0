import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET } from '@/lib/document-helpers';
import {
  isSignNowConfigured,
  sendForSignature,
  getSignatureStatus,
  downloadSignedDocument,
  SignNowNotConfiguredError,
  SignNowApiError,
} from '@/lib/signnow';
import { canTransitionContract, isTerminalContractStatus } from '@/lib/contract-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Load the latest stored version's bytes for a document so we can hand the PDF
// to SignNow. Returns { buffer, filename } or null when there is no version.
async function loadLatestFile(admin, documentId) {
  const { data: ver } = await admin
    .from('document_versions')
    .select('id, filename, storage_path, mime_type, version_number')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ver) return null;
  const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(ver.storage_path);
  if (error || !blob) return null;
  const buffer = Buffer.from(await blob.arrayBuffer());
  return { buffer, filename: ver.filename, versionId: ver.id };
}

// GET /api/admin/documents/:id/contract/signnow
//   Reports whether SignNow is wired up for this environment. With `?sync=1`
//   AND a live, configured integration, it pulls the current signature status
//   from SignNow (read-only) and reconciles the local contract record. Without
//   sync (or when unconfigured) it NEVER makes a network call — it just reports
//   `configured` so the UI can render the right controls. Always 200 for the
//   plain readiness probe so the client can render either state.
export async function GET(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from('document_contracts')
    .select('status, signature_provider, external_envelope_id, sent_at, completed_at')
    .eq('document_id', id)
    .maybeSingle();

  const search = new URL(request.url).searchParams;
  const wantSync = search.get('sync') === '1';
  const wantDownload = search.get('download') === '1';

  // Download the (signed) document straight from SignNow and stream it back.
  // Requires a live, configured integration and an existing envelope. Never
  // calls the network when unconfigured.
  if (wantDownload) {
    if (!isSignNowConfigured()) {
      return NextResponse.json(
        { error: 'SignNow is not configured.', code: 'SIGNNOW_NOT_CONFIGURED' },
        { status: 503 },
      );
    }
    if (!contract?.external_envelope_id) {
      return NextResponse.json({ error: 'No SignNow envelope on this contract yet.', code: 'NO_ENVELOPE' }, { status: 400 });
    }
    let bytes;
    try {
      bytes = await downloadSignedDocument(contract.external_envelope_id, true);
    } catch (err) {
      if (err instanceof SignNowNotConfiguredError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
      }
      console.error('[signnow.download] error', err);
      const status = err instanceof SignNowApiError ? 502 : 500;
      return NextResponse.json({ error: 'SignNow download failed.', detail: String(err?.message || err) }, { status });
    }
    await audit({
      admin, action: 'download', documentId: id,
      actorId: user.id, actorEmail: user.email, request,
      details: { source: 'signnow', envelopeId: contract.external_envelope_id },
    });
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="contract-${id}-signed.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  // Plain readiness probe — no network, no sync.
  if (!wantSync) {
    return NextResponse.json({ ok: true, configured: isSignNowConfigured(), contract: contract || null });
  }

  // Sync requested but we can't (or shouldn't) reach SignNow.
  if (!isSignNowConfigured()) {
    return NextResponse.json(
      {
        error: 'SignNow is not configured.',
        code: 'SIGNNOW_NOT_CONFIGURED',
        hint: 'Set SIGNNOW_API_KEY (server-side) to enable live status checks.',
      },
      { status: 503 },
    );
  }
  if (!contract?.external_envelope_id) {
    return NextResponse.json(
      { error: 'No SignNow envelope on this contract yet.', code: 'NO_ENVELOPE' },
      { status: 400 },
    );
  }

  let remote;
  try {
    remote = await getSignatureStatus(contract.external_envelope_id);
  } catch (err) {
    if (err instanceof SignNowNotConfiguredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    console.error('[signnow.sync] error', err);
    const status = err instanceof SignNowApiError ? 502 : 500;
    return NextResponse.json({ error: 'SignNow status check failed.', detail: String(err?.message || err) }, { status });
  }

  // Reconcile: only advance when the remote status is a VALID forward
  // transition from where we are, so a stale/odd remote read can never move a
  // contract backwards or into an illegal state.
  const patch = {};
  if (remote.status && remote.status !== contract.status && canTransitionContract(contract.status, remote.status)) {
    patch.status = remote.status;
    if (isTerminalContractStatus(remote.status) && !contract.completed_at) {
      patch.completed_at = new Date().toISOString();
    }
  }
  if (Object.keys(patch).length) {
    await admin.from('document_contracts').update(patch).eq('document_id', id);
    await audit({
      admin, action: 'contract_status_change', documentId: id,
      actorId: user.id, actorEmail: user.email, request,
      details: { from: contract.status, to: patch.status, via: 'signnow_sync' },
    });
  }

  const { data: updated } = await admin
    .from('document_contracts')
    .select('status, signature_provider, external_envelope_id, sent_at, completed_at')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    configured: true,
    synced: true,
    changed: Boolean(patch.status),
    remote,
    contract: updated || contract,
  });
}

// POST /api/admin/documents/:id/contract/signnow  -- "send for signature".
//   Makes NO live SignNow call when credentials are missing: returns 503 with a
//   clear, machine-readable reason. When configured, it uploads the document's
//   latest version + creates the signing invite via lib/signnow.js, then stamps
//   external_envelope_id / sent_at / status='sent' and audits contract_send.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('documents')
    .select('id, category')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }

  if (!isSignNowConfigured()) {
    return NextResponse.json(
      {
        error: 'SignNow is not configured.',
        code: 'SIGNNOW_NOT_CONFIGURED',
        hint: 'Set SIGNNOW_API_KEY (server-side, no NEXT_PUBLIC_ prefix) to enable sending. Until then, advance status manually.',
      },
      { status: 503 },
    );
  }

  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();
  if (!contract) {
    return NextResponse.json({ error: 'No contract record. Save details first.' }, { status: 404 });
  }
  if (isTerminalContractStatus(contract.status)) {
    return NextResponse.json({ error: `Contract is ${contract.status}; cannot send.` }, { status: 400 });
  }

  const signers = Array.isArray(contract.signers) ? contract.signers : [];
  if (signers.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one signer before sending.', code: 'NO_SIGNERS' },
      { status: 400 },
    );
  }

  const file = await loadLatestFile(admin, id);
  if (!file) {
    return NextResponse.json(
      { error: 'No uploaded document version to send.', code: 'NO_FILE' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await sendForSignature({
      fileBuffer: file.buffer,
      filename: file.filename,
      signers,
      subject: contract.counterparty_name ? `Contract for ${contract.counterparty_name}` : undefined,
    });
  } catch (err) {
    if (err instanceof SignNowNotConfiguredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    console.error('[signnow.send] error', err);
    const status = err instanceof SignNowApiError ? 502 : 500;
    return NextResponse.json(
      { error: 'SignNow send failed.', code: 'SIGNNOW_SEND_FAILED', detail: String(err?.message || err) },
      { status },
    );
  }

  const patch = {
    signature_provider: 'signnow',
    external_envelope_id: result.envelopeId,
    status: 'sent',
    sent_at: contract.sent_at || new Date().toISOString(),
  };
  const { error: updateError } = await admin
    .from('document_contracts')
    .update(patch)
    .eq('document_id', id);
  if (updateError) {
    console.error('[signnow.send] persist error', updateError);
    return NextResponse.json(
      { error: 'Sent to SignNow but failed to record locally.', envelopeId: result.envelopeId },
      { status: 500 },
    );
  }

  await audit({
    admin, action: 'contract_send', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { provider: 'signnow', envelopeId: result.envelopeId, signers: signers.length },
  });

  const { data: updated } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, sent: true, envelopeId: result.envelopeId, contract: updated });
}
