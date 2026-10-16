// GET /api/admin/people-search?q=…
//
// Backs the people search bar at the top of every admin page. Finds anyone by
// name, phone (any format) or email across Guest accounts, Trial Passes,
// Members, Membership Applications and door/guest-list guests, folded into
// one row per person. See lib/people-search.js.
//
// Admin-gated (same audience as /bananas/members). Read-only. Storage paths
// never leave the server; photos are short-lived signed thumbnail URLs.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';
import {
  MAX_RESULTS, PER_SOURCE_LIMIT, applyPeopleFilter, mergePeople, parsePeopleQuery, rankPeople,
  recordFromAccount, recordFromApplication, recordFromGuestProfile, recordFromMember, recordFromTrial,
} from '@/lib/people-search';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const MEMBER_COLS = 'id, user_id, full_name, email, is_active, created_at, subscription_status, subscription_plan, current_period_end, cancel_at_period_end, application_id, profile_photo_path, photo_url';
const APP_COLS = 'id, applicant_user_id, full_name, preferred_name, email, phone, plan, status, created_at, profile_photo_path, photo_url';
const TRIAL_COLS = 'id, user_id, full_name, email, phone, status, signup_source, issued_at, expires_at, extended_until, activated_at, signup_expires_at, converted_at, phone_verified_at, guest_profile_id, profile_photo_path';
const ACCOUNT_COLS = 'id, user_id, full_name, email, phone, phone_verified_at, created_at, profile_photo_path';
const GUEST_COLS = 'id, full_name, email, phone, first_seen_event_id, created_at';

async function rows(label, builder) {
  if (!builder) return [];
  const { data, error } = await builder;
  if (error) {
    console.error('[people-search]', label, error.message || error);
    return [];
  }
  return data || [];
}

export async function GET(request) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q');
  const parsed = parsePeopleQuery(q);
  if (!parsed) return NextResponse.json({ query: q || '', results: [] }, { headers: NO_STORE });

  const admin = createAdminClient();
  const base = (table, cols, order) => admin.from(table).select(cols).order(order, { ascending: false }).limit(PER_SOURCE_LIMIT);

  // Members have no phone column of their own; their phone lives on the
  // application they joined through, so a phone search goes via applications.
  const [members, applications, trials, accounts, guests] = await Promise.all([
    parsed.kind === 'phone' ? [] : rows('members', applyPeopleFilter(base('member_profiles', MEMBER_COLS, 'created_at'), parsed, { phone: null })),
    rows('applications', applyPeopleFilter(base('membership_applications', APP_COLS, 'created_at'), parsed, { nameColumns: ['full_name', 'preferred_name'] })),
    rows('trials', applyPeopleFilter(base('trial_passes', TRIAL_COLS, 'issued_at'), parsed)),
    rows('accounts', applyPeopleFilter(base('free_accounts', ACCOUNT_COLS, 'created_at'), parsed)),
    rows('guests', applyPeopleFilter(base('guest_profiles', GUEST_COLS, 'created_at'), parsed)),
  ]);

  // Members reached through a matching application, plus each member's
  // application (for their phone).
  const appIds = applications.map((a) => a.id);
  const viaApps = appIds.length
    ? await rows('members.via-app', admin.from('member_profiles').select(MEMBER_COLS).in('application_id', appIds))
    : [];
  const allMembers = [...new Map([...members, ...viaApps].map((m) => [m.id, m])).values()];
  const missingAppIds = allMembers.map((m) => m.application_id).filter((id) => id && !appIds.includes(id));
  const memberApps = missingAppIds.length
    ? await rows('members.apps', admin.from('membership_applications').select(APP_COLS).in('id', missingAppIds))
    : [];
  const appById = new Map([...applications, ...memberApps].map((a) => [a.id, a]));

  // Trial visit counts and door-guest event names, only for matched rows.
  const trialIds = trials.map((t) => t.id);
  const eventIds = [...new Set(guests.map((g) => g.first_seen_event_id).filter(Boolean))];
  const [checkins, events] = await Promise.all([
    trialIds.length
      ? rows('checkins', admin.from('trial_pass_checkins').select('trial_pass_id, checked_in_at').eq('result', 'allowed').in('trial_pass_id', trialIds).limit(2000))
      : [],
    eventIds.length ? rows('events', admin.from('events').select('id, title, event_date').in('id', eventIds)) : [],
  ]);
  const visits = new Map();
  for (const c of checkins) {
    const v = visits.get(c.trial_pass_id) || { n: 0, last: null };
    v.n += 1;
    if (!v.last || c.checked_in_at > v.last) v.last = c.checked_in_at;
    visits.set(c.trial_pass_id, v);
  }
  const eventName = new Map(events.map((e) => [e.id, e.event_date ? `${e.title}, ${new Date(`${e.event_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : e.title]));

  // A guest_profiles row created from a trial pass is the same person as that
  // pass; skip it rather than show a duplicate "door guest".
  const trialGuestIds = new Set(trials.map((t) => t.guest_profile_id).filter(Boolean));
  const memberAppIds = new Set(allMembers.map((m) => m.application_id).filter(Boolean));

  const records = [
    ...allMembers.map((m) => recordFromMember(m, appById.get(m.application_id))),
    ...applications.filter((a) => !memberAppIds.has(a.id)).map(recordFromApplication),
    ...trials.map((t) => recordFromTrial(t, visits.get(t.id)?.n || 0, visits.get(t.id)?.last || null)),
    ...accounts.map(recordFromAccount),
    ...guests.filter((g) => !trialGuestIds.has(g.id)).map((g) => recordFromGuestProfile(g, eventName.get(g.first_seen_event_id))),
  ];

  const people = rankPeople(mergePeople(records), parsed).slice(0, MAX_RESULTS);

  // One small thumbnail per person: the first record that has a photo.
  const photoRows = people.map((p) => (p.photoSources[0] ? { ...p.photoSources[0], id: p.id } : null)).filter(Boolean);
  const photos = await resolveMemberPhotoUrls(admin, photoRows, { size: 'thumb' });

  const results = people.map(({ photoSources, rank, sort, ...p }) => ({ ...p, photo_url: photos.get(p.id) || null }));
  return NextResponse.json({ query: q, results }, { headers: NO_STORE });
}
