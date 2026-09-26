import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
import { resolveMemberPhotoUrl } from '@/lib/member-photo';
import { evaluateDoorScan, isPassLive } from '@/lib/trial-pass';
import { escapeNameSearch, orderArrivals, shiftWindow } from './arrival-roster';

const LIMIT = 500;
const SEARCH_LIMIT = 51;
const PASS = 'id,full_name,user_id,guest_profile_id,member_profile_id,issued_at,activated_at,status,expires_at,extended_until,signup_expires_at,profile_photo_path';
const MEMBER = 'id,full_name,user_id,is_active,subscription_status,subscription_plan,profile_photo_path,photo_url';
const GUEST = 'id,full_name';
const TABLES = { trial_pass: ['trial_passes', PASS], member: ['member_profiles', MEMBER], guest: ['guest_profiles', GUEST] };
const unique = values => [...new Set(values.filter(Boolean))];
async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error('Guest lookup unavailable. Hold entry and retry.');
  return data || [];
}
async function related(admin, table, columns, field, ids) {
  if (!ids.length) return [];
  const rows = await read(admin.from(table).select(columns).in(field, unique(ids)).limit(2000));
  if (rows.length === 2000) throw new Error('Too many linked records. Narrow the search.');
  return rows;
}
export async function rosterContext(admin) {
  const sessions = await read(admin.from('door_sessions').select('id,event_id')
    .is('closed_at', null).order('opened_at', { ascending: false }).limit(1));
  const session = sessions[0] || null;
  const events = session ? await read(admin.from('events').select('id,is_weekend_music_experience')
    .eq('id', session.event_id).limit(1)) : [];
  if (session && !events[0]) throw new Error('Active event could not be verified. Hold entry.');
  return { session, event: events[0] || null };
}
export async function arrivalRecords(admin, shiftDay = shiftWindow().shiftDay) {
  return read(admin.from('front_desk_arrivals')
    .select('id,subject_kind,subject_id,identity_keys,checked_in_at')
    .eq('shift_day', shiftDay).order('checked_in_at', { ascending: false }).limit(LIMIT + 1));
}

// Enrich only bounded candidates. Join by explicit identity links, NEVER by name.
// Emails, phone numbers, auth ids, tokens and private paths stay off the wire.
export async function hydratePeople(admin, seeds, arrivals, context, since) {
  const records = new Map();
  const put = (kind, rows) => rows.forEach(row => records.set(`${kind}:${row.id}`, { ...row, kind }));
  for (const [kind, rows] of Object.entries(seeds)) put(kind, rows);
  const initial = [...records.values()];
  const passes = initial.filter(r => r.kind === 'trial_pass');
  const morePasses = [
    ...await related(admin, 'trial_passes', PASS, 'guest_profile_id', initial.filter(r => r.kind === 'guest').map(r => r.id)),
    ...await related(admin, 'trial_passes', PASS, 'member_profile_id', initial.filter(r => r.kind === 'member').map(r => r.id)),
    ...await related(admin, 'trial_passes', PASS, 'user_id', initial.map(r => r.user_id)),
  ];
  put('trial_pass', morePasses);
  // A guest-only seed can reveal a user link that was absent from the initial
  // name matches. Include that account's other passes before grouping/checking.
  const siblingPasses = await related(admin, 'trial_passes', PASS, 'user_id', morePasses.map(r => r.user_id));
  put('trial_pass', siblingPasses);
  const allPasses = [...passes, ...morePasses, ...siblingPasses];
  put('member', await related(admin, 'member_profiles', MEMBER, 'id', allPasses.map(r => r.member_profile_id)));
  put('member', await related(admin, 'member_profiles', MEMBER, 'user_id', [...initial, ...allPasses].map(r => r.user_id)));
  put('guest', await related(admin, 'guest_profiles', GUEST, 'id', allPasses.map(r => r.guest_profile_id)));
  const all = [...records.values()];
  const accounts = await related(admin, 'free_accounts', 'user_id,profile_photo_path', 'user_id', all.map(r => r.user_id));
  const photoByUser = new Map(accounts.map(r => [r.user_id, r.profile_photo_path]));

  const parents = new Map();
  function root(key) {
    if (!parents.has(key)) parents.set(key, key);
    if (parents.get(key) !== key) parents.set(key, root(parents.get(key)));
    return parents.get(key);
  }
  function keys(row) {
    return unique([`${row.kind}:${row.id}`, row.user_id && `user:${row.user_id}`,
      row.guest_profile_id && `guest:${row.guest_profile_id}`,
      row.member_profile_id && `member:${row.member_profile_id}`]);
  }
  for (const row of all) {
    const links = keys(row);
    links.slice(1).forEach(key => parents.set(root(key), root(links[0])));
  }
  const groups = new Map();
  for (const row of all) {
    const key = root(`${row.kind}:${row.id}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const shape = async group => {
    const members = group.filter(r => r.kind === 'member');
    const trials = group.filter(r => r.kind === 'trial_pass').sort((a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at));
    const primary = members.find(r => r.is_active && ['active', 'trialing'].includes(r.subscription_status))
      || trials.find(r => isPassLive(r)) || members[0] || trials[0] || group[0];
    const identityKeys = unique(group.flatMap(keys));
    const arrival = arrivals.filter(r => r.identity_keys.some(key => identityKeys.includes(key)))
      .sort((a,b) => Date.parse(b.checked_in_at) - Date.parse(a.checked_in_at))[0];
    const signup = trials.find(r => Date.parse(r.issued_at) >= Date.parse(since));
    let photoUrl = null;
    // Match the unified profile's photo first, then the credential's photo.
    const accountPath = group.map(r => photoByUser.get(r.user_id)).find(Boolean);
    if (accountPath) photoUrl = (await createProfilePhotoSignedUrl(admin, accountPath))?.signedUrl || null;
    if (!photoUrl && primary.kind === 'member') photoUrl = await resolveMemberPhotoUrl(admin, primary);
    if (!photoUrl) {
      const path = trials.find(r => r.profile_photo_path)?.profile_photo_path;
      if (path) photoUrl = (await createProfilePhotoSignedUrl(admin, path))?.signedUrl || null;
    }
    let reason = null;
    if (primary.kind === 'trial_pass') {
      // The roster is an arrival/capacity record, not QR activation. Event
      // eligibility (Weekend Music Experience) governs QR activation and the
      // ticket discount only, so it must not block a named roster check-in.
      // Expiry and the photo gate still apply.
      const decision = evaluateDoorScan({ pass: primary, event: null });
      if (!decision.allowed) reason = decision.reason;
    } else if (primary.kind === 'member' && (!primary.is_active || !['active','trialing'].includes(primary.subscription_status))) {
      reason = 'Membership is not active. Review admission with a manager.';
    } else if (primary.kind === 'guest') {
      reason = 'No active pass or membership linked. Use the guest-list or ticket scanner to verify admission.';
    }
    if (!reason && !photoUrl) reason = 'Profile photo unavailable. Complete photo verification before check-in.';
    const checkedAt = arrival?.checked_in_at || null;
    const issuedAt = signup?.issued_at || null;
    const activityAt = [checkedAt, issuedAt].filter(Boolean).sort((a,b) => Date.parse(b) - Date.parse(a))[0] || null;
    return {
      // Internal identity data is returned only to server callers.
      identityKeys, group,
      wire: {
        id: primary.id, kind: primary.kind, full_name: primary.full_name || 'Guest',
        photo_url: photoUrl, label: primary.kind === 'member' ? 'Member' : primary.kind === 'trial_pass' ? 'Trial Pass' : 'Guest',
        issued_at: issuedAt, checked_in_at: checkedAt, activity_at: activityAt,
        activity_kind: checkedAt && (!issuedAt || Date.parse(checkedAt) >= Date.parse(issuedAt)) ? 'check_in' : 'signup',
        admission_reason: reason,
      },
    };
  };
  const output = [], grouped = [...groups.values()];
  // Do not fan out hundreds of storage-signing requests at a busy door.
  for (let offset = 0; offset < grouped.length; offset += 20) {
    output.push(...await Promise.all(grouped.slice(offset, offset + 20).map(shape)));
  }
  return output;
}

export async function loadRoster(admin, { query = '', subject = null, now = new Date() } = {}) {
  const { since, shiftDay } = shiftWindow(now);
  const arrivals = await arrivalRecords(admin, shiftDay);
  if (arrivals.length > LIMIT) throw new Error('Tonight’s roster exceeds its display limit. Contact a manager.');
  const context = await rosterContext(admin);
  const seeds = { trial_pass: [], member: [], guest: [] };
  let truncated = false;
  if (subject) {
    const [table, columns] = TABLES[subject.kind];
    seeds[subject.kind] = await read(admin.from(table).select(columns).eq('id', subject.id).limit(1));
    if (!seeds[subject.kind].length) throw new Error('Guest record not found.');
  } else if (query) {
    for (const [kind, [table, columns]] of Object.entries(TABLES)) {
      // No PostgREST .or() interpolation. Wildcards are escaped; tokens are ANDed.
      let request = admin.from(table).select(columns);
      for (const part of query.trim().split(/\s+/)) request = request.ilike('full_name', `%${escapeNameSearch(part)}%`);
      const matches = await read(request.order('full_name').order('id').limit(SEARCH_LIMIT));
      truncated ||= matches.length === SEARCH_LIMIT;
      seeds[kind] = matches.slice(0, SEARCH_LIMIT - 1);
    }
  } else {
    seeds.trial_pass = await read(admin.from('trial_passes').select(PASS)
      .gte('issued_at', since).order('issued_at', { ascending: false }).limit(LIMIT + 1));
    if (seeds.trial_pass.length > LIMIT) throw new Error('Tonight’s roster exceeds its display limit. Contact a manager.');
    for (const [kind, [table, columns]] of Object.entries(TABLES)) {
      seeds[kind].push(...await related(admin, table, columns, 'id', arrivals.filter(r => r.subject_kind === kind).map(r => r.subject_id)));
    }
  }
  const people = await hydratePeople(admin, seeds, arrivals, context, since);
  const rows = people.map(p => p.wire);
  return { people, context, shiftDay, since, truncated,
    signins: query || subject ? rows.sort((a,b) => a.full_name.localeCompare(b.full_name)) : orderArrivals(rows.filter(r => r.activity_at)),
  };
}
