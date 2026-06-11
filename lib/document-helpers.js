// Server-only utilities for the secure document hub.
import { createAdminClient } from '@/lib/supabase/admin';
import crypto from 'node:crypto';

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

// Re-export a fresh admin client for callers that just want a one-liner.
export { createAdminClient };
