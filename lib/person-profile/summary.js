// Pure calculations for the admin Person Profile. Everything here takes
// already-loaded rows and returns display-ready numbers, so it is unit tested
// without a database.

export const VENUE_TZ = 'America/Chicago';
// A venue night runs past midnight: anything before 6am belongs to the
// previous night, matching the front desk shift day.
const NIGHT_CUTOFF_HOURS = 6;

export const CATEGORY_LABELS = Object.freeze({
  sdg_party: { label: 'SDG Party', color: '#dc2626' },
  trial_resident_party: { label: 'Trial Resident Party', color: '#e11d48' },
  evening_music_residency: { label: 'Evening Music Residency', color: '#c27a2c' },
  day_party: { label: 'Day Party', color: '#f59e0b' },
  workshop: { label: 'Workshop', color: '#eab308' },
  yoga: { label: 'Yoga', color: '#10b981' },
  yoga_residency: { label: 'Yoga Residency', color: '#d9c48c' },
  party: { label: 'Party', color: '#9DB8F5' },
  other: { label: 'Other events', color: '#9CA0AA' },
});
// Team-only calendar entries never count as something a guest "came for".
const NON_GUEST_CATEGORIES = new Set(['internal', 'team_meeting']);

export const METHOD_LABELS = Object.freeze({
  ticket: 'TICKET',
  tt_ticket: 'TICKET',
  door: 'DOOR',
  trial: 'TRIAL PASS',
  member: 'MEMBER',
  guest_list: 'GUEST LIST',
  front_desk: 'FRONT DESK',
});
const METHOD_ORDER = ['member', 'ticket', 'tt_ticket', 'guest_list', 'trial', 'door', 'front_desk'];
const METHOD_TEXT = {
  ticket: 'Ticket', tt_ticket: 'Ticket Tailor ticket', door: 'Door entry', trial: 'Trial Pass',
  member: 'Member pass', guest_list: 'Guest list', front_desk: 'Front desk arrival',
};

function chicagoParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}

// ISO timestamp -> venue night (YYYY-MM-DD).
export function venueNight(ts) {
  if (!ts) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const { y, m, d, h } = chicagoParts(date);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (h < NIGHT_CUTOFF_HOURS) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function todayNight(now = new Date()) {
  return venueNight(now.toISOString());
}

function dayDiff(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

// touches: [{ method, event_id?, at?, day?, ext? }]
// events: Map(event_id -> { id, title, event_date, category })
// One visit per venue night. Undated legacy tickets (no local event) are
// kept as their own visit keyed by the external event id.
// eventsByDay (optional): Map(day -> events that night). A front desk
// sign-in with no event attached is matched to the one guest-facing event
// that night, if there is exactly one.
export function buildVisits(touches, events, eventsByDay = new Map()) {
  const byKey = new Map();
  for (const t of touches) {
    const ev = t.event_id ? events.get(t.event_id) : null;
    const day = ev?.event_date || t.day || venueNight(t.at);
    const key = day ? `d:${day}` : t.ext ? `x:${t.ext}` : null;
    if (!key) continue;
    let v = byKey.get(key);
    if (!v) { v = { day: day || null, eventIds: new Set(), methods: new Set() }; byKey.set(key, v); }
    if (ev) v.eventIds.add(ev.id);
    v.methods.add(t.method);
  }
  const visits = [...byKey.values()].map((v) => {
    let evs = [...v.eventIds].map((id) => events.get(id)).filter(Boolean);
    if (!evs.length && v.day) {
      const that = (eventsByDay.get(v.day) || []).filter((e) => !NON_GUEST_CATEGORIES.has(e.category));
      if (that.length === 1) evs = that;
    }
    const ev = evs.find((e) => !NON_GUEST_CATEGORIES.has(e.category)) || evs[0] || null;
    const methods = METHOD_ORDER.filter((m) => v.methods.has(m));
    const onlyFrontDesk = methods.length === 1 && methods[0] === 'front_desk';
    return {
      day: v.day,
      event_id: ev?.id || null,
      title: ev?.title || (onlyFrontDesk ? 'Front desk visit' : v.methods.has('tt_ticket') ? 'Ticket Tailor event' : 'Visit'),
      category: ev?.category || null,
      category_label: ev ? (CATEGORY_LABELS[ev.category]?.label || null) : null,
      method: METHOD_LABELS[methods[0]] || 'VISIT',
      how: methods.map((m) => METHOD_TEXT[m]).join(' · '),
      // Anything entered through the door (ticket, pass, guest list) is an
      // event night even when the event row is missing; only front desk
      // sign-ins with no event are "front desk" visits.
      kind: onlyFrontDesk && !ev ? 'front_desk' : 'event',
    };
  });
  visits.sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')));
  return visits;
}

function monthKey(day) { return day.slice(0, 7); }
function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function visitStats(visits, { now = new Date(), firstSeen = null } = {}) {
  const today = todayNight(now);
  const dated = visits.filter((v) => v.day && v.day <= today);
  const last90 = dated.filter((v) => dayDiff(today, v.day) < 90).length;
  const earliest = [firstSeen ? venueNight(firstSeen) : null, ...dated.map((v) => v.day)].filter(Boolean).sort()[0] || today;
  const spanMonths = Math.max(1, dayDiff(today, earliest) / 30.44);

  const currentMonth = monthKey(today);
  const firstMonth = monthKey(earliest);
  const span = Math.min(11, Math.max(5, monthsBetween(firstMonth, currentMonth)));
  const counts = new Map();
  for (const v of dated) counts.set(monthKey(v.day), (counts.get(monthKey(v.day)) || 0) + 1);
  const months = [];
  for (let i = span; i >= 0; i--) {
    const key = addMonths(currentMonth, -i);
    months.push({ key, label: MONTH_ABBR[Number(key.slice(5, 7)) - 1], count: counts.get(key) || 0, current: i === 0 });
  }

  const last = dated[0] || null;
  return {
    total: visits.length,
    events: visits.filter((v) => v.kind === 'event').length,
    frontDesk: visits.filter((v) => v.kind !== 'event').length,
    perMonth90: Math.round((last90 / 3) * 10) / 10,
    perMonthAll: Math.round((visits.length / spanMonths) * 10) / 10,
    last: last ? { day: last.day, daysAgo: dayDiff(today, last.day), title: last.title } : null,
    months,
  };
}

export function interestBreakdown(visits) {
  const counts = new Map();
  for (const v of visits) {
    if (!v.category || NON_GUEST_CATEGORIES.has(v.category)) continue;
    counts.set(v.category, (counts.get(v.category) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([category, count]) => ({
      category, count,
      label: CATEGORY_LABELS[category]?.label || category.replace(/_/g, ' '),
      color: CATEGORY_LABELS[category]?.color || '#9CA0AA',
    }))
    .sort((a, b) => b.count - a.count);
  const max = rows[0]?.count || 1;
  return rows.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }));
}

// Extra used tickets per event on this person's own orders = people they
// brought. TT tickets and internal tickets are counted together per event.
export function guestsBrought(usedTicketsByEvent) {
  let n = 0;
  for (const count of usedTicketsByEvent.values()) n += Math.max(0, count - 1);
  return n;
}

const PAID_ORDER_STATUSES = new Set(['paid', 'refunded', 'partially_refunded']);

export function spendSummary({ orders = [], bookings = [], invoices = null }) {
  let tickets = 0; let refunded = 0;
  for (const o of orders) {
    if (!PAID_ORDER_STATUSES.has(o.status)) continue;
    const total = Number(o.total_cents) || 0;
    const ref = Math.min(total, Number(o.refunded_cents) || 0);
    tickets += total - ref;
    refunded += ref;
  }
  let studio = 0;
  for (const b of bookings) {
    if (b.cancelled_at || b.status === 'cancelled') continue;
    studio += Number(b.total_cost_cents) || 0;
  }
  const duesAvailable = Array.isArray(invoices);
  let dues = 0;
  for (const inv of invoices || []) dues += Number(inv.amount_paid) || 0;
  return { total: tickets + studio + dues, tickets, studio, dues, duesAvailable, refunded };
}

export function contactPermissions({ emails = [], phones = [], signups = [], guests = [], prefs = [], pushCount = 0, memberPush = false }) {
  const emailSet = new Set(emails);
  const phoneSet = new Set(phones);
  const emailSignup = signups.find((s) => s.contact_type === 'email' && emailSet.has(String(s.contact || '').trim().toLowerCase()));
  const phoneSignup = signups.find((s) => s.contact_type === 'phone' && phoneSet.has(String(s.phone || s.contact || '').replace(/\D/g, '').slice(-10)));
  const optedOut = prefs.some((p) => p.type === 'marketing_broadcast' && p.email === false);
  const consented = guests.some((g) => g.marketing_consent === true);
  let email;
  if (optedOut) email = { label: 'OPTED OUT', tone: 'bad', note: 'Turned off marketing email in account settings' };
  else if (emailSignup || consented) email = { label: 'ON LIST', tone: 'ok', note: emailSignup ? `Joined via ${signupSourceLabel(emailSignup.source)}` : 'Agreed at the door' };
  else email = { label: 'NOT ON LIST', tone: 'neutral', note: null };
  const devices = Math.max(pushCount, memberPush ? 1 : 0);
  const push = devices > 0
    ? { label: 'ON', tone: 'ok', note: `${devices} device${devices === 1 ? '' : 's'}` }
    : { label: 'NO APP', tone: 'neutral', note: null };
  const sms = phoneSignup
    ? { label: 'SIGNED UP', tone: 'ok', note: `Phone signup via ${signupSourceLabel(phoneSignup.source)}` }
    : { label: 'NO CONSENT', tone: 'neutral', note: null };
  return { email, push, sms };
}

function signupSourceLabel(source) {
  return { trial_pass_qr: 'Trial Pass signup', homepage: 'website signup', front_desk_manual: 'front desk' }[source] || 'signup form';
}

// Population percentile badge: top 1/5/10/25% only.
export function percentileBadge(myCount, counts) {
  if (!myCount || !counts.length) return null;
  const above = counts.filter((c) => c > myCount).length;
  const pct = ((above + 1) / counts.length) * 100;
  const bucket = [1, 5, 10, 25].find((b) => pct <= b);
  return bucket ? `TOP ${bucket}% BY VISITS` : null;
}
