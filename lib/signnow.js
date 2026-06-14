// SignNow e-signature integration — SERVER ONLY.
//
// NEVER import this module from a client component. It reads server-only env
// vars (no NEXT_PUBLIC_ prefix) and must only run inside route handlers after
// requireAdmin() has gated the request.
//
// STATUS: scaffolding. No real SignNow credentials are configured yet, so the
// network calls below are intentionally NOT implemented — each throws a clear
// SignNowNotConfiguredError when credentials are absent, and the actual API
// wiring is left as a documented TODO. This keeps the build green and lets the
// contract UI call a stable interface today.
//
// Required env vars (add to Vercel / .env once an account exists):
//   SIGNNOW_API_BASE_URL   default https://api.signnow.com
//   SIGNNOW_API_KEY        OAuth2 bearer token OR basic app token
//   SIGNNOW_CLIENT_ID      (if using OAuth2 password grant)
//   SIGNNOW_CLIENT_SECRET  (if using OAuth2 password grant)
//   SIGNNOW_USERNAME       (if using OAuth2 password grant)
//   SIGNNOW_PASSWORD       (if using OAuth2 password grant)
//   SIGNNOW_WEBHOOK_SECRET shared secret to verify inbound status webhooks

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

export class SignNowNotImplementedError extends Error {
  constructor(fn) {
    super(`SignNow.${fn}() is scaffolded but not yet implemented.`);
    this.name = 'SignNowNotImplementedError';
    this.code = 'SIGNNOW_NOT_IMPLEMENTED';
  }
}

const REQUIRED_ENV = ['SIGNNOW_API_KEY'];

export function isSignNowConfigured() {
  return REQUIRED_ENV.every((k) => Boolean(process.env[k]));
}

function assertConfigured() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) throw new SignNowNotConfiguredError(missing);
}

function baseUrl() {
  return process.env.SIGNNOW_API_BASE_URL || 'https://api.signnow.com';
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SIGNNOW_API_KEY}`,
    Accept: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Typed interface (JSDoc) — the contract layer codes against these signatures.
// ---------------------------------------------------------------------------

/**
 * Upload a document to SignNow and create a signing invite.
 * @param {object} args
 * @param {Buffer} args.fileBuffer  raw bytes of the PDF to send
 * @param {string} args.filename
 * @param {Array<{name:string,email:string,order:number,role:string}>} args.signers
 * @param {string} [args.subject]
 * @param {string} [args.message]
 * @returns {Promise<{ envelopeId: string, status: string }>}
 */
export async function sendForSignature(/* args */) {
  assertConfigured();
  // TODO: POST {baseUrl}/document  (multipart upload) -> documentId
  // TODO: POST {baseUrl}/document/{documentId}/invite (field invite) with signers
  // TODO: return { envelopeId: documentId, status: 'sent' }
  void baseUrl; void authHeaders;
  throw new SignNowNotImplementedError('sendForSignature');
}

/**
 * Fetch the current signing status of an envelope/document.
 * @param {string} envelopeId
 * @returns {Promise<{ status: string, signers: Array<{email:string,status:string,signed_at:string|null}> }>}
 */
export async function getSignatureStatus(/* envelopeId */) {
  assertConfigured();
  // TODO: GET {baseUrl}/document/{envelopeId} -> map field_invites[].status
  throw new SignNowNotImplementedError('getSignatureStatus');
}

/**
 * Download the (possibly signed) document bytes.
 * @param {string} envelopeId
 * @param {boolean} [collapsed=true] download flattened/signed copy
 * @returns {Promise<Buffer>}
 */
export async function downloadSignedDocument(/* envelopeId, collapsed = true */) {
  assertConfigured();
  // TODO: GET {baseUrl}/document/{envelopeId}/download?type=collapsed
  throw new SignNowNotImplementedError('downloadSignedDocument');
}

/**
 * Verify an inbound SignNow webhook signature using SIGNNOW_WEBHOOK_SECRET.
 * Returns true/false; never throws on bad input.
 * @param {string} rawBody
 * @param {string} signatureHeader
 * @returns {boolean}
 */
export function verifyWebhook(/* rawBody, signatureHeader */) {
  // TODO: HMAC-SHA256(rawBody, SIGNNOW_WEBHOOK_SECRET) === signatureHeader
  // Until implemented, treat all webhooks as unverified (reject upstream).
  return false;
}
