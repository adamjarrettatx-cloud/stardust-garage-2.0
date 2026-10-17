// Person Profile identity. One admin profile page per person, opened from the
// admin people search. A profile ref is `<source>-<uuid>` where source is the
// people-search record the admin clicked (member, application, trial,
// account, door). From that seed we follow the same joins people search uses
// to fold rows together: account (user_id), explicit record links
// (application_id, member_profile_id, guest_profile_id) and email.
//
// Phone is shown but never used to join here: stored formats vary and a
// mistyped number would quietly merge two people's history.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROFILE_SOURCES = Object.freeze({
  member: 'members',
  application: 'applications',
  trial: 'trials',
  account: 'accounts',
  door: 'guests',
});

// Hard caps keep a shared or placeholder email (e.g. a staff address used on
// many door entries) from turning one profile into hundreds of people.
const MAX_PER_KIND = 25;
const MAX_EMAILS = 6;
const MAX_PASSES = 4;

export const MEMBER_COLS = 'id, user_id, application_id, full_name, email, is_active, created_at, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, subscription_period, current_period_end, cancel_at_period_end, photo_url, expo_push_token, profile_photo_path';
export const APP_COLS = 'id, applicant_user_id, full_name, preferred_name, email, phone, plan, status, created_at, profile_photo_path, photo_url';
export const TRIAL_COLS = 'id, user_id, member_profile_id, guest_profile_id, application_id, full_name, email, email_canonical, phone, status, signup_source, issued_at, expires_at, extended_until, activated_at, signup_expires_at, converted_at, phone_verified_at, profile_photo_path';
export const ACCOUNT_COLS = 'id, user_id, full_name, email, phone, phone_verified_at, created_at, profile_photo_path';
export const GUEST_COLS = 'id, full_name, email, phone, marketing_consent, first_seen_event_id, created_at';

export function profileRef(source, id) {
  return `${source}-${id}`;
}

export function profileHref(source, id) {
  return `/bananas/people/${profileRef(source, id)}`;
}

export function parseProfileRef(raw) {
  const ref = decodeURIComponent(String(raw || '')).trim();
  const dash = ref.indexOf('-');
  if (dash < 1) return null;
  const source = ref.slice(0, dash);
  const id = ref.slice(dash + 1);
  if (!Object.hasOwn(PROFILE_SOURCES, source) || !UUID_RE.test(id)) return null;
  return { source, id: id.toLowerCase() };
}

export function normalizeEmail(value) {
  const e = String(value || '').trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

// LIKE treats _ and % as wildcards; escape them so ilike is a plain
// case-insensitive equality. Results are re-checked exactly in JS anyway.
export function likeExact(email) {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function emptySets() {
  return {
    user: new Set(), member: new Set(), application: new Set(), trial: new Set(),
    account: new Set(), guest: new Set(), email: new Set(),
  };
}

// Identity keys in the shared `<kind>:<uuid>` format used by security
// incidents, access restrictions and front desk arrivals, plus `application:`
// so notes written on an applicant-only profile still follow them.
export function identityKeysFor(sets) {
  const keys = [];
  for (const id of sets.user) keys.push(`user:${id}`);
  for (const id of sets.member) keys.push(`member:${id}`);
  for (const id of sets.trial) keys.push(`trial_pass:${id}`);
  for (const id of sets.guest) keys.push(`guest:${id}`);
  for (const id of sets.application) keys.push(`application:${id}`);
  return keys;
}

// The most durable key anchors notes/tags written on this profile.
export function anchorKeyFor(sets) {
  const first = (s) => [...s].sort()[0];
  if (sets.user.size) return `user:${first(sets.user)}`;
  if (sets.member.size) return `member:${first(sets.member)}`;
  if (sets.trial.size) return `trial_pass:${first(sets.trial)}`;
  if (sets.application.size) return `application:${first(sets.application)}`;
  if (sets.guest.size) return `guest:${first(sets.guest)}`;
  return null;
}

async function selectByIds(admin, table, cols, column, ids) {
  if (!ids.length) return [];
  const { data, error } = await admin.from(table).select(cols).in(column, ids.slice(0, MAX_PER_KIND));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function selectByEmails(admin, table, cols, column, emails) {
  const out = [];
  for (const e of emails) {
    const { data, error } = await admin.from(table).select(cols).ilike(column, likeExact(e)).limit(MAX_PER_KIND);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data || []) if (normalizeEmail(row[column]) === e) out.push(row);
  }
  return out;
}

function addAll(map, rows) {
  let added = false;
  for (const r of rows) {
    if (r?.id && !map.has(r.id) && map.size < MAX_PER_KIND) { map.set(r.id, r); added = true; }
  }
  return added;
}

// Resolve a profile ref into every linked record. Returns null when the
// seed record does not exist.
export async function resolvePersonIdentity(admin, rawRef) {
  const parsed = typeof rawRef === 'string' ? parseProfileRef(rawRef) : rawRef;
  if (!parsed) return null;

  const sets = emptySets();
  const seedSet = { member: 'member', application: 'application', trial: 'trial', account: 'account', door: 'guest' }[parsed.source];
  sets[seedSet].add(parsed.id);

  const rec = {
    members: new Map(), applications: new Map(), trials: new Map(), accounts: new Map(), guests: new Map(),
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const ids = (s) => [...s];
    const emails = ids(sets.email).slice(0, MAX_EMAILS);
    const [m1, m2, m3, a1, a2, a3, t1, t2, t3, t4, t5, t6, c1, c2, c3, g1, g2] = await Promise.all([
      selectByIds(admin, 'member_profiles', MEMBER_COLS, 'id', ids(sets.member)),
      selectByIds(admin, 'member_profiles', MEMBER_COLS, 'user_id', ids(sets.user)),
      selectByEmails(admin, 'member_profiles', MEMBER_COLS, 'email', emails),
      selectByIds(admin, 'membership_applications', APP_COLS, 'id', ids(sets.application)),
      selectByIds(admin, 'membership_applications', APP_COLS, 'applicant_user_id', ids(sets.user)),
      selectByEmails(admin, 'membership_applications', APP_COLS, 'email', emails),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'id', ids(sets.trial)),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'user_id', ids(sets.user)),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'member_profile_id', ids(sets.member)),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'guest_profile_id', ids(sets.guest)),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'application_id', ids(sets.application)),
      selectByIds(admin, 'trial_passes', TRIAL_COLS, 'email_canonical', emails),
      selectByIds(admin, 'free_accounts', ACCOUNT_COLS, 'id', ids(sets.account)),
      selectByIds(admin, 'free_accounts', ACCOUNT_COLS, 'user_id', ids(sets.user)),
      selectByEmails(admin, 'free_accounts', ACCOUNT_COLS, 'email', emails),
      selectByIds(admin, 'guest_profiles', GUEST_COLS, 'id', ids(sets.guest)),
      selectByEmails(admin, 'guest_profiles', GUEST_COLS, 'email', emails),
    ]);

    let grew = false;
    grew = addAll(rec.members, [...m1, ...m2, ...m3]) || grew;
    grew = addAll(rec.applications, [...a1, ...a2, ...a3]) || grew;
    grew = addAll(rec.trials, [...t1, ...t2, ...t3, ...t4, ...t5, ...t6]) || grew;
    grew = addAll(rec.accounts, [...c1, ...c2, ...c3]) || grew;
    grew = addAll(rec.guests, [...g1, ...g2]) || grew;

    const before = Object.values(sets).reduce((n, s) => n + s.size, 0);
    const addEmail = (e) => { const n = normalizeEmail(e); if (n && sets.email.size < MAX_EMAILS) sets.email.add(n); };
    for (const m of rec.members.values()) {
      sets.member.add(m.id); if (m.user_id) sets.user.add(m.user_id);
      if (m.application_id) sets.application.add(m.application_id); addEmail(m.email);
    }
    for (const a of rec.applications.values()) {
      sets.application.add(a.id); if (a.applicant_user_id) sets.user.add(a.applicant_user_id); addEmail(a.email);
    }
    for (const t of rec.trials.values()) {
      sets.trial.add(t.id);
      if (t.user_id) sets.user.add(t.user_id);
      if (t.member_profile_id) sets.member.add(t.member_profile_id);
      if (t.guest_profile_id) sets.guest.add(t.guest_profile_id);
      if (t.application_id) sets.application.add(t.application_id);
      addEmail(t.email_canonical || t.email);
    }
    for (const c of rec.accounts.values()) {
      sets.account.add(c.id); if (c.user_id) sets.user.add(c.user_id); addEmail(c.email);
    }
    for (const g of rec.guests.values()) { sets.guest.add(g.id); addEmail(g.email); }
    const after = Object.values(sets).reduce((n, s) => n + s.size, 0);
    if (!grew && after === before) break;
  }

  const seedMap = { member: rec.members, application: rec.applications, trial: rec.trials, account: rec.accounts, door: rec.guests }[parsed.source];
  if (!seedMap.has(parsed.id)) return null;

  return {
    ref: parsed,
    records: {
      members: [...rec.members.values()],
      applications: [...rec.applications.values()],
      trials: [...rec.trials.values()],
      accounts: [...rec.accounts.values()],
      guests: [...rec.guests.values()],
    },
    ids: {
      users: [...sets.user], members: [...sets.member], applications: [...sets.application],
      trials: [...sets.trial], accounts: [...sets.account], guests: [...sets.guest],
    },
    emails: [...sets.email],
    identityKeys: identityKeysFor(sets),
    anchorKey: anchorKeyFor(sets),
  };
}
