import { describe, expect, it } from 'vitest';
import {
  venueNight, buildVisits, visitStats, interestBreakdown, guestsBrought,
  spendSummary, contactPermissions, percentileBadge,
} from '@/lib/person-profile/summary';
import { parseProfileRef, profileHref, identityKeysFor, anchorKeyFor, likeExact } from '@/lib/person-profile/identity';
import { countVisitsByPerson } from '@/lib/person-profile/loyalty';
import { normalizeTagLabel, presentNote } from '@/lib/person-notes';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

describe('profile refs', () => {
  it('parses source-uuid refs and rejects anything else', () => {
    expect(parseProfileRef(`member-${U}`)).toEqual({ source: 'member', id: U });
    expect(parseProfileRef(`door-${U.toUpperCase()}`)).toEqual({ source: 'door', id: U });
    expect(parseProfileRef(`admin-${U}`)).toBeNull();
    expect(parseProfileRef('member-not-a-uuid')).toBeNull();
    expect(parseProfileRef('')).toBeNull();
    expect(profileHref('trial', T)).toBe(`/bananas/people/trial-${T}`);
  });
  it('builds shared identity keys and a durable anchor', () => {
    const sets = { user: new Set([U]), member: new Set(), application: new Set(), trial: new Set([T]), account: new Set(), guest: new Set(), email: new Set() };
    expect(identityKeysFor(sets)).toEqual([`user:${U}`, `trial_pass:${T}`]);
    expect(anchorKeyFor(sets)).toBe(`user:${U}`);
    sets.user.clear();
    expect(anchorKeyFor(sets)).toBe(`trial_pass:${T}`);
  });
  it('escapes LIKE wildcards in emails', () => {
    expect(likeExact('first_last%x@ex.com')).toBe('first\\_last\\%x@ex.com');
  });
});

describe('venue nights', () => {
  it('counts after-midnight arrivals toward the previous night (Chicago)', () => {
    expect(venueNight('2026-10-11T06:30:00Z')).toBe('2026-10-10'); // 1:30am CDT
    expect(venueNight('2026-10-11T12:00:00Z')).toBe('2026-10-11'); // 7am CDT
    expect(venueNight(null)).toBeNull();
  });
});

describe('visits', () => {
  const events = new Map([
    ['e1', { id: 'e1', title: 'Afterhours Social', event_date: '2026-10-10', category: 'sdg_party' }],
    ['e2', { id: 'e2', title: 'Team sync', event_date: '2026-10-10', category: 'internal' }],
    ['e3', { id: 'e3', title: 'Day Party', event_date: '2026-09-01', category: 'day_party' }],
  ]);
  const touches = [
    { method: 'front_desk', day: '2026-10-10' },
    { method: 'trial', event_id: 'e1', at: '2026-10-11T04:00:00Z' },
    { method: 'ticket', event_id: 'e2' },
    { method: 'tt_ticket', event_id: 'e3' },
    { method: 'front_desk', day: '2026-10-01' },
    { method: 'tt_ticket', event_id: null, ext: 'tt-99' },
  ];
  const visits = buildVisits(touches, events);
  it('folds every touch on one night into a single visit led by the guest event', () => {
    expect(visits).toHaveLength(4);
    expect(visits[0]).toMatchObject({ day: '2026-10-10', title: 'Afterhours Social', kind: 'event', method: 'TICKET' });
    expect(visits[0].how).toBe('Ticket · Trial Pass · Front desk arrival');
    expect(visits[1]).toMatchObject({ day: '2026-10-01', title: 'Front desk visit', kind: 'front_desk' });
    expect(visits[3]).toMatchObject({ day: null });
  });
  it('computes monthly stats from dated visits', () => {
    const s = visitStats(visits, { now: new Date('2026-10-17T18:00:00Z'), firstSeen: '2026-08-15T00:00:00Z' });
    expect(s.total).toBe(4);
    expect(s.events).toBe(3);
    expect(s.frontDesk).toBe(1);
    expect(s.perMonth90).toBe(1);
    expect(s.last).toEqual({ day: '2026-10-10', daysAgo: 7, title: 'Afterhours Social' });
    expect(s.months.at(-1)).toMatchObject({ key: '2026-10', count: 2, current: true });
    expect(s.months.length).toBeGreaterThanOrEqual(6);
  });
  it('matches a bare front desk night to the single guest event that night', () => {
    const night = new Map([['2026-10-01', [{ id: 'e9', title: 'Weeknight Social', event_date: '2026-10-01', category: 'sdg_party' }, { id: 'e8', title: 'Staff', event_date: '2026-10-01', category: 'internal' }]]]);
    const v = buildVisits([{ method: 'front_desk', day: '2026-10-01' }, { method: 'front_desk', day: '2026-10-02' }], new Map(), night);
    expect(v[1]).toMatchObject({ title: 'Weeknight Social', kind: 'event', how: 'Front desk arrival' });
    expect(v[0]).toMatchObject({ title: 'Front desk visit', kind: 'front_desk' });
  });
  it('ranks interests and skips team-only categories', () => {
    const rows = interestBreakdown(visits);
    expect(rows.map((r) => r.label)).toEqual(['SDG Party', 'Day Party']);
    expect(rows[0].pct).toBe(100);
  });
});

describe('spend and guests', () => {
  it('nets refunds, skips cancelled bookings and unpaid orders', () => {
    const s = spendSummary({
      orders: [
        { status: 'paid', total_cents: 3200, refunded_cents: 0 },
        { status: 'refunded', total_cents: 3500, refunded_cents: 3500 },
        { status: 'pending', total_cents: 9999 },
      ],
      bookings: [{ total_cost_cents: 6000 }, { total_cost_cents: 4000, cancelled_at: '2026-01-01' }],
      invoices: [{ amount_paid: 11900 }],
    });
    expect(s).toMatchObject({ tickets: 3200, studio: 6000, dues: 11900, total: 21100, refunded: 3500, duesAvailable: true });
    expect(spendSummary({ invoices: null }).duesAvailable).toBe(false);
  });
  it('counts extra used tickets per event as guests brought', () => {
    expect(guestsBrought(new Map([['e1', 3], ['e2', 1], ['e3', 0]]))).toBe(2);
  });
});

describe('contact permissions', () => {
  it('reads list signups, door consent, opt-outs, push and phone signups', () => {
    const p = contactPermissions({
      emails: ['m@x.com'], phones: ['5125550148'],
      signups: [{ contact_type: 'email', contact: 'M@x.com', source: 'trial_pass_qr' }, { contact_type: 'phone', contact: '+15125550148', source: 'homepage' }],
      pushCount: 2,
    });
    expect(p.email.label).toBe('ON LIST');
    expect(p.push).toMatchObject({ label: 'ON', note: '2 devices' });
    expect(p.sms.label).toBe('SIGNED UP');
    const out = contactPermissions({ emails: ['m@x.com'], signups: [{ contact_type: 'email', contact: 'm@x.com' }], prefs: [{ type: 'marketing_broadcast', email: false }] });
    expect(out.email.label).toBe('OPTED OUT');
    expect(contactPermissions({}).sms.label).toBe('NO CONSENT');
  });
});

describe('loyalty', () => {
  it('ranks people by distinct visit nights across sources', () => {
    const counts = countVisitsByPerson({
      trials: [{ id: 't1', email_canonical: 'a@x.com', user_id: 'u1' }, { id: 't2', email: 'b@x.com' }],
      doorAdmissions: [{ subject_kind: 'trial_pass', subject_id: 't1', event_id: 'e1' }, { person_key: 'user:u1', subject_kind: 'x', event_id: 'e1' }],
      arrivals: [{ subject_kind: 'trial_pass', subject_id: 't1', shift_day: '2026-10-02' }],
      trialCheckins: [{ trial_pass_id: 't2', event_id: 'e1' }],
      ttTickets: [{ buyer_email: 'A@x.com', local_event_id: 'e2' }, { buyer_email: 'a@x.com', local_event_id: 'e2' }],
      events: [{ id: 'e1', event_date: '2026-10-10' }, { id: 'e2', event_date: '2026-09-01' }],
    });
    expect(counts.sort()).toEqual([1, 3]);
    expect(percentileBadge(3, [3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe('TOP 5% BY VISITS');
    expect(percentileBadge(1, [3, 1])).toBeNull();
    expect(percentileBadge(0, [1])).toBeNull();
  });
});

describe('notes and tags', () => {
  it('normalizes tags', () => {
    expect(normalizeTagLabel('  VIP   guest ')).toEqual({ label: 'VIP guest' });
    expect(normalizeTagLabel('').error).toBeTruthy();
    expect(normalizeTagLabel('x'.repeat(33)).error).toBeTruthy();
  });
  it('lets only the author edit and the author or owner delete', () => {
    const row = { id: 'n1', author_id: 'u-a', author_name: 'Jeyu', body: 'hi', created_at: 'x' };
    expect(presentNote(row, { id: 'u-a' })).toMatchObject({ can_edit: true, can_delete: true });
    expect(presentNote(row, { id: 'u-b', isOwner: true })).toMatchObject({ can_edit: false, can_delete: true });
    expect(presentNote(row, { id: 'u-b' })).toMatchObject({ can_edit: false, can_delete: false });
  });
});

describe('person notes API rules', async () => {
  const { createPersonNote, updatePersonNote, deletePersonNote, addPersonTag } = await import('@/lib/person-notes');
  function fakeDb() {
    const tables = { person_notes: [], person_tags: [], team_members: [{ user_id: 'u-a', full_name: 'Adam', email: 'a@sdg' }] };
    let seq = 0;
    const from = (table) => {
      const filters = []; let op = 'select'; let payload = null; let single = false;
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        insert(p) { op = 'insert'; payload = p; return api; },
        update(p) { op = 'update'; payload = p; return api; },
        eq(k, v) { filters.push((r) => r[k] === v); return api; },
        is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
        ilike(k, v) { filters.push((r) => String(r[k]).toLowerCase() === v.replace(/\\/g, '').toLowerCase()); return api; },
        overlaps(k, v) { filters.push((r) => (r[k] || []).some((x) => v.includes(x))); return api; },
        single() { single = true; return api; }, maybeSingle() { single = true; return api; },
        then(res) {
          const rows = tables[table];
          if (op === 'insert') { const row = { id: `r${++seq}`, created_at: new Date().toISOString(), ...payload }; rows.push(row); return res({ data: row, error: null }); }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return res({ data: single ? hit[0] || null : hit, error: null }); }
          return res({ data: single ? hit[0] || null : hit, error: null });
        },
      };
      return api;
    };
    return { tables, from };
  }
  const db = fakeDb();
  const people = {
    'member-a': { anchorKey: 'user:a', identityKeys: ['user:a', 'trial_pass:t'] },
    'member-b': { anchorKey: 'user:b', identityKeys: ['user:b'] },
  };
  const deps = (userId = 'u-a', email = 'a@sdg') => ({
    requireAdminMfa: async () => (userId ? { user: { id: userId, email } } : { unauthorized: true }),
    ownerEmail: 'owner@sdg',
    createAdminClient: async () => db,
    resolveIdentity: async (_db, ref) => people[ref] || null,
  });

  it('requires an admin session and an existing person', async () => {
    expect((await createPersonNote({ ref: 'member-a', rawBody: 'x', deps: deps(null) })).status).toBe(401);
    expect((await createPersonNote({ ref: 'member-zzz', rawBody: 'x', deps: deps() })).status).toBe(404);
  });
  it('stores every identity key and refuses edits from another profile or user', async () => {
    const created = await createPersonNote({ ref: 'member-a', rawBody: '  Regular on disco nights ', deps: deps() });
    expect(created.status).toBe(201);
    expect(db.tables.person_notes[0]).toMatchObject({ anchor_key: 'user:a', identity_keys: ['user:a', 'trial_pass:t'], body: 'Regular on disco nights', author_name: 'Adam' });
    const id = created.body.note.id;
    expect((await updatePersonNote({ ref: 'member-b', noteId: id, rawBody: 'y', deps: deps() })).status).toBe(404);
    expect((await updatePersonNote({ ref: 'member-a', noteId: id, rawBody: 'y', deps: deps('u-z', 'z@sdg') })).status).toBe(403);
    expect((await deletePersonNote({ ref: 'member-a', noteId: id, deps: deps('u-z', 'z@sdg') })).status).toBe(403);
    expect((await deletePersonNote({ ref: 'member-a', noteId: id, deps: deps('u-o', 'owner@sdg') })).status).toBe(200);
    expect(db.tables.person_notes[0].deleted_at).toBeTruthy();
  });
  it('dedupes tags case-insensitively', async () => {
    const a = await addPersonTag({ ref: 'member-a', rawLabel: 'VIP', deps: deps() });
    const b = await addPersonTag({ ref: 'member-a', rawLabel: 'vip', deps: deps() });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(db.tables.person_tags).toHaveLength(1);
  });
});
