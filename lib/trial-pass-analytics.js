// Trial pass analytics \u2014 read-only aggregations backing /team/trial-pass/analytics.
//
// All queries run through the service-role admin client because they touch
// RLS-locked tables. The calling page is already gated by requireTeam().
//
// Kept as a plain module (not a React server function) so the page and any
// future JSON export route can share the same queries with identical shape.

// Lazy-imported inside loadTrialPassAnalytics so the pure computeAnalytics
// function can be exercised from raw Node --test without a bundler.
// import { createAdminClient } from '@/lib/supabase/admin';

import { computeEventWindow } from './event-window.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(daysAgo) {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString();
}

// One big fetch. We deliberately grab the passes with a wider select and do
// most of the counting in JS, because:
//   1. There are hundreds of passes, not millions \u2014 sending them all is fine.
//   2. Adds no per-metric SQL round trip.
//   3. Keeps the query logic in one place, testable as pure functions.
export async function loadTrialPassAnalytics({ admin: injectedAdmin } = {}) {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = injectedAdmin || createAdminClient();

  // Also pull reject_reason + event_id so the by-event view can render an
  // event-scoped attendee list, and reason breakdowns pick up 'rejected' rows
  // (the door scanner writes 'rejected' with a machine-readable reason on top
  // of the older 'denied_*' rows).
  const [passesRes, checkinsRes] = await Promise.all([
    admin
      .from('trial_passes')
      .select(
        'id, full_name, email, phone, status, signup_source, issued_at, expires_at, extended_until, activated_at, signup_expires_at, applied_at, converted_at, phone_verified_at, created_by, guest_profile_id',
      )
      .order('issued_at', { ascending: false })
      .limit(2000),
    admin
      .from('trial_pass_checkins')
      .select('trial_pass_id, event_id, result, reject_reason, notes, checked_in_at')
      .order('checked_in_at', { ascending: false })
      .limit(5000),
  ]);

  if (passesRes.error) {
    console.error('[trial-analytics.passes]', passesRes.error);
    return null;
  }
  if (checkinsRes.error) {
    console.error('[trial-analytics.checkins]', checkinsRes.error);
    return null;
  }

  const passes = passesRes.data || [];
  const checkins = checkinsRes.data || [];

  // Events feed the by-event tab in two ways: (a) as attribution windows for
  // each trial signup, keyed by the event that was happening at issued_at
  // time; and (b) as label lookups for any check-in row that stamped an
  // event_id. Pull every event whose date overlaps the passes we loaded,
  // plus any event referenced by a check-in, so both paths have what they
  // need. Trial passes go back a bounded amount of time and the events table
  // is small, so the wider window is cheap.
  const passIssuedAts = passes.map((p) => p.issued_at).filter(Boolean);
  let events = [];
  const eventsRes = await admin
    .from('events')
    .select('id, title, event_date, event_time')
    .order('event_date', { ascending: false })
    .limit(500);
  if (eventsRes.error) {
    console.error('[trial-analytics.events]', eventsRes.error);
    // Non-fatal: by-event tab will lump everything into Unattributed.
  } else {
    events = eventsRes.data || [];
  }
  // Silence “unused” lint warnings without changing behaviour — kept in case
  // we later narrow by min(passes.issued_at).
  void passIssuedAts;

  return computeAnalytics({ passes, checkins, events });
}

// Pure function. Everything below runs against the arrays fetched above,
// so it's easy to write focused tests by handing it fixture data.
export function computeAnalytics({ passes, checkins, events = [] }) {
  const now = Date.now();
  const last7 = iso(7);
  const last30 = iso(30);

  const totals = {
    all: passes.length,
    last7: 0,
    last30: 0,
    active: 0,
    // Active passes split by activation state — an issued-but-never-used pass
    // and a pass whose 30-day clock is ticking behave very differently, and
    // conflating them in a single "active" KPI hid every insight we cared
    // about. Sum of these two equals `active`.
    activeUnactivated: 0,
    activeActivated: 0,
    expired: 0,
    applied: 0,
    converted: 0,
    phoneVerified: 0,
  };

  const sourceBreakdown = new Map();
  const denialReasons = new Map();
  const daysToFirstCheckin = []; // for histogram
  const passesWithCheckin = new Set();
  const firstCheckinByPass = new Map();
  const checkinCountByPass = new Map();

  // Normalize each checkin row into { trial_pass_id, result, reason, scanned_at }
  // so the counting logic below is decoupled from the DB column names.
  const normalizedCheckins = checkins.map((c) => ({
    trial_pass_id: c.trial_pass_id,
    result: c.result,
    // Denial reason is not a first-class column \u2014 door staff can leave a note
    // on any scan, and for denials that note is our best structured signal.
    reason: c.reason || c.notes || null,
    scanned_at: c.scanned_at || c.checked_in_at,
  }));

  for (const c of normalizedCheckins) {
    if (c.result === 'denied') {
      const reasonKey = c.reason || 'unknown';
      denialReasons.set(reasonKey, (denialReasons.get(reasonKey) || 0) + 1);
    }
    if (c.result === 'allowed') {
      passesWithCheckin.add(c.trial_pass_id);
      checkinCountByPass.set(
        c.trial_pass_id,
        (checkinCountByPass.get(c.trial_pass_id) || 0) + 1,
      );
      const prev = firstCheckinByPass.get(c.trial_pass_id);
      if (!prev || new Date(c.scanned_at) < new Date(prev)) {
        firstCheckinByPass.set(c.trial_pass_id, c.scanned_at);
      }
    }
  }

  for (const p of passes) {
    if (p.issued_at >= last7) totals.last7++;
    if (p.issued_at >= last30) totals.last30++;
    if (p.status === 'active') {
      totals.active++;
      if (p.activated_at) totals.activeActivated++;
      else totals.activeUnactivated++;
    }
    if (p.status === 'expired') totals.expired++;
    if (p.applied_at) totals.applied++;
    if (p.converted_at) totals.converted++;
    if (p.phone_verified_at) totals.phoneVerified++;

    const src = p.signup_source || 'unknown';
    sourceBreakdown.set(src, (sourceBreakdown.get(src) || 0) + 1);

    const firstCheckin = firstCheckinByPass.get(p.id);
    if (firstCheckin) {
      const days = Math.floor((new Date(firstCheckin) - new Date(p.issued_at)) / DAY_MS);
      if (days >= 0 && days <= 45) daysToFirstCheckin.push(days);
    }
  }

  // Funnel counts.
  const checkedIn = passesWithCheckin.size;
  const funnel = {
    issued: totals.all,
    checkedIn,
    applied: totals.applied,
    converted: totals.converted,
  };

  // Conversion rates \u2014 protect against divide-by-zero.
  const rate = (num, den) => (den > 0 ? num / den : 0);
  const rates = {
    issuedToCheckin: rate(checkedIn, totals.all),
    checkinToApplied: rate(totals.applied, checkedIn),
    appliedToConverted: rate(totals.converted, totals.applied),
    endToEnd: rate(totals.converted, totals.all),
  };

  // Day-of-trial histogram bins: 0, 1-3, 4-7, 8-14, 15-30, 30+.
  const dayBuckets = { 'Same day': 0, '1\u20133 days': 0, '4\u20137 days': 0, '8\u201314 days': 0, '15\u201330 days': 0 };
  for (const d of daysToFirstCheckin) {
    if (d === 0) dayBuckets['Same day']++;
    else if (d <= 3) dayBuckets['1\u20133 days']++;
    else if (d <= 7) dayBuckets['4\u20137 days']++;
    else if (d <= 14) dayBuckets['8\u201314 days']++;
    else dayBuckets['15\u201330 days']++;
  }

  // Recent passes for the activity table. Two clocks: an unactivated pass
  // counts down to signup_expires_at (60-day window), an activated pass
  // counts down to expires_at (30-day window) or extended_until.
  const recent = passes.slice(0, 20).map((p) => {
    const activated = Boolean(p.activated_at);
    const effectiveExpiry = activated
      ? p.extended_until || p.expires_at
      : p.signup_expires_at;
    const daysLeft = effectiveExpiry
      ? Math.max(0, Math.ceil((new Date(effectiveExpiry) - now) / DAY_MS))
      : 0;
    return {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      status: p.status,
      // Sub-status distinguishes 'active-but-never-used' from 'active-and-ticking'.
      // The table can render both under one "Active" pill but sort/filter on this.
      activationPhase: activated ? 'activated' : p.status === 'active' ? 'unactivated' : 'n/a',
      signupSource: p.signup_source || 'unknown',
      issuedAt: p.issued_at,
      activatedAt: p.activated_at || null,
      expiresAt: effectiveExpiry,
      daysLeft: p.status === 'active' ? daysLeft : 0,
      appliedAt: p.applied_at,
      convertedAt: p.converted_at,
      checkinCount: checkinCountByPass.get(p.id) || 0,
    };
  });

  // Per-event roll-up feeds the "By event" tab. Same source data, grouped by
  // event_id, with the pass + event details attached so the client can render
  // the summary list and drill-down without another round trip.
  const byEvent = computeByEvent({ passes, checkins, events });

  return {
    totals,
    funnel,
    rates,
    sourceBreakdown: [...sourceBreakdown.entries()].map(([source, count]) => ({ source, count })),
    denialReasons: [...denialReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    dayBuckets: Object.entries(dayBuckets).map(([label, count]) => ({ label, count })),
    recent,
    byEvent,
  };
}

// Group trial passes by the event that was happening when they signed up.
// Signups are the primary metric today because check-in scanning is not yet
// running at the door — the trial_pass_checkins table is empty. Check-ins are
// still tracked per event for when scanning goes live, so the tab keeps
// working with no code change once the door starts logging scans.
//
// Attribution rules for a pass -> event assignment:
//   1. For each event, compute a [start, end] instant window in America/Chicago
//      using event_date + event_time, plus a 2h pre/post buffer
//      (see lib/event-window.js).
//   2. A pass's issued_at falls in zero or more event windows. If it falls in
//      one, it's attributed there. If it falls in several (overlapping
//      windows), it goes to the event whose start time is closest to issued_at.
//   3. Anything not covered by any event window lands in a synthetic
//      "Unattributed" bucket so we never silently drop a pass.
//
// Output shape:
//   [
//     {
//       eventId, title, eventDate, eventTime,
//       windowStartISO, windowEndISO,   // for debugging / CSV context
//       signupCount,                    // # trial passes attributed here
//       checkedInCount,                 // # of those signups that later scanned in
//       rejectedCount, deniedCount,     // door-scan side, from trial_pass_checkins
//       signups: [
//         { passId, fullName, email, phone, issuedAt,
//           phoneVerified, appliedAt, convertedAt, signupSource,
//           checkedInAt }               // null until they scan
//       ]
//     },
//     ...
//   ]
//
// Sorted newest event first. The Unattributed bucket falls to the bottom.
export function computeByEvent({ passes, checkins, events = [] }) {
  const eventById = new Map(events.map((e) => [e.id, e]));
  const UNATTRIBUTED = '__unattributed__';

  // Pre-compute [start, end] windows for every event so pass attribution is a
  // linear scan rather than an N×M reparse. Events with no readable date drop
  // out entirely because we cannot place their window on the timeline.
  const eventWindows = [];
  for (const e of events) {
    const win = computeEventWindow(e.event_date, e.event_time);
    if (!win) continue;
    eventWindows.push({ event: e, ...win });
  }

  // First allowed check-in per pass, keyed by pass id — wired into the signup
  // row so a checked-in pass shows its scan time in the drill-down.
  const firstAllowedCheckinByPass = new Map();
  for (const c of checkins) {
    if (c.result !== 'allowed') continue;
    const at = c.checked_in_at;
    const prev = firstAllowedCheckinByPass.get(c.trial_pass_id);
    if (!prev || new Date(at) < new Date(prev)) {
      firstAllowedCheckinByPass.set(c.trial_pass_id, at);
    }
  }

  // groupKey -> group descriptor
  const groups = new Map();
  function getGroup(key, seed) {
    let g = groups.get(key);
    if (!g) {
      g = seed();
      groups.set(key, g);
    }
    return g;
  }

  // Seed every event as a group so a slow night still appears on the tab
  // with signupCount: 0. Otherwise events with zero signups disappear.
  for (const w of eventWindows) {
    getGroup(w.event.id, () => ({
      eventId: w.event.id,
      title: w.event.title || 'Untitled event',
      eventDate: w.event.event_date || null,
      eventTime: w.event.event_time || null,
      windowStartMs: w.startMs,
      windowEndMs: w.endMs,
      windowParsed: w.parsed,
      rejectedCount: 0,
      deniedCount: 0,
      _rows: [],
    }));
  }

  // Attribute each pass to at most one event.
  for (const p of passes) {
    if (!p.issued_at) continue;
    const issuedMs = new Date(p.issued_at).getTime();
    if (Number.isNaN(issuedMs)) continue;

    let best = null;
    let bestDist = Infinity;
    for (const w of eventWindows) {
      if (issuedMs >= w.startMs && issuedMs <= w.endMs) {
        // Closest-to-start wins on overlapping windows. Signups typically
        // cluster right after doors open, so proximity to start is a better
        // proxy than proximity to midpoint.
        const dist = Math.abs(issuedMs - w.startMs);
        if (dist < bestDist) {
          best = w;
          bestDist = dist;
        }
      }
    }

    const groupKey = best ? best.event.id : UNATTRIBUTED;
    const g = getGroup(groupKey, () => ({
      eventId: null,
      title: 'Unattributed signups',
      eventDate: null,
      eventTime: null,
      windowStartMs: null,
      windowEndMs: null,
      windowParsed: false,
      rejectedCount: 0,
      deniedCount: 0,
      _rows: [],
    }));

    g._rows.push({
      passId: p.id,
      fullName: p.full_name,
      email: p.email,
      phone: p.phone || null,
      issuedAt: p.issued_at,
      phoneVerified: Boolean(p.phone_verified_at),
      appliedAt: p.applied_at || null,
      convertedAt: p.converted_at || null,
      signupSource: p.signup_source || 'unknown',
      checkedInAt: firstAllowedCheckinByPass.get(p.id) || null,
    });
  }

  // Fold in door-scan counts by event so the event card can show "20 signups •
  // 12 checked in • 1 rejected". These come from trial_pass_checkins.event_id,
  // which the door scanner stamps. The `checkedInCount` is derived from the
  // group's signups ("how many of MY signups later checked in") rather than
  // total scans, so walk-in scans that were never trial signups do not
  // inflate the number.
  for (const c of checkins) {
    if (!c.event_id) continue;
    const g = groups.get(c.event_id);
    if (!g) continue;
    if (c.result === 'rejected') g.rejectedCount++;
    else if (typeof c.result === 'string' && c.result.startsWith('denied')) g.deniedCount++;
  }

  const out = [];
  for (const g of groups.values()) {
    // Dedup by pass id (belt-and-suspenders — the loop above never adds a
    // pass twice, but a future refactor might).
    const seen = new Set();
    const signups = [];
    for (const r of g._rows) {
      if (seen.has(r.passId)) continue;
      seen.add(r.passId);
      signups.push(r);
    }
    signups.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));

    const checkedInCount = signups.reduce((n, r) => n + (r.checkedInAt ? 1 : 0), 0);

    out.push({
      eventId: g.eventId,
      title: g.title,
      eventDate: g.eventDate,
      eventTime: g.eventTime,
      windowStartISO: g.windowStartMs ? new Date(g.windowStartMs).toISOString() : null,
      windowEndISO: g.windowEndMs ? new Date(g.windowEndMs).toISOString() : null,
      windowParsed: g.windowParsed,
      signupCount: signups.length,
      checkedInCount,
      rejectedCount: g.rejectedCount,
      deniedCount: g.deniedCount,
      signups,
    });
  }

  // Newest event first. Unattributed bucket falls to the bottom regardless.
  out.sort((a, b) => {
    const aUn = !a.eventDate;
    const bUn = !b.eventDate;
    if (aUn && bUn) return 0;
    if (aUn) return 1;
    if (bUn) return -1;
    return new Date(b.eventDate) - new Date(a.eventDate);
  });

  return out;
}
