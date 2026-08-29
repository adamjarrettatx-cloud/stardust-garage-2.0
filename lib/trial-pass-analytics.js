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

  const [passesRes, checkinsRes] = await Promise.all([
    admin
      .from('trial_passes')
      .select(
        'id, full_name, email, status, signup_source, issued_at, expires_at, extended_until, applied_at, converted_at, phone_verified_at, created_by, guest_profile_id',
      )
      .order('issued_at', { ascending: false })
      .limit(2000),
    admin
      .from('trial_pass_checkins')
      .select('trial_pass_id, result, reason, scanned_at')
      .order('scanned_at', { ascending: false })
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

  return computeAnalytics({ passes, checkins });
}

// Pure function. Everything below runs against the two arrays fetched above,
// so it's easy to write focused tests by handing it fixture data.
export function computeAnalytics({ passes, checkins }) {
  const now = Date.now();
  const last7 = iso(7);
  const last30 = iso(30);

  const totals = {
    all: passes.length,
    last7: 0,
    last30: 0,
    active: 0,
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

  for (const c of checkins) {
    if (c.result === 'denied') {
      denialReasons.set(c.reason || 'unknown', (denialReasons.get(c.reason || 'unknown') || 0) + 1);
    }
    if (c.result === 'allowed') {
      passesWithCheckin.add(c.trial_pass_id);
      checkinCountByPass.set(
        c.trial_pass_id,
        (checkinCountByPass.get(c.trial_pass_id) || 0) + 1,
      );
      // Because we ordered checkins DESC, later iterations may overwrite \u2014
      // we want the EARLIEST allowed checkin per pass, so only set if unset
      // OR the new one is older.
      const prev = firstCheckinByPass.get(c.trial_pass_id);
      if (!prev || new Date(c.scanned_at) < new Date(prev)) {
        firstCheckinByPass.set(c.trial_pass_id, c.scanned_at);
      }
    }
  }

  for (const p of passes) {
    if (p.issued_at >= last7) totals.last7++;
    if (p.issued_at >= last30) totals.last30++;
    if (p.status === 'active') totals.active++;
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

  // Recent passes for the activity table.
  const recent = passes.slice(0, 20).map((p) => {
    const effectiveExpiry = p.extended_until || p.expires_at;
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(effectiveExpiry) - now) / DAY_MS),
    );
    return {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      status: p.status,
      signupSource: p.signup_source || 'unknown',
      issuedAt: p.issued_at,
      expiresAt: effectiveExpiry,
      daysLeft: p.status === 'active' ? daysLeft : 0,
      appliedAt: p.applied_at,
      convertedAt: p.converted_at,
      checkinCount: checkinCountByPass.get(p.id) || 0,
    };
  });

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
  };
}
