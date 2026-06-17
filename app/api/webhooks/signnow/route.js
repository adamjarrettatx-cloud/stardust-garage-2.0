import { NextResponse } from 'next/server';
import { createAdminClient, audit, archiveSignedContractPdf } from '@/lib/document-helpers';
import {
  verifyWebhook,
  parseWebhookEnvelopeId,
  parseWebhookContractStatus,
} from '@/lib/signnow';
import { canTransitionContract, isTerminalContractStatus } from '@/lib/contract-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/webhooks/signnow  -- inbound SignNow event receiver.
//
// AUTH MODEL: this is the ONE contract path that is NOT admin/MFA gated, because
// SignNow (not a logged-in admin) calls it. It authenticates by HMAC signature
// instead: verifyWebhook() recomputes HMAC-SHA256(rawBody, SIGNNOW_WEBHOOK_SECRET)
// and constant-time compares it to the header. With no secret configured, the
// verify FAILS CLOSED — every request is rejected — so an unconfigured env can't
// be spoofed into mutating contract state.
//
// The handler is deliberately defensive and idempotent:
//   * Unknown/odd payload shapes are acknowledged (200) and skipped, never 500,
//     so SignNow doesn't hammer us with retries over a shape we don't model.
//   * Status only ever advances through a VALID forward transition, mirroring
//     the manual sync route — a replayed/stale event can't move a contract
//     backwards or into an illegal state.
//   * Signed-PDF archival is idempotent (canonical envelope-derived filename),
//     so repeated "complete" events store exactly one signed copy.
//
// Configure SignNow to POST here with the shared secret signature header. See
// docs/signnow-runbook.md for the exact webhook URL + setup steps.

// Header names SignNow / proxies may use for the HMAC signature. We accept any.
const SIGNATURE_HEADERS = [
  'x-signnow-signature',
  'signnow-signature',
  'x-signature',
  'signature',
];

function readSignatureHeader(request) {
  for (const h of SIGNATURE_HEADERS) {
    const v = request.headers.get(h);
    if (v) return v;
  }
  return null;
}

export async function POST(request) {
  // Raw body is required for an exact HMAC match — read it as text, never parse
  // before verifying.
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  }

  const signature = readSignatureHeader(request);
  if (!verifyWebhook(rawBody, signature)) {
    // Fail closed: bad/missing signature OR no secret configured.
    console.warn('[signnow.webhook] rejected: invalid or missing signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Authenticated but unparseable — ack so SignNow stops retrying.
    return NextResponse.json({ received: true, skipped: 'unparseable_json' });
  }

  const envelopeId = parseWebhookEnvelopeId(payload);
  if (!envelopeId) {
    return NextResponse.json({ received: true, skipped: 'no_envelope_id' });
  }

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from('document_contracts')
    .select('document_id, status, external_envelope_id, completed_at')
    .eq('external_envelope_id', envelopeId)
    .maybeSingle();

  if (!contract) {
    // Authenticated event for an envelope we don't track — ack and move on.
    return NextResponse.json({ received: true, skipped: 'no_matching_contract', envelopeId });
  }

  const documentId = contract.document_id;
  const nextStatus = parseWebhookContractStatus(payload);

  // 1) Reconcile lifecycle status (forward-only).
  let changed = false;
  if (
    nextStatus &&
    nextStatus !== contract.status &&
    canTransitionContract(contract.status, nextStatus)
  ) {
    const patch = { status: nextStatus };
    if (isTerminalContractStatus(nextStatus) && !contract.completed_at) {
      patch.completed_at = new Date().toISOString();
    }
    await admin.from('document_contracts').update(patch).eq('document_id', documentId);
    await audit({
      admin, action: 'contract_status_change', documentId,
      actorId: null, actorEmail: 'signnow-webhook', request,
      details: { from: contract.status, to: nextStatus, via: 'signnow_webhook', envelopeId },
    });
    changed = true;
    contract.status = nextStatus;
  }

  // 2) When fully signed, archive the signed PDF into the document hub. This is
  //    idempotent and best-effort: a failure here must NOT make us return 5xx,
  //    or SignNow will retry the whole event. We log + report instead.
  let archived = null;
  if (contract.status === 'signed') {
    try {
      const result = await archiveSignedContractPdf({
        admin, documentId, envelopeId,
        actor: { id: null, email: 'signnow-webhook' },
        request,
      });
      archived = result.archived ? { ok: true, versionNumber: result.versionNumber } : { ok: false, reason: result.reason };
    } catch (err) {
      console.error('[signnow.webhook] archive failed', err);
      archived = { ok: false, reason: 'archive_error' };
    }
  }

  return NextResponse.json({ received: true, envelopeId, changed, status: contract.status, archived });
}
