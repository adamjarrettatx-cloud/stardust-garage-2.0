// Venue-wide visit counts per person, used for the "TOP X% BY VISITS" badge
// on the Person Profile (and the future loyalty list). People are keyed by
// email where we know it, otherwise by the Trial Pass id, so a person's
// Ticket Tailor history and their Trial Pass check-ins land together.
// Counts are cached in memory for ten minutes per server instance.

import { venueNight } from './summary.js';

const CACHE_MS = 10 * 60 * 1000;
let cache = null;

async function fetchAll(admin, table, cols, apply = (q) => q) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await apply(admin.from(table).select(cols)).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function countVisitsByPerson({ trials, doorAdmissions, arrivals, trialCheckins, ttTickets, events, today = null }) {
  const trialKey = new Map(trials.map((t) => [t.id, (t.email_canonical || t.email || '').toLowerCase() || `trial:${t.id}`]));
  const userKey = new Map(trials.filter((t) => t.user_id).map((t) => [t.user_id, trialKey.get(t.id)]));
  const eventDay = new Map(events.map((e) => [e.id, e.event_date]));
  const nights = new Map();
  const add = (person, night) => {
    if (!person || !night) return;
    if (!nights.has(person)) nights.set(person, new Set());
    nights.get(person).add(night);
  };
  for (const d of doorAdmissions) {
    const [kind, id] = String(d.person_key || '').split(':');
    const person = d.subject_kind === 'trial_pass' ? trialKey.get(d.subject_id) : kind === 'user' ? userKey.get(id) : null;
    add(person, eventDay.get(d.event_id) || venueNight(d.admitted_at));
  }
  for (const a of arrivals) if (a.subject_kind === 'trial_pass') add(trialKey.get(a.subject_id), a.shift_day);
  for (const c of trialCheckins) add(trialKey.get(c.trial_pass_id), eventDay.get(c.event_id) || venueNight(c.checked_in_at));
  // Legacy Ticket Tailor tickets: check-ins with a buyer email were never
  // synced, so a valid ticket for a past event counts as attended. Tickets
  // without a real email (box-office rows) can't be tied to anyone.
  for (const t of ttTickets) {
    const email = String(t.buyer_email || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    const day = t.local_event_id ? eventDay.get(t.local_event_id) : null;
    if (day && today && day > today) continue;
    add(email, day || `tt:${t.tt_event_id}`);
  }
  return [...nights.values()].map((s) => s.size).filter((n) => n > 0);
}

export async function venueVisitCounts(admin) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.counts;
  const [trials, doorAdmissions, arrivals, trialCheckins, ttTickets, events] = await Promise.all([
    fetchAll(admin, 'trial_passes', 'id, user_id, email, email_canonical'),
    fetchAll(admin, 'door_admissions', 'id, person_key, subject_kind, subject_id, event_id, admitted_at'),
    fetchAll(admin, 'front_desk_arrivals', 'id, subject_kind, subject_id, shift_day'),
    fetchAll(admin, 'trial_pass_checkins', 'id, trial_pass_id, event_id, checked_in_at', (q) => q.eq('result', 'allowed')),
    fetchAll(admin, 'member_tickets', 'id, buyer_email, local_event_id, tt_event_id', (q) => q.eq('status', 'valid')),
    fetchAll(admin, 'events', 'id, event_date'),
  ]);
  const counts = countVisitsByPerson({ trials, doorAdmissions, arrivals, trialCheckins, ttTickets, events, today: venueNight(new Date().toISOString()) });
  cache = { at: Date.now(), counts };
  return counts;
}

export function clearVenueVisitCache() { cache = null; }
