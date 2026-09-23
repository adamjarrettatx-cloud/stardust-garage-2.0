import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ getCurrentUser: vi.fn(), getMfaStatus: vi.fn() }));
import { getCurrentUser, getMfaStatus } from '@/lib/auth-helpers';
import { POST as launch } from '../../app/api/admin/view-portal/launch/route.js';
import { verifyViewToken } from '../../lib/view-portal/tokens.js';

const owner = '00000000-0000-4000-8000-000000000001';
const origin = 'https://sdgatx.com';
const sandbox = 'https://sdg-view-portal.vercel.app';
const secret = 'test-only-preview-secret-'.repeat(4);
const request = (persona = 'free', requestOrigin = origin) => new Request(
  `${origin}/api/admin/view-portal/launch`,
  { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VIEW_PORTAL_MODE', 'launcher');
  vi.stubEnv('VIEW_PORTAL_OWNER_USER_ID', owner);
  vi.stubEnv('VIEW_PORTAL_SIGNING_SECRET', secret);
  vi.stubEnv('VIEW_PORTAL_CONTROLLER_ORIGIN', origin);
  vi.stubEnv('VIEW_PORTAL_SANDBOX_ORIGIN', sandbox);
  vi.stubEnv('VIEW_PORTAL_READY', 'true');
  getCurrentUser.mockResolvedValue({ user: { id: owner }, isAdmin: true });
  getMfaStatus.mockResolvedValue({ user: { id: owner }, mfaSatisfied: true });
});

it('requires the immutable owner id, admin role and AAL2 session', async () => {
  for (const current of [
    { user: null, isAdmin: false },
    { user: { id: owner }, isAdmin: false },
    { user: { id: 'someone-else' }, isAdmin: true },
  ]) {
    getCurrentUser.mockResolvedValueOnce(current);
    expect((await launch(request())).status).toBe(403);
  }
  getMfaStatus.mockResolvedValue({ user: { id: owner }, mfaSatisfied: false });
  expect((await launch(request())).status).toBe(403);
});

it('fails closed until launch is enabled and rejects cross-origin and arbitrary personas', async () => {
  vi.stubEnv('VIEW_PORTAL_READY', 'false');
  expect((await launch(request())).status).toBe(503);
  vi.stubEnv('VIEW_PORTAL_READY', 'true');
  expect((await launch(request('free', 'https://attacker.test'))).status).toBe(403);
  expect((await launch(request('owner'))).status).toBe(400);
});

it('issues a short-lived signed POST handoff for the selected fixed persona', async () => {
  const response = await launch(request('member-artist'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const data = await response.json();
  expect(data.action).toBe(`${sandbox}/view-preview/redeem`);
  expect(data.token).not.toContain('member-artist');
  const claims = await verifyViewToken(data.token, secret, {
    purpose: 'launch', audience: sandbox, ownerId: owner, maxAge: 60,
  });
  expect(claims.persona).toBe('member-artist');
  expect(claims.owner).toBe(owner);
});
