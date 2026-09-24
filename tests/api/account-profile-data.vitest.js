import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn) => fn }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((url) => { throw new Error(`redirect:${url}`); }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/profile-photo', () => ({ createProfilePhotoSignedUrl: vi.fn(async () => null) }));
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccountProfile } from '../../lib/account-profile-data.js';

let user, rows, failedTable, reads, rpcs, client;
beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'authenticated-user', email: 'self@example.invalid', user_metadata: { full_name: 'Fallback', is_admin: true } };
  rows = { free_accounts: { full_name: 'Own Person', phone: '12025550100' }, member_profiles: null, trial_passes: [], team_members: null, partner_self: [] };
  failedTable = null; reads = []; rpcs = [];
  function from(table) {
    const record = { table, filters: [] }; reads.push(record);
    const chain = {
      select(fields) { record.fields = fields; return chain; },
      eq(key, value) { record.filters.push([key, value]); return chain; },
      order() { return chain; }, limit() { return chain; }, maybeSingle() { return chain; },
      then(resolve) { return Promise.resolve({ data: rows[table], error: failedTable === table ? { message: 'failed' } : null }).then(resolve); },
    };
    return chain;
  }
  client = {
    from, auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name) => { rpcs.push(name); return { data: rows[name] || [], error: failedTable === name ? { message: 'failed' } : null }; },
  };
  createClient.mockResolvedValue(client);
  createAdminClient.mockReturnValue({ from });
});

it('all table reads are filtered to the authenticated user, never a client-supplied identity', async () => {
  const profile = await getAccountProfile();
  expect(profile.name).toBe('Own Person');
  for (const read of reads) {
    expect(read.filters).toEqual([['user_id', user.id]]);
    expect(read.fields).not.toBe('*');
  }
  expect(profile.workspaces).toEqual([]);
  expect(profile).not.toHaveProperty('userId');
  expect(profile).not.toHaveProperty('profile_photo_path');
});
it('does not create a privileged client before authentication', async () => {
  user = null;
  await expect(getAccountProfile()).rejects.toThrow('redirect:/login?next=/account/profile');
  expect(createAdminClient).not.toHaveBeenCalled();
});
it.each(['team_members', 'member_profiles', 'trial_passes', 'partner_self'])('does not mislabel failed %s reads as a free account', async (table) => {
  failedTable = table;
  await expect(getAccountProfile()).rejects.toThrow('could not be loaded');
});
it('restricts partner resources even when a restricted staff identity has a partner row', async () => {
  rows.team_members = { role: 'front_desk' };
  rows.partner_self = [{ is_active: true, contact_type: ['artist'] }];
  const profile = await getAccountProfile();
  expect(rpcs).toEqual(['partner_self']);
  expect(profile.partnerActive).toBe(false);
  expect(profile.workspaces).toEqual([{ href: '/capacity/front-desk', label: 'Front desk' }]);
});
it('reads partner workspaces through the user-scoped RPCs and fails safely on errors', async () => {
  rows.partner_self = [{ is_active: true, contact_type: ['artist'] }];
  failedTable = 'partner_bookings';
  await expect(getAccountProfile()).rejects.toThrow('workspaces could not be loaded');
  expect(rpcs).toEqual(['partner_self', 'partner_grants', 'partner_bookings', 'partner_contracts']);
});
