import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({ requireOwnerMfa: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/mercury', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, mercuryApproval: vi.fn(), mercuryConfig: vi.fn() };
});

import { requireOwnerMfa } from '../../lib/auth-helpers';
import { createAdminClient } from '../../lib/supabase/admin';
import { mercuryApproval, mercuryConfig, MercuryError } from '../../lib/mercury';
import { POST as queue } from '../../app/api/admin/pay-requests/[id]/queue-mercury/route';
import { POST as refresh } from '../../app/api/admin/pay-requests/[id]/refresh-mercury/route';
import { PATCH as link, GET as getProfile } from '../../app/api/admin/contacts/[id]/payout-profile/route';

const id = '33333333-3333-4333-8333-333333333333';
const recipient = '55555555-5555-4555-8555-555555555555';
const mercuryRequest = '88888888-8888-4888-8888-888888888888';
const body = { confirmed: true, expected_recipient_id: recipient, expected_amount_cents: 15000 };
const context = { params: Promise.resolve({ id }) };
const rpc = vi.fn();
const from = vi.fn();
const claim = { payout: { mercury_recipient_id: recipient }, lease_token: 'lease', skip: false };
function req(payload = body, origin = 'https://sdgatx.com', method = 'POST') {
  return new Request(`https://sdgatx.com/api/admin/pay-requests/${id}/queue-mercury`, {
    method, headers: { 'Content-Type': 'application/json', origin, host: 'sdgatx.com' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOwnerMfa.mockResolvedValue({ user: { id: 'owner' }, unauthorized: false });
  createAdminClient.mockReturnValue({ rpc, from });
  mercuryConfig.mockReturnValue({ enabled: true, accountId: 'account', mode: 'sandbox' });
  rpc.mockReset();
  mercuryApproval.mockResolvedValue({ mercury_request_id: mercuryRequest, status: 'pending_approval' });
});

describe('owner-only payout routes', () => {
  it.each([queue, refresh, link, getProfile])('rejects non-owner before DB or provider calls', async (handler) => {
    requireOwnerMfa.mockResolvedValue({ unauthorized: true, reason: 'not_owner' });
    expect((await handler(req(), context)).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mercuryApproval).not.toHaveBeenCalled();
  });
  it.each([queue, refresh, link])('rejects cross-origin writes', async (handler) => {
    expect((await handler(req(body, 'https://attacker.test'), context)).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('rejects malformed IDs and unexpected bank-data fields', async () => {
    expect((await queue(req(), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400);
    expect((await queue(req({ ...body, bankAccount: 'no' }), context)).status).toBe(400);
    expect((await link(req({ mercury_recipient_id: recipient, confirmed_in_mercury: true, routingNumber: 'no' }), context)).status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation and configured enable flag', async () => {
    expect((await queue(req({ ...body, confirmed: false }), context)).status).toBe(400);
    mercuryConfig.mockReturnValue({ enabled: false });
    expect((await queue(req(), context)).status).toBe(503);
    expect(mercuryApproval).not.toHaveBeenCalled();
  });
  it.each(['w9_required', 'recipient_required', 'payout_busy', 'confirmation_changed', 'mercury_config_changed'])('blocks %s before network call', async (message) => {
    rpc.mockResolvedValueOnce({ error: { message } });
    expect((await queue(req(), context)).status).toBe(409);
    expect(mercuryApproval).not.toHaveBeenCalled();
  });
  it('handles duplicate queue clicks without another provider request', async () => {
    rpc.mockResolvedValueOnce({ data: { ...claim, skip: true, payout: { status: 'pending_approval' } } });
    const res = await queue(req(), context);
    expect(await res.json()).toMatchObject({ ok: true, already_queued: true });
    expect(mercuryApproval).not.toHaveBeenCalled();
  });
  it('claims atomically, queues, then saves the allowlisted result', async () => {
    rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: { status: 'pending_approval' } });
    expect((await queue(req(), context)).status).toBe(200);
    expect(rpc.mock.calls[0]).toEqual(['claim_artist_mercury_payout', expect.objectContaining({
      p_request_id: id, p_refresh: false, p_expected_amount_cents: 15000, p_expected_recipient_id: recipient,
    })]);
    expect(rpc.mock.calls[1]).toEqual(['finish_artist_mercury_payout', expect.objectContaining({
      p_mercury_request_id: mercuryRequest, p_status: 'pending_approval', p_error_code: null,
    })]);
  });
  it('records ambiguous sends without falsely setting paid or clearing snapshot', async () => {
    rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: {} });
    mercuryApproval.mockRejectedValueOnce(new MercuryError('network_unconfirmed', 'Check Mercury.'));
    const res = await queue(req(), context);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ unconfirmed: true });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_error_code: 'network_unconfirmed', p_status: null });
  });
  it('surfaces success-with-local-save-failure as unconfirmed', async () => {
    rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ error: { message: 'database offline' } });
    const res = await queue(req(), context);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ unconfirmed: true });
  });
  it('refreshes only an existing request using the refresh operation', async () => {
    rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: { status: 'approved' } });
    expect((await refresh(req({}), context)).status).toBe(200);
    expect(rpc.mock.calls[0][1].p_refresh).toBe(true);
    expect(mercuryApproval.mock.calls[0][1].refresh).toBe(true);
  });
  it('links only ID and owner attribution, without fetching Mercury recipient data', async () => {
    rpc.mockResolvedValueOnce({ data: { contact_id: id, mercury_recipient_id: recipient, linked_at: 'date' } });
    expect((await link(req({ mercury_recipient_id: recipient, confirmed_in_mercury: true }), context)).status).toBe(200);
    expect(rpc.mock.calls[0]).toEqual(['link_artist_mercury_recipient', {
      p_contact_id: id, p_recipient_id: recipient, p_actor_id: 'owner',
    }]);
    expect(mercuryApproval).not.toHaveBeenCalled();
  });
});
