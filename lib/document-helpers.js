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

// Deterministic storage path for a signed-PDF archive: <documentId>/<filename>,
// where filename is the canonical, envelope-derived name. Unlike
// buildStoragePath (which prepends a random UUID for normal uploads), this is
// STABLE for a given document+envelope. Combined with the bucket's per-path
// uniqueness and upsert:false, two concurrent archive attempts collide on the
// SAME object key — turning a TOCTOU race into a single winner instead of two
// duplicate versions. The filename is already sanitized by archivedSignedFilename.
export function buildSignedStoragePath(documentId, filename) {
  return `${documentId}/${filename}`;
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

// Look up an already-archived signed version by its deterministic storage path.
// Returns the version row or null. Used to return a consistent "already
// archived" result when a concurrent caller won the race.
async function findVersionByStoragePath(admin, storagePath) {
  const { data } = await admin
    .from('document_versions')
    .select('id, version_number, filename')
    .eq('storage_path', storagePath)
    .maybeSingle();
  return data || null;
}

function alreadyArchivedResult(ver, filename) {
  return {
    archived: false,
    reason: 'signed PDF already archived',
    filename,
    versionId: ver?.id,
    versionNumber: ver?.version_number,
  };
}

/**
 * Download the completed/signed PDF for a contract from SignNow and store it as
 * a NEW private document version under the existing document, reusing the same
 * checksum / version conventions as a manual upload.
 *
 * Idempotent AND concurrency-safe. The archived copy is stored at a
 * DETERMINISTIC storage path (`<documentId>/signnow-signed-<envelopeId>.pdf`),
 * so two callers racing (webhook auto-archive + manual sync + the ?archive=1
 * button can all fire near-simultaneously) collide on the SAME object key.
 * `storage.upload(..., {upsert:false})` rejects the loser, and the unique
 * `document_versions.storage_path` constraint is a second backstop on insert.
 * Either way exactly one signed version is ever created; losers return the
 * winner's row as "already archived".
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

  const filename = archivedSignedFilename(envelopeId);
  const storagePath = buildSignedStoragePath(documentId, filename);

  // Fast path: a prior archive already exists. Avoids a needless SignNow
  // download in the common repeated-call case.
  const existing = await existingVersionFilenames(admin, documentId);
  const decision = decideSignedArchive({ status: 'signed', envelopeId, existingFilenames: existing });
  if (!decision.archive) {
    if (decision.reason === 'signed PDF already archived') {
      const ver = await findVersionByStoragePath(admin, storagePath);
      return alreadyArchivedResult(ver, filename);
    }
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

  // Atomic race guard #1: upload to the deterministic path with upsert:false.
  // If another archive landed first, the object already exists and this errors —
  // we then return that winner's version row instead of creating a duplicate.
  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    const ver = await findVersionByStoragePath(admin, storagePath);
    if (ver) return alreadyArchivedResult(ver, filename);
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
    // Atomic race guard #2: a unique-violation on storage_path means another
    // caller inserted the row between our upload and insert. Don't remove the
    // shared object (the winner owns it) — just return their row.
    const winner = await findVersionByStoragePath(admin, storagePath);
    if (winner) return alreadyArchivedResult(winner, filename);
    // Genuine insert failure: roll back our orphaned object so a retry is clean.
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
