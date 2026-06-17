// SignNow e-signature integration — SERVER ONLY.
//
// NEVER import this module from a client component. It reads server-only env
// vars (no NEXT_PUBLIC_ prefix) and must only run inside route handlers after
// requireAdmin()/requireAdminMfa() has gated the request.
//
// STATUS: real client wiring against SignNow's documented REST API, but every
// network path is GATED behind isSignNowConfigured(). With no credentials set,
// nothing here ever touches the network: each call throws a clear
// SignNowNotConfiguredError first. This keeps the build green and lets the
// contract UI code against a stable interface today, while being ready the
// moment credentials are added — no further code change required for the happy
// path. Endpoint shapes that we could not verify against a live account are
// marked with TODO and isolated so a mismatch fails loudly rather than silently
// corrupting contract state.
//
// AUTHENTICATION (per https://docs.signnow.com/docs/signnow/authentication)
// ---------------------------------------------------------------------------
// SignNow uses OAuth2. Every API endpoint EXCEPT POST /oauth2/token requires a
// Bearer *access token*. Access tokens are short-lived-ish (≈30 days) and are
// minted from an API app's client_id/client_secret (a base64 "Basic" token)
// plus a grant. We deliberately support the two grants that DO NOT require us
// to store an end-user password, because the operator signs in to SignNow with
// Google SSO and has no separate SignNow password to give us:
//
//   PRIMARY  — pre-minted bearer token:
//     Set SIGNNOW_API_KEY to a valid OAuth2 access token (generated once in the
//     SignNow API dashboard or via the token endpoint). This is the ONLY var
//     required for isSignNowConfigured() to report true. Rotate it ~monthly.
//
//   OPTIONAL — refresh-token grant (SSO-friendly, no stored password):
//     Additionally set SIGNNOW_BASIC_TOKEN (base64 of client_id:client_secret)
//     and SIGNNOW_REFRESH_TOKEN (obtained once via the authorization_code flow,
//     which works with Google SSO). getAccessToken() will then mint a fresh
//     bearer without anyone re-entering credentials. This keeps long-running
//     deployments alive past the 30-day access-token expiry.
//
// We intentionally do NOT implement the password grant: it would require
// storing a SignNow username + password, which is incompatible with Google SSO
// and a credential we explicitly avoid persisting.
//
// Required / optional env vars (add server-side, NO NEXT_PUBLIC_ prefix):
//   SIGNNOW_API_BASE_URL   default https://api.signnow.com
//   SIGNNOW_API_KEY        REQUIRED — OAuth2 bearer access token
//   SIGNNOW_BASIC_TOKEN    optional — base64(client_id:client_secret), for refresh
//   SIGNNOW_REFRESH_TOKEN  optional — OAuth2 refresh token, for refresh
//   SIGNNOW_WEBHOOK_SECRET optional — shared secret to verify inbound webhooks

import crypto from 'node:crypto';

export class SignNowNotConfiguredError extends Error {
  constructor(missing) {
    super(
      `SignNow is not configured. Missing env var(s): ${missing.join(', ')}. ` +
      `Set them server-side (no NEXT_PUBLIC_ prefix) before sending contracts.`
    );
    this.name = 'SignNowNotConfiguredError';
    this.code = 'SIGNNOW_NOT_CONFIGURED';
  }
}

// Thrown when SignNow returns a non-2xx response. Carries the HTTP status and a
// trimmed body so callers can log/surface a useful message without leaking the
// full payload.
export class SignNowApiError extends Error {
  constructor(status, body) {
    super(`SignNow API error (${status}): ${String(body || '').slice(0, 300)}`);
    this.name = 'SignNowApiError';
    this.code = 'SIGNNOW_API_ERROR';
    this.status = status;
  }
}

const REQUIRED_ENV = ['SIGNNOW_API_KEY'];

export function isSignNowConfigured() {
  return REQUIRED_ENV.every((k) => Boolean(process.env[k]));
}

// True when the SSO-friendly refresh-token grant is fully configured, so
// getAccessToken() can mint a fresh bearer without any stored password.
export function isSignNowRefreshConfigured() {
  return ['SIGNNOW_BASIC_TOKEN', 'SIGNNOW_REFRESH_TOKEN'].every((k) => Boolean(process.env[k]));
}

function assertConfigured() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) throw new SignNowNotConfiguredError(missing);
}

function baseUrl() {
  return (process.env.SIGNNOW_API_BASE_URL || 'https://api.signnow.com').replace(/\/+$/, '');
}

function bearerHeaders() {
  return {
    Authorization: `Bearer ${process.env.SIGNNOW_API_KEY}`,
    Accept: 'application/json',
  };
}

// Thin fetch wrapper that throws SignNowApiError on non-2xx and parses JSON.
// Never called unless assertConfigured() has already passed.
async function apiFetch(path, { method = 'GET', headers = {}, body = null } = {}) {
  const res = await fetch(`${baseUrl()}${path}`, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Mint a fresh OAuth2 access token from the configured refresh token. This is
 * the SSO-friendly path: it needs only the API app's base64 Basic token plus a
 * previously obtained refresh token — NO username/password. Only usable when
 * isSignNowRefreshConfigured() is true; deployments that rotate SIGNNOW_API_KEY
 * by hand can skip this entirely.
 *
 * Basic Auth is valid ONLY at POST /oauth2/token (per SignNow docs); every
 * other endpoint uses the Bearer token returned here.
 * @returns {Promise<{ access_token: string, expires_in: number, refresh_token?: string }>}
 */
export async function getAccessToken() {
  assertConfigured();
  if (!isSignNowRefreshConfigured()) {
    throw new SignNowNotConfiguredError(['SIGNNOW_BASIC_TOKEN', 'SIGNNOW_REFRESH_TOKEN']);
  }
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.SIGNNOW_REFRESH_TOKEN,
    scope: '*',
  });
  return apiFetch('/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${process.env.SIGNNOW_BASIC_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
  });
}

// ---------------------------------------------------------------------------
// Documents + invites
// ---------------------------------------------------------------------------

/**
 * Upload a document to SignNow and create a signing invite.
 * @param {object} args
 * @param {Buffer|Uint8Array} args.fileBuffer  raw bytes of the PDF to send
 * @param {string} args.filename
 * @param {Array<{name:string,email:string,order:number,role:string}>} args.signers
 * @param {string} [args.subject]
 * @param {string} [args.message]
 * @param {string} [args.fromEmail]  sender email (defaults to SIGNNOW_SENDER_EMAIL)
 * @returns {Promise<{ envelopeId: string, status: string }>}
 */
export async function sendForSignature({ fileBuffer, filename, signers = [], subject, message, fromEmail } = {}) {
  assertConfigured();
  if (!fileBuffer || !fileBuffer.length) throw new Error('sendForSignature: fileBuffer is required');
  if (!Array.isArray(signers) || signers.length === 0) throw new Error('sendForSignature: at least one signer is required');

  // 1) Upload the document (multipart). Returns { id }.
  const fd = new FormData();
  const bytes = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), filename || 'contract.pdf');
  const uploaded = await apiFetch('/document', {
    method: 'POST',
    headers: bearerHeaders(), // do NOT set Content-Type; fetch sets the multipart boundary
    body: fd,
  });
  const documentId = uploaded?.id;
  if (!documentId) throw new SignNowApiError(502, 'upload returned no document id');

  // 2) Create a field invite. SignNow expects `to` entries ordered by signing
  //    step. We map our normalized signer shape onto that.
  // TODO(verify-against-live): confirm the exact invite payload shape for this
  // account type (free-form invite vs. role-based template invite). The shape
  // below follows SignNow's documented field-invite API.
  const to = signers
    .slice()
    .sort((a, b) => (a.order || 1) - (b.order || 1))
    .map((s, i) => ({
      email: s.email,
      role_id: '',
      role: s.role === 'approver' ? 'Approver' : 'Signer',
      order: s.order || i + 1,
      prefill_signature_name: s.name || undefined,
    }));

  const invite = await apiFetch(`/document/${encodeURIComponent(documentId)}/invite`, {
    method: 'POST',
    headers: { ...bearerHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: fromEmail || process.env.SIGNNOW_SENDER_EMAIL || undefined,
      subject: subject || 'Please sign this contract',
      message: message || 'A contract from Stardust Garage is ready for your signature.',
    }),
  });
  void invite;

  return { envelopeId: documentId, status: 'sent' };
}

// Map a SignNow document's field_invites[].status set onto our contract status
// vocabulary. Exported + pure so it is unit-testable without network access.
//   - all signed              -> 'signed'
//   - some signed, some not   -> 'partially_signed'
//   - any declined            -> 'declined'
//   - any expired (none signed) -> 'expired'
//   - otherwise (pending)     -> 'sent'
export function mapInviteStatusToContract(fieldInvites = []) {
  const statuses = (fieldInvites || []).map((f) => String(f?.status || '').toLowerCase());
  if (statuses.length === 0) return 'sent';
  const isSigned = (s) => s === 'fulfilled' || s === 'signed' || s === 'completed';
  const signedCount = statuses.filter(isSigned).length;
  if (statuses.some((s) => s === 'declined')) return 'declined';
  if (signedCount === statuses.length) return 'signed';
  if (signedCount > 0) return 'partially_signed';
  if (statuses.every((s) => s === 'expired')) return 'expired';
  return 'sent';
}

/**
 * Fetch the current signing status of an envelope/document.
 * @param {string} envelopeId
 * @returns {Promise<{ status: string, signers: Array<{email:string,status:string,signed_at:string|null}> }>}
 */
export async function getSignatureStatus(envelopeId) {
  assertConfigured();
  if (!envelopeId) throw new Error('getSignatureStatus: envelopeId is required');
  const doc = await apiFetch(`/document/${encodeURIComponent(envelopeId)}`, { headers: bearerHeaders() });
  // SignNow nests field invites under `field_invites`. Be defensive: tolerate
  // either an array or a missing key.
  const fieldInvites = Array.isArray(doc?.field_invites) ? doc.field_invites : [];
  const signers = fieldInvites.map((f) => ({
    email: String(f?.email || '').toLowerCase(),
    status: String(f?.status || 'pending').toLowerCase(),
    signed_at: f?.updated ? new Date(Number(f.updated) * 1000).toISOString() : null,
  }));
  return { status: mapInviteStatusToContract(fieldInvites), signers };
}

/**
 * Download the (possibly signed) document bytes.
 * @param {string} envelopeId
 * @param {boolean} [collapsed=true] download flattened/signed copy
 * @returns {Promise<Buffer>}
 */
export async function downloadSignedDocument(envelopeId, collapsed = true) {
  assertConfigured();
  if (!envelopeId) throw new Error('downloadSignedDocument: envelopeId is required');
  const type = collapsed ? 'collapsed' : 'document';
  const res = await fetch(
    `${baseUrl()}/document/${encodeURIComponent(envelopeId)}/download?type=${type}`,
    { headers: bearerHeaders() },
  );
  if (!res.ok) throw new SignNowApiError(res.status, await res.text());
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Constant-time compare of two strings. Returns false on length mismatch
// (length is not secret) and never throws.
function timingSafeStrEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Normalize a signature header value SignNow (or a proxy) might send. We accept,
// case-insensitively, an optional algorithm prefix in any of the common shapes:
//   "sha256=<sig>", "sha256 <sig>", "v1=<sig>"
// and trim surrounding whitespace. Returns the bare signature token.
function stripSignaturePrefix(headerValue) {
  let v = String(headerValue).trim();
  const m = /^(?:sha-?256|v1)\s*[=\s]\s*(.+)$/i.exec(v);
  if (m) v = m[1].trim();
  return v;
}

/**
 * Verify an inbound SignNow webhook signature using SIGNNOW_WEBHOOK_SECRET.
 * SignNow signs the raw request body with HMAC-SHA256; vendors/proxies encode it
 * differently, so we accept the digest in any of: base64, base64url, or hex,
 * with an optional `sha256=`/`v1=` prefix. We compute each encoding of the
 * expected digest and constant-time compare against the (prefix-stripped)
 * header. Returns true/false; never throws on bad input. Returns false (reject)
 * when no secret is configured so an unconfigured environment can't be spoofed.
 * @param {string} rawBody
 * @param {string} signatureHeader
 * @returns {boolean}
 */
export function verifyWebhook(rawBody, signatureHeader) {
  const secret = process.env.SIGNNOW_WEBHOOK_SECRET;
  if (!secret || typeof rawBody !== 'string' || typeof signatureHeader !== 'string') return false;
  try {
    const provided = stripSignaturePrefix(signatureHeader);
    if (!provided) return false;
    const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    // Compare against every encoding SignNow might use. Each comparison is
    // constant-time; the set of candidates we try is not secret.
    const candidates = [
      hmac.toString('base64'),
      hmac.toString('base64url'),
      hmac.toString('hex'),
    ];
    return candidates.some((expected) => timingSafeStrEqual(expected, provided));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inbound webhook parsing (pure — no network, unit-testable)
// ---------------------------------------------------------------------------

// SignNow's webhook payloads vary by event type and account, and the docs leave
// some shapes underspecified. Rather than trust one exact shape, we probe a set
// of well-known key paths defensively. Anything we can't find comes back null so
// the caller decides what to do (usually: ack 200 and skip) instead of throwing.

// Pull the SignNow document/envelope id out of a parsed webhook payload. We map
// document id -> our `external_envelope_id` (sendForSignature returns the
// uploaded document id as the envelope id). Returns a string or null.
export function parseWebhookEnvelopeId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.document_id,
    payload.documentId,
    payload.entity_id,
    payload.entityId,
    payload?.meta?.document_id,
    payload?.content?.document_id,
    payload?.data?.document_id,
    payload?.document?.id,
    payload?.event?.document_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

// Sentinel returned by parseWebhookContractStatus when the event is a positive
// signing signal we can't safely map to a CONTRACT-LEVEL status from its name
// alone (e.g. a single-signer "invite.signer.signed" with no field_invites in
// the payload). The caller MUST resolve it by re-fetching the authoritative
// status via getSignatureStatus(envelopeId) rather than assuming completion.
// This prevents one signer's event from prematurely marking the whole contract
// signed (which would lock it terminal and archive an unfinished PDF).
export const WEBHOOK_STATUS_RECHECK = 'recheck';

// Event-name tokens that refer to the DOCUMENT/ENVELOPE as a whole (not a single
// signer/invite). Only these may map directly to a terminal 'signed' from the
// name alone. A SignNow document is fully signed when the document itself
// completes — per-signer events do not imply that.
function isDocumentLevelEvent(event) {
  // e.g. "document.complete", "document.completed", "document.fulfilled".
  return /(?:^|[._-])document[._-]/.test(event) || event.startsWith('document');
}

// Normalize the webhook's event/status descriptor into our contract status
// vocabulary. Returns one of:
//   * a contract status ('signed' | 'declined' | 'expired' | 'partially_signed' | 'sent')
//   * WEBHOOK_STATUS_RECHECK — a positive signing signal that needs an
//     authoritative re-fetch before we trust it (per-signer "signed" events)
//   * null — not a status we track (ack + skip)
//
// SignNow emits event names like "document.complete", "document.update",
// "invite.<role>.signed", etc. When the payload carries a field_invites array
// (same shape getSignatureStatus reads) we trust it directly via
// mapInviteStatusToContract — that's the authoritative, signer-by-signer view.
export function parseWebhookContractStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // Prefer an explicit field_invites array when present — most reliable, since
  // it reflects EVERY signer's state, not just the one that fired the event.
  const fieldInvites =
    (Array.isArray(payload.field_invites) && payload.field_invites) ||
    (Array.isArray(payload?.content?.field_invites) && payload.content.field_invites) ||
    (Array.isArray(payload?.document?.field_invites) && payload.document.field_invites) ||
    null;
  if (fieldInvites) return mapInviteStatusToContract(fieldInvites);

  const event = String(
    payload.event || payload.event_type || payload.eventType || payload.meta?.event || '',
  ).toLowerCase();
  if (!event) return null;

  // Declines/expirations are safe to map directly: a single decline/expire is a
  // legitimate forward signal and the forward-only state machine guards misuse.
  if (event.includes('decline')) return 'declined';
  if (event.includes('expire')) return 'expired';

  // Positive signing signal. Only a DOCUMENT-LEVEL completion event may map
  // straight to terminal 'signed'. A per-signer/invite "signed"/"fulfilled"
  // event proves one signer finished, NOT that the contract is complete — defer
  // to an authoritative re-fetch instead of guessing.
  const positive = event.includes('complete') || event.includes('signed') || event.includes('fulfill');
  if (positive) {
    return isDocumentLevelEvent(event) ? 'signed' : WEBHOOK_STATUS_RECHECK;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signed-PDF archive decision (pure — unit-testable)
// ---------------------------------------------------------------------------

// Canonical filename for an archived signed PDF. Encodes the envelope id so the
// archive is idempotent: we can detect "already archived" by scanning existing
// version filenames for this exact name, with no extra schema/columns.
export function archivedSignedFilename(envelopeId) {
  const safe = String(envelopeId || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `signnow-signed-${safe}.pdf`;
}

// Decide whether to archive the signed PDF for a contract. Pure so the policy is
// testable without touching the network or storage. Returns
//   { archive: boolean, reason: string, filename?: string }
// We archive only when:
//   * the contract is in a fully-signed state,
//   * there IS an envelope id to download, and
//   * no existing version already carries the canonical archived filename
//     (idempotency — repeated sync/webhook must not create duplicates).
export function decideSignedArchive({ status, envelopeId, existingFilenames = [] } = {}) {
  if (status !== 'signed') {
    return { archive: false, reason: 'contract is not fully signed' };
  }
  if (!envelopeId) {
    return { archive: false, reason: 'no SignNow envelope id' };
  }
  const filename = archivedSignedFilename(envelopeId);
  const already = (existingFilenames || []).some((f) => f === filename);
  if (already) {
    return { archive: false, reason: 'signed PDF already archived', filename };
  }
  return { archive: true, reason: 'signed PDF not yet archived', filename };
}
