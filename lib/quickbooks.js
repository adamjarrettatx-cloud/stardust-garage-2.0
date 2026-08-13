// QuickBooks Online OAuth 2.0 + Accounting API helper.
//
// Mirrors the shape of lib/tickettailor.js: this file is I/O only (fetch
// calls). The pure category-mapping / row-building logic lives in
// lib/quickbooks-ledger.js; the Supabase glue lives in lib/quickbooks-db.js.
//
// Requires these env vars (set in Vercel — never commit real values):
//   QUICKBOOKS_CLIENT_ID     - Intuit Developer app Client ID
//   QUICKBOOKS_CLIENT_SECRET - Intuit Developer app Client Secret (also used
//                               as the HMAC key for the OAuth state token —
//                               see createState/verifyState below)
//   QUICKBOOKS_REDIRECT_URI  - must exactly match a redirect URI registered
//                               on the Intuit app, e.g.
//                               https://sdgatx.com/api/admin/financial-ledger/quickbooks/callback
// Optional:
//   QUICKBOOKS_ENVIRONMENT   - 'sandbox' or 'production' (default 'production')

import crypto from 'crypto';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

export function isQuickBooksConfigured() {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI);
}

function apiBase() {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

// ---------------------------------------------------------------------------
// Stateless CSRF token for the OAuth round trip. No session/cookie storage:
// the payload is just a timestamp, HMAC-signed with the client secret. The
// callback re-signs the payload it receives and does a constant-time compare
// against the mac, then checks the timestamp is recent. This survives the
// full redirect-to-Intuit-and-back trip on serverless without needing a
// shared store.
// ---------------------------------------------------------------------------
function signPayload(payload) {
  return crypto.createHmac('sha256', env('QUICKBOOKS_CLIENT_SECRET')).update(payload).digest('hex');
}

export function createState() {
  const payload = String(Date.now());
  return `${payload}.${signPayload(payload)}`;
}

export function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return false;
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return false;
  let expected;
  try {
    expected = signPayload(payload);
  } catch {
    return false;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const ts = Number(payload);
  return Number.isFinite(ts) && Date.now() - ts <= maxAgeMs;
}

// Step 1 of OAuth: where "Connect QuickBooks" sends the browser (a real
// top-level navigation — the whole point is to leave the app for Intuit's
// consent screen, so this is never called via fetch/XHR).
export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: env('QUICKBOOKS_CLIENT_ID'),
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: env('QUICKBOOKS_REDIRECT_URI'),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  const id = env('QUICKBOOKS_CLIENT_ID');
  const secret = env('QUICKBOOKS_CLIENT_SECRET');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`QuickBooks token error (${res.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body; // { access_token, refresh_token, expires_in, x_refresh_token_expires_in, token_type }
}

// Step 2 of OAuth: exchange the authorization code the callback received for
// the first access/refresh token pair.
export async function exchangeCodeForTokens(code) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env('QUICKBOOKS_REDIRECT_URI'),
  }));
}

// QBO access tokens last ~1 hour; refresh tokens last ~100 days of activity
// and ROTATE on every use (a new refresh_token comes back and the old one
// stops working), so the caller must persist the new pair every time this
// runs — see ensureFreshAccessToken in the sync-quickbooks route.
export async function refreshTokens(refreshToken) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

// Authenticated fetch against a company's Accounting API. Throws with the
// QBO fault payload on a non-2xx.
export async function qboFetch(realmId, accessToken, path) {
  const res = await fetch(`${apiBase()}/v3/company/${realmId}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`QuickBooks API error (${res.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

// Runs QBO's SQL-like Query endpoint against one entity, paginating via
// STARTPOSITION until a page comes back short of MAXRESULTS. Every caller in
// this file builds `whereClause` itself from fixed templates (see
// quoteSince below) — nothing here ever inlines end-user text.
export async function qboQuery(realmId, accessToken, entity, whereClause, { pageSize = 1000, maxPages = 20 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const startPosition = page * pageSize + 1;
    const query = `select * from ${entity}${whereClause ? ` where ${whereClause}` : ''} startposition ${startPosition} maxresults ${pageSize}`;
    const result = await qboFetch(realmId, accessToken, `/query?query=${encodeURIComponent(query)}&minorversion=65`);
    const rows = result?.QueryResponse?.[entity] || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// `since` is a Date, ISO string, or YYYY-MM-DD. Filtering on
// Metadata.LastUpdatedTime (not TxnDate) catches edits to already-synced
// transactions as well as brand-new ones.
export function quoteSince(since) {
  const iso = since instanceof Date ? since.toISOString() : new Date(since).toISOString();
  return `Metadata.LastUpdatedTime >= '${iso}'`;
}

export async function listPurchasesSince(realmId, accessToken, since) {
  return qboQuery(realmId, accessToken, 'Purchase', quoteSince(since));
}

export async function listDepositsSince(realmId, accessToken, since) {
  return qboQuery(realmId, accessToken, 'Deposit', quoteSince(since));
}

export async function listJournalEntriesSince(realmId, accessToken, since) {
  return qboQuery(realmId, accessToken, 'JournalEntry', quoteSince(since));
}
