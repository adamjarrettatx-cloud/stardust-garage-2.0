// Server-only utilities for the secure document hub.
import { createAdminClient } from '@/lib/supabase/admin';
import crypto from 'node:crypto';
import {
  downloadSignedDocument,
  decideSignedArchive,
  archivedSignedFilename,
} from '@/lib/signnow';

export const DOCUMENT_BUCKET = 'documents';

export const DOCUMENT_CATEGORIES = [
  { value: 'contracts', label: 'Contracts' },
  { value: 'finance',   label: 'Finance' },
  { value: 'sops',      label: 'SOPs' },
  { value: 'vendor',    label: 'Vendor Docs' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'team',      label: 'Team Docs' },
  { value: 'other',     label: 'Other' },
];

// Map of allowed MIME types -> friendly label.
// Restricting upload types is a defense-in-depth measure (no .exe, .html, etc.).
export const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/zip',
]);

export const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// Generate a deterministic storage path that cannot be guessed.
// Structure: <documentId>/<versionUuid>-<safeFilename>
export function buildStoragePath(documentId, filename) {
  const safe = (filename || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  const uid = crypto.randomUUID();
  return `${documentId}/${uid}-${safe}`;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Insert an audit log row. Never throws — auditing must not break the request.
export async function audit({ admin, action, documentId = null, versionId = null, actorId, actorEmail, request, details = null }) {
  try {
    await admin.from('document_audit_log').insert({
      document_id: documentId,
      version_id: versionId,
      action,
      actor_id: actorId,
      actor_email: actorEmail,
      ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request?.headers.get('user-agent') || null,
      details,
    });
  } catch (err) {
    console.error('[audit] failed to insert audit row', err);
  }
}

export function isAllowedMime(type) {
  return ALLOWED_MIME.has(type);
}

// ---------------------------------------------------------------------------
// SignNow signed-PDF archival
// ---------------------------------------------------------------------------

// Pull the existing version filenames for a document so the archive decision can
// check idempotency. Returns a string[] (possibly empty).
async function existingVersionFilenames(admin, documentId) {
  const { data } = await admin
    .from('document_versions')
    .select('filename')
    .eq('document_id', documentId);
  return (data || []).map((v) => v.filename).filter(Boolean);
}

/**
 * Download the completed/signed PDF for a contract from SignNow and store it as
 * a NEW private document version under the existing document, reusing the same
 * storage-path / checksum / version conventions as a manual upload.
 *
 * Idempotent: the archived version uses a canonical, envelope-derived filename
 * (see archivedSignedFilename). If a version with that name already exists, this
 * is a no-op and returns { archived: false, reason }. This makes it safe to call
 * repeatedly from both manual status sync and the inbound webhook.
 *
 * Caller is responsible for auth gating (admin/MFA) on the manual path and for
 * signature verification on the webhook path. This helper assumes SignNow is
 * configured and the contract is fully signed; it re-checks via
 * decideSignedArchive and bails cleanly otherwise.
 *
 * @returns {Promise<{ archived: boolean, reason: string, versionId?: string, versionNumber?: number, filename?: string }>}
 */
export async function archiveSignedContractPdf({ admin, documentId, envelopeId, actor = {}, request = null }) {
  if (!admin || !documentId || !envelopeId) {
    return { archived: false, reason: 'missing admin/documentId/envelopeId' };
  }

  const existing = await existingVersionFilenames(admin, documentId);
  const decision = decideSignedArchive({ status: 'signed', envelopeId, existingFilenames: existing });
  if (!decision.archive) {
    return { archived: false, reason: decision.reason, filename: decision.filename };
  }

  let buf;
  try {
    buf = await downloadSignedDocument(envelopeId, true);
  } catch (err) {
    console.error('[archiveSignedContractPdf] download failed', err);
    throw err;
  }
  if (!buf || !buf.length) {
    return { archived: false, reason: 'SignNow returned an empty document' };
  }

  const filename = decision.filename || archivedSignedFilename(envelopeId);
  const storagePath = buildStoragePath(documentId, filename);

  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    console.error('[archiveSignedContractPdf] storage upload failed', upErr);
    return { archived: false, reason: 'storage upload failed' };
  }

  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .insert({
      document_id: documentId,
      storage_path: storagePath,
      filename,
      mime_type: 'application/pdf',
      size_bytes: buf.length,
      checksum_sha256: sha256(buf),
      notes: `Signed copy archived from SignNow (envelope ${envelopeId}).`,
      uploaded_by: actor.id || null,
    })
    .select()
    .single();

  if (verErr) {
    // Roll back the orphaned object so a retry can re-upload cleanly.
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]).catch(() => {});
    console.error('[archiveSignedContractPdf] version insert failed', verErr);
    return { archived: false, reason: 'failed to record version' };
  }

  await audit({
    admin, action: 'contract_signed', documentId, versionId: ver.id,
    actorId: actor.id || null, actorEmail: actor.email || null, request,
    details: { source: 'signnow_archive', envelopeId, filename, version_number: ver.version_number },
  });

  return { archived: true, reason: 'archived', versionId: ver.id, versionNumber: ver.version_number, filename };
}

// Re-export a fresh admin client for callers that just want a one-liner.
export { createAdminClient };
