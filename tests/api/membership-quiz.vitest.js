import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null, rows: new Map(), fail: false, writes: [], limited: false }));
vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: async () => state.user }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ ok: !state.limited }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({
  from: table => ({
    async upsert(data, options) { state.writes.push({ table, data, options }); if (!state.fail) state.rows.set(data.user_id, data); return { error: state.fail ? { code: 'offline' } : null }; },
  }),
}) }));
import { POST } from '@/app/api/members/quiz/route';
const answers = { age: 24, gender: 'female', interests: ['experience'], activities: ['movies'], priority: 'insider', branch: '' };
const req = (body = { answers }, origin = 'https://sdg.invalid') => new Request('https://sdg.invalid/api/members/quiz', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { state.user = { id: 'account-a' }; state.rows.clear(); state.writes = []; state.fail = false; state.limited = false; });
it('requires sign-in and same-origin before any save', async () => {
  state.user = null; expect((await POST(req())).status).toBe(401);
  state.user = { id: 'account-a' }; expect((await POST(req(undefined, 'https://evil.invalid'))).status).toBe(403);
  expect(state.writes).toHaveLength(0);
});
it('stores canonical recommendations for authenticated account, ignoring client identity/price claims', async () => {
  const response = await POST(req({ answers, user_id: 'victim', recommended_plans: ['cowork'], price: 1 }));
  expect(response.status).toBe(200);
  expect(state.writes[0].data).toMatchObject({ user_id: 'account-a', gender_identity: 'female', recommended_plans: ['cowork-party'], selected_plan: 'cowork-party' });
  expect(state.writes[0].data).not.toHaveProperty('price'); expect((await response.json()).recommendation.primary).toBe('insider');
});
it('different valid selection does not overwrite the recommendation', async () => {
  const response = await POST(req({ answers, selectedPlan: 'builder' }));
  expect((await response.json()).next).toBe('/members/apply/cowork');
  expect(state.rows.get('account-a')).toMatchObject({ selected_plan: 'cowork', recommended_plans: ['cowork-party'] });
});
it('repeated completion updates only that account and separate sessions use same saved record', async () => {
  await POST(req()); expect(state.rows.get('account-a').answers).toEqual(answers);
  state.user = { id: 'account-b' }; await POST(req({ answers: { ...answers, gender: 'private' } }));
  expect(state.rows.size).toBe(2); expect(state.rows.get('account-b').gender_identity).toBeNull(); expect(state.rows.get('account-a').gender_identity).toBe('female');
});
it('rejects invalid inputs, rate limits and persistence failures', async () => {
  expect((await POST(req({ answers: { ...answers, age: 20 } }))).status).toBe(400);
  expect((await POST(req({ answers, selectedPlan: '__proto__' }))).status).toBe(400);
  state.limited = true; expect((await POST(req())).status).toBe(429);
  state.limited = false; state.fail = true; expect((await POST(req())).status).toBe(503);
});
