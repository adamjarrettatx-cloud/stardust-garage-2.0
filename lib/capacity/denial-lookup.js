// denial-lookup.js — "has this person been turned away before?"
//
// Server-only. Every table read here is admin-only under RLS, so callers MUST
// pass a service-role client. The routes that use this already gate on
// requireTeam(); this module never checks authorization itself.
//
// WHY IT IS SHAPED THIS WAY
// A denial is stored against a SUBJECT (a ticket, a trial pass, a member
// profile), not against a person. The same human can walk up with a different
// ticket to a different event, so keying history on the subject id alone would
// miss the case the door actually cares about. We resolve a person first, then
// gather every subject that belongs to them.
//
// Identity is user_id when the subject is attached to an account, plus email
// otherwise. Two email sets are carried, and the distinction is load-bearing:
//
//   emailsCanonical — plus-tag stripped, gmail dots removed. Matches
//                     trial_passes.email_canonical, a GENERATED column computed
//                     by the equivalent SQL expression. We reuse
//                     canonicalizeEmail() rather than reimplementing it so the
//                     two cannot drift.
//   emailsRaw       — the address exactly as stored, lowercased.
//
// orders.buyer_email and member_profiles.email hold RAW addresses (verified
// against production: `gary.kanning@gmail.com` is stored with its dots), so
// matching those columns against a canonical value alone would silently return
// nothing. Both columns are therefore matched against the union of the two sets.
//
// KNOWN GAP. Because `orders` has no canonical column, two GUEST orders that
// differ only by gmail dots or a +tag still read as two people — canonical form
// is lossy and the dotted variants cannot be reconstructed from it. Any buyer
// who was signed in is unaffected (user_id links them), as is anything touching
// a trial pass. Closing it properly means adding an `email_canonical` generated
// column to `orders`, mirroring the one on `trial_passes`.
//
// COST. This is called on the scan preview path, which a door person hits once
// per guest. It is a handful of indexed `in` queries with hard caps, not a
// join, so a missing row degrades to "no history" instead of failing the scan.
// Every caller treats a thrown error as "no history" — a scanner must never be
// blocked from admitting someone because a history read failed.

import { canonicalizeEmail } from '@/lib/trial-pass';
import {
  DENYING_TICKET_RESULTS,
  DENYING_TRIAL_PASS_RESULTS,
  DENYING_MEMBER_ID_RESULTS,
  denialLabel,
} from '@/lib/capacity/denial-history';

// Hard caps. A person with more denials than this is already well past the
// threshold where the door person needs the exact number.
const MAX_SUBJECTS = 200;
const MAX_DENIALS = 25;

function addAll(set, values) {
  for (const v of values || []) if (v) set.add(v);
}

// resolvePersonIdentity(admin, subject)
//
// `subject` is one of:
//   { kind: 'ticket',     ticketId }
//   { kind: 'trial_pass', trialPassId }
//   { kind: 'member_id',  memberProfileId }
//
// Returns { userIds, emails, emailsCanonical, memberProfileIds } as arrays.
// All-empty means we
// could not identify a person, in which case there is no history to fetch.
export async function resolvePersonIdentity(admin, subject) {
  const userIds = new Set();
  const emailsRaw = new Set();
  const emailsCanonical = new Set();
  const memberProfileIds = new Set();
  const addEmail = (value) => {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return;
    emailsRaw.add(raw);
    const canon = canonicalizeEmail(raw);
    if (canon) emailsCanonical.add(canon);
  };

  if (subject?.kind === 'ticket' && subject.ticketId) {
    const { data: ticket } = await admin
      .from('tickets').select('order_id').eq('id', subject.ticketId).maybeSingle();
    if (ticket?.order_id) {
      const { data: order } = await admin
        .from('orders')
        .select('user_id, buyer_email, member_profile_id')
        .eq('id', ticket.order_id)
        .maybeSingle();
      if (order?.user_id) userIds.add(order.user_id);
      addEmail(order?.buyer_email);
      if (order?.member_profile_id) memberProfileIds.add(order.member_profile_id);
    }
  } else if (subject?.kind === 'trial_pass' && subject.trialPassId) {
    const { data: pass } = await admin
      .from('trial_passes')
      .select('user_id, email_canonical, member_profile_id')
      .eq('id', subject.trialPassId)
      .maybeSingle();
    if (pass?.user_id) userIds.add(pass.user_id);
    if (pass?.email_canonical) emailsCanonical.add(pass.email_canonical);
    if (pass?.member_profile_id) memberProfileIds.add(pass.member_profile_id);
  } else if (subject?.kind === 'member_id' && subject.memberProfileId) {
    memberProfileIds.add(subject.memberProfileId);
    const { data: profile } = await admin
      .from('member_profiles')
      .select('user_id, email')
      .eq('id', subject.memberProfileId)
      .maybeSingle();
    if (profile?.user_id) userIds.add(profile.user_id);
    addEmail(profile?.email);
  }

  // Second hop: an account reached by email also pulls in its profile, and a
  // profile reached by id also pulls in its account. Without this, a guest who
  // bought as a logged-out purchaser and later signed up would read as two
  // different people.
  const emailMatchSet = () => [...new Set([...emailsRaw, ...emailsCanonical])].filter(Boolean);
  if (emailsRaw.size > 0 || emailsCanonical.size > 0) {
    const { data: profiles } = await admin
      .from('member_profiles')
      .select('id, user_id, email')
      .in('email', emailMatchSet());
    for (const p of profiles || []) {
      memberProfileIds.add(p.id);
      if (p.user_id) userIds.add(p.user_id);
    }
  }
  if (userIds.size > 0) {
    const { data: profiles } = await admin
      .from('member_profiles')
      .select('id, email')
      .in('user_id', [...userIds]);
    for (const p of profiles || []) {
      memberProfileIds.add(p.id);
      addEmail(p.email);
    }
  }

  return {
    userIds: [...userIds],
    // Raw-or-canonical, for columns that store the address as given.
    emails: emailMatchSet(),
    // Canonical only, for trial_passes.email_canonical.
    emailsCanonical: [...emailsCanonical].filter(Boolean),
    memberProfileIds: [...memberProfileIds],
  };
}

// Collect every ticket id, trial pass id and member profile id that belongs to
// this person. Supabase's JS client has no OR across `in` lists, so each
// predicate is its own query and the results are unioned in memory.
async function resolveSubjects(admin, identity) {
  const ticketIds = new Set();
  const trialPassIds = new Set();
  const memberProfileIds = new Set(identity.memberProfileIds);

  const orderIds = new Set();
  if (identity.userIds.length > 0) {
    const { data } = await admin.from('orders').select('id')
      .in('user_id', identity.userIds).limit(MAX_SUBJECTS);
    addAll(orderIds, (data || []).map((o) => o.id));
  }
  if (identity.emails.length > 0) {
    const { data } = await admin.from('orders').select('id')
      .in('buyer_email', identity.emails).limit(MAX_SUBJECTS);
    addAll(orderIds, (data || []).map((o) => o.id));
  }
  if (identity.memberProfileIds.length > 0) {
    const { data } = await admin.from('orders').select('id')
      .in('member_profile_id', identity.memberProfileIds).limit(MAX_SUBJECTS);
    addAll(orderIds, (data || []).map((o) => o.id));
  }
  if (orderIds.size > 0) {
    const { data } = await admin.from('tickets').select('id')
      .in('order_id', [...orderIds]).limit(MAX_SUBJECTS);
    addAll(ticketIds, (data || []).map((t) => t.id));
  }

  if (identity.userIds.length > 0) {
    const { data } = await admin.from('trial_passes').select('id')
      .in('user_id', identity.userIds).limit(MAX_SUBJECTS);
    addAll(trialPassIds, (data || []).map((p) => p.id));
  }
  if (identity.emailsCanonical.length > 0) {
    const { data } = await admin.from('trial_passes').select('id')
      .in('email_canonical', identity.emailsCanonical).limit(MAX_SUBJECTS);
    addAll(trialPassIds, (data || []).map((p) => p.id));
  }

  return {
    ticketIds: [...ticketIds],
    trialPassIds: [...trialPassIds],
    memberProfileIds: [...memberProfileIds],
  };
}

// Titles for the events a denial happened at, so "Wrong event" reads as
// "Wrong event · Saturday :: 4 the culture" instead of leaving the door person
// to guess which night it refers to.
async function eventTitles(admin, eventIds) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await admin.from('events').select('id, title').in('id', ids);
  return new Map((data || []).map((e) => [e.id, e.title]));
}

// fetchPriorDenials(admin, subject, { excludeScanId })
//
// Every denial ever recorded against this person, newest first, as
// { id, at, label, eventTitle, kind }.
//
// `excludeScanId` drops the row for the scan being previewed right now, which
// matters on the commit path: the endpoint writes its own denial row before the
// client re-reads history, and counting it would report "turned away twice"
// for a first offence.
export async function fetchPriorDenials(admin, subject, { excludeScanId = null } = {}) {
  const identity = await resolvePersonIdentity(admin, subject);
  if (identity.userIds.length === 0
      && identity.emails.length === 0
      && identity.memberProfileIds.length === 0) {
    return [];
  }
  const subjects = await resolveSubjects(admin, identity);
  const rows = [];

  if (subjects.ticketIds.length > 0) {
    const { data } = await admin
      .from('ticket_checkins')
      .select('id, event_id, result, reject_reason, scanned_at')
      .in('ticket_id', subjects.ticketIds)
      .in('result', DENYING_TICKET_RESULTS)
      .order('scanned_at', { ascending: false })
      .limit(MAX_DENIALS);
    for (const r of data || []) {
      rows.push({
        id: r.id, kind: 'ticket', eventId: r.event_id,
        at: new Date(r.scanned_at).getTime(),
        label: denialLabel(r.result, r.reject_reason),
      });
    }
  }

  if (subjects.trialPassIds.length > 0) {
    const { data } = await admin
      .from('trial_pass_checkins')
      .select('id, event_id, result, reject_reason, checked_in_at')
      .in('trial_pass_id', subjects.trialPassIds)
      .in('result', DENYING_TRIAL_PASS_RESULTS)
      .order('checked_in_at', { ascending: false })
      .limit(MAX_DENIALS);
    for (const r of data || []) {
      rows.push({
        id: r.id, kind: 'trial_pass', eventId: r.event_id,
        at: new Date(r.checked_in_at).getTime(),
        label: denialLabel(r.result, r.reject_reason),
      });
    }
  }

  if (subjects.memberProfileIds.length > 0) {
    const { data } = await admin
      .from('member_id_scans')
      .select('id, event_id, result, reject_reason, scanned_at')
      .in('member_profile_id', subjects.memberProfileIds)
      .in('result', DENYING_MEMBER_ID_RESULTS)
      .order('scanned_at', { ascending: false })
      .limit(MAX_DENIALS);
    for (const r of data || []) {
      rows.push({
        id: r.id, kind: 'member_id', eventId: r.event_id,
        at: new Date(r.scanned_at).getTime(),
        label: denialLabel(r.result, r.reject_reason),
      });
    }
  }

  const titles = await eventTitles(admin, rows.map((r) => r.eventId));
  return rows
    .filter((r) => Number.isFinite(r.at) && r.id !== excludeScanId)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_DENIALS)
    .map((r) => ({ ...r, eventTitle: titles.get(r.eventId) || null }));
}
