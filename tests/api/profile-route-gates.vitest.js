import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requirePartner: vi.fn(), createRequestScopedClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/pay-request-notify', () => ({ notifyAdminsPayRequested: vi.fn() }));
vi.mock('@/lib/document-helpers', () => ({ createAdminClient: vi.fn(), streamDocumentVersion: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendGuestlistInvite: vi.fn() }));
import { requirePartner, createRequestScopedClient } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST as requestPay } from '../../app/api/portal/bookings/[bookingId]/request-pay/route.js';
import { GET as downloadContract } from '../../app/api/portal/contracts/[id]/download/route.js';
import { POST as addGuest } from '../../app/api/portal/guestlist/entries/route.js';
import { DELETE as removeGuest } from '../../app/api/portal/guestlist/entries/[id]/route.js';
const req = new Request('https://preview.example/api/test', { method: 'POST' });
beforeEach(() => vi.clearAllMocks());
it.each(['promoter', 'organization', 'collective', 'event_organizer', 'vendor'])('blocks %s payment requests before any privileged read', async (type) => {
  requirePartner.mockResolvedValue({ user: { id: 'own' }, partner: { contact_type: [type] } });
  expect((await requestPay(req, { params: {} })).status).toBe(403);
  expect(createAdminClient).not.toHaveBeenCalled();
});
it('blocks promoter contract downloads', async () => {
  requirePartner.mockResolvedValue({ user: { id: 'own' }, partner: { contact_type: ['promoter'] } });
  expect((await downloadContract(req, { params: {} })).status).toBe(404);
  expect(createRequestScopedClient).not.toHaveBeenCalled();
});
it.each([addGuest, removeGuest])('blocks vendor guest-list mutations', async (handler) => {
  requirePartner.mockResolvedValue({ user: { id: 'own' }, partner: { contact_type: ['vendor'] } });
  expect((await handler(req, { params: {} })).status).toBe(403);
  expect(createRequestScopedClient).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
});
