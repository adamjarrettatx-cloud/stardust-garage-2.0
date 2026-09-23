import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ getCurrentUser: vi.fn(), getMfaStatus: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
import { getCurrentUser, getMfaStatus } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@supabase/ssr';
import { POST as launch } from '../../app/api/admin/view-portal/launch/route.js';
import { POST as redeem, GET as redeemGet } from '../../app/view-preview/redeem/route.js';
import { POST as exitPreview } from '../../app/view-preview/exit/route.js';
import { PREVIEW_PROJECT_REF } from '../../lib/view-portal/config.js';
import { verifyViewToken } from '../../lib/view-portal/tokens.js';
import { signViewToken } from '../../lib/view-portal/tokens.js';
import { previewRequestGate, previewResponse } from '../../lib/view-portal/middleware';
import { NextRequest, NextResponse } from 'next/server';
const owner = '00000000-0000-4000-8000-000000000001';
const sandbox = 'https://preview.example.test';
const secret = 'test-only-preview-secret-'.repeat(4);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VIEW_PORTAL_MODE', 'launcher');
  vi.stubEnv('VIEW_PORTAL_OWNER_USER_ID', owner);
  vi.stubEnv('VIEW_PORTAL_SIGNING_SECRET', secret);
  vi.stubEnv('VIEW_PORTAL_CONTROLLER_ORIGIN', 'https://sdgatx.com');
  vi.stubEnv('VIEW_PORTAL_SANDBOX_ORIGIN', sandbox);
  vi.stubEnv('VIEW_PORTAL_READY', 'true');
  getCurrentUser.mockResolvedValue({ user: { id: owner }, isAdmin: true });
  getMfaStatus.mockResolvedValue({ user: { id: owner }, mfaSatisfied: true });
});
const request = (persona = 'free', origin = 'https://sdgatx.com') => new Request('https://sdgatx.com/api/admin/view-portal/launch', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }),
});
it('requires the pinned owner, not merely administrator access', async () => {
  getCurrentUser.mockResolvedValue({ user: { id: 'other-admin' }, isAdmin: true });
  expect((await launch(request())).status).toBe(403);
});
it('always requires MFA even when general admin MFA enforcement is off', async () => {
  vi.stubEnv('ENFORCE_ADMIN_MFA', 'false');
  getMfaStatus.mockResolvedValue({ user: { id: owner }, mfaSatisfied: false });
  expect((await launch(request())).status).toBe(403);
});
it('rejects wrong-origin launches and arbitrary account IDs', async () => {
  expect((await launch(request('free', 'https://attacker.test'))).status).toBe(403);
  expect((await launch(request(owner))).status).toBe(400);
});
it('fails closed before infrastructure has been marked ready', async () => {
  vi.stubEnv('VIEW_PORTAL_READY', 'false');
  expect((await launch(request())).status).toBe(503);
});
it('launch produces a short-lived signed POST destination, not a token URL', async () => {
  const response = await launch(request('member-artist'));
  const data = await response.json();
  expect(data.action).toBe(`${sandbox}/view-preview/redeem`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const verified = await verifyViewToken(data.token, secret, { purpose: 'launch', audience: sandbox, ownerId: owner, maxAge: 60 });
  expect(verified.persona).toBe('member-artist');
});
it('redemption is unavailable on the production launcher and cannot use GET', async () => {
  expect((await redeem(new Request('https://sdgatx.com/view-preview/redeem', { method: 'POST' }))).status).toBe(404);
  expect(redeemGet().status).toBe(405);
});
async function redeemRequest() {
  const data = await (await launch(request())).json();
  vi.stubEnv('VIEW_PORTAL_MODE', 'sandbox');
  vi.stubEnv('VIEW_PORTAL_ISOLATION_VERIFIED', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${PREVIEW_PROJECT_REF}.supabase.co`);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', sandbox);
  const form = new FormData(); form.set('token', data.token);
  return new Request(`${sandbox}/view-preview/redeem`, { method: 'POST', body: form });
}
it('a replay fails before generating any authentication session', async () => {
  const req = await redeemRequest();
  const generateLink = vi.fn();
  createAdminClient.mockReturnValue({
    from: () => ({ insert: async () => ({ error: { code: '23505' } }) }),
    auth: { admin: { generateLink } },
  });
  expect((await redeem(req)).status).toBe(409);
  expect(generateLink).not.toHaveBeenCalled();
});
it('verified synthetic identity receives the real scoped session and a host-only preview lease', async () => {
  const req = await redeemRequest();
  const userId = '00000000-0000-4000-8000-000000000004';
  createAdminClient.mockReturnValue({
    from: () => {
      const chain = {
        insert: async () => ({ error: null }),
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: { user_id: userId, ready: true } }),
      }; return chain;
    },
    auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'test-otp' } } }) } },
  });
  createServerClient.mockReturnValue({ auth: { verifyOtp: async () => ({ data: { user: { id: userId } } }) } });
  const response = await redeem(req);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`${sandbox}/account/profile`);
  expect(response.headers.get('set-cookie')).toContain('__Host-sdg-view=');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).not.toContain('Domain=');
});
async function sandboxRequest(path = '/member', overrides = {}) {
  vi.stubEnv('VIEW_PORTAL_MODE', 'sandbox');
  vi.stubEnv('VIEW_PORTAL_ISOLATION_VERIFIED', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${PREVIEW_PROJECT_REF}.supabase.co`);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', sandbox);
  const now = Math.floor(Date.now() / 1000);
  const token = await signViewToken({
    purpose: 'session', aud: sandbox, owner, persona: 'builder', user: 'synthetic-user',
    iat: now, exp: now + 1800, jti: '00000000-0000-4000-8000-000000000005', ...overrides,
  }, secret);
  return new NextRequest(`${sandbox}${path}`, { headers: { Cookie: `__Host-sdg-view=${token}` } });
}
it('ordinary production requests do not receive preview authorization overrides', async () => {
  expect(await previewRequestGate(new NextRequest('https://sdgatx.com/member'))).toEqual({ active: false });
  expect(createServerClient).not.toHaveBeenCalled();
});
it('every sandbox route requires a valid owner-authorized lease', async () => {
  await sandboxRequest();
  for (const path of ['/', '/account/profile', '/api/capacity/status']) {
    expect((await previewRequestGate(new NextRequest(`${sandbox}${path}`))).denied.status).toBe(403);
  }
});
it('locked bootstrap blocks pages, APIs, redemption and exit without calling Auth', async () => {
  await sandboxRequest();
  vi.stubEnv('VIEW_PORTAL_READY', 'false');
  vi.stubEnv('VIEW_PORTAL_ISOLATION_VERIFIED', 'false');
  vi.stubEnv('VIEW_PORTAL_OWNER_USER_ID', '');
  vi.stubEnv('VIEW_PORTAL_SIGNING_SECRET', '');
  vi.stubEnv('VIEW_PORTAL_CONTROLLER_ORIGIN', '');
  for (const path of ['/', '/account/profile', '/bananas', '/api/capacity/status',
    '/view-preview/redeem', '/view-preview/exit', '/api/cron/reminders']) {
    const result = await previewRequestGate(new NextRequest(`${sandbox}${path}`));
    expect(result.denied.status).toBe(503);
    expect(await result.denied.text()).toBe('Preview environment is locked.');
  }
  expect(createServerClient).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
});
it('a sandbox session cannot swap its authenticated subject', async () => {
  const req = await sandboxRequest();
  createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: 'someone-else' } } }) } });
  expect((await previewRequestGate(req)).denied.status).toBe(403);
});
it('the matching synthetic subject proceeds to normal website authorization', async () => {
  const req = await sandboxRequest();
  createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) } });
  const result = await previewRequestGate(req);
  expect(result.active).toBe(true);
  expect(result.denied).toBeUndefined();
});
it('expired preview lease denies requests even if the Supabase session is still valid', async () => {
  const req = await sandboxRequest('/member', { exp: Math.floor(Date.now() / 1000) - 1 });
  expect((await previewRequestGate(req)).denied.status).toBe(403);
});
it('sandbox cron and webhook requests cannot execute with a valid lease', async () => {
  for (const path of ['/api/cron/reminders', '/api/webhooks/stripe']) {
    const req = await sandboxRequest(path);
    expect((await previewRequestGate(req)).denied.status).toBe(403);
  }
});
it('external redirects are blocked while an explicit owner-portal exit remains available', async () => {
  const req = await sandboxRequest();
  const context = { active: true, config: { sandboxOrigin: sandbox, controllerOrigin: 'https://sdgatx.com' }, cookies: [] };
  const blocked = previewResponse(NextResponse.redirect('https://checkout.stripe.com/pay/test'), context, req);
  expect(blocked.status).toBe(403);
  const exit = await sandboxRequest('/view-preview/exit');
  const allowed = previewResponse(NextResponse.redirect('https://sdgatx.com/bananas/view-portal'), context, exit);
  expect(allowed.status).toBe(307);
  expect(allowed.headers.get('referrer-policy')).toBe('same-origin');
  expect(allowed.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const directives = allowed.headers.get('content-security-policy').split('; ');
  expect(directives.find((value) => value.startsWith('form-action ')))
    .toBe("form-action 'self' https://sdgatx.com/bananas/view-portal");
});
it('exit requires the sandbox origin and clears lease plus chunked Auth cookies', async () => {
  await sandboxRequest();
  const denied = await exitPreview(new Request(`${sandbox}/view-preview/exit`, {
    method: 'POST', headers: { Origin: 'https://attacker.test' },
  }));
  expect(denied.status).toBe(403);
  const response = await exitPreview(new Request(`${sandbox}/view-preview/exit`, {
    method: 'POST',
    headers: {
      Origin: sandbox,
      Cookie: `__Host-sdg-view=lease; sb-${PREVIEW_PROJECT_REF}-auth-token.0=a; sb-${PREVIEW_PROJECT_REF}-auth-token.1=b`,
    },
  }));
  expect(response.status).toBe(303);
  expect(response.headers.get('referrer-policy')).toBe('same-origin');
  const cookies = response.headers.getSetCookie().join('\n');
  expect(cookies).toContain('__Host-sdg-view=');
  expect(cookies).toContain(`sb-${PREVIEW_PROJECT_REF}-auth-token.0=`);
  expect(cookies).toContain(`sb-${PREVIEW_PROJECT_REF}-auth-token.1=`);
  expect(cookies.match(/Max-Age=0/g)).toHaveLength(3);
});
it.each([null, 'null', 'https://attacker.test', 'https://sdgatx.com'])(
  'exit still rejects missing, opaque and cross-origin requests: %s',
  async (origin) => {
    await sandboxRequest();
    const response = await exitPreview(new Request(`${sandbox}/view-preview/exit`, {
      method: 'POST', headers: origin === null ? {} : { Origin: origin },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  },
);
it('exit still rejects a different destination host even with the expected Origin', async () => {
  await sandboxRequest();
  const response = await exitPreview(new Request('https://other.test/view-preview/exit', {
    method: 'POST', headers: { Origin: sandbox },
  }));
  expect(response.status).toBe(403);
  expect(response.headers.get('set-cookie')).toBeNull();
});
