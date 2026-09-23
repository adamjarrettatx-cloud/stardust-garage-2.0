// Server-only by construction: import exclusively from API routes.
// Deliberately NO recipient lookup, onboarding, or direct-send API.
// Recipient lookups can return raw banking information. IDs are linked manually.
import { PAYOUT_UUID } from './artist-payout-helpers';

export class MercuryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function mercuryConfig(env = process.env) {
  const mode = env.MERCURY_ENVIRONMENT;
  const ready = ['sandbox', 'production'].includes(mode)
    && Boolean(env.MERCURY_API_KEY)
    && PAYOUT_UUID.test(env.MERCURY_ACCOUNT_ID || '')
    && !(env.VERCEL_ENV && env.VERCEL_ENV !== 'production' && mode === 'production');
  return {
    configured: ready,
    enabled: env.ARTIST_PAY_MERCURY_ENABLED === 'true' && ready,
    mode,
    accountId: env.MERCURY_ACCOUNT_ID?.toLowerCase(),
    token: env.MERCURY_API_KEY,
    baseUrl: mode === 'sandbox'
      ? 'https://api-sandbox.mercury.com/api/v1'
      : 'https://api.mercury.com/api/v1',
  };
}

// Read-only deployment preflight. Does not depend on the queue enable flag.
// Fetches the owner's account list only to identify the configured source.
// No recipient lookup. All unrelated account data is discarded.
// Never return/log full account payloads, balances, routing/account numbers.
export async function checkMercuryConnection({ config = mercuryConfig(), fetchImpl = fetch } = {}) {
  if (!config.configured) {
    return { configured: false, verified: false, queue_enabled: false };
  }
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/accounts`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MercuryError('connection_failed', 'Could not securely connect to Mercury. No payment request was created.');
  }
  if (!response.ok) {
    // Do not echo Mercury's body or fetch exception: either can contain secrets.
    throw new MercuryError(`http_${response.status}`, `Mercury connection check returned HTTP ${response.status}. No payment request was created.`);
  }
  let data;
  try { data = await response.json(); } catch {
    throw new MercuryError('invalid_response', 'Mercury returned an unreadable account response.');
  }
  const accounts = Array.isArray(data?.accounts) ? data.accounts : null;
  if (!accounts) throw new MercuryError('invalid_response', 'Mercury returned an unexpected account response.');
  const matches = accounts.filter((account) => account?.id === config.accountId);
  if (matches.length !== 1) {
    throw new MercuryError('account_not_found', 'The configured source-account ID was not returned exactly once by Mercury. Keep payouts disabled.');
  }
  const account = matches[0];
  return {
    configured: true, verified: true, queue_enabled: config.enabled,
    environment: config.mode,
    account: {
      id: account.id,
      name: typeof account.name === 'string' ? account.name.slice(0, 160) : null,
      nickname: typeof account.nickname === 'string' ? account.nickname.slice(0, 160) : null,
      status: typeof account.status === 'string' ? account.status.slice(0, 40) : null,
    },
    // A read-only account lookup proves neither request permission nor
    // self-approval eligibility. The sandbox approval test is still required.
    approval_tested: false,
  };
}

export function approvalPayload(payout) {
  if (!Number.isSafeInteger(payout.amount_cents) || payout.amount_cents <= 0
      || !PAYOUT_UUID.test(payout.mercury_recipient_id)
      || !PAYOUT_UUID.test(payout.idempotency_key)) {
    throw new MercuryError('invalid_snapshot', 'Invalid payout snapshot. Nothing was sent.');
  }
  return {
    recipientId: payout.mercury_recipient_id,
    amount: payout.amount_cents / 100,
    paymentMethod: 'ach',
    idempotencyKey: payout.idempotency_key,
    note: `SDG artist pay ${payout.pay_request_id}`,
  };
}

// Allowlist the response; never persist or log the original Mercury object.
export function normalizeApproval(data, payout) {
  const statuses = { pendingApproval: 'pending_approval', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' };
  if (!data || !PAYOUT_UUID.test(data.requestId || '')
      || (payout.mercury_request_id && data.requestId !== payout.mercury_request_id)
      || data.recipientId !== payout.mercury_recipient_id
      || data.accountId !== payout.mercury_account_id
      || data.paymentMethod !== 'ach'
      || typeof data.amount !== 'number'
      || Math.abs(data.amount * 100 - payout.amount_cents) > 0.000001
      || !Number.isFinite(data.amount)
      || !statuses[data.status]) {
    throw new MercuryError('unexpected_response', 'Mercury returned an unexpected response. Check Mercury before taking further action.');
  }
  return { mercury_request_id: data.requestId, status: statuses[data.status] };
}

export async function mercuryApproval(payout, { refresh = false, config = mercuryConfig(), fetchImpl = fetch } = {}) {
  if (!config.enabled) throw new MercuryError('disabled', 'Mercury queueing is not enabled.');
  if (payout.environment !== config.mode || payout.mercury_account_id !== config.accountId) {
    throw new MercuryError('config_changed', 'Mercury account or environment changed. Reconcile this request before continuing.');
  }
  if (!PAYOUT_UUID.test(payout.mercury_account_id || '')
      || (refresh && !PAYOUT_UUID.test(payout.mercury_request_id || ''))) {
    throw new MercuryError('invalid_snapshot', 'Invalid Mercury reference.');
  }
  const path = refresh
    ? `/request-send-money/${payout.mercury_request_id}`
    : `/account/${payout.mercury_account_id}/request-send-money`;
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: refresh ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      ...(refresh ? {} : { body: JSON.stringify(approvalPayload(payout)) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MercuryError('network_unconfirmed', 'Mercury could not be reached. The submission may have succeeded; check Mercury or retry the same request.');
  }
  // A duplicate-key 409 is usable ONLY when it contains the matching request.
  // All other failures remain unconfirmed; never generate a new key.
  if (!response.ok && !(response.status === 409 && !refresh)) {
    throw new MercuryError(`http_${response.status}`, `Mercury returned HTTP ${response.status}. Check Mercury before retrying.`);
  }
  let data;
  try { data = await response.json(); } catch {
    throw new MercuryError('invalid_response', 'Mercury returned an unreadable response. Check Mercury before retrying.');
  }
  return normalizeApproval(data, payout);
}
