import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET, archiveSignedContractPdf } from '@/lib/document-helpers';
import {
  isSignNowConfigured,
  sendForSignature,
  sendContractForSignature,
  getSignatureStatus,
  downloadSignedDocument,
  SignNowNotConfiguredError,
  SignNowApiError,
} from '@/lib/signnow';
import { canTransitionContract, isTerminalContractStatus, formatVenueDateTime } from '@/lib/contract-helpers';
import { validateLayoutAgainstSigners, buildSignNowFields } from '@/lib/contract-fields';
import { readPdfMeta, bakeBusinessFields } from '@/lib/template-helpers';
import { contractSendReadiness, defaultSignerName, defaultSignerEmail } from '@/lib/event-organizer';
import { buildContractNotification, recordContractNotification, markNotificationEmailed } from '@/lib/contract-notify';
import { sendContractSignatureRequest } from '@/lib/email';
import { resolveSiteUrl } from '@/lib/site-url';

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
  const wantArchive = search.get('archive') === '1';

  // Explicit "Archive signed PDF" action: download the signed copy from SignNow
  // and store it as a new private document version. Idempotent — repeated clicks
  // do not create duplicate versions. Requires a live integration, an envelope,
  // and a fully-signed contract.
  if (wantArchive) {
    if (!isSignNowConfigured()) {
      return NextResponse.json(
        { error: 'SignNow is not configured.', code: 'SIGNNOW_NOT_CONFIGURED' },
        { status: 503 },
      );
    }
    if (!contract?.external_envelope_id) {
      return NextResponse.json({ error: 'No SignNow envelope on this contract yet.', code: 'NO_ENVELOPE' }, { status: 400 });
    }
    if (contract.status !== 'signed') {
      return NextResponse.json(
        { error: `Contract is ${contract.status}; only fully-signed contracts can be archived.`, code: 'NOT_SIGNED' },
        { status: 400 },
      );
    }
    let result;
    try {
      result = await archiveSignedContractPdf({
        admin, documentId: id, envelopeId: contract.external_envelope_id,
        actor: { id: user.id, email: user.email }, request,
      });
    } catch (err) {
      if (err instanceof SignNowNotConfiguredError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
      }
      console.error('[signnow.archive] error', err);
      const status = err instanceof SignNowApiError ? 502 : 500;
      return NextResponse.json({ error: 'SignNow archive failed.', detail: String(err?.message || err) }, { status });
    }
    return NextResponse.json({ ok: true, ...result });
  }

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

  // When the contract is now fully signed, auto-archive the signed PDF into the
  // document hub. Idempotent + best-effort: a failure here is reported but never
  // fails the status sync (the admin can retry via the Archive button).
  let archived = null;
  const effectiveStatus = updated?.status || contract.status;
  if (effectiveStatus === 'signed') {
    try {
      const result = await archiveSignedContractPdf({
        admin, documentId: id, envelopeId: contract.external_envelope_id,
        actor: { id: user.id, email: user.email }, request,
      });
      archived = result.archived
        ? { ok: true, versionNumber: result.versionNumber }
        : { ok: false, reason: result.reason };
    } catch (err) {
      console.error('[signnow.sync] auto-archive failed', err);
      archived = { ok: false, reason: 'archive_error' };
    }
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    synced: true,
    changed: Boolean(patch.status),
    remote,
    contract: updated || contract,
    archived,
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

  // PROFILE-FIRST PRE-SEND GATE.
  //
  // The Event Contracts panel shows these same blockers, but the panel is only a
  // preview: this is the check that actually decides. It runs the identical
  // helper the UI runs, so what staff are told is exactly what is enforced, and
  // a stale tab or a direct API call can't slip an unusable contract out the door
  // (missing organizer signer email, unfilled required Stardust fields, a missing
  // Master Agreement on a template that requires one).
  const [{ data: organizer }, { data: template }] = await Promise.all([
    contract.contact_id
      ? admin
          .from('contacts')
          .select('id, display_name, legal_name, email, status, default_signer_name, default_signer_email')
          .eq('id', contract.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    contract.template_id
      ? admin
          .from('contract_templates')
          .select('id, title, kind, requires_master')
          .eq('id', contract.template_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Only gate contracts that actually carry an organizer or a typed template.
  // Legacy contracts created before this workflow have neither and must keep
  // sending exactly as they did before.
  if (contract.contact_id || template) {
    const readiness = contractSendReadiness({ contract, organizer, template });
    if (!readiness.ok) {
      return NextResponse.json(
        {
          error: readiness.errors[0],
          code: 'CONTRACT_NOT_READY',
          blockers: readiness.errors,
          warnings: readiness.warnings,
        },
        { status: 400 },
      );
    }
  }

  // A resend is any send after the first: SignNow issues a fresh envelope, so the
  // local record has to reflect that this is not the original request.
  const isResend = Boolean(contract.external_envelope_id || contract.sent_at);

  const file = await loadLatestFile(admin, id);
  if (!file) {
    return NextResponse.json(
      { error: 'No uploaded document version to send.', code: 'NO_FILE' },
      { status: 400 },
    );
  }

  const layout = Array.isArray(contract.field_layout) ? contract.field_layout : [];
  const fieldValues = contract.field_values && typeof contract.field_values === 'object' ? contract.field_values : {};
  const subject = contract.counterparty_name ? `Contract for ${contract.counterparty_name}` : undefined;

  // Pre-send guard: every signer_N referenced by a field must have a matching
  // signer, or the SignNow roles won't line up and the invite will be wrong.
  const layoutCheck = validateLayoutAgainstSigners(layout, signers);
  if (!layoutCheck.ok) {
    return NextResponse.json({ error: layoutCheck.error, code: 'LAYOUT_SIGNER_MISMATCH' }, { status: 400 });
  }

  let result;
  try {
    if (layout.length) {
      // Prepared path: bake business values into the PDF (bottom-left/points,
      // no transform), then send with ONLY the signer-fillable fields as
      // interactive SignNow fields. buildSignNowFields ignores business fields.
      const meta = await readPdfMeta(file.buffer);
      const preparedPdf = await bakeBusinessFields({
        pdfBuffer: file.buffer,
        fieldLayout: layout,
        fieldValues,
      });
      const signNowFields = buildSignNowFields(layout, meta?.pages || []);
      result = await sendContractForSignature({
        fileBuffer: Buffer.from(preparedPdf),
        filename: file.filename,
        signers,
        fields: signNowFields,
        subject,
      });
    } else {
      // Backward-compatible raw send for contracts with no field layout at all.
      result = await sendForSignature({
        fileBuffer: file.buffer,
        filename: file.filename,
        signers,
        subject,
      });
    }
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

  const nowIso = new Date().toISOString();
  const patch = {
    signature_provider: 'signnow',
    external_envelope_id: result.envelopeId,
    status: 'sent',
    // sent_at is the *first* send (kept stable for reporting); last_sent_at and
    // send_count track resends so staff can see "asked 3 times, still nothing".
    sent_at: contract.sent_at || nowIso,
    last_sent_at: nowIso,
    send_count: Number(contract.send_count || 0) + 1,
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
    admin, action: isResend ? 'contract_resend' : 'contract_send', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: {
      provider: 'signnow',
      envelopeId: result.envelopeId,
      signers: signers.length,
      send_count: patch.send_count,
      contact_id: contract.contact_id || null,
    },
  });

  // NOTIFY THE ORGANIZER (best-effort, never fails the send).
  //
  // SignNow already emails the signing invite. This is the *venue's* own record
  // and heads-up so the contract shows up in the organizer's portal and in an
  // email that matches Stardust branding. It deliberately carries no signing
  // link and no storage URL — only the authenticated portal address — so nothing
  // here can become a public route to a contract.
  if (contract.contact_id && organizer) {
    try {
      const { data: docRow } = await admin
        .from('documents')
        .select('title')
        .eq('id', id)
        .maybeSingle();
      let eventRow = null;
      if (contract.event_id) {
        const { data: ev } = await admin
          .from('events')
          .select('title, event_date')
          .eq('id', contract.event_id)
          .maybeSingle();
        eventRow = ev || null;
      }

      const payload = buildContractNotification({
        kind: isResend ? 'signature_reminder' : 'signature_requested',
        contractId: contract.id,
        documentId: id,
        contactId: contract.contact_id,
        documentTitle: docRow?.title || 'Contract',
        organizer,
        eventTitle: eventRow?.title || null,
        eventDate: eventRow?.event_date || null,
        expirationDate: contract.expiration_date || null,
        isResend,
      });
      const notificationId = await recordContractNotification({ admin, payload, createdBy: user.id });

      const toEmail = defaultSignerEmail(organizer);
      if (toEmail) {
        const sent = await sendContractSignatureRequest({
          email: toEmail,
          fullName: defaultSignerName(organizer),
          documentTitle: payload.title,
          eventLine: eventRow?.title || null,
          deadlineLabel: contract.expiration_date ? formatVenueDateTime(contract.expiration_date) : null,
          portalUrl: `${resolveSiteUrl(request)}/portal/contracts`,
          isReminder: isResend,
        });
        if (sent && notificationId) {
          await markNotificationEmailed({ admin, notificationId });
        }
      }

      await audit({
        admin, action: 'contract_notify', documentId: id,
        actorId: user.id, actorEmail: user.email, request,
        details: { kind: payload.kind, contact_id: contract.contact_id, emailed: Boolean(toEmail) },
      });
    } catch (notifyErr) {
      // The contract IS out for signature at this point. A failed courtesy
      // notification must not report the send as failed.
      console.error('[signnow.send] notify failed', notifyErr);
    }
  }

  const { data: updated } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, sent: true, envelopeId: result.envelopeId, contract: updated });
}
