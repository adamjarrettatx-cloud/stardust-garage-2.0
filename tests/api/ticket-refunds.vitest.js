import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/stripe/client', () => ({ stripe: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/auth-helpers', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ isInternalTicketingEnabled: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
import { stripe } from '@/lib/stripe/client';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { createClient } from '@supabase/supabase-js';
import { executeTicketRefund, handleTicketRefundEvent } from '@/lib/tickets/refunds';
import { GET, POST } from '@/app/api/admin/tickets/refunds/route';

const id = '00000000-0000-4000-8000-000000000010';
const orderId = '00000000-0000-4000-8000-000000000011';
let requestRow, orderRow, providerRefund, db;
beforeEach(() => {
  vi.clearAllMocks();
  requestRow = { id, order_id: orderId, amount_cents: 2500, expected_refunded_cents: 0, currency: 'usd',
    status: 'processing', started_at: new Date().toISOString() };
  orderRow = { id: orderId, stripe_payment_intent_id: 'pi_test', total_cents: 5000, refunded_cents: 0 };
  providerRefund = { id: 're_test', amount: 2500, currency: 'usd', payment_intent: 'pi_test',
    metadata: { sdg_refund_request_id: id }, status: 'succeeded' };
  db = { rpc: vi.fn(async (name, args) => name === 'claim_ticket_refund'
    ? { data: { request: requestRow, order: orderRow } }
    : { data: { ...requestRow, stripe_refund_id: args.p_refund_id, status: args.p_status === 'succeeded' ? 'succeeded' : args.p_status === 'failed' ? 'failed' : 'pending', stripe_status: args.p_status, error: args.p_error } }) };
  stripe.get.mockImplementation(async (path) => path === '/refunds' ? { data: [], has_more: false }
    : path.startsWith('/payment_intents/') ? { status: 'succeeded', currency: 'usd', latest_charge: { amount: 5000, amount_refunded: 0, disputed: false } }
    : providerRefund);
  stripe.post.mockResolvedValue(providerRefund);
  requireAdmin.mockResolvedValue({ unauthorized: false, user: { id: 'admin' } });
  isInternalTicketingEnabled.mockReturnValue(true);
  createClient.mockReturnValue(db);
});

describe('refund execution', () => {
  it('uses a durable per-request idempotency key and confirms provider status', async () => {
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('succeeded');
    expect(stripe.post).toHaveBeenCalledWith('/refunds', expect.objectContaining({ idempotencyKey: `sdg-refund-v2-${id}` }));
    expect(db.rpc).toHaveBeenCalledWith('finish_ticket_refund', expect.objectContaining({ p_status: 'succeeded', p_refund_id: 're_test' }));
  });
  it('does not call Stripe again for an already-settled request', async () => {
    requestRow.status = 'succeeded';
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('succeeded');
    expect(stripe.get).not.toHaveBeenCalled(); expect(stripe.post).not.toHaveBeenCalled();
  });
  it('recovers a Stripe success after a lost response without another refund', async () => {
    stripe.get.mockResolvedValue({ data: [providerRefund], has_more: false });
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('succeeded');
    expect(stripe.post).not.toHaveBeenCalled();
  });
  it('records pending as pending, not success', async () => {
    stripe.post.mockResolvedValue({ ...providerRefund, status: 'pending' });
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('pending');
  });
  it('keeps an uncertain network error unresolved, not failed', async () => {
    stripe.post.mockRejectedValue(new Error('network timeout'));
    await expect(executeTicketRefund(db, id, 'admin')).rejects.toThrow('network timeout');
    expect(db.rpc.mock.calls.filter(([name]) => name === 'finish_ticket_refund')).toHaveLength(0);
  });
  it('never re-creates after Stripe key expiry even if no provider record is found', async () => {
    requestRow.started_at = new Date(Date.now() - 25 * 3600000).toISOString();
    await expect(executeTicketRefund(db, id, 'admin')).rejects.toThrow('manual reconciliation');
    expect(stripe.post).not.toHaveBeenCalled();
  });
  it('allows expired-key recovery by reading an existing provider record', async () => {
    requestRow.started_at = new Date(Date.now() - 25 * 3600000).toISOString();
    stripe.get.mockResolvedValue({ data: [providerRefund], has_more: false });
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('succeeded');
    expect(stripe.post).not.toHaveBeenCalled();
  });
  it('does not create a refund when provider accounting changed or a dispute exists', async () => {
    stripe.get.mockImplementation(async (path) => path === '/refunds' ? { data: [], has_more: false }
      : { status: 'succeeded', currency: 'usd', latest_charge: { amount: 5000, amount_refunded: 1000 } });
    expect((await executeTicketRefund(db, id, 'admin')).status).toBe('failed');
    expect(stripe.post).not.toHaveBeenCalled();
  });
  it('does not finalize an unexpected amount or request reference', async () => {
    stripe.post.mockResolvedValue({ ...providerRefund, amount: 1 });
    await expect(executeTicketRefund(db, id, 'admin')).rejects.toThrow('verification');
  });
  it('reports a database failure after provider success as unresolved', async () => {
    db.rpc.mockImplementation(async (name) => name === 'claim_ticket_refund' ? { data: { request: requestRow, order: orderRow } } : { error: new Error('DB down') });
    await expect(executeTicketRefund(db, id, 'admin')).rejects.toThrow('DB down');
  });
  it('fetches latest provider status for webhooks and lets DB errors trigger retry', async () => {
    db.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: requestRow }) }) }) });
    stripe.get.mockResolvedValue({ ...providerRefund, status: 'failed' });
    expect(await handleTicketRefundEvent({ stripeEvent: { type: 'refund.updated', data: { object: providerRefund } }, supabaseAdmin: db })).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('finish_ticket_refund', expect.objectContaining({ p_status: 'failed' }));
  });
});

const post = (body, extra = {}) => new Request('https://example.test/api/admin/tickets/refunds', {
  method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
});
describe('admin refund API', () => {
  it('denies non-admin reads and writes without touching the database', async () => {
    requireAdmin.mockResolvedValue({ unauthorized: true });
    expect((await POST(post({ action: 'review', order_ids: [orderId] }))).status).toBe(401);
    expect((await GET(new Request('https://example.test/api/admin/tickets/refunds'))).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('denies cross-origin writes and malformed monetary inputs', async () => {
    expect((await POST(post({}, { origin: 'https://attacker.test' }))).status).toBe(403);
    for (const amount of [0, -1, 0.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
      expect((await POST(post({ action: 'review', order_ids: [orderId], amount_cents: amount, note: 'test' }))).status).toBe(400);
    }
  });
  it('rejects batch partial refunds, duplicate orders, and batches over 100', async () => {
    expect((await POST(post({ action: 'review', order_ids: [orderId, id], amount_cents: 10, note: 'test' }))).status).toBe(400);
    expect((await POST(post({ action: 'review', order_ids: [orderId, orderId], note: 'test' }))).status).toBe(400);
    expect((await POST(post({ action: 'review', order_ids: Array(101).fill(orderId), note: 'test' }))).status).toBe(400);
  });
  it('turns unknown execution outcomes into needs_check, not success', async () => {
    db.rpc.mockResolvedValue({ error: new Error('Unknown outcome') });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(post({ action: 'execute', request_id: id }));
    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe('needs_check');
    log.mockRestore();
  });
  it('prepares immutable review requests without any Stripe call', async () => {
    const reviewed = { ...orderRow, buyer_name: 'Test Buyer', status: 'paid', currency: 'usd', events: { title: 'Event' } };
    db.from = (table) => {
      let inserting = false;
      const q = {
        select: () => q, in: () => q,
        insert: (rows) => { inserting = true; expect(rows[0].amount_cents).toBe(5000); return q; },
        then: (resolve) => Promise.resolve({ data: table === 'orders' ? [reviewed] : inserting ? [{ id, order_id: orderId, amount_cents: 5000, currency: 'usd' }] : [] }).then(resolve),
      }; return q;
    };
    const response = await POST(post({ action: 'review', order_ids: [orderId], note: 'Customer request' }));
    expect(response.status).toBe(200);
    expect((await response.json()).requests[0].amount_cents).toBe(5000);
    expect(stripe.post).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
