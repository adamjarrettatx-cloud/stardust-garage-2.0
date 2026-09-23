import { describe, expect, it, vi } from 'vitest';
import { approvalPayload, checkMercuryConnection, mercuryApproval, mercuryConfig, normalizeApproval } from '../../lib/mercury';
import { payoutBlockReason, validRecipientLink } from '../../lib/artist-payout-helpers';

const recipient = '55555555-5555-4555-8555-555555555555';
const account = '66666666-6666-4666-8666-666666666666';
const requestId = '88888888-8888-4888-8888-888888888888';
const payout = {
  pay_request_id: '33333333-3333-4333-8333-333333333333',
  mercury_recipient_id: recipient, mercury_account_id: account, amount_cents: 12345,
  idempotency_key: '77777777-7777-4777-8777-777777777777', environment: 'sandbox',
};
const response = {
  requestId, accountId: account, recipientId: recipient, amount: 123.45,
  paymentMethod: 'ach', status: 'pendingApproval',
};
const config = mercuryConfig({
  MERCURY_ENVIRONMENT: 'sandbox', MERCURY_API_KEY: 'test-only',
  MERCURY_ACCOUNT_ID: account, ARTIST_PAY_MERCURY_ENABLED: 'true',
});

describe('Mercury privacy and safety boundary', () => {
  it('locks production payments off even with a fully configured enabled environment', async () => {
    const production = mercuryConfig({
      MERCURY_ENVIRONMENT: 'production', MERCURY_API_KEY: 'test-only',
      MERCURY_ACCOUNT_ID: account, ARTIST_PAY_MERCURY_ENABLED: 'true', VERCEL_ENV: 'production',
    });
    expect(production.configured).toBe(true);
    expect(production.enabled).toBe(false);
    const fetchImpl = vi.fn();
    await expect(mercuryApproval({ ...payout, environment: 'production' }, { config: production, fetchImpl }))
      .rejects.toMatchObject({ code: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('fails closed when configuration is absent or malformed', () => {
    expect(mercuryConfig({}).enabled).toBe(false);
    expect(mercuryConfig({ MERCURY_ENVIRONMENT: 'https://attacker.test' }).enabled).toBe(false);
    expect(mercuryConfig({ MERCURY_API_KEY: 'test', MERCURY_ACCOUNT_ID: account, MERCURY_ENVIRONMENT: 'production' }).enabled).toBe(false);
  });
  it('never enables production Mercury from a Vercel preview deployment', () => {
    expect(mercuryConfig({
      MERCURY_ENVIRONMENT: 'production', MERCURY_API_KEY: 'test',
      MERCURY_ACCOUNT_ID: account, ARTIST_PAY_MERCURY_ENABLED: 'true', VERCEL_ENV: 'preview',
    }).enabled).toBe(false);
  });
  it('sends only the approval endpoint, ACH, the snapshot, and stable key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    await mercuryApproval(payout, { config, fetchImpl });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api-sandbox.mercury.com/api/v1/account/${account}/request-send-money`);
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual(approvalPayload(payout));
    expect(JSON.parse(options.body).amount).toBe(123.45);
    expect(url).not.toContain('/transactions');
  });
  it('fetches only the approval request when refreshing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    await mercuryApproval({ ...payout, mercury_request_id: requestId }, { config, fetchImpl, refresh: true });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api-sandbox.mercury.com/api/v1/request-send-money/${requestId}`);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });
  it('rejects environment or account changes before touching Mercury', async () => {
    const fetchImpl = vi.fn();
    await expect(mercuryApproval({ ...payout, environment: 'production' }, { config, fetchImpl })).rejects.toMatchObject({ code: 'config_changed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('never sends anything while disabled', async () => {
    const fetchImpl = vi.fn();
    await expect(mercuryApproval(payout, { config: { ...config, enabled: false }, fetchImpl })).rejects.toMatchObject({ code: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('normalizes provider response to two allowlisted fields only', () => {
    expect(normalizeApproval({ ...response, secretExtra: 'never persist me' }, payout)).toEqual({
      mercury_request_id: requestId, status: 'pending_approval',
    });
  });
  it.each([
    { amount: 123.46 }, { amount: '123.45' }, { amount: NaN }, { recipientId: account },
    { accountId: recipient }, { paymentMethod: 'domesticWire' }, { status: 'paid' }, { requestId: 'bad' },
  ])('rejects mismatched or malformed provider results: %j', (patch) => {
    expect(() => normalizeApproval({ ...response, ...patch }, payout)).toThrow();
  });
  it('accepts a duplicate-key 409 only with a matching response', async () => {
    await expect(mercuryApproval(payout, { config, fetchImpl: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 409 }),
    ) })).resolves.toEqual({ mercury_request_id: requestId, status: 'pending_approval' });
    await expect(mercuryApproval(payout, { config, fetchImpl: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'conflict' }), { status: 409 }),
    ) })).rejects.toMatchObject({ code: 'unexpected_response' });
  });
  it('does not expose provider error bodies', async () => {
    await expect(mercuryApproval(payout, { config, fetchImpl: vi.fn().mockResolvedValue(
      new Response('private bank info', { status: 400 }),
    ) })).rejects.toMatchObject({ code: 'http_400', message: 'Mercury returned HTTP 400. Check Mercury before retrying.' });
  });
  it('treats timeouts as unconfirmed rather than failed/no-send', async () => {
    await expect(mercuryApproval(payout, { config, fetchImpl: vi.fn().mockRejectedValue(new Error('secret network details')) }))
      .rejects.toMatchObject({ code: 'network_unconfirmed' });
  });
  it('never maps Mercury approval to paid', () => {
    expect(normalizeApproval({ ...response, status: 'approved' }, payout).status).toBe('approved');
  });
  it.each([0, -1, 1.1, '100', Infinity])('rejects nonpositive/noninteger cents: %s', (amount_cents) => {
    expect(() => approvalPayload({ ...payout, amount_cents })).toThrow();
  });
});

describe('read-only Mercury connection check', () => {
  it('does not fetch when configuration is incomplete or production is used from a preview', async () => {
    const fetchImpl = vi.fn();
    for (const env of [{}, {
      MERCURY_ENVIRONMENT: 'production', MERCURY_API_KEY: 'test-only',
      MERCURY_ACCOUNT_ID: account, VERCEL_ENV: 'preview',
    }]) {
      expect(await checkMercuryConnection({ config: mercuryConfig(env), fetchImpl }))
        .toEqual({ configured: false, verified: false, queue_enabled: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses only a read-only endpoint while queueing is disabled and discards financial data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accounts: [
        { id: recipient, name: 'Other account', accountNumber: 'other-secret' },
        { id: account, name: 'Checking', nickname: 'Artist Pay', status: 'active',
          accountNumber: 'secret-account', routingNumber: 'secret-routing', currentBalance: 100 },
      ],
    })));
    expect(await checkMercuryConnection({ config: { ...config, enabled: false }, fetchImpl })).toEqual({
      configured: true, verified: true, queue_enabled: false, environment: 'sandbox',
      account: { id: account, name: 'Checking', nickname: 'Artist Pay', status: 'active' },
      approval_tested: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-sandbox.mercury.com/api/v1/accounts');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect(options.body).toBeUndefined();
  });
  it.each([[], [null], [{ id: recipient }], [{ id: account }, { id: account }]].map((accounts) => ({ accounts })))(
    'fails closed if the exact account is missing or ambiguous: %j', async ({ accounts }) => {
      await expect(checkMercuryConnection({
        config, fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ accounts }))),
      })).rejects.toMatchObject({ code: 'account_not_found' });
    },
  );
  it.each(['not-json', '{}', '{"accounts":{}}'])('rejects malformed responses: %s', async (body) => {
    await expect(checkMercuryConnection({ config, fetchImpl: vi.fn().mockResolvedValue(new Response(body)) }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('sanitizes provider and network failures', async () => {
    await expect(checkMercuryConnection({
      config, fetchImpl: vi.fn().mockResolvedValue(new Response('secret-provider-data', { status: 403 })),
    })).rejects.toMatchObject({
      code: 'http_403', message: 'Mercury connection check returned HTTP 403. No payment request was created.',
    });
    await expect(checkMercuryConnection({
      config, fetchImpl: vi.fn().mockRejectedValue(new Error('secret-token')),
    })).rejects.toMatchObject({
      code: 'connection_failed', message: 'Could not securely connect to Mercury. No payment request was created.',
    });
  });
  it('reports inactive accounts without treating the lookup as an approval test', async () => {
    const result = await checkMercuryConnection({
      config: { ...config, enabled: false },
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        accounts: [{ id: account, name: 'A'.repeat(200), nickname: null, status: 'archived' }],
      }))),
    });
    expect(result.account.name).toHaveLength(160);
    expect(result.account.status).toBe('archived');
    expect(result.approval_tested).toBe(false);
    expect(result.queue_enabled).toBe(false);
  });
});

describe('manual linking and queue readiness', () => {
  it('requires the exact allowlisted shape and manual confirmation', () => {
    const body = { mercury_recipient_id: recipient, confirmed_in_mercury: true };
    expect(validRecipientLink(body)).toBe(true);
    expect(validRecipientLink({ ...body, account_number: '123456' })).toBe(false);
    expect(validRecipientLink({ ...body, confirmed_in_mercury: false })).toBe(false);
    expect(validRecipientLink({ ...body, mercury_recipient_id: '123456789' })).toBe(false);
  });
  it('blocks unknown or missing W9, even with a recipient', () => {
    for (const w9_on_file of [undefined, null, false]) {
      expect(payoutBlockReason({ status: 'approved', mercury_recipient_id: recipient, w9_on_file }, true)).toBe('W9 required before payout.');
    }
  });
  it('allows refreshing a known request after W9 changes, not a new send', () => {
    expect(payoutBlockReason({ payout: { mercury_request_id: requestId }, w9_on_file: false }, true)).toBeNull();
  });
});
