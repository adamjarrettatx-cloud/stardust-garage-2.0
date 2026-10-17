// Assemble everything the admin Person Profile shows for one person.
// Server-only; uses the service-role client after the page's admin gate.
//
// Sources: Stripe ticket orders, legacy Ticket Tailor tickets, studio
// bookings, Stripe membership invoices, door admissions, front desk
// arrivals, Trial Pass check-ins, member ID scans, guest list check-ins,
// security incidents, access restrictions, membership quiz, contact
// permissions, staff notes and tags. Bar (SpotOn) sales are not tied to a
// customer, so they are deliberately absent.

import { resolvePersonIdentity, likeExact, normalizeEmail } from './identity.js';
import {
  buildVisits, visitStats, interestBreakdown, guestsBrought, spendSummary,
  contactPermissions, percentileBadge, venueNight,
} from './summary.js';
import { venueVisitCounts } from './loyalty.js';
import { mergePeople, recordFromMember, recordFromApplication, recordFromTrial, recordFromAccount, recordFromGuestProfile, trialState } from '@/lib/people-search';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';
import { formatPhone, usPhoneDigits } from '@/lib/phone';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import { INCIDENT_ACTIONS, INCIDENT_CATEGORIES } from '@/lib/capacity/security-labels';
import { readPersonNotes, readPersonTags } from '@/lib/person-notes';

const RESTRICTION_LABELS = { ban: 'Banned', temporary: 'Temporary restriction', review: 'Manager review' };

async function rows(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function byEmails(admin, table, cols, column, emails, extra = (q) => q) {
  const out = [];
  for (const e of emails) {
    const data = await rows(extra(admin.from(table).select(cols).ilike(column, likeExact(e))).limit(500), table);
    for (const r of data) if (normalizeEmail(r[column]) === e) out.push(r);
  }
  return out;
}

function uniqById(list) {
  const m = new Map();
  for (const r of list) if (r?.id && !m.has(r.id)) m.set(r.id, r);
  return [...m.values()];
}

async function stripeInvoices(members) {
  const customers = [...new Set(members.map((m) => m.stripe_customer_id).filter(Boolean))];
  if (!customers.length) return [];
  try {
    const { stripe } = await import('@/lib/stripe/client');
    const lists = await Promise.all(customers.map((customer) => stripe.get('/invoices', {
      query: { customer, status: 'paid', limit: 100 }, timeoutMs: 6000,
    })));
    return lists.flatMap((l) => l?.data || []).filter((inv) => Number(inv.amount_paid) > 0);
  } catch (e) {
    console.error('[person-profile] stripe invoices unavailable', e?.message);
    return null;
  }
}

const fmtShort = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

export async function loadPersonProfile(admin, ref, { viewer = null, now = new Date() } = {}) {
  const identity = await resolvePersonIdentity(admin, ref);
  if (!identity) return null;
  const { ids, emails, identityKeys, records } = identity;
  const has = (a) => a.length > 0;

  const [
    ordersByUser, ordersByMember, ordersByEmail, ttById, ttByEmail, bookings,
    doorBySubject, doorByKey, arrivals, trialCheckins, memberScans, guestList,
    incidents, restrictions, quiz, pushTokens, prefs, signupsEmail, signupsPhone,
    invoices, notes, tags,
  ] = await Promise.all([
    has(ids.users) ? rows(admin.from('orders').select('*').in('user_id', ids.users).limit(500), 'orders') : [],
    has(ids.members) ? rows(admin.from('orders').select('*').in('member_profile_id', ids.members).limit(500), 'orders') : [],
    byEmails(admin, 'orders', '*', 'buyer_email', emails),
    has(ids.members) ? rows(admin.from('member_tickets').select('id, local_event_id, tt_event_id, buyer_email, checked_in, status, voided_at, description, created_at').in('member_id', ids.members).limit(1000), 'member_tickets') : [],
    byEmails(admin, 'member_tickets', 'id, local_event_id, tt_event_id, buyer_email, checked_in, status, voided_at, description, created_at', 'buyer_email', emails),
    has(ids.members) ? rows(admin.from('studio_bookings').select('*').in('member_id', ids.members).order('booking_date', { ascending: false }).limit(300), 'studio_bookings') : [],
    has([...ids.trials, ...ids.members]) ? rows(admin.from('door_admissions').select('id, event_id, admitted_at, subject_kind, subject_id').in('subject_id', [...ids.trials, ...ids.members]).limit(1000), 'door_admissions') : [],
    has(identityKeys) ? rows(admin.from('door_admissions').select('id, event_id, admitted_at, subject_kind, subject_id').in('person_key', identityKeys).limit(1000), 'door_admissions') : [],
    has(identityKeys) ? rows(admin.from('front_desk_arrivals').select('id, shift_day, checked_in_at').overlaps('identity_keys', identityKeys).limit(1000), 'front_desk_arrivals') : [],
    has(ids.trials) ? rows(admin.from('trial_pass_checkins').select('id, event_id, checked_in_at').in('trial_pass_id', ids.trials).eq('result', 'allowed').limit(1000), 'trial_pass_checkins') : [],
    has(ids.members) ? rows(admin.from('member_id_scans').select('id, event_id, scanned_at, result').in('member_profile_id', ids.members).neq('result', 'rejected').limit(1000), 'member_id_scans') : [],
    has(ids.guests) ? rows(admin.from('event_guestlist_entries').select('id, checked_in_at, grant:event_guestlist_grants(event_id)').in('guest_profile_id', ids.guests).not('checked_in_at', 'is', null).limit(500), 'event_guestlist_entries') : [],
    has(identityKeys) ? rows(admin.from('security_incidents').select('id, category, action, note, actor_label, created_at, event_id, restriction_id').overlaps('identity_keys', identityKeys).order('created_at', { ascending: false }).limit(100), 'security_incidents') : [],
    has(identityKeys) ? rows(admin.from('access_restrictions').select('id, kind, reason, expires_at, created_at, lifted_at').overlaps('identity_keys', identityKeys).order('created_at', { ascending: false }).limit(50), 'access_restrictions') : [],
    has(ids.users) ? rows(admin.from('membership_quiz_results').select('user_id, recommended_plans, selected_plan, completed_at').in('user_id', ids.users), 'membership_quiz_results') : [],
    has(ids.users) ? rows(admin.from('push_tokens').select('id').in('user_id', ids.users), 'push_tokens') : [],
    has(ids.users) ? rows(admin.from('notification_preferences').select('user_id, type, email').in('user_id', ids.users), 'notification_preferences') : [],
    byEmails(admin, 'signups', 'id, contact, contact_type, source, phone, created_at', 'contact', emails),
    (async () => {
      const digits = [...new Set([...records.trials, ...records.accounts, ...records.applications, ...records.guests].map((r) => usPhoneDigits(r.phone)).filter((d) => d && d.length === 10))];
      if (!digits.length) return [];
      const found = [];
      for (const d of digits.slice(0, 4)) {
        found.push(...await rows(admin.from('signups').select('id, contact, contact_type, source, phone, created_at').eq('contact_type', 'phone').ilike('contact', `%${d.slice(-7)}`).limit(20), 'signups'));
      }
      return found;
    })(),
    stripeInvoices(records.members),
    // Notes/tags must never take the rest of the profile down.
    readPersonNotes(admin, identityKeys, viewer).catch((e) => { console.error('[person-profile] notes', e?.message); return []; }),
    readPersonTags(admin, identityKeys).catch((e) => { console.error('[person-profile] tags', e?.message); return []; }),
  ]);

  const orders = uniqById([...ordersByUser, ...ordersByMember, ...ordersByEmail])
    .filter((o) => ['paid', 'refunded', 'partially_refunded'].includes(o.status));
  const ttTickets = uniqById([...ttById, ...ttByEmail]).filter((t) => !t.voided_at);
  const doorRows = uniqById([...doorBySubject, ...doorByKey]);

  const orderIds = orders.map((o) => o.id);
  const [orderItems, tickets] = await Promise.all([
    orderIds.length ? rows(admin.from('order_items').select('order_id, product_name_snapshot, tier_name_snapshot, quantity').in('order_id', orderIds), 'order_items') : [],
    orderIds.length ? rows(admin.from('tickets').select('id, order_id, event_id, status, used_at, refunded_at, voided_at').in('order_id', orderIds).limit(2000), 'tickets') : [],
  ]);

  const eventIds = new Set();
  for (const o of orders) if (o.event_id) eventIds.add(o.event_id);
  for (const t of ttTickets) if (t.local_event_id) eventIds.add(t.local_event_id);
  for (const r of [...doorRows, ...trialCheckins, ...memberScans, ...incidents]) if (r.event_id) eventIds.add(r.event_id);
  for (const g of guestList) if (g.grant?.event_id) eventIds.add(g.grant.event_id);
  for (const g of records.guests) if (g.first_seen_event_id) eventIds.add(g.first_seen_event_id);
  const eventRows = eventIds.size
    ? await rows(admin.from('events').select('id, title, event_date, category, slug').in('id', [...eventIds]), 'events')
    : [];
  const events = new Map(eventRows.map((e) => [e.id, e]));

  // ── Visits ──────────────────────────────────────────────────────────────
  const touches = [];
  for (const d of doorRows) touches.push({ method: d.subject_kind === 'member' ? 'member' : d.subject_kind === 'trial_pass' ? 'trial' : 'door', event_id: d.event_id, at: d.admitted_at });
  for (const a of arrivals) touches.push({ method: 'front_desk', day: a.shift_day, at: a.checked_in_at });
  for (const c of trialCheckins) touches.push({ method: 'trial', event_id: c.event_id, at: c.checked_in_at });
  for (const s of memberScans) touches.push({ method: 'member', event_id: s.event_id, at: s.scanned_at });
  for (const g of guestList) touches.push({ method: 'guest_list', event_id: g.grant?.event_id || null, at: g.checked_in_at });
  for (const t of tickets) if (t.used_at || t.status === 'used') touches.push({ method: 'ticket', event_id: t.event_id, at: t.used_at });
  // Ticket Tailor check-ins were never synced for buyers with an email, so a
  // valid TT ticket for an event that has already happened counts as
  // attended. Tickets for future events don't count until they happen.
  const today = venueNight(now.toISOString());
  const ttAttended = ttTickets.filter((t) => {
    if (t.checked_in) return true;
    if (t.status === 'voided') return false;
    const ev = events.get(t.local_event_id);
    return !ev || !ev.event_date || ev.event_date <= today;
  });
  for (const t of ttAttended) touches.push({ method: 'tt_ticket', event_id: events.has(t.local_event_id) ? t.local_event_id : null, ext: t.tt_event_id });
  // Trial Pass guests often enter through the front desk without a ticket;
  // match those nights to that night's event.
  const bareDays = [...new Set(touches.filter((t) => t.method === 'front_desk' && t.day).map((t) => t.day))];
  const nightEvents = bareDays.length
    ? await rows(admin.from('events').select('id, title, event_date, category, slug').in('event_date', bareDays.slice(0, 300)), 'events')
    : [];
  const eventsByDay = new Map();
  for (const e of nightEvents) {
    events.set(e.id, events.get(e.id) || e);
    if (!eventsByDay.has(e.event_date)) eventsByDay.set(e.event_date, []);
    eventsByDay.get(e.event_date).push(e);
  }
  const visits = buildVisits(touches, events, eventsByDay);

  const firstSeen = [
    ...records.members.map((m) => m.created_at), ...records.applications.map((a) => a.created_at),
    ...records.trials.map((t) => t.issued_at), ...records.accounts.map((a) => a.created_at),
    ...records.guests.map((g) => g.created_at),
  ].filter(Boolean).sort()[0] || null;
  const stats = visitStats(visits, { now, firstSeen });

  const ticketsByEvent = new Map();
  const bump = (k) => ticketsByEvent.set(k, (ticketsByEvent.get(k) || 0) + 1);
  // Guests brought = extra tickets on their own orders for events that have
  // happened (refunded/voided tickets excluded), whether or not each one was
  // scanned: guest tickets are often redeemed by the guest's own entry.
  for (const t of tickets) {
    if (['refunded', 'voided', 'cancelled'].includes(t.status) || t.refunded_at || t.voided_at) continue;
    const ev = events.get(t.event_id);
    if (ev?.event_date && ev.event_date > today) continue;
    bump(t.event_id || `o:${t.order_id}`);
  }
  for (const t of ttAttended) bump(t.local_event_id || `tt:${t.tt_event_id}`);

  // ── Spending ────────────────────────────────────────────────────────────
  const spend = spendSummary({ orders, bookings, invoices });
  const itemsByOrder = new Map();
  for (const it of orderItems) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }
  const purchases = [];
  for (const o of orders) {
    const ev = events.get(o.event_id);
    const items = (itemsByOrder.get(o.id) || []).map((it) => `${it.quantity} × ${it.tier_name_snapshot || it.product_name_snapshot || 'Ticket'}`).join(', ');
    const refunded = Number(o.refunded_cents) || 0;
    const total = Number(o.total_cents) || 0;
    purchases.push({
      at: o.paid_at || o.created_at,
      title: [ev?.title || 'Ticket order', items].filter(Boolean).join(' · '),
      sub: total === 0 ? 'Comp ticket' : refunded >= total ? 'Ticket order · refunded' : refunded > 0 ? `Ticket order · $${(refunded / 100).toFixed(2)} refunded` : 'Ticket order',
      cents: total,
      net: total - Math.min(total, refunded),
      refunded: total > 0 && refunded >= total,
    });
  }
  for (const b of bookings) {
    if (b.cancelled_at || b.status === 'cancelled') continue;
    const hours = Math.max(0, (Number(b.end_hour) || 0) - (Number(b.start_hour) || 0));
    purchases.push({ at: `${b.booking_date}T12:00:00Z`, title: `Studio booking · ${hours} hr${hours === 1 ? '' : 's'}`, sub: 'Studio', cents: Number(b.total_cost_cents) || 0, net: Number(b.total_cost_cents) || 0 });
  }
  for (const inv of invoices || []) {
    const m = records.members.find((x) => x.stripe_customer_id === inv.customer);
    const plan = PLAN_DISPLAY[m?.subscription_plan] || 'Membership';
    purchases.push({
      at: new Date((inv.status_transitions?.paid_at || inv.created) * 1000).toISOString(),
      title: `${plan} membership`,
      sub: `${m?.subscription_period === 'annual' ? 'Annual' : 'Monthly'} dues · Stripe`,
      cents: Number(inv.amount_paid) || 0,
      net: Number(inv.amount_paid) || 0,
    });
  }
  purchases.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // ── Membership ──────────────────────────────────────────────────────────
  const member = [...records.members].sort((a, b) => {
    const rank = (m) => (m.is_active ? 1 : 0);
    return rank(b) - rank(a) || String(b.created_at).localeCompare(String(a.created_at));
  })[0] || null;
  const trial = [...records.trials].sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)))[0] || null;
  const application = [...records.applications].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const quizRow = quiz.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;
  const memberSince = records.members.map((m) => m.created_at).filter(Boolean).sort()[0] || null;
  const memberActive = Boolean(member && member.is_active && !['canceled', 'cancelled', 'incomplete_expired'].includes(member.subscription_status));

  // ── Header (same folding rules as people search) ────────────────────────
  const recs = [
    ...records.members.map((m) => recordFromMember(m, application)),
    ...records.applications.map((a) => recordFromApplication(a)),
    ...records.trials.map((t) => recordFromTrial(t)),
    ...records.accounts.map((a) => recordFromAccount(a)),
    ...records.guests.map((g) => recordFromGuestProfile(g, events.get(g.first_seen_event_id)?.title)),
  ];
  // Records joined here by explicit links (e.g. trial -> guest profile) may
  // share no email, so mergePeople can return more than one group. The
  // highest-ranked group leads the header; every group's status still shows.
  const merged = mergePeople(recs).sort((a, b) => b.rank - a.rank);
  const head = merged[0];
  const badges = [head.status, ...merged.flatMap((p) => [p.status, ...p.also])]
    .filter((b, i, arr) => arr.findIndex((x) => x.label === b.label) === i);
  const photoRow = merged.flatMap((p) => p.photoSources)[0];
  const photos = photoRow ? await resolveMemberPhotoUrls(admin, [{ ...photoRow, id: 'p' }], { size: 'full' }) : new Map();
  const phone = merged.map((p) => p.phone).find(Boolean) || null;

  let topBadge = null;
  try { topBadge = percentileBadge(stats.total, await venueVisitCounts(admin)); } catch (e) { console.error('[person-profile] loyalty counts', e?.message); }

  // ── Flags ───────────────────────────────────────────────────────────────
  const nowMs = now.getTime();
  const activeRestrictions = restrictions.filter((r) => !r.lifted_at && (!r.expires_at || Date.parse(r.expires_at) > nowMs));
  const flagItems = [
    ...incidents.map((i) => ({
      id: `i:${i.id}`, at: i.created_at, tone: i.action === 'ban' ? 'bad' : 'warn',
      badge: (INCIDENT_ACTIONS[i.action] || i.action || 'Incident').toUpperCase(),
      title: `${INCIDENT_ACTIONS[i.action] || 'Incident'} · ${INCIDENT_CATEGORIES[i.category] || 'Other conduct'}`,
      note: i.note || null,
      by: [i.actor_label, events.get(i.event_id)?.title].filter(Boolean).join(' · '),
    })),
    ...restrictions.map((r) => {
      const active = activeRestrictions.includes(r);
      return {
        id: `r:${r.id}`, at: r.created_at, tone: active ? 'bad' : 'neutral',
        badge: active ? (r.kind === 'ban' ? 'BANNED' : 'RESTRICTED') : 'LIFTED',
        title: RESTRICTION_LABELS[r.kind] || 'Access restriction',
        note: r.reason || null,
        by: active ? (r.expires_at ? `Until ${new Date(r.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}` : 'No end date') : 'Lifted',
      };
    }),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const latestIncident = incidents[0] || null;

  return {
    ref: `${identity.ref.source}-${identity.ref.id}`,
    person: {
      full_name: head.full_name,
      email: head.email || emails[0] || null,
      phone,
      phone_display: formatPhone(phone) || null,
      photo_url: photos.get('p') || null,
      badges: badges.map((b) => ({ label: b.label, tone: b.tone })),
      top_badge: topBadge,
      first_seen: firstSeen,
      tags,
    },
    flags: {
      count: flagItems.length,
      activeRestrictions: activeRestrictions.length,
      summary: latestIncident ? {
        action: INCIDENT_ACTIONS[latestIncident.action] || 'Incident',
        category: INCIDENT_CATEGORIES[latestIncident.category] || 'Other conduct',
        at: latestIncident.created_at,
        event: events.get(latestIncident.event_id)?.title || null,
      } : null,
      items: flagItems,
    },
    stats: { ...stats, guestsBrought: guestsBrought(ticketsByEvent) },
    spend,
    purchases: purchases.slice(0, 100),
    visits: visits.slice(0, 200).map((v) => ({ ...v, day_label: v.day ? fmtShort(v.day) : 'Undated' })),
    interests: interestBreakdown(visits),
    // Only current plan keys get a label; legacy quiz codes are omitted
    // rather than shown as raw slugs.
    quiz: quizRow ? {
      recommended: (quizRow.recommended_plans || []).map((p) => PLAN_DISPLAY[p]).filter(Boolean),
      selected: PLAN_DISPLAY[quizRow.selected_plan] || null,
    } : null,
    membership: {
      member: member ? {
        id: member.id,
        plan: PLAN_DISPLAY[member.subscription_plan] || member.subscription_plan || 'Member',
        period: member.subscription_period === 'annual' ? 'Annual' : 'Monthly',
        status: member.subscription_status || (member.is_active ? 'active' : 'inactive'),
        active: memberActive,
        cancelling: Boolean(member.cancel_at_period_end),
        since: memberSince,
        renews: member.current_period_end,
      } : null,
      trial: trial ? {
        state: trialState(trial).label,
        issued_at: trial.issued_at,
        converted_at: trial.converted_at,
        expiry: trialState(trial).expiry,
      } : null,
      application: application ? { id: application.id, status: application.status || 'new', created_at: application.created_at } : null,
    },
    permissions: contactPermissions({
      emails,
      phones: [...new Set(recs.map((r) => usPhoneDigits(r.phone)).filter(Boolean))],
      signups: [...signupsEmail, ...signupsPhone.map((s) => ({ ...s, phone: s.phone || s.contact }))],
      guests: records.guests,
      prefs,
      pushCount: pushTokens.length,
      memberPush: records.members.some((m) => m.expo_push_token),
    }),
    notes,
    meta: {
      duesAvailable: spend.duesAvailable,
      hasTicketTailor: ttTickets.length > 0,
      today,
    },
  };
}
