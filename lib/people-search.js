// Admin-wide people search: one box that finds anyone the venue knows about
// by name, phone or email — Guest accounts, Trial Passes, Members, Membership
// Applications and door/guest-list guests — and folds the records that
// belong to one person into a single result.
//
// Server-only. The route (app/api/admin/people-search) gates on requireAdmin
// and reads with the service-role client; storage paths never leave here.

import { formatPhone, usPhoneDigits } from '@/lib/phone';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import { profileHref } from '@/lib/person-profile/identity';

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const PER_SOURCE_LIMIT = 25;
export const MAX_RESULTS = 30;

// ── Query parsing ───────────────────────────────────────────────────────────
// Returns { kind: 'phone', digits } | { kind: 'text', tokens } | null.
// A query made only of digits and phone punctuation is a phone search, so
// "512-555-01", "(512) 555 0142" and "+1 512…" all match the stored E.164
// "+15125550142". Everything else is name/email text.
export function parsePeopleQuery(raw) {
  const q = String(raw ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) return null;
  if (/^[\d\s()+.\-]+$/.test(q)) {
    let digits = q.replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    else if (q.trim().startsWith('+1') && digits.startsWith('1')) digits = digits.slice(1);
    if (digits.length < 3) return null;
    return { kind: 'phone', digits };
  }
  // PostgREST filter syntax uses , ( ) and * / % specially. Keep only the
  // characters real names and emails need, then split into words.
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._'+\- ]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-']+|[.\-']+$/g, ''))
    .filter(Boolean)
    .slice(0, 5);
  if (tokens.length === 0) return null;
  return { kind: 'text', tokens };
}

// Apply the parsed query to a PostgREST builder. Every word must match the
// name or the email; phone searches match a digit run inside the phone.
export function applyPeopleFilter(query, parsed, { nameColumns = ['full_name'], email = 'email', phone = 'phone' } = {}) {
  if (parsed.kind === 'phone') {
    return phone ? query.ilike(phone, `%${parsed.digits}%`) : null;
  }
  let q = query;
  for (const token of parsed.tokens) {
    const cols = [...nameColumns, email].filter(Boolean);
    q = q.or(cols.map((c) => `${c}.ilike.%${token}%`).join(','));
  }
  return q;
}

// ── Status labels ───────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

export function memberStatus(m) {
  const plan = (PLAN_DISPLAY[m.subscription_plan] || m.subscription_plan || 'Member').toUpperCase();
  const s = m.subscription_status;
  if (!m.is_active || s === 'canceled' || s === 'cancelled' || s === 'incomplete_expired') {
    return { label: `${plan} · ENDED`, tone: 'muted', rank: 40 };
  }
  if (s === 'past_due' || s === 'unpaid') return { label: `${plan} · PAST DUE`, tone: 'warn', rank: 95 };
  if (m.cancel_at_period_end) return { label: `${plan} · CANCELLING`, tone: 'warn', rank: 96 };
  return { label: plan, tone: 'member', rank: 100 };
}

export function trialState(p, now = Date.now()) {
  const activated = Boolean(p.activated_at);
  // Matches the door's rule: an activated pass runs to the later of its
  // expiry and any extension; an unused pass to its signup window.
  const later = [p.expires_at, p.extended_until].filter(Boolean).sort().pop() || null;
  const expiry = activated ? later : p.signup_expires_at;
  const expired = p.status === 'expired' || (expiry && new Date(expiry).getTime() < now);
  if (p.converted_at) return { label: 'TRIAL · CONVERTED', tone: 'muted', rank: 30, expiry };
  if (expired) return { label: 'TRIAL · EXPIRED', tone: 'muted', rank: 45, expiry };
  if (activated) return { label: 'TRIAL · ACTIVE', tone: 'trial', rank: 80, expiry };
  return { label: 'TRIAL · READY', tone: 'trial', rank: 75, expiry };
}

function applicationStatus(a) {
  // Only canonical plan keys get a label; legacy application keys are omitted
  // rather than shown as raw slugs.
  const plan = (PLAN_DISPLAY[a.plan] || '').toUpperCase();
  const s = (a.status || 'new').toLowerCase();
  const suffix = plan ? ` · ${plan}` : '';
  if (s === 'approved') return { label: `APPROVED${suffix}`, tone: 'neutral', rank: 50, pending: false };
  if (s === 'rejected' || s === 'declined' || s === 'archived') return { label: `APPLICATION ${s.toUpperCase()}`, tone: 'muted', rank: 35, pending: false };
  return { label: `APPLICANT${suffix}`, tone: 'neutral', rank: 85, pending: true };
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : null);
const SOURCE_LABELS = { trial_pass_qr: 'Self-serve QR', front_desk_manual: 'Front-desk manual', unknown: 'Unknown' };

// ── Record → result pieces ──────────────────────────────────────────────────
// Each source contributes a "record" with a person key, a status chip, a
// context line, detail fields and (optionally) an Open link.
export function recordFromMember(m, application) {
  const status = memberStatus(m);
  return {
    source: 'member', id: m.id, key: personKey(m.user_id, m.email, application?.phone),
    full_name: m.full_name, email: m.email, phone: application?.phone || null,
    photo: { id: `member:${m.id}`, profile_photo_path: m.profile_photo_path, photo_url: m.photo_url },
    status, href: `/bananas/members/${m.id}`, hrefLabel: 'Open member',
    context: [`Member since ${fmtDate(m.created_at)}`, m.current_period_end && status.tone !== 'muted' ? `renews ${fmtDate(m.current_period_end)}` : null].filter(Boolean).join(' · '),
    sort: m.created_at,
    category: 'members',
  };
}

export function recordFromApplication(a) {
  const status = applicationStatus(a);
  return {
    source: 'application', id: a.id, key: personKey(a.applicant_user_id, a.email, a.phone),
    full_name: a.full_name, email: a.email, phone: a.phone,
    photo: { id: `application:${a.id}`, profile_photo_path: a.profile_photo_path, photo_url: a.photo_url },
    status, href: `/bananas/applications/${a.id}`, hrefLabel: 'Open application',
    context: `Applied ${fmtDate(a.created_at)}${status.pending ? ' · pending review' : ''}`,
    sort: a.created_at,
    category: 'applicants',
  };
}

export function recordFromTrial(p, visits = 0, lastVisit = null) {
  const state = trialState(p);
  const bits = [];
  if (state.label === 'TRIAL · EXPIRED') bits.push(`Expired ${fmtDate(state.expiry)}`);
  else if (state.label === 'TRIAL · ACTIVE') bits.push(`Trial ends ${fmtDate(state.expiry)}`);
  else if (state.label === 'TRIAL · READY') bits.push(`Pass issued ${fmtDate(p.issued_at)}, not used yet`);
  else bits.push(`Pass issued ${fmtDate(p.issued_at)}`);
  if (visits) bits.push(`visited ${visits}×${lastVisit ? `, last ${fmtDate(lastVisit)}` : ''}`);
  return {
    source: 'trial', id: p.id, key: personKey(p.user_id, p.email, p.phone),
    full_name: p.full_name, email: p.email, phone: p.phone,
    photo: { id: `trial:${p.id}`, profile_photo_path: p.profile_photo_path },
    status: state, href: null,
    context: bits.join(' · '),
    details: [
      ['PASS ISSUED', fmtDate(p.issued_at)],
      ['ACTIVATED', p.activated_at ? fmtDate(p.activated_at) : 'Not yet'],
      ['PHONE', p.phone_verified_at ? 'Verified by SMS' : 'Not verified'],
      ['SIGNED UP', SOURCE_LABELS[p.signup_source] || (p.signup_source ? p.signup_source : 'Unknown')],
    ],
    sort: p.issued_at,
    category: 'trial',
  };
}

export function recordFromAccount(acc) {
  return {
    source: 'account', id: acc.id, key: personKey(acc.user_id, acc.email, acc.phone),
    full_name: acc.full_name, email: acc.email, phone: acc.phone,
    photo: { id: `account:${acc.id}`, profile_photo_path: acc.profile_photo_path },
    status: { label: 'GUEST ACCOUNT', tone: 'neutral', rank: 60 }, href: null,
    context: `Account created ${fmtDate(acc.created_at)}`,
    details: [
      ['ACCOUNT CREATED', fmtDate(acc.created_at)],
      ['PHONE', acc.phone_verified_at ? 'Verified by SMS' : 'Not verified'],
    ],
    sort: acc.created_at,
    category: 'guests',
  };
}

export function recordFromGuestProfile(g, eventTitle) {
  return {
    source: 'door', id: g.id, key: personKey(null, g.email, g.phone),
    full_name: g.full_name, email: g.email, phone: g.phone,
    photo: null,
    status: { label: 'DOOR GUEST', tone: 'neutral', rank: 20 }, href: null,
    context: eventTitle ? `First seen · ${eventTitle}` : `Added ${fmtDate(g.created_at)}`,
    details: [
      ['FIRST SEEN', eventTitle || '—'],
      ['ADDED', fmtDate(g.created_at)],
    ],
    sort: g.created_at,
    category: 'guests',
  };
}

// Person identity: account first, then email, then phone. Records with none
// of these stay on their own rather than being guessed together.
export function personKey(userId, email, phone) {
  if (userId) return `u:${userId}`;
  const e = String(email || '').trim().toLowerCase();
  if (e) return `e:${e}`;
  const d = usPhoneDigits(phone);
  if (d) return `p:${d}`;
  return null;
}

// Fold records into one result per person. The highest-ranked record sets
// the main status and seeds the profile link; the others become secondary chips, and
// contact details fill in from whichever record has them. Records join on
// any shared key (account, email or phone) so a member's application and
// their trial pass land on the same row.
export function mergePeople(records) {
  const groups = [];
  const index = new Map();
  for (const r of records) {
    const keys = [r.key, personKey(null, r.email, null), personKey(null, null, r.phone)].filter(Boolean);
    let group = null;
    for (const k of keys) if (index.has(k)) { group = index.get(k); break; }
    if (!group) { group = { records: [], keys: new Set() }; groups.push(group); }
    group.records.push(r);
    for (const k of keys) { group.keys.add(k); index.set(k, group); }
  }
  return groups.map(({ records: rs }) => {
    rs.sort((a, b) => b.status.rank - a.status.rank || String(b.sort || '').localeCompare(String(a.sort || '')));
    const main = rs[0];
    const pick = (field) => rs.map((r) => r[field]).find(Boolean) || null;
    const seen = new Set([main.status.label]);
    const also = [];
    for (const r of rs.slice(1)) {
      if (seen.has(r.status.label)) continue;
      seen.add(r.status.label);
      also.push({ label: r.status.label, tone: r.status.tone });
    }
    return {
      id: `${main.source}:${main.id}`,
      full_name: main.full_name || pick('full_name') || 'Unnamed',
      email: pick('email'),
      phone: pick('phone'),
      phone_display: formatPhone(pick('phone')) || null,
      status: { label: main.status.label, tone: main.status.tone },
      also,
      context: main.context,
      // Every result opens the unified Person Profile, seeded from the
      // highest-ranked record.
      href: profileHref(main.source, main.id),
      hrefLabel: 'Open profile',
      details: rs.flatMap((r) => r.details || []).filter(([, v]) => v).slice(0, 8),
      categories: [...new Set(rs.map((r) => r.category))],
      photoSources: rs.map((r) => r.photo).filter((p) => p && (p.profile_photo_path || p.photo_url)),
      rank: main.status.rank,
      sort: main.sort,
    };
  });
}

// Order: closest name match first, then status importance, then recency.
export function rankPeople(people, parsed) {
  const score = (p) => {
    if (parsed?.kind !== 'text') return 0;
    const name = String(p.full_name || '').toLowerCase();
    const words = name.split(/\s+/);
    let s = 0;
    for (const t of parsed.tokens) {
      if (words.some((w) => w === t)) s += 3;
      else if (words.some((w) => w.startsWith(t))) s += 2;
      else if (name.includes(t)) s += 1;
    }
    return s;
  };
  return [...people].sort((a, b) => score(b) - score(a) || b.rank - a.rank || String(b.sort || '').localeCompare(String(a.sort || '')));
}
