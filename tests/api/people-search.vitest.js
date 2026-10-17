import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('next/server', async (orig) => ({ ...(await orig()), after: (fn) => { fn(); } }));

const { requireAdmin } = await import('@/lib/auth-helpers');
const { createAdminClient } = await import('@/lib/supabase/admin');
const { parsePeopleQuery, mergePeople, recordFromTrial, recordFromAccount, recordFromMember, trialState } = await import('@/lib/people-search');
const { GET } = await import('../../app/api/admin/people-search/route.js');

describe('parsePeopleQuery', () => {
  it('treats phone punctuation as a phone search and drops the country code', () => {
    expect(parsePeopleQuery('512-555-01')).toEqual({ kind: 'phone', digits: '51255501' });
    expect(parsePeopleQuery('(512) 555 0142')).toEqual({ kind: 'phone', digits: '5125550142' });
    expect(parsePeopleQuery('+1 512 555 0142')).toEqual({ kind: 'phone', digits: '5125550142' });
    expect(parsePeopleQuery('15125550142')).toEqual({ kind: 'phone', digits: '5125550142' });
  });
  it('splits names into words and strips PostgREST syntax', () => {
    expect(parsePeopleQuery('Mar H')).toEqual({ kind: 'text', tokens: ['mar', 'h'] });
    expect(parsePeopleQuery('a,b(c)*%')).toEqual({ kind: 'text', tokens: ['a', 'b', 'c'] });
    expect(parsePeopleQuery('maria.h@example.com')).toEqual({ kind: 'text', tokens: ['maria.h@example.com'] });
  });
  it('ignores too-short input', () => {
    expect(parsePeopleQuery('a')).toBeNull();
    expect(parsePeopleQuery('51')).toBeNull();
    expect(parsePeopleQuery('   ')).toBeNull();
  });
});

describe('mergePeople', () => {
  it('folds a member, their trial pass and guest account into one row led by the membership', () => {
    const people = mergePeople([
      recordFromAccount({ id: 'a1', user_id: 'u1', full_name: 'Maria H', email: 'm@x.com', phone: '+15125550142', created_at: '2026-08-01' }),
      recordFromTrial({ id: 't1', user_id: 'u1', full_name: 'Maria H', email: 'm@x.com', phone: '+15125550142', issued_at: '2026-08-02', activated_at: '2026-08-02', expires_at: '2026-09-01', converted_at: '2026-08-14' }),
      recordFromMember({ id: 'm1', user_id: 'u1', full_name: 'Maria Hernandez', email: 'm@x.com', is_active: true, subscription_status: 'active', subscription_plan: 'weekender', created_at: '2026-08-14' }, { phone: '+15125550142' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].full_name).toBe('Maria Hernandez');
    expect(people[0].href).toBe('/bananas/people/member-m1');
    expect(people[0].phone_display).toBe('+1 (512) 555-0142');
    expect(people[0].also.map((c) => c.label)).toEqual(['GUEST ACCOUNT', 'TRIAL · CONVERTED']);
    expect(people[0].categories.sort()).toEqual(['guests', 'members', 'trial']);
  });
  it('keeps different people apart', () => {
    const people = mergePeople([
      recordFromAccount({ id: 'a1', user_id: 'u1', full_name: 'A', email: 'a@x.com', created_at: '2026-01-01' }),
      recordFromAccount({ id: 'a2', user_id: 'u2', full_name: 'B', email: 'b@x.com', created_at: '2026-01-01' }),
    ]);
    expect(people).toHaveLength(2);
  });
});

describe('trialState', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it('uses the later of expiry and extension for activated passes', () => {
    expect(trialState({ activated_at: '2026-09-01', expires_at: '2026-10-01', extended_until: '2026-10-20' }, now).label).toBe('TRIAL · ACTIVE');
    expect(trialState({ activated_at: '2026-09-01', expires_at: '2026-10-01' }, now).label).toBe('TRIAL · EXPIRED');
    expect(trialState({ signup_expires_at: '2026-11-01' }, now).label).toBe('TRIAL · READY');
  });
});

describe('GET /api/admin/people-search', () => {
  let tables; let filters;
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ unauthorized: false });
    filters = [];
    tables = {
      member_profiles: [],
      membership_applications: [{ id: 'app1', applicant_user_id: 'u9', full_name: 'Mara Hollis', email: 'mara@x.com', phone: '+15125550117', plan: 'cowork', status: 'new', created_at: '2026-10-13', profile_photo_path: 'member-app/u9/p.jpg' }],
      trial_passes: [{ id: 't1', user_id: 'u2', full_name: 'Marcus Hill', email: 'mh@x.com', phone: '+17375550188', issued_at: '2026-10-04', activated_at: '2026-10-04', expires_at: '2099-11-03', guest_profile_id: 'g-trial', profile_photo_path: 'trial-pass/t1/photo.jpg' }],
      free_accounts: [],
      guest_profiles: [
        { id: 'g-trial', full_name: 'Marcus Hill', phone: '+17375550188', created_at: '2026-10-04' },
        { id: 'g2', full_name: 'Mark Hayes', phone: '+15125550163', first_seen_event_id: 'e1', created_at: '2026-10-04' },
      ],
      trial_pass_checkins: [{ trial_pass_id: 't1', checked_in_at: '2026-10-11T03:00:00Z' }],
      events: [{ id: 'e1', title: 'ACL Weekend 1 Closing Party', event_date: '2026-10-04' }],
    };
    const signMany = vi.fn(async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://img/${p}`, error: null })), error: null }));
    const admin = {
      storage: { from: () => ({ createSignedUrls: signMany, createSignedUrl: vi.fn() }) },
      from: (table) => {
        const q = {
          select: () => q, order: () => q, eq: () => q,
          ilike: (col, v) => { filters.push([table, 'ilike', col, v]); return q; },
          or: (v) => { filters.push([table, 'or', v]); return q; },
          in: () => q,
          limit: () => q,
          then: (res, rej) => Promise.resolve({ data: tables[table] || [], error: null }).then(res, rej),
        };
        return q;
      },
    };
    createAdminClient.mockReturnValue(admin);
  });

  it('rejects non-admins', async () => {
    requireAdmin.mockResolvedValue({ unauthorized: true });
    const res = await GET(new Request('https://x.test/api/admin/people-search?q=mar'));
    expect(res.status).toBe(401);
  });

  it('returns one row per person, skips the trial-linked door profile, and never exposes storage paths', async () => {
    const res = await GET(new Request('https://x.test/api/admin/people-search?q=mar%20h'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const { results } = await res.json();
    const names = results.map((r) => r.full_name).sort();
    expect(names).toEqual(['Mara Hollis', 'Marcus Hill', 'Mark Hayes']);
    const marcus = results.find((r) => r.full_name === 'Marcus Hill');
    expect(marcus.status.label).toBe('TRIAL · ACTIVE');
    expect(marcus.context).toContain('visited 1×');
    expect(marcus.photo_url).toBe('https://img/_thumbs/trial-pass/t1/photo.jpg.webp');
    const mark = results.find((r) => r.full_name === 'Mark Hayes');
    expect(mark.context).toContain('ACL Weekend 1 Closing Party');
    expect(results.find((r) => r.full_name === 'Mara Hollis').href).toBe('/bananas/people/application-app1');
    expect(JSON.stringify(results)).not.toMatch(/"(trial-pass|member-app)\//);
    expect(filters).toContainEqual(['trial_passes', 'or', 'full_name.ilike.%mar%,email.ilike.%mar%']);
  });

  it('searches phones by digits and skips the member table, which has no phone', async () => {
    await GET(new Request('https://x.test/api/admin/people-search?q=512-555-01'));
    expect(filters).toContainEqual(['trial_passes', 'ilike', 'phone', '%51255501%']);
    expect(filters.some(([t]) => t === 'member_profiles')).toBe(false);
  });

  it('returns nothing for a too-short query without touching the database', async () => {
    const res = await GET(new Request('https://x.test/api/admin/people-search?q=m'));
    expect((await res.json()).results).toEqual([]);
    expect(filters).toEqual([]);
  });
});
