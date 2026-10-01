import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ sharpLoads: 0, user: null, account: null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.account }) }) }) }),
  }),
}));
vi.mock('sharp', () => {
  state.sharpLoads++;
  throw new Error('Simulated missing sharp linux-x64 native addon');
});
vi.mock('qrcode', () => ({
  default: { toBuffer: async () => Buffer.from('test-qr') },
}));

describe('optional email image renderer failures', () => {
  beforeEach(() => {
    vi.resetModules();
    state.sharpLoads = 0;
    state.user = null;
    state.account = null;
    vi.stubEnv('RESEND_API_KEY', 'test-only-not-a-real-key');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ id: 'test-email' }),
    })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('redemption loads and enforces authentication despite missing native artwork library', async () => {
    const { POST } = await import('../../app/api/free-account/redeem-trial/route.js');
    const response = await POST(new Request('https://example.test/api/free-account/redeem-trial', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(state.sharpLoads).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('redemption still enforces verified phone before issuance', async () => {
    state.user = { id: 'test-owner' };
    state.account = { phone_verified_at: null };
    const { POST } = await import('../../app/api/free-account/redeem-trial/route.js');
    const response = await POST(new Request('https://example.test/api/free-account/redeem-trial', { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'PHONE_NOT_VERIFIED' });
    expect(state.sharpLoads).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads shared email and sends trial delivery without loading sharp', async () => {
    const { sendTrialPassDelivery } = await import('../../lib/email.js');
    expect(state.sharpLoads).toBe(0);
    await sendTrialPassDelivery({
      email: 'guest@example.test', fullName: 'Test Guest',
      passUrl: 'https://www.sdgatx.com/pass/test-only', expiresLabel: 'Test deadline',
    });
    expect(state.sharpLoads).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).html).toContain('30-DAY TRIAL');
  });

  it('defers a missing native renderer until artwork is requested', async () => {
    const { getHeroPngBuffer } = await import('../../lib/email/cosmos-assets.js');
    expect(state.sharpLoads).toBe(0);
    await expect(getHeroPngBuffer()).rejects.toThrow();
  });

  it('ticket confirmation still sends QR attachments when the decorative hero fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendTicketConfirmation } = await import('../../lib/email.js');
    await sendTicketConfirmation({
      to: 'guest@example.test', orderId: 'test-order', eventTitle: 'Test Event',
      eventWhen: 'Test date', ticketRows: [{
        ticketCode: 'SDG-TEST', productName: 'Admission',
        qrPngBuffer: Buffer.from('test-qr'),
      }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.html).not.toContain('cid:hero@sdgatx');
    expect(payload.html).toContain('cid:qr-SDG-TEST@sdgatx');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe('SDG-TEST.png');
  });
});
