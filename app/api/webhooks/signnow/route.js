import { NextResponse } from 'next/server';
import { createAdminClient, audit, archiveSignedContractPdf } from '@/lib/document-helpers';
import {
  verifyWebhook,
  parseWebhookEnvelopeId,
  parseWebhookContractStatus,
  getSignatureStatus,
  isSignNowConfigured,
  WEBHOOK_STATUS_RECHECK,
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

// Returns { name, value } for the first signature header present, or
// { name: null, value: null }. The name (never the value) is safe to log so a
// misconfigured header name/format is diagnosable during live QA.
function readSignatureHeader(request) {
  for (const h of SIGNATURE_HEADERS) {
    const v = request.headers.get(h);
    if (v) return { name: h, value: v };
  }
  return { name: null, value: null };
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

  const { name: sigHeaderName, value: signature } = readSignatureHeader(request);
  if (!verifyWebhook(rawBody, signature)) {
    // Fail closed: bad/missing signature OR no secret configured. Log the header
    // NAME we read (never the value) so a header-name/format mismatch — the most
    // likely live-QA failure — is diagnosable from logs. See H1 in the runbook.
    console.warn(
      `[signnow.webhook] rejected: invalid or missing signature ` +
      `(header=${sigHeaderName || 'none of: ' + SIGNATURE_HEADERS.join(',')})`,
    );
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

  // Resolve the inbound event to a contract status. A per-signer "signed" event
  // can't be trusted to mean the whole contract is done — parseWebhookContractStatus
  // returns WEBHOOK_STATUS_RECHECK for those. When we get that sentinel we re-fetch
  // the AUTHORITATIVE signer-by-signer status from SignNow (same source the manual
  // sync uses) instead of guessing, so one signer can't prematurely complete/lock/
  // archive an unfinished contract. If SignNow isn't configured (can't re-fetch) or
  // the fetch fails, we skip the status change rather than risk a wrong terminal.
  let nextStatus = parseWebhookContractStatus(payload);
  if (nextStatus === WEBHOOK_STATUS_RECHECK) {
    nextStatus = null;
    if (isSignNowConfigured()) {
      try {
        const authoritative = await getSignatureStatus(envelopeId);
        nextStatus = authoritative?.status || null;
      } catch (err) {
        console.warn('[signnow.webhook] recheck getSignatureStatus failed', err);
      }
    }
  }

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

  // 2) When fully signed, archive the signed PDF into the document hub. We only
  //    attempt this when THIS event actually advanced the contract to signed
  //    (`changed`) or explicitly resolved to signed — not on every unrelated
  //    event for an already-signed contract, which would re-hit SignNow's
  //    download API needlessly (L3). The archive itself is still idempotent and
  //    best-effort: a failure here must NOT make us return 5xx, or SignNow will
  //    retry the whole event. We log + report instead.
  let archived = null;
  if (contract.status === 'signed' && (changed || nextStatus === 'signed')) {
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
